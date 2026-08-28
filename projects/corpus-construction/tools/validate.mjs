#!/usr/bin/env node
// Validate the corpus against the schema, and report coverage.
//
// This tool has no opinion about whether the corpus is finished. It answers two
// questions: is every record well formed, and where is the coverage thin. The
// caps that keep the corpus from skewing are enforced in tools/select.mjs, in
// code; this tool reports them so a person can see the shape of what was built.
//
// It reads corpus/functional-images.jsonl, and with --pool the harvest pool too,
// since the pool uses the same schema minus the review fields.
//
// Usage, from anywhere:
//   node tools/validate.mjs                 validate the corpus
//   node tools/validate.mjs --pool          validate pool/candidates.jsonl
//   node tools/validate.mjs --goal 250      the size the shares are of
//   node tools/validate.mjs --json          machine readable report
//   node tools/validate.mjs --quiet         errors and warnings only
//   node tools/validate.mjs --corpus FILE   somewhere else
//   node tools/validate.mjs --selftest      offline
//
// Exit codes: 0 every record is well formed, 1 the corpus is empty, 2 schema
// errors or an unreadable file, 3 bad usage or self-test failure.

import { readFileSync, writeFileSync, existsSync, mkdtempSync,
  rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')

// --- schema, mirroring corpus/README.md. Keep the two in step. --------------

export const SUBTYPES = {
  'linked-standalone-logo': 1,
  'standalone-navigational-link': 1,
  'form-control-or-image-button': 2,
  'action-or-toggle-icon': 2,
  'functional-non-unicode-emoji': 3,
  'linked-complex-graphic-or-image-map': 4,
  'structural-break-or-reader-control': 5,
}

const STATUSES = ['unreviewed', 'ready', 'dropped']
const IMPLEMENTATIONS = ['img', 'inline-svg', 'input-image', 'area']
// Inline SVG is the one kind with no separate image URL: its bytes are in the
// markup, and fetch-images.mjs writes them out from there.
const NEEDS_IMAGE_URL = ['img', 'input-image', 'area']
const ROLES = ['link', 'button', 'input-image', 'area', 'custom']
const NAME_SOURCES = ['alt', 'aria-label', 'aria-labelledby', 'title',
  'svg-title', 'control-text']
const VERDICTS = ['keep', 'drop']
const QUALITIES = ['good', 'weak', 'wrong']

// The sectors the corpus is meant to span. The old corpus had none of the last
// three, which is the coverage failure these targets exist to make visible.
export const SECTORS = ['government', 'education', 'publishing', 'docs',
  'commerce', 'news', 'webapp']

// Shares of the goal, not of what has been collected, so they mean something
// from the first item rather than only at the end.
const SECTOR_MIN_SHARE = 0.08
const SECTOR_MAX_SHARE = 0.25
const SUBTYPE_MIN_SHARE = 0.05
const DOMAIN_MAX_SHARE = 0.05
const PER_PAGE_MAX = 2

const DEFAULT_GOAL = 250

const isStr = (v) => typeof v === 'string' && v !== ''
const isUrl = (v) => {
  if (!isStr(v)) return false
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:' }
  catch { return false }
}

// The host as `domain` records it. `www.` comes off, the same way harvest.mjs
// takes it off, because www.example.gov and example.gov are one publisher and the
// per-domain cap has to see them that way.
const host = (url) => {
  try { return new URL(url).host.toLowerCase().replace(/^www\./, '') }
  catch { return '' }
}

// --- record validation -----------------------------------------------------

// Returns a list of problems, so one run reports everything wrong with a record
// rather than the first thing.
export function checkItem(item, where) {
  const p = []
  const bad = (msg) => p.push(`${where}: ${msg}`)

  // Four digits, or more once the pool passes ten thousand candidates.
  if (!/^fi-\d{4,}$/.test(item.id ?? '')) bad('`id` must look like fi-0001')
  if (!STATUSES.includes(item.status)) {
    bad(`\`status\` must be one of ${STATUSES.join(', ')}, not ` +
      JSON.stringify(item.status))
  }
  if (!isUrl(item.page_url)) bad('`page_url` must be an http or https URL')
  if (!isStr(item.domain)) bad('`domain` is required')
  else if (isUrl(item.page_url) && host(item.page_url) !== item.domain) {
    bad(`\`domain\` is ${item.domain} but \`page_url\` is on ` +
      `${host(item.page_url)}`)
  }
  if (!isStr(item.sector)) bad('`sector` is required')

  if (!IMPLEMENTATIONS.includes(item.implementation)) {
    bad(`\`implementation\` must be one of ${IMPLEMENTATIONS.join(', ')}, not ` +
      JSON.stringify(item.implementation))
  }
  if (!ROLES.includes(item.element_role)) {
    bad(`\`element_role\` must be one of ${ROLES.join(', ')}, not ` +
      JSON.stringify(item.element_role))
  }
  if (NEEDS_IMAGE_URL.includes(item.implementation) && !isUrl(item.image_url) &&
      !String(item.image_url ?? '').startsWith('data:')) {
    bad(`a ${item.implementation} needs an \`image_url\`, and this one has ` +
      JSON.stringify(item.image_url))
  }
  if (item.implementation === 'inline-svg' && item.image_url !== null) {
    bad('an inline SVG has no `image_url`: its bytes are in `image_svg`')
  }

  // image_svg is the one field that is assembled rather than sliced, because an
  // SVG lifted out of an HTML page needs its namespace declared and its sprite
  // symbols copied in before it is a file anyone can open.
  if (item.implementation === 'inline-svg') {
    if (!isStr(item.image_svg)) {
      bad('an inline SVG needs an `image_svg`, the standalone document ' +
        'harvest.mjs assembled from the page')
    } else if (!item.image_svg.startsWith('<svg') ||
        !item.image_svg.includes('xmlns=')) {
      bad('`image_svg` must be a standalone `<svg>` document, namespace declared')
    }
  } else if (item.image_svg !== null) {
    bad('only an inline SVG carries an `image_svg`')
  }

  // element_html is a slice of the fetched page, never rebuilt. We cannot verify
  // that here without refetching, but we can catch a record that was clearly
  // hand-written.
  if (!isStr(item.element_html)) bad('`element_html` is required')
  else if (!item.element_html.startsWith('<')) {
    bad('`element_html` must start with the element it is a slice of')
  }

  if (typeof item.surrounding_text !== 'string') {
    bad('`surrounding_text` must be a string, empty if there was none')
  }
  // The distinction the whole corpus turns on: '' is alt="" and means the author
  // marked the image redundant. null is no alt attribute at all.
  if (item.observed_alt !== null && typeof item.observed_alt !== 'string') {
    bad('`observed_alt` must be a string, empty string for alt="", or null ' +
      'when the attribute is absent')
  }
  // The collection rule. An image whose control announces nothing has no
  // alternative description, so there is nothing to benchmark against.
  if (!isStr(item.accessible_name)) {
    bad('`accessible_name` must be non-empty: an image whose control ' +
      'announces nothing is never collected')
  }
  if (!NAME_SOURCES.includes(item.accessible_name_source)) {
    bad(`\`accessible_name_source\` must be one of ${NAME_SOURCES.join(', ')}, ` +
      `not ${JSON.stringify(item.accessible_name_source)}`)
  }

  if (!(item.subtype in SUBTYPES)) {
    bad(`\`subtype\` must be one of the seven, not ${JSON.stringify(item.subtype)}`)
  } else if (item.category !== SUBTYPES[item.subtype]) {
    bad(`\`category\` is ${item.category} but ${item.subtype} is category ` +
      SUBTYPES[item.subtype])
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.retrieved ?? '')) {
    bad('`retrieved` must be YYYY-MM-DD')
  }

  // Archived bytes. Required once an item is ready, because a person cannot
  // judge alt text against an image that is not there.
  if (item.status === 'ready') {
    if (!isStr(item.image_file)) bad('a ready item needs an `image_file`')
    if (!/^[0-9a-f]{64}$/.test(item.image_sha256 ?? '')) {
      bad('a ready item needs a 64-character `image_sha256`')
    }
  } else if (item.image_file !== null && !isStr(item.image_file)) {
    bad('`image_file` must be a path or null')
  }

  // Review fields move together: all null before review, all set after.
  const reviewed = item.status !== 'unreviewed'
  if (reviewed) {
    if (!VERDICTS.includes(item.review_verdict)) {
      bad(`a reviewed item needs \`review_verdict\` ${VERDICTS.join(' or ')}`)
    }
    if (!isStr(item.review_reason)) bad('a reviewed item needs a `review_reason`')
    if (!QUALITIES.includes(item.alt_quality)) {
      bad(`a reviewed item needs \`alt_quality\` ${QUALITIES.join(', ')}`)
    }
    if (item.status === 'ready' && item.alt_quality !== 'good') {
      bad(`a ready item cannot have \`alt_quality\` ` +
        `${JSON.stringify(item.alt_quality)}: the shipped alt is the reference`)
    }
    if (item.status === 'ready' && item.review_verdict !== 'keep') {
      bad('a ready item must have been kept')
    }
  } else {
    for (const f of ['review_verdict', 'review_reason', 'alt_quality']) {
      if (item[f] !== null && item[f] !== undefined) {
        bad(`an unreviewed item must not have \`${f}\` set`)
      }
    }
  }

  return p
}

