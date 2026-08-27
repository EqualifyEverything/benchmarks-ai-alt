# Project: corpus construction

Build the corpus of functional images, page context, and gold standard alt text
that the benchmark scores against.

Status: round one has run. 12 items collected, 4 sent back for revision and 5
rejected, mostly for leakage. Nothing is accepted yet: round one's three
promotions were withdrawn because its second gold standard passes came from the
same turn as the first, which is not independence. See
[corpus/corrections.md](corpus/corrections.md), and the round one artefacts,
before running round two.


## Getting started

Read this section before running anything. The loop is easy to start and takes
judgment to steer, and round one is a test of the directives rather than a
source of corpus data.


### 1. What you need

- Node, any current version, and a shell. There is nothing to install and no
  dependencies.
- An agent harness that can write files in this directory and retrieve web
  pages. Adapters ship for Claude Code, Codex, and pi. Any other CLI works
  through `AGENT_CMD`, and a harness with only a chat window works by pasting
  prompts. See [adapters/README.md](adapters/README.md).
- Working credentials for that harness, set up the way that tool expects. This
  project holds no keys and no configuration of its own.

Check the harness first, before anything else here. One line, negligible cost:

    echo "Reply with the single word: ok" | ./adapters/pi.sh

If that does not print `ok`, fix the harness before going further. Every round
depends on it, and some CLIs report a failed login or an expired token while
still exiting successfully, which looks from the outside like a round that ran
and did nothing.


### 2. Verify the machinery

    ./run.sh --selftest

Runs the validator, the promotion tool, the second pass tool, the image archiver
and the entire loop against a stub agent and a synthetic corpus. No network, no
model calls, no cost. Expect five groups of `PASS` lines and `loop self-test
passed` at the end.

    ./run.sh --status

Says where the corpus stands and runs no agents. Before round one it reports
that the corpus file does not exist yet, which is correct.


### 3. Read what the agents will be told

The directives are the substance of this project. `run.sh` only sequences them,
and reading them is how you know what you are about to get.

- [directives/00-corpus-goals.md](directives/00-corpus-goals.md). The
  specification: what an item is, the coverage and difficulty targets, and the
  acceptance criteria that decide when the loop stops.
- [directives/01-seek-functional-images.md](directives/01-seek-functional-images.md).
  What the seeking agent does each round.
- [directives/02-second-pass.md](directives/02-second-pass.md). What the second
  gold standard author does, in its own turn, without seeing the first answer.
- [directives/03-adversarial-review.md](directives/03-adversarial-review.md).
  What the reviewer does to all of it.

If you disagree with anything in directive 00, change it now. It defines what
finished means, and the loop will grind toward whatever it says. Those targets
are a first guess that has not survived contact with the real web.

The one number you are most likely to want to change is the size of the corpus.
The full v0.1 is 250 accepted items, which is tens of hours of agent time. To
work toward a smaller first corpus:

    ./run.sh --target 100

That records the goal in `corpus/target.txt`, so every later round and every
bare `node tools/validate.mjs` uses it without you repeating the flag, and a
change of goal shows up in the history. Count targets scale with it, so 100
items means 12 per category and 8 per sub-type, while the share targets, being
ratios, do not. A corpus built to a smaller goal is a milestone rather than
v0.1, and supports weaker per-sub-type claims when you publish it.


### 4. Run one round

    ./run.sh --agent pi --max-rounds 1

Use `--agent claude` or `--agent codex` if that is your harness, or drop
`--agent` and the first installed adapter is used and named.

What happens, in order: the validator reports the current state, the seeking
agent takes one turn and writes items and a run log, the validator checks that
output, `tools/fetch-images.mjs` copies every image into `corpus/images/` and
links the copy from its record, `tools/second-pass.mjs` extracts the page
context of every item holding a single gold standard pass, a second agent turn
authors a blind second pass over that file alone and the tool merges it, the
reviewer judges every new candidate and writes verdicts and a report,
`tools/apply-verdicts.mjs`
turns those verdicts into statuses, and the validator reports again.

Three turns, not two. The second pass is separate because an agent that has just
authored a gold standard cannot then author an independent one, and two passes
from one turn agree by construction.

Expect exit code 1, meaning the goals are not met. That is the normal result of
round one: the criteria ask for hundreds of accepted items and a first round
produces a handful. Expect the round to take a while, because every item has to
be fetched and verified before it is recorded.


### 5. Read what it produced

- `rounds/round-01-seek-prompt.md`, `rounds/round-01-second-pass-prompt.md` and
  `rounds/round-01-review-prompt.md`. Exactly what each agent was told, kept so
  a round can be reproduced, or reproduced differently.
