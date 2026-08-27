#!/usr/bin/env node
// Keep a local copy of every image the corpus records, and link each item to it.
//
// The corpus cites images by URL, and URLs rot. A page redesign, a CDN move, or
// a deleted file makes an item unscoreable, and by then nobody can tell whether
// the gold standard was right. So every item with a separate image file gets a
// byte copy under corpus/images/, named after the item, with its SHA-256 in the
// record. The archive is what makes a score reproducible after the web moves on.
//
// Two fields per item, written here and nowhere else:
//   image_file    project-relative path of the copy, or null when there is none
//   image_sha256  SHA-256 of that file in lowercase hex, or null
//
// Usage:
//   node tools/fetch-images.mjs              archive every image not yet copied
//   node tools/fetch-images.mjs --dry-run    say what would be fetched
//   node tools/fetch-images.mjs --verify     re-hash the copies on disk
//   node tools/fetch-images.mjs --selftest   offline, no network
//   --corpus FILE, --images DIR              work somewhere else
//
// Retrieval, in order of precedence:
//   IMAGE_FETCH_CMD='curl -sSL'  any command that writes the bytes to stdout
//   built-in fetch               the default
//
// Fetching is sequential and unhurried, one request at a time, because directive
// 00 requires collection to be polite.
//
// A URL that does not resolve is an ordinary outcome, not a defect in the record:
// the item keeps its URL, gets no local copy, and cannot be accepted until it
// has one. Fetching is therefore not all or nothing, unlike applying verdicts or
// merging passes, and the items that did work are written even when others fail.
//
// Exit codes: 0 nothing left to archive, 1 something could not be archived,
// 2 refused because the corpus or the archive is unusable, 3 bad usage or
// self-test failure.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync,
  mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')

// Where the copies live, relative to the project directory. The path is stored
// in the record exactly like this, so every agent, tool and reader resolves it
// the same way: from the project directory, which is where all the other paths
// in this project are resolved from.
const ARCHIVE_DIR = 'corpus/images'

// Extensions we are willing to write, and how to recognise the bytes. An
// extension we cannot name is refused rather than guessed, because a file whose
// type is unknown cannot be handed to a model later.
const TYPES = {
  svg: { types: ['image/svg+xml'], looks: (b) => sniffText(b, '<svg') },
  png: { types: ['image/png'], looks: (b) => magic(b, [0x89, 0x50, 0x4e, 0x47]) },
  jpg: {
    types: ['image/jpeg', 'image/jpg'],
    looks: (b) => magic(b, [0xff, 0xd8, 0xff]),
  },
  gif: { types: ['image/gif'], looks: (b) => ascii(b, 0, 'GIF8') },
  webp: {
    types: ['image/webp'],
    looks: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP'),
  },
  avif: { types: ['image/avif'], looks: (b) => ascii(b, 4, 'ftyp') },
  ico: {
    types: ['image/x-icon', 'image/vnd.microsoft.icon'],
    looks: (b) => magic(b, [0x00, 0x00, 0x01, 0x00]),
  },
  bmp: { types: ['image/bmp'], looks: (b) => ascii(b, 0, 'BM') },
}

const MAX_BYTES = 8 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20000
const USER_AGENT = 'benchmarks-ai-alt corpus archiver ' +
  '(+https://github.com/EqualifyEverything/benchmarks-ai-alt)'

// A rejected item is kept as evidence and will never be scored, so it is not
// worth a request.
const WORTH_ARCHIVING = ['candidate', 'needs-revision', 'accepted']

const isStr = (v) => typeof v === 'string'

const magic = (b, bytes) => b.length >= bytes.length &&
  bytes.every((x, i) => b[i] === x)
const ascii = (b, at, text) => b.length >= at + text.length &&
  b.slice(at, at + text.length).toString('latin1') === text
// An SVG can open with a comment, a doctype or an XML declaration, so look for
// the root element in the first stretch of the file rather than at byte zero.
const sniffText = (b, needle) =>
  b.slice(0, 512).toString('utf8').toLowerCase().includes(needle)

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function extFromContentType(ct) {
  if (!isStr(ct)) return null
  const value = ct.split(';')[0].trim().toLowerCase()
  for (const [ext, spec] of Object.entries(TYPES)) {
    if (spec.types.includes(value)) return ext
  }
  return null
}

