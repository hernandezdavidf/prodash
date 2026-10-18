# Error and learning record

Failures worth remembering, and what was done about them. Newest on top.

This is the "consult before touching" file named in
[`workflows/error-recovery.md`](workflows/error-recovery.md). It is not a
changelog — `CHANGELOG.md` records what shipped. This records **what went
wrong, why, and what now prevents it**, so the same hour is not spent twice.

**Add an entry when** a failure could plausibly recur: a wrong assumption
about the platform, a check that did not exist, a fix that looked right and
was not. **Do not add** one-off typos caught immediately.

Each entry carries the same fields:

- **Component** — what broke
- **Symptom** — what was observed
- **Root cause** — why, at the level that explains the symptom completely
- **Tried and failed** — dead ends, so nobody re-walks them
- **Fix** — what changed, and where
- **Verification** — the evidence it is actually fixed
- **Prevention** — the check, test or rule that catches it next time
- **Residual risk** — what is still not covered

---

## 2026-10-17 — Harness: two reviewers share one browser tab and steal it

- **Component:** the browser pane, when `security-reviewer` and `ux-reviewer`
  run at the same time.
- **Symptom:** mid-review, a reviewer's in-page probe returns measurements for
  a page it never navigated to. The UX pass had probes cut off twice when the
  security pass navigated the pane to its own port.
- **Root cause:** the Browser pane exposes a **single tab**. Two agents driving
  it concurrently are driving the same tab; whoever navigates last wins, and
  neither is told.
- **Fix:** assert the origin at the top of every in-page probe, e.g. begin the
  script with a `location.port` check and abort if it is not the expected
  harness port. Re-run anything that aborted.
- **Verification:** the UX pass guarded every probe after the first collision
  and redid the affected measurements; served length identical at 777,437
  bytes before and after.
- **Prevention:** written here. Prefer running the two gates **sequentially**;
  if they must overlap, give each its own port and assert it.
- **Residual risk:** an assertion only detects the theft, it does not prevent
  it. The listener also died once mid-review (exit 255) and needed restarting.

## 2026-10-16 — Harness: pushing to a bare repo in the scratchpad fails

- **Component:** throwaway-clone testing (every reviewer will hit this).
- **Symptom:** `git push` to a bare repo created under the agent scratchpad
  fails with `cannot write keep file ... Filename too long` /
  `remote unpack failed`.
- **Root cause:** the scratchpad prefix is ~180 characters and git's
  incoming-pack temp filename overruns Windows MAX_PATH.
- **Fix:** `git config core.longpaths true` in **both** the bare repo and the
  clone, before the first push.
- **Prevention:** written here, because the first two reviewers each lost time
  to it independently.

## 2026-10-16 — Seven rounds of "fixed" that were not fixed

*Supersedes the "three rounds" entry; the pattern continued and got worse
before it got better.*

- **Component:** the release gates themselves (`tools/validate.ps1`,
  `tools/review-lib.ps1`, `tools/install-hooks.ps1`,
  `.github/workflows/validate.yml`).
- **Symptom:** seven independent reviews, seven BLOCKED verdicts. Rounds 3
  through 7 each found that the *previous round's fix* was wrong, and twice
  the new fix opened the hole it was meant to close.
