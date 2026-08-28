#!/usr/bin/env node
// Crawl the seed lists and extract every functional image candidate found.
//
// This replaces an agent that searched the web and typed records by hand. The
// work it does is mechanical, so a script does it: fetch the page, find images
// inside interactive elements, compute what each control already announces, slice
// the markup out of the bytes we fetched, and write a row. Nothing here makes a
// judgment. Deciding whether an image is really functional, and whether the alt
// text the site shipped is any good, is left to the review pass, which is the
// only part that needs a model.
//
// The one rule enforced here, from directives/00-corpus-goals.md: an image whose
// control announces nothing is skipped entirely and never written. This corpus
// pairs images with descriptions that were really shipped. A control with no
// name has no description to pair with.
//
// Usage:
//   node tools/harvest.mjs                     crawl every seed list
//   node tools/harvest.mjs --sector news       crawl one seed list
//   node tools/harvest.mjs --pages 40          cap pages fetched per host
//   node tools/harvest.mjs --follow 0          seeds only, follow no links
//   node tools/harvest.mjs --dry-run           report, write nothing
//   node tools/harvest.mjs --selftest          offline, no network
//   --seeds DIR, --pool FILE                   work somewhere else
//
// Politeness is not optional: robots.txt is honoured, one request at a time, one
// second between requests to the same host, and a cap on pages per host.
//
// Exit codes: 0 candidates were found, 1 nothing was found, 2 refused because
// the pool file or seeds are unusable, 3 bad usage or self-test failure.

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync,
  mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, outerHtml, ancestors, visibleText, imageName, accessibleName,
  collapse } from './html.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')

const USER_AGENT = 'benchmarks-ai-alt corpus harvester ' +
  '(+https://github.com/EqualifyEverything/benchmarks-ai-alt)'
const FETCH_TIMEOUT_MS = 20000
const MAX_REDIRECTS = 5
const MAX_PAGE_BYTES = 4 * 1024 * 1024
const HOST_DELAY_MS = 1000
const SURROUNDING_LIMIT = 240

// SVG elements that actually put marks on the canvas. An inline SVG with none of
// them draws nothing on its own, which in practice means its shape comes from a
// `<use>` reference to a sprite symbol defined elsewhere.
const SVG_PAINTS = /<(path|circle|rect|polygon|polyline|line|ellipse|text|image|foreignObject)\b/i

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

// Roles that make an element interactive for our purposes, mapped to the role we
// record. A custom control with role="button" is as functional as a `<button>`.
const ROLE_MAP = {
  link: 'link', button: 'button', checkbox: 'button', switch: 'button',
  tab: 'button', menuitem: 'link', menuitemcheckbox: 'button',
  radio: 'button', option: 'button',
}

// --- extraction ------------------------------------------------------------

const attr = (node, name) => {
  const v = node.attrs[name]
  return typeof v === 'string' ? v : null
}

function absolute(url, base) {
  if (url === null || url.trim() === '') return null
  try {
    return new URL(url.trim(), base).href
  } catch {
    return null
  }
}

// The interactive element an image sits inside, or null when there is none.
// `<input type="image">` and `<area>` are their own controls.
function interactiveAncestor(image) {
  if (image.tag === 'input' || image.tag === 'area') return image
  for (const node of ancestors(image)) {
    if (node.tag === 'a') {
      const href = attr(node, 'href')
      if (href !== null && href.trim() !== '') return node
    }
    if (node.tag === 'button' || node.tag === 'summary') return node
    const role = (attr(node, 'role') ?? '').toLowerCase().trim()
    if (role in ROLE_MAP) return node
    // Stop at the next block of content. An image ten divs away from a link is
    // not inside that link in any meaningful sense.
    if (node.tag === 'main' || node.tag === 'body' || node.tag === '#root') break
  }
  return null
}

function roleOf(control) {
  if (control.tag === 'a') return 'link'
  if (control.tag === 'button' || control.tag === 'summary') return 'button'
  if (control.tag === 'input') return 'input-image'
  if (control.tag === 'area') return 'area'
  const role = (attr(control, 'role') ?? '').toLowerCase().trim()
  return ROLE_MAP[role] ?? 'custom'
}

// A first guess at the taxonomy, from the markup alone. The review pass corrects
// it and assigns the two sub-types that need judgment, which are functional
// emojis and structural or reader controls.
function classify(control, image, pageUrl) {
  if (control.tag === 'input') {
    return { category: 2, subtype: 'form-control-or-image-button' }
  }
  if (control.tag === 'area') {
    return { category: 4, subtype: 'linked-complex-graphic-or-image-map' }
  }
  if (control.tag === 'a') {
    const target = absolute(attr(control, 'href'), pageUrl)
    if (target !== null) {
      try {
        const to = new URL(target)
        const from = new URL(pageUrl)
        const atRoot = to.pathname === '/' || to.pathname === ''
        // A link to the root of its own or another site, carrying an image, is
        // the logo pattern. Anything else is navigation to a document.
        if (atRoot && to.search === '' && to.host !== '') {
          return {
            category: 1,
            subtype: to.host === from.host
              ? 'linked-standalone-logo'
              : 'linked-standalone-logo',
          }
        }
      } catch { /* fall through to navigation */ }
    }
    return { category: 1, subtype: 'standalone-navigational-link' }
  }
  return { category: 2, subtype: 'action-or-toggle-icon' }
}

