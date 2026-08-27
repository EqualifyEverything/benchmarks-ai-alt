#!/usr/bin/env node
// Apply a review round's verdicts to the corpus, mechanically.
//
// The seeking agent may not promote its own items and the reviewer may not edit
// the corpus. Something has to move an item from candidate to accepted, and it
// must not be a judgment call: this does it, from the review records only.
//
//   accept  -> accepted
//   revise  -> needs-revision
//   reject  -> rejected
//
// Usage:
//   node tools/apply-verdicts.mjs --round 3
//   node tools/apply-verdicts.mjs --round 3 --dry-run
//   node tools/apply-verdicts.mjs --selftest
//
// Exit codes: 0 applied, 1 nothing to apply, 2 refused because the round's
// records are unusable, 3 bad usage or self-test failure.

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')

const VERDICT_STATUS = {
  accept: 'accepted',
  revise: 'needs-revision',
  reject: 'rejected',
}

// An accepted item must still satisfy the rules the schema puts on acceptance.
// The reviewer can be wrong; these are not negotiable, so a bad promotion is
// refused here rather than surfacing as a schema error later.
function blocksAcceptance(item) {
  if (item.leaky === true) return 'the item is marked leaky'
  const passes = Array.isArray(item.gold_alt_passes) ? item.gold_alt_passes : []
  const adjudicated = typeof item.adjudication === 'string' &&
    item.adjudication.trim() !== ''
  if (passes.length < 2 && !adjudicated) {
    return 'the item has a single gold standard pass and no adjudication'
  }
  return null
}

function readJsonl(path) {
  const rows = []
  const errors = []
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    return { rows, errors: [`${path}: cannot be read, ${e.code ?? e.message}`] }
  }
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (line === '') return
    try {
      rows.push(JSON.parse(line))
    } catch (e) {
      errors.push(`${path}:${i + 1}: invalid JSON, ${e.message}`)
    }
  })
  return { rows, errors }
}

function apply(corpusPath, reviewPath, round) {
  const notes = []
  const corpus = readJsonl(corpusPath)
  const review = readJsonl(reviewPath)
  const errors = [...corpus.errors, ...review.errors]
  if (errors.length > 0) return { errors, notes, changed: 0, lines: null }

  const byId = new Map()
  for (const item of corpus.rows) {
    if (typeof item.id === 'string') byId.set(item.id, item)
  }

  const verdicts = new Map()
  for (const rec of review.rows) {
    if (rec.round !== round) {
      errors.push(`${reviewPath}: record for ${rec.item_id} says round ` +
        `${rec.round}, expected ${round}`)
      continue
    }
    if (!(rec.verdict in VERDICT_STATUS)) {
      errors.push(`${reviewPath}: unknown verdict "${rec.verdict}" for ` +
        `${rec.item_id}`)
      continue
    }
    if (!byId.has(rec.item_id)) {
      errors.push(`${reviewPath}: no corpus item ${rec.item_id}`)
      continue
    }
    // A later record for the same item in the same round wins, so a reviewer
    // that revisits an item does not leave the outcome ambiguous.
    verdicts.set(rec.item_id, rec.verdict)
  }
  if (errors.length > 0) return { errors, notes, changed: 0, lines: null }

  let changed = 0
  for (const [id, verdict] of verdicts) {
    const item = byId.get(id)
    const want = VERDICT_STATUS[verdict]
    if (want === 'accepted') {
      const blocker = blocksAcceptance(item)
      if (blocker) {
        errors.push(`${id}: cannot be accepted because ${blocker}`)
        continue
      }
    }
    if (item.status !== want) {
      notes.push(`${id}: ${item.status} -> ${want}`)
      item.status = want
      changed++
    }
  }
  if (errors.length > 0) return { errors, notes, changed: 0, lines: null }

  const lines = corpus.rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
  return { errors, notes, changed, lines }
}

