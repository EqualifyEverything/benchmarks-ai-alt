# Project: corpus construction

Build the corpus of functional images, page context, and shipped alt text that
the benchmark scores against.

A crawler finds the images and extracts everything mechanical. One agent pass
judges whether each image is functional and whether the alt text the site shipped
is any good. People confirm the survivors in the
[corpus validation](../corpus-validation/) project. That human confirmation is
what makes a pair a reference.

Nobody in this pipeline writes alt text. There is no authored gold standard. The
reference is the site's own alt text, confirmed by a person.


## Getting started

Read this before running anything.


### 1. What you need

- Node, any current version, and a shell. Nothing to install, no dependencies.
- For the review stage only, an agent harness that can read and write files in
  this directory. Adapters ship for Claude Code, Codex, and pi. Any other CLI
  works through `AGENT_CMD`, and a harness with only a chat window works by
  pasting prompts. See [adapters/README.md](adapters/README.md).

The harvest and archive stages need network access but no model. The review stage
needs a model but no network.

Check the harness before spending a review turn on it. One line, negligible cost:

    echo "Reply with the single word: ok" | ./adapters/pi.sh

If that does not print `ok`, fix the harness first. Some CLIs report a failed
login or an expired token while still exiting successfully, which looks from the
outside like a turn that ran and did nothing.


### 2. Verify the machinery

    ./run.sh --selftest

Runs every tool's own offline test and then the stage driver against a stub
agent. No network, no model calls, no cost. Expect seven groups of `PASS` lines
and `stage driver self-test passed` at the end.


### 3. Read what the corpus is meant to be

- [directives/00-corpus-goals.md](directives/00-corpus-goals.md). The
  specification: what an item is, the seven sub-types, coverage targets,
  concentration caps, politeness rules, and what is deliberately out of scope.
- [directives/review.md](directives/review.md). The one thing an agent is told to
  do. Reading it is how you know what judgment you are about to get.
- [corpus/README.md](corpus/README.md). The field reference.

If you disagree with directive 00, change it now. It defines what finished means.


### 4. Harvest

    ./run.sh --harvest              every seed list
    ./run.sh --harvest commerce     one sector

Fetches the pages in [seeds/](seeds/), finds every image inside an interactive
element, computes what each control already announces to a screen reader, slices
the markup out of the bytes it fetched, and appends candidates to
`pool/candidates.jsonl`. It honours `robots.txt`, waits a second between requests
to a host, and caps pages per host.

Two rules worth knowing before you read the output:

- An image whose control announces nothing is skipped and never written. This
  corpus pairs images with descriptions that were really shipped.
- Pages that build their interface in JavaScript yield nothing, because the
  harvester reads the HTML as served.

Expect a large skip count. Most images on the web are not inside a control.

Growing the corpus means adding seeds and harvesting again. `./run.sh --status`
says which sectors are short.


### 5. Archive the images

    ./run.sh --images

Two steps. First it draws a shortlist, `pool/shortlist.jsonl`, because the pool is
enormous: a few dozen seeds yield tens of thousands of candidates and the caps in
step 6 keep a few hundred, so downloading the pool whole would be tens of
thousands of requests for bytes that are then discarded. The shortlist runs the
same caps with room to spare, minus the one that needs hashes that do not exist
yet.

Then it downloads the bytes of every shortlisted image into `pool/images/`, names
each file after its item, records a SHA-256, and re-checks the copies already
there. Inline SVG and `data:` URIs need no request: an inline SVG's bytes are the
standalone document the harvester already assembled from the page. One request per
second per host, as in the harvest.

A URL that no longer resolves is an ordinary outcome: that candidate keeps its
URL and cannot be selected until a copy exists. A copy whose bytes changed under
us stops everything, because every judgment about an item rests on those bytes.


### 6. Select

    ./run.sh --select 30

Moves candidates from the pool into `corpus/functional-images.jsonl` with status
`unreviewed`. This is where skew is prevented, in code rather than by asking a
directive nicely:

- one item per image and role pair, across the whole corpus
- at most 2 items from any one page
- at most 5 percent of the goal from any one domain
- then the thinnest sector and sub-type buckets are filled first

It prints what it dropped and why. Silent truncation would read as coverage.

The first version of this project had none of this and drifted: 31 items in which
two domains supplied six of the eleven that survived, four came from two page
templates, and one page contributed two of eight identical buttons.


