# Directive 00: what this corpus is, and what an item is

Read this before any other directive. It is the specification. Everything else
in this project is machinery for producing what this file describes.


## What we are building

Corpus v0.1: functional images paired with the alternative text the site
actually shipped, where that alt text is good enough to serve as a reference.

Every item is a real image from a real page, with its bytes archived, its markup
sliced character-for-character out of the fetched document, and its shipped alt
text recorded. A person then confirms the pair in the corpus-validation project.
That human confirmation is what makes the pair a reference an AI model can be
scored against.

There is no authored gold standard. Nobody in this pipeline writes alt text. The
site's alt text is the reference, and the only question asked of it is whether
it is good.


## The collection rule

An image whose control announces nothing is skipped entirely and never written
to any file.

This corpus pairs images with alternative descriptions. A control with no
accessible name has no description to pair with, so it is not a corpus item, it
is a bug on someone's website. Finding those is a different project.

`tools/harvest.mjs` enforces this at the point of extraction, and
`tools/validate.mjs` refuses any record whose `accessible_name` is empty.


## What an item is

One JSON object per line in `corpus/functional-images.jsonl`. The same shape,
minus the review fields, is used for candidates in `pool/candidates.jsonl`.

Written by `tools/harvest.mjs`, all mechanically:

- `id`, `fi-` and at least four digits
- `status`, one of `unreviewed`, `ready`, `dropped`
- `page_url`, the page the image was found on
- `domain`, the host of `page_url`
- `sector`, from the seed list the URL came from
- `image_url`, the resolved image URL, or `null` for an inline SVG
- `image_svg`, for an inline SVG only: a standalone SVG document assembled from
  the page, sprite symbols copied in and the namespace declared. `null` for
  every other implementation. This is the one field that is built rather than
  sliced, because an `<svg>` lifted out of HTML is not yet a file.
- `implementation`, one of `img`, `inline-svg`, `input-image`, `area`
- `element_role`, one of `link`, `button`, `input-image`, `area`, `custom`
- `element_html`, a character-exact slice of the fetched document: the
  interactive element with the image inside it. Never rebuilt, never retyped.
- `surrounding_text`, the visible text near the control, up to 240 characters
- `observed_alt`, the shipped alternative text. An empty string means `alt=""`
  was present and deliberate. `null` means no alt attribute at all. This
  distinction matters: `alt=""` is an author's decision that the image is
  redundant, and sometimes it is the correct answer.
- `accessible_name`, non-empty, what a screen reader announces for the control
- `accessible_name_source`, one of `alt`, `aria-label`, `aria-labelledby`,
  `title`, `svg-title`, `control-text`
- `category` and `subtype`, proposed from the markup
- `retrieved`, `YYYY-MM-DD`

Written by `tools/fetch-images.mjs`:

- `image_file`, path of the archived copy relative to this project, or `null`
- `image_sha256`, SHA-256 of that file in lowercase hex, or `null`

Written by `tools/apply-review.mjs`, and by nothing else:

- `review_verdict`, `keep` or `drop`
- `review_reason`, plain prose, at least 20 characters
- `alt_quality`, one of `good`, `weak`, `wrong`

`status` is written only by `tools/apply-review.mjs`. `keep` with
`alt_quality: good` becomes `ready`; everything else becomes `dropped`, with the
reason kept as evidence.


## The seven sub-types

Category follows from sub-type, so only the sub-type is ever chosen.

Category 1, navigational links and logos:

- `linked-standalone-logo`
- `standalone-navigational-link`

Category 2, action controls and interface toggles:

- `form-control-or-image-button`
- `action-or-toggle-icon`

Category 3, custom interactive elements:

- `functional-non-unicode-emoji`

Category 4, multi-region functional graphics:

- `linked-complex-graphic-or-image-map`

Category 5, structural and layout controls:

- `structural-break-or-reader-control`

The full definitions and examples are in the repository's root `README.md`. It is
the standard; this list exists so the field values are unambiguous.

`harvest.mjs` proposes five of the seven from markup alone. It never proposes
`functional-non-unicode-emoji` or `structural-break-or-reader-control`, because
neither can be told from markup. The review pass assigns those.


## Coverage targets

The goal for v0.1 is 250 items in `ready`. Pass `--goal N` to work toward a
different size; the share targets are ratios and do not change.

Sectors, each 8 to 25 percent of the goal:

- `government`
- `education`
- `publishing`
- `docs`
- `commerce`
- `news`
- `webapp`

The first four are where the earliest version of this project collected almost
everything. The last three were absent entirely, which is the specific skew the
targets and the caps exist to prevent.

Sub-types, each at least 5 percent of the goal. The two that need judgment will
be the thinnest; that is expected, and `tools/select.mjs` fills the thinnest
bucket first.

Concentration caps, enforced in `tools/select.mjs`, in code:

- one item per image and role pair, across the whole corpus
- at most 2 items from any one page
- at most 5 percent of the goal from any one domain

These are enforced rather than requested. An earlier version of this project
stated coverage targets in prose here and had a validator that checked something
narrower, and the corpus skewed exactly where the prose was not enforced. If a
target matters, it belongs in `select.mjs` or in `validate.mjs`, not only here.

`tools/validate.mjs` reports every target and marks what is short or over. It
never fails a run for thin coverage: thin coverage is a reason to harvest more
seeds, not an error.


## Politeness

Collection is polite, and this is not negotiable:

- `robots.txt` is honoured. Longest matching rule wins, `Allow` beats `Disallow`
  at equal length, and an unreachable `robots.txt` is treated as permissive.
- One request at a time, one second between requests to the same host.
- A cap on pages fetched per host.
- A declared user agent naming this project and its repository.
- Nothing behind a login, a paywall, or a consent wall.
- Images are archived once. Nothing is re-fetched to check it.


## What is deliberately out of scope for v0.1

- Icon fonts and CSS background images. Their bytes cannot be archived from the
  markup alone, and an item with no archivable image cannot be scored after its
  page changes.
- Inline SVG whose sprite is not in the page it was found on, meaning
  `<svg><use href="/sprite.svg#icon-search">`. The referenced shape is in another
  file, so the same reason applies. A sprite defined in the same document *is*
  archived: the harvester copies the referenced symbol into the SVG it writes.
  That case is not an edge. It was 4,169 of the 14,770 named controls the first
  real harvest found, 28 percent, and skipping it fell hardest on exactly the
  controls this corpus wants, because a site with a well-built icon system is
  usually a site that labels its icons.
- JavaScript-rendered pages. The harvester reads the HTML as served. This is why
  the `webapp` sector will stay thin until the harvester grows a headless
  browser, and it is an honest limit rather than a hidden one.
- Informative, decorative, complex, and text images. Later corpora.
- Authoring alt text. Not this project, and by design not any project here.
