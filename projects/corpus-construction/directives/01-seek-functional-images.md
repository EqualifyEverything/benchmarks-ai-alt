# Directive 01: Seek functional images

You are the seeking agent. Your job is to find real functional images on the
public web and add them to the corpus with verified context and an
independently authored gold standard alt text.

Run this directive once per round. One round is one pass of finding, verifying,
and recording. You do not decide when the corpus is done. The loop does.


## Paths

Work from the project directory, `projects/corpus-construction/`. Every file you
read or write is named relative to it:

- `corpus/functional-images.jsonl`, the corpus
- `rounds/round-NN-seek.md`, your run log
- `directives/00-corpus-goals.md`, the specification

Links below that begin with `../` are there so they resolve when reading this
file on GitHub. They are not the paths to write to.


## Read first, every round

1. [00-corpus-goals.md](00-corpus-goals.md). The specification you are bound
   by, including the acceptance criteria.
2. The repository [README.md](../../../README.md), sections on functional
   images, the image taxonomy, and the criteria for good functional image alt
   text. That is the standard your gold text is judged against.
3. [../corpus/README.md](../corpus/README.md). The record schema and the reason
   code vocabulary.
4. `../corpus/functional-images.jsonl`, if it exists. The current corpus.
5. The most recent files in `../rounds/`, if any. The adversarial review of your
   previous work, including items you must revise.


## What to do this round, in order

### 1. Fix before you add

Revision work outranks new collection.

Statuses have already been applied for you. `tools/apply-verdicts.mjs` runs at
the end of every review round and writes them from the review records: accepted,
needs-revision, or rejected. You do not set them, and neither does the reviewer.

Your job is the content. Take every item now sitting at `needs-revision`, apply
the `required_change` from its review record, and set it back to `candidate` so
it is reviewed again. That is the only status change you may make to an existing
item, and new items you record enter as `candidate`.

Then adjudicate. Any item whose two entries in `gold_alt_passes` hold different
alt text is waiting for you: the validator's `pending` line counts them. Read
both rationales, decide which reading wins, write the decision into
`adjudication` saying which criterion settles it, and set `gold_alt` to the
winning answer. An unadjudicated disagreement cannot be accepted, so these items
are closer to done than anything you could go and find.

Adjudicate honestly. If both readings are defensible, say so in the adjudication
and mark the item's difficulty `ambiguous`. Those are the items the benchmark
needs most. If neither pass is right, write the answer that is, and say why both
passes missed it.

Never delete a record, including a rejected one. A rejected item is evidence
about what does not belong in the corpus.

### 2. Choose the gap you are closing

Compute current accepted counts per category, per sub-type, per difficulty
class, per domain, and for the empty-alt and dual-purpose shares. Compare them
against the targets in directive 00. Pick the most under-filled target and state
in your run log which one you are working on and why.

Do not collect broadly and hope the quotas fill. Fill the thinnest slot first.

### 3. Find candidates

Two things make a round productive: knowing where the sub-type you need actually
lives, and varying how you look for it.

Aim for 10 to 25 recorded items in a round, and prefer the low end with better
verification. A round that records 8 items you are certain of is worth more than
one that records 40 the reviewer will reject, because rejected items cost the
reviewer's whole budget and yield nothing.

#### Where each sub-type lives

Each entry names where to look, the markup signature that identifies it, and the
judgment that makes such an item worth having. The last part matters most. An
item that requires no judgment fails the discrimination target no matter how
cleanly it is recorded.

- Linked standalone logos, category 1. Headers and footers of essentially every
  site, which is why they are easy to over-collect and why the domain limit will
  bite here first. Signature: an `<a>` whose `href` is `/` or the site root,
  wrapping an `<img>` or an inline `<svg>`, inside a `<header>` or masthead
  region. The judgment is seldom "what is this logo". It is whether the control
  already has an accessible name. Prefer the harder shapes: a logo beside a
  separate text link to the homepage; two co-branded logos inside one link, such
  as a university and its hospital system; a logo linking somewhere other than
  home, such as a campaign microsite pointing at its parent institution; a
  sponsor or partner logo in a footer, which is usually dual-purpose.
