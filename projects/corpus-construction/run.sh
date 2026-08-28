#!/usr/bin/env bash
# Drive the corpus construction stages.
#
#   ./run.sh --harvest [sector]   crawl the seed lists for candidates
#   ./run.sh --images             archive image bytes, then verify them
#   ./run.sh --select 30          move N candidates into the corpus for review
#   ./run.sh --review             run one review turn with an agent
#   ./run.sh --prompt review      print the next batch prompt instead
#   ./run.sh --apply-review 1     apply review/batch-01.jsonl
#   ./run.sh --export             hand the ready items to corpus-validation
#   ./run.sh --status             validate and report coverage
#   ./run.sh --selftest           offline, no network, no agent
#
# This is not a loop with a stop condition. It is stages you re-run with more
# seeds until --status says the coverage is where you want it. Only one stage
# needs a model:
#
#   harvest   a script. Fetches pages and slices markup out of the bytes.
#   images    a script. Downloads and hashes.
#   select    a script. Deduplicates and enforces the concentration caps.
#   review    an agent. Judges whether each image is functional and whether the
#             alt text the site shipped is good.
#   export    a script. Writes what people will review.
#
# Everything mechanical is mechanical on purpose. An earlier version of this
# project asked an agent to find pages, read them, and retype the markup, and it
# spent most of its budget re-fetching pages to check its own transcription.
#
# Choosing a harness for the review turn:
#   --agent NAME   run adapters/NAME.sh. See adapters/README.md for the ones
#                  that ship here and how to add another in about five lines.
#   AGENT_CMD      any command that takes a prompt and runs one agent turn.
#   neither        the first adapter whose command is on your PATH.
#
# How the prompt reaches the agent: it is written to review/batch-NN-prompt.md
# and piped on standard input, with PROMPT_FILE and BATCH in the environment. If
# AGENT_CMD or AGENT_FLAGS contains {prompt} or {prompt_file}, that placeholder
# is substituted instead and standard input is left empty.
#
# For a harness with no command line at all, including a chat window, run
# ./run.sh --prompt review, paste what it prints, then --apply-review NN.
# Nothing here cares who wrote the file.
#
# What the review harness must be able to do: read and write files under this
# project, and read image files. It needs no web access: harvest already fetched
# and archived everything the review looks at.
#
# Environment:
#   AGENT_CMD        command that runs one agent turn. Default: an adapter.
#   AGENT_FLAGS      extra arguments for it. Default: none.
#   GOAL             corpus size the share caps are of. Default: 250
#   BATCH_SIZE       items in one review turn, also --batch-size. Default: 30
#   IMAGE_FETCH_CMD  command that writes an image URL's bytes to standard output,
#                    for example 'curl -sSL'. Default: Node's built-in fetch.
#
# A review turn is checked by its artefact, not by the agent's exit code: an
# agent that exits zero without writing its batch file stops the run.
#
# Exit codes: 0 the stage did its work, 1 there was nothing to do, 2 a stage
# refused or failed, 3 bad usage or self-test failure.

set -u

PROJECT="$(cd "$(dirname "$0")" && pwd)"
POOL="$PROJECT/pool/candidates.jsonl"
SHORTLIST="$PROJECT/pool/shortlist.jsonl"
IMAGES="$PROJECT/pool/images"
CORPUS="$PROJECT/corpus/functional-images.jsonl"
REVIEWS="$PROJECT/review"

HARVEST="$PROJECT/tools/harvest.mjs"
FETCH="$PROJECT/tools/fetch-images.mjs"
SELECT="$PROJECT/tools/select.mjs"
APPLY="$PROJECT/tools/apply-review.mjs"
EXPORT="$PROJECT/tools/export.mjs"
VALIDATE="$PROJECT/tools/validate.mjs"

ADAPTERS="${ADAPTERS:-$PROJECT/adapters}"