export function checkCorpus(rows) {
  const problems = []
  const ids = new Map()
  for (const { line, value } of rows) {
    problems.push(...checkItem(value, `line ${line}`))
    if (ids.has(value.id)) {
      problems.push(`line ${line}: \`id\` ${value.id} is also on line ` +
        ids.get(value.id))
    } else ids.set(value.id, line)
  }
  return problems
}

// --- coverage --------------------------------------------------------------

function tally(items, field) {
  const counts = new Map()
  for (const item of items) counts.set(item[field], (counts.get(item[field]) ?? 0) + 1)
  return counts
}

export function coverage(items, goal) {
  const bySector = tally(items, 'sector')
  const bySubtype = tally(items, 'subtype')
  const byDomain = tally(items, 'domain')
  const byPage = tally(items, 'page_url')

  const sectorMin = Math.max(1, Math.round(goal * SECTOR_MIN_SHARE))
  const sectorMax = Math.max(1, Math.round(goal * SECTOR_MAX_SHARE))
  const subtypeMin = Math.max(1, Math.round(goal * SUBTYPE_MIN_SHARE))
  const domainMax = Math.max(1, Math.ceil(goal * DOMAIN_MAX_SHARE))

  const warnings = []
  for (const sector of SECTORS) {
    const n = bySector.get(sector) ?? 0
    if (n < sectorMin) {
      warnings.push(`sector ${sector} holds ${n}, short of ${sectorMin}`)
    }
  }
  for (const [sector, n] of bySector) {
    if (!SECTORS.includes(sector)) {
      warnings.push(`sector ${sector} is not one of the seven this corpus spans`)
    }
    if (n > sectorMax) {
      warnings.push(`sector ${sector} holds ${n}, over the ${sectorMax} ceiling`)
    }
  }
  for (const subtype of Object.keys(SUBTYPES)) {
    const n = bySubtype.get(subtype) ?? 0
    if (n < subtypeMin) {
      warnings.push(`sub-type ${subtype} holds ${n}, short of ${subtypeMin}`)
    }
  }
  for (const [domain, n] of byDomain) {
    if (n > domainMax) {
      warnings.push(`domain ${domain} holds ${n}, over the ${domainMax} cap`)
    }
  }
  for (const [page, n] of byPage) {
    if (n > PER_PAGE_MAX) {
      warnings.push(`page ${page} contributed ${n}, over the ${PER_PAGE_MAX} cap`)
    }
  }

  return {
    goal,
    caps: { sectorMin, sectorMax, subtypeMin, domainMax, perPage: PER_PAGE_MAX },
    bySector, bySubtype, byDomain, byPage, warnings,
  }
}