- Standalone navigational links, category 1. Icon-only navigation: hamburger
  menus, header search, cart and account icons, footer social media rows,
  breadcrumb separators that are themselves links, pagination arrows, language
  switchers, feed icons, app store badges. Signature: an `<a>` wrapping an image
  with no text node inside it. Social rows are the most over-collected shape
  here. Prefer pagination and language switching, where naming the destination
  requires reading the context, and flag icons standing for languages, where
  competent authors genuinely disagree about naming a language versus a country.
- Standalone form controls and image buttons, category 2. `<input type="image">`
  survives mostly in older systems: library catalogues, government forms, legacy
  search widgets, department pages nobody has rebuilt. Signature: `input` with
  `type="image"`, or a `<button type="submit">` wrapping a magnifying glass.
  Also clear-this-field crosses, show and hide password eyes, calendar pickers,
  captcha reload arrows, attachment clips. The judgment here is usually
  redundancy: a magnifier inside a control that already reads "Search" is a
  different answer from the same magnifier alone.
- Action and toggle icons, category 2. Web applications, documentation sites,
  dashboards, code hosts. Copy to clipboard, dark mode toggles, play, pause,
  mute, star and favourite, expand and collapse, sort arrows in table column
  headers, print, share, edit, delete, pin, filter. Signature: `<button>` or
  `role="button"` wrapping an image, often near `aria-expanded` or
  `aria-pressed`. The most valuable are stateful, where the correct alt text
  depends on the current state and naming the state competes with naming the
  action. This sub-type fills fastest, and it is where duplicate icon sets pile
  up, so identify the icon set before recording.
- Functional non-Unicode emojis, category 3. Platforms that render emoji as
  images rather than text, where the image is itself a control: forum software
  with custom emoji, reaction buttons, published chat archives, mailing list
  archives, issue trackers. Signature: a small `<img>` whose `src` sits under an
  emoji or sprite path, inside a `<button>` or an `<a>`. Distinguish carefully.
  An emoji image inside prose is informative or decorative and is out of scope
  for v0.1. Only ones that trigger something count, and a reaction button that
  both applies a reaction and displays its count is the shape worth hunting.
- Linked complex graphics and image maps, category 4. Signature: `usemap=` with
  a `<map>` and `<area>` children, or an inline `<svg>` whose `<a>` elements
  carry links. Where they live: campus and site maps, transit diagrams, seating
  charts, floor plans, choose-your-region selectors, organisational charts,
  clickable process diagrams, product images with hotspots. This is the rarest
  sub-type and the hardest quota, and it is worth spending a whole round on.
  The judgment is layered: the graphic needs a name, each region needs one, and
  the two must not repeat each other.
- Structural breaks and reader controls, category 5. Digital publications and
  reading interfaces: ebook readers, journal article viewers, PDF viewers with
  an HTML shell, long-form editorial with chapter navigation. Page turn arrows,
  next and previous chapter, zoom, fullscreen, table of contents toggles,
  footnote return links, annotation and highlighting tools, and section dividers
  that carry a link or a state. A divider that is purely ornamental is
  decorative, not functional, and is out of scope. Record one only where it does
  something.

#### Vary how you search

A single strategy finds a single kind of page. Rotate across rounds and record
which ones you used and what each yielded, so a later round can try what has not
been tried.

- By interface pattern. Search for the pattern that produces the sub-type, such
  as icon-only pagination controls, sort toggles in data tables, or a linked
  wordmark in a site header.
- By sector. Government portals, university sites, library catalogues, hospital
  systems, transit agencies, storefronts, newsrooms, developer documentation,
  and web applications each implement controls differently.
- By platform. Sites sharing a CMS, framework, or icon set share markup, which
  makes a sub-type easy to find and easy to over-sample. Watch the domain and
  duplication limits, and treat one platform as one seam, not many.
- By markup. Search for the literal markup, such as `input type="image"` or
  `usemap`, on code search engines and in indexed HTML. This finds the rare
  sub-types that pattern searches miss.
- By document type. Digital books, journal readers, and PDF viewers are where
  structural breaks and reader controls live.
- By known accessibility work. Sites with published accessibility statements
  often have deliberate, defensible alt text worth studying, including correct
  uses of an empty alt attribute.
- By failure. Accessibility audit write-ups, bug trackers, and conformance
  reports name real pages and quote the alt text that was there. Those pages
  point at items and tell you what the observed alt was before you fetch it.

#### When the harness has no search tool

Some harnesses can fetch pages but not search for them. You can still work a
round: use pages that list pages, and say in your run log that you had no
search, because a narrower spread of domains that round is a consequence of the
harness rather than skew you chose.

