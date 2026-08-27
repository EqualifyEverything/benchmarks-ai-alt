#!/usr/bin/env node
// Move a round's items through a blind second gold standard pass.
//
// Directive 00 requires two independent gold standards per accepted item, and
// independent means the second is authored without reading the first. A single
// agent turn cannot do that: whatever it wrote a moment ago is still in front of
// it. So the second pass is its own turn, and this tool is the wall between the
// two.
//
//   --extract  write rounds/round-NN-second-pass-input.jsonl, holding the page
//              context of every item that still has one pass, and nothing else.
//              No gold standard, no rationale, no difficulty label, no observed
//              alt verdict. What the second-pass agent sees is what a reader of
//              the page would see.
//   --apply    merge rounds/round-NN-second-pass.jsonl back into the corpus as a
//              second pass, and say which items now disagree.
//
// A disagreement is the useful outcome, not a failure. It means the two passes
// were really independent, and it blocks acceptance until a later round records
// an adjudication.
//
// Usage:
//   node tools/second-pass.mjs --extract --round 2
//   node tools/second-pass.mjs --apply --round 2 [--dry-run]
//   node tools/second-pass.mjs --selftest
//
// Exit codes: 0 done, 1 nothing to do, 2 refused because the round's records are
// unusable, 3 bad usage or self-test failure.

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')

// The only fields that cross the wall. An allowlist, so a field added to the
// item schema later cannot leak into the second pass by default. `item_id` is
// here because the pass has to be attributable; everything else is context a
// person looking at the page would have.
// `image_file` is the local copy, named after the item, so it lets the second
// pass look at the image even if the page has changed and it gives away nothing:
// the file name is the item id, not the site's own name for the image.
const CONTEXT_FIELDS = ['item_id', 'page_url', 'image_url', 'image_file',
  'implementation', 'element_role', 'element_html', 'surrounding_text',
  'destination']

// Items in these statuses are still in play. A rejected item is not worth a
// second pass, and an accepted one already has what it needs.
const IN_PLAY = ['candidate', 'needs-revision']

const PASS_FIELDS = ['item_id', 'alt', 'rationale']
const MIN_RATIONALE_CHARS = 20
const MAX_ALT_CHARS = 125
const SECOND_PASS_AUTHOR = 'pass-b'

const isStr = (v) => typeof v === 'string'
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// Does this item still owe a second pass? An adjudication settles the question
// on its own, so an adjudicated item is left alone.
function needsSecondPass(item) {
  if (!IN_PLAY.includes(item.status)) return false
  if (item.leaky === true) return false
  if (isStr(item.adjudication) && item.adjudication.trim() !== '') return false
  const passes = Array.isArray(item.gold_alt_passes)
    ? item.gold_alt_passes.filter(isObj) : []
  return passes.length < 2
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
      rows.push({ line: i + 1, value: JSON.parse(line) })
    } catch (e) {
      errors.push(`${path}:${i + 1}: invalid JSON, ${e.message}`)
    }
  })
  return { rows, errors }
}

function toJsonl(rows) {
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
}

// --- extract ---------------------------------------------------------------

function extract(corpusPath) {
  const { rows, errors } = readJsonl(corpusPath)
  if (errors.length > 0) return { errors, records: [] }
  const records = []
  for (const { value: item } of rows) {
    if (!needsSecondPass(item)) continue
    const out = {}
    for (const field of CONTEXT_FIELDS) {
      out[field] = field === 'item_id' ? item.id : (item[field] ?? null)
    }
    records.push(out)
  }
  return { errors, records }
}

// --- apply -----------------------------------------------------------------

