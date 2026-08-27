#!/usr/bin/env bash
# Adapter: Codex CLI. One non-interactive turn, prompt on standard input.
# RUNS: codex
#
# workspace-write lets it write the corpus. Network access is switched on
# explicitly because the seeking agent cannot verify a page it cannot fetch, and
# the workspace sandbox blocks the network by default.
set -u
exec codex exec \
  --sandbox workspace-write \
  -c sandbox_workspace_write.network_access=true \
  -
