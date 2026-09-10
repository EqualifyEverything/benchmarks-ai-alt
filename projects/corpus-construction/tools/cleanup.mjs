#!/usr/bin/env node
// Remove archived image bytes that no corpus item needs any more.
//
// The archive exists so a pair stays scoreable after the page it came from
// changes. That reason only applies to pairs the benchmark actually uses. The
// first full run archived 965 images and exported 78, so 887 files were being
// carried for nothing.
//
// Three kinds of file can go, and they are not equally safe to delete:
//
//   reviewed and dropped   The verdict is recorded in review/ with a written
//                          reason, and apply-review.mjs refuses to review a
//                          decided item again. Nothing will ever need these
//                          bytes. Safe.
//   never selected         Shortlisted, downloaded, and never put in front of
//                          a reviewer. These are the cheapest source of more
//                          corpus items, because the bytes are already here.
//                          Deleting them means re-harvesting to grow the
//                          corpus, and pages change in between. Kept unless
//                          you ask for them to go.
//   orphaned               A file in the archive that no record mentions, from
//                          an interrupted download or a since-rewritten pool.
//                          Safe.
//
// So --apply alone deletes the first and third. Add --drop-unselected to take
// the second as well, which is what "only keep what passed" means in full.
//
// It reports and writes nothing unless --apply is passed, because an archive is
// easier to delete than to rebuild.
//
// Every deletion is written to pool/images-removed.txt with its reason, because
// a record still names the file it used to have. Without the log,
// `fetch-images.mjs --verify` reports 887 deliberate deletions as corruption and
// stops being a signal.
//
// One thing this cannot do: the images are already committed. Removing them in
// a later commit does not shrink the repository, because a clone still fetches
// them from history. This keeps the working tree honest and stops the next run
// accumulating; it does not reclaim what is already pushed.
//
// Usage:
//   node tools/cleanup.mjs                    report what would go
//   node tools/cleanup.mjs --apply            delete dropped and orphaned
//   node tools/cleanup.mjs --apply --drop-unselected   delete those too
//   node tools/cleanup.mjs --selftest         offline
//   --pool DIR, --corpus FILE, --shortlist FILE, --log FILE   work elsewhere
//
// Exit codes: 0 done or nothing to do, 2 refused because a file is unusable
// or a needed image is missing, 3 bad usage or self-test failure.

import { readFileSync, readdirSync, existsSync, rmSync, mkdirSync,
  writeFileSync, mkdtempSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')

// A ready item is the only thing whose bytes the benchmark reads. Everything
// else in the corpus is evidence, and evidence lives in the JSONL, not here.
export function keepers(items) {
  const keep = new Set()
  for (const item of items) {
    if (item?.status === 'ready' && typeof item.image_file === 'string') {
      keep.add(basename(item.image_file))
    }
  }
  return keep
}

// Split the archive into what stays and why each file could go. Names only, so
// this is testable without touching a disk.
export function plan(files, items, shortlistIds, dropUnselected) {
  const keep = keepers(items)
  const decided = new Map()
  for (const item of items) {
    if (typeof item?.image_file === 'string') {
      decided.set(basename(item.image_file), item.status)
    }
  }
  // A shortlist row carries no image_file until fetch-images.mjs writes one, so
  // match on the id that names the file instead.
  const shortlisted = new Set(shortlistIds)

  const out = { keep: [], dropped: [], unselected: [], orphaned: [] }
  for (const file of files) {
    if (keep.has(file)) { out.keep.push(file); continue }
    const status = decided.get(file)
    if (status === 'dropped') { out.dropped.push(file); continue }
    const id = file.replace(/\.[^.]+$/, '')
    if (status === undefined && shortlisted.has(id)) {
      out.unselected.push(file)
      continue
    }
    if (status === undefined) { out.orphaned.push(file); continue }
    // status is 'unreviewed': a selected item still waiting on a verdict. Its
    // bytes are exactly what the next review batch renders.
    out.keep.push(file)
  }
  out.remove = out.dropped.concat(out.orphaned)
  if (dropUnselected) out.remove = out.remove.concat(out.unselected)
  return out
}

const LOG_HEADER = [
  '# Images tools/cleanup.mjs has deleted, and why. A record in the corpus or',
  '# the shortlist still names the file it used to have, so without this log',
  '# tools/fetch-images.mjs --verify reads a deliberate deletion as a copy that',
  '# vanished. One file per line: NAME then REASON.',
  '',
].join('\n')

// Parse the log back into a name-to-reason map. Exported so fetch-images.mjs
// reads it the same way this writes it.
export function readRemovalLog(text) {
  const out = new Map()
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    out.set(parts[0], parts[1] ?? 'unknown')
  }
  return out
}

