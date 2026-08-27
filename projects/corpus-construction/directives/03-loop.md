# Directive 03: The loop

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
4. Review. Run [02-adversarial-review.md](02-adversarial-review.md). It judges
   every candidate, writes review records, and writes the round report with its
   status line.
5. Validate a third time, and read the exit code. Zero means every acceptance
   criterion is met, and the loop stops. Anything else means another round.


## The stop condition

The loop stops when `tools/validate.mjs` exits zero, which requires all of:

- Every coverage, difficulty, discrimination, and diversity target in directive
  00 is met.
- Every accepted item has two independent gold standard passes, or a recorded
  adjudication.
- At least 95 percent of accepted items carry no open blocking finding from the
  most recent review round.
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

    ./run.sh --status                 progress report, runs no agents
    ./run.sh                          run until the goals are met, cap 10
    ./run.sh --max-rounds 3           run at most three rounds
    ./run.sh --selftest               verify the loop itself, no API calls

To run a round by hand instead, open the directive and follow it. The directives
are the substance; `run.sh` is a convenience that adds nothing but sequencing.


## What the loop must never do

- Never stop because a round produced nothing. That is a finding for the report,
  not a reason to declare completion.
- Never let one agent play both roles in a round. The separation between
  collecting and judging is the only real check in this design.
- Never discard a round's artefacts. `rounds/` is the audit trail, and a corpus
  whose construction cannot be audited cannot be defended.
- Never edit directive 00 to make the criteria reachable. Raise the conflict
  with a person instead.
