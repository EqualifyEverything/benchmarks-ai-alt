#!/usr/bin/env bash
# Adapter: template. Copy this, name it after your harness, make it executable,
# and set the RUNS line to the command it drives.
# RUNS: your-cli
#
# The prompt arrives on standard input. PROMPT_FILE holds its path, ROUND the
# round number, and ROLE either seek or review. The working directory is the
# project directory. Run one non-interactive turn and exit non-zero on failure.
#
# Whatever flags your harness needs, it needs to end up able to write files here
# and retrieve web pages without stopping to ask. See README.md in this
# directory.
set -u
exec your-cli --non-interactive "$(cat)"
