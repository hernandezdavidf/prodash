# Changelog

All notable changes to this project are logged here, newest entry on top.

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
