# Project: corpus construction

Build the corpus of functional images, page context, and gold standard alt text
that the benchmark scores against.

Status: built and tested, no corpus records collected yet. The loop runs, the
validator enforces the schema and the stop condition, and round one has not been
run.


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
  items with their real context and an independently authored gold standard.
- An adversarial reviewer tries to break every item, writes a verdict per item,
  and reports corpus-level defects the item-by-item pass cannot see.
- The loop repeats until the corpus meets the acceptance criteria, which include
  two consecutive review rounds that surface no new blocking findings.

Neither agent can declare the work finished. The seeking agent cannot promote
its own items to accepted, and the reviewer cannot edit the corpus. That
separation is the only real check in the design, so the directives enforce it
explicitly.


## Files

- `directives/00-corpus-goals.md`. The specification: what an item is, coverage
  and difficulty targets, collection constraints, and the acceptance criteria.
  Read this first. Every other file is bound by it.
- `directives/01-seek-functional-images.md`. The seeking agent's directive.
- `directives/02-adversarial-review.md`. The adversarial reviewer's directive.
- `directives/03-loop.md`. How the rounds are sequenced and when to stop.
- `corpus/README.md`. The item and review record schemas, and the reason code
  vocabulary.
- `corpus/functional-images.jsonl`. The corpus. Created by the first round.
- `rounds/`. Per-round run logs, review records, and reports. The audit trail.
- `tools/validate.mjs`. Enforces the schema, computes progress against every
  target, and decides whether the goals are met. No dependencies.
- `tools/fixtures/`. Synthetic records for the validator's self-test. Reserved
  example domains, never corpus data.
- `run.sh`. Sequences the loop and stops it at the right time.


## Running it

Requires Node and the `claude` CLI on your `PATH`. Nothing else.

Check the state of the corpus without running any agents:

    ./run.sh --status

Verify the machinery, including a stub run of the whole loop. No model calls, no
network, no cost:

    ./run.sh --selftest

Run the loop. Start with a small cap and read the round artefacts before
trusting it further:

    ./run.sh --max-rounds 1

Then, once a round looks sane:

    ./run.sh

The agent needs web access. If your permission settings do not already allow
`WebSearch` and `WebFetch`, name the tools it may use:

    AGENT_FLAGS='-p --permission-mode acceptEdits \
      --allowedTools WebSearch WebFetch Read Write Edit' ./run.sh

Exit codes: `0` goals met, `1` round cap reached with goals unmet, `2` a step
failed or the corpus has schema errors, `3` bad usage.

Validate the corpus directly at any time:

    node tools/validate.mjs            human readable
    node tools/validate.mjs --json     machine readable
    node tools/validate.mjs --selftest fixtures and gate logic


## What to expect from round one

The first round is a test of the directives, not a source of corpus data. Read
`rounds/round-01-seek.md` and `rounds/round-01-report.md` before running a
second round, and check three things by hand:

- Provenance. Pick three items and refetch them yourself. Confirm the markup,
  the surrounding text, and the observed alt match. Fabricated provenance is the
  one defect that would invalidate the benchmark, and it is the hardest to
  detect later.
- Gold standards. Do you agree with them? Where you do not, the disagreement is
  worth more than the item, and it belongs in the goals directive.
- Reviewer bite. If the reviewer accepted nearly everything in round one, it is
  not being adversarial enough, and its own directive says to say so.

Expect the empty-alt and dual-purpose quotas to be the hardest to fill. Those
items require judging context rather than recognising an icon, which is exactly
why the benchmark needs them.


## Known limits

- The two independent gold standard passes are only genuinely independent when
  the harness can run the second pass without showing it the first. Where it
  cannot, an item keeps a single pass, and the schema will not let it be
  accepted.
- The validator checks structure, targets, and internal consistency. It cannot
  check whether a gold standard is correct, or whether a page really says what
  an item claims. Only the reviewer refetching the page can do that.
- Coverage targets are a first guess and have not survived contact with the web.
  If a sub-type turns out not to exist in the wild at the volume assumed, that
  is a finding about the taxonomy, to be recorded rather than worked around.
