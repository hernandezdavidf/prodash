# ProDash validation suite.
#
# WHY THIS SHAPE: there is no Node and no Python on this machine (see project
# memory), so there is no test runner to call and no linter to install. What
# there IS, is a codebase with a documented history of specific, repeatable
# failures - every one of them recorded in CHANGELOG.md, and every one of them
# statically detectable. So this checks those, with nothing but PowerShell and
# git, and it runs in under a second.
#
# Each check below exists because the thing it checks for ACTUALLY BROKE once.
# Do not remove one because it looks paranoid; read the comment first.
#
# Exit codes:  0 = nothing blocking   1 = at least one Critical or High
# Medium and Low are reported and do not block, because a gate that cries wolf
# gets switched off, and a switched-off gate catches nothing.

param([switch]$Quiet)

# Deliberately NOT "Stop". git writes ordinary notices to stderr - the CRLF
# warning fires on nearly every call in this repo - and under Stop those become
# terminating errors. The first version of this script wrapped its git checks in
# try/catch{} and three of them silently never ran while the suite reported a
# clean PASS. A validator that quietly skips checks is worse than no validator,
# so: errors continue, every git call is explicit about failure, and a check
# that cannot run says so as a finding instead of vanishing.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$findings = @()

# Runs git, returns its stdout as one string, or $null if it failed. Never
# throws, never lets git's stderr reach the caller.
function Invoke-Git {
  param([string[]]$GitArgs)
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & git @GitArgs 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($out | Out-String)
  } catch {
    return $null
  } finally {
    $ErrorActionPreference = $old
  }
}

function Add-Finding {
  param([string]$Severity, [string]$Check, [string]$Message, [string]$Fix = "")
  $script:findings += [pscustomobject]@{
    Severity = $Severity; Check = $Check; Message = $Message; Fix = $Fix
  }
}

function Read-Repo([string]$rel) {
  $p = Join-Path $root $rel
  if (-not (Test-Path $p)) { return $null }
  return [IO.File]::ReadAllText($p)
}

$index  = Read-Repo "index.html"
$worker = Read-Repo "cloud-worker/worker.js"
$sw     = Read-Repo "sw.js"
$chlog  = Read-Repo "CHANGELOG.md"