- **Root causes, and the pattern is the lesson:**
  - **Relocated, not fixed.** The unreachable-base fallback was removed from
    `Resolve-ReviewBase` and re-added in the workflow. The worktree-vs-HEAD
    check was replaced by a worktree-vs-HEAD check with a new name. Moving
    code is not changing behaviour.
  - **Correct but unreachable.** `Get-RefMismatches` was right and sat behind
    a path list built from the worktree, so a clean tree skipped it entirely
    and `git push origin <sha>:main` landed anything with a pass.
  - **Allowlists, twice.** First filenames, then extensions — both defeated
    by a file nobody had thought of. The premise behind the second ("markdown
    is not served") was false: this site has no `.nojekyll`, so Pages renders
    every `.md` into a same-origin HTML page. Only default-deny held.
  - **A fix that created the next hole.** Adding `gh-pages` to the hook let a
    second refspec overwrite the single `$SHA`, so one extra argument skipped
    validation of the branch being deployed.
  - **Two names for one state.** `"absent"` vs `"deleted"` meant a renamed or
    deleted file mismatched forever — this change was literally unpushable
    until round 7 found it, because `validate.ps1` said PASS while the hook
    refused with advice that was already satisfied.
- **Tried and failed:** self-testing. Every round the author's own checks
  passed. Every round an independent reviewer found Highs by *attacking* the
  gate rather than exercising it.
- **Fix:** all findings from rounds 1-7 addressed; see `CHANGELOG.md` and the
  `REVIEWS.md` trail.
- **Verification:** each attack was reproduced before the fix and re-run
  after, in throwaway clones with their own bare remotes.
- **Prevention, in order of how much it actually helps:**
  1. **Default-deny beats enumeration.** Two allowlists fell; the inverted
     rule did not.
  2. **A check must be proven reachable, not just correct.** Run the attack,
     see it blocked, then re-run it with the check disabled to confirm the
     test was testing anything.
  3. **Always test the legitimate path too.** A gate that blocks real work
     gets switched off, and a rename nearly did exactly that.
  4. **A reviewer must try to defeat the control.** Both briefs say so.
- **Residual risk:** no review has returned clean. Round 8 was still running
  when David chose to ship, accepting that. Nothing here survives a
  determined forger with write access; branch protection remains his to
  enable.

## 2026-10-16 — Three rounds of "fixed" that were not fixed

- **Component:** the release gates themselves (`tools/validate.ps1`,
  `tools/review-lib.ps1`, `.github/workflows/validate.yml`).
- **Symptom:** the gate was written, tested by its author, and reviewed. It
  was BLOCKED three times running. Each round the author believed the
  previous round's findings were resolved.
- **Root cause:** several, and the pattern matters more than any one of them.
  - **A fix that moved rather than fixed.** The unreachable-base fallback to
    `HEAD~1` was removed from `Resolve-ReviewBase` and re-added, with the
    same effect, in the workflow. It took round 3 to notice the behaviour was
    identical and the bug therefore still present.
  - **Approval bound to the wrong thing.** Verdicts were keyed to
    `APP_VERSION`, which only `index.html` ever changes — so one recorded
    pass approved every future change to `tools/`, `.claude/`, `sw.js` and
    the Worker. Now keyed to a hash of the reviewed content.
  - **The same parsing mistake in several places.** Git quotes non-ASCII
    paths; three separate call sites were affected, including the Critical
    tracked-secret scan. Fixing the first two did not fix the third.
  - **Case sensitivity on one side only.** `ValidateSet` accepted `Blocked`,
    the reader matched only `blocked`, so a release block could be recorded,
    acknowledged, and silently lost.
- **Tried and failed:** self-testing by the author. Every round the author's
  own tests passed; every round an independent review found Highs by
  *attacking* the gate instead of exercising it.
- **Fix:** all findings from rounds 1–3 addressed; see `CHANGELOG.md` for the
  list and `REVIEWS.md` for the verdict trail.
- **Verification:** each fix was reproduced as a failing scenario first, then
  re-run after the change. The gate blocked its own release three times,
  which is the only reason any of this was found.
- **Prevention:** the gates now fail closed on an unresolvable base, bind
  verdicts to content, read the ledger case-insensitively, and refuse a push
  while reviewable files are dirty. More durably: **a reviewer must try to
  defeat the control, not confirm it works.** Both agent briefs say so.
- **Residual risk:** none of it survives a determined forger with write
  access to the repo — documented in CLAUDE.md under "What this does not do".
  Branch protection needs David.

## 2026-10-15 — PowerShell wrote mojibake into the file it had just created

- **Component:** `tools/record-review.ps1`, first run.
- **Symptom:** the generated `REVIEWS.md` header contained `â€”` and `Â·`
  where an em dash and a middle dot belonged.
- **Root cause:** Windows PowerShell 5.1 reads a script file **without a BOM**
  as ANSI (Windows-1252). The script was written as UTF-8, so its em dash
  arrived in the interpreter already mangled, and `Set-Content -Encoding utf8`
  then faithfully wrote the mangled characters out. The output encoding was
  never the problem; the *input* encoding was.
- **Tried and failed:** nothing — caught on the first run by reading the file
  back rather than trusting that it had been written correctly.
- **Fix:** `tools/record-review.ps1` is ASCII-only, with a comment saying why,
  and the mangled ledger was deleted and regenerated.
- **Verification:** `grep` for non-ASCII in `tools/*.ps1` returns zero, and
  the regenerated `REVIEWS.md` reads correctly through a UTF-8 reader.
- **Prevention:** rule written into `tools/README.md` under "Writing a new
  one". Any new PowerShell script in this repo stays ASCII, or carries a BOM.
- **Residual risk:** nothing enforces it automatically. A one-line check could
  be added to `validate.ps1` if it ever happens a second time.

## 2026-10-06 — "Offline" meant "the chapters you already opened"

- **Component:** Bible widget (`bb*` in `index.html`), service worker.
- **Symptom:** David asked twice for the Bible to work offline. It was
  described as offline-capable because chapters were cached in
  `localStorage` after being read — so on a plane, any chapter he had not
  already opened simply failed.
- **Root cause:** a caching strategy was mistaken for an offline strategy.
  A cache that only fills on demand cannot answer a request that was never
  made, and the architecture had no way to fill it legitimately:
  bulk-fetching 1,189 chapters from bolls.life is exactly what their terms
  forbid.
- **Tried and failed:** nothing was retried in code — the earlier framing
  ("offline for chapters you've read") was the error. Pre-warming the cache
  from the API was considered and rejected as the forbidden bulk download in
  slow motion.
- **Fix:** bundled the public-domain KJV (`bible/kjv.json`, 4.25 MB) and read
  chapters and search from it. NKJV stays on the API because it is
  copyrighted, and now says so instead of failing. v4.26.
- **Verification:** `fetch` to every non-local origin rejected and
  `navigator.onLine` forced false; Habakkuk 2 — never opened before —
  rendered from the bundle with **zero** network calls; search returned 40
  hits in 10 ms.
- **Prevention:** the dataset is verified against canonical landmarks (66
  books, 31,102 verses, Psalm 119 = 176) before being trusted; the rule now
  lives in project memory and `bible/README.md`.
- **Residual risk:** the first run still needs one online load to populate
  the service-worker cache. Not verifiable from this machine — the SW
  registers only for a signed-in session, so it needs confirming on David's
  phone.

## 2026-10-06 — A 4 MB asset in the app-shell cache would re-download on every release

- **Component:** `sw.js`.
- **Symptom:** caught in design, before shipping: the obvious place for
  `bible/kjv.json` was `STATIC_ASSETS`.
- **Root cause:** `activate` deletes every cache whose name is not the
  current `CACHE_VERSION`, and `CACHE_VERSION` is bumped on essentially every
  release. Anything in that cache is therefore re-downloaded on every update
  — 4 MB, on a phone, possibly on mobile data.
- **Fix:** its own cache, `prodash-bible-kjv-v1`, explicitly spared by the
  `activate` filter; its `cache.add` is a separate `waitUntil` so a failed
  4 MB fetch cannot fail the whole SW install.
- **Verification:** live `sw.js` serves both names; the activate filter
  excludes both.
- **Prevention:** written into `bible/README.md` and project memory as a
  "must not be undone" note, because the next person to tidy `sw.js` will see
  two caches and want one.
- **Residual risk:** none known. If the file ever changes, the cache name has
  to be bumped by hand.

## 2026-09-24 — Two features David could not find, both hidden in a `<select>`

- **Component:** Exercise Library (`renderExLib`, `exProgInstall`).
- **Symptom:** the ready-made workout programs shipped in a dropdown labelled
  "Add a ready-made program…". David reported them missing **twice**, the
  second time with a screenshot in which the dropdown was plainly visible.
- **Root cause:** a dropdown reads as a filter over what is already on screen,
  not as a shelf holding things you do not have yet. An offer nobody opens is
  an offer that does not exist.
- **Tried and failed:** explaining where the control was. It worked as
  documentation and failed as design — the second report came after the
  explanation.
- **Fix:** a visible "Ready-made programs" card listing each program, what is
  in it and an **Add** button. v4.22.
- **Verification:** installed both phases from the new card in the harness,
  schedules chained correctly, rows flipped to "in your library".
- **Prevention:** rule recorded in project memory
  (`prodash-offers-must-be-visible`) and in the `ux-reviewer` brief: anything
  being *offered* must be visible without opening a control. A picker over
  the user's own content may be a dropdown; an offer may not.
- **Residual risk:** the same mistake is possible anywhere a `<select>` is
  used. No automated check — this needs the UX review.

## 2026-09-07 — Reported a release as done while David still saw the old version

- **Component:** release process.
- **Symptom:** v4.2 was finished, committed, browser-tested and reported
  complete. David replied that he was still on 4.0.
- **Root cause:** two separate failures. The commit was never pushed, and
  GitHub Pages serves `origin/main` — so a local commit changes nothing he can
  see. Separately, v4.1 had shipped without an `APP_VERSION` bump, so the live
  number had been stale for two releases and there was no way to tell the
  builds apart.
- **Fix:** the four-step release rule in
  `workflows/prodash-maintenance.md` — bump `APP_VERSION`, bump
  `CACHE_VERSION`, push, then poll the live URL.
- **Verification:** every release since ends with the live `APP_VERSION`
  polled and quoted.
- **Prevention:** `tools/validate.ps1` check 3 fails when `index.html` or
  `sw.js` differ from HEAD without a version bump. The live-URL poll is still
  a human step — a validator cannot see Pages.
- **Residual risk:** the version-bump check compares against `HEAD`, so it
  goes quiet once work is committed. The review-evidence checks added
  2026-10-15 compare against `origin/main` instead, which does not have that
  hole.

## 2026-09-16 — The test harness cannot be trusted to look like production

- **Component:** local PowerShell `HttpListener` test harness.
- **Symptom:** service workers never register under it ("An unknown error
  occurred when fetching the script"), and pointing it at the real Worker
  wipes the faked session.
- **Root cause:** both are harness properties, not app bugs. The SW failure
  is the listener's origin handling; the session wipe is correct behaviour —
  `/auth/me` 401s a forged token and the boot path treats 401 as a dead
  session.
- **Tried and failed:** debugging the service-worker registration as if it
  were an app defect. Hours, no defect.
- **Fix:** none needed in the app. Point `prodash.serverUrl` at an unreachable
  port so the boot path treats the server as offline and leaves the fake
  session alone.
- **Prevention:** recorded in project memory
  (`prodash-browser-test-harness`). Service-worker behaviour is verified on
  the live origin, never in the harness.
- **Residual risk:** anything that only manifests with a live service worker
  cannot be tested before deploy.
