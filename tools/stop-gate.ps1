# Stop-hook wrapper around tools/validate.ps1.
#
# Contract with Claude Code:
#   exit 0  - let the turn end
#   exit 2  - refuse to let the turn end; stderr is fed back to Claude
#
# The refusal is the point: a turn must not be reported as finished while a
# Critical or High check is failing. But an unconditional refusal is a trap -
# if a finding genuinely cannot be fixed, blocking forever would leave the
# session unable to say so. So the gate blocks, and keeps blocking, up to
# GATE_MAX_BLOCKS attempts in one session; after that it stands down and
# requires the failure to be reported to the user instead. That is the
# difference between a gate and a deadlock.
#
# Attempt counting is per session id, in .tmp/ (disposable, gitignored).

$ErrorActionPreference = "Continue"
$GATE_MAX_BLOCKS = 3

$root = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path $root ".tmp"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# The hook payload arrives on stdin. session_id keys the attempt counter;
# stop_hook_active tells us a previous block is what produced this turn.
$sessionId = "nosession"
try {
  $raw = [Console]::In.ReadToEnd()
  if ($raw) {
    $payload = $raw | ConvertFrom-Json
    if ($payload.session_id) { $sessionId = ($payload.session_id -replace '[^A-Za-z0-9_-]', '') }
  }
} catch { }

$validate = Join-Path $root "tools\validate.ps1"
if (-not (Test-Path $validate)) {
  # Missing validator is itself a finding, and a silent pass would be the
  # worst possible answer.
  [Console]::Error.WriteLine("ProDash gate: tools/validate.ps1 is missing. Restore it before finishing.")
  exit 2
}

$report = & $validate 2>&1 | Out-String
$failed = ($LASTEXITCODE -ne 0)

$counterFile = Join-Path $tmp ("gate-" + $sessionId + ".txt")

if (-not $failed) {
  if (Test-Path $counterFile) { Remove-Item $counterFile -Force -ErrorAction SilentlyContinue }
  exit 0
}

$attempts = 0
if (Test-Path $counterFile) {
  try { $attempts = [int](Get-Content $counterFile -Raw).Trim() } catch { $attempts = 0 }
}
$attempts++
Set-Content -Path $counterFile -Value $attempts -Encoding utf8

if ($attempts -ge $GATE_MAX_BLOCKS) {
  Remove-Item $counterFile -Force -ErrorAction SilentlyContinue
  # Stand down, but loudly. Exit 0 lets the turn end; the message goes to the
  # user so an unresolved failure is never invisible.
  Write-Output ("{""systemMessage"": ""ProDash validation is still failing after " +
    $GATE_MAX_BLOCKS + " attempts. The gate has stood down so the turn can end - " +
    "the failures must be reported, not left silent. Run tools/validate.ps1 to see them.""}")
  exit 0
}

[Console]::Error.WriteLine(@"
ProDash validation FAILED - the turn cannot be reported as complete yet.
This is attempt $attempts of $GATE_MAX_BLOCKS.

$report
What to do now, in order:
  1. Read each finding above. Critical and High are blocking; Medium and Low are not.
  2. Diagnose the root cause rather than the symptom. Each check's comment in
     tools/validate.ps1 says which real failure it was written for.
  3. Fix it, preserving existing behaviour.
  4. Re-run: powershell -NoProfile -ExecutionPolicy Bypass -File tools/validate.ps1
  5. Repeat until it passes.

If a finding genuinely cannot be fixed safely, do NOT work around the check and
do NOT mark anything verified that you have not verified. Say plainly, in your
reply to the user, what is failing and why it is blocked.
"@)
exit 2