# ---------------------------------------------------------------------------
# 1. Worker sheet schema width  (CRITICAL)
# The column-drift bug: COL_COUNT, the F index map and SHEET_HEADERS must agree.
# When they did not, reads and appends kept working while every row UPDATE
# 400'd - which presented as an intermittent database outage and took a day to
# find. worker.js says so itself, above colLetter().
# ---------------------------------------------------------------------------
if ($worker) {
  $m = [regex]::Match($worker, 'const\s+COL_COUNT\s*=\s*(\d+)')
  $h = [regex]::Match($worker, 'const\s+SHEET_HEADERS\s*=\s*\[(.*?)\]', 'Singleline')
  if ($m.Success -and $h.Success) {
    $colCount = [int]$m.Groups[1].Value
    $headers  = ([regex]::Matches($h.Groups[1].Value, '"[^"]+"')).Count
    if ($colCount -ne $headers) {
      Add-Finding "Critical" "worker-schema-width" `
        "COL_COUNT is $colCount but SHEET_HEADERS lists $headers columns." `
        "Bump COL_COUNT, the F index map and SHEET_HEADERS together, and widen the sheet to match."
    }
    # The F map must also carry exactly COL_COUNT entries.
    $f = [regex]::Match($worker, 'const\s+F\s*=\s*\{(.*?)\n\};', 'Singleline')
    if ($f.Success) {
      $fEntries = ([regex]::Matches($f.Groups[1].Value, '(?m)^\s*[A-Za-z][A-Za-z0-9]*\s*:\s*\d+\s*,')).Count
      if ($fEntries -ne $colCount) {
        Add-Finding "Critical" "worker-schema-width" `
          "The F index map has $fEntries fields but COL_COUNT is $colCount." `
          "Every column needs an F entry, a SHEET_HEADERS name and a slot in COL_COUNT."
      }
    }
  } else {
    Add-Finding "High" "worker-schema-width" `
      "Could not find COL_COUNT or SHEET_HEADERS in worker.js to check them against each other."
  }
}

# ---------------------------------------------------------------------------
# 2. App / Worker version lockstep  (HIGH)
# The app declares the minimum Worker it needs. Shipping an app that demands a
# Worker newer than the one in the repo means the controls that depend on it
# fail with "not found" and the banner never explains why.
# ---------------------------------------------------------------------------
function ConvertTo-VerParts([string]$v) { return ($v -split '\.') | ForEach-Object { [int]$_ } }
function Test-VerLess([string]$a, [string]$b) {
  $x = @(ConvertTo-VerParts $a); $y = @(ConvertTo-VerParts $b)
  for ($i = 0; $i -lt [Math]::Max($x.Count, $y.Count); $i++) {
    $p = if ($i -lt $x.Count) { $x[$i] } else { 0 }
    $q = if ($i -lt $y.Count) { $y[$i] } else { 0 }
    if ($p -ne $q) { return ($p -lt $q) }
  }
  return $false
}
if ($index -and $worker) {
  $wmin = [regex]::Match($index,  'var\s+WORKER_MIN\s*=\s*"([0-9.]+)"')
  $wver = [regex]::Match($worker, 'const\s+WORKER_VERSION\s*=\s*"([0-9.]+)"')
  if ($wmin.Success -and $wver.Success) {
    if (Test-VerLess $wver.Groups[1].Value $wmin.Groups[1].Value) {
      Add-Finding "High" "version-lockstep" `
        "index.html needs Worker $($wmin.Groups[1].Value) but worker.js in this repo is $($wver.Groups[1].Value)." `
        "Bump WORKER_VERSION in cloud-worker/worker.js, or lower WORKER_MIN."
    }
  }
}

# ---------------------------------------------------------------------------
# 3. Version bumps on a changed app  (HIGH)
# v4.1 shipped without an APP_VERSION bump, so the live app reported 4.0 for two
# releases and there was no way to tell the builds apart. CACHE_VERSION is the
# same story for the OFFLINE copy, which is the one that matters at 3am.
# Compares the working tree against HEAD: the moment index.html is touched, its
# version must differ from the committed one.
# ---------------------------------------------------------------------------
Push-Location $root
$changedRaw = Invoke-Git @("diff", "HEAD", "--name-only")
if ($null -eq $changedRaw) {
  Add-Finding "Low" "check-skipped" "git diff failed, so the version-bump checks did not run."
} else {
  $changed = @($changedRaw -split "`r?`n" | Where-Object { $_ })
  if ($changed -contains "index.html") {
    $headIndex = Invoke-Git @("show", "HEAD:index.html")
    $now = [regex]::Match($index, 'var\s+APP_VERSION\s*=\s*"([0-9.]+)"')
    $was = if ($headIndex) { [regex]::Match($headIndex, 'var\s+APP_VERSION\s*=\s*"([0-9.]+)"') } else { $null }
    if ($now.Success -and $was -and $was.Success -and $now.Groups[1].Value -eq $was.Groups[1].Value) {
      Add-Finding "High" "version-bump" `
        "index.html has uncommitted changes but APP_VERSION is still $($now.Groups[1].Value)." `
        "Bump APP_VERSION and add a matching line to the top of APP_VERSION_HISTORY."
    }
  }
  if (($changed -contains "index.html") -or ($changed -contains "sw.js")) {
    $headSw = Invoke-Git @("show", "HEAD:sw.js")
    $nowC = [regex]::Match($sw, 'CACHE_VERSION\s*=\s*"([^"]+)"')
    $wasC = if ($headSw) { [regex]::Match($headSw, 'CACHE_VERSION\s*=\s*"([^"]+)"') } else { $null }
    if ($nowC.Success -and $wasC -and $wasC.Success -and $nowC.Groups[1].Value -eq $wasC.Groups[1].Value) {
      Add-Finding "High" "version-bump" `
        "index.html or sw.js changed but CACHE_VERSION is still $($nowC.Groups[1].Value)." `
        "Bump CACHE_VERSION in sw.js so the offline copy is evicted on the next activate."
    }
  }
}
Pop-Location

# ---------------------------------------------------------------------------
# 4. Changelog mirrored into the in-app history  (MEDIUM)
# prodash-maintenance.md requires every dated CHANGELOG entry for a real deploy
# to have a plain-English twin at the top of APP_VERSION_HISTORY, because that
# sub-view is how David finds out what changed.
# ---------------------------------------------------------------------------
if ($index -and $chlog) {
  # Only a REAL DEPLOY entry needs a twin. prodash-maintenance.md is explicit
  # that workflow-doc edits and comment cleanup do not get one, and those
  # entries carry no version marker - so the "(v4.14" in the heading is what
  # distinguishes them. Without this the check fires forever on every
  # tooling-only entry, and a gate that is always amber gets ignored.
  $topEntry = [regex]::Match($chlog, '(?m)^##\s+(\d{4}-\d{2}-\d{2})[^\r\n]*\(v\d')
  $topHist  = [regex]::Match($index, 'APP_VERSION_HISTORY\s*=\s*\[\s*\r?\n\s*\{ts:"(\d{4}-\d{2}-\d{2})')
  if ($topEntry.Success -and $topHist.Success -and
      $topEntry.Groups[1].Value -ne $topHist.Groups[1].Value) {
    Add-Finding "Medium" "changelog-mirror" `
      "Newest CHANGELOG entry is $($topEntry.Groups[1].Value) but the newest APP_VERSION_HISTORY line is $($topHist.Groups[1].Value)." `
      "Add a one-line, jargon-free twin at the top of APP_VERSION_HISTORY."
  }
}

# ---------------------------------------------------------------------------
# 5. Every getElementById target exists  (HIGH)
# The single highest-value check for a one-file app. A typo'd id returns null
# and the failure surfaces far from the cause - usually as a dead button. Ids
# are collected from the whole file, so ids that only exist inside an innerHTML
# template still count.
# ---------------------------------------------------------------------------
if ($index) {
  $ids = @{}
  foreach ($mm in [regex]::Matches($index, 'id="([A-Za-z][-\w]*)"')) { $ids[$mm.Groups[1].Value] = $true }
  $missing = @{}
  $pattern = '(?:document\.getElementById|umEl|pfEl|exEl)\(\s*"([A-Za-z][-\w]*)"\s*\)'
  foreach ($mm in [regex]::Matches($index, $pattern)) {
    $want = $mm.Groups[1].Value
    if (-not $ids.ContainsKey($want)) { $missing[$want] = $true }
  }
  if ($missing.Count) {
    Add-Finding "High" "dangling-element-id" `
      ("Looked up by id but never defined: " + (($missing.Keys | Sort-Object) -join ", ")) `
      "Either the markup is missing the element, or the id is misspelled in one of the two places."
  }
}

# ---------------------------------------------------------------------------
# 6. Sync key classification  (HIGH)
# Every BOARD_KEYS entry must be classified as KEYED, MAPS, SCALARS or ARRAYS,
# or the merge has no rule for it and a two-device edit silently loses one side.
# ---------------------------------------------------------------------------
if ($index) {
  function Get-JsArray([string]$src, [string]$name) {
    # NB: these are declared comma-chained on one line -
    #   var KEYED=[...], MAPS=[...], SCALARS=[...];
    # so anchoring on "var " finds only the first and silently reports every
    # key in the others as unclassified. Match the name, not the keyword.
    $mm = [regex]::Match($src, ('(?:^|[\s,;])' + $name + '\s*=\s*\[(.*?)\]'), 'Singleline')
    if (-not $mm.Success) { return @() }
    return ([regex]::Matches($mm.Groups[1].Value, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
  }
  $boardKeys = @(Get-JsArray $index "BOARD_KEYS")
  $classified = @()
  foreach ($n in @("KEYED", "MAPS", "SCALARS", "ARRAYS")) { $classified += @(Get-JsArray $index $n) }
  if ($boardKeys.Count) {
    $unclassified = $boardKeys | Where-Object { $classified -notcontains $_ }
    if ($unclassified) {
      Add-Finding "High" "sync-key-unclassified" `
        ("In BOARD_KEYS but in no merge class: " + ($unclassified -join ", ")) `
        "Add each to KEYED (arrays of {id}), MAPS (objects), SCALARS (last-write-wins) or ARRAYS (primitive lists)."
    }
    $orphan = $classified | Where-Object { $boardKeys -notcontains $_ } | Sort-Object -Unique
    if ($orphan) {
      Add-Finding "Medium" "sync-key-orphan" `
        ("Classified but not in BOARD_KEYS, so it never syncs: " + ($orphan -join ", "))
    }
  }
}