AGENT_CMD="${AGENT_CMD:-}"
AGENT_FLAGS="${AGENT_FLAGS:-}"
GOAL="${GOAL:-250}"
# One review turn's worth. A batch is applied all or nothing, so a batch the size
# of the whole corpus means one bad line costs every judgment in it.
BATCH_SIZE="${BATCH_SIZE:-30}"
MODE=""
AGENT_NAME=""
AGENT_LABEL=""
SECTOR=""
ADD=""
BATCH=""

while [ $# -gt 0 ]; do
  case "$1" in
    --agent) AGENT_NAME="${2:-}"; shift; shift ;;
    --goal) GOAL="${2:-}"; shift; shift ;;
    --batch-size) BATCH_SIZE="${2:-}"; shift; shift ;;
    --harvest) MODE=harvest; shift
      case "${1:-}" in --*|'') ;; *) SECTOR="$1"; shift ;; esac ;;
    --images) MODE=images; shift ;;
    --select) MODE=select; ADD="${2:-}"; shift; shift ;;
    --review) MODE=review; shift ;;
    --prompt) MODE=prompt
      case "${2:-}" in
        review) shift; shift ;;
        *) echo "run.sh: --prompt takes review, the only agent turn there is" >&2
           exit 3 ;;
      esac ;;
    --apply-review) MODE=apply; BATCH="${2:-}"; shift; shift ;;
    --export) MODE=export; shift ;;
    --status) MODE=status; shift ;;
    --next-batch) MODE=next-batch; shift ;;
    --selftest) MODE=selftest; shift ;;
    -h|--help)
      awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
      exit 0 ;;
    *) echo "run.sh: unknown argument \"$1\"" >&2; exit 3 ;;
  esac
done

if [ -z "$MODE" ]; then
  echo "run.sh: name a stage. ./run.sh --help lists them." >&2
  exit 3
fi

case "$GOAL" in
  ''|*[!0-9]*|0) echo "run.sh: --goal needs a whole number of 1 or more" >&2
    exit 3 ;;
esac

case "$BATCH_SIZE" in
  ''|*[!0-9]*|0) echo "run.sh: --batch-size needs a whole number of 1 or more" >&2
    exit 3 ;;
esac

if [ "$MODE" = select ]; then
  case "$ADD" in
    ''|*[!0-9]*|0) echo "run.sh: --select needs how many items to add" >&2
      exit 3 ;;
  esac
fi

if [ "$MODE" = apply ]; then
  case "$BATCH" in
    ''|*[!0-9]*|0) echo "run.sh: --apply-review needs the batch number" >&2
      exit 3 ;;
  esac
fi

say() { printf '%s\n' "$*"; }
rule() { say "------------------------------------------------------------"; }

# Validate and report. The exit code carries the meaning: 0 clean, 1 empty,
# 2 schema errors.
check() { node "$VALIDATE" --corpus "$CORPUS" --goal "$GOAL"; }

# The next batch number: one past the highest batch that left any file behind,
# input or verdicts, so a batch that was prompted but never applied does not get
# its input silently replaced. review/ is the audit trail.
next_batch() {
  highest=0
  for name in "$REVIEWS"/batch-*.jsonl "$REVIEWS"/batch-*-prompt.md; do
    [ -e "$name" ] || continue
    base="$(basename "$name")"
    base="${base#batch-}"
    base="${base%%-*}"
    base="${base%.jsonl}"
    base="$(printf '%s' "$base" | sed 's/^0*//')"
    [ -n "$base" ] || base=0
    case "$base" in *[!0-9]*) continue ;; esac
    if [ "$base" -gt "$highest" ]; then highest="$base"; fi
  done
  echo $((highest + 1))
}

# The batch waiting to be applied: the highest one with an input file but no
# verdicts. Matters for a hand-run batch, where prompting and applying can be
# hours apart.
pending_batch() {
  target=0
  for name in "$REVIEWS"/batch-*-input.jsonl; do
    [ -e "$name" ] || continue
    base="$(basename "$name")"
    base="${base#batch-}"
    base="${base%-input.jsonl}"
    base="$(printf '%s' "$base" | sed 's/^0*//')"
    [ -n "$base" ] || base=0
    verdicts="$(printf '%s/batch-%02d.jsonl' "$REVIEWS" "$base")"
    if [ ! -e "$verdicts" ] && [ "$base" -gt "$target" ]; then target="$base"; fi
  done
  if [ "$target" -gt 0 ]; then echo "$target"; else next_batch; fi
}

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