// --- report ----------------------------------------------------------------

function bar(n, goal) {
  // Text, not a graphic, because a chart would be an image of a number.
  const width = Math.min(20, Math.round((n / Math.max(1, goal)) * 20))
  return '#'.repeat(width) + '.'.repeat(20 - width)
}

function report(out, items, cov) {
  const statuses = tally(items, 'status')
  out(`corpus:      ${items.length} item(s), goal ${cov.goal}\n`)
  for (const s of STATUSES) {
    out(`  ${s.padEnd(12)} ${statuses.get(s) ?? 0}\n`)
  }

  const rows = (label, counts, keys, min, max) => {
    out(`\n${label}\n`)
    for (const key of keys) {
      const n = counts.get(key) ?? 0
      const flag = min !== undefined && n < min ? '  short'
        : max !== undefined && n > max ? '  over' : ''
      out(`  ${String(n).padStart(4)}  ${bar(n, max ?? cov.goal)}  ${key}${flag}\n`)
    }
  }
  rows('by sector, wanted ' + cov.caps.sectorMin + ' to ' + cov.caps.sectorMax +
    ' each', cov.bySector,
    [...new Set([...SECTORS, ...cov.bySector.keys()])],
    cov.caps.sectorMin, cov.caps.sectorMax)
  rows('by sub-type, wanted at least ' + cov.caps.subtypeMin + ' each',
    cov.bySubtype, Object.keys(SUBTYPES), cov.caps.subtypeMin, undefined)

  out(`\nby domain, at most ${cov.caps.domainMax} each, showing the top 15\n`)
  const domains = [...cov.byDomain.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  for (const [domain, n] of domains.slice(0, 15)) {
    out(`  ${String(n).padStart(4)}  ${domain}` +
      (n > cov.caps.domainMax ? '  over' : '') + '\n')
  }
  out(`  ${domains.length} domain(s) in all\n`)

  if (cov.warnings.length > 0) {
    out(`\ncoverage is thin or skewed in ${cov.warnings.length} place(s):\n`)
    for (const w of cov.warnings) out(`  ${w}\n`)
    out('\nHarvest more seeds in the thin sectors, then select again. Nothing ' +
      'here is an error: the caps are enforced in tools/select.mjs.\n')
  } else {
    out('\ncoverage meets every target.\n')
  }
}

// --- self-test -------------------------------------------------------------

function selftest() {
  let failures = 0
  const check = (name, cond, detail) => {
    if (cond) process.stdout.write(`PASS ${name}\n`)
    else { process.stdout.write(`FAIL ${name}: ${detail ?? ''}\n`); failures++ }
  }
  const item = (over = {}) => ({
    id: 'fi-0001', status: 'unreviewed',
    page_url: 'https://example.gov/help', domain: 'example.gov',
    sector: 'government', image_url: 'https://example.gov/i/print.png',
    image_svg: null, image_file: null, image_sha256: null, implementation: 'img',
    element_role: 'button',
    element_html: '<button><img src="/i/print.png" alt="Print this page"></button>',
    surrounding_text: 'Print this page Share Save',
    observed_alt: 'Print this page', accessible_name: 'Print this page',
    accessible_name_source: 'alt', category: 2,
    subtype: 'action-or-toggle-icon', retrieved: '2026-08-27',
    review_verdict: null, review_reason: null, alt_quality: null, ...over,
  })
  const ready = (over = {}) => item({
    status: 'ready', image_file: 'pool/images/fi-0001.png',
    image_sha256: 'a'.repeat(64), review_verdict: 'keep',
    review_reason: 'The icon names the action, not the picture.',
    alt_quality: 'good', ...over,
  })

  check('a well formed unreviewed item passes',
    checkItem(item(), 'x').length === 0, JSON.stringify(checkItem(item(), 'x')))
  check('a well formed ready item passes',
    checkItem(ready(), 'x').length === 0, JSON.stringify(checkItem(ready(), 'x')))
  check('an empty alt text is a valid value',
    checkItem(item({ observed_alt: '' }), 'x').length === 0)
  check('a missing alt attribute is a valid value',
    checkItem(item({ observed_alt: null }), 'x').length === 0)
  // A harvest of a few dozen seeds passes ten thousand candidates easily, and a
  // four-digit-only id rule silently rejected every one of them past fi-9999.
  check('a five digit id passes',
    checkItem(item({ id: 'fi-10421' }), 'x').length === 0,
    JSON.stringify(checkItem(item({ id: 'fi-10421' }), 'x')))
  check('an id that is not fi- and digits is rejected',
    checkItem(item({ id: 'fi-42' }), 'x').length === 1)

  // The collection rule, which is the reason this corpus exists at all.
  check('an item with no accessible name is rejected',
    checkItem(item({ accessible_name: '' }), 'x')
      .some((e) => e.includes('announces nothing')))
  // The pairing that would let a corrected sub-type contradict its category.
  check('a category that disagrees with its sub-type is rejected',
    checkItem(item({ category: 4 }), 'x').some((e) => e.includes('category 2')))
  check('a ready item with no archived image is rejected',
    checkItem(ready({ image_file: null }), 'x')
      .some((e) => e.includes('needs an `image_file`')))
  check('a ready item with weak alt is rejected',
    checkItem(ready({ alt_quality: 'weak' }), 'x')
      .some((e) => e.includes('the shipped alt is the reference')))
  check('an unreviewed item carrying a verdict is rejected',
    checkItem(item({ review_verdict: 'keep' }), 'x')
      .some((e) => e.includes('must not have `review_verdict`')))
  check('a domain that disagrees with the page URL is rejected',
    checkItem(item({ domain: 'elsewhere.gov' }), 'x')
      .some((e) => e.includes('is on example.gov')))
  // The harvester records www.weather.gov as weather.gov, so this check has to
  // strip www. too. It did not, and it failed 161 of the first 250 selected.
  check('a www host matches the domain it was recorded as',
    checkItem(item({ page_url: 'https://www.example.gov/help' }), 'x')
      .length === 0,
    JSON.stringify(checkItem(item({ page_url: 'https://www.example.gov/help' }), 'x')))
  const inlineSvg = (over = {}) => item({
    implementation: 'inline-svg', image_url: null,
    image_svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2">' +
      '<path d="M0 0 2 2"/></svg>', ...over,
  })
  check('an inline SVG carrying an image URL is rejected',
    checkItem(inlineSvg({ image_url: 'https://example.gov/i/x.svg' }), 'x')
      .some((e) => e.includes('no `image_url`')))
  check('an inline SVG with an assembled document passes',
    checkItem(inlineSvg(), 'x').length === 0,
    JSON.stringify(checkItem(inlineSvg(), 'x')))
  // The item would archive as a blank rectangle, and blank rectangles cannot be
  // judged against alt text. harvest.mjs never writes one; this is the backstop.
  check('an inline SVG with no assembled document is rejected',
    checkItem(inlineSvg({ image_svg: null }), 'x')
      .some((e) => e.includes('needs an `image_svg`')))
  check('an image that is not inline SVG must not carry an image_svg',
    checkItem(item({ image_svg: '<svg xmlns="x"></svg>' }), 'x')
      .some((e) => e.includes('only an inline SVG')))
  check('markup that was written rather than sliced is rejected',
    checkItem(item({ element_html: 'button with a print icon' }), 'x')
      .some((e) => e.includes('slice of')))
  check('a duplicate id is rejected',
    checkCorpus([{ line: 1, value: item() }, { line: 2, value: item() }])
      .some((e) => e.includes('is also on line 1')))

  // Coverage. The warnings are the whole point, so they are what gets asserted.
  {
    const items = Array.from({ length: 12 }, (_, i) =>
      item({ id: `fi-${String(i).padStart(4, '0')}` }))
    const cov = coverage(items, 100)
    check('a single-domain corpus is reported as over the domain cap',
      cov.warnings.some((w) => w.includes('domain example.gov holds 12')),
      JSON.stringify(cov.warnings.slice(0, 3)))
    check('a single-page corpus is reported as over the page cap',
      cov.warnings.some((w) => w.includes('contributed 12')))
    check('the six missing sectors are each reported as short',
      SECTORS.filter((s) => s !== 'government')
        .every((s) => cov.warnings.some((w) => w.startsWith(`sector ${s} holds 0`))))
    check('a sector not in the taxonomy is reported',
      coverage([item({ sector: 'gardening' })], 100).warnings
        .some((w) => w.includes('not one of the seven')))
  }

  {
    const dir = mkdtempSync(join(tmpdir(), 'alt-validate-'))
    const path = join(dir, 'corpus.jsonl')
    writeFileSync(path, JSON.stringify(item()) + '\n' +
      JSON.stringify(item({ id: 'fi-0002', accessible_name: '' })) + '\n')
    const rc = run(path, 100, false, false, () => {})
    check('a schema error on disk exits 2', rc === 2, `rc ${rc}`)
    writeFileSync(path, JSON.stringify(item()) + '\n')
    check('a clean corpus on disk exits 0',
      run(path, 100, false, false, () => {}) === 0)
    writeFileSync(path, '')
    check('an empty corpus exits 1',
      run(path, 100, false, false, () => {}) === 1)
    rmSync(dir, { recursive: true, force: true })
  }

  process.stdout.write(failures === 0
    ? '\nvalidate self-test passed\n'
    : `\nvalidate self-test failed, ${failures} case(s)\n`)
  return failures === 0 ? 0 : 3
}

// --- entry point -----------------------------------------------------------

function readJsonl(path) {
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

function run(path, goal, asJson, quiet, out) {
  // A file that does not exist yet is an empty corpus, not a broken one. Nothing
  // has been harvested, which is a stage to run rather than an error to fix.
  if (!existsSync(path)) {
    out(asJson
      ? JSON.stringify({ file: path, items: 0, problems: [] }, null, 2) + '\n'
      : `${path.replace(PROJECT + '/', '')} holds no items yet.\n`)
    return 1
  }
  const { rows, errors } = readJsonl(path)
  if (errors.length > 0) {
    for (const e of errors) out(`${e}\n`)
    return 2
  }
  const items = rows.map((r) => r.value)
  const problems = checkCorpus(rows)
  const cov = coverage(items, goal)

  if (asJson) {
    out(JSON.stringify({
      file: path, items: items.length, problems,
      goal, caps: cov.caps,
      bySector: Object.fromEntries(cov.bySector),
      bySubtype: Object.fromEntries(cov.bySubtype),
      byDomain: Object.fromEntries(cov.byDomain),
      warnings: cov.warnings,
    }, null, 2) + '\n')
    return problems.length > 0 ? 2 : items.length === 0 ? 1 : 0
  }

  if (problems.length > 0) {
    out(`${problems.length} schema problem(s) in ` +
      `${path.replace(PROJECT + '/', '')}:\n`)
    for (const p of problems.slice(0, 40)) out(`  ${p}\n`)
    if (problems.length > 40) out(`  ... and ${problems.length - 40} more\n`)
    out('\n')
  }
  if (items.length === 0) {
    out(`${path.replace(PROJECT + '/', '')} holds no items.\n`)
    return problems.length > 0 ? 2 : 1
  }
  if (!quiet) report(out, items, cov)
  else if (problems.length === 0) out(`${items.length} item(s), no schema problems\n`)
  return problems.length > 0 ? 2 : 0
}

function main(argv) {
  let path = join(PROJECT, 'corpus', 'functional-images.jsonl')
  let goal = DEFAULT_GOAL
  let asJson = false
  let quiet = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--selftest') return selftest()
    else if (arg === '--json') asJson = true
    else if (arg === '--quiet') quiet = true
    else if (arg === '--pool') path = join(PROJECT, 'pool', 'candidates.jsonl')
    else if (arg === '--goal') goal = Number(argv[++i])
    else if (arg === '--corpus') path = resolve(argv[++i] ?? '')
    else {
      process.stderr.write(`validate.mjs: unknown argument "${arg}"\n` +
        'usage: validate.mjs [--pool] [--goal N] [--json] [--quiet] ' +
        '[--corpus FILE] [--selftest]\n')
      return 3
    }
  }
  if (!Number.isFinite(goal) || goal < 1) {
    process.stderr.write('validate.mjs: --goal must be 1 or more\n')
    return 3
  }
  return run(path, goal, asJson, quiet, (s) => process.stdout.write(s))
}

process.exit(main(process.argv.slice(2)))
