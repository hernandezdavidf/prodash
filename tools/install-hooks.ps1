# Install the git hooks that make the gates deterministic locally.
#
# WHY: the Stop hook stands down after three blocks so a session can never
# deadlock, which means a `blocked` verdict is a speed bump rather than a
# stop. GitHub Pages serves whatever reaches origin/main, so the last moment
# anything can be prevented is `git push`. This puts the validator there.
#
# .git/hooks/ is not part of the repository - git cannot version it - so this
# has to be run once per clone:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-hooks.ps1
#
# The hook is a genuine stop, not an advisory one. The escape hatch is git's
# own --no-verify, which is deliberate and visible in the shell history rather
# than something an agent can do silently in a script.
#
# ASCII ONLY - see ERRORS.md 2026-10-15.

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$hooksDir = Join-Path $root ".git\hooks"

if (-not (Test-Path $hooksDir)) {
  Write-Error "No .git/hooks directory at $hooksDir - is this a git clone?"
  exit 1
}

$prePush = Join-Path $hooksDir "pre-push"

# Never silently destroy someone else's hook. A pre-push that already exists
# may be doing something this knows nothing about.
if (Test-Path $prePush) {
  $existing = [IO.File]::ReadAllText($prePush)
  if ($existing -notmatch "ProDash pre-push gate") {
    $backup = "$prePush.backup-" + (Get-Date).ToString("yyyyMMddHHmmss")
    Copy-Item $prePush $backup
    Write-Output "An unrelated pre-push hook was already installed; backed it up to $backup"
  }
}
$body = @'
#!/bin/sh
# ProDash pre-push gate. Installed by tools/install-hooks.ps1.
#
# Pushing to main IS deploying - GitHub Pages serves that branch - so this is
# the last point at which a failing check can stop anything. Bypass with
# --no-verify only when you have a reason you would say out loud.
# Git feeds the hook "<local ref> <local sha> <remote ref> <remote sha>" on
# stdin, one line per ref. That is the ONLY place the thing actually being
# pushed is named: the refspec can send any commit, not just HEAD, so a gate
# that reads the worktree or HEAD is checking something else entirely.
# COLLECT EVERY deploying ref, and validate all of them.
#
# A single $SHA variable was safe while one ref matched. The moment gh-pages
# was added, the last matching line overwrote the first - so
#   git push origin <evil>:refs/heads/main <good>:refs/heads/gh-pages
# validated only gh-pages and landed <evil> on main with a pass. The same
# trick defeated the deletion refusal, because $SHA was no longer all-zeros
# by the end of the loop. Git sends one line per refspec; all of them count.
#
# `|| [ -n "$lref" ]` so a final line without a trailing newline is still
# read: git always terminates its lines, but an unread line would leave the
# list empty, and empty means "skip validation".
SHAS=""
while read lref lsha rref rsha || [ -n "$lref" ]; do
  # gh-pages as well as main: it is the other branch the Pages UI offers, so
  # it becomes a deploy route the moment that setting is touched.
  case "$rref" in
    refs/heads/main|refs/heads/gh-pages)
      if [ "$lsha" = "0000000000000000000000000000000000000000" ]; then
        echo "ProDash: this push DELETES $rref, a branch Pages can serve."
        echo "Validation cannot apply to a deletion. Use --no-verify if you truly mean it."
        exit 1
      fi
      SHAS="$SHAS $lsha" ;;
  esac
done
if [ -z "$SHAS" ]; then
  echo "ProDash: nothing targeting a deploying branch in this push; skipping validation."
  exit 0
fi

for SHA in $SHAS; do
  echo "ProDash: validating $SHA before push..."
  powershell -NoProfile -ExecutionPolicy Bypass -File "tools/validate.ps1" -PrePush -PushSha "$SHA"
  if [ $? -ne 0 ]; then
    echo ""
    echo "PUSH BLOCKED: ProDash validation failed for $SHA (see above)."
    echo "Pushing to a deploying branch IS deploying, so this is the last stop."
    echo "Fix the findings, or push with --no-verify if you have a reason."
    exit 1
  fi
done
exit 0
'@

# LF endings and no BOM: this is executed by git's shell, and sh chokes on
# both CRLF and a BOM with errors that do not mention either.
$body = $body -replace "`r`n", "`n"
[IO.File]::WriteAllText($prePush, $body, (New-Object Text.UTF8Encoding $false))

Write-Output "Installed .git/hooks/pre-push"
Write-Output "It runs tools/validate.ps1 and refuses the push on any Critical or High."
exit 0
