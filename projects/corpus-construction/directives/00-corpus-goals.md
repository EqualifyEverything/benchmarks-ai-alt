# Directive 00: Corpus goals and acceptance criteria

This directive is the specification. It is not run by an agent on its own.
Every other directive in this project reads it and is bound by it. The loop in
[03-loop.md](03-loop.md) stops when the acceptance criteria below are met.

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
- Independent means the second pass is authored without reading the first.
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
- Do not redistribute the image files. Record the URL, the context, and the
  metadata. The images stay where they are.
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
   recorded adjudication.
5. At least 95 percent of accepted items carry no unresolved blocking finding
   from the most recent adversarial review round.
6. Two consecutive adversarial review rounds have produced zero new blocking
   corpus-level findings.

Criterion 6 is the real gate. Counts can be reached by grinding. Two quiet
review rounds in a row mean the reviewer has stopped finding new classes of
defect, which is the closest available signal that the corpus is sound.