function apply(corpusPath, inputPath, passPath) {
  const notes = []
  const corpus = readJsonl(corpusPath)
  const input = readJsonl(inputPath)
  const passes = readJsonl(passPath)
  const errors = [...corpus.errors, ...input.errors, ...passes.errors]
  if (errors.length > 0) {
    return { errors, notes, changed: 0, agreed: 0, disagreed: [], lines: null }
  }

  const byId = new Map()
  for (const { value: item } of corpus.rows) {
    if (isStr(item.id)) byId.set(item.id, item)
  }
  // The round's own input file is the record of what was asked for. A pass for
  // an item that was never extracted did not come from this turn, so it cannot
  // be treated as blind.
  const asked = new Set(input.rows.map(({ value }) => value.item_id).filter(isStr))

  const wanted = new Map()
  for (const { line, value: rec } of passes.rows) {
    const where = `${passPath}:${line}`
    const id = isStr(rec.item_id) ? rec.item_id : `line ${line}`
    for (const key of Object.keys(rec)) {
      if (!PASS_FIELDS.includes(key)) {
        errors.push(`${where}: ${id} has unknown field \`${key}\``)
      }
    }
    if (!isStr(rec.item_id)) {
      errors.push(`${where}: \`item_id\` must be a string`)
      continue
    }
    if (!byId.has(rec.item_id)) {
      errors.push(`${where}: no corpus item ${rec.item_id}`)
      continue
    }
    if (!asked.has(rec.item_id)) {
      errors.push(`${where}: ${rec.item_id} is not in ${inputPath}, so this ` +
        'pass was not authored from the extracted context')
      continue
    }
    if (!isStr(rec.alt)) {
      errors.push(`${where}: ${rec.item_id}: \`alt\` must be a string, empty ` +
        'for alt=""')
      continue
    }
    if (rec.alt.length > MAX_ALT_CHARS) {
      errors.push(`${where}: ${rec.item_id}: \`alt\` is ${rec.alt.length} ` +
        `characters, over the ${MAX_ALT_CHARS} guidance`)
      continue
    }
    if (!isStr(rec.rationale) ||
        rec.rationale.trim().length < MIN_RATIONALE_CHARS) {
      errors.push(`${where}: ${rec.item_id}: \`rationale\` must be at least ` +
        `${MIN_RATIONALE_CHARS} characters saying which criterion it rests on`)
      continue
    }
    // A later record for the same item wins, so an agent that revisits an item
    // does not leave two answers on the floor.
    wanted.set(rec.item_id, rec)
  }
  if (errors.length > 0) {
    return { errors, notes, changed: 0, agreed: 0, disagreed: [], lines: null }
  }

  let changed = 0
  let agreed = 0
  const disagreed = []
  for (const [id, rec] of wanted) {
    const item = byId.get(id)
    const existing = Array.isArray(item.gold_alt_passes)
      ? item.gold_alt_passes.filter(isObj) : []
    if (existing.length >= 2) {
      notes.push(`${id}: already has ${existing.length} passes, left alone`)
      continue
    }
    item.gold_alt_passes = [...existing,
      { author: SECOND_PASS_AUTHOR, alt: rec.alt, rationale: rec.rationale }]
    changed++
    const first = existing[0]
    if (first && isStr(first.alt) && first.alt !== rec.alt) {
      disagreed.push(id)
      notes.push(`${id}: passes disagree, "${first.alt}" then "${rec.alt}"`)
    } else {
      agreed++
      notes.push(`${id}: second pass agrees`)
    }
  }

  const lines = toJsonl(corpus.rows.map(({ value }) => value))
  return { errors, notes, changed, agreed, disagreed, lines }
}

// --- self-test -------------------------------------------------------------

