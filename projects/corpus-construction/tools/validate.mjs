#!/usr/bin/env node
// Validate the functional image corpus and report progress against the
// acceptance criteria in directives/00-corpus-goals.md.
//
// Usage, from anywhere:
//   node tools/validate.mjs                 validate corpus/functional-images.jsonl
//   node tools/validate.mjs --json          machine readable report on stdout
//   node tools/validate.mjs --corpus FILE   validate a different corpus file
//   node tools/validate.mjs --rounds DIR    read review reports from DIR
//   node tools/validate.mjs --target 100    goal of 100 accepted items
//   node tools/validate.mjs --selftest      run the fixture self-test
//
// The target is the number of accepted items the run is working toward. It
// comes from --target, else from corpus/target.txt, else the 250-item v0.1
// corpus in directive 00. Count targets scale with it; shares do not.
//
// Exit codes:
//   0  corpus is schema clean and every acceptance criterion is met
//   1  corpus is schema clean but not yet complete
//   2  schema errors, or the corpus file is missing
//   3  bad usage, or the self-test failed
//
// No dependencies. Plain text in, plain text out.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync,
  rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')

// ---------------------------------------------------------------------------
// Schema, mirroring corpus/README.md. Keep the two in step.
// ---------------------------------------------------------------------------

const SUBTYPES = {
  'linked-standalone-logo': 1,
  'standalone-navigational-link': 1,
  'form-control-or-image-button': 2,
  'action-or-toggle-icon': 2,
  'functional-non-unicode-emoji': 3,
  'linked-complex-graphic-or-image-map': 4,
  'structural-break-or-reader-control': 5,
}

const STATUSES = ['candidate', 'accepted', 'needs-revision', 'rejected']
const IMPLEMENTATIONS = ['img', 'inline-svg', 'icon-font', 'sprite',
  'css-background', 'input-image', 'area']
const IMPLEMENTATIONS_NEEDING_URL = ['img', 'sprite', 'css-background',
  'input-image', 'area']
const ROLES = ['link', 'button', 'input-image', 'area', 'custom', 'glyph']
const OBSERVED_VERDICTS = ['correct', 'wrong', 'missing', 'empty-appropriate',
  'empty-inappropriate']
const DIFFICULTIES = ['trivial', 'standard', 'ambiguous']

const REQUIRED = ['id', 'status', 'round_added', 'category', 'subtype',
  'page_url', 'domain', 'image_url', 'implementation', 'element_role',
  'element_html', 'surrounding_text', 'destination', 'observed_alt',
  'observed_alt_verdict', 'gold_alt', 'gold_alt_rationale', 'gold_alt_passes',
  'adjudication', 'difficulty', 'dual_purpose', 'leakage_check', 'leaky',
  'retrieved', 'provenance_note']
const OPTIONAL = ['notes']

const REASON_CODES = ['CLEAN', 'UNVERIFIABLE-SOURCE', 'CONTEXT-INACCURATE',
  'NOT-FUNCTIONAL', 'MISCLASSIFIED', 'APPEARANCE-DESCRIPTION',
  'REDUNDANCY-MISSED', 'WRONGLY-EMPTY', 'REDUNDANT-STARTER', 'TOO-VERBOSE',
  'ASSUMPTION', 'NO-RATIONALE', 'LEAKAGE', 'NON-DISCRIMINATING', 'DUPLICATE',
  'MISSING-FIELD', 'NO-SECOND-PASS', 'LICENSE-UNCLEAR']

const REVIEW_REQUIRED = ['item_id', 'round', 'verdict', 'reason_codes',
  'evidence', 'required_change', 'blocking']
const VERDICTS = ['accept', 'revise', 'reject']

// Targets from directives/00-corpus-goals.md. The full v0.1 corpus is 250
// accepted items, and the count targets below are stated for that size.
const BASELINE = {
  total: 250,
  perCategory: 30,
  perSubtype: 20,
  domainsPerSubtype: 8,
}

// A run may stipulate a smaller corpus. Count targets scale with it, so a
// 100-item goal keeps the same shape as a 250-item one instead of turning into
// 100 items of whatever was easiest to find. Shares are ratios and do not
// scale. The floors keep a small corpus from degenerating: a sub-type
// represented by one item, or drawn from one domain, measures that item rather
// than the sub-type.
function targetsFor(total) {
  const k = total / BASELINE.total
  const at = (base, floor) => Math.max(floor, Math.round(base * k))
  return {
    total,
    perCategory: at(BASELINE.perCategory, 4),
    perSubtype: at(BASELINE.perSubtype, 3),
    domainsPerSubtype: at(BASELINE.domainsPerSubtype, 3),
    emptyAltShare: 0.15,
    dualPurposeShare: 0.10,
    ambiguousShare: 0.20,
    maxDomainShare: 0.05,
    cleanItemShare: 0.95,
    quietRounds: 2,
  }
}

// Reassigned by main() once the run's target is known.
let TARGETS = targetsFor(BASELINE.total)

// Below this, the floors above collide: seven sub-types at three items each
// already needs 21, and a corpus with no slack over its own minimums cannot
// satisfy the share targets as well.
const MIN_TARGET = 25

// The stipulated goal, one integer on the first line that is not a comment.
// Kept in the corpus directory and committed, so every tool and every round
// agrees on what the run is working toward, and a change to the goal shows up
// in the history rather than in someone's shell.
function readTargetFile(path) {
  if (!existsSync(path)) return { value: null }
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (!/^\d+$/.test(line)) {
      return { error: `${path}: expected one whole number, found "${line}"` }
    }
    return { value: Number(line) }
  }
  return { error: `${path}: no target found in the file` }
}

