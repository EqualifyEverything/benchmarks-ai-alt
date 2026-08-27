#!/usr/bin/env bash
# Run the corpus construction loop: seek, then adversarially review, repeat
# until the acceptance criteria in directives/00-corpus-goals.md are met.
#
#   ./run.sh                 run until the goals are met or the cap is hit
#   ./run.sh --max-rounds 3  stop after three rounds regardless
#   ./run.sh --status        report progress and exit, running no agents
#   ./run.sh --selftest      exercise the loop with a stub agent, no API calls
#
# The loop is deliberately dumb. Every judgment lives in the directives, and
# every stop condition lives in tools/validate.mjs. This script only sequences
# them and stops at the right time.
#
# Environment:
#   AGENT_CMD     command used to run one directive. Default: claude
#   AGENT_FLAGS   flags passed to it. Default: -p --permission-mode acceptEdits
#   MAX_ROUNDS    same as --max-rounds. Default: 10
#
# The agent needs web access to do its job. If your permission settings do not
# already allow it, name the tools in AGENT_FLAGS, for example:
#   AGENT_FLAGS='-p --permission-mode acceptEdits --allowedTools WebSearch WebFetch Read Write Edit'
#
# Exit codes: 0 goals met, 1 cap reached with goals unmet, 2 a step failed,
# 3 bad usage or self-test failure.

set -u

PROJECT="$(cd "$(dirname "$0")" && pwd)"
CORPUS="$PROJECT/corpus/functional-images.jsonl"
ROUNDS="$PROJECT/rounds"
VALIDATE="$PROJECT/tools/validate.mjs"
APPLY="$PROJECT/tools/apply-verdicts.mjs"

AGENT_CMD="${AGENT_CMD:-claude}"
AGENT_FLAGS="${AGENT_FLAGS--p --permission-mode acceptEdits}"
MAX_ROUNDS="${MAX_ROUNDS:-10}"
MODE=loop

while [ $# -gt 0 ]; do
  case "$1" in
    --max-rounds) MAX_ROUNDS="${2:-}"; shift; shift ;;
    --status) MODE=status; shift ;;
    --selftest) MODE=selftest; shift ;;
    --next-round) MODE=next-round; shift ;;
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "run.sh: unknown argument \"$1\"" >&2; exit 3 ;;
  esac
done

case "$MAX_ROUNDS" in
  ''|*[!0-9]*|0) echo "run.sh: --max-rounds needs a whole number of 1 or more" >&2
    exit 3 ;;
esac

say() { printf '%s\n' "$*"; }
rule() { say "------------------------------------------------------------"; }

# Progress report. The exit code carries the meaning, so callers read it:
# 0 goals met, 1 not yet, 2 schema errors or no corpus file.
check() {
  node "$VALIDATE" --corpus "$CORPUS" --rounds "$ROUNDS"
}

# Next round number: one past the highest round already reviewed.
next_round() {
  highest=0
  for name in "$ROUNDS"/round-*-review.jsonl; do
    [ -e "$name" ] || continue
    base="$(basename "$name")"
    base="${base#round-}"
    base="${base%-review.jsonl}"
    base="$(printf '%s' "$base" | sed 's/^0*//')"
    [ -n "$base" ] || base=0
    if [ "$base" -gt "$highest" ]; then highest="$base"; fi
  done
  echo $((highest + 1))
}

# Run one directive as one agent turn. The directive file is the instruction;
# we only say which round it is and hand over the current status.
run_directive() {
  directive="$1"; round="$2"; role="$3"; status_text="$4"
  prompt="You are running round ${round} of the corpus construction loop for
the AI alt text benchmark, in the role of the ${role}.

Read ${PROJECT}/directives/${directive} and follow it exactly, including every
file it tells you to read first and every file it tells you to write. Use the
zero-padded round number ${round} in any file name that calls for it.

Current corpus status from tools/validate.mjs:

${status_text}

Do the work now. Do not ask for confirmation, and do not stop to summarise
before you have written your output files."

  # AGENT_FLAGS is intentionally word-split.
  # shellcheck disable=SC2086
  ( cd "$PROJECT" && $AGENT_CMD $AGENT_FLAGS "$prompt" )
}

