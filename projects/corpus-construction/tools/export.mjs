#!/usr/bin/env node
// Hand the reviewed items to the corpus-validation project for human review.
//
// This is the last step of construction and the first step of validation. It
// writes projects/corpus-validation/functional-images.jsonl, which that project's
// js/main.js reads directly.
//
// No images are copied. corpus-validation resolves an image as
// '../corpus-construction/' + item.image_file, and image_file is already
// pool/images/ID.ext relative to this project, so served from the repository root
// the path resolves on its own. Copying would mean two sets of bytes drifting
// apart.
//
// Only items that are `ready` with `alt_quality: good` are exported. An item
// whose shipped alt text is weak or wrong stays in the corpus as evidence but is
// never put in front of a person as though it were a reference.
//
// Usage:
//   node tools/export.mjs                  write the validation corpus
//   node tools/export.mjs --dry-run        report, write nothing
//   node tools/export.mjs --selftest       offline
//   --corpus FILE, --out FILE              work somewhere else
//
// Exit codes: 0 exported, 1 nothing to export, 2 refused, 3 bad usage or
// self-test failure.

import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync,
  rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const REPO = resolve(PROJECT, '..', '..')

// The prefix corpus-validation joins onto image_file. Hard-coded here on purpose:
// if that project changes it, this check should fail loudly rather than ship
// broken paths.
const VALIDATION_PREFIX = 'projects/corpus-construction/'

// Everything a person needs to judge the pair, and nothing about how we decided
// to show it to them. The first eight are what js/main.js reads.
const EXPORTED = [
  'id', 'image_file', 'image_url', 'element_html', 'observed_alt', 'page_url',
  'element_role', 'surrounding_text',
  'domain', 'sector', 'implementation', 'category', 'subtype',
  'accessible_name', 'accessible_name_source', 'retrieved',
]

function readJsonl(path) {
  if (!existsSync(path)) return { rows: [], errors: [`${path}: not found`] }
  const rows = []
  const errors = []
  readFileSync(path, 'utf8').split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (line === '') return
    try { rows.push(JSON.parse(line)) } catch (e) {
      errors.push(`${path}:${i + 1}: invalid JSON, ${e.message}`)
    }
  })
  return { rows, errors }
}

export const exportable = (item) =>
  item.status === 'ready' && item.alt_quality === 'good'

export function shape(item) {
  const out = {}
  for (const field of EXPORTED) out[field] = item[field] ?? null
  return out
}

// Would corpus-validation actually find the bytes? Checked against the real
// filesystem, because a corpus of broken image paths reviews as a corpus of
// missing images.
export function checkImages(items, repoRoot) {
  const missing = []
  for (const item of items) {
    if (typeof item.image_file !== 'string' || item.image_file === '') {
      missing.push(`${item.id}: no image_file`)
      continue
    }
    const at = join(repoRoot, VALIDATION_PREFIX, item.image_file)
    if (!existsSync(at)) missing.push(`${item.id}: ${item.image_file} not on disk`)
  }
  return missing
}

// --- self-test -------------------------------------------------------------

function selftest() {
  let failures = 0
  const check = (name, cond, detail) => {
    if (cond) process.stdout.write(`PASS ${name}\n`)
    else { process.stdout.write(`FAIL ${name}: ${detail ?? ''}\n`); failures++ }
  }
  const item = (id, over = {}) => ({
    id, status: 'ready', alt_quality: 'good',
    image_file: `pool/images/${id}.png`, image_url: `https://e.example.com/${id}.png`,
    element_html: `<a href="/"><img src="${id}.png" alt="Home"></a>`,
    observed_alt: 'Home', page_url: 'https://e.example.com/', domain: 'e.example.com',
    element_role: 'link', surrounding_text: 'Home Products About',
    sector: 'commerce', implementation: 'img', category: 1,
    subtype: 'linked-standalone-logo', accessible_name: 'Home',
    accessible_name_source: 'alt', retrieved: '2026-08-27',
    review_verdict: 'keep', review_reason: 'Checked the archived image.',
    ...over,
  })

  check('a ready item with good alt is exported', exportable(item('fi-0001')))
  check('an unreviewed item is not exported',
    !exportable(item('fi-0001', { status: 'unreviewed', alt_quality: null })))
  check('a dropped item is not exported',
    !exportable(item('fi-0001', { status: 'dropped', alt_quality: 'wrong' })))
  check('a ready item with weak alt is not exported',
    !exportable(item('fi-0001', { alt_quality: 'weak' })))

  {
    const row = shape(item('fi-0001'))
    check('the exported record carries every field the reviewer renders',
      ['id', 'image_file', 'image_url', 'element_html', 'observed_alt',
        'page_url', 'element_role', 'surrounding_text']
        .every((f) => row[f] !== undefined),
      JSON.stringify(Object.keys(row)))
    check('review bookkeeping is not exported',
      row.review_verdict === undefined && row.status === undefined &&
      row.alt_quality === undefined,
      JSON.stringify(Object.keys(row)))
  }
  {
    // An empty alt is a real value, not a missing one, and has to survive the
    // round trip as '' so the reviewer shows "(empty alt text)" rather than a
    // blank card.
    const row = shape(item('fi-0001', { observed_alt: '' }))
    check('an empty alt text survives as an empty string, not null',
      row.observed_alt === '', JSON.stringify(row.observed_alt))
  }
  {
    // The path join that the whole no-copy design rests on.
    const repo = mkdtempSync(join(tmpdir(), 'alt-export-'))
    const imagesDir = join(repo, VALIDATION_PREFIX, 'pool', 'images')
    mkdirSync(imagesDir, { recursive: true })
    writeFileSync(join(imagesDir, 'fi-0001.png'), 'bytes')
    check('an archived image resolves through the corpus-validation prefix',
      checkImages([item('fi-0001')], repo).length === 0,
      JSON.stringify(checkImages([item('fi-0001')], repo)))
    check('a missing image is reported rather than exported',
      checkImages([item('fi-0002')], repo).length === 1)
    rmSync(repo, { recursive: true, force: true })
  }
  {
    const dir = mkdtempSync(join(tmpdir(), 'alt-export-run-'))
    const corpusPath = join(dir, 'corpus.jsonl')
    const outPath = join(dir, 'out.jsonl')
    const imagesDir = join(dir, VALIDATION_PREFIX, 'pool', 'images')
    mkdirSync(imagesDir, { recursive: true })
    writeFileSync(join(imagesDir, 'fi-0001.png'), 'bytes')
    writeFileSync(corpusPath, [
      item('fi-0001'),
      item('fi-0002', { status: 'dropped', alt_quality: 'wrong' }),
    ].map((r) => JSON.stringify(r)).join('\n') + '\n')
    const rc = run(corpusPath, outPath, dir, false, () => {})
    const written = readFileSync(outPath, 'utf8').trim().split('\n')
    check('only the ready items reach the validation corpus',
      rc === 0 && written.length === 1 &&
      JSON.parse(written[0]).id === 'fi-0001',
      `rc ${rc}, ${written.length} line(s)`)
    rmSync(dir, { recursive: true, force: true })
  }
  {
    // Exporting an item whose bytes are gone would put an empty frame in front
    // of a person and ask them to judge alt text against it.
    const dir = mkdtempSync(join(tmpdir(), 'alt-export-gap-'))
    const corpusPath = join(dir, 'corpus.jsonl')
    const outPath = join(dir, 'out.jsonl')
    writeFileSync(corpusPath, JSON.stringify(item('fi-0001')) + '\n')
    const rc = run(corpusPath, outPath, dir, false, () => {})
    check('an item with no bytes on disk stops the export',
      rc === 2 && !existsSync(outPath), `rc ${rc}`)
    rmSync(dir, { recursive: true, force: true })
  }

  process.stdout.write(failures === 0
    ? '\nexport self-test passed\n'
    : `\nexport self-test failed, ${failures} case(s)\n`)
  return failures === 0 ? 0 : 3
}