### 7. Review

    ./run.sh --review               one batch, with an agent
    ./run.sh --agent claude --review

One turn per batch. The agent gets `review/batch-NN-input.jsonl`, follows
[directives/review.md](directives/review.md), and writes verdicts to
`review/batch-NN.jsonl`. `tools/apply-review.mjs` then turns those verdicts into
statuses. `keep` with `alt_quality: good` becomes `ready`; everything else
becomes `dropped`, with the reason kept.

For a harness with no command line:

    ./run.sh --prompt review        prints the prompt, writes the input
    ./run.sh --apply-review 1       after the agent has written the file

The agent never edits the corpus. `tools/apply-review.mjs` is the only thing that
writes `status`, it applies a batch all or nothing, and it refuses a `keep` whose
`alt_quality` is not `good`.


### 8. Export, and hand it to people

    ./run.sh --export

Writes the `ready` items to
`../corpus-validation/functional-images.jsonl`. No images are copied: that
project resolves an image as `'../corpus-construction/' + item.image_file`, so
serving the repository root is enough.

    python3 -m http.server 8000     from the repository root
    open http://localhost:8000/projects/corpus-validation/

Then read what you have. Pick a few items and check them by hand: the archived
image against the alt text, the alt text against the surrounding context. The
review pass is one agent's judgment, and the point of the human stage is that it
is not the last word.


### If something goes wrong

- `no agent to run the review with`. Nothing was named and no adapter's command
  is on your `PATH`. Name one with `--agent`, set `AGENT_CMD`, or use
  `./run.sh --prompt review` and paste the prompt into whatever you have.
- `exited successfully but did not write`. The agent did nothing. Usually a
  denied tool permission or a failed login, both of which look like a clean exit
  in non-interactive mode.
- `refused to apply batch NN`. The verdict file breaks a rule the corpus depends
  on, most often a `keep` whose alt text is not `good`, or a missing item.
  Nothing was written. Fix the file and apply it again.
- `hashes to`. An archived image changed. Everything stops, because the item was
  judged against the bytes that were there.
- Nothing harvested from a host. Read the harvest output: it distinguishes a
  robots refusal, a failed request, and a page that simply had no candidates.


## Why this project exists first

The benchmark is only as good as the corpus. A deterministic heuristic for what
good alt text is has to be proved against real examples before any model can be
scored, and functional images are where the ground truth is clearest. Everything
here serves one question, taken from the repository
[README.md](../../README.md): what corpus of functional images and alt text do
we use to build the gold standard the benchmark scores against?


## How it works

Five stages. Only one needs a model.

    seeds/SECTOR.txt              plain text URL lists, committed
      | tools/harvest.mjs         robots, fetch, parse, accessible name, classify
    pool/candidates.jsonl         every candidate found, append-only
      | tools/select.mjs          --shortlist: the caps that need no bytes
    pool/shortlist.jsonl          what is worth downloading
      | tools/fetch-images.mjs    download bytes, hash, name after the item
    pool/images/
      | tools/select.mjs          dedup, concentration caps, thin buckets first
    corpus/functional-images.jsonl        status: unreviewed
      | directives/review.md      one agent turn per batch
    review/batch-NN.jsonl         keep or drop, with a reason
      | tools/apply-review.mjs    status: ready or dropped
      | tools/export.mjs
    ../corpus-validation/         a person accepts or rejects

It is not a loop with a stop condition. It is stages you re-run with more seeds
until the coverage report says the counts are where you want them.

The split between the script and the model is the whole design. An earlier version
of this project asked an agent to search the web, read pages, and retype markup
into records. Its own review pass found that the recorded markup was "retyped or
reformatted rather than pasted from the fetched bytes", and the largest cost in
the pipeline became re-fetching pages to check the agent's transcription. So the
mechanical work is mechanical now, `element_html` is a character-exact slice of
the fetched document, and the model is asked only for judgment.


## Files

- `directives/00-corpus-goals.md`. The specification. Read this first.
- `directives/review.md`. The review pass. The only directive an agent runs.
- `seeds/`. One plain text URL list per sector. See
  [seeds/README.md](seeds/README.md).
- `adapters/`. One small file per harness, plus the contract for adding another.
- `pool/candidates.jsonl`. Everything the harvester found, append-only. Not
  committed: tens of megabytes, and harvesting again rebuilds it.