const REDUNDANT_STARTERS = ['link to', 'links to', 'button for', 'button to',
  'icon of', 'icon for', 'image of', 'graphic of', 'picture of', 'go to link']
const MAX_ALT_CHARS = 125
const MIN_RATIONALE_CHARS = 40
const MIN_LEAKAGE_CHARS = 20
const MIN_EVIDENCE_CHARS = 20

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isStr = (v) => typeof v === 'string'
const isBool = (v) => typeof v === 'boolean'
const isInt = (v) => Number.isInteger(v)
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// Where an item stands on the two-independent-passes rule in directive 00.
//
//   one-pass     only the first pass exists, so directives/02-second-pass.md
//                has not run over it yet
//   disagreeing  a second pass exists and differs, which is the interesting
//                case and needs an adjudication before acceptance
//   settled      two agreeing passes, or a recorded adjudication
//
// Only `settled` items can be accepted. The other two are ordinary states for a
// candidate, and counting them is how the loop knows what it still owes.
function passState(rec) {
  if (isStr(rec.adjudication) && rec.adjudication.trim() !== '') return 'settled'
  const passes = Array.isArray(rec.gold_alt_passes)
    ? rec.gold_alt_passes.filter(isObj) : []
  if (passes.length < 2) return 'one-pass'
  return new Set(passes.map((p) => p.alt).filter(isStr)).size > 1
    ? 'disagreeing' : 'settled'
}

function isHttpUrl(v) {
  if (!isStr(v)) return false
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function readJsonl(path) {
  const errors = []
  const rows = []
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    errors.push(`${path}: cannot be read, ${e.code ?? e.message}`)
    return { rows, errors }
  }
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (line === '') return
    try {
      const value = JSON.parse(line)
      if (!isObj(value)) {
        errors.push(`${path}:${i + 1}: line is not a JSON object`)
        return
      }
      rows.push({ line: i + 1, value })
    } catch (e) {
      errors.push(`${path}:${i + 1}: invalid JSON, ${e.message}`)
    }
  })
  return { rows, errors }
}

const pct = (n, d) => (d === 0 ? 0 : n / d)
const fmtPct = (x) => `${(x * 100).toFixed(1)}%`

// ---------------------------------------------------------------------------
// Item validation
// ---------------------------------------------------------------------------