// --- entry point -----------------------------------------------------------

function tally(items, field) {
  const counts = new Map()
  for (const item of items) counts.set(item[field], (counts.get(item[field]) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
}

function run(corpusPath, outPath, repoRoot, dryRun, out) {
  const corpus = readJsonl(corpusPath)
  if (corpus.errors.length > 0) {
    out('refused to export:\n')
    for (const e of corpus.errors) out(`  ${e}\n`)
    return 2
  }

  const ready = corpus.rows.filter(exportable)
  const counts = {
    total: corpus.rows.length,
    unreviewed: corpus.rows.filter((r) => r.status === 'unreviewed').length,
    dropped: corpus.rows.filter((r) => r.status === 'dropped').length,
    held: corpus.rows.filter((r) => r.status === 'ready' &&
      r.alt_quality !== 'good').length,
  }
  out(`corpus:      ${counts.total} item(s)\n`)
  out(`unreviewed:  ${counts.unreviewed}\n`)
  out(`dropped:     ${counts.dropped}\n`)
  if (counts.held > 0) {
    out(`held back:   ${counts.held} ready but the shipped alt is not good\n`)
  }
  out(`exporting:   ${ready.length}\n`)

  if (ready.length === 0) {
    out('\nNothing is ready to export. Review a batch first: ' +
      './run.sh --prompt review\n')
    return 1
  }

  const missing = checkImages(ready, repoRoot)
  if (missing.length > 0) {
    out(`\nrefused to export, ${missing.length} item(s) have no archived ` +
      'image where corpus-validation looks for it. Nothing was written:\n')
    for (const m of missing) out(`  ${m}\n`)
    out('\nRun node tools/fetch-images.mjs, then export again.\n')
    return 2
  }

  out('\nby sector\n')
  for (const [k, n] of tally(ready, 'sector')) {
    out(`  ${String(n).padStart(4)}  ${k}\n`)
  }
  out('by sub-type\n')
  for (const [k, n] of tally(ready, 'subtype')) {
    out(`  ${String(n).padStart(4)}  ${k}\n`)
  }

  if (dryRun) {
    out('\nnothing written, --dry-run\n')
    return 0
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, ready.map((r) => JSON.stringify(shape(r))).join('\n') + '\n')
  out(`\nwrote ${ready.length} item(s) to ` +
    `${outPath.replace(repoRoot + '/', '')}\n`)
  out('Serve the repository root over HTTP and open ' +
    'projects/corpus-validation/index.html to review them.\n')
  return 0
}

function main(argv) {
  let corpusPath = join(PROJECT, 'corpus', 'functional-images.jsonl')
  let outPath = join(REPO, 'projects', 'corpus-validation',
    'functional-images.jsonl')
  let dryRun = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--selftest') return selftest()
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--corpus') corpusPath = resolve(argv[++i] ?? '')
    else if (arg === '--out') outPath = resolve(argv[++i] ?? '')
    else {
      process.stderr.write(`export.mjs: unknown argument "${arg}"\n` +
        'usage: export.mjs [--dry-run] [--corpus FILE] [--out FILE] ' +
        '[--selftest]\n')
      return 3
    }
  }
  return run(corpusPath, outPath, REPO, dryRun, (s) => process.stdout.write(s))
}

process.exit(main(process.argv.slice(2)))
