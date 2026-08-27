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

Never delete a record, including a rejected one. A rejected item is evidence
about what does not belong in the corpus.

### 2. Choose the gap you are closing

Compute current accepted counts per category, per sub-type, per difficulty
class, per domain, and for the empty-alt and dual-purpose shares. Compare them
against the targets in directive 00. Pick the most under-filled target and state
in your run log which one you are working on and why.

Do not collect broadly and hope the quotas fill. Fill the thinnest slot first.

### 3. Search deliberately, and vary how you search

A single search strategy finds a single kind of page. Rotate strategies across
rounds and record which ones you used, so later rounds can try what has not
been tried.

Strategies that find different things:

- By interface pattern. Search for the pattern that produces the sub-type, such
  as icon-only pagination controls, sort toggles in data tables, or a linked
  wordmark in a site header.
- By sector. Government portals, university sites, library catalogues, hospital
  systems, transit agencies, online storefronts, newsrooms, developer
  documentation, and web applications each implement controls differently.
- By platform. Sites built on a common CMS, framework, or icon set share
  markup, which makes a sub-type easy to find and also easy to over-sample.
  Watch the domain concentration limit.
- By document type. Digital books, journal readers, and PDF viewers are where
  structural breaks and reader controls live.
- By known accessibility work. Sites with published accessibility statements
  often have deliberate, defensible alt text worth studying, including good
  examples of a correct empty alt.
- By failure. Search accessibility audit write-ups, bug trackers, and
  conformance reports for named examples of bad functional alt text. Those pages
  point at real items and tell you what the observed alt was.

Emoji items need a different approach: look for platforms that render emoji as
images rather than Unicode text, such as chat and forum software, and find cases
where the image triggers an action.

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
  in the same role adds nothing after the first few.
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

### 6. Second pass, independently

The corpus requires two independent gold standard passes per item. Independent
means the second pass does not read the first.

Where the harness supports subagents, delegate the second pass to a subagent
given only the image, the context fields, and the criteria, never your answer or
your rationale. Where it does not, leave the item with a single entry in
`gold_alt_passes` and say so in your run log. A single-pass item stays a
candidate: the schema forbids promoting it, and the reviewer will code
`NO-SECOND-PASS` against it. Do not write a second pass yourself after seeing
the first and call it independent.

Where the two passes disagree, record both and write an adjudication naming the
reading that wins and why. Disagreements are signal. They are the material that
shows model developers how alt text professionals actually decide.

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

### 9. Write the run log

Write `../rounds/round-NN-seek.md`, where NN is the zero-padded round number,
covering:

- Which target you were closing, and why.
- Which search strategies you used, and what each one yielded.
- How many candidates you found, verified, and recorded, and how many you
  dropped, with reasons.
- Revisions applied from the previous review.
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
- Never delete or rewrite a rejected record.
- Never exceed 10 new items from one domain in one round.
- Stay in plain text, and follow [../../../CLAUDE.md](../../../CLAUDE.md).

If a constraint in directive 00 blocks work you believe the corpus needs, stop
and write the conflict in your run log. Do not resolve it by relaxing the
specification on your own.
