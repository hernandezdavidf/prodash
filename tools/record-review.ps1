# Append a review verdict to REVIEWS.md.
#
# WHY THIS EXISTS: a review that lives only in a chat transcript cannot gate
# anything. tools/validate.ps1 reads this ledger and blocks a release whose
# changes require a review that is absent or `blocked`. This script is how a
# reviewer writes that evidence, and the single format both ends agree on.
#
# It records the APP_VERSION the review applies to, so the evidence is tied to
# a release rather than to a date. Re-reviewing the same version appends a new
# line; the newest line for an agent is the one that counts, which is what
# makes "blocked, fixed, re-reviewed, pass" work.
#
#   powershell -File tools/record-review.ps1 -Agent security -Verdict pass `
#     -Summary "Worker diff reviewed, no new surfaces" -Evidence "validate clean; console clean"

param(
  [Parameter(Mandatory=$true)][ValidateSet("security","ux")][string]$Agent,
  [Parameter(Mandatory=$true)][ValidateSet("pass","notes","blocked")][string]$Verdict,
  [Parameter(Mandatory=$true)][string]$Summary,
  [string]$Evidence = "",
  # Digits and dots only. Unvalidated, this was a forgery vector: the value is
  # the first cell of the row, so a -Version containing pipes could close the
  # cell early and write a whole extra verdict - a `blocked` call that wrote
  # itself a `security | pass`. Found by the security review of 2026-10-15.
  # \z not $: in .NET, $ also matches before a trailing newline, so "4.26`n"
  # bound successfully and wrote a row split across two physical lines that
  # the gate could not parse.
  [ValidatePattern('^[0-9]+(\.[0-9]+)*\z')][string]$Version = ""
)

# ValidateSet is case-INSENSITIVE, so -Verdict "Blocked" bound happily and was
# written verbatim - while the gate's row pattern was case-sensitive and
# skipped it, keeping an older `pass` and losing the release block entirely.
# Normalise on write; the gate also matches case-insensitively now.
$Agent = $Agent.ToLowerInvariant()
$Verdict = $Verdict.ToLowerInvariant()

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$ledger = Join-Path $root "REVIEWS.md"
$indexPath = Join-Path $root "index.html"

# Same rules the gate uses, from one file, so the recorded scope and the
# recomputed scope cannot disagree.
. (Join-Path $PSScriptRoot "review-lib.ps1")

# The version under review is whatever index.html currently declares. Taking it
# from the file rather than from an argument means the evidence cannot drift
# from the thing it is evidence about.
if (-not $Version) {
  if (-not (Test-Path $indexPath)) {
    Write-Error "index.html not found, and no -Version given."
    exit 1
  }
  $m = [regex]::Match([IO.File]::ReadAllText($indexPath), 'var\s+APP_VERSION\s*=\s*"([0-9.]+)"')
  if (-not $m.Success) {
    Write-Error "Could not read APP_VERSION from index.html. Pass -Version explicitly."
    exit 1
  }
  $Version = $m.Groups[1].Value
}

# One line, pipe-separated, machine-readable by validate.ps1 and still
# readable by a person. Newlines in free text would break both, so they go.
# Pipes and newlines would forge a row. Everything else here is because
# REVIEWS.md is exempt from review and Jekyll renders it to a page on the
# app's own origin, so a summary is published markup.
#
# Stripping `<` and `>` was not enough: MARKDOWN IS MARKUP TOO. kramdown's
# inline attribute lists mean `![a](data:,){: onerror="..."}` becomes an
# <img> with a handler that fires on load, from a string containing no angle
# bracket, pipe or newline. So this removes the characters markdown gives
# meaning to, rather than the ones HTML does, plus the control and
# bidi-override ranges that can make a row display as something it is not.
# Printable ASCII only, by character code rather than by a Unicode regex
# class - the escape form was rejected outright by this PowerShell and, worse,
# failed AFTER the row had been built. Filtering on the code point removes
# every control character, zero-width space and bidi override in one pass,
# with nothing to get subtly wrong. A machine-read ledger does not need
# accents; the project's scripts are ASCII-only anyway.
$clean = {
  param([string]$s)
  $s = $s -replace '[\r\n]+', ' '
  $s = $s -replace '[|<>\[\]{}`*_!#&\\]', ''
  $s = -join ($s.ToCharArray() | Where-Object { [int]$_ -ge 32 -and [int]$_ -le 126 })
  $s.Trim()
}
$Summary  = & $clean $Summary
$Evidence = & $clean $Evidence

