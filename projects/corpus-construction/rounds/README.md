# Rounds

One round is one pass of the loop: the seeking agent works, then the
adversarial reviewer judges. Each round leaves the files below here, all plain
text, all committed. Together they are the audit trail for how the corpus was
built.

- `round-NN-seek-prompt.md` and `round-NN-review-prompt.md`. Exactly what each
  agent was told, written by `run.sh` before the agent runs. A round can be
  rerun, rerun with a different harness, or run by hand from these.
- `round-NN-seek.md`. The seeking agent's run log. Which target it was closing,
  which search strategies it used and what each yielded, what it dropped and
  why, revisions applied from the previous review, and updated counts.
- `round-NN-review.jsonl`. One review record per item reviewed, following the
  review record schema in [../corpus/README.md](../corpus/README.md).
- `round-NN-report.md`. The reviewer's corpus-level findings, counts against
  every target, accept and reject rates, findings repeated from earlier rounds,
  and the machine-read status line.

`NN` is the zero-padded round number, starting at `01`.

Every report must contain exactly one line of this form:

    STATUS: new-blocking-findings=yes

or

    STATUS: new-blocking-findings=no

`tools/validate.mjs` reads that line to evaluate the two-quiet-rounds gate, and
`run.sh` will not stop the loop without it. A report missing the line is a
schema error, not a warning, because a silently unreadable status would let the
loop run forever or stop for the wrong reason.

Round files are never rewritten after the fact. If a later round overturns an
earlier finding, the later report says so. The history of what the reviewer got
wrong is part of what makes the corpus defensible.

This directory holds only this README until the first round runs.
