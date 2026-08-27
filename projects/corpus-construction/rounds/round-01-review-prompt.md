You are running round 1 of the corpus construction loop for the AI alt
text benchmark, in the role of the adversarial reviewer.

The project directory is /Users/uic-b3b/Repos/benchmarks-ai-alt/projects/corpus-construction. Work from there, and read and write files
relative to it.

Read /Users/uic-b3b/Repos/benchmarks-ai-alt/projects/corpus-construction/directives/02-adversarial-review.md and follow it exactly, including every
file it tells you to read first and every file it tells you to write. Use the
zero-padded round number 01 in every file name that calls
for it.

This work needs real web pages. Use whatever retrieval your tools give you: a
fetch or search tool if you have one, otherwise curl in a shell. Record nothing
you have not retrieved yourself.

Current corpus status from tools/validate.mjs:

corpus: /Users/uic-b3b/Repos/benchmarks-ai-alt/projects/corpus-construction/corpus/functional-images.jsonl
schema: clean

items: 12 total, 12 candidate, 0 accepted, 0 needs-revision, 0 rejected
reviews: 0 records across 0 reported rounds

acceptance criteria
  [  -] total accepted items: 0 of 250
  [  -] per category minimum: category 1: 0, category 2: 0, category 3: 0, category 4: 0, category 5: 0
  [  -] per sub-type minimum: linked-standalone-logo: 0, standalone-navigational-link: 0, form-control-or-image-button: 0, action-or-toggle-icon: 0, functional-non-unicode-emoji: 0, linked-complex-graphic-or-image-map: 0, structural-break-or-reader-control: 0
  [  -] empty-alt share: 0 items, 0.0% of 15.0%
  [  -] dual-purpose share: 0 items, 0.0% of 10.0%
  [  -] ambiguous share: 0 items, 0.0% of 20.0%
  [  -] domain concentration: no accepted items yet
  [  -] domains per sub-type: linked-standalone-logo: 0, standalone-navigational-link: 0, form-control-or-image-button: 0, action-or-toggle-icon: 0, functional-non-unicode-emoji: 0, linked-complex-graphic-or-image-map: 0, structural-break-or-reader-control: 0
  [met] two independent passes: every accepted item has two passes or an adjudication
  [  -] items clean in latest review: no accepted items yet
  [  -] two consecutive quiet review rounds: no review reports yet

GOALS: not met. Keep looping.

Do the work now. Do not ask for confirmation, and do not stop to summarise
before you have written your output files.