function selftest() {
  let failures = 0
  const dir = mkdtempSync(join(tmpdir(), 'alt-second-'))
  const corpusPath = join(dir, 'corpus.jsonl')
  const inputPath = join(dir, 'input.jsonl')
  const passPath = join(dir, 'pass.jsonl')

  const item = (id, over) => ({
    id, status: 'candidate', leaky: false, adjudication: null,
    page_url: 'https://example.com/page', domain: 'example.com',
    image_url: 'https://example.com/i.svg', implementation: 'img',
    element_role: 'link', element_html: '<a href="/"><img src="/i.svg"></a>',
    surrounding_text: '', destination: 'The home page',
    observed_alt: null, observed_alt_verdict: 'missing',
    gold_alt: 'Home', gold_alt_rationale: 'Names the destination of the link.',
    gold_alt_passes: [{ author: 'pass-a', alt: 'Home', rationale: 'r' }],
    difficulty: 'standard', dual_purpose: false,
    ...over,
  })
  const write = (path, rows) => writeFileSync(path, toJsonl(rows))
  const check = (name, cond, detail) => {
    if (cond) process.stdout.write(`PASS ${name}\n`)
    else { process.stdout.write(`FAIL ${name}: ${detail}\n`); failures++ }
  }
  const goodRationale = 'Adjacent text already names the destination.'

  // Extraction carries the context and nothing that hints at the first answer.
  write(corpusPath, [item('fi-0001')])
  let e = extract(corpusPath)
  const record = e.records[0] ?? {}
  const leaked = Object.keys(record).filter((k) => !CONTEXT_FIELDS.includes(k))
  const serialised = JSON.stringify(record)
  check('extract carries context only',
    e.errors.length === 0 && e.records.length === 1 && leaked.length === 0 &&
    !serialised.includes('gold') && !serialised.includes('difficulty') &&
    !serialised.includes('observed'),
    `leaked ${leaked.join(', ') || 'nothing'} in ${serialised}`)

  check('extract carries every context field',
    CONTEXT_FIELDS.every((f) => f in record),
    `missing ${CONTEXT_FIELDS.filter((f) => !(f in record)).join(', ')}`)

  // Items that cannot use a second pass are skipped.
  write(corpusPath, [
    item('fi-0001', { status: 'accepted' }),
    item('fi-0002', { status: 'rejected' }),
    item('fi-0003', { leaky: true }),
    item('fi-0004', { adjudication: 'Resolved in favour of the empty pass.' }),
    item('fi-0005', {
      gold_alt_passes: [{ author: 'pass-a', alt: 'Home', rationale: 'r' },
        { author: 'pass-b', alt: 'Home', rationale: 'r' }],
    }),
    item('fi-0006'),
  ])
  e = extract(corpusPath)
  check('extract skips items that do not need a pass',
    e.records.length === 1 && e.records[0].item_id === 'fi-0006',
    `extracted ${e.records.map((r) => r.item_id).join(', ') || 'nothing'}`)

  // An agreeing pass is merged and counted as agreement.
  write(corpusPath, [item('fi-0001')])
  write(inputPath, [{ item_id: 'fi-0001' }])
  write(passPath, [{ item_id: 'fi-0001', alt: 'Home', rationale: goodRationale }])
  let r = apply(corpusPath, inputPath, passPath)
  let merged = r.lines === null ? null : JSON.parse(r.lines.trim().split('\n')[0])
  check('an agreeing pass is merged',
    r.errors.length === 0 && r.changed === 1 && r.agreed === 1 &&
    merged.gold_alt_passes.length === 2 &&
    merged.gold_alt_passes[1].author === SECOND_PASS_AUTHOR,
    r.errors.join('; ') || JSON.stringify(merged?.gold_alt_passes))

  // A disagreeing pass is merged too, and reported. It blocks acceptance in
  // apply-verdicts.mjs rather than being discarded here.
  write(corpusPath, [item('fi-0001')])
  write(passPath, [{ item_id: 'fi-0001', alt: '', rationale: goodRationale }])
  r = apply(corpusPath, inputPath, passPath)
  merged = r.lines === null ? null : JSON.parse(r.lines.trim().split('\n')[0])
  check('a disagreeing pass is kept and reported',
    r.errors.length === 0 && r.changed === 1 && r.agreed === 0 &&
    r.disagreed.join(',') === 'fi-0001' &&
    merged.gold_alt_passes.length === 2 && merged.gold_alt === 'Home',
    r.errors.join('; ') || `disagreed ${r.disagreed.join(',')}`)

  // A pass for an item the round never extracted is refused: it cannot have
  // been authored blind from this round's context.
  write(corpusPath, [item('fi-0001'), item('fi-0002')])
  write(inputPath, [{ item_id: 'fi-0001' }])
  write(passPath, [{ item_id: 'fi-0002', alt: 'Home', rationale: goodRationale }])
  r = apply(corpusPath, inputPath, passPath)
  check('refuses a pass for an item that was not extracted',
    r.errors.length === 1 && r.errors[0].includes('not in'),
    r.errors.join('; ') || 'no error raised')

  // Nothing is written when any record is refused: all or nothing.
  check('refusal writes nothing', r.lines === null && r.changed === 0,
    `changed ${r.changed}`)

  // A rationale that says nothing is refused, because an unexplained pass
  // cannot be adjudicated later.
  write(corpusPath, [item('fi-0001')])
  write(inputPath, [{ item_id: 'fi-0001' }])
  write(passPath, [{ item_id: 'fi-0001', alt: 'Home', rationale: 'same' }])
  r = apply(corpusPath, inputPath, passPath)
  check('refuses a rationale that explains nothing',
    r.errors.length === 1 && r.errors[0].includes('rationale'),
    r.errors.join('; ') || 'no error raised')

  // An unknown field is refused rather than silently dropped.
  write(passPath, [{ item_id: 'fi-0001', alt: 'Home', rationale: goodRationale,
    confidence: 'high' }])
  r = apply(corpusPath, inputPath, passPath)
  check('refuses an unknown field',
    r.errors.length === 1 && r.errors[0].includes('confidence'),
    r.errors.join('; ') || 'no error raised')

  // Re-applying the same round changes nothing.
  write(corpusPath, [item('fi-0001', {
    gold_alt_passes: [{ author: 'pass-a', alt: 'Home', rationale: 'r' },
      { author: 'pass-b', alt: 'Home', rationale: goodRationale }],
  })])
  write(passPath, [{ item_id: 'fi-0001', alt: 'Home', rationale: goodRationale }])
  r = apply(corpusPath, inputPath, passPath)
  check('re-applying is idempotent',
    r.errors.length === 0 && r.changed === 0,
    `changed ${r.changed}, errors ${r.errors.join('; ')}`)

  rmSync(dir, { recursive: true, force: true })
  process.stdout.write(failures === 0
    ? '\nsecond-pass self-test passed\n'
    : `\nsecond-pass self-test failed, ${failures} case(s)\n`)
  return failures === 0 ? 0 : 3
}