// The image URL, resolved against the page. Inline SVG has none: its bytes are
// the markup itself, which tools/fetch-images.mjs writes out.
function imageUrlFor(tree, image, pageUrl) {
  if (image.tag === 'svg') return null
  if (image.tag === 'area') {
    // An `<area>` describes a region of the image that declares `usemap`, so the
    // picture being described lives on a different element entirely.
    const map = ancestors(image).find((n) => n.tag === 'map')
    if (map === undefined) return null
    const name = attr(map, 'name') ?? attr(map, 'id')
    if (name === null) return null
    const owner = findNode(tree, (n) =>
      (n.tag === 'img' || n.tag === 'object') &&
      (attr(n, 'usemap') ?? '').replace(/^#/, '') === name)
    return owner === null ? null : absolute(attr(owner, 'src'), pageUrl)
  }
  const src = attr(image, 'src')
  if (src !== null && src.trim() !== '') return absolute(src, pageUrl)
  // Some responsive images ship only a srcset. Take its first candidate.
  const srcset = attr(image, 'srcset')
  if (srcset !== null && srcset.trim() !== '') {
    const first = srcset.split(',')[0].trim().split(/\s+/)[0]
    return absolute(first, pageUrl)
  }
  return null
}

// The alt text the site actually shipped, which is the thing under review. An
// empty string means `alt=""` was present and deliberate; null means no
// description of any kind was attached to the image element.
function observedAlt(image) {
  if (image.tag === 'svg') {
    const label = attr(image, 'aria-label')
    if (label !== null && collapse(label) !== '') return collapse(label)
    const { name, source } = imageName(image)
    return source === 'svg-title' ? name : null
  }
  const alt = attr(image, 'alt')
  return alt === null ? null : collapse(alt)
}

function surroundingText(control, image) {
  const inside = control === image ? '' : visibleText(control, { skip: image })
  if (inside !== '') return inside.slice(0, SURROUNDING_LIMIT)
  const parent = control.parent
  if (parent === null || parent === undefined) return ''
  return visibleText(parent, { skip: control }).slice(0, SURROUNDING_LIMIT)
}

function descendants(node) {
  const out = []
  const walk = (n) => {
    for (const child of n.children) {
      if (child.text !== undefined) continue
      out.push(child)
      walk(child)
    }
  }
  walk(node)
  return out
}

// A slice of a page is not a document. Inside HTML an `<svg>` inherits its
// namespaces from the parser and its size from CSS; written to a file on its own
// it has to declare both or it renders as nothing.
function asSvgDocument(svg, viewBox) {
  const openEnd = svg.indexOf('>')
  const open = svg.slice(0, openEnd)
  const has = (name) => new RegExp(`\\s${name}\\s*=`, 'i').test(open)
  let add = ''
  if (!has('xmlns')) add += ` xmlns="${SVG_NS}"`
  if (/xlink:/i.test(svg) && !has('xmlns:xlink')) {
    add += ` xmlns:xlink="${XLINK_NS}"`
  }
  if (!has('viewBox') && typeof viewBox === 'string' && viewBox.trim() !== '') {
    add += ` viewBox="${viewBox.trim()}"`
  }
  return open + add + svg.slice(openEnd)
}

// A standalone SVG document for an inline SVG: its own markup, plus the sprite
// symbols its `<use>` elements point at, copied into a `<defs>` block. This is
// what makes the archived file a picture instead of a blank rectangle, and it is
// why 28 percent of named controls are collectable at all.
//
// Null means the graphic cannot be rebuilt from this page: the sprite lives in
// another file, or the element paints nothing and references nothing. Unlike
// `element_html`, which is always a character-exact slice, the archived image is
// allowed to be assembled. It has to be: an SVG needs its namespace declared.
export function standaloneSvg(tree, node) {
  const html = outerHtml(tree, node)
  const openEnd = html.indexOf('>')
  if (!/^<svg[\s/>]/i.test(html) || openEnd === -1) return null
  if (html.lastIndexOf('</svg>') < openEnd) return null

  const defs = []
  let viewBox = null
  for (const el of descendants(node)) {
    if (el.tag !== 'use') continue
    const ref = (attr(el, 'href') ?? attr(el, 'xlink:href') ?? '').trim()
    // An external reference, `href="/sprite.svg#icon"`, needs a request we are
    // not making and bytes this page never carried.
    if (!ref.startsWith('#') || ref.length < 2) return null
    const target = tree.byId.get(ref.slice(1))
    if (target === undefined) return null
    const symbol = outerHtml(tree, target)
    if (!SVG_PAINTS.test(symbol)) return null
    // The symbol carries the coordinate space the icon was drawn in. Without it
    // the shape lands in a corner of a default-sized canvas.
    if (viewBox === null) viewBox = attr(target, 'viewbox')
    if (!defs.includes(symbol)) defs.push(symbol)
  }

  if (defs.length === 0) {
    return SVG_PAINTS.test(html) ? asSvgDocument(html, null) : null
  }
  const withDefs = html.slice(0, openEnd + 1) +
    `<defs>${defs.join('')}</defs>` + html.slice(openEnd + 1)
  return asSvgDocument(withDefs, viewBox)
}

function findNode(tree, pred) {
  let hit = null
  const walk = (n) => {
    for (const child of n.children) {
      if (child.text !== undefined) continue
      if (hit === null && pred(child)) hit = child
      if (hit === null) walk(child)
    }
  }
  walk(tree.root)
  return hit
}

function eachElement(tree, visit) {
  const walk = (n) => {
    for (const child of n.children) {
      if (child.text !== undefined) continue
      visit(child)
      walk(child)
    }
  }
  walk(tree.root)
}

const IMPLEMENTATION = {
  img: 'img', svg: 'inline-svg', input: 'input-image', area: 'area',
}

function isImage(node) {
  if (node.tag === 'img' || node.tag === 'area') return true
  if (node.tag === 'svg') return true
  if (node.tag === 'input') {
    return (attr(node, 'type') ?? '').toLowerCase().trim() === 'image'
  }
  return false
}

// Pull every candidate out of one page. Pure: no network, no filesystem, which
// is what lets the self-test run the real code path against fixtures.
export function harvestDoc(doc, pageUrl, sector, retrieved) {
  const tree = parse(doc)
  const found = []
  const skipped = { noControl: 0, noName: 0, noImage: 0, spriteMissing: 0,
    duplicateOnPage: 0 }
  const seen = new Set()
  let domain
  try {
    domain = new URL(pageUrl).host.toLowerCase().replace(/^www\./, '')
  } catch {
    return { items: [], skipped, error: `unusable page URL ${pageUrl}` }
  }

  eachElement(tree, (node) => {
    if (!isImage(node)) return
    // An inline SVG nested in another SVG is one graphic, not two.
    if (node.tag === 'svg' && ancestors(node).some((a) => a.tag === 'svg')) return

    const control = interactiveAncestor(node)
    if (control === null) { skipped.noControl++; return }

    const { name, source } = accessibleName(tree, control, node)
    if (name === '') { skipped.noName++; return }

    const imageUrl = imageUrlFor(tree, node, pageUrl)
    if (imageUrl === null && node.tag !== 'svg') { skipped.noImage++; return }

    // An inline SVG is archived from the page's own bytes, sprite symbols and
    // all. When that cannot be done the graphic is a blank rectangle, and a
    // blank rectangle cannot be judged against its alt text, so it is not an
    // item. Same reason directive 00 leaves icon fonts out.
    let svg = null
    if (node.tag === 'svg') {
      svg = standaloneSvg(tree, node)
      if (svg === null) { skipped.spriteMissing++; return }
    }

    const role = roleOf(control)
    const key = `${imageUrl ?? outerHtml(tree, node)}|${role}|${name}`
    if (seen.has(key)) { skipped.duplicateOnPage++; return }
    seen.add(key)

    const { category, subtype } = classify(control, node, pageUrl)
    found.push({
      id: null,
      status: 'unreviewed',
      page_url: pageUrl,
      domain,
      sector,
      image_url: imageUrl,
      image_svg: svg,
      image_file: null,
      image_sha256: null,
      implementation: IMPLEMENTATION[node.tag],
      element_role: role,
      element_html: outerHtml(tree, control),
      surrounding_text: surroundingText(control, node),
      observed_alt: observedAlt(node),
      accessible_name: name,
      accessible_name_source: source,
      category,
      subtype,
      retrieved,
      review_verdict: null,
      review_reason: null,
      alt_quality: null,
    })
  })

  return { items: found, skipped }
}

// Same-host links worth following from a page, in document order.
export function outboundLinks(doc, pageUrl) {
  const tree = parse(doc)
  let here
  try { here = new URL(pageUrl) } catch { return [] }
  const out = []
  const seen = new Set()
  eachElement(tree, (node) => {
    if (node.tag !== 'a') return
    const href = absolute(attr(node, 'href'), pageUrl)
    if (href === null) return
    let url
    try { url = new URL(href) } catch { return }
    if (url.host !== here.host) return
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    if (/\.(pdf|zip|jpg|jpeg|png|gif|svg|mp4|mp3|css|js|xml|json)$/i
      .test(url.pathname)) return
    url.hash = ''
    if (url.href === here.href || seen.has(url.href)) return
    seen.add(url.href)
    out.push(url.href)
  })
  return out
}

// --- robots.txt ------------------------------------------------------------

// Enough of the exclusion standard to be a good citizen: the groups that apply
// to us, longest matching rule wins, Allow beats Disallow at equal length. A
// robots.txt we cannot fetch is treated as permissive, which is the convention.
export function parseRobots(text) {
  const groups = []
  let current = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (line === '') continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (field === 'user-agent') {
      if (current === null || current.rules.length > 0) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
    } else if ((field === 'allow' || field === 'disallow') && current !== null) {
      current.rules.push({ allow: field === 'allow', path: value })
    }
  }

  const mine = groups.filter((g) => g.agents.some((a) =>
    a === '*' || USER_AGENT.toLowerCase().includes(a)))
  const specific = groups.filter((g) => g.agents.some((a) =>
    a !== '*' && USER_AGENT.toLowerCase().includes(a)))
  const rules = (specific.length > 0 ? specific : mine).flatMap((g) => g.rules)

  return {
    allows(path) {
      let best = null
      for (const rule of rules) {
        if (rule.path === '') continue
        if (!matchesRobotsPath(rule.path, path)) continue
        if (best === null || rule.path.length > best.path.length ||
            (rule.path.length === best.path.length && rule.allow)) {
          best = rule
        }
      }
      return best === null ? true : best.allow
    },
  }
}

function matchesRobotsPath(pattern, path) {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const parts = body.split('*')
  let at = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part === '') continue
    const found = i === 0 ? (path.startsWith(part) ? 0 : -1) : path.indexOf(part, at)
    if (found === -1) return false
    at = found + part.length
  }
  return anchored ? at === path.length : true
}

