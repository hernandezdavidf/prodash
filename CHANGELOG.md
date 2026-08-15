# Changelog

All notable changes to this project are logged here, newest entry on top.

## 2026-08-15 — Accounts: log-in gate, Google Sheets user registry, per-user boards

ProDash now authenticates before it opens. Each person gets an independent
board, reachable from any device by logging in. The account registry is a
Google Sheet; the boards stay in Cloudflare KV, one key per `board_id`.

**The Worker had to become the auth server, and that is not incidental.**
`dayflow.html` is a public static file, so any Google credential placed in it
is readable by view-source — which would publish every password hash and secret
answer in the sheet. Worse, requirement "user A cannot reach user B's board" is
unenforceable if the browser is the only thing deciding which board to load. So
the browser now holds no Google credential and no board id it can usefully
change: it sends a signed session token, and the Worker reads the `board_id`
out of that token's verified payload. Editing localStorage, the URL, or the
request body reaches nothing.

**Sheet layout** — one `Users` tab, columns A..S, addressed positionally by the
Worker (`user_id`, names, `username`, `username_key`, email pair,
`password_hash`, `secret_question`, `secret_answer_hash`, `role`, `status`,
`failed_attempts`, `locked_until`, `board_id`, and three timestamps plus
`session_epoch`). `username_key` is the uniqueness key — lowercased and
space-stripped, so "David", "david" and " david " are one account, and both
signup and login normalise through the same function so they cannot drift.

**Passwords** — PBKDF2-HMAC-SHA256 with a per-user salt and a Worker-side
pepper, stored self-describing as `pbkdf2-sha256$<iters>$<salt>$<hash>`.
Verification reads the parameters out of the stored value rather than assuming
today's settings, and login transparently re-hashes anything weaker than the
current target. That is what makes raising the cost — or swapping the algorithm
entirely — a config change instead of a forced reset for every user. Iteration
count is deliberately 100k by default: Cloudflare's free plan allows ~10ms CPU
per request and PBKDF2 is meant to be slow, so this is the setting most likely
to need tuning, and it is an env var for exactly that reason. argon2/scrypt
would need a WASM bundle, which the paste-into-Quick-Edit deployment this
project relies on cannot carry.

**Sessions** — HMAC-signed, 30-day, stateless. The signature alone proves the
token is ours, so the common path costs no Sheets read. Two cheap KV reads
cover what a signature cannot express: this device signed out (`rev:<sid>`) and
the password changed (`epoch:<uid>`). A password reset bumps the epoch, which
signs every open tab out everywhere — the point of a reset.

**Offline is a first-class case, not an oversight.** ProDash is a daily driver
at 3am. A stored, unexpired session opens the board immediately and revalidates
with the Worker in the background; a *network* failure is explicitly not
treated as a rejection, only a real 401/403 is. Dropping someone at a login
screen because their connection died would be a worse failure than the one it
guards against.

**Lockout** — three consecutive failures locks for 15 minutes, counted in the
sheet, cleared on success. An expired lock resets the counter, so it is three
*consecutive* failures rather than three since the account was made. Wrong
secret answers feed the same counter, so recovery is not a lockout-free side
door into guessing. Telling the user they are locked does confirm the account
exists; that is an accepted trade, since a silent lockout is worse for a real
user than the enumeration it prevents.

**Forgot password** requires the username *and* the registered email to match
before it will show the secret question — without that second factor this is a
free directory of which usernames exist and what guards them. Verification
returns a 10-minute signed ticket bound to the current `session_epoch`, so one
verified answer cannot be replayed into a second reset later.

**Formula injection, worth calling out** — a value beginning `=`, `+`, `-` or
`@` is executed as a formula by Sheets and by Excel if the sheet is downloaded.
`valueInputOption=RAW` does not prevent this. Since the registry is read by the
operator, a registration with the first name `=IMPORTXML(...)` would run against
*them*. Every cell written is prefixed with an apostrophe when it starts with
one of those characters.

**Client changes** — a gate that runs before the board script, which now
early-returns unless a session exists. Bailing out rather than rendering-and-
hiding is what makes sign-out real: no board is read from storage, no interval
starts, nothing reaches the DOM. localStorage is namespaced per user id, so two
people on one browser get genuinely separate caches. The header carries a
permanent identity chip, because "whose board is this?" has to be answerable at
a glance on a shared machine.

