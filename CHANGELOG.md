# Changelog

All notable changes to this project are logged here, newest entry on top.

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