// --- seeds and pool --------------------------------------------------------

export function loadSeeds(seedsDir, only) {
  if (!existsSync(seedsDir)) return { seeds: [], errors: [`no seeds at ${seedsDir}`] }
  const errors = []
  const seeds = []
  const files = readdirSync(seedsDir).filter((n) => n.endsWith('.txt')).sort()
  for (const file of files) {
    const sector = basename(file, '.txt')
    if (only !== null && sector !== only) continue
    const text = readFileSync(join(seedsDir, file), 'utf8')
    text.split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*$/, '').trim()
      if (line === '') return
      try {
        const url = new URL(line)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
        seeds.push({ url: url.href, sector })
      } catch {
        errors.push(`${file}:${i + 1}: not an http URL, "${line}"`)
      }
    })
  }
  if (only !== null && seeds.length === 0 && files.length > 0) {
    errors.push(`no seed list named ${only}.txt`)
  }
  return { seeds, errors }
}

function readPool(poolPath) {
  if (!existsSync(poolPath)) return { rows: [], errors: [] }
  const rows = []
  const errors = []
  readFileSync(poolPath, 'utf8').split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (line === '') return
    try { rows.push(JSON.parse(line)) } catch (e) {
      errors.push(`${poolPath}:${i + 1}: invalid JSON, ${e.message}`)
    }
  })
  return { rows, errors }
}