**Migration** — the old single-user blob under KV key `state` is inherited by
the first account created while `LEGACY_CLAIM=1`; the browser independently
carries its old `dayflow.v2` cache into the first account that signs in there.
Between the two the board arrives from whichever side had it. The shared
`SYNC_PASSWORD` is no longer read at all, and any stale copy in localStorage is
deleted on sight rather than left lying around.

**Admin is a seam, not a feature.** A `role` column, a `requireRole` check and
an `/admin/*` route exist so the real admin system can be added without
rearranging any of this. Everything behind it returns 501. The one-time
`/admin/bootstrap` endpoint creates the placeholder account and is meant to be
deleted immediately after use.

Setup: [`workflows/auth-setup.md`](workflows/auth-setup.md).
[`workflows/cloud-sync-setup.md`](workflows/cloud-sync-setup.md) is now partly
superseded (its steps 1–3 still apply, step 4 does not) and carries a banner
saying so.

## 2026-08-15 — Board History: added a plain-English "PRODASH Version History" tab

A fifth sub-tab under Board History (**PRODASH Version History**), separate
from the existing four (Update history / Local ↔ Cloud / Devices / Restore).
Those four are the *board's* audit trail — every task/lane/ritual edit,
which device, sync status. This new one is the *app's* own changelog,
surfaced in-app instead of requiring someone to open `CHANGELOG.md`: plain-
English, one line per real update, with the date/time it actually shipped
(the commit timestamp, not the write-up timestamp) and a short non-technical
summary of what changed.

**Read-only by design.** Backed by a new `APP_VERSION_HISTORY` array in
`dayflow.html`, hand-written rather than parsed from `CHANGELOG.md` at
runtime — the changelog is deliberately technical/verbose for maintainers,
this needed to stay short and jargon-free for a daily user, and this file
has no build step to transform one into the other. Deliberately kept
outside `S`/`BOARD_KEYS`: it never syncs, never conflicts, and survives
Reset/Restore/Import untouched, since it describes the app, not the board.

**"Automatically updated" means part of the deploy process, not a live
feed** — there's no backend and no build pipeline here (`file://` also
still has to work, which rules out `fetch()`-ing `CHANGELOG.md` at runtime;
Chrome blocks that under `file://` and it's a real usage mode for this app),
so the array is hand-maintained. Going forward, whenever a `CHANGELOG.md`
entry is added for a real deploy, a matching one-line entry gets added to
`APP_VERSION_HISTORY` in the same change — documented as a code comment
right above the array so this doesn't get forgotten later. Backfilled all
16 prior entries using the actual commit timestamps that shipped them
(`git log --date=iso -- CHANGELOG.md`), not today's date, so the tab is
accurate from first use.

## 2026-08-15 — Removed Shutdown ritual; deletable timeline placeholders; all appointments notify

**Shutdown ritual removed** — the "next shift's top 3 / what moved this
shift" card, no longer used. Removed the card, its CSS, `meta()`, and its
wiring. Left `S.days` and its sync/history support (`MAPS`, `opText`'s
"days" branch) alone rather than ripping them out — they're harmless once
nothing writes to them, and touching sync internals for a UI-only removal
wasn't worth the risk. `Reset this shift`'s confirm text and behavior no
longer references notes, since there's nothing left to clear there.

**Shift timeline: routine blocks are now deletable.** Every fixed slot
(Sleep, Wake + prep, School drop-off, etc.) gets a `×` like appointments
already had — click it, confirm, and it's removed from every day it would
appear, not just today. Needed each `BLOCKS` entry to get a stable `id` for
the first time (previously unreferenced), tracked in a new `S.hiddenBlocks`
array that `dayBlocks()` filters against. Wired into the sync/diff/history
machinery as a new small category (`ARRAYS`) alongside the existing
`KEYED`/`MAPS`/`SCALARS` — a flat list of ids, compared by content rather
than reference (a cloned snapshot never shares object identity with the
live array even when nothing in it changed, which would have falsely
flagged a "change" on every single revision otherwise). No restore UI yet,
matching how lane/ritual removal already works — same "no undo, don't
delete if unsure" tradeoff, not a new one.

**Notifications now include every upcoming appointment**, not just
must-attend ones — previously must-attend was the only kind that generated
a heads-up. Regular appointments get a calm light-green accent (distinct
from the default "you're behind on something" orange); must-attend escalates
further into a rose accent reserved for genuine priority, reusing a hue
from the custom-lane swatch palette that isn't otherwise fixed to any
meaning in the UI.