# Freeze the unreviewed items into review/batch-NN-input.jsonl. The batch is a
# recorded set rather than "whatever was unreviewed when the agent looked", so a
# verdict file can be read back against exactly what was in front of it.
write_batch_input() {
  mkdir -p "$REVIEWS"
  node -e '
    const fs = require("fs")
    const [corpus, out, size] = process.argv.slice(1)
    if (!fs.existsSync(corpus)) { process.stdout.write("0"); process.exit(0) }
    const rows = []
    for (const line of fs.readFileSync(corpus, "utf8").split("\n")) {
      if (line.trim() === "") continue
      if (rows.length >= Number(size)) break
      const item = JSON.parse(line)
      if (item.status !== "unreviewed") continue
      rows.push(JSON.stringify({
        item_id: item.id,
        image_file: item.image_file,
        image_url: item.image_url,
        page_url: item.page_url,
        implementation: item.implementation,
        element_role: item.element_role,
        element_html: item.element_html,
        surrounding_text: item.surrounding_text,
        observed_alt: item.observed_alt,
        accessible_name: item.accessible_name,
        accessible_name_source: item.accessible_name_source,
        proposed_category: item.category,
        proposed_subtype: item.subtype,
      }))
    }
    if (rows.length > 0) fs.writeFileSync(out, rows.join("\n") + "\n")
    process.stdout.write(String(rows.length))
  ' "$CORPUS" "$1" "$BATCH_SIZE"
}

# An agent that exits zero having written nothing is the failure mode this is
# most likely to hit in practice: in print mode a denied tool permission looks
# exactly like a successful turn. Check the artefact, not the exit code.
require_artefact() {
  path="$1"; who="$2"
  if [ ! -s "$path" ]; then
    say ""
    say "The $who exited successfully but did not write $(basename "$path")."
    say "Nothing was written, so the batch did not happen. The usual cause is a"
    say "denied tool permission: in print mode that looks like a clean exit."
    say "Check the agent's output above, then name the tools it needs, for"
    say "example:"
    say "  AGENT_FLAGS='-p --permission-mode acceptEdits \\"
    say "    --allowedTools Read Write Edit' ./run.sh --review"
    exit 2
  fi
}

# Which command does an adapter drive? Its `# RUNS:` line, so the adapter file
# stays the single source of truth and this script needs no list of harnesses.
adapter_command() { sed -n 's/^# RUNS: *//p' "$1" | head -1; }