function validateItem(rec, line, seenIds, path) {
  const errs = []
  const bad = (msg) => errs.push(`${path}:${line}: ${msg}`)
  const id = isStr(rec.id) ? rec.id : `line ${line}`

  for (const field of REQUIRED) {
    if (!(field in rec)) bad(`${id}: missing required field \`${field}\``)
  }
  for (const key of Object.keys(rec)) {
    if (!REQUIRED.includes(key) && !OPTIONAL.includes(key)) {
      bad(`${id}: unknown field \`${key}\``)
    }
  }

  if (!isStr(rec.id) || !/^fi-\d{4}$/.test(rec.id)) {
    bad(`${id}: \`id\` must match fi-0000`)
  } else if (seenIds.has(rec.id)) {
    bad(`${id}: duplicate \`id\`, first seen on line ${seenIds.get(rec.id)}`)
  } else {
    seenIds.set(rec.id, line)
  }

  if (!STATUSES.includes(rec.status)) {
    bad(`${id}: \`status\` must be one of ${STATUSES.join(', ')}`)
  }
  if (!isInt(rec.round_added) || rec.round_added < 1) {
    bad(`${id}: \`round_added\` must be an integer of 1 or more`)
  }
  if (!isInt(rec.category) || rec.category < 1 || rec.category > 5) {
    bad(`${id}: \`category\` must be an integer 1 through 5`)
  }
  if (!(rec.subtype in SUBTYPES)) {
    bad(`${id}: \`subtype\` must be one of ${Object.keys(SUBTYPES).join(', ')}`)
  } else if (SUBTYPES[rec.subtype] !== rec.category) {
    bad(`${id}: \`subtype\` ${rec.subtype} belongs to category ` +
      `${SUBTYPES[rec.subtype]}, not ${rec.category}`)
  }

  if (!isHttpUrl(rec.page_url)) bad(`${id}: \`page_url\` must be an http URL`)
  const host = hostOf(rec.page_url)
  if (!isStr(rec.domain) || rec.domain === '') {
    bad(`${id}: \`domain\` must be a non-empty string`)
  } else if (host && rec.domain !== host) {
    bad(`${id}: \`domain\` is "${rec.domain}" but \`page_url\` host is "${host}"`)
  }

  if (!IMPLEMENTATIONS.includes(rec.implementation)) {
    bad(`${id}: \`implementation\` must be one of ${IMPLEMENTATIONS.join(', ')}`)
  }
  if (IMPLEMENTATIONS_NEEDING_URL.includes(rec.implementation)) {
    if (!isHttpUrl(rec.image_url)) {
      bad(`${id}: \`image_url\` must be an http URL for ` +
        `${rec.implementation} implementations`)
    }
  } else if (rec.image_url !== null && !isHttpUrl(rec.image_url)) {
    bad(`${id}: \`image_url\` must be an http URL or null`)
  }

  if (!ROLES.includes(rec.element_role)) {
    bad(`${id}: \`element_role\` must be one of ${ROLES.join(', ')}`)
  }
  if (!isStr(rec.element_html) || rec.element_html.trim() === '') {
    bad(`${id}: \`element_html\` must be non-empty verbatim markup`)
  }
  if (!isStr(rec.surrounding_text)) {
    bad(`${id}: \`surrounding_text\` must be a string, empty if none`)
  }
  if (!isStr(rec.destination) || rec.destination.trim() === '') {
    bad(`${id}: \`destination\` must be non-empty`)
  }

  if (rec.observed_alt !== null && !isStr(rec.observed_alt)) {
    bad(`${id}: \`observed_alt\` must be a string or null`)
  }
  if (!OBSERVED_VERDICTS.includes(rec.observed_alt_verdict)) {
    bad(`${id}: \`observed_alt_verdict\` must be one of ` +
      OBSERVED_VERDICTS.join(', '))
  }
  if (rec.observed_alt === null && rec.observed_alt_verdict !== 'missing') {
    bad(`${id}: \`observed_alt\` is null so \`observed_alt_verdict\` must be ` +
      `"missing"`)
  }

  if (!isStr(rec.gold_alt)) {
    bad(`${id}: \`gold_alt\` must be a string, empty for alt=""`)
  } else {
    if (rec.gold_alt.length > MAX_ALT_CHARS) {
      bad(`${id}: \`gold_alt\` is ${rec.gold_alt.length} characters, over the ` +
        `${MAX_ALT_CHARS} guidance`)
    }
    const lower = rec.gold_alt.trim().toLowerCase()
    for (const starter of REDUNDANT_STARTERS) {
      if (lower.startsWith(starter)) {
        bad(`${id}: \`gold_alt\` starts with the redundant starter "${starter}"`)
        break
      }
    }
  }
  if (!isStr(rec.gold_alt_rationale) ||
      rec.gold_alt_rationale.trim().length < MIN_RATIONALE_CHARS) {
    bad(`${id}: \`gold_alt_rationale\` must be at least ` +
      `${MIN_RATIONALE_CHARS} characters`)
  }

  if (!Array.isArray(rec.gold_alt_passes) || rec.gold_alt_passes.length < 1) {
    bad(`${id}: \`gold_alt_passes\` must be an array of one or more passes`)
  } else {
    rec.gold_alt_passes.forEach((p, i) => {
      if (!isObj(p)) {
        bad(`${id}: \`gold_alt_passes[${i}]\` must be an object`)
        return
      }
      for (const f of ['author', 'alt', 'rationale']) {
        if (!isStr(p[f])) bad(`${id}: \`gold_alt_passes[${i}].${f}\` must be a string`)
      }
      for (const key of Object.keys(p)) {
        if (!['author', 'alt', 'rationale'].includes(key)) {
          bad(`${id}: \`gold_alt_passes[${i}]\` has unknown field \`${key}\``)
        }
      }
    })
    const alts = new Set(rec.gold_alt_passes
      .filter(isObj).map((p) => p.alt).filter(isStr))
    const settled = isStr(rec.adjudication) && rec.adjudication.trim() !== ''
    // A second pass that disagrees with the first is a normal state for a
    // candidate, and the whole point of authoring it blind. The disagreement is
    // a finding, not a defect, and the next round resolves it. Only acceptance
    // requires it settled, which is checked with the other accepted-item rules
    // below and refused by tools/apply-verdicts.mjs.
    if (alts.size > 1 && !settled && rec.status === 'accepted') {
      bad(`${id}: passes disagree, so \`adjudication\` is required`)
    }
    if (isStr(rec.gold_alt) && alts.size > 0 && !alts.has(rec.gold_alt) &&
        !settled) {
      bad(`${id}: \`gold_alt\` matches no pass and there is no adjudication`)
    }
  }
  if (rec.adjudication !== null && !isStr(rec.adjudication)) {
    bad(`${id}: \`adjudication\` must be a string or null`)
  }

  if (!DIFFICULTIES.includes(rec.difficulty)) {
    bad(`${id}: \`difficulty\` must be one of ${DIFFICULTIES.join(', ')}`)
  }
  if (!isBool(rec.dual_purpose)) bad(`${id}: \`dual_purpose\` must be a boolean`)
  if (!isBool(rec.leaky)) bad(`${id}: \`leaky\` must be a boolean`)
  if (!isStr(rec.leakage_check) ||
      rec.leakage_check.trim().length < MIN_LEAKAGE_CHARS) {
    bad(`${id}: \`leakage_check\` must be at least ${MIN_LEAKAGE_CHARS} characters`)
  }
  if (!isStr(rec.retrieved) || !/^\d{4}-\d{2}-\d{2}$/.test(rec.retrieved) ||
      Number.isNaN(Date.parse(rec.retrieved))) {
    bad(`${id}: \`retrieved\` must be a real date as YYYY-MM-DD`)
  }
  if (!isStr(rec.provenance_note) || rec.provenance_note.trim() === '') {
    bad(`${id}: \`provenance_note\` must be non-empty`)
  }
  if ('notes' in rec && !isStr(rec.notes)) {
    bad(`${id}: \`notes\` must be a string when present`)
  }

  // Rules that only bind accepted items.
  if (rec.status === 'accepted') {
    if (rec.leaky === true) {
      bad(`${id}: a leaky item cannot be \`accepted\``)
    }
    if (Array.isArray(rec.gold_alt_passes) && rec.gold_alt_passes.length < 2 &&
        !(isStr(rec.adjudication) && rec.adjudication.trim() !== '')) {
      bad(`${id}: \`accepted\` needs two independent passes, or an adjudication`)
    }
    if (Array.isArray(rec.gold_alt_passes) &&
        new Set(rec.gold_alt_passes.filter(isObj).map((p) => p.alt)
          .filter(isStr)).size > 1 &&
        !(isStr(rec.adjudication) && rec.adjudication.trim() !== '')) {
      bad(`${id}: \`accepted\` with disagreeing passes needs an \`adjudication\``)
    }
  }

  return errs
}