## 2026-08-15 — Cloud sync: pull on boot, stop re-asking for a stored password

Found while actually connecting three real devices (phone, a test browser,
and the local file) to the same Worker for the first time this session.

**A plain page load/refresh never pulled fresh cloud data on its own** — only
focus, tab-visibility-change, or the 2-minute poll did. A returning device
with credentials already stored just sat on "tap to sync" until one of those
fired, so "why isn't the other device's change showing up" after simply
reopening the tab was the expected, if confusing, default. Now pulls once
automatically on boot when a URL/password are already saved — the same
"reconnect on load" step the OneDrive path already had via `restore()`.

**Worse, clicking "tap to sync" didn't just try again — it re-asked for
*both* the URL and the password, with the password field blank every time,
never pre-filled.** Any state other than "synced" fell through to the same
full `connectCloud()` prompt, including a device that was correctly
configured moments earlier and just hadn't confirmed it yet this session.
That's a real place to introduce a typo for no reason. The click handler now
tries the already-stored credentials first via a plain `cloudPull()`; only
"off" (nothing ever set up) or a genuine "error" state still prompts for
input.

## 2026-08-15 — Closed three sync-merge gaps in Board History, added 7-day retention

Board History's `adopt()` fix (below) only closed one door — three more of
the same shape were found and closed the same way:

**Import backup used to bypass the merge entirely.** `S=norm(d)` replaced
the whole state on import, same landmine as the original `adopt()` bug,
different trigger — restoring any backup (especially a pre-Board-History
one) silently wiped this device's own history. New `applyImport()` keeps
board replacement (that's the correct, deliberate behavior for an explicit
restore) but merges `hist`/`devices` in via the same union `adopt()` uses,
and records the import itself as a revision (`rev.importedFrom`) so it shows
up in the log with context instead of as unexplained task diffs.

**`cloudPush()` used to blindly overwrite the Worker's stored copy** — PUT
with no prior GET, so two devices pushing close together could have one's
revisions server-side-overwritten by the other (usually self-heals on the
next pull, not if the losing device never reconnects). Now pulls first,
runs the result through the same `adopt()` merge, then pushes the union —
the Worker's copy can no longer lose an entry mid-race.

**Six `localStorage.setItem` call sites silently swallowed write
failures.** Centralized into `persistLocal()`: one recovery attempt (force-
expire history, retry) before surfacing a visible, dismiss-free warning —
previously a failed save looked identical to a successful one until the tab
closed.

