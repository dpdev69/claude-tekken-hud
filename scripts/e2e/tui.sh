#!/bin/sh
# End-to-end check of the HUD in the REAL Claude Code TUI (tmux), with the mod loaded.
#
#   sh scripts/e2e/tui.sh <outDir> [cols...]          default cols: "60 100 160"
#   CASES="short" sh scripts/e2e/tui.sh out 100       run only some cases (short | long; default both)
#
# For each terminal width and each case it starts a fresh `claude --model haiku --plugin-dir <plugin>` in a temp
# dir, answers the folder-trust and bypass dialogs, waits for the HUD, asks for N background haiku subagents (each just
# waits 90s, with `timeout 90 tail -f /dev/null`: the Bash tool refuses a bare `sleep`), polls until their lines
# show in the band, saves the capture to <outDir>/<cols>-<case>.txt and asserts:
#   hud      the HUD lines (versus, "7d stamina", agent lines) appear above the prompt, in order
#   columns  agent lines are laid out per the band's column rule (several markers on a line when it allows)
#   width    no line is longer than <cols> characters (checked on the plain capture and on a -J joined one,
#            where a soft-wrapped line would show up as one over-long line)
# Prints PASS/FAIL per case and exits non-zero on any failure. Costs a handful of haiku turns per case.
#
# Env: CLAUDE_FLAGS (default "--permission-mode bypassPermissions"; each session runs in a throwaway temp dir),
# PLUGIN_DIR, TUI_ROWS (default 50).
set -u

OUT=${1:?usage: sh scripts/e2e/tui.sh <outDir> [cols...]}
shift
COLS=${*:-"60 100 160"}
CASES=${CASES:-"short long"}
HERE=$(cd "$(dirname "$0")" && pwd)
PLUGIN_DIR=${PLUGIN_DIR:-$(cd "$HERE/../../plugin" && pwd)}
DEFAULT_FLAGS="--permission-mode bypassPermissions"
CLAUDE_FLAGS=${CLAUDE_FLAGS:-$DEFAULT_FLAGS}
ROWS=${TUI_ROWS:-50}
S="hud$$"
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
WORK=$(mktemp -d)
FAILS=0
SUMMARY=""