- `pool/shortlist.jsonl`. The candidates worth downloading, append-only. Same
  shape, and the only rows that carry `image_file` and `image_sha256` before
  selection. Not committed either.
- `pool/images/`. One byte copy of each image, named after its item and linked
  from the record. The one exception to the plain text rule in
  [../../AGENTS.md](../../AGENTS.md), because it is the artefact under test.
- `corpus/functional-images.jsonl`. The items selected for review.
- `corpus/README.md`. The field reference.
- `review/`. Per-batch inputs, prompts, verdicts and notes. The audit trail.
- `tools/html.mjs`. A dependency-free HTML tokenizer that keeps byte offsets, and
  an accessible name computation. `element_html` being a real slice of the source
  rests on this, and its self-test asserts exactly that.
- `tools/harvest.mjs`. The crawler. Robots, politeness, extraction,
  classification.
- `tools/fetch-images.mjs`. The image archive, and the only thing that writes it.
- `tools/select.mjs`. The concentration caps and quota fill.
- `tools/apply-review.mjs`. Applies one review batch, all or nothing. The only
  thing that writes `status`.
- `tools/export.mjs`. Hands the ready items to the corpus validation project.
- `tools/validate.mjs`. Schema and coverage. Reports, never gates.
- `run.sh`. Drives the stages.


## Command reference

    ./run.sh --selftest           verify the machinery, no network, no model
    ./run.sh --status             schema and coverage report
    ./run.sh --harvest [sector]   crawl the seed lists
    ./run.sh --images             archive image bytes, then verify them
    ./run.sh --select 30          move N candidates into the corpus
    ./run.sh --review             one review turn with an agent
    ./run.sh --prompt review      print the batch prompt instead
    ./run.sh --apply-review 1     apply review/batch-01.jsonl
    ./run.sh --export             write the validation corpus
    ./run.sh --goal 100           work toward 100 items, not 250
    ./run.sh --batch-size 50      items in one review turn. Default: 30
    ./run.sh --agent NAME         use adapters/NAME.sh for the review
    ./run.sh --help              every flag and every environment variable

Any CLI, with no adapter:

    AGENT_CMD='mycli --headless {prompt}' ./run.sh --review

Exit codes: `0` the stage did its work, `1` there was nothing to do, `2` a stage
refused or failed, `3` bad usage.

The review turn is judged by the file it produced, not by the agent's exit code.
An agent that exits successfully without writing its batch file stops the run
with an explanation, because in non-interactive mode a denied tool permission or
an expired token looks exactly like a clean run.

Every tool runs on its own, and every one has an offline self-test:

    node tools/harvest.mjs --sector news --dry-run
    node tools/fetch-images.mjs --verify
    node tools/select.mjs --add 30 --dry-run
    node tools/apply-review.mjs 1 --dry-run
    node tools/validate.mjs --pool --json
    node tools/export.mjs --dry-run
    node tools/html.mjs --selftest


## Known limits

- The harvester reads the HTML as served. Pages that render their interface in
  JavaScript yield nothing, which is why the `webapp` sector is the thinnest and
  why its seed list leans on issue trackers, wikis and forums. Fixing this means
  a headless browser, which means dependencies.
- Icon fonts, CSS background images, and inline SVG whose sprite is in another
  file are skipped. Their bytes cannot be archived from the markup alone, and an
  item with no archivable image cannot be scored once its page changes. A sprite
  defined in the same page is archived: the harvester copies the referenced
  symbol into the SVG it writes, which is the one place an archived image is
  assembled rather than sliced. It has to be, because an `<svg>` lifted out of
  HTML carries neither its namespace nor its coordinate space. Getting this wrong
  cost 4,169 of the 14,770 named controls the first real harvest found, 28
  percent, all of them archived as blank rectangles.
- The accessible name computation is a useful subset of the accname
  specification, not an implementation of it. One deliberate simplification: when
  a control has both its own visible text and an image with alt text, the source
  is recorded as `control-text`, because that is the case where the correct alt
  is `""`.
- The review pass is one agent's judgment on one batch. It can be wrong in both
  directions, and it has no view across batches. The human stage exists because
  of this, not in spite of it.
- Coverage targets are a first guess. If a sub-type turns out not to exist in the
  wild at the volume assumed, that is a finding about the taxonomy, to be
  recorded in directive 00 rather than quietly worked around.
- Nothing here can tell a thorough review turn from a lazy one. Read
  `review/batch-NN-notes.md` and spot-check the verdicts.