# ---------------------------------------------------------------------------
# 7. Secrets  (CRITICAL)
# A committed secret stays in git history forever. CLAUDE.md is explicit that
# .gitignore must cover these BEFORE the first commit; this is the standing
# check that nothing slipped past.
# ---------------------------------------------------------------------------
Push-Location $root
$trackedRaw = Invoke-Git @("ls-files")
if ($null -eq $trackedRaw) {
  Add-Finding "Low" "check-skipped" "git ls-files failed, so the tracked-secret check did not run."
} else {
  $tracked = @($trackedRaw -split "`r?`n" | Where-Object { $_ })
  $bad = $tracked | Where-Object {
      $_ -match '(^|/)\.env$' -or $_ -match '(^|/)credentials\.json$' -or
      $_ -match '(^|/)token\.json$' -or $_ -match 'client_secret.*\.json$' -or
      $_ -match 'service-account.*\.json$'
    }
  if ($bad) {
    Add-Finding "Critical" "secret-tracked" `
      ("Tracked by git and must not be: " + ($bad -join ", ")) `
      "Remove from the index, add to .gitignore, and rotate the secret - history is forever."
  }
}
# Also refuse an OAuth client-secret file sitting in the working tree, even
# untracked: auth-setup.md's rule is that it should never be in the folder.
$loose = @(Get-ChildItem -Path $root -Recurse -File -Include "client_secret*.json","*service-account*.json" `
            -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\\.git\\' })
if ($loose) {
  Add-Finding "High" "secret-on-disk" `
    ("Credential file in the project folder: " + (($loose | ForEach-Object { $_.Name }) -join ", ")) `
    "Paste its values into Cloudflare, then delete the file. It should never live here."
}
Pop-Location

# ---------------------------------------------------------------------------
# 8. Structural regression  (HIGH)
#
# THE LIMIT, STATED PLAINLY: there is no JavaScript engine on this machine that
# can parse this code. No Node, no Deno, no Bun. Windows' own JScript host is
# ES3/ES5 and index.html uses const/let and template literals; headless Chrome
# and Edge are installed but produce no output when spawned from here. So this
# suite CANNOT tell you a file parses. Only a browser can, and that is why the
# code-reviewer agent's checklist ends with loading the page.
#
# An earlier version of this check counted braces after stripping strings and
# comments, and compared that against the committed file. It was DELETED after
# a deliberately injected stray "{" failed to move the number: this codebase's
# comments are full of ordinary prose apostrophes ("don't", "Google's"), each
# of which opens a single-quoted string as far as a regex is concerned, and the
# stripper then swallows whole regions - including the injected fault. A check
# that cannot detect a fault you hand it is not a weak check, it is false
# assurance, which is the one thing a validation gate must never produce.
#
# What replaces it is the honest version: the browser IS the parser, and this
# records whether it has been run against the current bytes. tools/mark-verified.ps1
# stamps the file hashes after a real in-browser load; if the file has changed
# since, the check fails and names the step that has to happen.
# ---------------------------------------------------------------------------
$open  = ([regex]::Matches($index, '<script\b')).Count
$close = ([regex]::Matches($index, '</script>')).Count
if ($index -and $open -ne $close) {
  Add-Finding "High" "structure" "index.html has $open <script> tags and $close closing tags."
}

function Get-FileHash256([string]$rel) {
  $p = Join-Path $root $rel
  if (-not (Test-Path $p)) { return $null }
  return (Get-FileHash -Path $p -Algorithm SHA256).Hash
}

$markPath = Join-Path $root ".tmp/verified.json"
$mark = $null
if (Test-Path $markPath) {
  try { $mark = Get-Content $markPath -Raw | ConvertFrom-Json } catch { $mark = $null }
}

foreach ($rel in @("index.html", "cloud-worker/worker.js")) {
  $h = Get-FileHash256 $rel
  if (-not $h) { continue }
  $recorded = if ($mark) { $mark.$rel } else { $null }
  if ($recorded -ne $h) {
    Add-Finding "High" "unverified-in-browser" `
      "$rel has changed since it was last confirmed to parse in a browser." `
      "Load it (the local harness for index.html, a module import for worker.js), confirm no syntax or console errors, then run: pwsh tools/mark-verified.ps1"
  }
}

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
$order = @{ "Critical" = 0; "High" = 1; "Medium" = 2; "Low" = 3 }
# @() around the sort: a single finding comes back as a bare object, whose
# .Count is not the 1 you expect, and the advisory total printed as -1.
$findings = @($findings | Sort-Object { $order[$_.Severity] })
$blocking = @($findings | Where-Object { $_.Severity -eq "Critical" -or $_.Severity -eq "High" })

if (-not $Quiet) {
  if (-not $findings) {
    Write-Output "PASS - all ProDash validation checks clean."
  } else {
    foreach ($f in $findings) {
      Write-Output ("[{0}] {1}: {2}" -f $f.Severity.ToUpper(), $f.Check, $f.Message)
      if ($f.Fix) { Write-Output ("         fix: " + $f.Fix) }
    }
    $b = $blocking.Count
    $n = $findings.Count - $b
    Write-Output ""
    Write-Output ("{0} blocking (Critical/High), {1} advisory (Medium/Low)." -f $b, $n)
  }
}

if ($blocking.Count) { exit 1 }
exit 0
