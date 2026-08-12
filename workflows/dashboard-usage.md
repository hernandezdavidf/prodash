# Workflow: Running the day with dashboard.html (v8) — NOT the daily app

> **Superseded 2026-08-12.** David went back to DayFlow, now
> **"How's our Dave looking? · ProDash"** (`dayflow.html`). See
> [prodash-usage.md](prodash-usage.md) for the app you actually open each day.
>
> This document describes `dashboard.html`, which is kept only as the reference
> implementation to port features from — its week grid and conflict/free-time
> engine have not been moved over yet. Do not log your day in it; you would split
> your history across two apps.

**Objective:** capture what needs doing, cross it off, and see where the hours actually go.

**Tool:** `dashboard.html` — double-click it. No internet, no install, no login.
Bookmark it or pin it to the taskbar.

---

## The one thing to understand first

**The day rolls at 07:00, not midnight.** At 2 AM on Tuesday the dashboard still says
Monday, because Monday's AFC shift is still running. This is deliberate — it is why the
night shifts draw as unbroken blocks instead of being sliced in half at midnight.

So "today" means *this shift cycle*, 07:00 → 07:00.

---

## Daily loop

**Start of the cycle (when you wake, ~12:15pm)**
1. Open the dashboard. Read the **Now** bar — it shows what is live, how much
   uncommitted time is left, and whether the rest window cleared 7 hours.
2. Look at **Backlog**. Pull anything you intend to do today into today with the
   **→ today** button. Be honest: three real items beats twelve aspirational ones.
3. Anything with a hard time (appointment, call, meeting) goes in with a time so it
   lands on the grid and collides visibly if it clashes with a shift.

**During the shifts**
4. Tick items as you finish them. They strike through and sink to the bottom of their
   section — the remaining list is always what is left.
5. **Shift checklists** carry the standing per-employer routine: Conduent items cleared,
   CMIT to-do written, AFC EOD sent. These reset every day; ticking them feeds the streaks.

**End of the cycle (~06:30–07:00, before sleep)**
6. Tick the daily non-negotiables you actually did. Streaks only mean something if
   you do not tick things you did not do.
7. Write tomorrow's CMIT list and send the AFC EOD — the checklists are there so these
   two never get skipped.

**Weekly**
8. Glance at **Review**: seven bars, completion % per day, streaks, and the
   exercise ×3 / learning ×2 targets.
9. Export a backup (**⇩** or **E**) into `backups/`. Do this before you close the tab
   for the week.

---

## Quick add grammar

One input line, at the bottom of the Today card. Press **/** to jump to it.

| You type | You get |
|---|---|
| `Call the bank` | task, today, My Company |
| `Letter to Mayor #admin` | task, today, HOA/Admin |
| `Dentist 3pm-4pm #life !` | 1-hour appointment on the grid at 15:00, flagged must-do |
| `Board meeting fri 8pm-9pm #admin` | appointment on Friday |
| `CMIT audit 22:30 2h #cmit` | 2-hour block starting 22:30 |
| `Sort the garage ~` | low-priority task (dashed edge, faded) |

- `#` picks the category — id, colour name, or tag all work (`#biz`, `#life`, `#FH`).
- `!` = must do. `~` = low priority.
- No time given → it becomes a plain task. A time → it becomes a block on the grid.
- No day word → today. `tomorrow`, `mon`…`sun` also work.

## Keyboard

`/` or `n` quick add · `←` `→` week · `T` today · `E` export · `?` help · `Esc` close

---

## Reading the week grid

Each day column is split into four fixed vertical lanes, left to right:

| Lane | What lives there |
|---|---|
| 1st (widest) | Life — family, health, your company, learning, HOA |
| 2nd | Conduent |
| 3rd | CMIT |
| 4th | AFC |

A block never changes lane, so AFC is always the far-right stripe. **When two lanes are
filled at the same height, you are double-booked** — and the overlap is hatched in red.

- Grey dashed bands = uncommitted time, labelled with how long they run.
- The red line is now.
- Day header badges: `0/8` blocks done, `☑0/1` tasks assigned (hover for the list),
  `⚠8h` work-vs-work collision. Hover any badge for detail.
- The footer states the arithmetic plainly: *"Mon · 28h scheduled inside 24h →
  9h 15m double-booked · largest free run 7am–12:15pm · below the 7h rest target."*

The AFC × CMIT overlap is real and permanent (450 min/night). The dashboard will not
nag you to fix it — it just refuses to pretend the day has more hours than it does.

---

## Edge cases

- **Skipping one day of a shift** (leave, holiday): click the block on the grid →
  Delete. It skips that occurrence only, and Undo is available for 6 seconds.
- **A shift's hours change permanently:** click the block → set the new time →
  "Apply to: This and all future". Past days keep their old times, so history stays honest.
- **Storage blocked** (a red banner says "running in memory only"): the browser is
  refusing local storage. Export before closing, and open the file directly from disk
  rather than through a preview pane or a zip viewer.
- **Data looks wrong after an update:** a recovery banner means the saved copy was
  unreadable and the last known-good was loaded. Check the last day or two of ticks.

## Verifying the app still works

Open `dashboard.html?debug=1` — a Self-check card appears at the bottom and runs 41
assertions over the date maths, overlap detection, and the quick-add parser.
It should read **41 / 41 passing**. You can also run `pd8SelfTest()` in the console.