function validateReview(rec, line, path) {
  const errs = []
  const bad = (msg) => errs.push(`${path}:${line}: ${msg}`)
  const id = isStr(rec.item_id) ? rec.item_id : `line ${line}`

  for (const field of REVIEW_REQUIRED) {
    if (!(field in rec)) bad(`${id}: missing required field \`${field}\``)
  }
  for (const key of Object.keys(rec)) {
    if (!REVIEW_REQUIRED.includes(key)) bad(`${id}: unknown field \`${key}\``)
  }
  if (!isStr(rec.item_id) || !/^fi-\d{4}$/.test(rec.item_id)) {
    bad(`${id}: \`item_id\` must match fi-0000`)
  }
  if (!isInt(rec.round) || rec.round < 1) {
    bad(`${id}: \`round\` must be an integer of 1 or more`)
  }
  if (!VERDICTS.includes(rec.verdict)) {
    bad(`${id}: \`verdict\` must be one of ${VERDICTS.join(', ')}`)
  }
  if (!Array.isArray(rec.reason_codes) || rec.reason_codes.length < 1) {
    bad(`${id}: \`reason_codes\` must list at least one code`)
  } else {
    for (const code of rec.reason_codes) {
      if (!REASON_CODES.includes(code)) {
        bad(`${id}: unknown reason code "${code}"`)
      }
    }
    if (rec.verdict === 'accept' &&
        !(rec.reason_codes.length === 1 && rec.reason_codes[0] === 'CLEAN')) {
      bad(`${id}: an \`accept\` verdict takes exactly the code CLEAN`)
    }
    if (rec.verdict !== 'accept' && rec.reason_codes.includes('CLEAN')) {
      bad(`${id}: CLEAN is only valid on an \`accept\` verdict`)
    }
  }
  if (!isStr(rec.evidence) || rec.evidence.trim().length < MIN_EVIDENCE_CHARS) {
    bad(`${id}: \`evidence\` must be at least ${MIN_EVIDENCE_CHARS} characters`)
  }
  if (rec.verdict === 'revise') {
    if (!isStr(rec.required_change) || rec.required_change.trim() === '') {
      bad(`${id}: a \`revise\` verdict needs \`required_change\``)
    }
  } else if (rec.required_change !== null) {
    bad(`${id}: \`required_change\` must be null unless the verdict is revise`)
  }
  if (!isBool(rec.blocking)) bad(`${id}: \`blocking\` must be a boolean`)
  // An accept means no blocking defect was found. The combination would promote
  // the item and hold it in the 95 percent criterion at the same time, which no
  // later round can resolve because accepted items are not re-reviewed.
  else if (rec.verdict === 'accept' && rec.blocking === true) {
    bad(`${id}: an \`accept\` verdict cannot also be \`blocking\``)
  }

  return errs
}

// ---------------------------------------------------------------------------
// Round reports: the two-quiet-rounds gate
// ---------------------------------------------------------------------------

const STATUS_LINE = /^STATUS:\s*new-blocking-findings=(yes|no)\s*$/m

// Round number out of a file name, so ordering is numeric. Sorting these names
// as strings puts round-10 before round-9, which would make the two-quiet-rounds
// gate read the wrong pair of reports.
const roundNumber = (name) => Number(name.match(/^round-(\d+)-/)[1])

function roundFiles(dir, pattern) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((n) => pattern.test(n))
    .sort((a, b) => roundNumber(a) - roundNumber(b))
}

function readRounds(roundsDir) {
  const reports = []
  const errors = []
  if (!existsSync(roundsDir)) return { reports, errors }
  const names = roundFiles(roundsDir, /^round-\d+-report\.md$/)
  for (const name of names) {
    let text
    try {
      text = readFileSync(join(roundsDir, name), 'utf8')
    } catch (e) {
      errors.push(`${join(roundsDir, name)}: cannot be read, ${e.code ?? e.message}`)
      reports.push({ name, newBlocking: null })
      continue
    }
    const m = text.match(STATUS_LINE)
    if (!m) {
      errors.push(`${join(roundsDir, name)}: no ` +
        `"STATUS: new-blocking-findings=yes|no" line, required by directive 02`)
      reports.push({ name, newBlocking: null })
    } else {
      reports.push({ name, newBlocking: m[1] === 'yes' })
    }
  }
  return { reports, errors }
}

// ---------------------------------------------------------------------------
// Acceptance criteria
// ---------------------------------------------------------------------------

