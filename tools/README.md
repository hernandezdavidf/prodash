# tools/

Deterministic execution for ProDash. **PowerShell, not Python** — there is no
Python and no Node on this machine (the `python.exe` on PATH is a Store stub
that fails), so the WAT framework's "Python scripts" layer is PowerShell here.

Check this list before writing a new script; only add one when nothing
existing covers the task.

| Script | What it does |
|---|---|
| `validate.ps1` | The gate. Checks the invariants this codebase has actually broken before, plus the review gates. Exit 1 on any Critical/High. |
| `stop-gate.ps1` | Stop-hook wrapper around `validate.ps1`. Refuses to let a turn end on a failing check, up to 3 times, then stands down loudly. |
| `mark-verified.ps1` | Records that `index.html` / `worker.js` were actually loaded in a browser. Running it without doing that is forging a test result. |
| `record-review.ps1` | Writes a review verdict to `REVIEWS.md`, which `validate.ps1` reads. This is how the two review subagents gate a release. |
| `review-lib.ps1` | Shared gate logic (which paths need which review, the scope fingerprint, base resolution). Dot-sourced by the two above so their rules cannot drift apart. Not run directly. |
| `install-hooks.ps1` | Installs `.git/hooks/pre-push`, which refuses to push when validation fails. Run once per clone — git cannot version its own hooks. |

## Running them

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/validate.ps1
```

`validate.ps1` takes:

- `-Quiet` — exit code only, no report.
- `-CI` — no browser on the machine, so the browser-verification check
  becomes informational rather than blocking.
- `-BaseRef <ref>` — what "the change under review" is measured against.
  Defaults to `origin/main`, i.e. everything not yet deployed.
- `-PrePush` with `-PushSha <sha>` — used by `.git/hooks/pre-push`. Checks
  the commit being pushed rather than the working tree: the hook reads the
  sha from git's stdin, and the gate compares that commit's blobs against the
  files that were reviewed. Without it, `git push origin <sha>:main` bypasses
  everything, because that never touches `HEAD` or the worktree.

**`-CI` and `-BaseRef` are ignored unless `GITHUB_ACTIONS` is set**, and the
run says so. Honoured locally they would be a self-service bypass:
`-BaseRef HEAD` reports clean on committed work that the real base flags.

## Writing a new one

Two rules, both learned the hard way:

1. **ASCII only.** Windows PowerShell 5.1 reads a script file without a BOM as
   ANSI, so a UTF-8 em dash or arrow in a string arrives as mojibake and gets
   written into whatever the script outputs. See `ERRORS.md`, 2026-10-15.
2. **Never `$ErrorActionPreference = "Stop"` around git.** Git writes ordinary
   notices to stderr — the CRLF warning fires on nearly every call in this
   repo — and under `Stop` those become terminating errors. An early version
   of `validate.ps1` wrapped its git checks in `try/catch` and three of them
   silently never ran while the suite reported a clean PASS.
