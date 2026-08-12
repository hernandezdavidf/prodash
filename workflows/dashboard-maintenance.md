# Workflow: Changing the dashboard

**Objective:** modify `dashboard.html` without losing David's data or breaking the
time maths.

**Audience:** the agent (or David) editing the file.

---

## Before touching anything

1. **Ask David to export a backup first** (**⇩** in the app) and confirm the file is in
   `backups/`. His data lives in browser local storage, not in the repo — an edit that
   corrupts the state shape can destroy it, and nothing in git will bring it back.
2. `git status` should be clean. Commit or stash first, so the change is isolated.

## Hard constraints — do not break these

| Constraint | Why |
|---|---|
| No CDN, no external fonts, no icon library, no `fetch` | Must render with Wi-Fi off |
| One classic `<script>` in an IIFE | `<script type="module">` fails under `file://` |
| No build step, no npm, no Python | None are installed on this machine (the `python.exe` on PATH is a Microsoft Store stub that fails) |
| All storage keys prefixed `pd8.v1.` | `file://` shares one opaque origin with every other local page |
| Times are wall-clock minutes from midnight, never UTC | The schedule is defined in PHT wall-clock; PH has no DST, so conversion only adds bugs |

## The rules that keep the data honest

- **Definitions and completion state stay separate.** Recurring blocks are never
  materialised into rows; instances are derived at render time and keyed
  `b:<id>@<date>`. Never write a loop that expands recurrences into `S.blocks`.
- **An instance anchors to the calendar date of its start.** AFC's Monday shift is
  `b:blk_afc@2026-08-10` even though the EOD lands Tuesday 07:00.
- **Changing a shift's hours going forward** sets `effectiveTo` on the old block and
  creates a new one. Do not edit `startMin` in place — that silently rewrites history.
- **`dayStartMin` is a setting, not a constant** (`S.meta.dayStartMin`, default 420).
  Boundary-clipping logic must survive even though nothing currently crosses it.

## Changing the schema

Bump `SCHEMA`, then add the migration inside `normalize()` — it already runs on every
load and on import. `normalize()` must tolerate *any* older shape without throwing;
a throw here shows David the recovery banner and looks like data loss.

## After every change

1. Open `dashboard.html?debug=1`. **41/41 must pass.** If you changed date maths,
   overlap detection, or the parser, add assertions rather than adjusting existing ones
   to match new behaviour.
2. Click through: add a task, tick it, reload, confirm it is still ticked. Navigate a
   week forward and back. Delete something and undo it.
3. Toggle dark mode. New colours must clear 4.5:1 against their background — the
   yellow-on-white and white-on-yellow combinations are the ones that fail.
4. If you touched the dark palette: **there are two dark blocks** — the
   `prefers-color-scheme` media query and `:root[data-theme="dark"]`. They must hold
   identical values or the manual toggle and the OS setting disagree. This has already
   caused one bug.
5. Update `CHANGELOG.md`, newest entry on top. Commit with a clear message.

## Useful console hooks

```
pd8SelfTest()   // run the 41 assertions, render the panel
pd8State()      // the live state object
pd8Seed()       // a pristine starting state
```

`?now=2026-08-11T02:00` fakes the clock, so the 07:00 boundary and the now-line can be
tested without changing the system time.

## Known limitations (deliberate, not bugs)

- **No drag-to-move.** Time edits go through the dialog. Drag on a four-lane overnight
  grid is touch-hostile and buys little for a schedule that is 90% fixed shifts.
- **Untimed tasks do not draw on the grid.** They surface as a `☑ done/total` badge in
  the day header with the list in the tooltip.
- **Short life blocks truncate** ("Wake + prep" → "Wak…"). A 15-minute event on a
  24-hour grid is ~13px tall; every calendar app does this. The tooltip and the Today
  panel carry the full text. Tall narrow work blocks rotate their label instead.
