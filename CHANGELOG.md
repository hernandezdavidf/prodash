# Changelog

All notable changes to this project are logged here, newest entry on top.

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
muted earth tones. Conduent blue, CMIT sky, AFC indigo, My Company green,
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

**Fixed:** the schedule had no day-of-week awareness, so Conduent, CMIT and AFC
rendered on Saturdays and Sundays. Weekends now show only Sleep, Wake + prep and
Dinner.

**Verification:** 162 text elements measured at ≥4.5:1 contrast in both themes.
Console hooks `dfDebug.dayBlocks(date)` and `dfDebug.state()` added for testing.

## 2026-08-12 — Productivity Dashboard v8

Built `dashboard.html`, a single standalone file that opens by double-clicking and works
offline. Replaces the earlier `dayflow.html`, which stays untouched as a fallback.

**Core model**
- The logical day runs 07:00 → 07:00, so the Conduent / CMIT / AFC shifts render as
  unbroken blocks in one day column instead of being sliced at midnight.
- Recurring definitions are stored separately from completion state; instances are
  derived at render time and keyed `b:<id>@<date>`, so history cannot duplicate or drift.
- Times are wall-clock minutes from midnight, never UTC.

**Features**
- Today panel: must-do, scheduled tasks, per-employer shift checklists, daily
  non-negotiables with streaks, weekly targets (exercise ×3, learning ×2), appointments,
  and a categorised backlog. Completing an item strikes it through and sinks it.
- Week grid with four fixed lanes per day (Life / Conduent / CMIT / AFC), free-time
  shading, a now-line, and red hatching wherever two lanes collide.
- Conflict and free-time engine. Reports the arithmetic plainly: Monday is 28h scheduled
  inside 24h, 9h15m double-booked, largest free run 7am–12:15pm, below the 7h rest target.
  The permanent AFC × CMIT overlap is 450 min/night.
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