function assess(items, reviews, reports) {
  const accepted = items.filter((r) => r.status === 'accepted')
  const total = accepted.length
  const criteria = []
  const add = (name, met, detail) => criteria.push({ name, met, detail })

  add('total accepted items', total >= TARGETS.total,
    `${total} of ${TARGETS.total}`)

  const catCounts = {}
  for (let c = 1; c <= 5; c++) catCounts[c] = 0
  const subCounts = {}
  for (const s of Object.keys(SUBTYPES)) subCounts[s] = 0
  const subDomains = {}
  for (const s of Object.keys(SUBTYPES)) subDomains[s] = new Set()
  const domainCounts = {}
  for (const r of accepted) {
    if (r.category in catCounts) catCounts[r.category]++
    if (r.subtype in subCounts) {
      subCounts[r.subtype]++
      subDomains[r.subtype].add(r.domain)
    }
    domainCounts[r.domain] = (domainCounts[r.domain] || 0) + 1
  }

  const thinCats = Object.entries(catCounts)
    .filter(([, n]) => n < TARGETS.perCategory)
  add('per category minimum', thinCats.length === 0,
    thinCats.length === 0
      ? `all five categories at ${TARGETS.perCategory} or more`
      : thinCats.map(([c, n]) => `category ${c}: ${n}`).join(', '))

  const thinSubs = Object.entries(subCounts)
    .filter(([, n]) => n < TARGETS.perSubtype)
  add('per sub-type minimum', thinSubs.length === 0,
    thinSubs.length === 0
      ? `all seven sub-types at ${TARGETS.perSubtype} or more`
      : thinSubs.map(([s, n]) => `${s}: ${n}`).join(', '))

  const emptyAlt = accepted.filter((r) => r.gold_alt === '').length
  add('empty-alt share', pct(emptyAlt, total) >= TARGETS.emptyAltShare,
    `${emptyAlt} items, ${fmtPct(pct(emptyAlt, total))} of ` +
    `${fmtPct(TARGETS.emptyAltShare)}`)

  const dual = accepted.filter((r) => r.dual_purpose === true).length
  add('dual-purpose share', pct(dual, total) >= TARGETS.dualPurposeShare,
    `${dual} items, ${fmtPct(pct(dual, total))} of ` +
    `${fmtPct(TARGETS.dualPurposeShare)}`)

  const ambiguous = accepted.filter((r) => r.difficulty === 'ambiguous').length
  add('ambiguous share', pct(ambiguous, total) >= TARGETS.ambiguousShare,
    `${ambiguous} items, ${fmtPct(pct(ambiguous, total))} of ` +
    `${fmtPct(TARGETS.ambiguousShare)}`)

  const overDomains = Object.entries(domainCounts)
    .filter(([, n]) => pct(n, total) > TARGETS.maxDomainShare)
    .sort((a, b) => b[1] - a[1])
  add('domain concentration', total > 0 && overDomains.length === 0,
    total === 0
      ? 'no accepted items yet'
      : overDomains.length === 0
        ? `no domain over ${fmtPct(TARGETS.maxDomainShare)}`
        : overDomains.map(([d, n]) =>
          `${d}: ${n}, ${fmtPct(pct(n, total))}`).join(', '))

  const thinSpread = Object.entries(subDomains)
    .filter(([, set]) => set.size < TARGETS.domainsPerSubtype)
  add('domains per sub-type', thinSpread.length === 0,
    thinSpread.length === 0
      ? `every sub-type spans ${TARGETS.domainsPerSubtype} or more domains`
      : thinSpread.map(([s, set]) => `${s}: ${set.size}`).join(', '))

  const noSecond = accepted.filter((r) => passState(r) !== 'settled').length
  add('two independent passes', noSecond === 0,
    noSecond === 0 ? 'every accepted item has two agreeing passes or an adjudication'
      : `${noSecond} accepted items with a single pass, or disagreeing passes ` +
        'and no adjudication')

  // Blocking findings still open against accepted items. An item's most recent
  // review is the one that counts: a blocking finding stays open until a later
  // round says otherwise, so it cannot age out of the gate just by the corpus
  // moving on to another round.
  const latestRound = reviews.reduce((max, r) =>
    isInt(r.round) && r.round > max ? r.round : max, 0)
  const latestForItem = new Map()
  for (const r of reviews) {
    if (!isStr(r.item_id) || !isInt(r.round)) continue
    const held = latestForItem.get(r.item_id)
    if (held === undefined || r.round >= held.round) latestForItem.set(r.item_id, r)
  }
  const blockedIds = new Set(accepted
    .filter((item) => latestForItem.get(item.id)?.blocking === true)
    .map((item) => item.id))
  const clean = total - blockedIds.size
  add('items clean in latest review',
    total > 0 && latestRound >= 1 && pct(clean, total) >= TARGETS.cleanItemShare,
    total === 0 ? 'no accepted items yet'
      : latestRound === 0
        ? `${total} accepted items but no review round has run`
        : `${clean} of ${total} clean in round ${latestRound}, ` +
          `${fmtPct(pct(clean, total))} of ${fmtPct(TARGETS.cleanItemShare)}`)

  const tail = reports.slice(-TARGETS.quietRounds)
  const quiet = reports.length >= TARGETS.quietRounds &&
    tail.every((r) => r.newBlocking === false)
  add('two consecutive quiet review rounds', quiet,
    reports.length === 0 ? 'no review reports yet'
      : tail.map((r) => `${r.name}: new-blocking-findings=` +
        (r.newBlocking === null ? 'unstated' : r.newBlocking ? 'yes' : 'no'))
        .join(', '))

  const byStatus = {}
  for (const s of STATUSES) byStatus[s] = items.filter((r) => r.status === s).length

  // Not criteria: work owed on items that are still in play. An item with one
  // pass is waiting for the second-pass turn, and one with disagreeing passes is
  // waiting for a seeking agent to adjudicate. Neither blocks the loop, and both
  // block the items themselves, so the loop is told about them every round.
  const inPlay = items.filter((r) =>
    r.status === 'candidate' || r.status === 'needs-revision')
  const pending = {
    secondPass: inPlay.filter((r) => passState(r) === 'one-pass').length,
    adjudication: inPlay.filter((r) => passState(r) === 'disagreeing').length,
  }

  return {
    criteria,
    goalsMet: criteria.every((c) => c.met),
    pending,
    counts: {
      items: items.length,
      byStatus,
      byCategory: catCounts,
      bySubtype: subCounts,
      domains: Object.keys(domainCounts).length,
      reviewRecords: reviews.length,
      reviewRounds: reports.length,
      latestRound,
    },
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printText(report) {
  const { corpusPath, schemaErrors, assessment } = report
  const out = []
  out.push(`corpus: ${corpusPath}`)
  out.push(`goal:   ${TARGETS.total} accepted items` +
    (TARGETS.total === BASELINE.total
      ? ' (the full v0.1 corpus)'
      : `, scaled from ${BASELINE.total}: ${TARGETS.perCategory} per category, ` +
        `${TARGETS.perSubtype} per sub-type, ` +
        `${TARGETS.domainsPerSubtype} domains per sub-type`))
  if (schemaErrors.length > 0) {
    out.push('')
    out.push(`schema errors: ${schemaErrors.length}`)
    for (const e of schemaErrors) out.push(`  ${e}`)
  } else {
    out.push('schema: clean')
  }
  if (assessment) {
    const c = assessment.counts
    out.push('')
    out.push(`items: ${c.items} total, ` + STATUSES
      .map((s) => `${c.byStatus[s]} ${s}`).join(', '))
    out.push(`reviews: ${c.reviewRecords} records across ` +
      `${c.reviewRounds} reported rounds`)
    const p = assessment.pending
    out.push(`pending: ${p.secondPass} item(s) awaiting a second gold standard ` +
      `pass, ${p.adjudication} awaiting adjudication`)
    out.push('')
    out.push('acceptance criteria')
    for (const cr of assessment.criteria) {
      out.push(`  [${cr.met ? 'met' : '  -'}] ${cr.name}: ${cr.detail}`)
    }
    out.push('')
    out.push(assessment.goalsMet
      ? 'GOALS: met. The corpus satisfies every acceptance criterion.'
      : 'GOALS: not met. Keep looping.')
  }
  process.stdout.write(out.join('\n') + '\n')
}

// ---------------------------------------------------------------------------
// Self-test, run against tools/fixtures/
// ---------------------------------------------------------------------------

function selftest() {
  const dir = join(HERE, 'fixtures')
  const cases = [
    ['valid-item.jsonl', 0],
    ['invalid-items.jsonl', 12],
  ]
  let failures = 0
  for (const [name, expected] of cases) {
    const path = join(dir, name)
    if (!existsSync(path)) {
      process.stdout.write(`FAIL ${name}: fixture missing\n`)
      failures++
      continue
    }
    const { rows, errors } = readJsonl(path)
    const seen = new Map()
    const errs = [...errors]
    for (const { line, value } of rows) {
      errs.push(...validateItem(value, line, seen, path))
    }
    const ok = expected === 0 ? errs.length === 0 : errs.length >= expected
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}: ` +
      `${errs.length} errors, expected ${expected === 0 ? '0' : expected + ' or more'}\n`)
    if (!ok) {
      failures++
      for (const e of errs) process.stdout.write(`     ${e}\n`)
    }
  }

  // Review records.
  const reviewPath = join(dir, 'valid-review.jsonl')
  if (existsSync(reviewPath)) {
    const { rows, errors } = readJsonl(reviewPath)
    const errs = [...errors]
    for (const { line, value } of rows) {
      errs.push(...validateReview(value, line, reviewPath))
    }
    const ok = errs.length === 0
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} valid-review.jsonl: ` +
      `${errs.length} errors, expected 0\n`)
    if (!ok) {
      failures++
      for (const e of errs) process.stdout.write(`     ${e}\n`)
    }
  } else {
    process.stdout.write('FAIL valid-review.jsonl: fixture missing\n')
    failures++
  }

  // An accept that also claims to be blocking is incoherent, and would strand
  // the item: promoted, yet permanently counted against the clean criterion.
  const incoherent = validateReview({ item_id: 'fi-0001', round: 1,
    verdict: 'accept', reason_codes: ['CLEAN'], evidence: 'x'.repeat(21),
    required_change: null, blocking: true }, 1, 'inline')
  if (incoherent.some((e) => e.includes('cannot also be'))) {
    process.stdout.write('PASS blocking accept rejected\n')
  } else {
    process.stdout.write('FAIL blocking accept was allowed\n')
    failures++
  }

  // Two passes that disagree are a legal candidate and an illegal accepted item.
  // If a disagreement were a schema error the loop would stop dead the first
  // time a blind second pass did its job, so the rule binds acceptance only.
  const base = JSON.parse(readFileSync(join(dir, 'valid-item.jsonl'), 'utf8')
    .split('\n').filter((l) => l.trim() !== '')[0])
  const split = (over) => ({
    ...base, adjudication: null,
    gold_alt_passes: [
      { author: 'pass-a', alt: base.gold_alt, rationale: 'First pass.' },
      { author: 'pass-b', alt: 'Something else entirely', rationale: 'Second.' },
    ],
    ...over,
  })
  const asCandidate = validateItem(split({ status: 'candidate' }), 1, new Map(), 'inline')
  const asAccepted = validateItem(split({ status: 'accepted' }), 1, new Map(), 'inline')
  const asSettled = validateItem(split({ status: 'accepted',
    adjudication: 'Pass A wins: the adjacent text does not name the destination.',
  }), 1, new Map(), 'inline')
  const states = [passState(split({})), passState({ ...base, gold_alt_passes: [
    { author: 'pass-a', alt: 'x', rationale: 'r' }] }), passState(base)]
  if (asCandidate.length === 0 && asSettled.length === 0 &&
      asAccepted.some((e) => e.includes('disagreeing passes')) &&
      states.join(',') === 'disagreeing,one-pass,settled') {
    process.stdout.write('PASS disagreeing passes block acceptance only\n')
  } else {
    process.stdout.write('FAIL disagreeing passes: candidate ' +
      `[${asCandidate.join('; ')}], accepted [${asAccepted.join('; ')}], ` +
      `adjudicated [${asSettled.join('; ')}], states ${states.join(',')}\n`)
    failures++
  }

  // An empty corpus must not claim the goals are met.
  const empty = assess([], [], [])
  if (empty.goalsMet) {
    process.stdout.write('FAIL empty corpus reported as complete\n')
    failures++
  } else {
    process.stdout.write('PASS empty corpus is not complete\n')
  }

  // An unreviewed item must never satisfy the latest-review criterion.
  const unreviewed = [JSON.parse(readFileSync(join(dir, 'valid-item.jsonl'), 'utf8')
    .split('\n').filter((l) => l.trim() !== '')[1])]
  const reviewCrit = (reviews, reports) => assess(unreviewed, reviews, reports)
    .criteria.find((c) => c.name === 'items clean in latest review').met
  if (reviewCrit([], [])) {
    process.stdout.write('FAIL accepted-but-unreviewed item counted as clean\n')
    failures++
  } else if (!reviewCrit([{ item_id: 'fi-0002', round: 1, verdict: 'accept',
    reason_codes: ['CLEAN'], evidence: 'x'.repeat(21), required_change: null,
    blocking: false }], [])) {
    process.stdout.write('FAIL reviewed clean item not counted as clean\n')
    failures++
  } else {
    process.stdout.write('PASS latest-review criterion needs a review round\n')
  }

  // Reports must be ordered numerically, not lexicographically: with rounds 9,
  // 10 and 11 on disk, the gate has to read 10 and 11 as the latest pair.
  const scratch = mkdtempSync(join(tmpdir(), 'alt-corpus-rounds-'))
  const writeReport = (n, blocking) => writeFileSync(
    join(scratch, `round-${n}-report.md`),
    `stub\n\nSTATUS: new-blocking-findings=${blocking ? 'yes' : 'no'}\n`)
  writeReport(9, true)
  writeReport(10, false)
  writeReport(11, false)
  const ordered = readRounds(scratch).reports.map((r) => r.name)
  const orderOk = ordered.join(',') ===
    'round-9-report.md,round-10-report.md,round-11-report.md'
  const gateAfterOrder = assess([], [], readRounds(scratch).reports)
    .criteria.find((c) => c.name === 'two consecutive quiet review rounds').met
  writeReport(11, true)
  const gateWhenLatestNoisy = assess([], [], readRounds(scratch).reports)
    .criteria.find((c) => c.name === 'two consecutive quiet review rounds').met
  rmSync(scratch, { recursive: true, force: true })
  if (orderOk && gateAfterOrder === true && gateWhenLatestNoisy === false) {
    process.stdout.write('PASS round reports ordered numerically\n')
  } else {
    process.stdout.write(`FAIL round ordering: [${ordered.join(', ')}], ` +
      `gate ${gateAfterOrder}, noisy-latest gate ${gateWhenLatestNoisy}\n`)
    failures++
  }

  // The quiet-rounds gate must need two consecutive quiet rounds.
  const gate = (reports) => assess([], [], reports).criteria
    .find((c) => c.name === 'two consecutive quiet review rounds').met
  const gateCases = [
    [[], false],
    [[{ name: 'r1', newBlocking: false }], false],
    [[{ name: 'r1', newBlocking: false }, { name: 'r2', newBlocking: true }], false],
    [[{ name: 'r1', newBlocking: true }, { name: 'r2', newBlocking: false }], false],
    [[{ name: 'r1', newBlocking: false }, { name: 'r2', newBlocking: false }], true],
    [[{ name: 'r1', newBlocking: false }, { name: 'r2', newBlocking: null }], false],
  ]
  let gateOk = true
  gateCases.forEach(([reports, want], i) => {
    const got = gate(reports)
    if (got !== want) {
      gateOk = false
      process.stdout.write(`FAIL quiet-rounds gate case ${i}: ` +
        `got ${got}, want ${want}\n`)
    }
  })
  if (gateOk) process.stdout.write('PASS quiet-rounds gate\n')
  else failures++

  // Scaled targets must stay reachable. Seven sub-type minimums and five
  // category minimums both have to fit inside the total, or the loop would run
  // to the cap chasing a goal that arithmetic forbids.
  const scaleCases = [BASELINE.total, 200, 100, 50, MIN_TARGET]
  let scaleOk = targetsFor(BASELINE.total).perSubtype === BASELINE.perSubtype &&
    targetsFor(BASELINE.total).perCategory === BASELINE.perCategory
  for (const n of scaleCases) {
    const t = targetsFor(n)
    if (t.perSubtype * 7 > n || t.perCategory * 5 > n ||
      t.domainsPerSubtype > t.perSubtype) {
      scaleOk = false
      process.stdout.write(`FAIL target ${n} scales to unreachable targets: ` +
        `${t.perSubtype} per sub-type, ${t.perCategory} per category, ` +
        `${t.domainsPerSubtype} domains per sub-type\n`)
    }
  }
  if (scaleOk) process.stdout.write('PASS scaled targets stay reachable\n')
  else failures++

  // A malformed target file must stop the run rather than silently reverting to
  // the 250-item goal, which would look like ordinary slow progress.
  const tdir = mkdtempSync(join(tmpdir(), 'alt-corpus-target-'))
  const targetCase = (body) => {
    const p = join(tdir, 'target.txt')
    writeFileSync(p, body)
    return readTargetFile(p)
  }
  const targetOk =
    readTargetFile(join(tdir, 'absent.txt')).value === null &&
    targetCase('# goal for this run\n100\n').value === 100 &&
    targetCase('  100  \n').value === 100 &&
    targetCase('one hundred\n').error !== undefined &&
    targetCase('# only a comment\n').error !== undefined
  rmSync(tdir, { recursive: true, force: true })
  if (targetOk) process.stdout.write('PASS target file read strictly\n')
  else {
    process.stdout.write('FAIL target file parsing\n')
    failures++
  }

  process.stdout.write(failures === 0
    ? '\nself-test passed\n'
    : `\nself-test failed, ${failures} case(s)\n`)
  return failures === 0 ? 0 : 3
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(argv) {
  let corpusPath = join(PROJECT, 'corpus', 'functional-images.jsonl')
  let roundsDir = join(PROJECT, 'rounds')
  let asJson = false
  let targetArg = null

  const needsValue = (arg, value) => {
    if (value === undefined || value.startsWith('--')) {
      process.stderr.write(`validate.mjs: ${arg} needs a path\n`)
      return false
    }
    return true
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--selftest') return selftest()
    else if (arg === '--json') asJson = true
    else if (arg === '--corpus') {
      if (!needsValue(arg, argv[i + 1])) return 3
      corpusPath = resolve(argv[++i])
    } else if (arg === '--rounds') {
      if (!needsValue(arg, argv[i + 1])) return 3
      roundsDir = resolve(argv[++i])
    } else if (arg === '--target') {
      const value = argv[i + 1]
      if (value === undefined || !/^\d+$/.test(value)) {
        process.stderr.write('validate.mjs: --target needs a whole number of ' +
          `accepted items, ${MIN_TARGET} or more\n`)
        return 3
      }
      targetArg = Number(value)
      i++
    } else {
      process.stderr.write(`validate.mjs: unknown argument "${arg}"\n` +
        'usage: validate.mjs [--json] [--corpus FILE] [--rounds DIR] ' +
        '[--target N] [--selftest]\n')
      return 3
    }
  }

  // Precedence: the flag, then the committed target file, then directive 00.
  let target = targetArg
  if (target === null) {
    const fromFile = readTargetFile(join(dirname(corpusPath), 'target.txt'))
    if (fromFile.error) {
      process.stderr.write(`validate.mjs: ${fromFile.error}\n`)
      return 3
    }
    target = fromFile.value === null ? BASELINE.total : fromFile.value
  }
  if (target < MIN_TARGET) {
    process.stderr.write(`validate.mjs: a target of ${target} is too small to ` +
      `satisfy the coverage targets. Use ${MIN_TARGET} or more.\n`)
    return 3
  }
  TARGETS = targetsFor(target)

  if (!existsSync(corpusPath)) {
    const msg = `corpus file not found: ${corpusPath}\n` +
      'The seeking agent creates it on the first round. Nothing to validate yet.\n'
    if (asJson) {
      process.stdout.write(JSON.stringify({
        corpusPath, exists: false, goalsMet: false, schemaErrors: [],
      }, null, 2) + '\n')
    } else {
      process.stdout.write(msg)
    }
    return 2
  }

  const corpus = readJsonl(corpusPath)
  const schemaErrors = [...corpus.errors]
  const seen = new Map()
  const items = []
  for (const { line, value } of corpus.rows) {
    const errs = validateItem(value, line, seen, corpusPath)
    schemaErrors.push(...errs)
    items.push(value)
  }

  const reviews = []
  if (existsSync(roundsDir)) {
    const names = roundFiles(roundsDir, /^round-\d+-review\.jsonl$/)
    for (const name of names) {
      const path = join(roundsDir, name)
      const parsed = readJsonl(path)
      schemaErrors.push(...parsed.errors)
      const fileRound = roundNumber(name)
      for (const { line, value } of parsed.rows) {
        schemaErrors.push(...validateReview(value, line, path))
        // A record filed under the wrong round would be applied to the wrong
        // round and would skew the gate, so the file name is authoritative.
        if (isInt(value.round) && value.round !== fileRound) {
          schemaErrors.push(`${path}:${line}: \`round\` is ${value.round} but ` +
            `the file name says round ${fileRound}`)
        }
        reviews.push(value)
      }
    }
    const knownIds = new Set(items.map((r) => r.id))
    for (const r of reviews) {
      if (isStr(r.item_id) && !knownIds.has(r.item_id)) {
        schemaErrors.push(`${roundsDir}: review references unknown item ` +
          `${r.item_id}`)
      }
    }
  }

  const { reports, errors: reportErrors } = readRounds(roundsDir)
  schemaErrors.push(...reportErrors)

  const assessment = assess(items, reviews, reports)
  const report = { corpusPath, schemaErrors, assessment }

  if (asJson) {
    process.stdout.write(JSON.stringify({
      corpusPath,
      exists: true,
      targets: TARGETS,
      schemaErrors,
      goalsMet: schemaErrors.length === 0 && assessment.goalsMet,
      counts: assessment.counts,
      criteria: assessment.criteria,
    }, null, 2) + '\n')
  } else {
    printText(report)
  }

  if (schemaErrors.length > 0) return 2
  return assessment.goalsMet ? 0 : 1
}

process.exit(main(process.argv.slice(2)))