**7-day rolling retention**, alongside the existing 400-entry cap
(whichever's stricter for a given entry). Past that, a revision's ops/
snapshot are deleted and replaced with a small permanent tombstone — id,
timestamp, device, and a category count only (`{tasks:2,log:1}`), never
field values — so the log still shows *that* something happened, never
*what*. The one rule that keeps this safe across devices: `mergeHist()` now
makes **tombstone always beat full data for the same id**, so deletion is
monotonic — a device that hasn't opened in two weeks and still holds the
full entry can never resurrect it back into another device's copy on merge.
Checked on boot, focus, and visibility-change (there's no server-side
scheduler for a static page — "scheduled" means "checked whenever a device
is actually open," and every device converges to the same result regardless
of which one expires an entry first).

## 2026-08-15 — Board History: audit trail, sync diagnostics, and restore

A third main tab, next to Board and Reports, with four sub-views: **Update
history**, **Local ↔ Cloud**, **Devices**, and **Restore**. Built to answer
one question end to end: what changed → when → which device made it →
whether it reached the cloud → which devices received it → did anything
conflict.

**The sync fix underneath it.** `adopt()` replaced the whole state object
whenever the incoming copy was newer — fine for board data (last-write-wins
is still the rule there, unchanged) but fatal for an audit trail, since every
pull from a newer device would have wiped this device's own history. History
and the device registry are now **unioned by revision id in both
directions**, including when the incoming copy is *older* and its board is
discarded: the losing side of a conflict is precisely the evidence needed to
notice the conflict happened.

**Storage model.** Each revision stores only its ops — the individual items
added, updated or deleted — and every 25th entry also carries a full board
snapshot. State at any revision = nearest snapshot, ops replayed forward.
Chosen over a snapshot-per-change model so the whole document can keep being
pushed to the Worker on mobile data. History caps at 400 entries; trimming
first guarantees the oldest survivor has a snapshot, and refuses to trim at
all if that state can't be computed, rather than leaving restore quietly
returning wrong board states.

**Change records** carry a unique revision id, exact timestamp, device id,
session id, source, and the id of the newest revision their device knew
about (`base`). That last field is what makes conflict detection exact: two
revisions sharing a base were made concurrently, without either device
seeing the other — the case where last-write-wins silently drops one side.

**Device metadata** is a structured record per device — id, type
(desktop/mobile/tablet), OS, browser, app version, first seen, last active,
and how far its data reaches. iPadOS is detected via touch-point count,
since it reports itself as a Mac. Each device stamps how far it has seen on
every pull, which is what lets any device answer "did my phone ever receive
that change?" without each one reporting separately.

**Restore** rebuilds the board at any revision, after a confirmation naming
how many changes roll back. It never deletes history — the rollback itself
becomes a new entry tagged with the revision it came from, so a restore can
be undone the same way. Revisions too old to rebuild show a disabled "Too
old" button rather than a restore that would silently produce a wrong board.

Rapid edits batch into one entry (2.5s window), so ticking several
non-negotiables in a row doesn't flood the log. The cloud push moved from
`save()` into the batch commit, so the pushed document already carries its
own audit entry instead of arriving a beat ahead of it.

## 2026-08-13 — Header redesign: stats moved under the date, nudges moved into the header

Board UI pass ahead of the GitHub Pages push. Two changes, both from user
screenshots pointing at where things should live:

**Rituals/Open/Streak stats** moved out of the header's top-right corner and
into a row directly under the date, under the title block, so the whole
header reads as one connected group instead of a split two-column layout.

**Nudges (the flag notifications)** moved from a floating card stack — first
built as a 300px absolutely-positioned bubble near the header corner, with a
solid card, asymmetric "message bubble" corner radius, and heavy shadow —
into a plain sub-header lane built into the header itself, directly under
the stats row and above the day-progress bar. Tried three directions as
mockups (a header lane, a translucent floating chip, a smaller solid
floating card) and the header lane won: it never overlaps or floats over
page content on any screen width, the header just grows to fit however many
nudges are active, and it collapses to nothing (`:empty`, no dangling
divider) when there are none. Each nudge is now a flat translucent chip
(`rgba(11,17,10,.18)` over the header's green) with a coloured left border
for type (orange = attention, indigo = sleep/cool) and uniform
`var(--on-brand)` text — measured contrast ~6.2:1 in both themes, comfortably
above AA. Dropped the old floating-stack CSS entirely (`position:absolute`
anchor, the `.wrap` `position:relative` it needed, the sub-700px static
fallback) since a lane never needed a responsive fallback in the first
place.

## 2026-08-13 — Resizable Shift timeline that auto-centres on "now"

The timeline used to just grow to fit every block in the shift - no way to
see what's happening right now without scrolling past everything before it.
Now it's a fixed-position box you can resize taller or shorter (drag the
corner; it can only ever change height, never move elsewhere on the board),
and the current block gets real emphasis - a stronger tint, an orange edge,
and a "now" badge - centred automatically in the visible area on load and
whenever the shift actually moves on to the next block. Deliberately doesn't
re-centre on every minor update (ticking a task, the clock ticking over)
while the same block is still current, so it won't fight you if you've
scrolled up to check an earlier item.

## 2026-08-13 — Anonymized employer names; removed the deprecated v8 file; noreply email

Prep for going public (GitHub Pages, Phase 3).

**Employer names anonymized** everywhere in the repo — source code, docs, and
this changelog's history. David's real task data was never in the repo and
keeps using real names privately; this was purely about what a stranger
reading the public repo would see. Renamed by shift role rather than to
fully generic labels, so the structure (one day job, two overlapping night
jobs) stays legible without naming anyone: Conduent → Day Client,
AFC → Night Client A, CMIT → Night Client B. Applied to lane ids, CSS
variable names, and labels alike, not just display text — a careful reader
could still infer an employer from `--ln-conduent` even with the visible
name changed.

**Deleted `dashboard.html` (v8) and its two docs** (`dashboard-usage.md`,
`dashboard-maintenance.md`), plus the now-pointless `backups/` folder. It was
already superseded by `dayflow.html` and kept only as a reference to port
features from — dark mode and appointments were ported months ago; the week
grid and conflict engine were always optional extras. Recoverable from git
history if ever needed again; not worth re-anonymizing a file already headed
for deletion.

**Commit history rewritten to use a GitHub noreply email**
(`hernandezdavidf@users.noreply.github.com`) instead of David's real address,
across all commits — safe to do since no remote has ever been configured on
this repo, so nothing has left this machine yet.

## 2026-08-13 — Cloudflare Worker connected; two personal-data leaks scrubbed from git

**Cloud sync is live** on David's real Worker (`prodash-sync.jobs-hernandezdavidf.workers.dev`).
Getting there surfaced a genuine Cloudflare gotcha, now documented in
`workflows/cloud-sync-setup.md`: the newer Workers dashboard saves each
settings change as a new *version* but does not auto-promote it to serve
traffic. The "Active deployment" box can keep running an older version for
minutes with zero warning — looks exactly like a wrong password (a clean
`401 unauthorized`) but isn't one. Fix: after any variable/secret/binding
change, go to **Deployments** and explicitly promote the newest version.

**Two accidental commits of David's real data got caught and removed** before
anything was ever pushed anywhere (no remote has ever been configured on this
repo):
- A stray `Reports/New folder/dayflow-data.json` swept in by `git add -A` —
  removed by amending the one commit it was in.
- A `Reports/*.xlsx` report export, committed several commits earlier,
  requiring a full `git filter-branch` rewrite across all 22 commits to
  scrub it from history, not just the working tree.
- Both `Reports/` and `dayflow-data.json` are now in `.gitignore` so this
  can't recur.

**One real mistake made and disclosed:** `git filter-branch` doesn't only
rewrite git's internal history — on the currently checked-out branch it also
checks out the result into the working directory. Since the `.xlsx` was
being removed from history, that checkout deleted it from disk too. This
wasn't anticipated before running the rewrite. The file was a regenerable
report export (not primary data — David's real task data was never touched
by any of this), so it was rebuilt from the still-intact `dayflow-data.json`
snapshot using the app's own `xlsxBlob()`/`buildZip()` functions for exact
fidelity, verified via zip-integrity check and a full cell-content read-back
against the original filter logic.

## 2026-08-13 — Mobile app groundwork: responsive layout, installable PWA, cloud sync

Three phases toward running ProDash as a real app on a phone, kept updated
across every device (GitHub Pages hosting, the fourth and last phase, still
needs David's account details before it can happen).

**Phase 1 — mobile layout.** Fixed a real horizontal-overflow bug: `.cols`
used bare `1fr` grid tracks, whose implicit minimum is their content's
min-content size rather than 0, so one unbreakable row anywhere inside could
force the whole page wider than the viewport - the tell was many unrelated
elements all reporting the identical overflow amount. Fixed with
`minmax(0, ...)`; verified zero overflow down to 320px. New `(pointer:
coarse)` block enlarges touch targets without bloating desktop. New up/down
buttons reorder a lane by tap, since native HTML5 drag has no touch
equivalent on any mobile browser.

**Phase 2 — installable (PWA).** `manifest.json`, `sw.js` (network-first for
the frequently-edited app shell, cache-first for icons, versioned cache
cleanup), five hand-drawn icons (a canvas-rendered checkmark on the brand
green, no external tool needed), and the iOS-specific meta tags Safari
requires for a real home-screen launch. Actual installing needs Phase 3's
https hosting - file:// cannot register a service worker or trigger an
install prompt, so this is scaffolded and verified as far as possible without
it.

**Phase 4 (code) — cloud sync.** OneDrive sync needs the File System Access
API, which no phone browser supports. Added a second, independent path: a
~60-line Cloudflare Worker (`cloud-worker/worker.js`, plus
`workflows/cloud-sync-setup.md`) holding one JSON blob behind a password,
reached with plain `fetch()`. Reuses the existing `adopt()`/`updatedAt`
newer-wins logic rather than inventing a second conflict rule. Found and
fixed a real bug while testing: the new sync's `localStorage` reads ran
unguarded at top-level script scope, so in any context where storage throws
(private browsing, this tool's preview sandbox) the entire app failed to
boot before ever reaching `renderAll()` - every other localStorage access in
this file was already wrapped in try/catch for exactly this reason, this one
was missed and is now fixed to match.

## 2026-08-13 — Merge Non-negotiables and Weekly targets; add/remove non-negotiables

One card now: Non-negotiables on top with an add row (name + optional tag)
pinned under the list, a dashed divider, then Weekly targets below.
Non-negotiables became editable data (`S.rituals`, migrated from the old
hardcoded `RITUALS`), same pattern as lanes — add one, or remove any of them
(including the original seven) with the × on its row, no confirmation, same
as deleting a task. Deleting one leaves its history in the day log alone; it
just stops corresponding to anything rendered. The header's Rituals % and the
week review bars both guard against zero rituals (0%, not NaN) — checked by
deleting every non-negotiable and confirming nothing breaks, then re-adding
one. Weekly targets themselves are unchanged: still fixed at Exercise ×3 and
Learn ×2, no add/remove — only Non-negotiables were asked to be editable.

## 2026-08-12 — Rename and delete any lane on the Board

Every lane header — including the original six, not just custom ones — now
has a ✎ (rename, inline, Enter/blur saves, Escape cancels) and an × (delete).
Only the lane's name changes on rename; its id is what tasks/appointments
actually reference, so nothing gets orphaned. Delete removes the lane's tasks
with it and is the one lane action gated behind `confirm()`, spelling out the
task count — a lane can hold dozens of tasks and stands for a whole job or
life area, so it doesn't get the no-confirmation treatment a single task
delete does elsewhere in this app. A deleted lane's recurring shift block (if
it had one) keeps showing up in the timeline at its usual time, just in
neutral grey instead of its colour, since shift blocks live in hardcoded
source, not state.

## 2026-08-12 — Editable lanes with drag reorder; a Reports tab with Excel export

**Lanes are now data, not code.** They used to be a hardcoded `LANES` array;
they're `S.lanes` now, live and persisted through the file sync.
- **"+ Add lane"** tile at the end of the board opens an inline form (name,
  optional ritual, 6-swatch colour picker) matching the existing addrow idiom.
- **Drag any lane by its grip (☰)** to reorder the whole board. Native HTML5
  drag-and-drop, no library.
- New palette (`--ln-x1..x6`: rose/teal/violet/fuchsia/cyan/lime) offered for
  custom lanes — never orange, which stays reserved for attention.
- Existing `dayflow-data.json` migrates automatically to the same 6 lanes in
  the same order the first time it's opened with no `lanes` key.

**New Reports tab**, next to Board in the header.
- **Reports**: date-range view (default last 7 days) over every task *added*
  in that window, split completed/pending, grouped by lane.
- **Current Day Report**: what's done today plus everything still open, for
  one lane or all — deliberately not date-filtered on the pending side, since
  an open task doesn't stop being today's problem just because it's old.
- **Export to Excel** on the Current Day Report writes a real `.xlsx` —
  hand-rolled ZIP + minimal OOXML, zero dependencies, verified by round-
  tripping it through a hand-written reader (CRC32 + XML parse) before ship.
- Tasks now stamp `completedAt` when checked off, so reports can answer "what
  got done this week" instead of only "what was added this week."

## 2026-08-12 — Drop sleep tracking, move Shift timeline left

- Removed the Sleep card entirely, along with the "Sleep 7d avg" header stat, the
  7-day average, the debt-vs-7h figure and the bar chart.
- **Shift timeline** moved into that slot — top of the narrow left column. Its
  time column was retuned for the tighter width (84px, no-wrap: the widest label
  "12:15pm–12:45pm" needs 78px flat, so anything less went ragged over two lines).
  The appointment form now stacks onto two rows to fit.
- Removed the code that went with it: `renderSleep()`, `sleepSeries()`,
  `sleepAvg()`, `SLEEP_TARGET`, the input listener, the header line, the
  low-sleep-average nudge and ~13 rules of orphaned CSS.

**Kept on purpose:** the "Slept 5+ hours" non-negotiable, the 7:00–12:15 Sleep
block in the timeline, and its "this is your sleep window" nudge. Any `sleepHrs`
already recorded in `S.log` is left untouched, so restoring the card later would
pick the history back up.

## 2026-08-12 — Back to DayFlow, now "How's our Dave looking? · ProDash"

David preferred DayFlow over the v8 rebuild, so DayFlow is now the daily app.
`dashboard.html` (v8) stays as the reference to port features from.

**Brought under version control.** `dayflow.html` copied from
`00 - EVESYS\Schedule and Tasks\` and committed byte-identical before any edit.
The original stays there untouched as a fallback. Both point at the same
`dayflow-data.json` in OneDrive, so no data migration was needed.

**Renamed** to "How's our Dave looking?" with a "Productivity Dashboard (ProDash)"
subtitle.

**Stronger palette.** Green/blue/yellow/orange at full saturation replacing the
muted earth tones. Day Client blue, Night Client B sky, Night Client A indigo, My Company green,
Learning yellow, HOA slate. Orange became the single attention colour — nudges,
streaks, now-marker, ageing tasks — and is deliberately never a lane, so orange
always means "look here". Variable names were kept, so 150 lines of CSS didn't
need rewriting.

**Dark mode** with an auto/dark/light toggle, persisted in `S.theme` so the
choice syncs through the data file to other PCs. This required splitting tokens
that were doing double duty as both a fill and as text on that fill
(`--forest`/`--forest-ink`, `--night`/`--night-ink`, `--ivory`/`--on-brand`,
`--terra`/`--terra-ink`/`--on-warm`) — a hue dark enough to carry white text is
too dark to *be* text on a dark card. Lane colours moved into CSS variables so a
theme switch re-tints every dot and bar with no re-render.

**Appointments with real times.** The schedule blocks were hardcoded in source,
so booking a dentist appointment was impossible. Added `S.events`, merged with
the recurring backbone by `dayBlocks()`. Must-attend appointments raise a nudge
within 2 hours. Inline add row, delete with an ×.

**Fixed:** the schedule had no day-of-week awareness, so Day Client, Night Client A and Night Client B
rendered on Saturdays and Sundays. Weekends now show only Sleep, Wake + prep and
Dinner.

**Verification:** 162 text elements measured at ≥4.5:1 contrast in both themes.
Console hooks `dfDebug.dayBlocks(date)` and `dfDebug.state()` added for testing.

## 2026-08-12 — Productivity Dashboard v8

Built `dashboard.html`, a single standalone file that opens by double-clicking and works
offline. Replaces the earlier `dayflow.html`, which stays untouched as a fallback.

**Core model**
- The logical day runs 07:00 → 07:00, so the Day Client / Night Client A / Night Client B shifts render as
  unbroken blocks in one day column instead of being sliced at midnight.
- Recurring definitions are stored separately from completion state; instances are
  derived at render time and keyed `b:<id>@<date>`, so history cannot duplicate or drift.
- Times are wall-clock minutes from midnight, never UTC.

**Features**
- Today panel: must-do, scheduled tasks, per-employer shift checklists, daily
  non-negotiables with streaks, weekly targets (exercise ×3, learning ×2), appointments,
  and a categorised backlog. Completing an item strikes it through and sinks it.
- Week grid with four fixed lanes per day (Life / Day Client / Night Client A / Night Client B),
  free-time shading, a now-line, and red hatching wherever two lanes collide.
- Conflict and free-time engine. Reports the arithmetic plainly: Monday is 28h scheduled
  inside 24h, 9h15m double-booked, largest free run 7am–12:15pm, below the 7h rest target.
  The permanent Night Client A × Night Client B overlap is 450 min/night.
- Quick-add with a small grammar (`Dentist 3pm-4pm #life !`), editor dialog, delete with
  6-second undo, per-occurrence skip/retime, and "this and all future" for recurring edits.
- JSON export/import with a pre-import snapshot, local-storage backup copy, and a
  recovery banner if the saved state is unreadable.
- Light/dark themes. All 142 text elements measured at ≥4.5:1 contrast in both.

**Seeded** with David's real schedule from `Usual Daily Schedule.docx`, the 8 daily
habits, and the 21 open tasks carried over from `dayflow-data.json` (the 4 completed
ones were dropped).

**Verification:** built-in self-check panel at `?debug=1` runs 41 assertions over the
date maths, overlap detection, streaks, and the quick-add parser — 41/41 passing.

**Also added:** `workflows/dashboard-usage.md`, `workflows/dashboard-maintenance.md`,
`backups/README.md`.

## 2026-08-12
- Initialized project with the WAT framework (Workflows, Agents, Tools).
- Added `CLAUDE.md` (agent instructions), `.gitignore`, `.env` placeholder, and `CHANGELOG.md`.
- Created `tools/`, `workflows/`, and `.tmp/` directories.
- Set up git version control.
