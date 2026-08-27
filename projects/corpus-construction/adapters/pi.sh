#!/usr/bin/env bash
# Adapter: pi. One non-interactive turn, prompt as a message argument.
# RUNS: pi
#
# pi has read, write, edit and bash tools and no per-tool approval gate, so a
# round needs no extra flags. It has no web tools: the agents retrieve pages
# with curl through the bash tool, which the directives allow for.
#
# --approve trusts this project's own AGENTS.md and settings for the run. Drop it
# if you would rather pi ignored them.
#
# The provider and model come from your pi configuration. To pin them here, add
# --provider and --model below.
set -u
exec pi -p --approve -- "$(cat)"