function extFromUrl(url) {
  let path
  try {
    path = new URL(url).pathname
  } catch {
    return null
  }
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/)
  if (!m) return null
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
  return ext in TYPES ? ext : null
}

function readJsonl(path) {
  const rows = []
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    return { rows, errors: [`${path}: cannot be read, ${e.code ?? e.message}`] }
  }
  const errors = []
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (line === '') return
    try {
      rows.push({ line: i + 1, value: JSON.parse(line) })
    } catch (e) {
      errors.push(`${path}:${i + 1}: invalid JSON, ${e.message}`)
    }
  })
  return { rows, errors }
}

const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

// A copy already on disk for this item, whatever its extension. Used so a
// re-run adopts what is there instead of fetching it again, and so a record that
// lost its fields can be repaired without another request.
function existingArchive(imagesDir, id) {
  let names
  try {
    names = readdirSync(imagesDir)
  } catch {
    return null
  }
  return names.find((n) => new RegExp(`^${id}\\.[a-z0-9]+$`).test(n)) ?? null
}

function needsArchive(item) {
  if (!WORTH_ARCHIVING.includes(item.status)) return false
  if (!isStr(item.image_url) || item.image_url === '') return false
  return !isStr(item.image_file) || item.image_file === ''
}

// --- retrieval -------------------------------------------------------------

// The built-in path. Returns bytes and the content type, or a reason it failed.
async function httpGet(url) {
  let res
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'image/*,*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    return { error: `request failed, ${e.message}` }
  }
  if (!res.ok) return { error: `HTTP ${res.status}` }
  const bytes = Buffer.from(await res.arrayBuffer())
  return { bytes, contentType: res.headers.get('content-type') }
}

