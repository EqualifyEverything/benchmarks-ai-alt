#!/usr/bin/env node
// Turn a batch of review verdicts into item statuses.
//
// The reviewing agent never edits the corpus. It writes verdicts to
// review/batch-NN.jsonl and this tool applies them. That separation is the only
// thing that makes the review auditable: the reason a given item is in or out of
// the corpus is a line in a batch file, written before anyone knew the outcome,
// rather than an edit nobody can trace.
//
// A batch applies all or nothing. A half-applied batch leaves the corpus in a
// state no file describes.
//
// Statuses written here and nowhere else:
//   ready      kept, and the alt text the site shipped is good. Goes to humans.
//   dropped    everything else, with the reason kept as evidence.
//
// There is no third outcome. An item whose alt text is weak or wrong is dropped
// rather than held, because this corpus pairs images with descriptions worth
// scoring against, and `alt_quality` on the record preserves which it was.
//
// Usage:
//   node tools/apply-review.mjs 3                 apply review/batch-03.jsonl
//   node tools/apply-review.mjs 3 --dry-run       report, write nothing
//   node tools/apply-review.mjs --selftest        offline
//   --corpus FILE, --reviews DIR                  work somewhere else
//
// Exit codes: 0 applied, 1 nothing to apply, 2 refused, 3 bad usage or
// self-test failure.

import { readFileSync, writeFileSync, existsSync, mkdtempSync,
  rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')

const VERDICTS = ['keep', 'drop']
const QUALITIES = ['good', 'weak', 'wrong']

// Sub-type to category, so a corrected sub-type cannot leave the category behind
// contradicting it.
export const CATEGORY_OF = {
  'linked-standalone-logo': 1,
  'standalone-navigational-link': 1,
  'form-control-or-image-button': 2,
  'action-or-toggle-icon': 2,
  'functional-non-unicode-emoji': 3,
  'linked-complex-graphic-or-image-map': 4,
  'structural-break-or-reader-control': 5,
}

const isStr = (v) => typeof v === 'string' && v.trim() !== ''

function readJsonl(path) {
  if (!existsSync(path)) return { rows: [], errors: [`${path}: not found`] }
  const rows = []
  const errors = []
  readFileSync(path, 'utf8').split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (line === '') return
    try { rows.push({ line: i + 1, value: JSON.parse(line) }) } catch (e) {
      errors.push(`${path}:${i + 1}: invalid JSON, ${e.message}`)
    }
  })
  return { rows, errors }
}

const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

// Every check that can refuse a batch. Collected rather than thrown, so one run
// reports everything wrong with a batch instead of the first thing.
export function checkBatch(verdicts, corpus, batch) {
  const problems = []
  const byId = new Map(corpus.map((item) => [item.id, item]))
  const seen = new Set()

  for (const { line, value: v } of verdicts) {
    const at = `batch-${String(batch).padStart(2, '0')}.jsonl:${line}`
    if (!isStr(v.item_id)) {
      problems.push(`${at}: no \`item_id\``)
      continue
    }
    if (seen.has(v.item_id)) {
      problems.push(`${at}: ${v.item_id} is reviewed twice in this batch`)
    }
    seen.add(v.item_id)

    const item = byId.get(v.item_id)
    if (item === undefined) {
      problems.push(`${at}: ${v.item_id} is not in the corpus`)
      continue
    }
    if (item.status !== 'unreviewed') {
      problems.push(`${at}: ${v.item_id} is already ${item.status}, and a ` +
        'reviewed item is not reviewed again')
    }
    if (!VERDICTS.includes(v.verdict)) {
      problems.push(`${at}: \`verdict\` must be ${VERDICTS.join(' or ')}, not ` +
        JSON.stringify(v.verdict))
    }
    if (!QUALITIES.includes(v.alt_quality)) {
      problems.push(`${at}: \`alt_quality\` must be one of ` +
        `${QUALITIES.join(', ')}, not ${JSON.stringify(v.alt_quality)}`)
    }
    if (!isStr(v.reason) || v.reason.trim().length < 20) {
      problems.push(`${at}: \`reason\` must be at least 20 characters, so the ` +
        'decision is reviewable by someone who was not here')
    }
    if (v.subtype !== null && v.subtype !== undefined &&
        !(v.subtype in CATEGORY_OF)) {
      problems.push(`${at}: \`subtype\` is not one of the seven, ` +
        JSON.stringify(v.subtype))
    }
    // The combination that would quietly put bad alt text in front of a human as
    // though it were good.
    if (v.verdict === 'keep' && v.alt_quality !== 'good') {
      problems.push(`${at}: ${v.item_id} is kept with \`alt_quality\` ` +
        `${JSON.stringify(v.alt_quality)}. Only good alt text is kept, because ` +
        'the shipped alt is the reference. Use `drop`.')
    }
    if (v.verdict === 'keep' && !isStr(item.image_file)) {
      problems.push(`${at}: ${v.item_id} has no archived image, so there is ` +
        'nothing for a person to look at. Run node tools/fetch-images.mjs.')
    }
  }

  return problems
}