// --- entry point -----------------------------------------------------------

function main(argv) {
  let mode = null
  let round = null
  let dryRun = false
  let corpusPath = join(PROJECT, 'corpus', 'functional-images.jsonl')
  let roundsDir = join(PROJECT, 'rounds')

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--selftest') return selftest()
    else if (arg === '--extract') mode = 'extract'
    else if (arg === '--apply') mode = 'apply'
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--round') round = Number(argv[++i])
    else if (arg === '--corpus') corpusPath = resolve(argv[++i] ?? '')
    else if (arg === '--rounds') roundsDir = resolve(argv[++i] ?? '')
    else {
      process.stderr.write(`second-pass.mjs: unknown argument "${arg}"\n` +
        'usage: second-pass.mjs --extract|--apply --round N [--dry-run] ' +
        '[--corpus FILE] [--rounds DIR]\n')
      return 3
    }
  }

  if (mode === null) {
    process.stderr.write('second-pass.mjs: say --extract or --apply\n')
    return 3
  }
  if (!Number.isInteger(round) || round < 1) {
    process.stderr.write('second-pass.mjs: --round needs a whole number of 1 ' +
      'or more\n')
    return 3
  }

  const nn = String(round).padStart(2, '0')
  const inputPath = join(roundsDir, `round-${nn}-second-pass-input.jsonl`)
  const passPath = join(roundsDir, `round-${nn}-second-pass.jsonl`)

  if (!existsSync(corpusPath)) {
    process.stdout.write(`no corpus at ${corpusPath}, nothing to do\n`)
    return 1
  }

  if (mode === 'extract') {
    const { errors, records } = extract(corpusPath)
    if (errors.length > 0) {
      process.stdout.write('refused to extract:\n')
      for (const e of errors) process.stdout.write(`  ${e}\n`)
      return 2
    }
    if (records.length === 0) {
      process.stdout.write('no items are waiting for a second gold standard ' +
        'pass\n')
      return 1
    }
    if (dryRun) {
      process.stdout.write(`${records.length} item(s) would be extracted, not ` +
        'written, --dry-run\n')
      return 0
    }
    writeFileSync(inputPath, toJsonl(records))
    process.stdout.write(`${records.length} item(s) written to ${inputPath}\n`)
    return 0
  }

  if (!existsSync(inputPath)) {
    process.stdout.write(`no second pass input at ${inputPath}. Run ` +
      '--extract first: the input file is what makes the pass blind.\n')
    return 1
  }
  if (!existsSync(passPath)) {
    process.stdout.write(`no second passes at ${passPath}, nothing to apply\n`)
    return 1
  }

  const { errors, notes, changed, agreed, disagreed, lines } =
    apply(corpusPath, inputPath, passPath)
  if (errors.length > 0) {
    process.stdout.write(`refused to apply round ${round} second passes:\n`)
    for (const e of errors) process.stdout.write(`  ${e}\n`)
    process.stdout.write('\nNo corpus changes were written. Fix the pass ' +
      'records, then apply again.\n')
    return 2
  }

  for (const n of notes) process.stdout.write(`  ${n}\n`)
  if (changed === 0) {
    process.stdout.write(`round ${round}: no second passes to merge\n`)
    return 0
  }
  if (dryRun) {
    process.stdout.write(`round ${round}: ${changed} second pass(es), not ` +
      'written, --dry-run\n')
    return 0
  }
  writeFileSync(corpusPath, lines)
  process.stdout.write(`round ${round}: ${changed} second pass(es) merged, ` +
    `${agreed} agreeing, ${disagreed.length} disagreeing\n`)
  if (disagreed.length > 0) {
    process.stdout.write('Disagreements need an adjudication before those ' +
      'items can be accepted:\n')
    process.stdout.write(`  ${disagreed.join(' ')}\n`)
  }
  return 0
}

process.exit(main(process.argv.slice(2)))
