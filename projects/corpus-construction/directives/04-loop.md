# Directive 04: The loop

Seek, review, repeat, until the corpus meets the acceptance criteria in
[00-corpus-goals.md](00-corpus-goals.md).

Neither agent decides when the work is done. The seeking agent wants to fill
quotas and the reviewer wants to find defects, and both are wrong about
completion for the same reason: they see one round. The loop holds the stop
condition, and the stop condition is mechanical.

`../run.sh` implements this directive. Read it if you want the exact sequence;
what follows is what it does and why.


## One round

1. Validate. Run `node ../tools/validate.mjs`. If the corpus has schema errors,
   stop the loop. A reviewer cannot judge records the validator rejects, and a
   seeking agent that has written malformed records will keep writing them.
2. Seek. Run [01-seek-functional-images.md](01-seek-functional-images.md). It
   applies the previous round's required revisions first, then closes the
   thinnest coverage gap, then records new candidates.
3. Validate again. Same gate. This catches the round's own output before the
   reviewer wastes effort on it.
4. Archive the images. Run `node ../tools/fetch-images.mjs`, which copies every
   image the corpus records into `../corpus/images/`, names each copy after its
   item, and records the file's SHA-256 in the record. Then
   `node ../tools/fetch-images.mjs --verify` checks the copies already there
   against their recorded hashes. A URL that has stopped resolving does not stop
   the round; the item simply cannot be accepted until a copy exists. A copy whose
   bytes have changed does stop it, because every judgment about that item was
   made against the old ones.
5. Second pass. Run `node ../tools/second-pass.mjs --extract --round N`, which
   writes the page context of every item still holding one gold standard pass,
   and nothing that hints at what that pass said. Then run
   [02-second-pass.md](02-second-pass.md) in its own turn, on that file alone,
   and merge the result with `--apply --round N`. Skip the turn when the extract
   finds nothing to do.

   This step is a separate turn because independence cannot survive being in the
   same one. An agent that has just authored a gold standard cannot author a
   second without reading the first, so a `pass-b` written in the seeking turn
   is agreement by construction. Disagreements that come out of here are the
   point: they are real, and the next round's seeking agent adjudicates them.
6. Review. Run [03-adversarial-review.md](03-adversarial-review.md). It judges
   every candidate, writes review records, and writes the round report with its
   status line. It does not touch the corpus.
7. Apply the verdicts. Run `node ../tools/apply-verdicts.mjs --round N`. This is
   the only step that changes an item's status, and it is deterministic: accept
   becomes `accepted`, revise becomes `needs-revision`, reject becomes
   `rejected`. Nothing is written unless every record can be applied, so a
   malformed review round stops the loop instead of half-updating the corpus.
   The tool refuses to promote an item the specification forbids, even on an
   `accept`: a leaky one, one with a single gold standard pass, one whose two
   passes disagree with no adjudication recorded, or one whose image was never
   copied locally.
8. Validate a third time, and read the exit code. Zero means every acceptance
   criterion is met, and the loop stops. Anything else means another round.


## The stop condition

The loop stops when `tools/validate.mjs` exits zero, which requires all of:

- Every coverage, difficulty, discrimination, and diversity target in directive
  00 is met.
- Every accepted item has two independent gold standard passes that agree, or a
  recorded adjudication of the disagreement.
- At least 95 percent of accepted items carry no open blocking finding in the
  most recent review of that item. A blocking finding does not expire because a
  later round happened to review other items.
- The two most recent round reports both state
  `STATUS: new-blocking-findings=no`.

The last one is the gate that matters. Counts can be ground out. Two
consecutive quiet review rounds mean the reviewer has stopped finding new
classes of defect, which is the closest signal available that the corpus is
sound rather than merely large.

Nothing else may stop the loop. In particular, neither agent may declare the
corpus finished, and neither may edit the targets to reach them.


## The round cap

`run.sh` stops after a fixed number of rounds even if the goals are unmet.
Default 10, set with `--max-rounds`.

The cap exists because a loop that cannot converge should surface that to a
person rather than burn rounds. When the cap is hit, read the newest report
before raising it. Three signals mean the loop is stuck and needs a human
decision, not more rounds:

- The same blocking corpus-level finding repeats across three or more reports.
- A sub-type stays under quota for three rounds while the seeking agent reports
  it cannot find candidates. The taxonomy may not survive contact with the real
  web, which is a finding about the taxonomy.
- Accept rates stay near zero. The seeking agent and the reviewer disagree about
  the standard, and the standard is what needs fixing.

Recording that a target was unreachable is a legitimate outcome. Quietly
lowering it is not.


## Running it

From `projects/corpus-construction/`:

    ./run.sh --selftest               verify the loop itself, no model calls
    ./run.sh --status                 progress report, runs no agents
    ./run.sh --images                 archive image copies and check them
    ./run.sh --agent pi               run with a named harness adapter
    ./run.sh --max-rounds 3           run at most three rounds
    ./run.sh                          run until the goals are met, cap 10

Which agent runs a round is not part of this directive. A round is one prompt and
one turn, so any harness that can write files here and retrieve web pages can
take it. `run.sh` picks one from
[../adapters/README.md](../adapters/README.md), or takes `AGENT_CMD` for a CLI
with no adapter.

To run a round by hand instead, open the directive and follow it. The directives
are the substance; `run.sh` is a convenience that adds nothing but sequencing.
For a harness with no command line, `./run.sh --prompt seek` prints the prompt to
paste and `./run.sh --apply N` applies the verdicts afterwards, so a hand-run
round leaves the same audit trail as an automated one.

The first thing to read is the getting started walkthrough in
[../README.md](../README.md). It covers what to check by hand after round one,
which is the part no tool here can do for you.


## What the loop must never do

- Never stop because a round produced nothing. That is a finding for the report,
  not a reason to declare completion.
- Never let one agent play both roles in a round. The separation between
  collecting and judging is the only real check in this design.
- Never promote an item by hand. If a status looks wrong, fix the review record
  and re-run `tools/apply-verdicts.mjs`, so the corpus and the audit trail
  cannot disagree.
- Never discard a round's artefacts. `rounds/` is the audit trail, and a corpus
  whose construction cannot be audited cannot be defended.
- Never edit directive 00 to make the criteria reachable. Raise the conflict
  with a person instead.