function selftest() {
  let failures = 0
  const dir = mkdtempSync(join(tmpdir(), 'alt-apply-'))
  const corpusPath = join(dir, 'corpus.jsonl')
  const reviewPath = join(dir, 'review.jsonl')

  const item = (id, over) => ({
    id, status: 'candidate', leaky: false, adjudication: null,
    gold_alt_passes: [{ author: 'a', alt: 'x', rationale: 'r' },
      { author: 'b', alt: 'x', rationale: 'r' }],
    ...over,
  })
  const write = (path, rows) => writeFileSync(path,
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n')

  const check = (name, cond, detail) => {
    if (cond) process.stdout.write(`PASS ${name}\n`)
    else { process.stdout.write(`FAIL ${name}: ${detail}\n`); failures++ }
  }

  // Verdicts map to statuses.
  write(corpusPath, [item('fi-0001'), item('fi-0002'), item('fi-0003')])
  write(reviewPath, [
    { item_id: 'fi-0001', round: 1, verdict: 'accept' },
    { item_id: 'fi-0002', round: 1, verdict: 'revise' },
    { item_id: 'fi-0003', round: 1, verdict: 'reject' },
  ])
  let r = apply(corpusPath, reviewPath, 1)
  const statuses = r.lines === null ? [] : r.lines.trim().split('\n')
    .map((l) => JSON.parse(l).status)
  check('verdicts map to statuses',
    r.errors.length === 0 &&
    statuses.join(',') === 'accepted,needs-revision,rejected',
    `${r.errors.join('; ')} statuses ${statuses.join(',')}`)

  // A leaky item is never promoted, however the reviewer voted.
  write(corpusPath, [item('fi-0001', { leaky: true })])
  write(reviewPath, [{ item_id: 'fi-0001', round: 1, verdict: 'accept' }])
  r = apply(corpusPath, reviewPath, 1)
  check('refuses to accept a leaky item',
    r.errors.length === 1 && r.errors[0].includes('leaky'),
    r.errors.join('; ') || 'no error raised')

  // A single-pass item is never promoted without an adjudication.
  write(corpusPath, [item('fi-0001',
    { gold_alt_passes: [{ author: 'a', alt: 'x', rationale: 'r' }] })])
  write(reviewPath, [{ item_id: 'fi-0001', round: 1, verdict: 'accept' }])
  r = apply(corpusPath, reviewPath, 1)
  check('refuses to accept a single-pass item',
    r.errors.length === 1 && r.errors[0].includes('single gold standard pass'),
    r.errors.join('; ') || 'no error raised')

  // Round mismatch is refused rather than applied to the wrong round.
  write(corpusPath, [item('fi-0001')])
  write(reviewPath, [{ item_id: 'fi-0001', round: 2, verdict: 'accept' }])
  r = apply(corpusPath, reviewPath, 1)
  check('refuses a round mismatch',
    r.errors.length === 1 && r.errors[0].includes('expected 1'),
    r.errors.join('; ') || 'no error raised')

  // An unknown item id is refused.
  write(corpusPath, [item('fi-0001')])
  write(reviewPath, [{ item_id: 'fi-9999', round: 1, verdict: 'accept' }])
  r = apply(corpusPath, reviewPath, 1)
  check('refuses an unknown item id',
    r.errors.length === 1 && r.errors[0].includes('fi-9999'),
    r.errors.join('; ') || 'no error raised')

  // Nothing is written when any record is refused: all or nothing.
  check('refusal writes nothing', r.lines === null && r.changed === 0,
    `changed ${r.changed}`)

  // Re-applying the same round is a no-op.
  write(corpusPath, [item('fi-0001', { status: 'accepted' })])
  write(reviewPath, [{ item_id: 'fi-0001', round: 1, verdict: 'accept' }])
  r = apply(corpusPath, reviewPath, 1)
  check('re-applying is idempotent', r.errors.length === 0 && r.changed === 0,
    `changed ${r.changed}, errors ${r.errors.join('; ')}`)

  rmSync(dir, { recursive: true, force: true })
  process.stdout.write(failures === 0
    ? '\napply-verdicts self-test passed\n'
    : `\napply-verdicts self-test failed, ${failures} case(s)\n`)
  return failures === 0 ? 0 : 3
}

function main(argv) {
  let round = null
  let dryRun = false
  let corpusPath = join(PROJECT, 'corpus', 'functional-images.jsonl')
  let roundsDir = join(PROJECT, 'rounds')

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--selftest') return selftest()
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--round') round = Number(argv[++i])
    else if (arg === '--corpus') corpusPath = resolve(argv[++i] ?? '')
    else if (arg === '--rounds') roundsDir = resolve(argv[++i] ?? '')
    else {
      process.stderr.write(`apply-verdicts.mjs: unknown argument "${arg}"\n` +
        'usage: apply-verdicts.mjs --round N [--dry-run] [--corpus FILE] ' +
        '[--rounds DIR]\n')
      return 3
    }
  }

  if (!Number.isInteger(round) || round < 1) {
    process.stderr.write('apply-verdicts.mjs: --round needs a whole number of ' +
      '1 or more\n')
    return 3
  }

  const reviewPath = join(roundsDir,
    `round-${String(round).padStart(2, '0')}-review.jsonl`)
  if (!existsSync(corpusPath)) {
    process.stdout.write(`no corpus at ${corpusPath}, nothing to apply\n`)
    return 1
  }
  if (!existsSync(reviewPath)) {
    process.stdout.write(`no review records at ${reviewPath}, nothing to apply\n`)
    return 1
  }

  const { errors, notes, changed, lines } = apply(corpusPath, reviewPath, round)
  if (errors.length > 0) {
    process.stdout.write(`refused to apply round ${round}:\n`)
    for (const e of errors) process.stdout.write(`  ${e}\n`)
    process.stdout.write('\nNo corpus changes were written. Fix the review ' +
      'records, then apply again.\n')
    return 2
  }

  for (const n of notes) process.stdout.write(`  ${n}\n`)
  if (changed === 0) {
    process.stdout.write(`round ${round}: no status changes needed\n`)
    return 0
  }
  if (dryRun) {
    process.stdout.write(`round ${round}: ${changed} status changes, not ` +
      'written, --dry-run\n')
    return 0
  }
  writeFileSync(corpusPath, lines)
  process.stdout.write(`round ${round}: ${changed} status changes written\n`)
  return 0
}

process.exit(main(process.argv.slice(2)))