function appendRemovalLog(logPath, entries) {
  const existing = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  const known = readRemovalLog(existing)
  const fresh = entries.filter(([name]) => !known.has(name))
  if (fresh.length === 0) return 0
  const head = existing === '' ? LOG_HEADER : ''
  const body = fresh.map(([name, why]) => `${name}  ${why}`).join('\n') + '\n'
  writeFileSync(logPath, existing + head + body)
  return fresh.length
}

function readJsonl(path, label) {
  if (!existsSync(path)) return { rows: [], errors: [`${path}: not found`] }
  const rows = []
  const errors = []
  const text = readFileSync(path, 'utf8')
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue
    try { rows.push(JSON.parse(line)) }
    catch { errors.push(`${label}:${i + 1}: not valid JSON`) }
  }
  return { rows, errors }
}

function run(opts, out) {
  const { poolDir, corpusPath, shortlistPath, apply, dropUnselected } = opts
  const logPath = opts.logPath ?? join(dirname(poolDir), 'images-removed.txt')

  if (!existsSync(poolDir)) {
    out(`no archive at ${poolDir}, nothing to clean\n`)
    return 0
  }

  const corpus = readJsonl(corpusPath, basename(corpusPath))
  if (corpus.errors.length) {
    for (const e of corpus.errors) out(`refused: ${e}\n`)
    return 2
  }
  // The shortlist is optional: it is gitignored, so a fresh clone has none. Its
  // absence means every unreviewed file reads as orphaned, which would delete
  // downloads a future review needs. Refuse rather than guess.
  let shortlistIds = []
  if (existsSync(shortlistPath)) {
    const short = readJsonl(shortlistPath, basename(shortlistPath))
    if (short.errors.length) {
      for (const e of short.errors) out(`refused: ${e}\n`)
      return 2
    }
    shortlistIds = short.rows.map((r) => r.id)
  } else if (!dropUnselected) {
    out(`refused: no shortlist at ${shortlistPath}\n` +
      'Without it a downloaded candidate cannot be told from an orphan, and\n' +
      'deleting the wrong one means harvesting again. Harvest to rebuild it,\n' +
      'or pass --drop-unselected to say you want both kinds gone.\n')
    return 2
  }

  const files = readdirSync(poolDir).filter((f) => !f.startsWith('.'))
  const p = plan(files, corpus.rows, shortlistIds, dropUnselected)

  out(`archive:     ${files.length} file(s) in ${poolDir}\n`)
  out(`  keep         ${String(p.keep.length).padStart(4)}` +
    '  needed by a ready or unreviewed item\n')
  out(`  dropped      ${String(p.dropped.length).padStart(4)}` +
    '  reviewed and rejected, verdict recorded in review/\n')
  out(`  unselected   ${String(p.unselected.length).padStart(4)}` +
    '  downloaded, never reviewed' +
    (dropUnselected ? ', being deleted\n' : ', kept\n'))
  out(`  orphaned     ${String(p.orphaned.length).padStart(4)}` +
    '  no record mentions them\n')

  if (p.unselected.length && !dropUnselected) {
    out(`\n${p.unselected.length} unselected image(s) are the cheapest source ` +
      'of more corpus\nitems, because the bytes are already here. ' +
      'Pass --drop-unselected to\ndelete them too, accepting that growing ' +
      'the corpus then needs a new harvest.\n')
  }

  if (p.remove.length === 0) {
    out('\nnothing to remove\n')
    return 0
  }

  if (!apply) {
    out(`\nwould remove ${p.remove.length} file(s). ` +
      'Nothing was written. Pass --apply.\n')
    return 0
  }

  // Never delete on a plan that would strand a ready item. Cheap to check, and
  // the failure it prevents is an export that 404s in the reviewer's browser.
  const needed = keepers(corpus.rows)
  const stranded = [...needed].filter((f) => !files.includes(f))
  if (stranded.length) {
    out(`refused: ${stranded.length} ready item(s) already have no archived ` +
      `image, starting with ${stranded[0]}\n` +
      'Fix that before deleting anything else.\n')
    return 2
  }

  const why = new Map()
  for (const file of p.dropped) why.set(file, 'dropped')
  for (const file of p.orphaned) why.set(file, 'orphaned')
  if (dropUnselected) for (const f of p.unselected) why.set(f, 'unselected')

  let removed = 0
  for (const file of p.remove) {
    rmSync(join(poolDir, file))
    removed++
  }
  const logged = appendRemovalLog(logPath,
    p.remove.map((f) => [f, why.get(f) ?? 'unknown']))
  out(`\nremoved ${removed} file(s), ${p.keep.length} kept\n`)
  out(`recorded ${logged} deletion(s) in ${logPath}, so --verify reads them ` +
    'as\ndeliberate rather than as copies that vanished.\n')
  out('The images are already committed, so this does not shrink the ' +
    'repository:\na clone still fetches them from history.\n')
  return 0
}

