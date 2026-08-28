#!/usr/bin/env node
// A small, tolerant HTML reader, and the accessible name computation built on it.
//
// Why this exists rather than a dependency: this project has none, and the job is
// narrow. We do not need a conforming parser. We need three things.
//
//   1. Offsets. Every element remembers where it started and ended in the source
//      text, so `element_html` is a slice of the page we actually fetched rather
//      than markup somebody retyped. That is the whole reason the harvester
//      replaced an agent: a slice can be checked against the page, and a
//      transcription cannot.
//   2. Ancestry. To know whether an image sits inside a link or a button.
//   3. Text. To know what a control announces, which decides whether the right
//      alt text is a label or an empty attribute.
//
// What it deliberately does not do: no CSS, no scripting, no character encoding
// detection beyond UTF-8, no foster parenting, no template contents. Malformed
// markup is closed tolerantly rather than corrected. If a page needs more than
// this to read, the harvester skips it instead of guessing.
//
// Usage:
//   import { parse, visibleText, accessibleName } from './html.mjs'
//   node tools/html.mjs --selftest
//
// Exit codes, when run directly: 0 self-test passed, 3 self-test failed.

// Elements with no closing tag. An `<img>` never has children, so text found
// after one belongs to its parent.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'])

// Elements whose content is text, not markup. A `<` inside one of these opens
// nothing, which matters because inline scripts are full of them.
const RAW = new Set(['script', 'style', 'textarea'])

// Elements that end a previous open element of the same kind. Real pages omit
// these closing tags constantly, and without this the stack grows until one
// stray `</div>` unwinds half the document.
const CLOSED_BY = {
  li: ['li'],
  p: ['p'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  tr: ['tr', 'td', 'th'],
  option: ['option'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
}

// Subtrees that contribute nothing to what a control announces. `svg` is here
// because an inline icon's `<title>` is an accessible name, not visible text, and
// it is read separately below.
const NO_TEXT = new Set(['script', 'style', 'svg', 'img', 'input', 'area',
  'select', 'head', 'noscript', 'template'])

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«',
  raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“',
  rdquo: '”', times: '×', copy: '©', reg: '®',
  trade: '™', middot: '·', bull: '•', deg: '°',
}

export function decodeEntities(text) {
  if (!text.includes('&')) return text
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (whole, body) => {
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10)
        if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole
        try { return String.fromCodePoint(code) } catch { return whole }
      }
      const named = NAMED_ENTITIES[body.toLowerCase()]
      return named === undefined ? whole : named
    })
}

// Runs of whitespace are one space, and the edges are trimmed. This is what
// makes recorded surrounding text comparable between a page that indents its
// markup and one that ships it minified.
export const collapse = (text) => text.replace(/\s+/g, ' ').trim()

// --- parsing ---------------------------------------------------------------

const makeNode = (tag, attrs, start) => ({
  tag, attrs, start, end: -1, contentStart: -1, contentEnd: -1,
  parent: null, children: [],
})

function readAttrs(doc, at) {
  const attrs = {}
  let i = at
  for (;;) {
    while (i < doc.length && /\s/.test(doc[i])) i++
    if (i >= doc.length) return { attrs, next: i, selfClosing: false }
    if (doc[i] === '>') return { attrs, next: i + 1, selfClosing: false }
    if (doc[i] === '/' && doc[i + 1] === '>') {
      return { attrs, next: i + 2, selfClosing: true }
    }
    // A lone `/` inside the tag, or a stray character, is skipped rather than
    // treated as a name, which keeps `<br />` and `<a / href=...>` both readable.
    if (doc[i] === '/' || doc[i] === '=') { i++; continue }

    const nameStart = i
    while (i < doc.length && !/[\s=>/]/.test(doc[i])) i++
    const name = doc.slice(nameStart, i).toLowerCase()
    if (name === '') { i++; continue }

    let j = i
    while (j < doc.length && /\s/.test(doc[j])) j++
    if (doc[j] !== '=') { attrs[name] = ''; continue }
    j++
    while (j < doc.length && /\s/.test(doc[j])) j++

    const quote = doc[j]
    if (quote === '"' || quote === "'") {
      const close = doc.indexOf(quote, j + 1)
      const end = close === -1 ? doc.length : close
      attrs[name] = decodeEntities(doc.slice(j + 1, end))
      i = end + 1
    } else {
      const valueStart = j
      while (j < doc.length && !/[\s>]/.test(doc[j])) j++
      attrs[name] = decodeEntities(doc.slice(valueStart, j))
      i = j
    }
  }
}

