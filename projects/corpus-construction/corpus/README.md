# Corpus files and schema

This directory holds the corpus itself, in plain text.

- `functional-images.jsonl`. The corpus. One JSON object per line, one line per
  item. Created by the seeking agent on the first round; absent until then.
- `target.txt`. The goal for this run, in accepted items: one whole number, plus
  comment lines starting with `#`. Written by `./run.sh --target N` and read by
  `../tools/validate.mjs`. Absent means the full 250-item v0.1 corpus in
  [../directives/00-corpus-goals.md](../directives/00-corpus-goals.md). It is
  committed rather than passed on the command line so that every round, every
  bare validator run, and the history all agree on what the loop is working
  toward. Count targets scale with it; share targets do not.

- `corrections.md`. Every change made to the corpus by a person rather than by a
  tool, with what changed and why. Out-of-band edits should be rare; the normal
  way to change an item is a review verdict and another round.
- `images/`. One local copy of every image the corpus records, named after the
  item, written by `../tools/fetch-images.mjs`. See
  [images/README.md](images/README.md). The copies are what keep an item
  scoreable after its page changes, and they are the one exception to the plain
  text requirement in [../../../AGENTS.md](../../../AGENTS.md).

Records are append-only. Items are never deleted, only given a new status.
Rejected items stay in the file with their reason codes, because they are
evidence about what does not belong in the corpus.

Validate the file at any time with:

    node ../tools/validate.mjs

The validator enforces every rule below and reports progress against the
acceptance criteria in
[../directives/00-corpus-goals.md](../directives/00-corpus-goals.md). If the
validator and this document ever disagree, the validator is the one the loop
obeys, and the disagreement is a defect to fix.


## Item record schema

All fields are required unless marked optional or conditional. Unknown fields
are rejected, so the schema stays honest rather than accumulating silent
variants.

- `id`. String matching `fi-` followed by four digits, for example `fi-0001`.
  Unique across the file.
- `status`. One of `candidate`, `accepted`, `needs-revision`, `rejected`.
  Written by `../tools/apply-verdicts.mjs` from the review records, and by
  nothing else. The seeking agent writes `candidate` on a new item, and may
  return a `needs-revision` item to `candidate` once it has applied the required
  change. No agent writes `accepted`.
- `round_added`. Integer, 1 or greater. The round that first recorded the item.
- `category`. Integer 1 through 5, matching the taxonomy categories in the
  repository [README.md](../../../README.md).
- `subtype`. One of:
  - `linked-standalone-logo`, category 1
  - `standalone-navigational-link`, category 1
  - `form-control-or-image-button`, category 2
  - `action-or-toggle-icon`, category 2
  - `functional-non-unicode-emoji`, category 3
  - `linked-complex-graphic-or-image-map`, category 4
  - `structural-break-or-reader-control`, category 5
  The sub-type must belong to the recorded category.
- `page_url`. Absolute `http` or `https` URL of the page the image appeared on.
- `domain`. The host of `page_url`, lowercase, without a leading `www.`. Used
  for the concentration limits, so it must agree with `page_url`.
- `image_url`. Absolute `http` or `https` URL of the image file, or `null` when
  the implementation has no separate file. Required to be a URL for `img`,
  `sprite`, `css-background`, `input-image`, and `area` implementations.
- `image_file`. Path of the local copy of the image, relative to the project
  directory, as `corpus/images/ID.EXT` where `ID` is this item's own id. `null`
  when there is no copy: either `image_url` is `null`, so there is no separate
  file to copy, or the copy has not been made yet. Written by
  `../tools/fetch-images.mjs` and by nothing else. An accepted item with an
  `image_url` must have one.
- `image_sha256`. SHA-256 of that file, 64 lowercase hex characters. `null`
  exactly when `image_file` is `null`. The validator checks the shape of these two
  fields; `node ../tools/fetch-images.mjs --verify` checks the bytes on disk
  against the hash, and the loop runs it every round.
- `implementation`. One of `img`, `inline-svg`, `icon-font`, `sprite`,
  `css-background`, `input-image`, `area`. What a model would actually be given
  depends on this, so it is not optional.
- `element_role`. One of `link`, `button`, `input-image`, `area`, `custom`,
  `glyph`. The interactive role the image carries.
- `element_html`. Verbatim markup of the image and its interactive ancestor,
  copied from the page. Not reformatted, not reconstructed.
- `surrounding_text`. Verbatim visible text inside and immediately adjacent to
  the control. Empty string when there is none, which is itself meaningful.
- `destination`. Where activating it goes, or what it does. A URL or a plain
  description.
- `observed_alt`. The alt text actually present on the page. Empty string for
  `alt=""`. `null` when the attribute is absent entirely. These are different
  failures and must stay distinguishable.
- `observed_alt_verdict`. One of `correct`, `wrong`, `missing`,
  `empty-appropriate`, `empty-inappropriate`.
- `gold_alt`. The gold standard alt text. Empty string when the correct answer
  is `alt=""`.
- `gold_alt_rationale`. Why, citing the criteria it rests on and naming the
  alternative rejected. At least 40 characters, and a restatement of the answer
  does not qualify.
- `gold_alt_passes`. Array of one or more independent pass objects, each with
  `author`, `alt`, and `rationale`. The first, `pass-a`, is written by the
  seeking agent. The second, `pass-b`, is written in its own turn by
  [../directives/02-second-pass.md](../directives/02-second-pass.md) and merged
  by `tools/second-pass.mjs`, the only thing that appends to this array. An
  `accepted` item needs two passes that agree, or an `adjudication`.
