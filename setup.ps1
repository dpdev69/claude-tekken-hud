# Tekken HUD prerequisites, in one go (Windows PowerShell 5.1 or PowerShell 7):
#
#   irm https://raw.githubusercontent.com/dpdev69/claude-tekken-hud/main/setup.ps1 | iex
#   .\setup.ps1 -Check      # report only, install nothing
#
# `irm | iex` cannot take parameters, so for -Check download the file first.
#
# git   DEBT count (required; install Git for Windows)
# node  runs ccusage for the TODAY spend row (optional; the row hides without it)
# ccusage, pinned, installed globally so the HUD skips npx's startup on every turn
#
# No admin. Safe to run again.
param([switch]$Check)

$ErrorActionPreference = 'Stop'

$CCUSAGE = '20.0.26'
$script:Missing = $false

$TICK  = [string][char]0x2714
$CROSS = [string][char]0x2718
$DOT   = [string][char]0x00B7

function ok($m)   { Write-Host '  ' -NoNewline; Write-Host $TICK -ForegroundColor Green -NoNewline; Write-Host " $m" }
function no($m)   { Write-Host '  ' -NoNewline; Write-Host $CROSS -ForegroundColor Red -NoNewline; Write-Host " $m"; $script:Missing = $true }
function warn($m) { Write-Host '  ' -NoNewline; Write-Host '!' -ForegroundColor Yellow -NoNewline; Write-Host " $m" }
function say($m)  { Write-Host ''; Write-Host $m }

function Test-Cmd($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

say "TEKKEN HUD $DOT checking your corner"

if (Test-Cmd git) {
  $gv = ''
  try { $gv = (git --version) -replace '^git version\s+', '' } catch { $gv = '' }
  ok "git $gv"
} else {
  no "git missing: DEBT stays '?'"
  Write-Host '    install: winget install Git.Git (or https://git-scm.com)'
}

if (-not (Test-Cmd node)) {
  if ((-not $Check) -and (Test-Cmd winget)) {
    say 'Installing Node with winget'
    try {
      winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    } catch {
      Write-Host "    winget failed: $($_.Exception.Message)"
    }
    Update-SessionPath
  }
  if (-not (Test-Cmd node)) {
    no 'node missing: the TODAY spend row hides'
    Write-Host '    install: https://nodejs.org (or winget install OpenJS.NodeJS.LTS)'
  }
}

if (Test-Cmd node) {
  $nv = ''
  try { $nv = (node --version) } catch { $nv = '' }
  ok "node $nv"

  $have = ''
  if (Test-Cmd ccusage.cmd) {
    try { $have = ((ccusage.cmd --version) | Select-Object -Last 1).ToString().Trim().Split(' ')[-1] } catch { $have = '' }
  }

  if ($have -eq $CCUSAGE) {
    ok "ccusage $CCUSAGE"
  } elseif ($Check) {
    warn "ccusage $CCUSAGE not installed globally: the HUD falls back to npx (slower)"
  } else {
    say "Installing ccusage $CCUSAGE"
    $installed = $false
    try {
      npm.cmd install -g "ccusage@$CCUSAGE" | Out-Null
      $installed = ($LASTEXITCODE -eq 0)
    } catch {
      $installed = $false
    }
    if ($installed) { ok "ccusage $CCUSAGE" } else { no 'npm install failed: the HUD falls back to npx' }
  }

  $cc = Get-Command ccusage.cmd -ErrorAction SilentlyContinue
  if ($cc) {
    $dir = Split-Path -Parent $cc.Source
    $npmDir = Join-Path $env:APPDATA 'npm'
    if ($dir.TrimEnd('\') -ine $npmDir.TrimEnd('\')) {
      warn "ccusage is outside ${npmDir}: the desktop app may not find it (put $dir on the system PATH)"
    }
  }
}

if ($script:Missing) { say "Fix the $CROSS items above"; exit 1 }

say 'Ready. In Claude Code:'
Write-Host '  /plugin marketplace add dpdev69/claude-tekken-hud'
Write-Host '  /plugin install tekken-hud@claude-tekken-hud'
Write-Host ''