// Parse a document into a tree. Returns the synthetic root, a map of id to node,
// and the source text, which callers slice with `outerHtml`.
export function parse(doc) {
  const root = makeNode('#root', {}, 0)
  root.contentStart = 0
  const byId = new Map()
  const stack = [root]
  const open = () => stack[stack.length - 1]

  const addText = (raw, start, end) => {
    const text = collapse(decodeEntities(raw))
    if (text === '') return
    open().children.push({ text, start, end })
  }

  // The nearest open element with this tag, searching from the innermost out.
  // Searching from the outside in is the bug this replaced: a `</div>` inside a
  // link nested in a div closed the outer div, which cut the link's slice short
  // at the inner close tag and reparented everything after it. It cost 14 percent
  // of the first real harvest's markup slices.
  const nearest = (tag) => {
    for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) return k
    return -1
  }

  // Pop to the nearest matching open element, as though a close tag appeared at
  // `pos`. A close tag matching nothing is ignored, which is what browsers do and
  // what keeps one typo from reparenting the rest of the page.
  const close = (upTo, pos) => {
    const at = nearest(upTo)
    if (at <= 0) return false
    for (let k = stack.length - 1; k >= at; k--) {
      const node = stack[k]
      if (node.contentEnd === -1) node.contentEnd = pos
      if (node.end === -1) node.end = pos
    }
    stack.length = at
    return true
  }

  let i = 0
  let textStart = 0
  while (i < doc.length) {
    const lt = doc.indexOf('<', i)
    if (lt === -1) { addText(doc.slice(i), i, doc.length); break }
    if (lt > textStart) addText(doc.slice(textStart, lt), textStart, lt)

    if (doc.startsWith('<!--', lt)) {
      const end = doc.indexOf('-->', lt + 4)
      i = end === -1 ? doc.length : end + 3
      textStart = i
      continue
    }
    if (doc.startsWith('<!', lt) || doc.startsWith('<?', lt)) {
      const end = doc.indexOf('>', lt)
      i = end === -1 ? doc.length : end + 1
      textStart = i
      continue
    }
    if (doc.startsWith('</', lt)) {
      const m = /^<\/\s*([a-zA-Z][^\s>/]*)/.exec(doc.slice(lt))
      const end = doc.indexOf('>', lt)
      const stop = end === -1 ? doc.length : end + 1
      if (m) {
        const tag = m[1].toLowerCase()
        const at = nearest(tag)
        if (at > 0) {
          // The element being closed ends where its close tag ends; anything
          // still open inside it ends where the close tag starts.
          for (let k = stack.length - 1; k > at; k--) {
            if (stack[k].contentEnd === -1) stack[k].contentEnd = lt
            if (stack[k].end === -1) stack[k].end = lt
          }
          stack[at].contentEnd = lt
          stack[at].end = stop
          stack.length = at
        }
      }
      i = stop
      textStart = i
      continue
    }

    const m = /^<([a-zA-Z][^\s>/]*)/.exec(doc.slice(lt))
    if (!m) {
      // A bare `<` in text, which is legal enough on real pages.
      addText('<', lt, lt + 1)
      i = lt + 1
      textStart = i
      continue
    }
    const tag = m[1].toLowerCase()
    const { attrs, next, selfClosing } = readAttrs(doc, lt + m[0].length)

    // A link inside a link is not allowed, and a browser ends the open one
    // wherever the second begins, however deep the nesting. Real pages ship it
    // anyway: a card whose whole area links somewhere, with the headline inside
    // linking to the same place. Without this the outer link never closes and its
    // slice runs to the end of whatever contains it.
    if (tag === 'a') close('a', lt)
    const implicitly = CLOSED_BY[tag]
    if (implicitly && implicitly.includes(open().tag)) close(open().tag, lt)

    const node = makeNode(tag, attrs, lt)
    node.contentStart = next
    node.parent = open()
    open().children.push(node)
    if (typeof attrs.id === 'string' && attrs.id !== '' && !byId.has(attrs.id)) {
      byId.set(attrs.id, node)
    }

    if (VOID.has(tag) || selfClosing) {
      node.contentEnd = next
      node.end = next
      i = next
      textStart = i
      continue
    }

    if (RAW.has(tag)) {
      const closeAt = doc.toLowerCase().indexOf(`</${tag}`, next)
      const contentEnd = closeAt === -1 ? doc.length : closeAt
      if (tag === 'textarea') {
        node.children.push({
          text: collapse(decodeEntities(doc.slice(next, contentEnd))),
          start: next, end: contentEnd,
        })
      }
      node.contentEnd = contentEnd
      const gt = closeAt === -1 ? doc.length : doc.indexOf('>', closeAt)
      node.end = gt === -1 ? doc.length : gt + 1
      i = node.end
      textStart = i
      continue
    }

    stack.push(node)
    i = next
    textStart = i
  }

  // Anything left open ran to the end of the document.
  for (const node of stack) {
    if (node.contentEnd === -1) node.contentEnd = doc.length
    if (node.end === -1) node.end = doc.length
  }
  return { root, byId, doc }
}

