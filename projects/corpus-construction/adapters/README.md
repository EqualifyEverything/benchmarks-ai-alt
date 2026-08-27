# Harness adapters

One round of the loop is one agent turn. An adapter is the five lines that tell
one agent how to take a turn. Everything else in this project is harness-neutral
on purpose: the directives are plain Markdown, the tools are plain Node, and
nothing here depends on a particular vendor.

Pick one:

    ./run.sh --agent claude
    ./run.sh --agent codex
    ./run.sh --agent pi

With no `--agent`, the first adapter whose command is on your `PATH` is used, and
the loop says which one it chose.


## The contract

An adapter is an executable file named after the harness, `NAME.sh`, holding a
`# RUNS:` line that names the command it drives. `run.sh` reads that line, so
nothing but the adapter itself needs to know the harness exists.

When it runs:

- The prompt arrives on standard input. `PROMPT_FILE` holds its path, if a file
  is easier to hand to your CLI than a pipe.
- The working directory is the project directory,
  `projects/corpus-construction/`.
- `ROUND` holds the round number and `ROLE` is `seek` or `review`.
- It must run exactly one non-interactive turn and exit non-zero if the turn
  failed.

The adapter does not need to check the agent's work. `run.sh` verifies the round
by the files it produced, and stops with an explanation when they are missing.


## What the harness has to be able to do

- Read and write files under the project directory. The agents write the corpus,
  the run logs, the review records, and the reports.
- Retrieve real web pages. A fetch tool is ideal; `curl` in a shell tool works
  just as well, and for provenance it is arguably better, because the agent sees
  the markup rather than a rendering of it.
- Run without stopping to ask permission. A turn that blocks on a confirmation
  prompt is a turn that never finishes.

Web search is not strictly required, but the seeking agent is much weaker
without it: it can still fetch pages it can name, and it will lean on published
accessibility resources rather than finding new ones.

Check the adapter before you spend a round on it:

    echo "Reply with the single word: ok" | ./adapters/pi.sh

Some CLIs print an authentication failure and still exit successfully, so a
broken login can look like a round that ran and did nothing. `run.sh` catches
that by checking artefacts rather than exit codes, but one line up front is
cheaper than a wasted round.


## Adding an adapter

Copy `template.sh`, name it after your harness, make it executable, and set the
`# RUNS:` line. Then:

    ./run.sh --agent yourharness --max-rounds 1

If your CLI wants the prompt as an argument rather than on standard input, you do
not need an adapter at all:

    AGENT_CMD='mycli --headless {prompt}' ./run.sh

`{prompt}` is replaced with the prompt text as a single argument, and
`{prompt_file}` with its path. Without either placeholder the prompt is piped in.


## No command line at all

A harness with only a chat window can still run rounds. Ask for the prompt, paste
it in, and apply the verdicts when the agent has written its files:

    ./run.sh --prompt seek        # then paste the output into your agent
    ./run.sh --prompt review      # after the seek round has written its log
    ./run.sh --apply 1            # promote what the review accepted

Prompts are written to `rounds/round-NN-ROLE-prompt.md` either way, so a hand-run
round leaves the same audit trail as an automated one.
