# Directive 02: Second gold standard pass

You are the second gold standard author. You write alt text for images you have
not seen described, from page context alone, and you do not know what anyone
else concluded.

That ignorance is the whole point. Directive 00 requires two independent gold
standards per accepted item, and independent means the second was authored
without reading the first. This turn exists because an agent cannot forget its
own answer: if the same context wrote both passes, the second one agrees by
construction and the requirement means nothing.

Run this directive once per round, between the seeking agent and the reviewer.


## Paths

Work from the project directory, `projects/corpus-construction/`. Every file you
read or write is named relative to it:

- `rounds/round-NN-second-pass-input.jsonl`, your input, one item per line
- `rounds/round-NN-second-pass.jsonl`, your output, one pass per line
- `rounds/round-NN-second-pass.md`, your short log

Links below that begin with `../` are there so they resolve when reading this
file on GitHub. They are not the paths to write to.


## Do not read the corpus

`corpus/functional-images.jsonl` is off limits for this turn, as is
`rounds/round-NN-seek.md`. Both carry the first pass, and reading either
destroys the only thing this turn produces.

The input file was extracted by `tools/second-pass.mjs --extract` precisely so
you would not have to. It carries the page URL, the image URL, the local copy of
the image, the implementation, the interactive element's role, the verbatim
markup, the surrounding visible text, and what the control does. It deliberately
does not
carry the first pass, its rationale, the difficulty label, the site's own alt
text as a separate field, or anything else that would tell you what answer is
expected.

If you find yourself reading the corpus anyway, stop and say so in your log. A
pass authored after seeing the first one is worse than no pass at all, because
it looks like corroboration.


## Read first, every round

1. The repository [README.md](../../../README.md), the criteria for good
   functional image alt text. This is the standard you author against.
2. [00-corpus-goals.md](00-corpus-goals.md), the sections on what counts as an
   item and on gold standard integrity. Read the specification, not the corpus.
3. `../rounds/round-NN-second-pass-input.jsonl`, where NN is the zero-padded
   round number in your prompt.


## What to do, per item

Look at the image. When `image_file` is set, that path is a local copy of it, so
it works even when the page has moved on. Its name is the item id and tells you
nothing about the answer. When `image_file` is `null` the image has no separate
file: it is an inline `<svg>` or an icon font glyph, and the markup in the input
is the whole image.

Fetch the page too if you can. The markup in the input is verbatim and enough to
work from, but seeing the control in place tells you things a fragment cannot,
such as whether the adjacent text is genuinely adjacent. Use whatever retrieval
your tools give you, a fetch or search tool or curl in a shell, and carry on
from the recorded context if the page has since changed or cannot be reached.
Say which items you could not refetch in your log.

Then work the criteria in order:

1. Ask what activating the image does, not what it looks like. The destination
   field says what the control does; the markup says how it is built.
2. Check the surrounding text. If adjacent text inside the same control already
   names the action or destination, the correct answer is an empty alt
   attribute. Reach for that answer when it is right, and do not reach for a
   label out of reflex.
3. Name the outcome, destination, or state. Not the glyph, not the file name.
4. Strip any redundant starter. No "link to", no "button for", no "icon of".
5. Keep it brief, well under 125 characters, and shorter where the function is
   simple.
6. Add no assumption the markup and the context do not support.

Ignore the alt attribute inside the markup when you decide. Most functional
images on the web are labelled badly, and the input hands you the markup because
you need it for everything else, not because the site's answer is a hint. Where
the site's value is plainly wrong, your rationale can say so.

Write a rationale that cites the criterion your answer rests on and names the
answer you rejected. "Adjacent text names the destination, so the image is
redundant and takes an empty alt" is a rationale. "This is the home link" is
not. The rationale is what makes a later disagreement adjudicable, and an
unexplained pass is refused by the tool.


## Disagreeing is allowed and useful

You are not trying to match the first pass. You cannot see it, and a corpus
where every second pass agrees is a corpus where the second pass was theatre.

Where the honest answer is that the item is genuinely ambiguous, say which
readings are defensible in your rationale and then commit to one. That note is
the material a later adjudication uses.


## Output

Write `../rounds/round-NN-second-pass.jsonl`, one JSON object per line, one line
per item in the input, with exactly these three fields:

- `item_id`, copied from the input.
- `alt`, your gold standard. An empty string means `alt=""`, which is a real
  answer and often the correct one.
- `rationale`, at least a sentence, citing the criterion it rests on.

    {"item_id":"fi-0007","alt":"","rationale":"The link's own text already reads
    Library of Congress, so the wordmark is redundant and takes an empty alt."}

That example is wrapped here to stay inside 80 columns. Write each record on one
line.

Then write `../rounds/round-NN-second-pass.md`, a short log covering how many
items you authored, which you could not refetch, whether you had a search or
fetch tool or only curl, and anything about the input that made an item
impossible to judge. If an item's context was too thin to author against, say so
there and skip it rather than guessing: a missing pass is an honest state and
the reviewer will code `NO-SECOND-PASS` against the item.

Do not edit the corpus. `tools/second-pass.mjs --apply` merges your file, checks
each record, refuses anything it cannot attribute to this round's input, and
reports which items now disagree.


## Rules you do not break

- Never read `corpus/functional-images.jsonl` or the seeking agent's round log
  during this turn.
- Never edit the corpus, and never edit a file in `corpus/images/`. Your output
  is the JSONL file and the log.
- Never write a pass for an item that is not in the input file. It will be
  refused, because it cannot have come from the extracted context.
- Never copy the site's alt text into your answer. Judge the function.
- Never invent context. If the page will not load, work from the recorded markup
  and say so.
- Stay in plain text, and follow [../../../AGENTS.md](../../../AGENTS.md).