export const outerHtml = (tree, node) => tree.doc.slice(node.start, node.end)

export function ancestors(node) {
  const out = []
  for (let n = node.parent; n !== null && n !== undefined; n = n.parent) out.push(n)
  return out
}

// --- text and names --------------------------------------------------------

// Hidden from everyone, so hidden from the accessible name too. Note what is
// absent: a visually-hidden or screen-reader-only class is *not* hidden here.
// That text is exactly how many sites label an icon-only control, and dropping
// it would make us record those controls as unnamed.
function isHidden(node) {
  if (node.attrs.hidden !== undefined) return true
  const style = (node.attrs.style ?? '').toLowerCase().replace(/\s+/g, '')
  return style.includes('display:none') || style.includes('visibility:hidden')
}

const isAriaHidden = (node) => node.attrs['aria-hidden'] === 'true'

// The text a sighted user reads inside this element. Excludes hidden subtrees,
// embedded objects, and inline SVG, whose `<title>` is a name rather than text.
export function visibleText(node, { skip = null } = {}) {
  const parts = []
  const walk = (n) => {
    for (const child of n.children) {
      if (child.text !== undefined) { parts.push(child.text); continue }
      if (child === skip) continue
      if (NO_TEXT.has(child.tag)) continue
      if (isAriaHidden(child) || isHidden(child)) continue
      walk(child)
    }
  }
  walk(node)
  return collapse(parts.join(' '))
}

// Text of the first `<title>` directly inside an inline SVG. A `<title>` deeper
// in the tree names a shape rather than the graphic, so it is not used.
export function svgTitle(node) {
  for (const child of node.children) {
    if (child.text === undefined && child.tag === 'title') {
      return collapse(visibleTitle(child))
    }
  }
  return ''
}

function visibleTitle(node) {
  const parts = []
  for (const child of node.children) {
    if (child.text !== undefined) parts.push(child.text)
  }
  return parts.join(' ')
}

