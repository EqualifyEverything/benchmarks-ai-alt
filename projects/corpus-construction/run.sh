#!/usr/bin/env bash
# Run the corpus construction loop: seek, take a blind second gold standard pass,
# then adversarially review, and repeat until the acceptance criteria in
# directives/00-corpus-goals.md are met.
#
#   ./run.sh                  run until the goals are met or the cap is hit
#   ./run.sh --agent pi       run the rounds with adapters/pi.sh
#   ./run.sh --max-rounds 3   stop after three rounds regardless
#   ./run.sh --target 100     work toward 100 accepted items, not 250
#   ./run.sh --status         report progress and exit, running no agents
#   ./run.sh --images         archive any missing image copies, then verify them
#   ./run.sh --prompt seek    print the next round's prompt and exit
#   ./run.sh --merge-passes 3 merge round 3's second gold standard passes
#   ./run.sh --apply 3        apply round 3 verdicts, after a hand-run round
#   ./run.sh --selftest       exercise the loop with a stub agent, no API calls
#
# The loop is deliberately dumb, and it is harness-neutral. Every judgment lives
# in the directives, every stop condition lives in tools/validate.mjs, and which
# agent runs a round is none of this script's business.
#
# Choosing a harness:
#   --agent NAME   run adapters/NAME.sh. See adapters/README.md for the ones
#                  that ship here and how to add another in about five lines.
#   AGENT_CMD      any command that takes a prompt and runs one agent turn.
#   neither        the first adapter whose command is on your PATH.
#
# How the prompt reaches the agent: it is written to
# rounds/round-NN-ROLE-prompt.md and piped on standard input, with PROMPT_FILE,
# ROUND and ROLE in the environment. If AGENT_CMD or AGENT_FLAGS contains
# {prompt} or {prompt_file}, that placeholder is substituted instead and
# standard input is left empty.
#
# For a harness with no command line at all, including a chat window, run
# ./run.sh --prompt seek, paste what it prints, then --prompt second-pass and
# --merge-passes N, then --prompt review and --apply N. The loop does not care
# who wrote the files, only that each role was a separate turn.
#
# What a harness must be able to do: read and write files under this project,
# and retrieve web pages, either with a fetch tool or with curl in a shell. Web
# search makes the seeking agent much more effective but is not required.
#
# Environment:
#   AGENT_CMD        command that runs one agent turn. Default: an adapter.
#   AGENT_FLAGS      extra arguments for it. Default: none.
#   MAX_ROUNDS       same as --max-rounds. Default: 10
#   TARGET           same as --target. Default: corpus/target.txt, else 250
#   IMAGE_FETCH_CMD  command that writes an image URL's bytes to standard output,
#                    for example 'curl -sSL'. Default: Node's built-in fetch.
#
# Every round is checked by its artefacts, not by the agent's exit code: an
# agent that exits zero without writing its files stops the loop.
#
# Exit codes: 0 goals met, 1 cap reached with goals unmet, 2 a step failed,
# 3 bad usage or self-test failure.

set -u

PROJECT="$(cd "$(dirname "$0")" && pwd)"
CORPUS="$PROJECT/corpus/functional-images.jsonl"
IMAGES="$PROJECT/corpus/images"
ROUNDS="$PROJECT/rounds"
VALIDATE="$PROJECT/tools/validate.mjs"
APPLY="$PROJECT/tools/apply-verdicts.mjs"
SECOND="$PROJECT/tools/second-pass.mjs"
FETCH="$PROJECT/tools/fetch-images.mjs"

ADAPTERS="${ADAPTERS:-$PROJECT/adapters}"

AGENT_CMD="${AGENT_CMD:-}"
AGENT_FLAGS="${AGENT_FLAGS:-}"
MAX_ROUNDS="${MAX_ROUNDS:-10}"
TARGET="${TARGET:-}"
TARGET_FILE="$PROJECT/corpus/target.txt"
MODE=loop
AGENT_NAME=""
AGENT_LABEL=""
ROLE_ARG=""
APPLY_ROUND=""
MERGE_ROUND=""

while [ $# -gt 0 ]; do
  case "$1" in
    --agent) AGENT_NAME="${2:-}"; shift; shift ;;
    --max-rounds) MAX_ROUNDS="${2:-}"; shift; shift ;;
    --target) TARGET="${2:-}"; shift; shift ;;
    --status) MODE=status; shift ;;
    --images) MODE=images; shift ;;
    --selftest) MODE=selftest; shift ;;
    --next-round) MODE=next-round; shift ;;
    --prompt) MODE=prompt; ROLE_ARG="${2:-}"; shift; shift ;;
    --apply) MODE=apply; APPLY_ROUND="${2:-}"; shift; shift ;;
    --merge-passes) MODE=merge; MERGE_ROUND="${2:-}"; shift; shift ;;
    -h|--help)
      awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
      exit 0 ;;
    *) echo "run.sh: unknown argument \"$1\"" >&2; exit 3 ;;
  esac
done

case "$MAX_ROUNDS" in
  ''|*[!0-9]*|0) echo "run.sh: --max-rounds needs a whole number of 1 or more" >&2
    exit 3 ;;
esac

# The goal, in accepted items. Stipulating it writes corpus/target.txt, so every
# later round, every bare validator run, and the git history all agree on what
# the loop is working toward. Count targets scale with it; shares do not.
TARGET_FLAGS=""
if [ -n "$TARGET" ]; then
  case "$TARGET" in
    ''|*[!0-9]*) echo "run.sh: --target needs a whole number of accepted items" >&2
      exit 3 ;;
  esac
  if [ "$TARGET" -lt 25 ]; then
    echo "run.sh: a target of $TARGET is too small to satisfy the coverage" >&2
    echo "targets in directive 00. Use 25 or more." >&2
    exit 3
  fi
  TARGET_FLAGS="--target $TARGET"
  if [ "$MODE" != selftest ]; then
    {
      echo "# The goal for this run, in accepted items. Read by tools/validate.mjs"
      echo "# and run.sh. Count targets in directives/00-corpus-goals.md scale to"
      echo "# it; the share targets are ratios and do not."
      echo "$TARGET"
    } > "$TARGET_FILE"
    echo "goal set to $TARGET accepted items, recorded in corpus/target.txt"
  fi
fi