Starting points that are stable, public, and worth naming:

- The [WAI Functional Images Tutorial](https://www.w3.org/WAI/tutorials/images/functional/)
  and the [WAI Alt Text Decision Tree](https://www.w3.org/WAI/tutorials/images/decision-tree/).
  Real markup with deliberate, documented alt text. Useful for calibration, and
  the pages themselves ship working controls.
- Published accessibility statements and conformance reports, which name the
  pages their authors audited.
- Government and university directory pages, which link to hundreds of sibling
  sites in the same sector with different implementations.
- Documentation for icon sets and component libraries, which shows the markup a
  whole family of real sites is using and names what each icon means. Do not
  record a documentation demo as a corpus item unless it is a working control on
  that page.

#### Fetching and extraction

Whatever retrieval you have, the item is judged on what the page actually
served. If your only tool is a shell, that is sufficient:

    curl -sSL --compressed "$PAGE" -o /tmp/page.html
    grep -n -o -E '<a [^>]*>[[:space:]]*<(img|svg)[^>]*>' /tmp/page.html

Signatures worth grepping once you have the HTML: `<a` followed by `<img` or
`<svg`; `<button` followed by an image; `type="image"`; `usemap=`; `<area`;
`role="button"`; `aria-expanded`; `aria-pressed`; `xlink:href="#` or
`href="#icon` for sprite references.

Two things to watch:

- Client-rendered pages. If the served HTML has no content, only a script tag
  and an empty root element, you cannot verify anything from it. Prefer a
  server-rendered page rather than reconstructing what the browser would build.
  Where you do record an item from a page whose markup is assembled by script,
  say so in `notes`, because it changes what a model would be given.
- Fetch politely. Retrieve only pages you have a reason to retrieve, no more
  than a few requests per second to one host, and check `robots.txt` before the
  first fetch of a host:

      curl -sSL "https://$HOST/robots.txt"

#### Hunt the difficulty quotas deliberately

Three targets in directive 00 will not fill themselves, because the items that
satisfy them are not the items that turn up first.

- Empty alt, at least 15 percent. Look for a visible text label inside the same
  control as the image. The signature is an `<a>` or `<button>` containing both
  an image and a text node, which is the opposite of the icon-only shape most
  of this work chases. Card links with a thumbnail above a headline, nav items
  with an icon before a word, and social rows where the platform name is written
  out are all reliable seams.
- Dual-purpose, at least 10 percent. Promotional banners inside links, sponsor
  and partner logos, app store badges, book covers linking to a detail page,
  author avatars linking to a profile, chart thumbnails linking to the full
  data. The test is whether a user who cannot see it loses content as well as a
  destination.
- Ambiguous difficulty, at least 20 percent. An item is ambiguous when two
  competent authors would write different alt text and both could defend it.
  Flag icons for language selection, stateful toggles, a logo whose wordmark is
  part of the image while adjacent text repeats it, and image map regions whose
  destination is broader than their label are all genuinely contested. Do not
  label an item ambiguous merely because you were unsure: say what the two
  readings are, in the rationale, or classify it as standard.

### 4. Verify every candidate before you record it

Retrieve the page. Do not record anything you have not fetched and read.

For each candidate, confirm all of the following, and drop it if any fails:

- The image is genuinely functional. It sits inside an `<a>`, `<button>`,
  `<input type="image">`, `<area>`, or a custom control with an interactive
  role, or it is a representational glyph conveying system state. If it is
  merely informative or decorative, it does not belong in this corpus version.
- You can identify the destination or the action. If you cannot say what
  activating it does, you cannot judge alt text for it.
- The image URL and the page URL both resolve.
- The item is not already in the corpus. Deduplicate on image URL together with
  page URL, and check for near-duplicates: the same icon from the same icon set
  in the same role adds nothing after the first few. Compare the file name stem,
  the sprite symbol id, the icon font class or ligature name, and for an inline
  `<svg>` the path data itself. Two sites using one component library will
  produce byte-identical markup, and that is a duplicate however different the
  domains are.
- Retrieval is permitted by `robots.txt` and the site's terms.

Record the markup verbatim. Do not tidy it, reformat it, or reconstruct it from
memory. If the image is an inline SVG, a sprite reference, an icon font glyph,
or a CSS background image, record which, because that changes what a model can
even see.

### 5. Author the gold standard

For each verified item, write the alt text you believe is correct. Work from the
criteria, in this order:

1. Ask what activating the image does, not what it looks like.
2. Check the surrounding text. If adjacent text inside the same control already
   names the action or destination, the correct answer is an empty alt
   attribute. Do not reach for a label out of reflex. These are among the most
   valuable items in the corpus.
3. Name the outcome, destination, or state. Not the glyph.
4. Strip any redundant starter. No "link to", no "button for", no "icon of".
5. Keep it brief, under roughly 100 to 125 characters, and shorter where the
   function is simple.
6. Check that you have added no assumption the image and its context do not
   support.

Then write the rationale. Cite the criteria the answer rests on and name the
alternative you rejected. A rationale that only restates the answer is not a
rationale, and the reviewer will reject the item.

If the item is dual-purpose, functional and informative at once, say so and
explain what the alt text must carry beyond the function.

### 6. Leave the second pass alone

The corpus requires two independent gold standard passes per item, and
independent means the second pass does not read the first. You have read the
first, because you wrote it, so you cannot author the second. Record your pass as
the single entry in `gold_alt_passes`, with `author` set to `pass-a`, and stop
there.

[02-second-pass.md](02-second-pass.md) runs after you, in its own turn, from a
file that carries the page context and none of your conclusions. That is where
the second pass comes from. A pass you write yourself after seeing the first is
not independent, however carefully you try to forget it, and it is worse than a
missing one because it looks like corroboration.

A single-pass item stays a candidate. The schema forbids promoting it, and the
reviewer codes `NO-SECOND-PASS` against it.

### 7. Run the leakage check

For each item, ask whether the gold standard is recoverable without the image
and without the page context, from the file name, the URL path, or the site's
own alt text. If it is, the item cannot discriminate between a model that sees
and a model that guesses. Set the item's `leaky` field to true and keep the
record. The schema will not let a leaky item be accepted, and the record
documents a trap worth knowing about.

An item named `search-icon.svg` whose gold standard is "Search" teaches nothing.
The same icon inside a control labelled "Search" in text, where the correct
answer is an empty alt, teaches a great deal.

### 8. Record

Append one JSON object per line to `../corpus/functional-images.jsonl`,
following the schema exactly. New items enter with status `candidate`. Never
mark your own work `accepted`. Promotion happens after review, when
`tools/apply-verdicts.mjs` writes the reviewer's verdicts into the corpus.

Set `image_file` and `image_sha256` to `null`. Do not download the image yourself
and do not fill those fields in. `../tools/fetch-images.mjs` copies each image
into `../corpus/images/`, names the copy after the item, and records the hash; the
loop runs it after your turn. Writing those fields by hand would mean the recorded
hash was never checked against a file anyone else can read.

### 9. Write the run log

Write `../rounds/round-NN-seek.md`, where NN is the zero-padded round number,
covering:

- Which target you were closing, and why.
- Which search strategies you used, and what each one yielded. Name the
  retrieval tools you actually had, including whether web search was available,
  so the reviewer can tell a narrow round from a lazy one.
- How many candidates you found, verified, and recorded, and how many you
  dropped, with reasons.
- Revisions applied from the previous review.
- Which pass disagreements you adjudicated, and which reading won in each. A
  disagreement you resolved by picking your own earlier answer needs saying
  plainly, because that is the outcome to be suspicious of.
- Updated counts against every target in directive 00.
- What you could not find, and what you would try next. If a sub-type is
  resisting collection, say so plainly. That is a finding, not a failure.


## Rules you do not break

- Never invent a URL, a page, markup, surrounding text, or an observed alt
  value. Fabricated provenance is the one defect that would invalidate the whole
  benchmark, and it is undetectable later without refetching every item.
- Never record an item you have not retrieved.
- Never copy the site's alt text into the gold standard field. Judge it, in the
  observed alt verdict field.
- Never promote your own candidates to accepted.
- Never write `image_file` or `image_sha256`, and never edit a file in
  `../corpus/images/`. The archive is one tool's output.
- Never delete or rewrite a rejected record.
- Never exceed 10 new items from one domain in one round.
- Stay in plain text, and follow [../../../AGENTS.md](../../../AGENTS.md).

If a constraint in directive 00 blocks work you believe the corpus needs, stop
and write the conflict in your run log. Do not resolve it by relaxing the
specification on your own.
