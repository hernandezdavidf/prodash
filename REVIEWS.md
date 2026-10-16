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
| `.html`, `.htm`, `.xhtml`, `.xht` | security **and** ux |
| **everything else** | security |
| `REVIEWS.md` | nothing - the one exemption |

Default-deny, because GitHub Pages publishes the whole branch and, with no
`.nojekyll`, renders every `.md` into a page on the app's own origin. The
authoritative rule is `Get-ReviewNeeds` in `tools/review-lib.ps1`; this table
mirrors it.

This file is exempt from the review *requirement* only, because
`record-review.ps1` appends to it after the scope is computed. It is not
exempt from scrutiny: the push gate checks that every line here is either
unchanged or a well-formed verdict row.

Verdicts: `pass` (nothing outstanding), `notes` (shippable, findings
recorded), `blocked` (Critical/High unresolved - release is stopped).

Newest line for an agent wins, so the normal
blocked -> fixed -> re-reviewed -> pass sequence reads correctly.

**Scope** is a fingerprint of the reviewable files as they stood when the
review was recorded. The gate recomputes it and rejects a verdict whose scope
no longer matches, so a verdict covers the content that was actually read and
nothing else.

It defeats the realistic failure - reusing an old approval for new work - not
a deliberate forgery: the gate prints the fingerprint it wants, so a row can
be written by hand by anyone who can edit this file. `CLAUDE.md` lists that
and the other known limits under "What this does not do".

| Version | Agent | Verdict | When | Summary | Evidence | Scope |
|---|---|---|---|---|---|---|
| 4.26 | security | pass | 2026-10-16T00:57:31+08:00 | VOID - recorded before any review actually ran; superseded below | not evidence, kept because deleting rows is what this ledger exists to prevent | 03a52b2561bf |
| 4.26 | security | blocked | 2026-10-16T01:05:00+08:00 | Review #1 of the gate implementation: 4 High, 6 Medium | APP_VERSION-keyed approval, commit-first hole, untracked files invisible, -Version forgery, fail-open base, no deploy block | 03a52b2561bf |
| 4.26 | security | notes | 2026-10-16T22:24:25+08:00 | Rounds 1-7 all BLOCKED; every finding addressed and each attack re-run after the fix. SHIPPED ON DAVID'S DECISION with round 8 still running and no review yet clean - he accepted that residual risk explicitly. | Reproduced then re-blocked: refspec push of an evil commit from a clean tree; two-refspec push where only the last was validated; deletion of main hidden behind a second refspec; unreviewed .md rendered same-origin by Jekyll (live check: /CHANGELOG.html 200 text/html Jekyll 3.10.0); submodule gitlink; reviews.md casing exemption. Legitimate release incl. a rename pushes clean. Accepted residuals documented in CLAUDE.md: ledger forgeable, GITHUB_ACTIONS env bypass, --no-verify, Actions runs after Pages and from the pushed commit. Branch protection outstanding - David only. | b823c3b7a0e5 |
| 4.26 | security | notes | 2026-10-17T00:27:24+08:00 | Round 8 findings fixed: ledger exemption no longer disables the push-integrity block; ledger rows grammar-checked in the pushed commit; sanitiser now printable-ASCII so kramdown attribute lists cannot execute; long paths hashed via git not Test-Path. | Fresh lab: payload appended to REVIEWS.md refused (ledger-tampered); gitlink planted at REVIEWS.md refused (submodule-present); IAL payload defanged to inert text; legitimate record-then-push passes and lands. Shipped per David's in-conversation decision to proceed while review 9 is outstanding. | 7753e10a5b3b |
| 4.26 | security | notes | 2026-10-17T00:30:32+08:00 | Round 8 fixes, plus the exemption removed entirely. Nothing is exempt now: the ledger is hashed with its verdict rows stripped, so recording a verdict cannot invalidate itself while any other edit to it makes outstanding verdicts stale. | Proved the row-stripped hash: appending a verdict row leaves the scope at 76f977fb6033, appending prose moves it to 90cce93a58d8. Earlier in a fresh lab: ledger payload and a gitlink at that path both refused, IAL payload defanged, legitimate record-then-push lands. Review 9 outstanding; shipped per David's in-conversation decision. | 76f977fb6033 |