// What the image itself contributes to its control's name, and from where.
export function imageName(node) {
  if (isAriaHidden(node)) return { name: '', source: null }
  const attrs = node.attrs
  if (typeof attrs['aria-label'] === 'string' && collapse(attrs['aria-label']) !== '') {
    return { name: collapse(attrs['aria-label']), source: 'aria-label' }
  }
  if (node.tag === 'svg') {
    const title = svgTitle(node)
    if (title !== '') return { name: title, source: 'svg-title' }
  }
  if (typeof attrs.alt === 'string' && collapse(attrs.alt) !== '') {
    return { name: collapse(attrs.alt), source: 'alt' }
  }
  if (typeof attrs.title === 'string' && collapse(attrs.title) !== '') {
    return { name: collapse(attrs.title), source: 'title' }
  }
  return { name: '', source: null }
}

// What a control announces, and which part of the page supplies it.
//
// This follows the shape of the accessible name computation a screen reader
// performs, with one simplification stated plainly: where a control has both its
// own visible text and an image with alt text, a browser concatenates them, but
// we report the control's text as the source. That is the case where the correct
// answer is an empty alt attribute, and naming the text as the source is what
// records why.
//
// Returns `{ name, source }` with an empty name when the control announces
// nothing, which is the signal to skip the item entirely.
export function accessibleName(tree, control, image) {
  const attrs = control.attrs

  const labelledby = attrs['aria-labelledby']
  if (typeof labelledby === 'string' && labelledby.trim() !== '') {
    const parts = labelledby.trim().split(/\s+/)
      .map((id) => tree.byId.get(id))
      .filter((n) => n !== undefined)
      .map((n) => visibleText(n) || imageName(n).name)
      .filter((t) => t !== '')
    const name = collapse(parts.join(' '))
    if (name !== '') return { name, source: 'aria-labelledby' }
  }

  if (typeof attrs['aria-label'] === 'string' && collapse(attrs['aria-label']) !== '') {
    return { name: collapse(attrs['aria-label']), source: 'aria-label' }
  }

  // The control's own text, with the image's subtree left out so an inline SVG
  // full of `<text>` elements cannot masquerade as a label.
  const own = control === image ? '' : visibleText(control, { skip: image })
  if (own !== '') return { name: own, source: 'control-text' }

  const fromImage = imageName(image)
  if (fromImage.name !== '') return fromImage

  if (typeof attrs.title === 'string' && collapse(attrs.title) !== '') {
    return { name: collapse(attrs.title), source: 'title' }
  }

  // `value` names an image button when nothing else does.
  if (control.tag === 'input' && typeof attrs.value === 'string' &&
      collapse(attrs.value) !== '') {
    return { name: collapse(attrs.value), source: 'control-text' }
  }

  return { name: '', source: null }
}

// --- self-test -------------------------------------------------------------