if [ "$MODE" = prompt ]; then
  case "$ROLE_ARG" in
    seek|second-pass|review) ;;
    *) echo "run.sh: --prompt takes seek, second-pass or review" >&2; exit 3 ;;
  esac
fi

if [ "$MODE" = apply ]; then
  case "$APPLY_ROUND" in
    ''|*[!0-9]*|0) echo "run.sh: --apply needs the round number to apply" >&2
      exit 3 ;;
  esac
fi

if [ "$MODE" = merge ]; then
  case "$MERGE_ROUND" in
    ''|*[!0-9]*|0) echo "run.sh: --merge-passes needs the round number" >&2
      exit 3 ;;
  esac
fi

say() { printf '%s\n' "$*"; }
rule() { say "------------------------------------------------------------"; }

# Progress report. The exit code carries the meaning, so callers read it:
# 0 goals met, 1 not yet, 2 schema errors or no corpus file.
check() {
  node "$VALIDATE" --corpus "$CORPUS" --rounds "$ROUNDS" $TARGET_FLAGS
}

# Next round number: one past the highest round that left any artefact behind.
# Seek logs count, not just reviews, so a round that died between the two does
# not get its log overwritten by the next attempt. rounds/ is the audit trail,
# and a rewritten round file is lost evidence.
next_round() {
  highest=0
  for name in "$ROUNDS"/round-*-review.jsonl "$ROUNDS"/round-*-seek.md; do
    [ -e "$name" ] || continue
    base="$(basename "$name")"
    base="${base#round-}"
    base="${base%-review.jsonl}"
    base="${base%-seek.md}"
    base="$(printf '%s' "$base" | sed 's/^0*//')"
    [ -n "$base" ] || base=0
    if [ "$base" -gt "$highest" ]; then highest="$base"; fi
  done
  echo $((highest + 1))
}

# Count corpus items in a given status. Used to tell "nothing to review" apart
# from "the reviewer did not run".
count_status() {
  [ -f "$CORPUS" ] || { echo 0; return 0; }
  node -e '
    const fs = require("fs")
    const [file, want] = process.argv.slice(1)
    let n = 0
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue
      try { if (JSON.parse(line).status === want) n++ } catch {}
    }
    process.stdout.write(String(n))
  ' "$CORPUS" "$1"
}

# An agent that exits zero having written nothing is the failure mode this loop
# is most likely to hit in practice: in print mode a denied tool permission
# looks exactly like a successful turn. Check the artefacts, not the exit code.
require_artefact() {
  path="$1"; who="$2"
  if [ ! -s "$path" ]; then
    say ""
    say "The $who exited successfully but did not write $(basename "$path")."
    say "Nothing was written, so the round did not happen. The usual cause is a"
    say "denied tool permission: in print mode that looks like a clean exit."
    say "Check the agent's output above, then name the tools it needs, for"
    say "example:"
    say "  AGENT_FLAGS='-p --permission-mode acceptEdits \\"
    say "    --allowedTools WebSearch WebFetch Read Write Edit' ./run.sh"
    exit 2
  fi
}

# Which command does an adapter drive? Its `# RUNS:` line, so the adapter file
# stays the single source of truth and this script needs no list of harnesses.
adapter_command() {
  sed -n 's/^# RUNS: *//p' "$1" | head -1
}

