# Review ledger

Evidence that the two review gates actually ran, written by
`tools/record-review.ps1` and read by `tools/validate.ps1`.

A change that differs from `origin/main` and touches reviewable surfaces
cannot pass validation unless the current `APP_VERSION` appears below with
the required verdicts. A `blocked` verdict fails validation outright - that
is the release block, and the reason this file is machine-read rather than
prose.

Which review a change needs:

| Changed | Needs |
|---|---|
| `index.html`, `dayflow.html`, `manifest.json` | security **and** ux |
| `sw.js`, `cloud-worker/` | security |
| `tools/`, `.claude/`, `.github/`, `workflows/` | security |
| `.gitignore`, `CLAUDE.md` | security |

The authoritative list is `Get-ReviewNeeds` in `tools/review-lib.ps1`; this
table mirrors it.

Verdicts: `pass` (nothing outstanding), `notes` (shippable, findings
recorded), `blocked` (Critical/High unresolved - release is stopped).

Newest line for an agent wins, so the normal
blocked -> fixed -> re-reviewed -> pass sequence reads correctly.

**Scope** is a fingerprint of the reviewable files as they stood when the
review was recorded. The gate recomputes it and rejects a verdict whose scope
no longer matches, so a verdict covers the content that was actually read and
nothing else.

It defeats the realistic failure — reusing an old approval for new work — not
a deliberate forgery: the gate prints the fingerprint it wants, so a row can
be written by hand by anyone who can edit this file. `CLAUDE.md` lists that
and the other known limits under "What this does not do".

| Version | Agent | Verdict | When | Summary | Evidence | Scope |
|---|---|---|---|---|---|---|
| 4.26 | security | pass | 2026-10-16T00:57:31+08:00 | VOID - recorded before any review actually ran; superseded below | not evidence, kept because deleting rows is what this ledger exists to prevent | 03a52b2561bf |
| 4.26 | security | blocked | 2026-10-16T01:05:00+08:00 | Review #1 of the gate implementation: 4 High, 6 Medium | APP_VERSION-keyed approval, commit-first hole, untracked files invisible, -Version forgery, fail-open base, no deploy block | 03a52b2561bf |
| 4.26 | security | notes | 2026-10-16T22:24:25+08:00 | Rounds 1-7 all BLOCKED; every finding addressed and each attack re-run after the fix. SHIPPED ON DAVID'S DECISION with round 8 still running and no review yet clean - he accepted that residual risk explicitly. | Reproduced then re-blocked: refspec push of an evil commit from a clean tree; two-refspec push where only the last was validated; deletion of main hidden behind a second refspec; unreviewed .md rendered same-origin by Jekyll (live check: /CHANGELOG.html 200 text/html Jekyll 3.10.0); submodule gitlink; reviews.md casing exemption. Legitimate release incl. a rename pushes clean. Accepted residuals documented in CLAUDE.md: ledger forgeable, GITHUB_ACTIONS env bypass, --no-verify, Actions runs after Pages and from the pushed commit. Branch protection outstanding - David only. | b823c3b7a0e5 |