- `adjudication`. String, or `null`. Required when the passes disagree: which
  reading wins, and why. Disagreement is an ordinary state for a candidate and
  an illegal one for an accepted item, so the validator only enforces this on
  acceptance, and `tools/apply-verdicts.mjs` refuses to promote an item whose
  passes disagree with nothing recorded.
- `difficulty`. One of `trivial`, `standard`, `ambiguous`.
- `dual_purpose`. Boolean. True when the item is functional and informative at
  once.
- `leakage_check`. What you checked, and the conclusion. At least 20 characters.
- `leaky`. Boolean. True when the gold standard is recoverable from the file
  name, URL path, or observed alt alone. A leaky item can never be `accepted`.
- `retrieved`. Date the page was fetched, as `YYYY-MM-DD`.
- `provenance_note`. The basis for citing this item in published results.
- `notes`. Optional string.


## Review record schema

Written by adversarial review to `../rounds/round-NN-review.jsonl`, one object
per line, one per item reviewed. Corpus records are never edited by the
reviewer. After the round, `../tools/apply-verdicts.mjs` reads these records and
writes the item statuses: `accept` becomes `accepted`, `revise` becomes
`needs-revision`, `reject` becomes `rejected`. It applies a round all or
nothing, and it refuses to promote an item this schema forbids: a leaky one, one
with a single gold standard pass, one whose two passes disagree with no
adjudication recorded, or one with an `image_url` and no local copy of the image.
An item waiting on an adjudication or on a copy is `revise`, never `accept`.

- `item_id`. The `id` of the item reviewed.
- `round`. Integer, 1 or greater.
- `verdict`. One of `accept`, `revise`, `reject`.
- `reason_codes`. Array of one or more codes from the vocabulary below.
- `evidence`. One sentence naming what was checked and what was found. At least
  20 characters.
- `required_change`. String. Required when the verdict is `revise`, stating the
  exact change needed. `null` otherwise.
- `blocking`. Boolean. Whether the defect blocks acceptance of the item. An
  `accept` verdict cannot be blocking: the combination would promote the item
  and count it as defective at the same time, and no later round could resolve
  it, because accepted items are not reviewed again.


## Reason code vocabulary

Use these codes verbatim. Adding a code means updating this list, the validator,
and [../directives/03-adversarial-review.md](../directives/03-adversarial-review.md)
together.

- `CLEAN`. No defect found. The only code valid on an `accept` verdict.
- `UNVERIFIABLE-SOURCE`. Page or image could not be retrieved and confirmed.
- `CONTEXT-INACCURATE`. Recorded markup, surrounding text, or observed alt does
  not match the page.
- `NOT-FUNCTIONAL`. The image is informative, decorative, text, or complex.
- `MISCLASSIFIED`. Wrong category, wrong sub-type, or an interactive ancestor
  that is not in the recorded markup.
- `APPEARANCE-DESCRIPTION`. Gold standard describes the visual, not the
  function.
- `REDUNDANCY-MISSED`. Adjacent text already conveys the function, so the
  correct answer is an empty alt attribute.
- `WRONGLY-EMPTY`. Gold standard is empty where the control has no other
  accessible name.
- `REDUNDANT-STARTER`. Gold standard begins with "link to", "button for",
  "icon of", or similar.
- `TOO-VERBOSE`. Longer than the function warrants, or over the character
  guidance.
- `ASSUMPTION`. Asserts something the image and context do not support.
- `NO-RATIONALE`. Rationale is missing, or restates the answer without citing
  criteria.
- `LEAKAGE`. Answer is recoverable without seeing the image or context.
- `NON-DISCRIMINATING`. Item cannot separate a capable model from a weak one.
- `DUPLICATE`. Same icon, same role, same icon set as an accepted item.
- `MISSING-FIELD`. A required field is absent or malformed.
- `NO-SECOND-PASS`. Fewer than two independent gold standard passes and no
  adjudication, or a `pass-b` that appears in no round's
  `round-NN-second-pass.jsonl` and so cannot have been authored blind.
- `NO-IMAGE-COPY`. The item has an `image_url` and no local copy in
  `images/`, or the copy on disk does not match the recorded `image_sha256`.
  Such an item is `revise`, never `accept`.
- `LICENSE-UNCLEAR`. Provenance note is inadequate for citation.


## Example record

Illustrative only. The URLs use the reserved `example.com` domain and are not
real corpus data. Executable copies of this and other examples live in
`../tools/fixtures/`, which the validator's self-test runs against.

    {"id":"fi-0001","status":"candidate","round_added":1,"category":2,
     "subtype":"action-or-toggle-icon","page_url":"https://example.com/inbox",
     "domain":"example.com","image_url":"https://example.com/i/g12.svg",
     "image_file":"corpus/images/fi-0001.svg",
     "image_sha256":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
     "implementation":"img","element_role":"button",
     "element_html":"<button type=\"button\"><img src=\"/i/g12.svg\" alt=\"gear\"></button>",
     "surrounding_text":"","destination":"Opens the account settings panel",
     "observed_alt":"gear","observed_alt_verdict":"wrong","gold_alt":"Settings",
     "gold_alt_rationale":"Names the outcome of activating the control rather than the glyph, per action over description; rejected \"gear\" because the visual is irrelevant to the user.",
     "gold_alt_passes":[{"author":"pass-a","alt":"Settings","rationale":"Function, not glyph."},
                        {"author":"pass-b","alt":"Settings","rationale":"Opens settings; label the outcome."}],
     "adjudication":null,"difficulty":"standard","dual_purpose":false,
     "leakage_check":"File name g12.svg reveals nothing; answer requires the destination.",
     "leaky":false,"retrieved":"2026-08-27",
     "provenance_note":"Public page, no login; cited by URL, with a local copy kept for re-runs."}

Records are one line each in the real file. The line breaks above are for
reading only.