adapter_names() {
  for path in "$ADAPTERS"/*.sh; do
    [ -e "$path" ] || continue
    name="$(basename "$path" .sh)"
    printf '  --agent %-10s %s\n' "$name" "$(adapter_command "$path")"
  done
}

# Decide what runs a round: a named adapter, an explicit AGENT_CMD, or the first
# adapter whose command is installed. Sets AGENT_CMD and AGENT_LABEL.
resolve_agent() {
  if [ -n "$AGENT_NAME" ]; then
    if [ ! -f "$ADAPTERS/$AGENT_NAME.sh" ]; then
      say "run.sh: no adapter named \"$AGENT_NAME\". Available:"
      adapter_names
      say ""
      say "Adding one takes about five lines. See adapters/README.md."
      exit 3
    fi
    AGENT_CMD="$ADAPTERS/$AGENT_NAME.sh"
    AGENT_LABEL="$AGENT_NAME adapter"
    return 0
  fi
  if [ -n "$AGENT_CMD" ]; then
    AGENT_LABEL="$AGENT_CMD $AGENT_FLAGS"
    return 0
  fi
  for path in "$ADAPTERS"/*.sh; do
    [ -e "$path" ] || continue
    cmd="$(adapter_command "$path")"
    [ -n "$cmd" ] || continue
    if command -v "$cmd" >/dev/null 2>&1; then
      AGENT_CMD="$path"
      AGENT_LABEL="$(basename "$path" .sh) adapter, $cmd found on PATH"
      return 0
    fi
  done
  say "run.sh: no agent to run the rounds with. Options:"
  say ""
  adapter_names
  say ""
  say "  AGENT_CMD='mycli --headless' ./run.sh    any command that takes a"
  say "                                           prompt and runs one turn"
  say "  ./run.sh --prompt seek                   print the prompt instead, for"
  say "                                           a harness with no CLI"
  say ""
  say "See adapters/README.md for the contract. It is short."
  exit 3
}

prompt_file() {
  printf '%s/round-%02d-%s-prompt.md\n' "$ROUNDS" "$1" "$2"
}

# The prompt for one round in one role. Deliberately thin: the directive is the
# instruction, and this only says which round it is, where the files are, and
# what the corpus looks like right now.
write_prompt() {
  directive="$1"; round="$2"; role="$3"; status_text="$4"; slug="$5"
  extra="${6:-}"
  file="$(prompt_file "$round" "$slug")"
  mkdir -p "$ROUNDS"
  cat > "$file" <<PROMPT
You are running round ${round} of the corpus construction loop for the AI alt
text benchmark, in the role of the ${role}.

The project directory is ${PROJECT}. Work from there, and read and write files
relative to it.

Read ${PROJECT}/directives/${directive} and follow it exactly, including every
file it tells you to read first and every file it tells you to write. Use the
zero-padded round number $(printf '%02d' "$round") in every file name that calls
for it.

This work needs real web pages. Use whatever retrieval your tools give you: a
fetch or search tool if you have one, otherwise curl in a shell. Record nothing
you have not retrieved yourself.

${extra}Current corpus status from tools/validate.mjs:

${status_text}

Do the work now. Do not ask for confirmation, and do not stop to summarise
before you have written your output files.
PROMPT
  printf '%s\n' "$file"
}

# The extra paragraph for the second pass turn. The whole point of that turn is
# that it works from the extracted context and not from the corpus, so the prompt
# says so as well as the directive.
second_pass_extra() {
  printf '%s\n' "The items to work on are in rounds/round-$(printf '%02d' "$1")-second-pass-input.jsonl, one per"
  printf '%s\n' "line. That file is your whole input. Do not open the corpus file or the"
  printf '%s\n' "seeking agent's log for this round: they hold the first pass, and reading"
  printf '%s\n' "either destroys the independence this turn exists to create."
  printf '\n'
}

# Run one directive as one agent turn.
#
# The prompt goes to the agent on standard input, with its path in PROMPT_FILE,
# because every command line disagrees about flags and almost none disagree
# about stdin. A harness that wants the prompt as an argument says so with a
# {prompt} or {prompt_file} placeholder in AGENT_CMD or AGENT_FLAGS.
run_directive() {
  directive="$1"; round="$2"; role="$3"; status_text="$4"; slug="$5"
  file="$(write_prompt "$directive" "$round" "$role" "$status_text" "$slug" \
    "${6:-}")"

  argv=()
  placeholder=no
  # AGENT_CMD and AGENT_FLAGS are intentionally word-split.
  # shellcheck disable=SC2086
  for word in $AGENT_CMD $AGENT_FLAGS; do
    case "$word" in
      *'{prompt_file}'*)
        argv+=("${word//\{prompt_file\}/$file}"); placeholder=yes ;;
      *'{prompt}'*)
        argv+=("${word//\{prompt\}/$(cat "$file")}"); placeholder=yes ;;
      *) argv+=("$word") ;;
    esac
  done

  if [ "$placeholder" = yes ]; then
    ( cd "$PROJECT" && PROMPT_FILE="$file" ROUND="$round" ROLE="$slug" \
      "${argv[@]}" < /dev/null )
  else
    ( cd "$PROJECT" && PROMPT_FILE="$file" ROUND="$round" ROLE="$slug" \
      "${argv[@]}" < "$file" )
  fi
}

# The round waiting to be reviewed: the highest one that was seeked but never
# reviewed. Matters for a hand-run round, where the two halves are separate
# commands and can be hours apart.
pending_review_round() {
  target=0
  for name in "$ROUNDS"/round-*-seek.md; do
    [ -e "$name" ] || continue
    base="$(basename "$name")"
    base="${base#round-}"
    base="${base%-seek.md}"
    base="$(printf '%s' "$base" | sed 's/^0*//')"
    [ -n "$base" ] || base=0
    reviewed="$(printf '%s/round-%02d-review.jsonl' "$ROUNDS" "$base")"
    if [ ! -e "$reviewed" ] && [ "$base" -gt "$target" ]; then target="$base"; fi
  done
  if [ "$target" -gt 0 ]; then echo "$target"; else next_round; fi
}

# Apply one round's verdicts, then report. Used by the loop and by --apply, so a
# hand-run round is promoted by exactly the same code as an automated one.
apply_round() {
  round="$1"; candidates="$2"
  say "applying round $round verdicts"
  node "$APPLY" --round "$round" --corpus "$CORPUS" --rounds "$ROUNDS"
  case $? in
    0) ;;
    1) if [ "$candidates" -gt 0 ]; then
         say "No verdicts to apply in round $round, though the corpus held"
         say "$candidates candidate item(s). That is a problem with the round, not"
         say "a reason to continue."
         exit 2
       fi
       say "No candidates were pending, so there were no verdicts to apply." ;;
    *) say "Refused to apply round $round verdicts, see above. Stopping."
       exit 2 ;;
  esac
}

# Copy every image the corpus records into corpus/images/, then check that the
# copies already there still match their recorded hashes. A URL that no longer
# resolves is an ordinary outcome and does not stop the round: the item simply
# cannot be accepted until a copy exists. A copy that changed under us does stop
# it, because every score taken from that item rests on those bytes.
archive_images() {
  say "archiving image copies"
  node "$FETCH" --corpus "$CORPUS" --images "$IMAGES"
  case $? in
    0) ;;
    1) say ""
       say "Those items keep their image URL and cannot be accepted until a copy"
       say "exists. The next round can try again." ;;
    *) say "Refused to archive images, see above. Stopping."
       exit 2 ;;
  esac
  if ! node "$FETCH" --verify --corpus "$CORPUS" --images "$IMAGES"; then
    say ""
    say "The archive no longer matches the corpus, listed above. Stopping: an"
    say "item whose copy changed cannot be scored against what was reviewed."
    exit 2
  fi
}

# Write the blind second pass input for a round. Returns 0 when there is work to
# do, 1 when no item is waiting for a second pass, and stops the run if the tool
# refuses. Every message goes to standard error so --prompt can print a prompt on
# standard output and nothing else.
extract_passes() {
  node "$SECOND" --extract --round "$1" --corpus "$CORPUS" --rounds "$ROUNDS" >&2
  rc=$?
  case $rc in
    0) return 0 ;;
    1) return 1 ;;
    *) say "Refused to extract round $1 second pass input, see above. Stopping." >&2
       exit 2 ;;
  esac
}

# Merge a round's second passes into the corpus. Like the verdicts, this is the
# tool's job and not an agent's: the agent writes a file and this decides whether
# it can be trusted.
merge_passes() {
  say "merging round $1 second gold standard passes"
  node "$SECOND" --apply --round "$1" --corpus "$CORPUS" --rounds "$ROUNDS"
  case $? in
    0|1) ;;
    *) say "Refused to merge round $1 second passes, see above. Stopping."
       exit 2 ;;
  esac
}

