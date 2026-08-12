# Workflow: Running the shift with ProDash

**App:** `dayflow.html` — "How's our Dave looking? · Productivity Dashboard (ProDash)".
Double-click it. No internet, no install, no login.

**This is the daily app.** `dashboard.html` (v8) is kept only as a parts bin —
don't log anything in it, or your history splits across two places.

---

## First run — connect the data file

ProDash writes straight to a real JSON file, which is why your data follows you
between PCs instead of living in one browser.

1. Open `dayflow.html`.
2. Click the sync pill in the Now bar (it says **Local only — connect**).
3. Pick `00 - EVESYS\Schedule and Tasks\dayflow-data.json`.
4. The pill turns green: **Synced to file**.

Your existing tasks, habit log and streaks appear immediately — this is the same
file the old DayFlow used, so nothing was migrated and nothing was lost.

You have to do this once per browser, and again if you move the app file. The
permission cannot carry over automatically; that is a browser rule, not a bug.
Needs Chrome or Edge on desktop. On anything else it falls back to browser-only
storage and you should use Export backup instead.

## The 7am rule

**The day rolls over at 7:00am, not midnight.** At 3am on Tuesday, ProDash still
says Monday — because Monday's AFC shift is still running. Work you log at 3am
counts against the right shift. Everything in the app follows this.

---

## Daily loop

**On waking (~12:15pm)**
1. Read the Now bar and the nudges. The nudges are the point of this app — they
   only appear when something is actually true right now.
2. Log hours slept in the Sleep card. Under 5.5h turns the bar orange and changes
   what the app tells you.

**During the shifts**
3. Tick non-negotiables as you clear them. Streaks build from these, so only tick
   what you actually did — a streak you inflated tells you nothing.
4. Add tasks to the lane they belong to. Anything open 3+ shifts gets flagged:
   do it, delegate it, or delete it.
5. Turn on **Focus mode** to dim every lane except the one that's live.

**Before sleep (~6:30am)**
6. Fill the Shutdown ritual: next shift's top 3, and what moved this shift.
   It closes the loop so the work doesn't follow you to bed.

**Weekly** — check the weekly targets (exercise ×3, learning ×2) and the
Last 7 shifts bars.

---

## Appointments

Under the Shift timeline: type what it is, set date and start/end, pick which
part of your life it belongs to, tick **must attend** if you have to be there.

- It appears in the timeline in the right chronological slot, tinted orange.
- A must-attend appointment raises a nudge **2 hours before**, and again while
  it's live, so it can't quietly arrive mid-shift.
- The Now bar shows an appointment in preference to the routine block it sits
  inside.
- Remove one with the **×** on its row.

Weekends only show Sleep, Wake + prep and Dinner — the client shifts are Mon–Fri.

## Adding your own lane

Click **+ Add lane** at the end of the board. Give it a name, an optional note
on when it happens, and pick one of the six colours offered — then it works
exactly like Conduent or AFC: add tasks, tick them off, it counts toward
Reports. Drag any lane by its **☰** grip to put it where you want on the board.

## Renaming or removing a lane

Every lane — including the original six — has a **✎** and a **×** in its
header.

- **✎** turns the name into an editable field. Enter or click elsewhere to
  save, Escape to back out. Nothing else about the lane changes — its tasks,
  its colour, its position all stay exactly where they were.
- **×** removes the lane. If it has tasks in it, they're deleted with it —
  you'll be asked to confirm and told how many. There's no undo, so if you
  just want it out of the way for now, drag it to the end of the board
  instead of deleting it.

Deleting a lane that one of the three job shifts (Conduent/AFC/CMIT) belongs
to doesn't touch the shift itself — it still shows up in the Shift timeline
at its usual time, just in a neutral grey instead of its colour.

## Non-negotiables

One card now, with Weekly targets underneath it. Add a new non-negotiable
with the row at the bottom of the list — a name, and an optional tag like
"Health" or "Family". Remove one with the **×** on its row; unlike removing a
lane, this doesn't ask you to confirm, the same as deleting a task. Its past
history stays in the day log even after you remove it, it just stops
counting toward anything going forward.

Weekly targets (Exercise, Learn something new) are still fixed for now.

## Reports

A second tab, next to **Board**, in the header.

- **Reports** — pick a date range (defaults to the last 7 days) and, optionally,
  one lane. Shows every task *added* in that window, split into completed and
  pending, grouped by lane.
- **Current Day Report** — what got done today, plus everything still open,
  for one lane or all of them. This one isn't date-limited on the pending side
  — a task doesn't stop being today's problem just because you added it three
  days ago.
- **Export to Excel** on the Current Day Report downloads a real `.xlsx` —
  Lane, Task, Status, Added, Completed — for whichever lane is selected.

## Colours

Blue = the three client jobs (Conduent, CMIT, AFC in three tints). Green = your
company. Yellow = learning. Slate = HOA and low priority, drained on purpose.

**Orange is never a lane.** It's reserved for attention: nudges, streaks, the
now-marker, ageing tasks, appointments. Orange always means "look here".

## Themes

The **Theme** pill cycles auto → dark → light. Auto follows Windows. The choice
is stored in your data file, so it follows you to your other PC.

---

## Backups

The file sync *is* your backup, as long as the pill is green and the file sits in
OneDrive. **Export backup** additionally drops a dated copy in Downloads — worth
doing before any change to the app itself.

## If something looks wrong

- **Pill says "Reconnect file"** — click it once and re-grant access. Browsers
  drop the permission periodically.
- **Pill says "Local only"** — you're not synced. Anything you type is in this
  browser only. Connect before you rely on it.
- **Edits from your other PC missing** — ProDash re-reads the file when the
  window regains focus and every 2 minutes. Give OneDrive a moment to sync down,
  then click away and back.
- **Checking the schedule for another day** — open the console and run
  `dfDebug.dayBlocks("2026-08-15")`. `dfDebug.state()` shows the live data.