adapter_names() {
  for path in "$ADAPTERS"/*.sh; do
    [ -e "$path" ] || continue
    name="$(basename "$path" .sh)"
    printf '  --agent %-10s %s\n' "$name" "$(adapter_command "$path")"
  done
}

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
  say "run.sh: no agent to run the review with. Options:"
  say ""
  adapter_names
  say ""
  say "  AGENT_CMD='mycli --headless' ./run.sh --review   any command that takes"
  say "                                                   a prompt and runs one"
  say "                                                   turn"
  say "  ./run.sh --prompt review                         print the prompt"
  say "                                                   instead, for a harness"
  say "                                                   with no CLI"
  say ""
  say "See adapters/README.md for the contract. It is short."
  exit 3
}

# The prompt for one review batch. Deliberately thin: directives/review.md is the
# instruction, and this only says which batch it is and where its files are.
write_prompt() {
  batch="$1"; count="$2"
  nn="$(printf '%02d' "$batch")"
  file="$REVIEWS/batch-$nn-prompt.md"
  mkdir -p "$REVIEWS"
  cat > "$file" <<PROMPT
You are reviewing batch ${nn} of the functional image corpus for the AI alt text
benchmark.

The project directory is ${PROJECT}. Work from there, and read and write files
relative to it.

Read ${PROJECT}/directives/review.md and follow it exactly.

Your input is review/batch-${nn}-input.jsonl, which holds ${count} item(s), one
per line. Write your verdicts to review/batch-${nn}.jsonl, one per input item.

Every image has already been fetched and archived, and every piece of markup was
sliced out of the bytes that were fetched. Look at the archived image file, not
the live page. You need no web access, and re-fetching a page tells you less than
the record does, because the page may have changed since.

Do the work now. Do not ask for confirmation, and do not stop to summarise before
you have written review/batch-${nn}.jsonl.
PROMPT
  printf '%s\n' "$file"
}

# Run the review directive as one agent turn.
#
# The prompt goes to the agent on standard input, with its path in PROMPT_FILE,
# because every command line disagrees about flags and almost none disagree
# about stdin. A harness that wants the prompt as an argument says so with a
# {prompt} or {prompt_file} placeholder in AGENT_CMD or AGENT_FLAGS.
run_agent() {
  file="$1"; batch="$2"

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
    ( cd "$PROJECT" && PROMPT_FILE="$file" BATCH="$batch" "${argv[@]}" < /dev/null )
  else
    ( cd "$PROJECT" && PROMPT_FILE="$file" BATCH="$batch" "${argv[@]}" < "$file" )
  fi
}

# Copy the images the shortlist records, then check that the copies already
# there still match their recorded hashes. A URL that no longer resolves is an
# ordinary outcome and does not stop anything: that candidate simply cannot be
# selected. A copy that changed under us does stop it, because every judgment
# made about that item rests on those bytes.
#
# The shortlist comes first because the pool is enormous. A few dozen seeds
# yield tens of thousands of candidates and the caps in select.mjs keep a few
# hundred, so downloading the pool whole would be tens of thousands of requests
# for bytes that are then discarded.
archive_images() {
  say "choosing what is worth downloading"
  node "$SELECT" --shortlist "$(( GOAL * 5 ))" --goal "$GOAL" \
    --pool "$POOL" --corpus "$CORPUS" || true
  say ""
  say "archiving image copies"
  node "$FETCH" --corpus "$SHORTLIST" --images "$IMAGES"
  case $? in
    0) ;;
    1) say ""
       say "Those candidates keep their image URL and cannot be selected until a"
       say "copy exists. A later harvest can try again." ;;
    *) say "Refused to archive images, see above. Stopping."
       exit 2 ;;
  esac
  if ! node "$FETCH" --verify --corpus "$SHORTLIST" --images "$IMAGES"; then
    say ""
    say "The archive no longer matches the shortlist, listed above. Stopping: an"
    say "item whose copy changed cannot be judged against what was reviewed."
    exit 2
  fi
  if [ -f "$CORPUS" ]; then
    if ! node "$FETCH" --verify --corpus "$CORPUS" --images "$IMAGES"; then
      say ""
      say "The archive no longer matches the corpus, listed above. Stopping."
      exit 2
    fi
  fi
}

case "$MODE" in
  status)
    if [ ! -f "$CORPUS" ] && [ -f "$POOL" ]; then
      node "$VALIDATE" --corpus "$POOL" --goal "$GOAL" --quiet
      say ""
      say "No corpus yet. Next: ./run.sh --select 30"
      exit 1
    fi
    check; exit $? ;;

  next-batch) next_batch; exit 0 ;;

  harvest)
    if [ -n "$SECTOR" ]; then
      node "$HARVEST" --sector "$SECTOR"
    else
      node "$HARVEST"
    fi
    rc=$?
    [ "$rc" -le 1 ] || exit "$rc"
    rule
    say "Next: ./run.sh --images"
    exit "$rc" ;;

  images)
    archive_images
    rule
    say "Next: ./run.sh --select 30"
    exit 0 ;;

  select)
    pool="$POOL"
    [ -f "$SHORTLIST" ] && pool="$SHORTLIST"
    node "$SELECT" --add "$ADD" --goal "$GOAL" --pool "$pool" --corpus "$CORPUS"
    rc=$?
    [ "$rc" -le 1 ] || exit "$rc"
    rule
    check >/dev/null; vrc=$?
    if [ "$vrc" -eq 2 ]; then
      check
      say ""
      say "Selection left schema errors behind, listed above. Stopping."
      exit 2
    fi
    exit "$rc" ;;

  prompt)
    batch="$(pending_batch)"
    nn="$(printf '%02d' "$batch")"
    count="$(write_batch_input "$REVIEWS/batch-$nn-input.jsonl")"
    if [ "$count" -eq 0 ]; then
      say "Nothing is waiting to be reviewed. Next: ./run.sh --select 30" >&2
      exit 1
    fi
    file="$(write_prompt "$batch" "$count")"
    say "Batch $nn, $count item(s). Prompt written to $file" >&2
    say "Give this to any agent that can read and write files here:" >&2
    say "" >&2
    cat "$file"
    say "" >&2
    say "When it has written review/batch-$nn.jsonl:" >&2
    say "  ./run.sh --apply-review $batch" >&2
    exit 0 ;;

  review)
    resolve_agent
    batch="$(pending_batch)"
    nn="$(printf '%02d' "$batch")"
    count="$(write_batch_input "$REVIEWS/batch-$nn-input.jsonl")"
    if [ "$count" -eq 0 ]; then
      say "Nothing is waiting to be reviewed. Next: ./run.sh --select 30"
      exit 1
    fi
    say "reviewing batch $nn"
    say "project:  $PROJECT"
    say "agent:    $AGENT_LABEL"
    say "items:    $count"
    rule
    file="$(write_prompt "$batch" "$count")"
    if ! run_agent "$file" "$batch"; then
      say "the review agent failed on batch $nn"
      exit 2
    fi
    require_artefact "$REVIEWS/batch-$nn.jsonl" "review agent"
    rule
    node "$APPLY" "$batch" --corpus "$CORPUS" --reviews "$REVIEWS" || exit 2
    rule
    check; exit $? ;;

  apply)
    node "$APPLY" "$BATCH" --corpus "$CORPUS" --reviews "$REVIEWS" || exit 2
    rule
    check; exit $? ;;

  export)
    node "$EXPORT" --corpus "$CORPUS"
    rc=$?
    [ "$rc" -le 1 ] || exit "$rc"
    exit "$rc" ;;
esac

# --- self-test ------------------------------------------------------------
# Every tool's own offline test, then the stage driver in a scratch copy with a
# stub agent. No network, no model.

node "$PROJECT/tools/html.mjs" --selftest || exit 3
rule
node "$HARVEST" --selftest || exit 3
rule
node "$FETCH" --selftest || exit 3
rule
node "$SELECT" --selftest || exit 3
rule
node "$APPLY" --selftest || exit 3
rule
node "$EXPORT" --selftest || exit 3
rule
node "$VALIDATE" --selftest || exit 3
rule

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
proj="$tmp/project"
mkdir -p "$proj/corpus" "$proj/pool/images" "$proj/review" "$proj/tools" \
  "$proj/directives" "$proj/adapters" "$tmp/bin"
cp "$PROJECT"/tools/*.mjs "$proj/tools/"
cp "$PROJECT"/directives/*.md "$proj/directives/"
cp "$0" "$proj/run.sh"

fails=0
pass() { say "PASS $1"; }
fail() { say "FAIL $1"; fails=$((fails + 1)); }

# One selected item, with its bytes on disk so the review can be applied. Scratch
# data in a temporary directory, never written into the repository.
seed_corpus() {
  printf '%s' '<svg xmlns="http://www.w3.org/2000/svg"></svg>' \
    > "$proj/pool/images/fi-0001.svg"
  sha="$(node -e '
    const c = require("crypto"), fs = require("fs")
    process.stdout.write(c.createHash("sha256")
      .update(fs.readFileSync(process.argv[1])).digest("hex"))
  ' "$proj/pool/images/fi-0001.svg")"
  node -e '
    const fs = require("fs")
    const [out, sha] = process.argv.slice(1)
    fs.writeFileSync(out, JSON.stringify({
      id: "fi-0001", status: "unreviewed",
      page_url: "https://example.gov/help", domain: "example.gov",
      sector: "government", image_url: null,
      image_svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0 2 2\"/></svg>",
      image_file: "pool/images/fi-0001.svg", image_sha256: sha,
      implementation: "inline-svg", element_role: "button",
      element_html: "<button><svg xmlns=\"http://www.w3.org/2000/svg\"></svg></button>",
      surrounding_text: "Print Share Save", observed_alt: "Print this page",
      accessible_name: "Print this page", accessible_name_source: "aria-label",
      category: 2, subtype: "action-or-toggle-icon", retrieved: "2026-08-27",
      review_verdict: null, review_reason: null, alt_quality: null,
    }) + "\n")
  ' "$proj/corpus/functional-images.jsonl" "$sha"
}

# Stub review agent. Writes the verdict file a real turn would write, so the
# sequencing is exercised without a model call.
cat > "$tmp/bin/stub-agent" <<'STUB'
#!/usr/bin/env bash
set -u
prompt="$(cat)"
[ -n "$prompt" ] || prompt="$*"
nn="$(printf '%s' "$prompt" | sed -n 's/.*batch \([0-9][0-9]*\) of the functional.*/\1/p' | head -1)"
[ -n "$nn" ] || nn=01
node -e '
  const fs = require("fs")
  const [input, out] = process.argv.slice(1)
  const rows = []
  for (const line of fs.readFileSync(input, "utf8").split("\n")) {
    if (line.trim() === "") continue
    rows.push(JSON.stringify({
      item_id: JSON.parse(line).item_id, verdict: "keep", alt_quality: "good",
      reason: "Stub reviewer kept this without looking at anything.",
      subtype: null,
    }))
  }
  fs.writeFileSync(out, rows.join("\n") + "\n")
' "review/batch-${nn}-input.jsonl" "review/batch-${nn}.jsonl"
STUB
chmod +x "$tmp/bin/stub-agent"

# 1. Nothing harvested yet: report, do not crash.
out="$(cd "$proj" && ./run.sh --status 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'holds no items'; then
  pass "status with an empty corpus"
else
  fail "status with an empty corpus, exit $rc: $out"
fi

# 2. Batch numbering continues past the batches already on disk, and a batch that
#    was prompted but never applied is the one waiting.
: > "$proj/review/batch-01.jsonl"
: > "$proj/review/batch-07.jsonl"
got="$(cd "$proj" && ./run.sh --next-batch 2>&1)"
[ "$got" = "8" ] && pass "next batch after 01 and 07 is 8" \
  || fail "next batch was \"$got\", expected 8"
rm -f "$proj"/review/*

# 3. A review turn freezes its input, gets verdicts, and applies them. Statuses
#    change here and nowhere else.
seed_corpus
out="$(cd "$proj" && AGENT_CMD="$tmp/bin/stub-agent" AGENT_FLAGS= \
  ./run.sh --review 2>&1)"; rc=$?
ready="$(grep -c '"status":"ready"' "$proj/corpus/functional-images.jsonl" || true)"
if [ "$rc" -eq 0 ] && [ "$ready" -eq 1 ] && \
    [ -s "$proj/review/batch-01-input.jsonl" ] && \
    [ -s "$proj/review/batch-01.jsonl" ]; then
  pass "a review turn is applied and promotes the item"
else
  fail "review turn exited $rc with $ready ready: $out"
fi

# 3b. The batch input carries the context and the shipped alt, and no verdict.
#     The reviewer's job is to judge the alt, so it must be there; anything that
#     looks like a prior decision must not be.
leaked="$(node -e '
  const fs = require("fs")
  const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim().split("\n")[0])
  const allowed = ["item_id", "image_file", "image_url", "page_url",
    "implementation", "element_role", "element_html", "surrounding_text",
    "observed_alt", "accessible_name", "accessible_name_source",
    "proposed_category", "proposed_subtype"]
  process.stdout.write(Object.keys(rec).filter((k) => !allowed.includes(k)).join(",") || "none")
' "$proj/review/batch-01-input.jsonl")"
[ "$leaked" = "none" ] && pass "the batch input carries context, not decisions" \
  || fail "the batch input also carried $leaked"

# 3b. A batch is capped, because it is applied all or nothing. Three unreviewed
#     items and a size of two must yield an input of two.
rm -f "$proj"/review/*
cp "$proj/corpus/functional-images.jsonl" "$tmp/corpus-before-sizing.jsonl"
node -e '
  const fs = require("fs")
  const p = process.argv[1]
  const one = JSON.parse(fs.readFileSync(p, "utf8").trim().split("\n")[0])
  const rows = [1, 2, 3].map((k) => JSON.stringify({
    ...one, id: `fi-900${k}`, status: "unreviewed",
    review_verdict: null, review_reason: null, alt_quality: null,
  }))
  fs.writeFileSync(p, rows.join("\n") + "\n")
' "$proj/corpus/functional-images.jsonl"
out="$(cd "$proj" && BATCH_SIZE=2 ./run.sh --prompt review 2>&1)"
sized="$(wc -l < "$proj/review/batch-01-input.jsonl" | tr -d ' ')"
[ "$sized" = 2 ] && pass "a review batch is capped at the batch size" \
  || fail "batch size 2 wrote $sized line(s): $out"
rm -f "$proj"/review/*
cp "$tmp/corpus-before-sizing.jsonl" "$proj/corpus/functional-images.jsonl"

# 4. With everything reviewed, there is nothing to review. Say so rather than
#    running an agent on an empty batch.
out="$(cd "$proj" && AGENT_CMD="$tmp/bin/stub-agent" AGENT_FLAGS= \
  ./run.sh --review 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'Nothing is waiting'; then
  pass "an empty batch is reported, not run"
else
  fail "empty batch exited $rc: $out"
fi

# 5. Export writes only what a person should see, and the path it writes resolves
#    from corpus-validation.
mkdir -p "$tmp/vout"
out="$(cd "$proj" && node tools/export.mjs --corpus corpus/functional-images.jsonl \
  --out "$tmp/vout/functional-images.jsonl" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q 'no archived image where'; then
  pass "export refuses when the bytes are not where the reviewer looks"
else
  fail "export exited $rc: $out"
fi

# 6. An agent that exits zero without writing anything stops the run. This is
#    what a denied tool permission looks like in print mode.
rm -f "$proj"/review/*
node -e '
  const fs = require("fs")
  const p = process.argv[1]
  const item = JSON.parse(fs.readFileSync(p, "utf8").trim())
  item.status = "unreviewed"
  item.review_verdict = null; item.review_reason = null; item.alt_quality = null
  fs.writeFileSync(p, JSON.stringify(item) + "\n")
' "$proj/corpus/functional-images.jsonl"
out="$(cd "$proj" && AGENT_CMD=true AGENT_FLAGS= ./run.sh --review 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q 'did not write'; then
  pass "an agent that writes nothing stops the run"
else
  fail "silent agent exited $rc: $out"
fi

# 7. A failing agent stops the run instead of applying a stale batch.
rm -f "$proj"/review/*
out="$(cd "$proj" && AGENT_CMD=false AGENT_FLAGS= ./run.sh --review 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && pass "a failing agent stops the run" \
  || fail "failing agent exited $rc, expected 2"

# 8. A named adapter that does not exist is a usage error, not a crash.
out="$(cd "$proj" && ./run.sh --agent nonesuch --review 2>&1)"; rc=$?
if [ "$rc" -eq 3 ] && printf '%s' "$out" | grep -q 'no adapter named'; then
  pass "an unknown --agent name is a usage error"
else
  fail "unknown adapter exited $rc: $out"
fi

# 9. With no agent named and none installed, say so instead of failing obscurely
#    on an empty command.
out="$(cd "$proj" && ADAPTERS="$tmp/no-adapters" AGENT_CMD= AGENT_FLAGS= \
  ./run.sh --review 2>&1)"; rc=$?
if [ "$rc" -eq 3 ] && printf '%s' "$out" | grep -q 'no agent to run'; then
  pass "no harness at all is reported, not stumbled into"
else
  fail "missing harness exited $rc: $out"
fi

# 10. An adapter is discovered from its RUNS line and driven with the prompt on
#     standard input, which is how every shipped adapter is invoked.
rm -f "$proj"/review/*
{
  printf '#!/usr/bin/env bash\n'
  printf '# RUNS: %s\n' "$tmp/bin/stub-agent"
  printf 'exec "%s"\n' "$tmp/bin/stub-agent"
} > "$proj/adapters/stub.sh"
chmod +x "$proj/adapters/stub.sh"
out="$(cd "$proj" && AGENT_CMD= AGENT_FLAGS= ./run.sh --review 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'stub adapter'; then
  pass "adapter discovered and driven on standard input"
else
  fail "adapter case exited $rc: $out"
fi

# 11. A harness that wants the prompt as an argument says so with a placeholder,
#     and then standard input is left empty.
rm -f "$proj"/review/*
node -e '
  const fs = require("fs")
  const p = process.argv[1]
  const item = JSON.parse(fs.readFileSync(p, "utf8").trim())
  item.status = "unreviewed"
  item.review_verdict = null; item.review_reason = null; item.alt_quality = null
  fs.writeFileSync(p, JSON.stringify(item) + "\n")
' "$proj/corpus/functional-images.jsonl"
out="$(cd "$proj" && AGENT_CMD="$tmp/bin/stub-agent {prompt}" AGENT_FLAGS= \
  ./run.sh --review 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -s "$proj/review/batch-01.jsonl" ]; then
  pass "{prompt} placeholder passes the prompt as an argument"
else
  fail "placeholder case exited $rc: $out"
fi

# 12. The prompt can be printed for a harness with no command line, and a batch
#     run by hand is applied by exactly the same code as an automated one.
rm -f "$proj"/review/*
node -e '
  const fs = require("fs")
  const p = process.argv[1]
  const item = JSON.parse(fs.readFileSync(p, "utf8").trim())
  item.status = "unreviewed"
  item.review_verdict = null; item.review_reason = null; item.alt_quality = null
  fs.writeFileSync(p, JSON.stringify(item) + "\n")
' "$proj/corpus/functional-images.jsonl"
printed="$(cd "$proj" && ./run.sh --prompt review 2>/dev/null)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$printed" | grep -q 'batch 01 of the functional' && \
    printf '%s' "$printed" | grep -q 'directives/review.md' && \
    [ -s "$proj/review/batch-01-input.jsonl" ]; then
  pass "--prompt review writes the input and prints a prompt"
else
  fail "--prompt review exited $rc: $printed"
fi

{
  printf '%s' '{"item_id":"fi-0001","verdict":"keep","alt_quality":"good",'
  printf '%s' '"reason":"Reviewed the archived icon and the shipped alt by hand.",'
  printf '%s\n' '"subtype":null}'
} > "$proj/review/batch-01.jsonl"
out="$(cd "$proj" && ./run.sh --apply-review 1 2>&1)"; rc=$?
ready="$(grep -c '"status":"ready"' "$proj/corpus/functional-images.jsonl" || true)"
if [ "$rc" -eq 0 ] && [ "$ready" -eq 1 ]; then
  pass "--apply-review applies a hand-run batch"
else
  fail "--apply-review exited $rc with $ready ready: $out"
fi

# 13. A changed image copy is caught rather than blessed. Every judgment about an
#     item rests on the bytes that were there when it was judged.
printf 'tampered\n' >> "$proj/pool/images/fi-0001.svg"
: > "$proj/pool/candidates.jsonl"
out="$(cd "$proj" && ./run.sh --images 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q 'hashes to'; then
  pass "a changed image copy is caught, not blessed"
else
  fail "tampered copy exited $rc: $out"
fi

rule
if [ "$fails" -eq 0 ]; then say "stage driver self-test passed"; exit 0; fi
say "stage driver self-test failed, $fails case(s)"
exit 3