case "$MODE" in
  status) check; exit $? ;;
  images)
    archive_images
    rule
    check; exit $? ;;
  merge)
    merge_passes "$MERGE_ROUND"
    rule
    check; exit $? ;;
  next-round) next_round; exit 0 ;;
  prompt)
    status_text="$(check 2>&1)"
    if [ "$ROLE_ARG" = seek ]; then
      round="$(next_round)"
      file="$(write_prompt 01-seek-functional-images.md "$round" \
        "seeking agent" "$status_text" seek)"
    elif [ "$ROLE_ARG" = second-pass ]; then
      round="$(pending_review_round)"
      # Archive first, so the extracted context can point the second pass at a
      # local copy instead of a URL that may already have moved. Everything this
      # says goes to standard error, because standard output is the prompt.
      archive_images >&2
      if ! extract_passes "$round"; then
        say "Nothing is waiting for a second gold standard pass, so this turn" >&2
        say "can be skipped. Next: ./run.sh --prompt review" >&2
        exit 0
      fi
      file="$(write_prompt 02-second-pass.md "$round" \
        "second gold standard author" "$status_text" second-pass \
        "$(second_pass_extra "$round")")"
    else
      round="$(pending_review_round)"
      file="$(write_prompt 03-adversarial-review.md "$round" \
        "adversarial reviewer" "$status_text" review)"
    fi
    say "Round $round, $ROLE_ARG. Prompt written to $file" >&2
    say "Give this to any agent that can read and write files here:" >&2
    say "" >&2
    cat "$file"
    if [ "$ROLE_ARG" = second-pass ]; then
      say "" >&2
      say "Give it a fresh session, with no memory of the seeking turn. When it" >&2
      say "has written its file: ./run.sh --merge-passes $round" >&2
    fi
    if [ "$ROLE_ARG" = review ]; then
      say "" >&2
      say "When it has written its files: ./run.sh --apply $round" >&2
    fi
    exit 0 ;;
  apply)
    candidates="$(count_status candidate)"
    # Archive before promoting, not after: an item with no local copy of its
    # image cannot be accepted, and refusing the whole round for that would waste
    # a hand-run round's review.
    archive_images
    rule
    apply_round "$APPLY_ROUND" "$candidates"
    rule
    check; rc=$?
    if [ "$rc" -eq 0 ]; then
      rule
      say "Goals met. The corpus satisfies every acceptance criterion in"
      say "directives/00-corpus-goals.md."
    fi
    exit $rc ;;
esac

# --- self-test ------------------------------------------------------------
# Proves the loop sequences its steps, stops on the real signal, respects the
# cap, and fails loudly. Runs a stub agent in a scratch copy. No network.

if [ "$MODE" = selftest ]; then
  node "$VALIDATE" --selftest || exit 3
  rule
  node "$APPLY" --selftest || exit 3
  rule
  node "$SECOND" --selftest || exit 3
  rule
  node "$FETCH" --selftest || exit 3
  rule

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  proj="$tmp/project"
  mkdir -p "$proj/corpus" "$proj/rounds" "$proj/tools" "$proj/directives" "$tmp/bin"
  cp "$VALIDATE" "$APPLY" "$SECOND" "$FETCH" "$proj/tools/"

  # Image retrieval for the loop cases below. Every URL in the scratch corpora
  # uses a reserved example domain, so nothing is reachable and nothing should be
  # reached: this stands in for the network and always serves the same SVG.
  cat > "$tmp/bin/stub-fetch" <<'FETCHER'
#!/usr/bin/env bash
printf '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
FETCHER
  chmod +x "$tmp/bin/stub-fetch"
  export IMAGE_FETCH_CMD="$tmp/bin/stub-fetch"
  cp -R "$PROJECT/tools/fixtures" "$proj/tools/"
  cp "$0" "$proj/run.sh"
  cp "$PROJECT"/directives/*.md "$proj/directives/"

  # Stub agent. Writes the artefacts a real round would write, so the loop's
  # sequencing and stop condition are exercised without any model call. Its
  # reviews are unconditional accepts, and it reports a blocking finding in
  # round 1 only, so two quiet rounds cannot arrive before round 3.
  cat > "$tmp/bin/stub-agent" <<'STUB'
#!/usr/bin/env bash
set -u
prompt="$(cat)"
[ -n "$prompt" ] || prompt="$*"
round="$(printf '%s' "$prompt" | sed -n 's/.*running round \([0-9][0-9]*\) .*/\1/p' | head -1)"
[ -n "$round" ] || round=1
nn="$(printf '%02d' "$round")"
# The second pass branch is tested first because its prompt mentions the seeking
# agent's log, in telling it not to read it. Real adapters do not sniff prompts;
# they are told the role in ROLE.
case "$prompt" in
  *"second gold standard author"*)
    printf 'stub second pass round %s\n' "$round" \
      > "rounds/round-${nn}-second-pass.md"
    # The stub reads the corpus to copy the first pass, so its answers agree and
    # the round can be promoted. A real second pass agent must never do this: the
    # whole point of the turn is that it has not seen the first answer.
    node -e '
      const fs = require("fs")
      const [input, corpus] = process.argv.slice(1)
      const gold = new Map()
      if (fs.existsSync(corpus)) {
        for (const line of fs.readFileSync(corpus, "utf8").split("\n")) {
          if (line.trim() === "") continue
          const item = JSON.parse(line)
          gold.set(item.id, item.gold_alt)
        }
      }
      const out = []
      for (const line of fs.readFileSync(input, "utf8").split("\n")) {
        if (line.trim() === "") continue
        const rec = JSON.parse(line)
        out.push(JSON.stringify({
          item_id: rec.item_id,
          alt: gold.get(rec.item_id) ?? "Stub second pass",
          rationale: "Stub second pass, agreeing so the loop can be tested.",
        }))
      }
      process.stdout.write(out.length ? out.join("\n") + "\n" : "")
    ' "rounds/round-${nn}-second-pass-input.jsonl" \
      corpus/functional-images.jsonl > "rounds/round-${nn}-second-pass.jsonl"
    ;;
  *"seeking agent"*)
    printf 'stub seek round %s\n' "$round" > "rounds/round-${nn}-seek.md"
    ;;
  *"adversarial reviewer"*)
    {
      printf 'stub review round %s\n\n' "$round"
      if [ "$round" -le 1 ]; then
        printf 'STATUS: new-blocking-findings=yes\n'
      else
        printf 'STATUS: new-blocking-findings=no\n'
      fi
    } > "rounds/round-${nn}-report.md"
    node -e '
      const fs = require("fs")
      const [file, round] = process.argv.slice(1)
      const out = []
      if (fs.existsSync(file)) {
        for (const line of fs.readFileSync(file, "utf8").split("\n")) {
          if (line.trim() === "") continue
          const item = JSON.parse(line)
          if (item.status === "rejected") continue
          out.push(JSON.stringify({
            item_id: item.id, round: Number(round), verdict: "accept",
            reason_codes: ["CLEAN"],
            evidence: "Stub reviewer accepted this item without checking anything.",
            required_change: null, blocking: false,
          }))
        }
      }
      process.stdout.write(out.length ? out.join("\n") + "\n" : "")
    ' corpus/functional-images.jsonl "$round" > "rounds/round-${nn}-review.jsonl"
    ;;
  *) echo "stub-agent: unrecognised role in prompt" >&2; exit 1 ;;
