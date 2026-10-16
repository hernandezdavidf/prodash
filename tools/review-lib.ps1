# Shared review-gate logic, dot-sourced by validate.ps1 and record-review.ps1.
#
# WHY A SHARED FILE: the reviewer records a fingerprint of what it reviewed and
# the gate recomputes that fingerprint to decide whether the verdict still
# applies. If those two rules ever disagreed - about which paths are
# reviewable, or how the hash is built - every verdict would read as stale, or
# worse, a changed file would read as approved. One definition, used twice.
#
# ASCII ONLY. Windows PowerShell 5.1 reads a BOM-less script as ANSI, so a
# UTF-8 dash here becomes mojibake in whatever this writes. See ERRORS.md.

$ReviewRoot = Split-Path -Parent $PSScriptRoot

# Runs git, returns stdout as one string, or $null if it failed. Never throws,
# never lets git's stderr reach the caller - the CRLF warning fires on nearly
# every call in this repo and would otherwise be treated as an error.
# The output encoding is PINNED rather than inherited. PowerShell decodes a
# native command's bytes using the console code page, which on a stock Windows
# console is OEM cp437 - under which an accented path comes back as different
# characters, Test-Path then says the file does not exist, and Get-ReviewScope
# records it as "deleted": a constant, so its contents stop being fingerprinted
# altogether. It also made the same files hash differently on Windows and on
# the Linux CI runner, which would have read as a permanently stale verdict.
function Invoke-Git {
  param([string[]]$GitArgs)
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $prevEnc = [Console]::OutputEncoding
  try {
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
    $out = & git @GitArgs 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    # -join, not Out-String: Out-String appends a trailing CRLF, which after a
    # NUL-delimited split leaves a phantom "`r`n" entry in every change set.
    return ($out -join "`n")
  } catch {
    return $null
  } finally {
    try { [Console]::OutputEncoding = $prevEnc } catch { }
    $ErrorActionPreference = $old
  }
}

# Which gates a set of changed paths requires.
#
# index.html needs both: in a single-file app the interface and the logic are
# the same file, so a change to it is a change to both surfaces until a
# reviewer says otherwise. The rest are judgement calls, each with a reason:
# CLAUDE.md and .claude/ are the agent's own instructions, which is a control
# surface; .gitignore is what keeps secrets and David's data out of a public
# repo; manifest.json carries the PWA's scope and start_url.
function Get-ReviewNeeds([string[]]$paths) {
  # THE ONLY EXEMPTION, and it is structural: reviewing the ledger is
  # circular. record-review.ps1 computes the scope and then appends to this
  # file, which would change the scope it just recorded. Keep this list at one
  # entry - every addition is a hole of the kind described below.
  $exempt = @("REVIEWS.md")
  $needs = @{}
  foreach ($f in $paths) {
    if (-not $f) { continue }
    $p = $f -replace '\\', '/'
    # -ccontains: the case-SENSITIVE form. `-contains` matched `reviews.md`
    # and `Reviews.MD` too, so the one-entry exemption quietly covered three
    # filenames - and a `reviews.md` was pushed green, rendered by Jekyll to
    # a page on the app's own origin, having passed through no classifier, no
    # scope hash and no push check. record-review.ps1 writes the literal
    # "REVIEWS.md", so nothing legitimate depends on the loose match.
    if ($exempt -ccontains $p) { continue }
    # A path we cannot read plainly gets the strict answer, not the lenient
    # one. Get-ChangedVsBase asks git not to quote, so this should not happen
    # - and if it does, an unclassifiable path is exactly the thing a human
    # should look at.
    if ($p.StartsWith('"')) { $needs["security"] = $true; continue }
    if ($p -eq "index.html" -or $p -eq "dayflow.html" -or $p -eq "manifest.json") {
      $needs["security"] = $true; $needs["ux"] = $true
    }
    elseif ($p -eq "sw.js" -or $p -like "cloud-worker/*" -or
            $p -eq ".gitignore" -or $p -eq "CLAUDE.md" -or
            $p -like ".github/*" -or $p -like ".claude/*" -or
            $p -like "tools/*" -or $p -like "workflows/*") {
      $needs["security"] = $true
    }
    # Anything a browser parses as a DOCUMENT needs the UX review as well.
    elseif ($p -like "*.html" -or $p -like "*.htm" -or
            $p -like "*.xhtml" -or $p -like "*.xht") {
      $needs["security"] = $true; $needs["ux"] = $true
    }
    # DEFAULT DENY - everything else still needs the security review.
    #
    # This was twice an allowlist, and twice defeated. First by filename:
    # a new `boards.html` was unknown to the list, so it needed no review.
    # Then by extension, on the premise that markdown is not served - which
    # is FALSE on this site. There is no `.nojekyll`, so Pages builds with
    # Jekyll and renders every `.md` on main into a same-origin HTML page:
    # verified live on 2026-10-16, /CHANGELOG.html returns 200 text/html with
    # generator "Jekyll v3.10.0". An unreviewed `notes.md` is therefore an
    # unreviewed script running on the app's own origin, with its localStorage
    # and its session. `.xhtml` executes too. `CNAME` (moves the domain),
    # `_config.yml` (can delete the app from the published site),
    # `.gitattributes` (changes the normalisation the scope hash is built on)
    # and `.gitmodules` have no extension at all.
    #
    # The question is not "is this one of the kinds we thought of". Pages
    # publishes the whole branch, so the answer is: all of it.
    else { $needs["security"] = $true }
  }
  return $needs
}