- `rounds/round-01-seek.md`. Which coverage gap the seeking agent chose, which
  search strategies it used, and what it dropped and why. If it reports that a
  sub-type could not be found, that is a finding about the taxonomy rather than
  a failed round.
- `rounds/round-01-second-pass-input.jsonl` and
  `rounds/round-01-second-pass.jsonl`. What the second gold standard author was
  shown, and what it concluded. Compare a few by hand: if the second passes read
  like the first, independence is not working.
- `corpus/functional-images.jsonl`. The items, one JSON object per line. Run
  `node tools/validate.mjs` for counts against every target, including how many
  items are waiting for a second pass, an adjudication, or a local image copy.
- `corpus/images/`. One copy of each image, named after its item, which the
  record links in `image_file`. Open a few: this is what a model will be given,
  and it is what keeps the item scoreable after the page changes.
- `rounds/round-01-review.jsonl` and `rounds/round-01-report.md`. The per-item
  verdicts, the corpus-level findings, the accept and reject rates, and the
  `STATUS:` line the loop reads to decide whether to stop.

Then check three things by hand, because nothing here can check them for you:

- Provenance. Pick three items and refetch them yourself. Confirm the markup,
  the surrounding text, and the observed alt value match what the record claims.
  Fabricated provenance is the one defect that would invalidate the benchmark,
  and it is the hardest to detect later.
- Gold standards. Do you agree with them? Where you do not, the disagreement is
  worth more than the item, and it belongs in directive 00 so that later rounds
  inherit it. Read the disagreements between the two passes first: they are
  where the judgment is visible.
- Reviewer bite. If the reviewer accepted nearly everything, it is not being
  adversarial enough. Its directive tells it to say so; check whether it did.


### 6. Decide what happens next

- The items look sound. Keep going with `./run.sh --agent pi`, which loops until
  the acceptance criteria are met or it hits the round cap of ten.
- The items look thin or wrong. Change the directive that produced them and run
  another single round. Editing a directive is the intended way to steer this,
  and the diff is the record of why the corpus looks the way it does.
- A target turns out to be unreachable. Record that in directive 00 rather than
  quietly lowering it. An unreachable target is a finding about the taxonomy.

Expect the empty-alt and dual-purpose quotas to be hardest to fill. Those items
require judging context rather than recognising an icon, which is exactly why
the benchmark needs them.


### If something goes wrong

- `no agent to run the rounds with`. Nothing was named and no adapter's command
  is on your `PATH`. Name one with `--agent`, set `AGENT_CMD`, or use
  `./run.sh --prompt seek` and paste the prompt into whatever you have.
- `exited successfully but did not write`. The agent did nothing. Usually a
  denied tool permission or a failed login, both of which look like a clean exit
  in non-interactive mode. Run the one-line harness check from step 1.
- Schema errors. The validator names the file, the line, and the field. Fix
  them, or hand the message to an agent to fix, before running another round.
  The loop will not run a reviewer over records the validator rejects.
- `Refused to apply round N verdicts`. The reviewer accepted something the
  specification forbids, such as a leaky item or one with a single gold standard
  pass. Nothing was written. Fix the review records, then `./run.sh --apply N`.


## Why this project exists first

The benchmark is only as good as the corpus. A deterministic heuristic for what
good alt text is has to be proved against real examples before any model can be
scored, and functional images are where the ground truth is clearest. Everything
here serves one question, taken from the repository
[README.md](../../README.md): what corpus of functional images and alt text do
we use to build the gold standard the benchmark scores against?


## How it works

Two agents, run in a loop, with a mechanical stop condition.

- A seeking agent searches the public web, verifies what it finds, and records
  items with their real context and an independently authored gold standard. It
  only collects images whose control already has an accessible name, from alt
  text, an ARIA label, a title, or the control's own text. This corpus is images
  paired with alternative descriptions, so a control that announces nothing is
  skipped rather than recorded.
- An adversarial reviewer tries to break every item, writes a verdict per item,
  and reports corpus-level defects the item-by-item pass cannot see.
- The loop repeats until the corpus meets the acceptance criteria, which include
  two consecutive review rounds that surface no new blocking findings.

Neither agent can declare the work finished. The seeking agent cannot promote
its own items to accepted, and the reviewer cannot edit the corpus. Statuses are
written by `tools/apply-verdicts.mjs`, which reads the reviewer's verdicts and
applies them mechanically after each review round. That separation is the only
real check in the design, so the directives enforce it explicitly.

Which agent does the work is not part of the design. A round is one prompt and
one turn, so any harness that can write files here and fetch pages can run it.


## Files

- `directives/00-corpus-goals.md`. The specification: what an item is, coverage
  and difficulty targets, collection constraints, and the acceptance criteria.
  Read this first. Every other file is bound by it.
