#!/usr/bin/env node
// Choose which harvested candidates become corpus items.
//
// The harvest is indiscriminate on purpose: it takes everything it finds so the
// choosing can be done later, against the whole pool, by a rule rather than by
// whatever an agent happened to stumble onto. This is that rule.
//
// It exists because of a specific failure. The first version of this project let
// a seeking agent pick its own items, and it drifted: three rounds produced 31
// items, of which two domains supplied six of the eleven that survived, four came
// from two page templates, and one page contributed two of eight identical
// buttons. Nothing in the process noticed, because the only concentration check
// was per domain and it was satisfied. Caps enforced in code cannot drift.
//
// The caps, applied in this order:
//   1. an item needs an archived image, or there is nothing to review
//   2. one item per image and role, across the whole corpus, which kills both
//      the repeated button on one page and the same icon set reused everywhere
//   3. at most 2 items per page
//   4. at most 5 percent of the goal from any one domain
//   5. what is left fills the thinnest sub-type and sector buckets first
//
// The same rule also draws the shortlist. A harvest of a few dozen seeds yields
// tens of thousands of candidates, and archiving every one would mean tens of
// thousands of requests for image bytes that the caps above would then throw
// away. So `--shortlist` runs the caps that need no image, with room to spare,
// and only those candidates get downloaded. Cap 2 cannot run there, because the
// hashes it compares do not exist until the bytes are on disk.
//
// Usage:
//   node tools/select.mjs --add 60          add up to 60 items to the corpus
//   node tools/select.mjs --shortlist 1250  choose what is worth downloading
//   node tools/select.mjs --goal 250        the size the 5 percent cap is of
//   node tools/select.mjs --dry-run         report, write nothing
//   node tools/select.mjs --selftest        offline
//   --pool FILE, --corpus FILE              work somewhere else
//
// Exit codes: 0 items were selected, 1 nothing could be selected, 2 refused
// because a file is unusable, 3 bad usage or self-test failure.

import { readFileSync, writeFileSync, appendFileSync, existsSync,
  mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')

const PER_PAGE = 2
const DOMAIN_SHARE = 0.05

// How much wider the shortlist's per-domain cap runs than the corpus's. The
// hash de-duplication that the shortlist cannot do will discard some of what it
// picks, and a shortlist that is exactly the size of the goal would leave the
// thin buckets short with no way to refill them but another harvest.
const SHORTLIST_HEADROOM = 3

const SUBTYPES = [
  'linked-standalone-logo',
  'standalone-navigational-link',
  'form-control-or-image-button',
  'action-or-toggle-icon',
  'functional-non-unicode-emoji',
  'linked-complex-graphic-or-image-map',
  'structural-break-or-reader-control',
]

const isStr = (v) => typeof v === 'string' && v !== ''

export function readJsonl(path) {
  if (!existsSync(path)) return { rows: [], errors: [] }
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

// The identity that decides a duplicate: the same bytes doing the same job. Two
// different icons from one sprite sheet share no hash, and one icon reused as a
// link and as a button is two genuinely different items.
const imageKey = (item) => `${item.image_sha256}|${item.element_role}`

// --- selection -------------------------------------------------------------

// Pure, so the self-test drives the real rule rather than an imitation of it.
// `taken` is what the corpus already holds, which the caps count against.
//
// `headroom` widens the per-domain cap, and `requireImage` turns off the two
// caps that need archived bytes. Both exist for the shortlist pass and are at
// their strict defaults for the corpus pass.
export function select(pool, taken, { add, goal, headroom = 1,
  requireImage = true }) {
  const domainCap = Math.max(1, Math.ceil(goal * DOMAIN_SHARE * headroom))

  const used = {
    images: new Set(taken.map(imageKey)),
    perPage: new Map(),
    perDomain: new Map(),
    perSubtype: new Map(),
    perSector: new Map(),
  }
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1)
  for (const item of taken) {
    bump(used.perPage, item.page_url)
    bump(used.perDomain, item.domain)
    bump(used.perSubtype, item.subtype)
    bump(used.perSector, item.sector)
  }

  const alreadyIn = new Set(taken.map((t) => t.id))
  const dropped = {
    alreadySelected: 0, noImage: 0, duplicateImage: 0, pageCap: 0, domainCap: 0,
  }

  // Candidates still in play, in pool order so a re-run is deterministic.
  const queue = []
  for (const item of pool) {
    if (alreadyIn.has(item.id)) { dropped.alreadySelected++; continue }
    if (requireImage && (!isStr(item.image_file) || !isStr(item.image_sha256))) {
      dropped.noImage++
      continue
    }
    queue.push(item)
  }

  const chosen = []
  // Take from the thinnest bucket each time. Sector is the outer tie-break
  // because it is the target the old process missed worst, and sub-type the
  // inner one because the taxonomy is what makes this a benchmark.
  const bucketsOf = (item) => [
    used.perSector.get(item.sector) ?? 0,
    used.perSubtype.get(item.subtype) ?? 0,
  ]

  while (chosen.length < add) {
    let best = -1
    let bestRank = null
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]
      if (item === null) continue
      const rank = bucketsOf(item)
      if (bestRank === null || rank[0] < bestRank[0] ||
          (rank[0] === bestRank[0] && rank[1] < bestRank[1])) {
        best = i
        bestRank = rank
      }
    }
    if (best === -1) break

    const item = queue[best]
    queue[best] = null

    if (requireImage && used.images.has(imageKey(item))) {
      dropped.duplicateImage++
      continue
    }
    if ((used.perPage.get(item.page_url) ?? 0) >= PER_PAGE) {
      dropped.pageCap++
      continue
    }
    if ((used.perDomain.get(item.domain) ?? 0) >= domainCap) {
      dropped.domainCap++
      continue
    }

    used.images.add(imageKey(item))
    bump(used.perPage, item.page_url)
    bump(used.perDomain, item.domain)
    bump(used.perSubtype, item.subtype)
    bump(used.perSector, item.sector)
    chosen.push(item)
  }

  const remaining = queue.filter((q) => q !== null).length
  return { chosen, dropped, remaining, domainCap }
}