// The escape hatch, for a machine where curl works and fetch does not, or where
// a proxy needs flags. The command is given the URL as its last argument and
// must write the bytes to standard output.
function commandGet(cmd) {
  const words = cmd.trim().split(/\s+/)
  return async (url) => {
    try {
      const bytes = execFileSync(words[0], [...words.slice(1), url], {
        maxBuffer: MAX_BYTES + 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (bytes.length === 0) return { error: `${words[0]} returned no bytes` }
      return { bytes, contentType: null }
    } catch (e) {
      return { error: `${words[0]} failed, ${e.message.split('\n')[0]}` }
    }
  }
}

function defaultGet() {
  const cmd = process.env.IMAGE_FETCH_CMD
  return isStr(cmd) && cmd.trim() !== '' ? commandGet(cmd) : httpGet
}

// --- archive ---------------------------------------------------------------

// Decide the extension, then insist the bytes match it. A soft 404 that serves
// an HTML page with a 200 status is the failure this catches, and it is common
// enough that saving it silently would put error pages in the corpus.
function classify(url, contentType, bytes) {
  const ext = extFromContentType(contentType) ?? extFromUrl(url)
  if (ext === null) {
    return { error: `cannot name the image type from ${contentType ?? 'no ' +
      'content type'} or the URL path` }
  }
  if (!TYPES[ext].looks(bytes)) {
    const head = bytes.slice(0, 24).toString('latin1').replace(/[^\x20-\x7e]/g, '.')
    return { error: `the bytes are not ${ext}, they start "${head}"` }
  }
  return { ext }
}

async function archive(corpusPath, imagesDir, get, { dryRun = false } = {}) {
  const { rows, errors } = readJsonl(corpusPath)
  if (errors.length > 0) return { errors, notes: [], archived: 0, failed: [] }

  const todo = rows.map(({ value }) => value).filter(needsArchive)
  const notes = []
  const failed = []
  let archived = 0

  for (const item of todo) {
    const id = isStr(item.id) ? item.id : '(no id)'
    if (!/^fi-\d{4}$/.test(id)) {
      failed.push(`${id}: the item has no usable id, so the copy cannot be named`)
      continue
    }

    // Already on disk from an earlier run: adopt it rather than fetch again.
    const present = existingArchive(imagesDir, id)
    if (present !== null) {
      const bytes = readFileSync(join(imagesDir, present))
      if (!dryRun) {
        item.image_file = `${ARCHIVE_DIR}/${present}`
        item.image_sha256 = sha256(bytes)
      }
      archived++
      notes.push(`${id}: adopted the copy already in ${ARCHIVE_DIR}/, no request`)
      continue
    }

    if (dryRun) {
      notes.push(`${id}: would fetch ${item.image_url}`)
      archived++
      continue
    }

    const got = await get(item.image_url)
    if (got.error) {
      failed.push(`${id}: ${got.error} for ${item.image_url}`)
      continue
    }
    if (got.bytes.length > MAX_BYTES) {
      failed.push(`${id}: ${got.bytes.length} bytes, over the ${MAX_BYTES} limit`)
      continue
    }
    const { ext, error } = classify(item.image_url, got.contentType, got.bytes)
    if (error) {
      failed.push(`${id}: ${error}`)
      continue
    }

    const name = `${id}.${ext}`
    mkdirSync(imagesDir, { recursive: true })
    writeFileSync(join(imagesDir, name), got.bytes)
    item.image_file = `${ARCHIVE_DIR}/${name}`
    item.image_sha256 = sha256(got.bytes)
    archived++
    notes.push(`${id}: ${got.bytes.length} bytes to ${ARCHIVE_DIR}/${name}`)
  }

  const lines = archived > 0 && !dryRun
    ? toJsonl(rows.map(({ value }) => value)) : null
  return { errors, notes, archived, failed, lines, considered: todo.length }
}

// --- verify ----------------------------------------------------------------

// The corpus says a file exists and hashes to a value. This is the only thing
// that checks that claim against the disk. tools/validate.mjs checks the shape
// of the reference; this checks the bytes.
function verify(corpusPath, imagesDir) {
  const { rows, errors } = readJsonl(corpusPath)
  if (errors.length > 0) return { errors, problems: [], checked: 0, orphans: [] }

  const problems = []
  const referenced = new Set()
  let checked = 0
  for (const { value: item } of rows) {
    if (!isStr(item.image_file) || item.image_file === '') continue
    const name = basename(item.image_file)
    referenced.add(name)
    const path = join(imagesDir, name)
    if (!existsSync(path)) {
      problems.push(`${item.id}: \`image_file\` names ${item.image_file}, which ` +
        'is not on disk')
      continue
    }
    checked++
    const hash = sha256(readFileSync(path))
    if (!isStr(item.image_sha256) || item.image_sha256 === '') {
      problems.push(`${item.id}: the copy exists but \`image_sha256\` is empty, ` +
        `it should be ${hash}`)
    } else if (item.image_sha256 !== hash) {
      problems.push(`${item.id}: ${item.image_file} hashes to ${hash}, but the ` +
        `record says ${item.image_sha256}`)
    }
  }

  let names = []
  try {
    names = readdirSync(imagesDir).filter((n) => n !== 'README.md')
  } catch { /* no archive yet, which the counts below report */ }
  const orphans = names.filter((n) => !referenced.has(n))
  return { errors, problems, checked, orphans }
}

// --- self-test -------------------------------------------------------------

function selftest() {
  let failures = 0
  const dir = mkdtempSync(join(tmpdir(), 'alt-images-'))
  const corpusPath = join(dir, 'corpus.jsonl')
  const imagesDir = join(dir, 'images')
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  const html = Buffer.from('<!doctype html><title>Not found</title>')

  const item = (id, over) => ({
    id, status: 'candidate',
    image_url: `https://example.com/i/${id}.png`,
    image_file: null, image_sha256: null,
    gold_alt: 'Home', ...over,
  })
  const write = (rows) => writeFileSync(corpusPath, toJsonl(rows))
  const read = () => readFileSync(corpusPath, 'utf8').trim().split('\n')
    .map((l) => JSON.parse(l))
  const check = (name, cond, detail) => {
    if (cond) process.stdout.write(`PASS ${name}\n`)
    else { process.stdout.write(`FAIL ${name}: ${detail}\n`); failures++ }
  }
  // Every case injects its own retrieval, so the self-test never touches the
  // network and its results do not depend on anything being reachable.
  const getting = (result) => {
    const calls = []
    const get = async (url) => { calls.push(url); return result }
    return { get, calls }
  }
  const run = async (rows, result, opts) => {
    write(rows)
    const g = getting(result)
    const r = await archive(corpusPath, imagesDir, g.get, opts)
    if (r.lines !== null && r.lines !== undefined) writeFileSync(corpusPath, r.lines)
    return { ...r, calls: g.calls }
  }

  return (async () => {
    // A missing copy is fetched, written, and linked from the record.
    let r = await run([item('fi-0001')], { bytes: png, contentType: 'image/png' })
    let rec = read()[0]
    const onDisk = join(imagesDir, 'fi-0001.png')
    check('a missing image is fetched and linked',
      r.archived === 1 && r.failed.length === 0 &&
      rec.image_file === 'corpus/images/fi-0001.png' &&
      rec.image_sha256 === sha256(png) && existsSync(onDisk),
      `${r.failed.join('; ')} ${JSON.stringify(rec.image_file)}`)

    // Re-running adopts what is on disk and makes no request. A tool that
    // refetched every round would hammer the sites the corpus depends on.
    r = await run([item('fi-0001')], { error: 'should not be called' })
    rec = read()[0]
    check('a copy already on disk is adopted without a request',
      r.calls.length === 0 && r.archived === 1 &&
      rec.image_sha256 === sha256(png),
      `${r.calls.length} request(s), ${r.failed.join('; ')}`)

    // Items with nothing to archive are left alone, including rejected ones,
    // which are kept as evidence and will never be scored.
    r = await run([
      item('fi-0002', { image_url: null }),
      item('fi-0003', { status: 'rejected' }),
      item('fi-0004', { image_file: 'corpus/images/fi-0004.png',
        image_sha256: sha256(png) }),
    ], { error: 'should not be called' })
    check('nothing to archive means no requests',
      r.calls.length === 0 && r.archived === 0 && r.considered === 0,
      `considered ${r.considered}, ${r.calls.length} request(s)`)

    // An HTML error page served with a 200 status is the common soft failure.
    // Saving it would put a "Not found" page in the corpus as an image.
    r = await run([item('fi-0005')], { bytes: html, contentType: 'text/html' })
    rec = read()[0]
    check('an HTML error page is refused',
      r.archived === 0 && r.failed.length === 1 && rec.image_file === null &&
      !existsSync(join(imagesDir, 'fi-0005.png')),
      r.failed.join('; ') || 'nothing refused')

    // A URL that does not resolve leaves the record untouched and is reported.
    // Link rot is expected, so it is not treated as a defect in the record.
    r = await run([item('fi-0006')], { error: 'HTTP 404' })
    rec = read()[0]
    check('an unreachable URL is reported, not written',
      r.archived === 0 && r.failed.length === 1 &&
      r.failed[0].includes('404') && rec.image_file === null,
      r.failed.join('; ') || 'nothing reported')

    // The content type decides the extension when it disagrees with the URL,
    // because the server knows what it served.
    r = await run([item('fi-0007', {
      image_url: 'https://example.com/i/badname.svg' })],
    { bytes: png, contentType: 'image/png' })
    rec = read()[0]
    check('the content type wins over the URL extension',
      rec.image_file === 'corpus/images/fi-0007.png',
      JSON.stringify(rec.image_file))

    // With no content type, which is what a fetch command gives us, the URL
    // extension is used and the bytes still have to match it.
    r = await run([item('fi-0008', {
      image_url: 'https://example.com/i/x.svg' })], { bytes: svg })
    rec = read()[0]
    const mismatch = await run([item('fi-0009', {
      image_url: 'https://example.com/i/y.svg' })], { bytes: png })
    check('with no content type the URL extension is used and checked',
      rec.image_file === 'corpus/images/fi-0008.svg' &&
      mismatch.failed.length === 1 && mismatch.failed[0].includes('not svg'),
      `${JSON.stringify(rec.image_file)}, ${mismatch.failed.join('; ')}`)

    // --dry-run says what it would do and writes nothing.
    const before = readdirSync(imagesDir).length
    r = await run([item('fi-0010')], { bytes: png, contentType: 'image/png' },
      { dryRun: true })
    check('--dry-run writes nothing',
      r.calls.length === 0 && readdirSync(imagesDir).length === before &&
      read()[0].image_file === null && r.notes.some((n) => n.includes('would fetch')),
      `${r.calls.length} request(s), notes ${r.notes.join('; ')}`)

    // Verification catches a copy that changed on disk, and one that is gone.
    // Either means the archive no longer supports the scores taken from it.
    write([item('fi-0001', { image_file: 'corpus/images/fi-0001.png',
      image_sha256: sha256(png) })])
    let v = verify(corpusPath, imagesDir)
    const clean = v.problems.length === 0 && v.checked === 1
    writeFileSync(onDisk, Buffer.concat([png, Buffer.from([9])]))
    v = verify(corpusPath, imagesDir)
    const caught = v.problems.length === 1 && v.problems[0].includes('hashes to')
    rmSync(onDisk)
    v = verify(corpusPath, imagesDir)
    const missing = v.problems.length === 1 && v.problems[0].includes('not on disk')
    check('verification catches a changed or missing copy',
      clean && caught && missing,
      `clean ${clean}, changed ${caught}, missing ${missing}`)

    rmSync(dir, { recursive: true, force: true })
    process.stdout.write(failures === 0
      ? '\nfetch-images self-test passed\n'
      : `\nfetch-images self-test failed, ${failures} case(s)\n`)
    return failures === 0 ? 0 : 3
  })()
}

// --- entry point -----------------------------------------------------------

async function main(argv) {
  let mode = 'archive'
  let dryRun = false
  let corpusPath = join(PROJECT, 'corpus', 'functional-images.jsonl')
  let imagesDir = join(PROJECT, ARCHIVE_DIR)

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--selftest') return selftest()
    else if (arg === '--verify') mode = 'verify'
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--corpus') corpusPath = resolve(argv[++i] ?? '')
    else if (arg === '--images') imagesDir = resolve(argv[++i] ?? '')
    else {
      process.stderr.write(`fetch-images.mjs: unknown argument "${arg}"\n` +
        'usage: fetch-images.mjs [--verify] [--dry-run] [--corpus FILE] ' +
        '[--images DIR] [--selftest]\n')
      return 3
    }
  }

  if (!existsSync(corpusPath)) {
    process.stdout.write(`no corpus at ${corpusPath}, nothing to archive\n`)
    return 0
  }

  if (mode === 'verify') {
    const { errors, problems, checked, orphans } = verify(corpusPath, imagesDir)
    if (errors.length > 0) {
      for (const e of errors) process.stdout.write(`  ${e}\n`)
      return 2
    }
    process.stdout.write(`archive: ${checked} local image copy(ies) verified ` +
      `against ${basename(corpusPath)}\n`)
    if (orphans.length > 0) {
      process.stdout.write(`${orphans.length} file(s) in the archive that no item ` +
        'refers to. Left alone, because deleting corpus evidence is not this ' +
        "tool's job:\n")
      process.stdout.write(`  ${orphans.join(' ')}\n`)
    }
    if (problems.length === 0) return 0
    process.stdout.write('the archive does not match the corpus:\n')
    for (const p of problems) process.stdout.write(`  ${p}\n`)
    process.stdout.write('\nA copy that changed or vanished invalidates every ' +
      'score taken from it. Restore it from git, or refetch it and record why in ' +
      'corpus/corrections.md.\n')
    return 2
  }

  const { errors, notes, archived, failed, lines, considered } =
    await archive(corpusPath, imagesDir, defaultGet(), { dryRun })
  if (errors.length > 0) {
    process.stdout.write('refused to archive:\n')
    for (const e of errors) process.stdout.write(`  ${e}\n`)
    return 2
  }
  if (considered === 0) {
    process.stdout.write('archive: every image with a URL already has a local ' +
      'copy\n')
    return 0
  }
  for (const n of notes) process.stdout.write(`  ${n}\n`)
  if (lines !== null) writeFileSync(corpusPath, lines)
  process.stdout.write(dryRun
    ? `archive: ${archived} of ${considered} image(s) would be copied into ` +
      `${ARCHIVE_DIR}/, nothing written, --dry-run\n`
    : `archive: ${archived} of ${considered} image(s) copied into ` +
      `${ARCHIVE_DIR}/\n`)
  if (failed.length === 0) return 0
  process.stdout.write(`${failed.length} could not be archived:\n`)
  for (const f of failed) process.stdout.write(`  ${f}\n`)
  process.stdout.write('\nThose items keep their image URL and get no local ' +
    'copy, so they cannot be accepted. Refetch them next round, or drop them if ' +
    'the image is gone for good.\n')
  return 1
}

process.exit(await main(process.argv.slice(2)))
