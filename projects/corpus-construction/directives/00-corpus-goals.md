# Directive 00: Corpus goals and acceptance criteria

This directive is the specification. It is not run by an agent on its own.
Every other directive in this project reads it and is bound by it. The loop in
[04-loop.md](04-loop.md) stops when the acceptance criteria below are met.

Corpus version: v0.1, functional images.


## Purpose

Produce a corpus of real functional images, with their real page context and an
independently authored gold standard alt text, good enough to score AI models
on zero-shot functional alt text quality.

The corpus is the benchmark. If the corpus is weak, every score computed from
it is meaningless. Prefer a smaller corpus that survives adversarial review
over a larger one that does not.


## What counts as an item

One item is one image, in one place, on one page, at one point in time.

Each item must record:

- Where the image lives, and proof that it was really there. The page URL, the
  image URL, the verbatim markup of the image and its interactive ancestor, and
  the date it was retrieved.
- The image itself. A local copy under `../corpus/images/`, named after the item,
  with its SHA-256 recorded. Written by `../tools/fetch-images.mjs`, never by an
  agent. An item with an image URL and no copy cannot be accepted, because the
  day its page changes there is nothing left to score.
- What the image does. The interactive element type, and the destination or
  action it triggers.
- What surrounds it. The verbatim visible text inside and adjacent to the
  control, because that text decides whether the correct answer is a label or
  an empty alt attribute.
- What the site shipped. The alt text that was actually present, including an
  empty value or the absence of the attribute, and a judgment on whether it was
  correct.
- The gold standard. Alt text authored independently against the criteria in
  the repository [README.md](../../../README.md), with a written rationale.

The field-by-field schema is in [../corpus/README.md](../corpus/README.md).

Observed alt text and gold standard alt text are separate fields and must never
be merged. Most functional images on the web have poor alt text. Copying it
would encode the failure the benchmark exists to detect.


## Coverage targets for v0.1

Taxonomy categories and sub-types are defined in the repository
[README.md](../../../README.md). Counts below are accepted items, meaning items
that have passed adversarial review.

- At least 250 accepted items in total.
- At least 30 accepted items in each of the five taxonomy categories.
- At least 20 accepted items for each named sub-type. There are seven:
  linked standalone logos; standalone navigational links; standalone form
  controls and image buttons; action and toggle icons; functional non-Unicode
  emojis; linked complex graphics and image maps; structural breaks and reader
  controls.


### Running toward a smaller goal

A run may stipulate a smaller corpus than the full 250, recorded in
`corpus/target.txt` and set with `./run.sh --target N`. The three counts above
scale with it, so a goal of 100 becomes 12 per category and 8 per sub-type. The
share targets below are ratios and do not scale.

This exists so a first corpus can be finished, examined, and argued about
before committing tens of hours to the full one. It is not a way to make the
criteria easier: proportional scaling keeps the shape of the corpus, which is
what makes it a benchmark rather than a pile of whatever was easiest to find.

Two things follow. A corpus built to a smaller goal is a milestone, not v0.1,
and must say so wherever it is published, because per sub-type it supports
weaker claims. And `tools/validate.mjs` is authoritative on the effective
targets: it prints them on every run, and where its arithmetic and this prose
disagree, the validator is what the loop obeys.


## Difficulty and discrimination targets

A benchmark item is only useful if getting it right requires judgment. These
targets keep the corpus from filling up with icons any model can label.

- At least 15 percent of accepted items must have a gold standard of `alt=""`,
  because adjacent text already conveys the function. Redundancy judgment is
  where models fail most predictably, and a corpus with no empty-alt items
  cannot measure it.
- At least 10 percent must be dual-purpose items, functional and informative at
  once, such as a promotional banner that both links and carries content.
- At least 20 percent must be classified as ambiguous difficulty, meaning
  competent alt text authors could reasonably disagree and the rationale is
  doing real work.
- No item may be answerable from its file name, image URL, or the site's own
  alt text alone. If a model could produce the gold standard without seeing the
  image or the context, the item leaks and does not belong in the corpus.


## Source diversity targets

- No single domain may account for more than 5 percent of accepted items.
- Each sub-type must draw on at least 8 distinct domains.
- Include a mix of sectors: government, higher education, commerce, news,
  documentation, web applications, and digital publications.
- Include a mix of implementations: `<img>`, inline `<svg>`, icon fonts,
  sprites, CSS background images, and `<input type="image">`. Record which.


## Gold standard integrity

- Every accepted item needs two independent gold standard passes that agree, or
  a recorded adjudication explaining the disagreement and the resolution.
- Independent means the second pass is authored without reading the first. It is
  a separate turn, run from [02-second-pass.md](02-second-pass.md) over a file
  that carries page context and no first answer, because an agent cannot forget
  what it wrote a moment ago. A `pass-b` produced in the same turn as `pass-a` is
  not a second pass, and the reviewer treats it as none.
- A disagreement between the passes is a legitimate state for a candidate item
  and the most useful thing this process produces. It is resolved by the next
  round's seeking agent writing an adjudication, not by discarding a pass.
- Rationales must cite the criteria they rest on, not restate the answer.
- Where the correct answer depends on a contested reading of the guidance, say
  so in the item rather than hiding it behind a confident label.


## Collection constraints

- Real pages only. No synthetic images, no mockups, no invented URLs, no
  invented markup.
- Public pages only. Nothing behind authentication, a paywall, or a consent
  barrier.
- Respect `robots.txt` and site terms. If a site disallows retrieval, skip it
  and record nothing.
- Do not republish the image files. One local copy per item is kept under
  `../corpus/images/` so the benchmark can be re-run and audited after the source
  page changes; that archive is a working copy, not a distribution. Published
  results cite each image by URL, with the context and the metadata.
- Record a provenance note for each item covering the basis for citing it in
  published benchmark results.
- Both the image URL and the page URL must resolve at the time of collection.
  Record the retrieval date so later link rot is detectable rather than silent.


## Out of scope for v0.1

- Informative, decorative, text, complex, and group images. They are catalogued
  in the repository README for context only, and are collected in later corpus
  versions.
- Scoring models. This project builds the corpus. Running models against it is
  a separate project.
- Any item requiring a subjective aesthetic judgment to answer.


## Acceptance criteria

The loop stops when all of the following hold at once, verified against the
corpus file and the two most recent review reports:

1. Every coverage target is met.
2. Every difficulty and discrimination target is met.
3. Every source diversity target is met.
4. Every accepted item has two agreeing independent gold standards, or a
   recorded adjudication, and a local copy of its image matching the recorded
   hash.
5. At least 95 percent of accepted items carry no unresolved blocking
   finding. A blocking finding stays open until a later review of that same item
   clears it, so it cannot age out simply because the loop moved on.
6. Two consecutive adversarial review rounds have produced zero new blocking
   corpus-level findings.

Criterion 6 is the real gate. Counts can be reached by grinding. Two quiet
review rounds in a row mean the reviewer has stopped finding new classes of
defect, which is the closest available signal that the corpus is sound.
