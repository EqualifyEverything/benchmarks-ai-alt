# The corpus files

Plain text, one JSON object per line, in the order items were added. Append-only
in practice: `status` and the three review fields change in place, nothing else
does.

- `functional-images.jsonl`, the corpus. Items selected for review.
- `../pool/candidates.jsonl`, everything the harvester found. Same shape, review
  fields always null.
- `../pool/shortlist.jsonl`, the candidates worth downloading. Same shape, and the
  only rows outside the corpus that carry `image_file` and `image_sha256`.
- `../pool/images/`, the archived image bytes, named after the item id.

The specification lives in `../directives/00-corpus-goals.md`. This file is the
field reference. `../tools/validate.mjs` enforces it; if the two disagree, the
tool is right and this file is stale.

The image files in `../pool/images/` are the one exception to the repository's
plain text rule, because they are the artifacts under test. Everything about them
is recorded here as text.


## Fields

Written by `../tools/harvest.mjs`:

- `id`. `fi-` and at least four digits, for example `fi-0042`. A pool past ten
  thousand candidates numbers them `fi-10000` and up. Unique.
- `status`. `unreviewed`, `ready`, or `dropped`.
- `page_url`. The page the image was found on. http or https.
- `domain`. The host of `page_url`. The two must agree.
- `sector`. `government`, `education`, `publishing`, `docs`, `commerce`, `news`,
  or `webapp`. Comes from the seed list the URL was in.
- `image_url`. The resolved image URL, or a `data:` URI, or `null` for an inline
  SVG. Required for `img`, `input-image` and `area`; forbidden for `inline-svg`.
- `image_svg`. For `inline-svg` only, and required there: a standalone SVG
  document, starting `<svg` and declaring `xmlns`. It is the element's own markup
  with the sprite symbols its `<use>` elements referenced copied into a `<defs>`
  block, plus the namespace and, where the element had none, the symbol's
  `viewBox`. `null` for every other implementation. This is the only field in the
  record that is assembled rather than copied out of the page, and it exists
  because an `<svg>` lifted out of HTML renders as nothing on its own.
- `implementation`. `img`, `inline-svg`, `input-image`, or `area`.
- `element_role`. `link`, `button`, `input-image`, `area`, or `custom`. What the
  interactive element around the image is.
- `element_html`. A character-exact slice of the fetched document: the
  interactive element, opening tag through closing tag, with the image inside it.
  Never rebuilt from a parse tree, never retyped. This is what makes the record
  checkable against the page as it was served.
- `surrounding_text`. Visible text near the control, collapsed to single spaces,
  up to 240 characters. Empty string when there was none.
- `observed_alt`. The alternative text the site shipped. A string, including the
  empty string, or `null`.
- `accessible_name`. Non-empty. What a screen reader announces for the control.
- `accessible_name_source`. `alt`, `aria-label`, `aria-labelledby`, `title`,
  `svg-title`, or `control-text`.
- `category`. 1 to 5. Follows from `subtype`.
- `subtype`. One of the seven in directive 00.
- `retrieved`. `YYYY-MM-DD`, the day the page was fetched.

Written by `../tools/fetch-images.mjs`, and by nothing else:

- `image_file`. Path of the archived copy relative to the project directory, for
  example `pool/images/fi-0042.svg`. `null` until a copy exists.
- `image_sha256`. Lowercase hex SHA-256 of that file. `null` until then.

Written by `../tools/apply-review.mjs`, and by nothing else:

- `review_verdict`. `keep` or `drop`. `null` while `unreviewed`.
- `review_reason`. Plain prose, at least 20 characters. `null` while
  `unreviewed`.
- `alt_quality`. `good`, `weak`, or `wrong`. `null` while `unreviewed`.


## Two distinctions that carry the weight

**`observed_alt: ""` is not `observed_alt: null`.** An empty string means the
page had `alt=""`: the author decided the image adds nothing a screen reader
needs, which is sometimes exactly right, for example an icon inside a link that
already says "View cart" in text. `null` means there was no alt attribute at all.
The first is a decision to judge. The second is usually a defect, and an image
with no accessible name from any source is never collected at all.

**`accessible_name` is not `observed_alt`.** The accessible name is what a screen
reader announces for the whole control, which may come from an ancestor's
`aria-label`, from `aria-labelledby`, or from the control's own visible text.
`observed_alt` is only what was attached to the image. When
`accessible_name_source` is `control-text`, the control has its own text and the
correct alt for the image is usually `""`.


## Statuses

- `unreviewed`. Selected into the corpus, waiting for a review batch.
- `ready`. Reviewed, kept, and the shipped alt text is good. These are what
  `../tools/export.mjs` hands to the corpus-validation project for human
  confirmation.
- `dropped`. Reviewed and not kept, for whatever `review_reason` says. Kept in
  the file rather than deleted, because a record of what was rejected and why is
  part of the method.

Only `../tools/apply-review.mjs` writes `status`. No agent edits these files.


## Reading them

    node ../tools/validate.mjs                  schema and coverage
    node ../tools/validate.mjs --pool           the candidate pool instead
    node ../tools/validate.mjs --json           machine readable

Plain shell works too, since every line is one item:

    grep -c '"status":"ready"' functional-images.jsonl
    node -e 'require("fs").readFileSync("functional-images.jsonl","utf8")
      .trim().split("\n").map(JSON.parse)
      .forEach(i => console.log(i.id, i.subtype, JSON.stringify(i.observed_alt)))'