const nextIdFrom = (rows) => {
  let highest = 0
  for (const row of rows) {
    const m = /^fi-(\d{4,})$/.exec(typeof row.id === 'string' ? row.id : '')
    if (m) highest = Math.max(highest, Number(m[1]))
  }
  return highest + 1
}

const formatId = (n) => `fi-${String(n).padStart(4, '0')}`

// A candidate already in the pool. Keyed on the image and the control's name, so
// re-crawling a page adds what changed and nothing else.
const poolKey = (row) =>
  `${row.page_url}|${row.image_url ?? row.element_html}|${row.element_role}|` +
  `${row.accessible_name}`

// --- network ---------------------------------------------------------------

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function getText(url, { manual = false } = {}) {
  let res
  try {
    res = await fetch(url, {
      redirect: manual ? 'manual' : 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    return { error: `request failed, ${e.message}` }
  }
  // A redirect is reported rather than followed, so the caller can consult the
  // destination's robots.txt before asking for it. Following redirects blindly is
  // how a crawler ends up on a host that never gave it permission: a link on one
  // retailer's site redirecting to a sibling brand's, for one real example.
  if (manual && res.status >= 300 && res.status < 400) {
    const to = absolute(res.headers.get('location'), url)
    if (to === null) return { error: `HTTP ${res.status} with no usable location` }
    return { redirect: to }
  }
  if (!res.ok) return { error: `HTTP ${res.status}` }
  const type = (res.headers.get('content-type') ?? '').toLowerCase()
  if (type !== '' && !type.includes('html') && !type.includes('xml')) {
    return { error: `not HTML, content type ${type.split(';')[0]}` }
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_PAGE_BYTES) {
    return { error: `${bytes.length} bytes, over the ${MAX_PAGE_BYTES} limit` }
  }
  // res.url is the URL after redirects, which is the one the markup is relative
  // to. Recording the pre-redirect URL would break every relative image path.
  return { doc: bytes.toString('utf8'), finalUrl: res.url || url }
}

// Walk a redirect chain one hop at a time, asking permission before each hop.
// Pulled out and given its collaborators as arguments so the self-test can drive
// the real sequencing with no network.
export async function followRedirects(start, { allowed, get, max = MAX_REDIRECTS }) {
  let url = start
  const chain = [start]
  for (let hop = 0; hop <= max; hop++) {
    const permission = await allowed(url)
    if (permission !== true) return { error: permission, chain }
    const got = await get(url)
    if (got.redirect === undefined) return { ...got, chain }
    if (chain.includes(got.redirect)) return { error: 'redirect loop', chain }
    url = got.redirect
    chain.push(url)
  }
  return { error: `more than ${max} redirects`, chain }
}

function makeFetcher() {
  const lastAt = new Map()
  const robots = new Map()
  const fetcher = {
    // True, or the reason this URL is off limits. Consulted once per hop, so a
    // redirect to another host is checked against that host's rules.
    async allowed(url) {
      let at
      try { at = new URL(url) } catch { return 'unusable URL' }
      const origin = at.origin
      if (!robots.has(origin)) {
        await fetcher.wait(origin)
        const got = await getText(`${origin}/robots.txt`)
        robots.set(origin, got.error !== undefined
          ? parseRobots('')
          : parseRobots(got.doc))
      }
      return robots.get(origin).allows(at.pathname + at.search)
        ? true
        : 'disallowed by robots.txt'
    },
    async page(url) {
      return followRedirects(url, {
        allowed: (at) => fetcher.allowed(at),
        get: async (at) => {
          await fetcher.wait(new URL(at).origin)
          return getText(at, { manual: true })
        },
      })
    },
    async wait(host) {
      const last = lastAt.get(host)
      if (last !== undefined) {
        const since = Date.now() - last
        if (since < HOST_DELAY_MS) await sleep(HOST_DELAY_MS - since)
      }
      lastAt.set(host, Date.now())
    },
  }
  return fetcher
}

// --- crawl -----------------------------------------------------------------

export async function crawl(seeds, fetcher, opts) {
  const { pagesPerHost, follow, retrieved, onPage } = opts
  const queues = new Map()
  for (const seed of seeds) {
    let host
    try { host = new URL(seed.url).host } catch { continue }
    if (!queues.has(host)) queues.set(host, { pending: [], sector: seed.sector })
    queues.get(host).pending.push(seed.url)
  }

  const items = []
  const totals = { pages: 0, failed: 0, disallowed: 0 }
  const skipped = { noControl: 0, noName: 0, noImage: 0, spriteMissing: 0,
    duplicateOnPage: 0 }

  for (const [host, queue] of queues) {
    const done = new Set()
    let followed = 0
    while (queue.pending.length > 0 && done.size < pagesPerHost) {
      const url = queue.pending.shift()
      if (done.has(url)) continue
      done.add(url)

      const got = await fetcher.page(url)
      if (got.error !== undefined) {
        if (got.error.includes('robots')) totals.disallowed++
        else totals.failed++
        if (onPage) onPage({ url, error: got.error })
        continue
      }
      totals.pages++
      const pageUrl = got.finalUrl ?? url
      // A redirect means we asked for one URL and read another. Marking the
      // destination done as well stops us fetching the same page twice when a
      // link points at where the redirect landed, which is common: /docs/stable/
      // redirecting to /docs/6.1/ and the page then linking to /docs/6.1/.
      done.add(pageUrl)
      const result = harvestDoc(got.doc, pageUrl, queue.sector, retrieved)
      for (const key of Object.keys(skipped)) skipped[key] += result.skipped[key]
      items.push(...result.items)
      if (onPage) onPage({ url: pageUrl, found: result.items.length })

      if (followed < follow) {
        for (const link of outboundLinks(got.doc, pageUrl)) {
          if (done.has(link) || queue.pending.includes(link)) continue
          queue.pending.push(link)
          followed++
          if (followed >= follow) break
        }
      }
    }
    void host
  }

  return { items, totals, skipped }
}

// --- self-test -------------------------------------------------------------

const FIXTURE_PAGES = {
  'shop.html': `<!doctype html><html><body>
<svg hidden><symbol id="i-search" viewBox="0 0 16 16"><path d="M1 1 8 8"/></symbol></svg>
<header>
  <a href="/"><img src="/img/logo.png" alt="Northwind"></a>
  <a href="/cart"><img src="/img/cart.svg" alt="Cart, 3 items"></a>
  <a href="/help"><img src="/img/q.svg" alt="">Help centre</a>
  <a href="/x"><img src="/img/unnamed.svg"></a>
  <button type="button"><svg viewBox="0 0 2 2"><title>Close</title><path d="M0 0 2 2"/></svg></button>
  <button type="button"><svg class="i" aria-label="Search site"><use xlink:href="#i-search"></use></svg></button>
  <button type="button"><svg class="i" aria-label="Filter"><use href="/sprite.svg#i-filter"></use></svg></button>
  <form action="/s"><input type="image" src="/img/go.gif" alt="Search"></form>
</header>
<p>Body text with <a href="/deep/page">a text link</a> and no image.</p>
<img src="/img/decorative.png" alt="A field of wheat">
<map name="regions">
  <area shape="rect" coords="0,0,9,9" href="/north" alt="North region">
  <area shape="rect" coords="9,0,18,9" href="/south" alt="South region">
</map>
<img src="/img/map.png" usemap="#regions" alt="Sales regions">
</body></html>`,
  'dupes.html': `<!doctype html><html><body>
<a href="/pay"><img src="/b.gif" alt="Buy now"></a>
<a href="/pay"><img src="/b.gif" alt="Buy now"></a>
<a href="/pay"><img src="/b.gif" alt="Buy now"></a>
</body></html>`,
}

async function selftest() {
  let failures = 0
  const check = (name, cond, detail) => {
    if (cond) process.stdout.write(`PASS ${name}\n`)
    else { process.stdout.write(`FAIL ${name}: ${detail ?? ''}\n`); failures++ }
  }
  const dir = mkdtempSync(join(tmpdir(), 'alt-harvest-'))

  const page = harvestDoc(FIXTURE_PAGES['shop.html'],
    'https://shop.example.com/', 'commerce', '2026-08-27')
  const by = (id) => page.items.find((i) => i.accessible_name === id)

  check('every named functional image is found, and nothing else',
    page.items.length === 8,
    `found ${page.items.length}: ${page.items.map((i) => i.accessible_name).join(' | ')}`)

  check('an unnamed control is skipped, not recorded',
    page.skipped.noName === 1 && by('') === undefined,
    `noName ${page.skipped.noName}`)

  // The sprite pattern is 28 percent of the named controls a real harvest finds.
  // An earlier version skipped all of it, and the version before that archived
  // every one of them as a blank rectangle.
  const sprite = by('Search site')
  check('a sprite defined on the page is resolved into a standalone graphic',
    sprite !== undefined && sprite.image_svg !== null &&
    sprite.image_svg.includes('xmlns="http://www.w3.org/2000/svg"') &&
    sprite.image_svg.includes('xmlns:xlink=') &&
    sprite.image_svg.includes('viewBox="0 0 16 16"') &&
    sprite.image_svg.includes('<defs><symbol id="i-search"') &&
    SVG_PAINTS.test(sprite.image_svg),
    JSON.stringify(sprite?.image_svg))

  check('element_html stays a slice even when the graphic is assembled',
    sprite !== undefined &&
    FIXTURE_PAGES['shop.html'].includes(sprite.element_html) &&
    !FIXTURE_PAGES['shop.html'].includes(sprite.image_svg),
    JSON.stringify(sprite?.element_html))

  check('a sprite in another file is not collected',
    page.skipped.spriteMissing === 1 && by('Filter') === undefined,
    `spriteMissing ${page.skipped.spriteMissing}`)

  check('an image outside any control is skipped',
    page.skipped.noControl >= 1 &&
    page.items.every((i) => i.accessible_name !== 'A field of wheat'),
    `noControl ${page.skipped.noControl}`)

  check('element_html is an exact slice of the page source',
    page.items.every((i) => FIXTURE_PAGES['shop.html'].includes(i.element_html)),
    page.items.map((i) => i.element_html).join(' ~ '))

  const logo = by('Northwind')
  check('a link to the site root is classified as a logo',
    logo !== undefined && logo.category === 1 &&
    logo.subtype === 'linked-standalone-logo' &&
    logo.image_url === 'https://shop.example.com/img/logo.png' &&
    logo.observed_alt === 'Northwind' && logo.accessible_name_source === 'alt',
    JSON.stringify(logo))

  const cart = by('Cart, 3 items')
  check('a link to a document is classified as navigation',
    cart !== undefined && cart.subtype === 'standalone-navigational-link',
    JSON.stringify(cart?.subtype))

  const help = by('Help centre')
  check('an empty alt named by the link text is kept, with the text as source',
    help !== undefined && help.observed_alt === '' &&
    help.accessible_name_source === 'control-text' &&
    help.surrounding_text === 'Help centre',
    JSON.stringify(help))

  const close = by('Close')
  check('an inline SVG in a button has no image URL and keeps its markup',
    close !== undefined && close.implementation === 'inline-svg' &&
    close.image_url === null && close.subtype === 'action-or-toggle-icon' &&
    close.observed_alt === 'Close' && close.element_html.includes('<svg'),
    JSON.stringify(close))

  const search = by('Search')
  check('an image button is its own control',
    search !== undefined && search.implementation === 'input-image' &&
    search.element_role === 'input-image' &&
    search.subtype === 'form-control-or-image-button' &&
    search.image_url === 'https://shop.example.com/img/go.gif',
    JSON.stringify(search))

  const north = by('North region')
  check('an area takes its image from the element declaring usemap',
    north !== undefined && north.implementation === 'area' &&
    north.category === 4 &&
    north.image_url === 'https://shop.example.com/img/map.png',
    JSON.stringify(north))

  const dupes = harvestDoc(FIXTURE_PAGES['dupes.html'],
    'https://pay.example.com/', 'commerce', '2026-08-27')
  check('identical controls on one page collapse to a single candidate',
    dupes.items.length === 1 && dupes.skipped.duplicateOnPage === 2,
    `${dupes.items.length} item(s), ${dupes.skipped.duplicateOnPage} folded`)

  // robots.txt, including the longest-match rule that decides real cases.
  {
    const robots = parseRobots([
      'User-agent: *', 'Disallow: /private', 'Allow: /private/public',
      'Disallow: /*.json$',
    ].join('\n'))
    check('robots.txt allows, disallows and prefers the longest match',
      robots.allows('/open') && !robots.allows('/private/x') &&
      robots.allows('/private/public/y') && !robots.allows('/a/b.json') &&
      robots.allows('/a/b.json.html'),
      'see rules')
  }
  {
    const robots = parseRobots('User-agent: *\nDisallow: /\n')
    check('a blanket disallow blocks everything', !robots.allows('/anything'))
  }
  {
    check('an unreachable robots.txt is treated as permissive',
      parseRobots('').allows('/anything'))
  }

  // Seed loading, including a bad line being reported rather than crawled.
  {
    const seedsDir = join(dir, 'seeds')
    mkdirSync(seedsDir, { recursive: true })
    writeFileSync(join(seedsDir, 'news.txt'),
      '# a comment\nhttps://a.example.com/\n\nnot a url\nhttps://b.example.com/x\n')
    writeFileSync(join(seedsDir, 'docs.txt'), 'https://c.example.com/\n')
    const all = loadSeeds(seedsDir, null)
    const one = loadSeeds(seedsDir, 'news')
    check('seed lists load, carry their sector, and report bad lines',
      all.seeds.length === 3 && all.errors.length === 1 &&
      one.seeds.length === 2 && one.seeds[0].sector === 'news',
      `${all.seeds.length} seeds, ${all.errors.join('; ')}`)
  }

  // The crawl: robots respected, per-host cap obeyed, links followed once.
  {
    const fetched = []
    const fetcher = {
      async page(url) {
        fetched.push(url)
        if (url.includes('/blocked')) return { error: 'disallowed by robots.txt' }
        if (url.includes('/gone')) return { error: 'HTTP 404' }
        return {
          doc: '<a href="/next"><img src="/i.png" alt="Next page"></a>' +
            '<a href="/other">text</a>',
          finalUrl: url,
        }
      },
    }
    const r = await crawl([
      { url: 'https://h.example.com/', sector: 'docs' },
      { url: 'https://h.example.com/blocked', sector: 'docs' },
      { url: 'https://h.example.com/gone', sector: 'docs' },
    ], fetcher, { pagesPerHost: 4, follow: 1, retrieved: '2026-08-27' })
    check('the crawl respects robots, counts failures, and follows one link',
      r.totals.disallowed === 1 && r.totals.failed === 1 && r.totals.pages === 2 &&
      r.items.length === 2 && fetched.length === 4,
      JSON.stringify(r.totals) + ` fetched ${fetched.length}`)
  }
  {
    const fetcher = {
      async page(url) {
        return {
          doc: '<a href="/a"><img src="/i.png" alt="A"></a>' +
            '<a href="/b">b</a><a href="/c">c</a><a href="/d">d</a>',
          finalUrl: url,
        }
      },
    }
    const r = await crawl([{ url: 'https://cap.example.com/', sector: 'docs' }],
      fetcher, { pagesPerHost: 2, follow: 10, retrieved: '2026-08-27' })
    check('the per-host page cap stops the crawl',
      r.totals.pages === 2, `${r.totals.pages} pages`)
  }
  {
    // Redirects are walked one hop at a time so permission is asked before each
    // one. A crawler that follows redirects blindly ends up on hosts that never
    // gave it permission.
    const asked = []
    const allowed = async (url) => {
      asked.push(url)
      return url.includes('//off.example.com') ? 'disallowed by robots.txt' : true
    }
    const get = async (url) => url.endsWith('/here')
      ? { doc: '<p>arrived</p>', finalUrl: url }
      : { redirect: 'https://a.example.com/here' }

    const r = await followRedirects('https://a.example.com/start',
      { allowed, get })
    check('a redirect is followed and permission asked at every hop',
      r.doc === '<p>arrived</p>' && asked.length === 2 &&
      r.chain.length === 2 && r.finalUrl === 'https://a.example.com/here',
      JSON.stringify({ asked, chain: r.chain }))

    const off = await followRedirects('https://a.example.com/start', {
      allowed,
      get: async () => ({ redirect: 'https://off.example.com/here' }),
    })
    check('a redirect to a host that refuses crawlers is not fetched',
      off.error === 'disallowed by robots.txt' && off.doc === undefined,
      JSON.stringify(off))

    const loop = await followRedirects('https://a.example.com/one', {
      allowed,
      get: async (url) => ({
        redirect: url.endsWith('/one')
          ? 'https://a.example.com/two'
          : 'https://a.example.com/one',
      }),
    })
    check('a redirect loop stops rather than spinning',
      loop.error === 'redirect loop', JSON.stringify(loop))

    const long = await followRedirects('https://a.example.com/0', {
      allowed,
      get: async (url) => ({
        redirect: `https://a.example.com/${Number(url.split('/').pop()) + 1}`,
      }),
    })
    check('a redirect chain is bounded',
      long.error === `more than ${MAX_REDIRECTS} redirects`, JSON.stringify(long))
  }
  {
    // A seed that redirects, to a page that then links to where the redirect
    // landed. Fetching that twice is rude and yields nothing but duplicates.
    const fetched = []
    const fetcher = {
      async page(url) {
        fetched.push(url)
        const landed = 'https://r.example.com/v2/'
        return {
          doc: `<a href="/v2/"><img src="/i.png" alt="Version 2"></a>`,
          finalUrl: url === 'https://r.example.com/latest/' ? landed : url,
        }
      },
    }
    const r = await crawl([{ url: 'https://r.example.com/latest/', sector: 'docs' }],
      fetcher, { pagesPerHost: 4, follow: 4, retrieved: '2026-08-27' })
    check('a page reached by redirect is not fetched again by its own link',
      fetched.length === 1 && r.totals.pages === 1,
      `fetched ${JSON.stringify(fetched)}`)
  }

  rmSync(dir, { recursive: true, force: true })
  process.stdout.write(failures === 0
    ? '\nharvest self-test passed\n'
    : `\nharvest self-test failed, ${failures} case(s)\n`)
  return failures === 0 ? 0 : 3
}

// --- entry point -----------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10)

async function main(argv) {
  let seedsDir = join(PROJECT, 'seeds')
  let poolPath = join(PROJECT, 'pool', 'candidates.jsonl')
  let only = null
  let pagesPerHost = 12
  let follow = 8
  let dryRun = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--selftest') return selftest()
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--sector') only = argv[++i] ?? null
    else if (arg === '--pages') pagesPerHost = Number(argv[++i])
    else if (arg === '--follow') follow = Number(argv[++i])
    else if (arg === '--seeds') seedsDir = resolve(argv[++i] ?? '')
    else if (arg === '--pool') poolPath = resolve(argv[++i] ?? '')
    else {
      process.stderr.write(`harvest.mjs: unknown argument "${arg}"\n` +
        'usage: harvest.mjs [--sector NAME] [--pages N] [--follow N] ' +
        '[--dry-run] [--seeds DIR] [--pool FILE] [--selftest]\n')
      return 3
    }
  }
  if (!Number.isFinite(pagesPerHost) || pagesPerHost < 1 ||
      !Number.isFinite(follow) || follow < 0) {
    process.stderr.write('harvest.mjs: --pages must be 1 or more and --follow 0 ' +
      'or more\n')
    return 3
  }

  const { seeds, errors: seedErrors } = loadSeeds(seedsDir, only)
  for (const e of seedErrors) process.stdout.write(`  ${e}\n`)
  if (seeds.length === 0) {
    process.stdout.write('no seeds to crawl. Add URLs to seeds/SECTOR.txt, one ' +
      'per line.\n')
    return 2
  }

  const { rows: existing, errors: poolErrors } = readPool(poolPath)
  if (poolErrors.length > 0) {
    process.stdout.write('refused to harvest, the pool file is unreadable:\n')
    for (const e of poolErrors) process.stdout.write(`  ${e}\n`)
    return 2
  }

  const hosts = new Set(seeds.map((s) => {
    try { return new URL(s.url).host } catch { return '?' }
  }))
  process.stdout.write(`harvest: ${seeds.length} seed(s) across ${hosts.size} ` +
    `host(s), up to ${pagesPerHost} page(s) each, following up to ${follow} ` +
    'link(s) per host\n\n')

  const { items, totals, skipped } = await crawl(seeds, makeFetcher(), {
    pagesPerHost,
    follow,
    retrieved: today(),
    onPage: ({ url, error, found }) => {
      process.stdout.write(error !== undefined
        ? `  skip  ${url}  ${error}\n`
        : `  ${String(found).padStart(4)}  ${url}\n`)
    },
  })

  const known = new Set(existing.map(poolKey))
  const fresh = []
  let already = 0
  for (const item of items) {
    if (known.has(poolKey(item))) { already++; continue }
    known.add(poolKey(item))
    fresh.push(item)
  }

  let next = nextIdFrom(existing)
  for (const item of fresh) item.id = formatId(next++)

  process.stdout.write(`\npages fetched:      ${totals.pages}\n`)
  process.stdout.write(`pages failed:       ${totals.failed}\n`)
  process.stdout.write(`pages disallowed:   ${totals.disallowed}\n`)
  process.stdout.write(`candidates found:   ${items.length}\n`)
  process.stdout.write(`already in pool:    ${already}\n`)
  process.stdout.write(`new candidates:     ${fresh.length}\n`)
  process.stdout.write('\nskipped while reading the pages:\n')
  process.stdout.write(`  no interactive ancestor:  ${skipped.noControl}\n`)
  process.stdout.write(`  no accessible name:       ${skipped.noName}\n`)
  process.stdout.write(`  no image URL:             ${skipped.noImage}\n`)
  process.stdout.write(`  sprite not on the page:   ${skipped.spriteMissing}\n`)
  process.stdout.write(`  duplicate on the page:    ${skipped.duplicateOnPage}\n`)

  if (fresh.length === 0) {
    process.stdout.write('\nnothing new. Add seeds, or raise --pages.\n')
    return 1
  }
  if (dryRun) {
    process.stdout.write('\nnothing written, --dry-run\n')
    return 0
  }

  mkdirSync(dirname(poolPath), { recursive: true })
  const lines = fresh.map((r) => JSON.stringify(r)).join('\n') + '\n'
  if (existsSync(poolPath)) appendFileSync(poolPath, lines)
  else writeFileSync(poolPath, lines)
  process.stdout.write(`\nappended ${fresh.length} candidate(s) to ` +
    `${poolPath.replace(PROJECT + '/', '')}\n`)
  process.stdout.write('Next: node tools/fetch-images.mjs, then ' +
    'node tools/select.mjs\n')
  return 0
}

process.exit(await main(process.argv.slice(2)))