export function applyBatch(verdicts, corpus, batch) {
  const problems = checkBatch(verdicts, corpus, batch)
  if (problems.length > 0) return { problems, applied: 0, rows: corpus }

  const byId = new Map(corpus.map((item) => [item.id, item]))
  const counts = { ready: 0, dropped: 0 }
  for (const { value: v } of verdicts) {
    const item = byId.get(v.item_id)
    item.review_verdict = v.verdict
    item.review_reason = v.reason.trim()
    item.alt_quality = v.alt_quality
    if (isStr(v.subtype) && v.subtype !== item.subtype) {
      item.subtype = v.subtype
      item.category = CATEGORY_OF[v.subtype]
    }
    item.status = v.verdict === 'keep' ? 'ready' : 'dropped'
    counts[item.status]++
  }
  return { problems, applied: verdicts.length, rows: corpus, counts }
}

// --- self-test -------------------------------------------------------------

function selftest() {
  let failures = 0
  const check = (name, cond, detail) => {
    if (cond) process.stdout.write(`PASS ${name}\n`)
    else { process.stdout.write(`FAIL ${name}: ${detail ?? ''}\n`); failures++ }
  }
  const item = (id, over = {}) => ({
    id, status: 'unreviewed', subtype: 'action-or-toggle-icon', category: 2,
    image_file: `pool/images/${id}.png`, image_sha256: 'a'.repeat(64),
    observed_alt: 'Settings', accessible_name: 'Settings',
    review_verdict: null, review_reason: null, alt_quality: null, ...over,
  })
  const v = (over = {}) => ({
    line: 1,
    value: {
      item_id: 'fi-0001', verdict: 'keep', alt_quality: 'good',
      reason: 'Opened the icon and confirmed it names the action.',
      subtype: null, ...over,
    },
  })

  {
    const corpus = [item('fi-0001')]
    const r = applyBatch([v()], corpus, 1)
    check('a kept item with good alt becomes ready',
      r.problems.length === 0 && corpus[0].status === 'ready' &&
      corpus[0].alt_quality === 'good' &&
      corpus[0].review_reason.startsWith('Opened the icon'),
      JSON.stringify(r.problems) + JSON.stringify(corpus[0].status))
  }
  {
    const corpus = [item('fi-0001')]
    const r = applyBatch([v({ verdict: 'drop', alt_quality: 'wrong' })], corpus, 1)
    check('a dropped item keeps its reason as evidence',
      r.problems.length === 0 && corpus[0].status === 'dropped' &&
      corpus[0].alt_quality === 'wrong',
      JSON.stringify(r.problems))
  }
  {
    const corpus = [item('fi-0001')]
    const r = applyBatch([v({ subtype: 'linked-standalone-logo' })], corpus, 1)
    check('a corrected sub-type brings its category with it',
      r.problems.length === 0 && corpus[0].subtype === 'linked-standalone-logo' &&
      corpus[0].category === 1,
      `${corpus[0].subtype} / ${corpus[0].category}`)
  }
  // The refusals. Each one is a way a batch could quietly corrupt the corpus.
  {
    const corpus = [item('fi-0001')]
    const r = applyBatch([v({ alt_quality: 'weak' })], corpus, 1)
    check('keeping an item with weak alt text is refused',
      r.problems.length === 1 && r.problems[0].includes('Only good alt text') &&
      corpus[0].status === 'unreviewed',
      JSON.stringify(r.problems))
  }
  {
    const corpus = [item('fi-0001', { image_file: null })]
    const r = applyBatch([v()], corpus, 1)
    check('keeping an item with no archived image is refused',
      r.problems.length === 1 && r.problems[0].includes('no archived image'),
      JSON.stringify(r.problems))
  }
  {
    const corpus = [item('fi-0001', { status: 'ready' })]
    const r = applyBatch([v()], corpus, 1)
    check('re-reviewing a decided item is refused',
      r.problems.some((p) => p.includes('already ready')),
      JSON.stringify(r.problems))
  }
  {
    const corpus = [item('fi-0001')]
    const r = applyBatch([v(), { line: 2, value: v().value }], corpus, 1)
    check('the same item twice in one batch is refused',
      r.problems.some((p) => p.includes('reviewed twice')),
      JSON.stringify(r.problems))
  }
  {
    const corpus = [item('fi-0001')]
    const r = applyBatch([v({ item_id: 'fi-9999' })], corpus, 1)
    check('a verdict for an item not in the corpus is refused',
      r.problems.some((p) => p.includes('not in the corpus')),
      JSON.stringify(r.problems))
  }
  {
    const corpus = [item('fi-0001')]
    const r = applyBatch([v({ reason: 'looks fine' })], corpus, 1)
    check('a reason too short to audit is refused',
      r.problems.some((p) => p.includes('20 characters')),
      JSON.stringify(r.problems))
  }
  {
    const corpus = [item('fi-0001'), item('fi-0002')]
    const r = applyBatch([v(), { line: 2, value: { ...v().value,
      item_id: 'fi-0002', verdict: 'nope' } }], corpus, 1)
    check('one bad verdict stops the whole batch',
      r.applied === 0 && corpus[0].status === 'unreviewed' &&
      corpus[1].status === 'unreviewed',
      `applied ${r.applied}, ${corpus[0].status}`)
  }

  // End to end on disk, because the all-or-nothing write is the part that can
  // lose data.
  {
    const dir = mkdtempSync(join(tmpdir(), 'alt-review-'))
    const corpusPath = join(dir, 'corpus.jsonl')
    const reviews = join(dir, 'review')
    mkdirSync(reviews)
    writeFileSync(corpusPath, toJsonl([item('fi-0001'), item('fi-0002')]))
    writeFileSync(join(reviews, 'batch-01.jsonl'), toJsonl([
      v().value,
      { ...v().value, item_id: 'fi-0002', verdict: 'drop', alt_quality: 'wrong',
        reason: 'The alt text names the file, not the action it performs.' },
    ]))
    const rc = run(1, corpusPath, reviews, false, () => {})
    const after = readFileSync(corpusPath, 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l))
    check('a batch on disk is applied to every item at once',
      rc === 0 && after[0].status === 'ready' && after[1].status === 'dropped',
      `rc ${rc}, ${after.map((a) => a.status).join(' ')}`)
    rmSync(dir, { recursive: true, force: true })
  }

  process.stdout.write(failures === 0
    ? '\napply-review self-test passed\n'
    : `\napply-review self-test failed, ${failures} case(s)\n`)
  return failures === 0 ? 0 : 3
}