function selftest() {
  let failures = 0
  const check = (name, cond, detail) => {
    if (cond) process.stdout.write(`PASS ${name}\n`)
    else { process.stdout.write(`FAIL ${name}: ${detail ?? ''}\n`); failures++ }
  }
  const find = (tree, pred) => {
    let hit = null
    const walk = (n) => {
      for (const c of n.children) {
        if (c.text !== undefined) continue
        if (hit === null && pred(c)) hit = c
        walk(c)
      }
    }
    walk(tree.root)
    return hit
  }
  const byTag = (tree, tag) => find(tree, (n) => n.tag === tag)

  // Offsets must slice the source exactly. This is the property the whole
  // harvester rests on, so it is the first thing checked.
  {
    const doc = '<div><a href="/x" class="q"><img src="i.png" alt="Home"></a></div>'
    const tree = parse(doc)
    const a = byTag(tree, 'a')
    check('outerHtml is an exact slice of the source',
      outerHtml(tree, a) === '<a href="/x" class="q"><img src="i.png" alt="Home"></a>',
      JSON.stringify(outerHtml(tree, a)))
  }

  // Nesting of the same tag, which is what the whole web looks like. A close tag
  // must end the innermost open element of its kind, not the outermost. Getting
  // this wrong truncated one slice in seven on the first real harvest, and it did
  // it silently: the markup looked plausible, it just stopped early.
  {
    const doc = '<div class="bar"><a href="#" id="menu">' +
      '<svg aria-hidden="true"><use xlink:href="#m"></use></svg>' +
      '<div class="label">Menu</div></a><p>after</p></div>'
    const tree = parse(doc)
    const a = byTag(tree, 'a')
    const p = byTag(tree, 'p')
    check('a close tag ends the innermost element of its kind',
      outerHtml(tree, a).endsWith('</a>') &&
      outerHtml(tree, a).includes('<div class="label">Menu</div>') &&
      p !== null && p.parent.attrs.class === 'bar',
      JSON.stringify(outerHtml(tree, a)))
  }

  // A link inside a link, which pages ship despite it being invalid. A browser
  // ends the outer one where the inner one starts. Left alone the outer link
  // never closes and its slice swallows the rest of its container: 19 of the
  // 11,334 candidates the first good harvest found.
  {
    const doc = '<div class="card"><a href="/story"><span>' +
      '<img src="t.png" alt="A wheat field"></span>' +
      '<a href="/story">Read the story</a></a><p>after</p></div>'
    const tree = parse(doc)
    const outer = byTag(tree, 'a')
    const html = outerHtml(tree, outer)
    check('a link inside a link ends the outer one where the inner begins',
      html.includes('alt="A wheat field"') &&
      !html.includes('Read the story') && !html.includes('<p>'),
      JSON.stringify(html))
  }

  // An implicit close ends the element where the next one starts, not where it
  // began. Ending it at its own start made every implicitly closed element slice
  // to the empty string.
  {
    const tree = parse('<ul><li>one<li>two</ul>')
    const first = byTag(tree, 'li')
    check('an implicitly closed element keeps a real slice',
      outerHtml(tree, first) === '<li>one', JSON.stringify(outerHtml(tree, first)))
  }

  // Attribute forms: double, single, unquoted, valueless, entity-encoded.
  {
    const doc = `<input type=image alt='Go &amp; see' disabled title="a&#39;b">`
    const tree = parse(doc)
    const input = byTag(tree, 'input')
    check('attributes parse in every quoting form',
      input.attrs.type === 'image' && input.attrs.alt === 'Go & see' &&
      input.attrs.disabled === '' && input.attrs.title === "a'b",
      JSON.stringify(input.attrs))
  }

  // A `<` inside a script must not open an element, or every page with an
  // inline script parses as nonsense.
  {
    const doc = '<body><script>if (a<b) { x("</div>") }</script><p>after</p></body>'
    const tree = parse(doc)
    check('script content is text, not markup',
      byTag(tree, 'p') !== null && visibleText(byTag(tree, 'body')) === 'after',
      JSON.stringify(visibleText(byTag(tree, 'body'))))
  }

  // Omitted close tags are the normal case on real pages.
  {
    const doc = '<ul><li>one<li>two</ul><p>tail'
    const tree = parse(doc)
    const ul = byTag(tree, 'ul')
    check('omitted close tags do not nest forever',
      ul.children.filter((c) => c.text === undefined).length === 2 &&
      visibleText(ul) === 'one two',
      JSON.stringify(visibleText(ul)))
  }

  // A close tag matching nothing open is ignored rather than unwinding the tree.
  {
    const doc = '<div><span>x</b></span></div>'
    const tree = parse(doc)
    check('a stray close tag is ignored',
      visibleText(byTag(tree, 'div')) === 'x',
      JSON.stringify(visibleText(byTag(tree, 'div'))))
  }

  // The name sources, one case each.
  const nameOf = (doc, controlTag, imageTag) => {
    const tree = parse(doc)
    const image = byTag(tree, imageTag)
    const control = controlTag === imageTag ? image : byTag(tree, controlTag)
    return accessibleName(tree, control, image)
  }

  {
    const r = nameOf('<a href="/"><img src="l.png" alt="Acme home"></a>', 'a', 'img')
    check('alt names the control',
      r.name === 'Acme home' && r.source === 'alt', JSON.stringify(r))
  }
  {
    const r = nameOf('<a href="/" aria-label="Acme home"><img src="l.png" alt=""></a>',
      'a', 'img')
    check('an ancestor aria-label wins over the image',
      r.name === 'Acme home' && r.source === 'aria-label', JSON.stringify(r))
  }
  {
    const r = nameOf('<h2 id="t">Downloads</h2>' +
      '<a href="/d" aria-labelledby="t"><img src="d.svg" alt="arrow"></a>', 'a', 'img')
    check('aria-labelledby resolves through ids',
      r.name === 'Downloads' && r.source === 'aria-labelledby', JSON.stringify(r))
  }
  {
    const r = nameOf('<a href="/"><img src="l.png" alt="">W3C Home</a>', 'a', 'img')
    check('the control\'s own text names it when the image is empty',
      r.name === 'W3C Home' && r.source === 'control-text', JSON.stringify(r))
  }
  {
    const r = nameOf('<button><svg viewBox="0 0 1 1"><title>Close</title>' +
      '<path d="M0 0"/></svg></button>', 'button', 'svg')
    check('an SVG title names the control',
      r.name === 'Close' && r.source === 'svg-title', JSON.stringify(r))
  }
  {
    const r = nameOf('<a href="/" aria-label="Home"><svg><title>Logo</title></svg></a>',
      'a', 'svg')
    check('the ancestor label overrides an inner SVG title',
      r.name === 'Home' && r.source === 'aria-label', JSON.stringify(r))
  }
  {
    const r = nameOf('<button title="Print"><img src="p.png" alt=""></button>',
      'button', 'img')
    check('a title attribute names the control as a last resort',
      r.name === 'Print' && r.source === 'title', JSON.stringify(r))
  }
  {
    const r = nameOf('<input type="image" src="go.png" alt="Search">',
      'input', 'input')
    check('an image button names itself from its alt',
      r.name === 'Search' && r.source === 'alt', JSON.stringify(r))
  }
  {
    const r = nameOf('<button><span class="sr-only">Menu</span>' +
      '<img src="m.png" alt="" aria-hidden="true"></button>', 'button', 'img')
    check('screen-reader-only text counts as the name',
      r.name === 'Menu' && r.source === 'control-text', JSON.stringify(r))
  }

  // The exclusion that matters: a control announcing nothing must come back
  // empty, because that is what makes the harvester skip the item.
  {
    const r = nameOf('<a href="/x"><img src="i.png"></a>', 'a', 'img')
    check('an unnamed control yields no name',
      r.name === '' && r.source === null, JSON.stringify(r))
  }
  {
    const r = nameOf('<a href="/x"><img src="i.png" alt="" aria-hidden="true"></a>',
      'a', 'img')
    check('an empty alt with no other source yields no name',
      r.name === '' && r.source === null, JSON.stringify(r))
  }
  {
    const r = nameOf('<a href="/x"><span hidden>Hidden</span>' +
      '<img src="i.png" alt=""></a>', 'a', 'img')
    check('display-hidden text does not name a control',
      r.name === '' && r.source === null, JSON.stringify(r))
  }

  process.stdout.write(failures === 0
    ? '\nhtml self-test passed\n'
    : `\nhtml self-test failed, ${failures} case(s)\n`)
  return failures === 0 ? 0 : 3
}

const invokedDirectly = process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split('/').pop() ?? ' ')
if (invokedDirectly && process.argv.includes('--selftest')) {
  process.exit(selftest())
}