cleanup() {
  tmux kill-session -t "$S" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

cap() { tmux capture-pane -p -t "$S" 2>/dev/null; }

# Answer the folder-trust prompt (No, exit is preselected) and, in bypass mode, its one-time warning. Any other
# prompt is left unanswered, so a case times out rather than approving something unplanned.
dialogs() {
  scr=$(cap)
  if printf '%s' "$scr" | grep -q 'Yes, I trust this folder\|Yes, I accept'; then
    tmux send-keys -t "$S" Down
    sleep 1
    tmux send-keys -t "$S" Enter
    return 0
  fi
  return 1
}

# Wait up to $1 seconds for a literal string on screen, answering dialogs meanwhile.
wait_for() {
  i=0
  while [ "$i" -lt "$1" ]; do
    cap | grep -q -- "$2" && return 0
    dialogs
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# Count agent markers per line (only a marker followed by a model-ish name: Claude's own UI uses ● too).
# Prints: MAXPERLINE AGENTLINES TOTALMARKERS
agent_stats() {
  node -e '
    const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n")
    const re = /[●○] (?:opus|sonnet|haiku|fable|model|claude)/gi
    const per = lines.map(l => (l.match(re) || []).length)
    console.log(Math.max(0, ...per), per.filter(n => n > 0).length, per.reduce((a, b) => a + b, 0))
  ' "$1"
}

run_case() {
  cols=$1
  name=$2
  n=$3
  descs=$4
  tag="$cols-$name"
  dir="$WORK/$tag"
  mkdir -p "$dir"
  cd "$dir" || return 1
  tmux kill-session -t "$S" 2>/dev/null
  tmux new-session -d -s "$S" -x "$cols" -y "$ROWS" -c "$dir"
  tmux send-keys -t "$S" "claude --model haiku $CLAUDE_FLAGS --plugin-dir $PLUGIN_DIR" Enter

  problems=""
  if ! wait_for 40 '7d stamina'; then
    cap >"$OUT/$tag.txt"
    echo "FAIL $tag: HUD never appeared (see $tag.txt)"
    FAILS=$((FAILS + 1))
    SUMMARY="$SUMMARY
$tag FAIL hud-never-appeared"
    tmux send-keys -t "$S" C-c
    return 1
  fi
  sleep 2
  cap >"$OUT/$tag.idle.txt"

  prompt="Launch exactly $n background subagents in parallel, all in one message, using the Agent tool with run_in_background true and model haiku. Use these exact descriptions, one agent each: $descs. Each subagent's prompt: Run exactly this command with the Bash tool in the foreground (not run_in_background), timeout 120000: timeout 90 tail -f /dev/null; echo waited. Then reply done. Do nothing else yourself; after launching, reply launched."
  tmux send-keys -t "$S" -l "$prompt"
  sleep 1
  tmux send-keys -t "$S" Enter

  # Poll for the agents' lines: main plus n agents.
  want=$((n + 1))
  waited=0
  best=""
  while [ "$waited" -lt 100 ]; do
    dialogs
    sleep 3
    waited=$((waited + 3))
    cap >"$WORK/now.txt"
    set -- $(agent_stats "$WORK/now.txt")
    if [ "${2:-0}" -ge 1 ] && [ "${3:-0}" -ge "$want" ]; then
      sleep 2 # let the band settle after the last agent joined
      break
    fi
  done
  cap >"$OUT/$tag.txt"
  tmux capture-pane -p -J -t "$S" >"$OUT/$tag.joined.txt"
  set -- $(agent_stats "$OUT/$tag.txt")
  maxper=$1
  alines=$2
  markers=$3

  # --- assertions ---
  if [ "$markers" -lt "$want" ]; then
    problems="$problems; agents: saw $markers agent markers, wanted $want (main + $n)"
  fi

  hudrow=$(grep -n '7d stamina' "$OUT/$tag.txt" | head -1 | cut -d: -f1)
  versus=$(grep -n '5h [0-9]*%' "$OUT/$tag.txt" | head -1 | cut -d: -f1)
  firstagent=$(grep -n '[●○] \(opus\|sonnet\|haiku\|fable\|model\)' "$OUT/$tag.txt" | head -1 | cut -d: -f1)
  promptrow=$(grep -n '^[[:space:]]*❯' "$OUT/$tag.txt" | tail -1 | cut -d: -f1)
  [ -z "$promptrow" ] && promptrow=$(grep -n '^[[:space:]]*> ' "$OUT/$tag.txt" | tail -1 | cut -d: -f1)
  if [ -z "$hudrow" ] || [ -z "$versus" ] || [ -z "$firstagent" ]; then
    problems="$problems; hud: missing lines (versus=${versus:-none} stamina=${hudrow:-none} agents=${firstagent:-none})"
  else
    [ "$versus" -lt "$hudrow" ] && [ "$hudrow" -lt "$firstagent" ] || problems="$problems; hud: lines out of order (versus=$versus stamina=$hudrow agents=$firstagent)"
    if [ -z "$promptrow" ]; then
      problems="$problems; hud: could not find the prompt line to compare against"
    elif [ "$firstagent" -ge "$promptrow" ]; then
      problems="$problems; hud: agent lines (row $firstagent) are not above the prompt (row $promptrow)"
    fi
  fi

  case $name in
    short)
      # widths ~21-22 chars each: three fit a row from ~78 cols, two from ~47
      if [ "$cols" -ge 90 ]; then need=3; elif [ "$cols" -ge 60 ]; then need=2; else need=1; fi
      [ "$maxper" -ge "$need" ] || problems="$problems; columns: want >=$need markers on a line at $cols cols, best line has $maxper"
      ;;
    long)
      # ~45-char entries never fit 3; with more than 3 agents they pair up once a half row is >= 30 (cols >= 63)
      if [ "$cols" -ge 63 ]; then
        [ "$maxper" -ge 2 ] || problems="$problems; columns: want pairs at $cols cols, best line has $maxper"
      else
        [ "$maxper" -le 1 ] || problems="$problems; columns: want one per line at $cols cols, a line has $maxper"
      fi
      [ "$maxper" -le 2 ] || problems="$problems; columns: long agents should pair, never triple; a line has $maxper"
      ;;
  esac

  for f in "$OUT/$tag.txt" "$OUT/$tag.joined.txt"; do
    over=$(node -e '
      const cols = Number(process.argv[2])
      const bad = require("fs").readFileSync(process.argv[1], "utf8").split("\n").map((l, i) => [i + 1, Array.from(l.replace(/\s+$/, "")).length]).filter(([, n]) => n > cols)
      console.log(bad.map(([i, n]) => i + ":" + n).join(" "))
    ' "$f" "$cols")
    [ -z "$over" ] || problems="$problems; width: $(basename "$f") has lines over $cols chars (line:len) $over"
  done

  # --- quit cleanly ---
  tmux send-keys -t "$S" -l '/exit'
  sleep 1
  tmux send-keys -t "$S" Enter
  sleep 3
  if tmux list-panes -t "$S" -F '#{pane_current_command}' 2>/dev/null | grep -qi 'claude\|node'; then
    tmux send-keys -t "$S" C-c
    sleep 1
    tmux send-keys -t "$S" C-c
    sleep 2
  fi
  tmux kill-session -t "$S" 2>/dev/null

  if [ -n "$problems" ]; then
    echo "FAIL $tag (maxPerLine=$maxper agentLines=$alines markers=$markers):${problems#;}"
    FAILS=$((FAILS + 1))
    SUMMARY="$SUMMARY
$tag FAIL"
  else
    echo "PASS $tag (maxPerLine=$maxper agentLines=$alines markers=$markers)"
    SUMMARY="$SUMMARY
$tag PASS"
  fi
}

SHORT_N=3
SHORT_D='"scan", "lint", "docs"'
LONG_N=6
LONG_D='"Audit dependency licences across monorepo", "Refactor authentication middleware layer now", "Write migration scripts for legacy tables", "Investigate flaky payments integration test", "Translate onboarding docs into Portuguese", "Profile the slowest dashboard queries daily"'

for c in $COLS; do
  for k in $CASES; do
    case $k in
      short) run_case "$c" short "$SHORT_N" "$SHORT_D" ;;
      long) run_case "$c" long "$LONG_N" "$LONG_D" ;;
      *) echo "unknown case $k" ;;
    esac
  done
done

echo
echo "== summary (captures in $OUT) =="
printf '%s\n' "$SUMMARY" | sed '/^$/d'
[ "$FAILS" -eq 0 ] && echo "ALL PASS" || echo "$FAILS FAILED"
[ "$FAILS" -eq 0 ]