// --- entry point -----------------------------------------------------------

function run(batch, corpusPath, reviewsDir, dryRun, out) {
  const nn = String(batch).padStart(2, '0')
  const batchPath = join(reviewsDir, `batch-${nn}.jsonl`)

  const corpus = readJsonl(corpusPath)
  if (corpus.errors.length > 0) {
    out('refused to apply:\n')
    for (const e of corpus.errors) out(`  ${e}\n`)
    return 2
  }
  const verdicts = readJsonl(batchPath)
  if (verdicts.errors.length > 0) {
    out('refused to apply:\n')
    for (const e of verdicts.errors) out(`  ${e}\n`)
    return 2
  }
  if (verdicts.rows.length === 0) {
    out(`${batchPath} holds no verdicts, so nothing was applied.\n`)
    return 1
  }

  const rows = corpus.rows.map(({ value }) => value)
  const { problems, applied, counts } = applyBatch(verdicts.rows, rows, batch)
  if (problems.length > 0) {
    out(`refused to apply batch ${nn}, ${problems.length} problem(s). Nothing ` +
      'was written:\n')
    for (const p of problems) out(`  ${p}\n`)
    return 2
  }
  if (dryRun) {
    out(`batch ${nn}: ${applied} verdict(s) would be applied, ` +
      `${counts.ready} ready, ${counts.dropped} dropped. Nothing written, ` +
      '--dry-run\n')
    return 0
  }
  writeFileSync(corpusPath, toJsonl(rows))
  out(`batch ${nn}: ${applied} verdict(s) applied, ${counts.ready} ready, ` +
    `${counts.dropped} dropped\n`)
  const left = rows.filter((r) => r.status === 'unreviewed').length
  out(left > 0
    ? `${left} item(s) still unreviewed. Next: ./run.sh --prompt review\n`
    : 'Every item is reviewed. Next: ./run.sh --export\n')
  return 0
}

function main(argv) {
  let corpusPath = join(PROJECT, 'corpus', 'functional-images.jsonl')
  let reviewsDir = join(PROJECT, 'review')
  let batch = null
  let dryRun = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--selftest') return selftest()
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--corpus') corpusPath = resolve(argv[++i] ?? '')
    else if (arg === '--reviews') reviewsDir = resolve(argv[++i] ?? '')
    else if (/^\d+$/.test(arg)) batch = Number(arg)
    else {
      process.stderr.write(`apply-review.mjs: unknown argument "${arg}"\n` +
        'usage: apply-review.mjs N [--dry-run] [--corpus FILE] [--reviews DIR] ' +
        '[--selftest]\n')
      return 3
    }
  }
  if (batch === null) {
    process.stderr.write('apply-review.mjs: which batch? usage: ' +
      'apply-review.mjs N\n')
    return 3
  }
  return run(batch, corpusPath, reviewsDir, dryRun,
    (s) => process.stdout.write(s))
}

process.exit(main(process.argv.slice(2)))