if (-not $Summary) { Write-Error "-Summary cannot be empty."; exit 1 }
if ($Verdict -ne "pass" -and -not $Evidence) {
  Write-Error "-Evidence is required for a '$Verdict' verdict: say what was found and what was checked."
  exit 1
}

# The fingerprint of what is actually being reviewed. The gate recomputes this
# and refuses a verdict whose scope no longer matches - which is what stops one
# recorded pass from approving every later change to files that never bump a
# version.
Push-Location $root
$base = Resolve-ReviewBase ""
$scope = $null
if ($base) {
  $changed = Get-ChangedVsBase $base
  if ($null -ne $changed) { $scope = Get-ReviewScope $changed }
}
Pop-Location
if (-not $scope) {
  Write-Error "Could not resolve origin/main to work out what is under review. Run: git fetch origin"
  exit 1
}

$stamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
$line = "| $Version | $Agent | $Verdict | $stamp | $Summary | $Evidence | $scope |"

# ASCII ONLY below this line, deliberately. Windows PowerShell 5.1 reads a
# script file without a BOM as ANSI, so a UTF-8 em dash in this here-string
# arrives as mojibake and gets written into the ledger that way. Found by
# doing exactly that; see ERRORS.md, 2026-10-15.
if (-not (Test-Path $ledger)) {
  $header = @"
# Review ledger

Evidence that the two review gates actually ran, written by
``tools/record-review.ps1`` and read by ``tools/validate.ps1``.

A change that differs from ``origin/main`` and touches reviewable surfaces
cannot pass validation unless the current ``APP_VERSION`` appears below with
the required verdicts. A ``blocked`` verdict fails validation outright - that
is the release block, and the reason this file is machine-read rather than
prose.

Which review a change needs:

| Changed | Needs |
|---|---|
| ``.html``, ``.htm``, ``.xhtml``, ``.xht`` | security **and** ux |
| **everything else** | security |
| ``REVIEWS.md`` | nothing - the one exemption, because this file is
  appended to after the scope is computed |

Default-deny: GitHub Pages publishes the whole branch, and with no
``.nojekyll`` every ``.md`` is rendered into a page on the app's own origin.
The authoritative rule is ``Get-ReviewNeeds`` in ``tools/review-lib.ps1``.

Verdicts: ``pass`` (nothing outstanding), ``notes`` (shippable, findings
recorded), ``blocked`` (Critical/High unresolved - release is stopped).

Newest line for an agent wins, so the normal
blocked -> fixed -> re-reviewed -> pass sequence reads correctly.

**Scope** is a fingerprint of the reviewable files as they stood when the
review was recorded. The gate recomputes it and rejects a verdict whose scope
no longer matches, so a verdict covers the content that was actually read and
nothing else. Editing a row by hand does not help: changing the files changes
the fingerprint.

| Version | Agent | Verdict | When | Summary | Evidence | Scope |
|---|---|---|---|---|---|---|
"@
  Set-Content -Path $ledger -Value $header -Encoding utf8
}

Add-Content -Path $ledger -Value $line -Encoding utf8
Write-Output "Recorded: $Agent / $Verdict for v$Version"
if ($Verdict -eq "blocked") {
  Write-Output "This verdict BLOCKS the release. tools/validate.ps1 will now fail until it is re-reviewed."
}
exit 0