# A fingerprint of the reviewable content, so a verdict covers what was
# actually read. Approval used to be keyed to APP_VERSION - which only
# index.html ever changes - so one recorded pass approved every later change
# to tools/, .claude/, sw.js and the Worker, forever. Found by the security
# review of 2026-10-15; see ERRORS.md.
#
# Hashes CONTENT, not the diff: identical for the reviewer and for the gate
# whatever each compares against, and undisturbed by an unrelated edit to a
# non-reviewable file such as CHANGELOG.md.
#
# IT HASHES GIT BLOB IDS, NOT THE BYTES ON DISK, and that is load-bearing
# twice over:
#
#   Line endings. This repo has core.autocrlf=true, the git-for-Windows
#   default, so a checkout rewrites LF to CRLF on disk while git status stays
#   clean. Hashing the file meant all seven reviewable files differed between
#   a Windows worktree and their committed blobs - so a verdict recorded here
#   could NEVER be reproduced by the Linux CI runner, and the one layer that
#   is out of this machine's reach would have been a permanent red light
#   nobody could clear. `git hash-object` applies the same clean filter git
#   does on commit, so it is identical on both.
#
#   What is actually being pushed. With -Ref, the ids come from a commit
#   instead of the worktree, which is how the pre-push gate can check the
#   thing being sent rather than the thing on disk. Without that, a committed
#   backdoor plus an innocent worktree passed.
#
# Both found by the security review of 2026-10-16; see ERRORS.md.
function Get-ReviewScope([string[]]$paths, [string]$Ref = "") {
  $parts = @()
  foreach ($f in ($paths | Sort-Object -Unique)) {
    if (-not $f) { continue }
    $p = $f -replace '\\', '/'
    if (-not (Get-ReviewNeeds @($p)).Count) { continue }
    if ($Ref) {
      $h = Invoke-Git @("rev-parse", ($Ref + ":" + $p))
      $h = if ($null -eq $h) { "absent" } else { $h.Trim() }
    } else {
      # Ask GIT first, and only treat the path as absent when git also finds
      # nothing. Test-Path returns false past ~260 characters on Windows, so
      # leading with it meant a long path was fingerprinted as the constant
      # "absent" - its content never hashed, and a recorded verdict never
      # going stale over it. git has no such limit.
      #
      # -PathType Leaf on the fallback: a DIRECTORY at that path is not a file
      # git can hash, and calling that "unhashable" made it mismatch for ever.
      $h = Invoke-Git @("hash-object", "--", $p)
      if ($null -ne $h) {
        $h = $h.Trim()
      } elseif (Test-Path -LiteralPath $full -PathType Leaf) {
        $h = "unhashable:" + $p     # exists, but git will not hash it
      } else {
        $h = "absent"
      }
    }
    $parts += ($p + "=" + $h)
  }
  if (-not $parts.Count) { return "0" * 12 }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($parts -join "`n"))
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
  return (([BitConverter]::ToString($hash) -replace '-', '').ToLower()).Substring(0, 12)
}