esac
STUB
  chmod +x "$tmp/bin/stub-agent"

  # A synthetic corpus that satisfies every coverage criterion, so the loop's
  # stop condition can be tested. Scratch data in a temporary directory, never
  # written into the repository.
  cat > "$tmp/gen.mjs" <<'GEN'
const subtypes = [
  ['linked-standalone-logo', 1, 40],
  ['standalone-navigational-link', 1, 40],
  ['form-control-or-image-button', 2, 40],
  ['action-or-toggle-icon', 2, 40],
  ['functional-non-unicode-emoji', 3, 40],
  ['linked-complex-graphic-or-image-map', 4, 40],
  ['structural-break-or-reader-control', 5, 40],
]
const lines = []
let n = 0
for (const [subtype, category, count] of subtypes) {
  for (let i = 0; i < count; i++) {
    n++
    const domain = `d${n % 40}.example.com`
    const empty = n % 5 === 0
    const alt = empty ? '' : `Synthetic action ${n}`
    lines.push(JSON.stringify({
      id: `fi-${String(n).padStart(4, '0')}`,
      status: 'accepted', round_added: 1, category, subtype,
      page_url: `https://${domain}/page/${n}`, domain,
      image_url: `https://${domain}/i/${n}.svg`,
      image_file: null, image_sha256: null, implementation: 'img',
      element_role: 'button',
      element_html: `<button><img src="/i/${n}.svg" alt="x"></button>`,
      surrounding_text: empty ? `Synthetic action ${n}` : '',
      destination: `Synthetic destination ${n}`,
      observed_alt: 'x', observed_alt_verdict: 'wrong',
      accessible_name: 'x', accessible_name_source: 'alt',
      gold_alt: alt,
      gold_alt_rationale: 'Synthetic fixture rationale long enough to satisfy the minimum length rule.',
      gold_alt_passes: [
        { author: 'pass-a', alt, rationale: 'synthetic' },
        { author: 'pass-b', alt, rationale: 'synthetic' },
      ],
      adjudication: null,
      difficulty: n % 4 === 0 ? 'ambiguous' : 'standard',
      dual_purpose: n % 7 === 0,
      leakage_check: 'Synthetic fixture, leakage not applicable here.',
      leaky: false, retrieved: '2026-08-27',
      provenance_note: 'Synthetic self-test fixture, not corpus data.',
    }))
  }
}
process.stdout.write(lines.join('\n') + '\n')
GEN

  fails=0
  pass() { say "PASS $1"; }
  fail() { say "FAIL $1"; fails=$((fails + 1)); }

  # 1. No corpus file yet: report, do not crash.
  out="$(cd "$proj" && ./run.sh --status 2>&1)"; rc=$?
  if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q 'corpus file not found'; then
    pass "status with no corpus file"
  else
    fail "status with no corpus file, exit $rc"
  fi

  # 2. Round numbering continues past the rounds already on disk.
  : > "$proj/rounds/round-01-review.jsonl"
  : > "$proj/rounds/round-07-review.jsonl"
  got="$(cd "$proj" && ./run.sh --next-round 2>&1)"
  [ "$got" = "8" ] && pass "next round after 01 and 07 is 8" \
    || fail "next round was \"$got\", expected 8"
  rm -f "$proj"/rounds/*

  # 2b. A round that seeked but never got reviewed still counts, so its log is
  #     not overwritten by the next attempt.
  : > "$proj/rounds/round-09-seek.md"
  got="$(cd "$proj" && ./run.sh --next-round 2>&1)"
  [ "$got" = "10" ] && pass "an unreviewed seek round is not reused" \
    || fail "next round after an unreviewed round 09 was \"$got\", expected 10"
  rm -f "$proj"/rounds/*

  # 3. Complete corpus: the loop must keep going until two consecutive quiet
  #    review rounds, then stop with exit 0. The stub is quiet from round 2, so
  #    a correct loop stops at round 3, not round 2.
  node "$tmp/gen.mjs" > "$proj/corpus/functional-images.jsonl"
  out="$(cd "$proj" && AGENT_CMD="$tmp/bin/stub-agent" AGENT_FLAGS= \
    ./run.sh --max-rounds 6 2>&1)"; rc=$?
  ran="$(ls "$proj/rounds" | grep -c 'seek\.md$' || true)"
  if [ "$rc" -eq 0 ] && [ "$ran" -eq 3 ]; then
    pass "loop stopped at round 3 on two quiet rounds, exit 0"
  else
    fail "loop ran $ran rounds and exited $rc, expected 3 rounds and exit 0"
    say "$out"
  fi

  # 4. Incomplete corpus: the cap holds and the exit code says unmet.
  rm -f "$proj"/rounds/*
  cp "$proj/tools/fixtures/valid-item.jsonl" "$proj/corpus/functional-images.jsonl"
  out="$(cd "$proj" && AGENT_CMD="$tmp/bin/stub-agent" AGENT_FLAGS= \
    ./run.sh --max-rounds 2 2>&1)"; rc=$?
  ran="$(ls "$proj/rounds" | grep -c 'seek\.md$' || true)"
  if [ "$rc" -eq 1 ] && [ "$ran" -eq 2 ]; then
    pass "round cap respected, exit 1 with goals unmet"
  else
    fail "cap case ran $ran rounds and exited $rc, expected 2 and exit 1"
    say "$out"
  fi

  # 4b. Verdicts were applied: the candidate item was promoted by the tool, not
  #     by either agent.
  promoted="$(grep -c '"status":"accepted"' \
    "$proj/corpus/functional-images.jsonl" || true)"
  [ "$promoted" -eq 2 ] && pass "verdicts applied, candidate promoted to accepted" \
    || fail "expected 2 accepted items after promotion, found $promoted"

  # 5. Schema errors stop the loop rather than feeding junk to the reviewer.
  rm -f "$proj"/rounds/*
  cp "$proj/tools/fixtures/invalid-items.jsonl" "$proj/corpus/functional-images.jsonl"
  out="$(cd "$proj" && AGENT_CMD="$tmp/bin/stub-agent" AGENT_FLAGS= \
    ./run.sh --max-rounds 2 2>&1)"; rc=$?
  ran="$(ls "$proj/rounds" | grep -c 'seek\.md$' || true)"
  if [ "$rc" -eq 2 ] && [ "$ran" -eq 0 ]; then
    pass "schema errors stop the loop before any agent runs"
  else
    fail "schema case ran $ran rounds and exited $rc, expected 0 and exit 2"
  fi

  # 5b. An agent that exits zero without writing anything stops the loop. This
  #     is what a denied tool permission looks like in print mode.
  rm -f "$proj"/rounds/*
  cp "$proj/tools/fixtures/valid-item.jsonl" "$proj/corpus/functional-images.jsonl"
  out="$(cd "$proj" && AGENT_CMD=true AGENT_FLAGS= ./run.sh --max-rounds 2 2>&1)"
  rc=$?
  if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q 'did not write'; then
    pass "an agent that writes nothing stops the loop"
  else
    fail "silent agent exited $rc without the expected message"
    say "$out"
  fi

  # 6. A failing agent stops the loop instead of spinning.
  rm -f "$proj"/rounds/*
  cp "$proj/tools/fixtures/valid-item.jsonl" "$proj/corpus/functional-images.jsonl"
  out="$(cd "$proj" && AGENT_CMD=false AGENT_FLAGS= ./run.sh --max-rounds 3 2>&1)"
  rc=$?
  [ "$rc" -eq 2 ] && pass "failing agent stops the loop" \
    || fail "failing agent exited $rc, expected 2"

  # 7. A named adapter that does not exist is a usage error, not a crash.
  out="$(cd "$proj" && ./run.sh --agent nonesuch 2>&1)"; rc=$?
  if [ "$rc" -eq 3 ] && printf '%s' "$out" | grep -q 'no adapter named'; then
    pass "an unknown --agent name is a usage error"
  else
    fail "unknown adapter exited $rc: $out"
  fi

  # 8. With no agent named and none installed, say so instead of failing
  #    obscurely on an empty command.
  out="$(cd "$proj" && ADAPTERS="$tmp/no-adapters" AGENT_CMD= AGENT_FLAGS= \
    ./run.sh --max-rounds 1 2>&1)"; rc=$?
  if [ "$rc" -eq 3 ] && printf '%s' "$out" | grep -q 'no agent to run'; then
    pass "no harness at all is reported, not stumbled into"
  else
    fail "missing harness exited $rc: $out"
  fi

  # 9. An adapter is discovered from its RUNS line and driven with the prompt on
  #    standard input, which is how every shipped adapter is invoked.
  rm -f "$proj"/rounds/*
  cp "$proj/tools/fixtures/valid-item.jsonl" "$proj/corpus/functional-images.jsonl"
  mkdir -p "$proj/adapters"
  {
    printf '#!/usr/bin/env bash\n'
    printf '# RUNS: %s\n' "$tmp/bin/stub-agent"
    printf 'exec "%s"\n' "$tmp/bin/stub-agent"
  } > "$proj/adapters/stub.sh"
  chmod +x "$proj/adapters/stub.sh"
  out="$(cd "$proj" && AGENT_CMD= AGENT_FLAGS= ./run.sh --max-rounds 1 2>&1)"
  rc=$?
  if [ "$rc" -eq 1 ] && [ -s "$proj/rounds/round-01-seek.md" ] && \
      printf '%s' "$out" | grep -q 'stub adapter'; then
    pass "adapter discovered and driven on standard input"
  else
    fail "adapter case exited $rc without a round: $out"
  fi

  # 10. A harness that wants the prompt as an argument says so with a
  #     placeholder, and then standard input is left empty.
  rm -f "$proj"/rounds/*
  cp "$proj/tools/fixtures/valid-item.jsonl" "$proj/corpus/functional-images.jsonl"
  out="$(cd "$proj" && AGENT_CMD="$tmp/bin/stub-agent {prompt}" AGENT_FLAGS= \
    ./run.sh --max-rounds 1 2>&1)"; rc=$?
  if [ "$rc" -eq 1 ] && [ -s "$proj/rounds/round-01-seek.md" ]; then
    pass "{prompt} placeholder passes the prompt as an argument"
  else
    fail "placeholder case exited $rc without a round: $out"
  fi

  # 11. The prompt can be printed for a harness with no command line, and it
  #     names the round and the role.
  rm -f "$proj"/rounds/*
  out="$(cd "$proj" && ./run.sh --prompt seek 2>/dev/null)"; rc=$?
  if [ "$rc" -eq 0 ] && [ -s "$proj/rounds/round-01-seek-prompt.md" ] && \
      printf '%s' "$out" | grep -q 'role of the seeking agent'; then
    pass "--prompt writes and prints a round prompt"
  else
    fail "--prompt exited $rc: $out"
  fi

  # 12. A round run by hand is promoted by the same code as an automated one.
  rm -f "$proj"/rounds/*
  cp "$proj/tools/fixtures/valid-item.jsonl" "$proj/corpus/functional-images.jsonl"
  printf 'hand-run\n\nSTATUS: new-blocking-findings=no\n' \
    > "$proj/rounds/round-01-report.md"
  {
    printf '%s' '{"item_id":"fi-0001","round":1,"verdict":"accept",'
    printf '%s' '"reason_codes":["CLEAN"],"evidence":"Checked the page, the '
    printf '%s' 'markup and the observed alt by hand.","required_change":null,'
    printf '%s\n' '"blocking":false}'
  } > "$proj/rounds/round-01-review.jsonl"
  out="$(cd "$proj" && ./run.sh --apply 1 2>&1)"; rc=$?
  promoted="$(grep -c '"status":"accepted"' \
    "$proj/corpus/functional-images.jsonl" || true)"
  if [ "$rc" -eq 1 ] && [ "$promoted" -eq 2 ]; then
    pass "--apply promotes a hand-run round"
  else
    fail "--apply exited $rc with $promoted accepted: $out"
  fi

  # 13. An item holding one gold standard pass gets a second one from its own
  #     turn, on input that carries no trace of the first. This is the round
  #     sequence the two-pass rule depends on.
  rm -f "$proj"/rounds/*
  node -e '
    const fs = require("fs")
    const [src, dest] = process.argv.slice(1)
    const rows = fs.readFileSync(src, "utf8").trim().split("\n").map(JSON.parse)
    rows[0].gold_alt_passes = [rows[0].gold_alt_passes[0]]
    fs.writeFileSync(dest, rows.map((r) => JSON.stringify(r)).join("\n") + "\n")
  ' "$proj/tools/fixtures/valid-item.jsonl" \
    "$proj/corpus/functional-images.jsonl"
  out="$(cd "$proj" && AGENT_CMD="$tmp/bin/stub-agent" AGENT_FLAGS= \
    ./run.sh --max-rounds 1 2>&1)"; rc=$?
  input="$proj/rounds/round-01-second-pass-input.jsonl"
  passes="$(node -e '
    const fs = require("fs")
    const item = fs.readFileSync(process.argv[1], "utf8").trim().split("\n")
      .map(JSON.parse).find((r) => r.id === "fi-0001")
    process.stdout.write(item.gold_alt_passes.map((p) => p.author).join(","))
  ' "$proj/corpus/functional-images.jsonl")"
  if [ "$rc" -eq 1 ] && [ -s "$input" ] && \
      [ -s "$proj/rounds/round-01-second-pass.jsonl" ] && \
      [ "$passes" = "pass-a,pass-b" ] && \
      ! grep -q 'gold_alt\|difficulty' "$input"; then
    pass "a one-pass item gets a blind second pass in its own turn"
  else
    fail "second pass case exited $rc with passes \"$passes\""
    say "$out"
  fi

  # 13b. The extracted input holds the context and not the answer. If this ever
  #      leaks the first pass, every two-pass claim in the corpus is void.
  leaked="$(node -e '
    const fs = require("fs")
    const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8")
      .trim().split("\n")[0])
    const allowed = ["item_id", "page_url", "image_url", "image_file",
      "implementation", "element_role", "element_html", "surrounding_text",
      "destination"]
    process.stdout.write(Object.keys(rec)
      .filter((k) => !allowed.includes(k)).join(",") || "none")
  ' "$input")"
  [ "$leaked" = "none" ] && pass "second pass input carries context only" \
    || fail "second pass input also carried $leaked"

  # 14. A second pass agent that writes a log but no passes stops the loop. The
  #     items it skipped cannot be accepted, so continuing would waste a review.
  rm -f "$proj"/rounds/*
  node -e '
    const fs = require("fs")
    const [src, dest] = process.argv.slice(1)
    const rows = fs.readFileSync(src, "utf8").trim().split("\n").map(JSON.parse)
    rows[0].gold_alt_passes = [rows[0].gold_alt_passes[0]]
    fs.writeFileSync(dest, rows.map((r) => JSON.stringify(r)).join("\n") + "\n")
  ' "$proj/tools/fixtures/valid-item.jsonl" \
    "$proj/corpus/functional-images.jsonl"
  cat > "$tmp/bin/lazy-second" <<'LAZY'
#!/usr/bin/env bash
set -u
prompt="$(cat)"
round="$(printf '%s' "$prompt" | sed -n 's/.*running round \([0-9][0-9]*\) .*/\1/p' | head -1)"
nn="$(printf '%02d' "${round:-1}")"
case "$prompt" in
  *"second gold standard author"*)
    printf 'wrote a log and nothing else\n' > "rounds/round-${nn}-second-pass.md" ;;
  *"seeking agent"*) printf 'stub seek\n' > "rounds/round-${nn}-seek.md" ;;
  *) exit 1 ;;