function selftest() {
  let failures = 0
  const check = (name, cond, detail) => {
    if (cond) process.stdout.write(`PASS ${name}\n`)
    else { process.stdout.write(`FAIL ${name}: ${detail ?? ''}\n`); failures++ }
  }
  const item = (id, status, over = {}) => ({
    id, status, image_file: `pool/images/${id}.png`, ...over,
  })

  {
    const items = [item('fi-0001', 'ready'), item('fi-0002', 'dropped')]
    const k = keepers(items)
    check('only ready items are keepers', k.has('fi-0001.png') &&
      !k.has('fi-0002.png'), [...k].join(' '))
  }
  {
    const items = [item('fi-0001', 'ready'), item('fi-0002', 'dropped'),
      item('fi-0003', 'unreviewed')]
    const files = ['fi-0001.png', 'fi-0002.png', 'fi-0003.png',
      'fi-0004.png', 'fi-0009.png']
    const p = plan(files, items, ['fi-0001', 'fi-0002', 'fi-0003', 'fi-0004'],
      false)
    check('a dropped item is removed', p.dropped.includes('fi-0002.png'))
    check('an unreviewed item is kept, its batch has not run yet',
      p.keep.includes('fi-0003.png'), p.keep.join(' '))
    check('a shortlisted but unselected download is kept by default',
      p.unselected.includes('fi-0004.png') &&
      !p.remove.includes('fi-0004.png'), p.remove.join(' '))
    check('a file no record mentions is an orphan',
      p.orphaned.includes('fi-0009.png'), p.orphaned.join(' '))
    check('the default removal is dropped plus orphaned',
      p.remove.length === 2 && p.remove.includes('fi-0002.png') &&
      p.remove.includes('fi-0009.png'), p.remove.join(' '))
  }
  {
    const items = [item('fi-0001', 'ready'), item('fi-0002', 'dropped')]
    const p = plan(['fi-0001.png', 'fi-0002.png', 'fi-0004.png'], items,
      ['fi-0004'], true)
    check('--drop-unselected also removes the untouched downloads',
      p.remove.length === 2 && p.remove.includes('fi-0004.png'),
      p.remove.join(' '))
    check('a ready image is never in the removal list',
      !p.remove.includes('fi-0001.png'))
  }
  {
    // An inline SVG is archived as .svg while the record says .svg too, and a
    // sniffed JPEG lands as .jpg. Matching on the whole basename covers both.
    const items = [item('fi-0001', 'ready', { image_file: 'pool/images/fi-0001.svg' })]
    const p = plan(['fi-0001.svg', 'fi-0001.png'], items, [], true)
    check('the extension is part of the match, not guessed',
      p.keep.includes('fi-0001.svg') && p.remove.includes('fi-0001.png'),
      JSON.stringify(p))
  }

  // End to end on a real directory, because the whole point is deleting files.
  {
    const dir = mkdtempSync(join(tmpdir(), 'cleanup-'))
    const poolDir = join(dir, 'images')
    mkdirSync(poolDir)
    for (const f of ['fi-0001.png', 'fi-0002.png', 'fi-0004.png',
      'fi-0009.png']) writeFileSync(join(poolDir, f), 'x')
    const corpusPath = join(dir, 'corpus.jsonl')
    writeFileSync(corpusPath, [item('fi-0001', 'ready'),
      item('fi-0002', 'dropped')].map((i) => JSON.stringify(i)).join('\n') + '\n')
    const shortlistPath = join(dir, 'shortlist.jsonl')
    writeFileSync(shortlistPath,
      JSON.stringify({ id: 'fi-0004' }) + '\n')

    let text = ''
    const opts = { poolDir, corpusPath, shortlistPath, apply: false,
      dropUnselected: false }
    let rc = run(opts, (s) => { text += s })
    check('a report writes nothing', rc === 0 &&
      readdirSync(poolDir).length === 4 && text.includes('Nothing was written'),
      text)

    text = ''
    rc = run({ ...opts, apply: true }, (s) => { text += s })
    const left = readdirSync(poolDir).sort()
    check('--apply removes dropped and orphaned, keeps the rest',
      rc === 0 && left.join(' ') === 'fi-0001.png fi-0004.png',
      left.join(' ') + ' | ' + text)

    text = ''
    rc = run({ ...opts, apply: true, dropUnselected: true },
      (s) => { text += s })
    check('--drop-unselected takes the untouched download too',
      rc === 0 && readdirSync(poolDir).join(' ') === 'fi-0001.png',
      readdirSync(poolDir).join(' ') + ' | ' + text)

    {
      const log = readRemovalLog(readFileSync(join(dir, 'images-removed.txt'),
        'utf8'))
      check('every deletion is logged with its reason',
        log.get('fi-0002.png') === 'dropped' &&
        log.get('fi-0009.png') === 'orphaned' &&
        log.get('fi-0004.png') === 'unselected' && log.size === 3,
        [...log].map((e) => e.join('=')).join(' '))
      check('a kept image is never in the log', !log.has('fi-0001.png'))
    }

    text = ''
    rc = run({ ...opts, apply: true }, (s) => { text += s })
    check('running again is not an error', rc === 0 &&
      text.includes('nothing to remove'), text)

    // A ready item whose bytes are already gone must stop the run, not get
    // quietly deleted around.
    rmSync(join(poolDir, 'fi-0001.png'))
    writeFileSync(join(poolDir, 'fi-0009.png'), 'x')
    text = ''
    rc = run({ ...opts, apply: true }, (s) => { text += s })
    check('a ready item with no archived image refuses the whole run',
      rc === 2 && existsSync(join(poolDir, 'fi-0009.png')), text)

    rmSync(dir, { recursive: true, force: true })
  }
  {
    const dir = mkdtempSync(join(tmpdir(), 'cleanup-'))
    const poolDir = join(dir, 'images')
    mkdirSync(poolDir)
    writeFileSync(join(poolDir, 'fi-0004.png'), 'x')
    const corpusPath = join(dir, 'corpus.jsonl')
    writeFileSync(corpusPath, '')
    let text = ''
    const rc = run({ poolDir, corpusPath,
      shortlistPath: join(dir, 'missing.jsonl'), apply: true,
      dropUnselected: false }, (s) => { text += s })
    check('a missing shortlist refuses rather than calling downloads orphans',
      rc === 2 && existsSync(join(poolDir, 'fi-0004.png')), text)
    rmSync(dir, { recursive: true, force: true })
  }

  process.stdout.write(failures === 0
    ? '\ncleanup self-test passed\n'
    : `\ncleanup self-test failed, ${failures} failure(s)\n`)
  return failures === 0 ? 0 : 3
}

function main(argv) {
  const opts = {
    poolDir: join(PROJECT, 'pool', 'images'),
    corpusPath: join(PROJECT, 'corpus', 'functional-images.jsonl'),
    shortlistPath: join(PROJECT, 'pool', 'shortlist.jsonl'),
    apply: false,
    dropUnselected: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--selftest') return selftest()
    else if (arg === '--apply') opts.apply = true
    else if (arg === '--drop-unselected') opts.dropUnselected = true
    else if (arg === '--pool') opts.poolDir = resolve(argv[++i] ?? '')
    else if (arg === '--corpus') opts.corpusPath = resolve(argv[++i] ?? '')
    else if (arg === '--shortlist') opts.shortlistPath = resolve(argv[++i] ?? '')
    else if (arg === '--log') opts.logPath = resolve(argv[++i] ?? '')
    else {
      process.stderr.write(`cleanup.mjs: unknown argument "${arg}"\n` +
        'usage: cleanup.mjs [--apply] [--drop-unselected] [--pool DIR] ' +
        '[--corpus FILE] [--shortlist FILE] [--log FILE] [--selftest]\n')
      return 3
    }
  }
  return run(opts, (s) => process.stdout.write(s))
}

process.exit(main(process.argv.slice(2)))
