#!/bin/sh
# Tekken HUD prerequisites, in one go:
#
#   curl -fsSL https://raw.githubusercontent.com/dpdev69/claude-tekken-hud/main/setup.sh | sh
#   sh setup.sh --check     # report only, install nothing
#
# git   DEBT count (required; usually already there)
# node  runs ccusage for the TODAY spend row (optional; the row hides without it)
# ccusage, pinned, installed globally so the HUD skips npx's startup on every turn
#
# No sudo. Safe to run again.
set -eu

CCUSAGE=20.0.26
CHECK=0
MISSING=0
[ "${1:-}" = "--check" ] && CHECK=1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ok() { printf '  \033[32m✔\033[0m %s\n' "$1"; }
no() { printf '  \033[31m✘\033[0m %s\n' "$1"; MISSING=1; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

say "TEKKEN HUD · checking your corner"

if command -v git >/dev/null 2>&1; then
  ok "git $(git --version | awk '{print $3}')"
else
  no "git missing: DEBT stays '?'"
  [ "$(uname)" = Darwin ] && echo "    install: xcode-select --install" || echo "    install: your package manager (apt install git, dnf install git)"
fi

if ! command -v node >/dev/null 2>&1; then
  if [ $CHECK = 0 ] && command -v brew >/dev/null 2>&1; then
    say "Installing Node with Homebrew"
    brew install node
  else
    no "node missing: the TODAY spend row hides"
    echo "    install: https://nodejs.org (or brew install node, apt install nodejs npm)"
  fi
fi

if command -v node >/dev/null 2>&1; then
  ok "node $(node --version)"

  if [ "$(ccusage --version 2>/dev/null | awk '{print $NF}')" = "$CCUSAGE" ]; then
    ok "ccusage $CCUSAGE"
  elif [ $CHECK = 1 ]; then
    warn "ccusage $CCUSAGE not installed globally: the HUD falls back to npx (slower)"
  else
    say "Installing ccusage $CCUSAGE"
    npm install -g "ccusage@$CCUSAGE" >/dev/null && ok "ccusage $CCUSAGE" || no "npm install failed: the HUD falls back to npx"
  fi

  case "$(command -v ccusage 2>/dev/null)" in ""|/opt/homebrew/bin/*|/usr/local/bin/*) ;; *) warn "ccusage is outside /opt/homebrew/bin and /usr/local/bin: the desktop app may not find it (symlink it into /usr/local/bin)";; esac
fi

[ $MISSING = 1 ] && { say "Fix the ✘ items above"; exit 1; }

say "Ready. In Claude Code:"
echo "  /plugin marketplace add dpdev69/claude-tekken-hud"
echo "  /plugin install tekken-hud@claude-tekken-hud"
echo