case "$MODE" in
  status) check; exit $? ;;
  next-round) next_round; exit 0 ;;
esac

# --- self-test ------------------------------------------------------------
# Proves the loop sequences its steps, stops on the real signal, respects the
# cap, and fails loudly. Runs a stub agent in a scratch copy. No network.

if [ "$MODE" = selftest ]; then
  node "$VALIDATE" --selftest || exit 3
  rule
  node "$APPLY" --selftest || exit 3
  rule

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  proj="$tmp/project"
  mkdir -p "$proj/corpus" "$proj/rounds" "$proj/tools" "$proj/directives" "$tmp/bin"
  cp "$VALIDATE" "$APPLY" "$proj/tools/"
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
for a in "$@"; do prompt="$a"; done
round="$(printf '%s' "$prompt" | sed -n 's/.*running round \([0-9][0-9]*\) .*/\1/p' | head -1)"
[ -n "$round" ] || round=1
nn="$(printf '%02d' "$round")"
case "$prompt" in
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
      image_url: `https://${domain}/i/${n}.svg`, implementation: 'img',
      element_role: 'button',
      element_html: `<button><img src="/i/${n}.svg" alt="x"></button>`,
      surrounding_text: empty ? `Synthetic action ${n}` : '',
      destination: `Synthetic destination ${n}`,
      observed_alt: 'x', observed_alt_verdict: 'wrong',
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

  # 6. A failing agent stops the loop instead of spinning.
  rm -f "$proj"/rounds/*
  cp "$proj/tools/fixtures/valid-item.jsonl" "$proj/corpus/functional-images.jsonl"
  out="$(cd "$proj" && AGENT_CMD=false AGENT_FLAGS= ./run.sh --max-rounds 3 2>&1)"
  rc=$?
  [ "$rc" -eq 2 ] && pass "failing agent stops the loop" \
    || fail "failing agent exited $rc, expected 2"

  rule
  if [ "$fails" -eq 0 ]; then say "loop self-test passed"; exit 0; fi
  say "loop self-test failed, $fails case(s)"
  exit 3
fi

# --- the loop -------------------------------------------------------------

say "corpus construction loop"
say "project:     $PROJECT"
say "agent:       $AGENT_CMD $AGENT_FLAGS"
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

  say "running the seeking agent"
  if ! run_directive 01-seek-functional-images.md "$round" \
      "seeking agent" "$status_text"; then
    say "seeking agent failed in round $round"
    exit 2
  fi

  status_text="$(check)"; rc=$?
  if [ "$rc" -eq 2 ] && [ -f "$CORPUS" ]; then
    say "$status_text"
    say ""
    say "The seeking agent wrote records the validator rejects. Stopping so the"
    say "schema errors above can be fixed."
    exit 2
  fi

  say "running the adversarial reviewer"
  if ! run_directive 02-adversarial-review.md "$round" \
      "adversarial reviewer" "$status_text"; then
    say "adversarial reviewer failed in round $round"
    exit 2
  fi

  # Statuses change here and nowhere else. The seeking agent may not promote its
  # own work and the reviewer may not touch the corpus, so the verdicts are
  # applied mechanically from the review records.
  say "applying round $round verdicts"
  node "$APPLY" --round "$round" --corpus "$CORPUS" --rounds "$ROUNDS"
  case $? in
    0) ;;
    1) say "No verdicts to apply in round $round. The reviewer wrote no usable"
       say "records, which is a problem with the round, not a reason to continue."
       exit 2 ;;
    *) say "Refused to apply round $round verdicts, see above. Stopping."
       exit 2 ;;
  esac

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