esac
LAZY
  chmod +x "$tmp/bin/lazy-second"
  out="$(cd "$proj" && AGENT_CMD="$tmp/bin/lazy-second" AGENT_FLAGS= \
    ./run.sh --max-rounds 1 2>&1)"; rc=$?
  if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q 'log but no passes'; then
    pass "a second pass turn that writes no passes stops the loop"
  else
    fail "lazy second pass exited $rc"
    say "$out"
  fi

  # 15. The second pass can be run by hand, and the prompt tells the operator to
  #     use a fresh session and how to merge afterwards.
  rm -f "$proj"/rounds/*
  printf 'hand-run\n' > "$proj/rounds/round-01-seek.md"
  out="$(cd "$proj" && ./run.sh --prompt second-pass 2>&1 >/dev/null)"
  prompt_out="$(cd "$proj" && ./run.sh --prompt second-pass 2>/dev/null)"
  if [ -s "$proj/rounds/round-01-second-pass-input.jsonl" ] && \
      printf '%s' "$prompt_out" | grep -q 'second gold standard author' && \
      printf '%s' "$prompt_out" | grep -q 'Do not open the corpus file' && \
      printf '%s' "$out" | grep -q 'fresh session' && \
      printf '%s' "$out" | grep -q 'merge-passes 1'; then
    pass "--prompt second-pass extracts, prints and says how to merge"
  else
    fail "--prompt second-pass: $out"
  fi

  # 16. A stipulated goal is recorded, scales the count targets, and is picked
  #     up by later invocations that do not repeat the flag. A goal that only
  #     lived in one shell command would silently revert to 250 next round.
  out="$(cd "$proj" && ./run.sh --target 100 --status 2>&1)"
  again="$(cd "$proj" && ./run.sh --status 2>&1)"
  small="$(cd "$proj" && ./run.sh --target 4 --status 2>&1)"; rc=$?
  if printf '%s' "$out" | grep -q 'goal:  *100 accepted items' &&
    printf '%s' "$out" | grep -q '8 per sub-type' &&
    printf '%s' "$again" | grep -q 'goal:  *100 accepted items' &&
    [ "$rc" -eq 3 ] && printf '%s' "$small" | grep -q 'too small'; then
    pass "--target scales the goal and persists to later rounds"
  else
    fail "--target: exit $rc, first run: $out"
  fi

  # 17. Each round copies the images it can reach into corpus/images/ and links
  #     the copy from the record, so the corpus survives the page changing. A copy
  #     that changes afterwards stops the loop, because the item was reviewed
  #     against the bytes that were there.
  rm -f "$proj"/rounds/*
  rm -rf "$proj/corpus/images"
  cp "$proj/tools/fixtures/valid-item.jsonl" "$proj/corpus/functional-images.jsonl"
  out="$(cd "$proj" && AGENT_CMD="$tmp/bin/stub-agent" AGENT_FLAGS= \
    ./run.sh --max-rounds 1 2>&1)"
  linked="$(node -e '
    const fs = require("fs")
    const item = fs.readFileSync(process.argv[1], "utf8").trim().split("\n")
      .map(JSON.parse).find((r) => r.id === "fi-0001")
    process.stdout.write(`${item.image_file} ${(item.image_sha256 || "").length}`)
  ' "$proj/corpus/functional-images.jsonl")"
  if [ "$linked" = "corpus/images/fi-0001.svg 64" ] && \
      [ -s "$proj/corpus/images/fi-0001.svg" ]; then
    pass "the loop archives images and links the copies"
  else
    fail "archive linked \"$linked\""
    say "$out"
  fi

  printf 'tampered\n' >> "$proj/corpus/images/fi-0001.svg"
  out="$(cd "$proj" && ./run.sh --images 2>&1)"; rc=$?
  if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q 'hashes to'; then
    pass "a changed image copy is caught, not blessed"
  else
    fail "tampered copy exited $rc: $out"
  fi

  rule
  if [ "$fails" -eq 0 ]; then say "loop self-test passed"; exit 0; fi
  say "loop self-test failed, $fails case(s)"
  exit 3
fi

# --- the loop -------------------------------------------------------------

resolve_agent

say "corpus construction loop"
say "project:     $PROJECT"
say "agent:       $AGENT_LABEL"
say "max rounds:  $MAX_ROUNDS"
mkdir -p "$ROUNDS"

round="$(next_round)"
last=$((round + MAX_ROUNDS - 1))

while [ "$round" -le "$last" ]; do
  rule
  say "round $round"
  rule

  status_text="$(check)"; rc=$?
  if [ "$rc" -eq 2 ] && [ -f "$CORPUS" ]; then
    say "$status_text"
    say ""
    say "The corpus has schema errors. Fix them before another round: the"
    say "reviewer cannot trust records the validator rejects."
    exit 2
  fi
  say "$status_text"
  say ""

  nn="$(printf '%02d' "$round")"

  say "running the seeking agent"
  if ! run_directive 01-seek-functional-images.md "$round" \
      "seeking agent" "$status_text" seek; then
    say "seeking agent failed in round $round"
    exit 2
  fi
  require_artefact "$ROUNDS/round-$nn-seek.md" "seeking agent"

  candidates="$(count_status candidate)"

  status_text="$(check)"; rc=$?
  if [ "$rc" -eq 2 ] && [ -f "$CORPUS" ]; then
    say "$status_text"
    say ""
    say "The seeking agent wrote records the validator rejects. Stopping so the"
    say "schema errors above can be fixed."
    exit 2
  fi

  # Copy the images before the second pass, so its input can point at a local
  # file rather than a URL that may already have moved.
  say ""
  archive_images
  status_text="$(check)"; rc=$?
  if [ "$rc" -eq 2 ] && [ -f "$CORPUS" ]; then
    say "$status_text"
    say ""
    say "Archiving the images left schema errors behind. Stopping."
    exit 2
  fi

  # The second gold standard pass is its own turn, on its own input, because an
  # agent that has just written a gold standard cannot then author an independent
  # one. If nothing is waiting for a second pass, the turn is skipped.
  if extract_passes "$round"; then
    say ""
    say "running the second gold standard pass"
    if ! run_directive 02-second-pass.md "$round" \
        "second gold standard author" "$status_text" second-pass \
        "$(second_pass_extra "$round")"; then
      say "second pass agent failed in round $round"
      exit 2
    fi
    require_artefact "$ROUNDS/round-$nn-second-pass.md" "second pass agent"
    if [ ! -s "$ROUNDS/round-$nn-second-pass.jsonl" ]; then
      say ""
      say "The second pass agent wrote a log but no passes. Every item in"
      say "rounds/round-$nn-second-pass-input.jsonl needs one, and without them the"
      say "items cannot be accepted. Read its log before running again."
      exit 2
    fi
    merge_passes "$round"
    status_text="$(check)"; rc=$?
    if [ "$rc" -eq 2 ] && [ -f "$CORPUS" ]; then
      say "$status_text"
      say ""
      say "The merged second passes left schema errors behind. Stopping."
      exit 2
    fi
    say ""
  fi

  say "running the adversarial reviewer"
  if ! run_directive 03-adversarial-review.md "$round" \
      "adversarial reviewer" "$status_text" review; then
    say "adversarial reviewer failed in round $round"
    exit 2
  fi
  require_artefact "$ROUNDS/round-$nn-report.md" "adversarial reviewer"
  if [ "$candidates" -gt 0 ] && [ ! -s "$ROUNDS/round-$nn-review.jsonl" ]; then
    say ""
    say "The corpus holds $candidates candidate item(s) but the reviewer wrote no"
    say "review records. Every candidate must be judged, so this round cannot be"
    say "applied. Read the reviewer's output above before running again."
    exit 2
  fi

  # Statuses change here and nowhere else. The seeking agent may not promote its
  # own work and the reviewer may not touch the corpus, so the verdicts are
  # applied mechanically from the review records.
  apply_round "$round" "$candidates"

  rule
  check; rc=$?
  if [ "$rc" -eq 0 ]; then
    rule
    say "Goals met after round $round. The corpus satisfies every acceptance"
    say "criterion in directives/00-corpus-goals.md."
    exit 0
  fi
  if [ "$rc" -eq 2 ]; then
    say ""
    say "The round left schema errors behind, listed above. Stopping rather than"
    say "starting another round on records the validator rejects."
    exit 2
  fi

  round=$((round + 1))
done

rule
check || true
rule
say "Stopped at the round cap with the goals unmet. Read the newest report in"
say "rounds/ before raising the cap. If progress has stalled, the corpus needs a"
say "human decision, not more rounds."
exit 1
