#!/usr/bin/env bash
# Adapter: Claude Code. One non-interactive turn, prompt as the query argument.
# RUNS: claude
#
# acceptEdits lets it write the corpus without asking. The tools are named
# because a denied tool in print mode looks exactly like a successful turn.
set -u
exec claude -p \
  --permission-mode acceptEdits \
  --allowedTools WebSearch WebFetch Read Write Edit Glob Grep Bash \
  "$(cat)"