# Everything that differs from the base, INCLUDING files that do not exist
# there yet. `git diff --name-only` lists tracked files only, so without the
# second call a brand-new tools/ or .claude/ file needs no review at all -
# which was true of three files in the change that introduced this gate.
#
# Two flags that are not decoration:
#   core.quotepath=false + -z   git otherwise QUOTES any path containing a
#     non-ASCII byte - `tools/cafe.ps1` with an accent comes back as
#     "tools/caf\303\251.ps1", literal quotes included. The quote broke the
#     `-like "tools/*"` match, so such a file needed no review AND was left
#     out of the scope hash, leaving an existing verdict valid over it.
#   --no-renames                without it, committing a rename changes which
#     paths git reports, so the same bytes hash to two different scopes and a
#     verdict goes stale for content nobody touched. A false alarm is how a
#     gate gets switched off.
function Get-ChangedVsBase([string]$baseRef) {
  $out = @()
  $diff = Invoke-Git @("-c", "core.quotepath=false", "diff", $baseRef, "--name-only", "--no-renames", "-z")
  if ($null -eq $diff) { return $null }
  $out += @($diff -split "`0" | Where-Object { $_ })
  $untracked = Invoke-Git @("-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "-z")
  # Fail closed: a partial list would silently exempt every new file, which is
  # the exact hole the untracked listing was added to close.
  if ($null -eq $untracked) { return $null }
  $out += @($untracked -split "`0" | Where-Object { $_ })
  # The leading comma is not a typo. PowerShell unrolls an empty array on
  # return, so `return @()` yields $null - indistinguishable from the "git
  # failed" signal above. A clean tree therefore reported base-unresolved,
  # blocking three turns after every successful push, on a repo with nothing
  # wrong, with remediation advice that could not help. `return ,@(...)`
  # wraps it so an empty result stays an empty array.
  return ,@($out | Sort-Object -Unique)
}

# The reviewable paths whose content in $Ref differs from the working tree.
# This is what makes the pre-push gate about the PUSH: the hook hands over the
# sha git is actually sending, and anything whose blob there does not match
# the file that was reviewed is reported. Catches both a committed backdoor
# with a restored worktree and `git push origin <sha>:main` from a clean
# checkout - neither of which `git diff HEAD` can see.
function Get-RefMismatches([string]$Ref, [string[]]$paths) {
  $bad = @()
  foreach ($f in ($paths | Sort-Object -Unique)) {
    if (-not $f) { continue }
    $p = $f -replace '\\', '/'
    if (-not (Get-ReviewNeeds @($p)).Count) { continue }
    $inRef = Invoke-Git @("rev-parse", ($Ref + ":" + $p))
    $inRef = if ($null -eq $inRef) { "absent" } else { $inRef.Trim() }
    $full = Join-Path $ReviewRoot $p
    # git first, Test-Path only as the fallback - same reasoning as
    # Get-ReviewScope: Test-Path is blind past ~260 characters, and a
    # directory is not a blob.
    $onDisk = Invoke-Git @("hash-object", "--", $p)
    if ($null -ne $onDisk) {
      $onDisk = $onDisk.Trim()
    } elseif (Test-Path -LiteralPath $full -PathType Leaf) {
      $onDisk = "unhashable"
    } else {
      # "absent", matching the sentinel used for the ref side above. These
      # were "absent" and "deleted" - two names for the same state - so a
      # file deleted in BOTH the commit and the worktree compared unequal and
      # was reported as a mismatch forever. A rename is a delete plus an add
      # under --no-renames, so the rename in this very change made the push
      # permanently unfixable: validate said PASS, the hook refused, and the
      # advice it printed ("commit the reviewed content") was already done.
      # A gate that cannot be satisfied is a gate that gets bypassed.
      $onDisk = "absent"
    }
    if ($inRef -ne $onDisk) { $bad += $p }
  }
  return ,@($bad)
}

# The deployed state is origin/main - GitHub Pages serves that branch - so
# everything differing from it is unreleased, committed or not. Returns "" if
# nothing usable resolves, and the caller must then FAIL rather than proceed:
# a green run that compared against nothing is the worst possible answer.
function Resolve-ReviewBase([string]$preferred) {
  if ($preferred) {
    # Verify it exists. A force-pushed base is unreachable even with full
    # history, and silently diffing against nothing makes a whole push look
    # unchanged.
    if ($null -ne (Invoke-Git @("cat-file", "-e", ($preferred + "^{commit}")))) { return $preferred }
    # And do NOT quietly substitute a narrower one. An earlier version fell
    # back to HEAD~1 here, which was worse than no check: with an unreachable
    # base, `git diff HEAD~1` saw only the last commit, so a backdoor committed
    # earlier in the same push needed no review and CI went green over it.
    # A base we were handed and cannot reach is not a base.
    return ""
  }
  if ($null -ne (Invoke-Git @("rev-parse", "--verify", "--quiet", "origin/main"))) { return "origin/main" }
  return ""
}