- `directives/01-seek-functional-images.md`. The seeking agent's directive.
- `directives/02-second-pass.md`. The blind second gold standard pass.
- `directives/03-adversarial-review.md`. The adversarial reviewer's directive.
- `directives/04-loop.md`. How the rounds are sequenced and when to stop.
- `adapters/`. One small file per harness, plus the contract for adding another.
- `corpus/README.md`. The item and review record schemas, and the reason code
  vocabulary.
- `corpus/functional-images.jsonl`. The corpus. Created by the first round.
- `corpus/images/`. One local copy of every image the corpus records, named
  after its item and linked from the record. The one exception to the plain text rule
  in [../../AGENTS.md](../../AGENTS.md), because it is the artefact under test.
- `corpus/corrections.md`. Every change made to the corpus by hand rather than
  by a tool, with the reason.
- `rounds/`. Per-round prompts, run logs, review records, and reports. The audit
  trail.
- `tools/validate.mjs`. Enforces the schema, computes progress against every
  target, and decides whether the goals are met. No dependencies.
- `tools/second-pass.mjs`. Extracts the page context for the second pass turn,
  carrying no trace of the first answer, and merges the result back. The wall
  between the two passes.
- `tools/fetch-images.mjs`. Copies each recorded image into `corpus/images/`,
  links the copy from its record with a SHA-256, and checks the copies already
  there against those hashes. The only thing that writes the archive.
- `tools/apply-verdicts.mjs`. Applies a review round's verdicts to the corpus,
  all or nothing, and refuses any promotion the specification forbids. The only
  thing in the project that changes an item's status.
- `tools/fixtures/`. Synthetic records for the validator's self-test. Reserved
  example domains, never corpus data.
- `run.sh`. Sequences the loop and stops it at the right time.


## Command reference

    ./run.sh --selftest         verify the machinery, no model calls
    ./run.sh --status           progress report, runs no agents
    ./run.sh --images           archive the images, then check the archive
    ./run.sh --agent NAME       run using adapters/NAME.sh
    ./run.sh --max-rounds 1     one round, then stop
    ./run.sh --target 100       goal of 100 accepted items, not 250
    ./run.sh                    loop until the goals are met, cap 10
    ./run.sh --prompt seek      print the next round's seeking prompt
    ./run.sh --prompt second-pass  extract and print the second pass prompt
    ./run.sh --merge-passes N   merge round N's second gold standard passes
    ./run.sh --prompt review    print the pending review prompt
    ./run.sh --apply N          apply round N verdicts after a hand-run round
    ./run.sh --help             every flag and every environment variable

Any CLI, with no adapter:

    AGENT_CMD='mycli --headless {prompt}' ./run.sh

Exit codes: `0` goals met, `1` round cap reached with goals unmet, `2` a step
failed or the corpus has schema errors, `3` bad usage.

Each round is judged by the files it produced, not by the agent's exit code. An
agent that exits successfully without writing its round artefacts stops the loop
with an explanation, because in non-interactive mode a denied tool permission or
an expired token looks exactly like a clean run.

Validate or promote by hand at any time:

    node tools/validate.mjs            human readable
    node tools/validate.mjs --target 100  report against a smaller goal
    node tools/validate.mjs --json     machine readable
    node tools/validate.mjs --selftest fixtures and gate logic
    node tools/apply-verdicts.mjs --round 1 --dry-run
    node tools/apply-verdicts.mjs --round 1
    node tools/second-pass.mjs --extract --round 1
    node tools/second-pass.mjs --apply --round 1
    node tools/fetch-images.mjs --dry-run
    node tools/fetch-images.mjs
    node tools/fetch-images.mjs --verify


## Known limits

- Independence of the two gold standard passes rests on the second agent not
  reading a file it is told not to read. The prompt and its input carry no first
  answer, and each turn is a fresh session, so there is nothing to remember. But
  the corpus file is on disk, and nothing here can stop an agent opening it.
  What can be checked is checked: every `pass-b` must appear in a round's second
  pass file, and the reviewer codes `NO-SECOND-PASS` when it does not.
- The validator checks structure, targets, and internal consistency. It cannot
  check whether a gold standard is correct, or whether a page really says what
  an item claims. Only the reviewer refetching the page can do that.
- The loop can tell an agent that wrote nothing from one that worked, and a
  reviewer that skipped every candidate from one with nothing to review. It
  cannot tell a thorough round from a lazy one. That judgment is the reviewer's,
  and checking it is the reason round one is read by hand.
- Harnesses differ in what they can reach. Without a search tool the seeking
  agent can still fetch pages it can name, but it will lean on published
  accessibility resources rather than finding new material.
- Coverage targets are a first guess and have not survived contact with the web.
  If a sub-type turns out not to exist in the wild at the volume assumed, that
  is a finding about the taxonomy, to be recorded rather than worked around.
