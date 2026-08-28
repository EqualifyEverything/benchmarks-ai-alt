# Directive: review a batch of harvested candidates

You are the only step in this pipeline that makes a judgment. Everything before
you was mechanical: a crawler fetched pages, found images inside interactive
elements, computed what each control already announces to a screen reader, sliced
the markup out of the bytes it fetched, and archived the image. None of that
needed an opinion.

You supply the opinion. For every item in your batch you answer three questions,
and nothing else.

1. Is this image functional, by the definition in the repository's root
   `README.md`?
2. Is `observed_alt`, the alternative description the site actually shipped,
   genuinely good alt text for it?
3. Is the proposed sub-type right?

You do not write alt text. There is no gold standard in this corpus. The
reference is the site's own alt text, confirmed by a person in the
corpus-validation project. Your job is to make sure that what reaches those
people is worth their time.


## Read these first

- The root `README.md` of the repository, for the definition of a functional
  image, the taxonomy, and the criteria for good functional alt text. This is
  the standard you apply. Do not substitute your own.
- `directives/00-corpus-goals.md`, for what this corpus is for and what an item
  is.
- `AGENTS.md`, for the plain text rule. Your output is plain text.


## Your input

`review/batch-NN-input.jsonl`, one item per line. The prompt names the batch
number. Each line holds:

- `item_id`, which you copy into your verdict
- `image_file`, the archived copy of the image, relative to this project. Look
  at it. For an inline SVG this is the SVG written out of the markup.
- `image_url`, the URL it came from, or `null` for an inline SVG
- `page_url`, the page it was found on
- `implementation`, one of `img`, `inline-svg`, `input-image`, `area`
- `element_role`, one of `link`, `button`, `input-image`, `area`, `custom`
- `element_html`, a character-exact slice of the fetched page: the interactive
  element with the image inside it
- `surrounding_text`, the visible text near the control
- `observed_alt`, the shipped alternative text. An empty string means `alt=""`
  was present and deliberate. `null` means no alt attribute at all.
- `accessible_name` and `accessible_name_source`, what a screen reader announces
  for this control and where that text came from
- `proposed_category` and `proposed_subtype`, the harvester's guess

Do not open the corpus file, and do not fetch the page. The record is better
evidence than the live page, because the page may have changed since it was
fetched, and the archived image is the bytes every later score will be taken
against. If a record looks wrong, that is a `drop`, not a reason to go looking.

The one thing worth doing beyond reading the record: look at the image file. An
icon whose alt text says "Search" and whose bytes are a shopping cart is exactly
what this pass exists to catch.


## Question 1: is it functional?

A functional image initiates an action or navigation, or represents a system
function or state. It is not aesthetic. The root `README.md` has the full
definition; the short test is: what does activating this do?

Drop it when:

- The image is decorative. A background flourish inside a link that also has its
  own text is not a functional image, it is a decorative one.
- The image is informative rather than functional. A product photograph inside a
  link to the product page is primarily conveying what the product looks like.
  A promotional banner carrying its own text is informative too, though the root
  `README.md` calls these dual purpose, so judge which purpose dominates.
- The control is not really interactive. An `<a>` with no destination, an
  anchor whose `href` is `#` with no evidence of scripting, or a link to
  `javascript:void(0)`.
- `element_html` is truncated, malformed, or does not contain the image. That is
  a harvester defect. Drop the item and say so in your reason; a pattern of them
  is worth reporting.

Keep it when the image is the operative part of a control: the icon that is the
button, the logo that is the home link, the arrow that is the next-page link.


## Question 2: is the shipped alt text good?

This is the question the whole corpus turns on. Apply the criteria in the root
`README.md`: action over description, destination over label, context aware,
brief, no redundant starters, and `alt=""` where adjacent text in the same
control already says it.

Record your answer as `alt_quality`:

- `good`. It names the action, destination, or state. A person could use this
  control from the alt text alone. Or it is `alt=""` and that is correct because
  the control's own text already says what it does.
- `weak`. Understandable but not what a careful author would write. It describes
  the picture instead of the action ("Magnifying glass" for search). It repeats
  the element type ("Link to home"). It is padded, or vague where the context is
  specific ("Click here", "Image").
- `wrong`. It misdescribes the control, names a file, is boilerplate
  ("logo.png", "image", "icon"), is in the wrong language for the page, or is
  `alt=""` where the control has no other text and the image is the only thing
  identifying it.

Some cases worth being deliberate about:

- An empty alt is correct when the control has its own visible text saying the
  same thing, and wrong when the image is the control's only label. Read
  `accessible_name_source`: if it is `control-text`, the control has its own
  text, so `alt=""` is likely correct and any alt text at all is likely
  redundant.
- Alt text that is merely a brand name on a linked logo, like "Acme", is `weak`
  rather than `good`, because the destination is what matters. "Acme home" is
  `good`.
- Alt text that is technically accurate but useless in place, like "Arrow" on a
  next-page control, is `weak`.
- Do not mark something `weak` for being short. Brevity is a virtue here. A
  one-word alt that names the action is `good`.
- Do not mark something `weak` because you would have phrased it differently.
  The question is whether it works, not whether it is optimal.

Only `keep` with `alt_quality: good` reaches human review. `weak` and `wrong` are
recorded as evidence and dropped. That means you must use `drop` for anything
that is not `good`, even when the image itself is a perfectly fine functional
image. The tool that applies your verdicts refuses a `keep` that is not `good`,
so a mismatch stops the whole batch.


## Question 3: is the sub-type right?

The harvester guesses from the markup alone, and it can only guess at five of
the seven sub-types. Two need judgment and it never assigns them:

- `functional-non-unicode-emoji`
- `structural-break-or-reader-control`

Set `subtype` to the corrected value when the guess is wrong, or `null` to accept
it. The seven values, with their categories, are in
`directives/00-corpus-goals.md`. The category follows from the sub-type
automatically; you do not set it.

Common corrections:

- A logo linking to the site root that the harvester saw as a plain
  navigational link, or the reverse when a root link is not a logo at all.
- A `button` icon that is really a reader control, such as a text-size or
  read-aloud toggle in a digital book.
- An emoji rendered as an image inside a control.


## Your output

`review/batch-NN.jsonl`, one JSON object per line, one line per input item. No
wrapper object, no array, no trailing commentary in the file.

Fields, all required:

- `item_id`, copied exactly from the input
- `verdict`, `keep` or `drop`
- `alt_quality`, `good`, `weak`, or `wrong`
- `reason`, at least 20 characters of plain prose saying what you looked at and
  what decided it. This is the audit trail. "Looks fine" is not a reason. "The
  icon is the only label on the submit control and the alt names the action" is.
- `subtype`, a corrected sub-type, or `null` to accept the proposed one

Rules the applying tool enforces, so getting them wrong costs a whole batch:

- One line per input item. Every item, no skipping.
- No item twice.
- `verdict: keep` requires `alt_quality: good`.
- `reason` is at least 20 characters.
- `subtype` is one of the seven, or `null`.

Write a short plain text note to `review/batch-NN-notes.md` as well, no more than
a page: how many you kept, the patterns you saw, and anything that looks like a
harvester defect rather than a site defect. That file is for the humans who come
next, and for whoever tunes the harvester. It is not read by any tool.


## Judge conservatively

A corpus of 80 items nobody can argue with is worth more than 250 that need
re-litigating. When you cannot tell whether the alt text is good, it is not
`good`. Drop it and say why.

The cost of dropping a decent item is that it gets harvested again later. The
cost of keeping a bad one is that a person spends their time on it and the
benchmark scores models against a reference that was never right.