// --- report ----------------------------------------------------------------

function tally(items, field) {
  const counts = new Map()
  for (const item of items) {
    counts.set(item[field], (counts.get(item[field]) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
}

function report(out, corpus, what = 'corpus') {
  const line = (label, pairs) => {
    out(`  ${label}\n`)
    for (const [key, n] of pairs) {
      out(`    ${String(n).padStart(4)}  ${key}\n`)
    }
  }
  out(`\n${what} now holds ${corpus.length} item(s)\n`)
  line('by sector', tally(corpus, 'sector'))
  const bySubtype = new Map(tally(corpus, 'subtype'))
  line('by sub-type', SUBTYPES.map((s) => [s, bySubtype.get(s) ?? 0]))
  line('by domain', tally(corpus, 'domain'))
}

// --- shortlist -------------------------------------------------------------

// Keep `want` candidates on the shortlist that are not in the corpus yet, so the
// archive stage has something to download and the review stage has something to
// draw from. Appends, never rewrites: a row whose bytes are already on disk keeps
// the `image_file` and `image_sha256` that the archive stage wrote into it.
function shortlist(poolPath, listPath, corpusPath, { want, goal, dryRun }) {
  const out = (s) => process.stdout.write(s)
  const pool = readJsonl(poolPath)
  const list = readJsonl(listPath)
  const corpus = readJsonl(corpusPath)
  const errors = [...pool.errors, ...list.errors, ...corpus.errors]
  if (errors.length > 0) {
    out('refused to shortlist:\n')
    for (const e of errors) out(`  ${e}\n`)
    return 2
  }
  if (pool.rows.length === 0) {
    out(`no candidates in ${poolPath}. Run ./run.sh --harvest first.\n`)
    return 1
  }

  const inCorpus = new Set(corpus.rows.map((r) => r.id))
  const pending = list.rows.filter((r) => !inCorpus.has(r.id)).length
  const add = Math.max(0, want - pending)

  out(`pool:      ${pool.rows.length} candidate(s)\n`)
  out(`shortlist: ${list.rows.length} row(s), ${pending} not selected yet\n`)
  out(`target:    ${want} waiting, so ${add} more to add\n`)
  if (add === 0) {
    out('\nThe shortlist already holds enough. Next: ./run.sh --select N\n')
    return 1
  }

  const { chosen, dropped, remaining, domainCap } = select(
    pool.rows, [...corpus.rows, ...list.rows],
    { add, goal, headroom: SHORTLIST_HEADROOM, requireImage: false })

  out(`caps:      ${domainCap} per domain, ${PER_PAGE} per page\n`)
  out(`chose:     ${chosen.length}\n`)
  out('\nnot shortlisted, and why:\n')
  out(`  already shortlisted:          ${dropped.alreadySelected}\n`)
  out(`  over the ${PER_PAGE}-per-page cap:       ${dropped.pageCap}\n`)
  out(`  over the per-domain cap:      ${dropped.domainCap}\n`)
  out(`  still available for later:    ${remaining}\n`)

  if (chosen.length === 0) {
    out('\nNothing could be shortlisted. The caps are working: harvest more ' +
      'seeds.\n')
    return 1
  }
  report(out, [...list.rows.filter((r) => !inCorpus.has(r.id)), ...chosen],
    'the waiting shortlist')

  if (dryRun) {
    out('\nnothing written, --dry-run\n')
    return 0
  }
  mkdirSync(dirname(listPath), { recursive: true })
  const lines = chosen.map((r) => JSON.stringify(r)).join('\n') + '\n'
  if (existsSync(listPath)) appendFileSync(listPath, lines)
  else writeFileSync(listPath, lines)
  out(`\nadded ${chosen.length} row(s) to ${listPath.replace(PROJECT + '/', '')}\n`)
  return 0
}

// --- self-test -------------------------------------------------------------

function selftest() {
  let failures = 0
  const check = (name, cond, detail) => {
    if (cond) process.stdout.write(`PASS ${name}\n`)
    else { process.stdout.write(`FAIL ${name}: ${detail ?? ''}\n`); failures++ }
  }
  let n = 0
  const cand = (over = {}) => {
    n++
    return {
      id: `fi-${String(n).padStart(4, '0')}`,
      status: 'unreviewed',
      page_url: `https://a.example.com/p${n}`,
      domain: 'a.example.com',
      sector: 'docs',
      image_url: `https://a.example.com/i${n}.png`,
      image_file: `pool/images/fi-${String(n).padStart(4, '0')}.png`,
      image_sha256: String(n).repeat(64).slice(0, 64),
      implementation: 'img',
      element_role: 'link',
      subtype: 'standalone-navigational-link',
      ...over,
    }
  }

  // An item with no archived image is never selected: there would be nothing for
  // a reviewer or a person to look at.
  {
    const pool = [cand({ image_file: null, image_sha256: null }), cand()]
    const r = select(pool, [], { add: 10, goal: 250 })
    check('an item with no archived image is not selected',
      r.chosen.length === 1 && r.dropped.noImage === 1,
      `${r.chosen.length} chosen, ${JSON.stringify(r.dropped)}`)
  }

  // The case that motivated the whole tool: eight identical buttons on one page.
  {
    const same = { image_sha256: 'f'.repeat(64), page_url: 'https://a.example.com/pay' }
    const pool = Array.from({ length: 8 }, () => cand({ ...same }))
    const r = select(pool, [], { add: 10, goal: 250 })
    check('identical images in the same role collapse to one item',
      r.chosen.length === 1 && r.dropped.duplicateImage === 7,
      `${r.chosen.length} chosen, ${JSON.stringify(r.dropped)}`)
  }

  // Same bytes, different job, is two real items.
  {
    const hash = 'e'.repeat(64)
    const pool = [
      cand({ image_sha256: hash, element_role: 'link' }),
      cand({ image_sha256: hash, element_role: 'button' }),
    ]
    const r = select(pool, [], { add: 10, goal: 250 })
    check('the same icon in a different role is a different item',
      r.chosen.length === 2, `${r.chosen.length} chosen`)
  }

  // Page and template concentration, which no target in the old process caught.
  {
    const pool = Array.from({ length: 6 }, () =>
      cand({ page_url: 'https://a.example.com/one' }))
    const r = select(pool, [], { add: 10, goal: 250 })
    check('at most two items come from one page',
      r.chosen.length === PER_PAGE && r.dropped.pageCap === 4,
      `${r.chosen.length} chosen, ${JSON.stringify(r.dropped)}`)
  }

  // Domain concentration, as a share of the goal rather than of what we have so
  // far, so it binds from the first item instead of becoming meaningful late.
  {
    const pool = Array.from({ length: 12 }, () => cand())
    const r = select(pool, [], { add: 12, goal: 100 })
    check('one domain cannot exceed five percent of the goal',
      r.chosen.length === 5 && r.domainCap === 5 && r.dropped.domainCap === 7,
      `${r.chosen.length} chosen, cap ${r.domainCap}, ${JSON.stringify(r.dropped)}`)
  }

  // Caps count what the corpus already holds, so a second run cannot undo the
  // first run's balance.
  {
    const taken = [cand({ page_url: 'https://a.example.com/one' })]
    const pool = [
      cand({ page_url: 'https://a.example.com/one' }),
      cand({ page_url: 'https://a.example.com/one' }),
    ]
    const r = select(pool, taken, { add: 10, goal: 250 })
    check('an incremental run counts the items already selected',
      r.chosen.length === 1 && r.dropped.pageCap === 1,
      `${r.chosen.length} chosen, ${JSON.stringify(r.dropped)}`)
  }

  // The thin bucket goes first. With one sector already full and another empty,
  // the empty one is filled before the full one grows.
  {
    const taken = [
      cand({ sector: 'docs', domain: 'd1.example.com' }),
      cand({ sector: 'docs', domain: 'd2.example.com' }),
    ]
    const pool = [
      cand({ sector: 'docs', domain: 'd3.example.com' }),
      cand({ sector: 'news', domain: 'n1.example.com' }),
    ]
    const r = select(pool, taken, { add: 1, goal: 250 })
    check('the thinnest sector is filled first',
      r.chosen.length === 1 && r.chosen[0].sector === 'news',
      JSON.stringify(r.chosen.map((c) => c.sector)))
  }

  // And within a sector, the thinnest sub-type.
  {
    const taken = [cand({ subtype: 'action-or-toggle-icon' })]
    const pool = [
      cand({ subtype: 'action-or-toggle-icon', domain: 'x1.example.com' }),
      cand({ subtype: 'linked-standalone-logo', domain: 'x2.example.com' }),
    ]
    const r = select(pool, taken, { add: 1, goal: 250 })
    check('the thinnest sub-type is filled first',
      r.chosen.length === 1 && r.chosen[0].subtype === 'linked-standalone-logo',
      JSON.stringify(r.chosen.map((c) => c.subtype)))
  }

  // Asking for more than the caps allow yields what is allowed, and says so.
  {
    const pool = Array.from({ length: 3 }, () =>
      cand({ page_url: 'https://a.example.com/only' }))
    const r = select(pool, [], { add: 50, goal: 250 })
    check('asking for more than the caps allow is not an error',
      r.chosen.length === 2 && r.remaining === 0,
      `${r.chosen.length} chosen, ${r.remaining} left`)
  }

  // The shortlist pass runs before any image is on disk, so it must not throw
  // candidates away for having no archived bytes.
  {
    const pool = Array.from({ length: 4 }, () =>
      cand({ image_file: null, image_sha256: null, page_url: `https://a.example.com/s${n}` }))
    const r = select(pool, [], { add: 4, goal: 250, headroom: SHORTLIST_HEADROOM,
      requireImage: false })
    check('the shortlist keeps candidates with no archived image',
      r.chosen.length === 4 && r.dropped.noImage === 0,
      `${r.chosen.length} chosen, ${JSON.stringify(r.dropped)}`)
  }

  // And it must not collapse them all into one, which is what hash
  // de-duplication would do when every hash is still null.
  {
    const pool = Array.from({ length: 3 }, () =>
      cand({ image_file: null, image_sha256: null, page_url: `https://a.example.com/t${n}` }))
    const r = select(pool, [], { add: 3, goal: 250, headroom: SHORTLIST_HEADROOM,
      requireImage: false })
    check('the shortlist does not de-duplicate on absent hashes',
      r.chosen.length === 3 && r.dropped.duplicateImage === 0,
      `${r.chosen.length} chosen, ${JSON.stringify(r.dropped)}`)
  }

  // Headroom widens the domain cap and nothing else. Twelve candidates from one
  // domain, a goal of 100: 5 for the corpus, 15 for a shortlist.
  {
    const pool = Array.from({ length: 12 }, () =>
      cand({ image_file: null, image_sha256: null, page_url: `https://a.example.com/u${n}` }))
    const r = select(pool, [], { add: 12, goal: 100,
      headroom: SHORTLIST_HEADROOM, requireImage: false })
    check('headroom widens the per-domain cap by exactly its factor',
      r.domainCap === 15 && r.chosen.length === 12,
      `cap ${r.domainCap}, ${r.chosen.length} chosen`)
  }

  // The per-page cap still binds on the shortlist. Downloading eight copies of
  // one page's icons is the waste the shortlist exists to avoid.
  {
    const pool = Array.from({ length: 8 }, () =>
      cand({ image_file: null, image_sha256: null,
        page_url: 'https://a.example.com/one-page' }))
    const r = select(pool, [], { add: 8, goal: 250,
      headroom: SHORTLIST_HEADROOM, requireImage: false })
    check('the per-page cap binds on the shortlist too',
      r.chosen.length === PER_PAGE && r.dropped.pageCap === 6,
      `${r.chosen.length} chosen, ${JSON.stringify(r.dropped)}`)
  }

  process.stdout.write(failures === 0
    ? '\nselect self-test passed\n'
    : `\nselect self-test failed, ${failures} case(s)\n`)
  return failures === 0 ? 0 : 3
}

// --- entry point -----------------------------------------------------------

function main(argv) {
  const candidates = join(PROJECT, 'pool', 'candidates.jsonl')
  const shortlistPath = join(PROJECT, 'pool', 'shortlist.jsonl')
  let poolPath = null
  let corpusPath = join(PROJECT, 'corpus', 'functional-images.jsonl')
  let add = 60
  let goal = 250
  let want = null
  let dryRun = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--selftest') return selftest()
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--add') add = Number(argv[++i])
    else if (arg === '--shortlist') want = Number(argv[++i])
    else if (arg === '--goal') goal = Number(argv[++i])
    else if (arg === '--pool') poolPath = resolve(argv[++i] ?? '')
    else if (arg === '--corpus') corpusPath = resolve(argv[++i] ?? '')
    else {
      process.stderr.write(`select.mjs: unknown argument "${arg}"\n` +
        'usage: select.mjs [--add N | --shortlist N] [--goal N] [--dry-run] ' +
        '[--pool FILE] [--corpus FILE] [--selftest]\n')
      return 3
    }
  }
  if (!Number.isFinite(add) || add < 1 || !Number.isFinite(goal) || goal < 1) {
    process.stderr.write('select.mjs: --add and --goal must be 1 or more\n')
    return 3
  }
  if (want !== null && (!Number.isFinite(want) || want < 1)) {
    process.stderr.write('select.mjs: --shortlist must be 1 or more\n')
    return 3
  }
  if (want !== null) {
    return shortlist(poolPath ?? candidates, shortlistPath, corpusPath,
      { want, goal, dryRun })
  }
  // Selecting reads the shortlist, since only shortlisted candidates have their
  // image bytes on disk. Falling back keeps the tool usable against a pool that
  // was archived whole, which is what the self-test and a small run do.
  if (poolPath === null) {
    poolPath = existsSync(shortlistPath) ? shortlistPath : candidates
  }

  const pool = readJsonl(poolPath)
  const corpus = readJsonl(corpusPath)
  const errors = [...pool.errors, ...corpus.errors]
  if (errors.length > 0) {
    process.stdout.write('refused to select:\n')
    for (const e of errors) process.stdout.write(`  ${e}\n`)
    return 2
  }
  if (pool.rows.length === 0) {
    process.stdout.write(`no candidates in ${poolPath}. Run ` +
      'node tools/harvest.mjs first.\n')
    return 1
  }

  const out = (s) => process.stdout.write(s)
  const { chosen, dropped, remaining, domainCap } =
    select(pool.rows, corpus.rows, { add, goal })

  out(`read:      ${poolPath.replace(PROJECT + '/', '')}\n`)
  out(`pool:      ${pool.rows.length} candidate(s)\n`)
  out(`corpus:    ${corpus.rows.length} item(s) before this run\n`)
  out(`goal:      ${goal}, so at most ${domainCap} item(s) per domain and ` +
    `${PER_PAGE} per page\n`)
  out(`selected:  ${chosen.length} of the ${add} asked for\n`)
  out('\nnot selected, and why:\n')
  out(`  already in the corpus:        ${dropped.alreadySelected}\n`)
  out(`  no archived image:            ${dropped.noImage}\n`)
  out(`  same image, same role:        ${dropped.duplicateImage}\n`)
  out(`  over the ${PER_PAGE}-per-page cap:       ${dropped.pageCap}\n`)
  out(`  over the per-domain cap:      ${dropped.domainCap}\n`)
  out(`  still available for later:    ${remaining}\n`)

  if (chosen.length === 0) {
    out('\nNothing could be selected. Harvest more seeds: the caps are working, ' +
      'and what is left in the pool duplicates what the corpus already has.\n')
    return 1
  }

  report(out, [...corpus.rows, ...chosen])

  if (dryRun) {
    out('\nnothing written, --dry-run\n')
    return 0
  }
  mkdirSync(dirname(corpusPath), { recursive: true })
  const lines = chosen.map((r) => JSON.stringify(r)).join('\n') + '\n'
  if (existsSync(corpusPath)) appendFileSync(corpusPath, lines)
  else writeFileSync(corpusPath, lines)
  out(`\nadded ${chosen.length} item(s) to ` +
    `${corpusPath.replace(PROJECT + '/', '')}\n`)
  out('Next: ./run.sh --prompt review\n')
  return 0
}

process.exit(main(process.argv.slice(2)))
