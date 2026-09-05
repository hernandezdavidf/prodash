# Changelog

All notable changes to this project are logged here, newest entry on top.

## 2026-09-05 — Roles, a profile panel, and server-enforced guest access

Three roles — **superadmin**, **user**, **guest** — with the header identity
block turned into a button that opens a profile panel showing who you are, what
you can reach, and (for a Super Admin) everyone else.

**The honest boundary, stated because it decides what this code is for.** Every
tab except the People panel renders the signed-in person's *own* board. Hiding
one is policy, not security: the data was already theirs, and a determined person
can un-hide a tab from devtools. What that buys is a simpler screen for someone
who was never meant to use those tools. The two things that genuinely *are*
boundaries — anything touching another account's row, and the guest clock — are
enforced by the Worker, and a forged capability list gets a 403 rather than a
working admin panel.

**Capabilities are strings; roles are named default sets of them.** A row's
`perms` cell layers JSON overrides on top, able to grant what the role lacks or
remove what it normally has. Adding a tab later is one string in `CAPS` and one
entry in the client's label map — no schema change, no migration. Two new sheet
columns (`perms`, `activated_at`) appended at T and U, never inserted mid-table,
because the Worker addresses columns positionally.

**The guest clock enforces itself.** A guest's session token is issued with its
`exp` capped at the 48-hour mark, so the ordinary expiry check in
`requireSession` ends the session with no per-request sheet read and nothing to
edit in localStorage. Their row flips to `deactivated` on the next login attempt
— a deliberate write, because an expiry that is only ever recomputed on read is
invisible to the Super Admin who needs to see it.

**Role and status changes bump `session_epoch`**, signing that person out
everywhere. A demotion that waited for a 30-day token to lapse would not be a
demotion. The Worker also refuses to let a Super Admin demote or deactivate
their own account: there is no recovery path short of hand-editing the sheet, so
it is cheaper to refuse than to explain.

Legacy `admin` rows are read as `superadmin` rather than orphaned, and a session
token issued before capabilities existed is treated as full access rather than
locking someone out of their own board — the server decides either way, and it
will refuse anything the account is not entitled to on the next call.

### Two collisions found by auditing, not by symptoms

Both pre-existing hazards in a 4,400-line file with one namespace:

- **`fmtWhen` was declared twice.** Board History's version returns HTML
  (`<b>`-wrapped); mine returned a plain date. Function declarations hoist and
  the last wins, so mine was silently replaced and the profile printed escaped
  markup where a date should be. Renamed to `pfWhen`.
- **`laneName` was declared twice** in the same scope, by the calendar module and
  by an older helper. They happened to agree, so nothing broke — but it was a
  trap for whoever edited one of them next. The duplicate is gone.

A third apparent duplicate, `save`, is a false positive: the two live in
different IIFEs (one saves the session, one saves the board).

### Also caught in testing

The profile module was first inserted *after* the header identity block that
consumes its `ROLE_LABELS`. `var` hoists the declaration but not the assignment,
so the block threw mid-render — the name appeared, the badge did not, and the
rest of the boot never ran. Moved above its first use.

## 2026-09-05 — Board switcher becomes a pair of pennant tabs

The Classic view / Consolidated checklist pills are now banner tabs: rounded
top, a downward point cut from the bottom, an icon, an uppercase tracked label,
a vertical gradient and a shadow that follows the silhouette.

**Colour deliberately does not copy the reference.** The source image used
magenta and yellow, and gave each tab its own hue. Here hue carries meaning —
orange is endurance, red is adrenaline and is kept scarce — so spending either
on a view switcher would dilute the one job they have. The active tab is brand
green because green means focus ("this is the view you are in") and the inactive
one is neutral. That also avoids inventing a second identity colour for what is
one control with two states.

**Every rule is scoped under `.bview`.** `.sub-tab` is shared by thirteen
buttons across three unrelated groups — this switcher, the Calendar view picker
and the Board History sub-views — so an unscoped change would have restyled all
of them. Verified after the change: the Board switcher is clipped, gradient and
uppercase; Calendar and Board History are still plain 999px pills.

Two implementation notes worth keeping:

- **`filter: drop-shadow`, not `box-shadow`.** A box-shadow is cast from the
  unclipped border box, so it would draw a rectangular shadow behind a pennant.
  `filter` follows the clipped shape.
- **The focus ring is a drop-shadow too**, because `clip-path` removes an
  `outline` along with the rest of the box.

The gradient runs `--forest` to `--forest-dk` rather than starting at the
palette green `#43A047`: that green is only 3.3:1 with white, and an 11.5px bold
label is nowhere near WCAG's large-text threshold. Measured at both gradient
endpoints in both themes, the worst pair is 5.0:1.

**A third instance of the wrapping bug**, found while measuring this one. The
"now" bar overflowed the page when an appointment with a long name happened to
be the current block. Two earlier sweeps missed it because the bug is
time-dependent rather than layout-dependent — that appointment is only the
current block during its own window. `.nowbar .nt` and `.nm` now get the same
`min-width:0` plus `overflow-wrap` pairing as the rest.

## 2026-09-05 — Expense Tracker

A fifth main tab for money. The design target was one line long: **an amount and
a few words is a complete entry.** Everything else — date, category, payment,
notes — folds away behind a disclosure, because requiring any of it is exactly
what stops someone logging the coffee they just bought.

**Dates here are wall-clock dates, not the 07:00 shift keys the rest of the app
uses.** Money reconciles against calendar days and calendar months; a bank
statement knows nothing about a shift. So a 3am purchase files under that
morning's date, not the previous evening's shift. This is the one place in the
app where `today()` is deliberately the wrong function, and there is a comment
saying so at the call site.

**Uncategorised is a first-class state, not a missing value.** It counts toward
every total, appears in the breakdown as its own row, and has a dedicated filter.
It is drawn *hatched rather than coloured*, so it reads as "not sorted yet"
rather than as a category called Other — which matters because the brief was
explicit that categorising later must never be a precondition for tracking.

**`S.expenses` is KEYED**, like tasks — so two devices that each add a
transaction while offline keep *both* on merge, rather than one silently
replacing the other. For money that is the difference between a record and a
guess.

Summaries compute today, this month (with a per-day average over days *elapsed*,
not days in the month), this year and all time. The breakdown ranks categories
by spend for month / year / all-time, and a twelve-month trend is drawn as CSS
bars — no chart library, because this app must keep working offline from
`file://` and a CDN script would break that outright.

Editing reuses the quick-add row rather than opening a dialog, so there is one
code path for "what does a transaction look like" and no second form to keep in
step. Escape cancels.

Amount parsing accepts what people actually type on a phone — `1,250`, `₱80`,
`  42.75  ` — and **refuses anything that isn't a positive number rather than
storing zero**, because a ₱0 row looks like a real record and is worse than a
refused one. The currency symbol is a click-to-change setting defaulting to ₱.

Mobile: the amount takes its own full-width line with `inputmode="decimal"` so
the number pad opens, summaries go two-up, and the delete control stays visible
under `(pointer: coarse)` since there is no hover on a phone.

One fix found in testing: the summary figures used `overflow-wrap:anywhere`,
inherited from the app-wide text rule, which broke `₱35,236.07` mid-number into
`₱35,236.0 / 7`. Numbers now shrink a step on narrow screens instead of wrapping
— a smaller total beats a broken one.

## 2026-09-05 — Lane headers: give the name its own row

Lane names were breaking mid-word — "Exercis / e", "PROJE / CTS", "My / Compa /
ny + / Person / al". The cause was not the wrapping rule but the width: six
controls (grip, two reorder arrows, pin, rename, delete) shared the title's row
inside a 224px column, squeezing the name to roughly **40px — narrower than the
word "Company"**. At that width there is no good break, so the browser broke
inside words.

Worth noting the earlier text-wrapping pass made this *visible* rather than
causing it: adding `overflow-wrap:anywhere` to `.lane-h h3` turned a silent
overflow into a mid-word break. Both are symptoms of the same missing width.

**The header is now two rows.** The title row is the colour dot, the name, and
the open count — the name owns the full width and wraps at spaces like prose.
The controls moved to a quiet strip beneath it: grip and reorder arrows left,
pin/rename/delete right. Measured before and after: the title went from ~40px
to 167px in a three-column desktop layout, and every real lane name now fits on
one line except "My Company + Personal", which takes two, breaking at a space.

`overflow-wrap:anywhere` stays as the safety net. With a full-width row the
browser finds the spaces first and only breaks inside a word when that word
genuinely cannot fit — verified with a deliberately pathological 33-character
single-word lane name, which is the only case that still breaks mid-word, and
correctly so.

**A touch-target inconsistency fixed on the way.** `.lane-pin` was added to the
lane header after the `(pointer: coarse)` block was written and never joined it,
so on a phone the star was an 18px target sitting between two 33px ones. It is
now grouped with `.lane-edit` and `.lane-del` at 34px.

Verified at 375px and at desktop width: every title contained within its lane,
tools on a single row, no horizontal page overflow.

## 2026-09-05 — Controls tidy-up: Focus mode out, Theme up, sync pills compacted

**Focus mode removed** entirely — button, the `.lane.dim` rule it existed to
drive, its click handler, its `renderAll` block, and `focus` from `BOARD_KEYS`
and `SCALARS`. An old board may still carry a `focus` key; nothing reads it and
it is no longer a synced key, so it sits inert rather than needing a migration.
The Board History diff labeller lost its `"Focus mode on/off"` line with it.

**Theme moved into the header**, beside Sign out. It now wears `.hdr-out`
(light-on-charcoal) instead of `.pill`, and it lost the filled "on" state the
pill carried in dark mode: the label already says which mode is active, and a
filled chip up there fought Sign out for attention.

**The two sync pills are now one stacked pair.** Labels shortened to one word
each — "Local" and "Cloud" — with the coloured dot carrying the state, and the
sentence that used to *be* the label moved into a hover tooltip. Their status
lines used to sit permanently beneath them, which meant two lines of small grey
prose were on screen at all times to say nothing is wrong. The nowbar's visible
text is now just the current block plus "Local Cloud".

Nothing is lost in the shortening: the tooltip is mirrored onto `aria-label`,
because a CSS `:hover` tooltip is invisible to a screen reader and this became
the only place the state is written down. The reveal is `:hover` **and**
`:focus-within`, so the keyboard path works too.

One bug caught in testing: several `setSync` callers already pass a note that
*is* the state sentence, so joining state and note blindly printed the same
sentence twice. The join is now conditional.

Tooltip colours are `--ink` on `--paper`, which inverts correctly in both themes
from tokens that already exist — charcoal-on-white in light, light-on-charcoal
in dark — rather than needing a new pair.

## 2026-09-05 — Layered document tabs on a content panel

The main nav is no longer four pills. It is a fanned strip of folder tabs: each
overlaps the next, the active one sits raised and in front, and it merges into
the sheet holding the view below with no border across the join.

**The whole illusion is one property.** Every tab pulls itself 1px down over the
panel's top border with `margin-bottom:-1px`, and the only difference between an
active and an inactive tab is what colour that overlapping 1px row is painted:
`--line`, so the panel edge reads as continuous under an inactive tab; `--panel`,
so it *erases* that edge under the active one. No transforms, no `clip-path`, no
pseudo-element in the base technique — border colour and stacking order. Which
also means it degrades to nothing worse than "rectangles with rounded tops".

`clip-path` trapezoids were the obvious alternative and were rejected: it clips
the border too, so a tab loses its outline entirely, and an unsupported
`clip-path` is simply ignored — so the design has to work as rectangles anyway.

**One panel, not four.** Only one view's content is ever visible: three view divs
carry `hidden` and the four Board siblings are hidden by `body.view-* .board-only`.
So a single wrapper always contains exactly the active view. The alternative — a
fifth wrapper around the Board's four loose siblings — duplicates the `board-only`
mechanism for no benefit.

**Four new tokens** (`--panel`, `--tab-face`, `--tab-ink`, `--lift`) in `:root`
and *both* dark blocks. The panel steps **away from `--paper`** in both themes —
down from white in light, down from the lighter card in dark — so cards keep
maximum separation and still read via their borders. `--tab-ink` exists because
`--muted` fails AA on these faces (4.41 and 3.82); `#455A64` restores 5.12.

**Lanes float, per an explicit request.** `--lift` is restated in `.lane`,
`.lane.pinned`, `.lane.active` *and* a new `.lane.pinned.active`, because
`box-shadow` does not accumulate — a later rule replaces an earlier one outright.
Adding the lift to `.lane` alone would have silently dropped it on every pinned
and every active lane. That also fixes a pre-existing bug: `.lane.active` came
later in the sheet and was eating `.lane.pinned`, so a pinned *and* active lane
lost its olive top bar.

**A z-index specificity trap, caught in testing.** `.tabbar .tab:nth-child(n)` is
(0,3,0) and outranked plain `.tab.on` at (0,2,0), so the active tab kept its
positional z-index. That looked fine only because Board happens to be first —
selecting Board History put the active tab *behind* every other tab. Both the
active and focus rules are now qualified to match.

**The `.sub-tab` handler bug.** A global handler bound all 13 sub-tabs across
three unrelated groups, stripped `.on` from all of them, and ran `renderHistory()`
with `curHView` undefined. Board pills survived by accident (their handler
registers first), Calendar pills by accident (theirs runs last) — but clicking a
Board History sub-tab and returning to the Board left Classic/Consolidated with
no pill highlighted. Scoped to `[data-hview]`, which also removes the
registration-order dependency the old arrangement was relying on.

**Accessibility:** `role="tablist"`/`tab`, `aria-selected`, `aria-controls`, a
roving `tabindex` so the strip is one tab stop, and Left/Right/Home/End moving
between tabs. `setView` now drives all four from one map so the class, the ARIA
state and the tabindex cannot drift apart.

**Responsive:** the strip deliberately does **not** wrap — if the active tab
landed on a first row it would have no panel edge to merge into. Below 620px the
labels shorten ("My Personal Calendar" → "Calendar") and the panel goes
full-bleed, which actually *widens* content from 335px to 347px at 375px.

**Two pre-existing overflow bugs found while measuring**, both confirmed against
a pre-change baseline: long URLs in the nudge strip pushed the page sideways on
every view (missed by the earlier wrapping pass because that sweep measured
children *against* `.nudge` as a container, so a nudge overflowing the *page*
passed), and the Reports filter row did the same via a date input's intrinsic
minimum width. Both fixed; all five views now measure clean at 375px.

## 2026-09-05 — Long unbroken text wraps instead of widening its card

A OneDrive share link pasted into a non-negotiable's tag overflowed the card.
A URL is a single unbreakable "word", so it sets the element's min-content
width and pushes the container past its column.

Two properties are needed together, which is why the obvious one-line fix
doesn't work: `overflow-wrap:anywhere` (unlike `break-word`, it also *shrinks
min-content size*) plus `min-width:0`, because a flex child defaults to
`min-width:auto` and refuses to go below its content width whatever the
wrapping rule says. This is the same pairing the calendar grid needed, for the
same underlying reason.

Applied across every element rendering free text — ritual labels and tags,
timeline names and descriptions, lane and report headings, calendar row titles
and notes — rather than only where it was reported, since the next long paste
lands somewhere else. `.tsk-l` already carried a version of this: the identical
bug, found once before in task titles.

**One deliberate exception.** The Consolidated Checklist's lane band truncates
with an ellipsis and puts the full name on a `title` attribute instead of
wrapping. That band has to stay exactly one ruling tall or the whole notebook
page slips off its lines — verified the rhythm still holds with a long name.

Checked by sweeping Board, Checklist, Calendar day and Agenda views with long
URLs injected into task text, ritual labels, ritual tags, lane names,
appointment names and notes, measuring every descendant against its container:
zero escapes, and no horizontal page scroll.

## 2026-09-05 — Lane pinning; the hidden-blocks drawer collapses

**Lanes can be pinned** with a star on their header — hollow when off, filled
green when on. Pinned lanes lead the Classic view *and* the Consolidated
Checklist (where the lane band carries a ★ too), because a pin that only worked
in one layout would not be much of a pin.

Pinning is a **sort over `S.lanes`, not a physical move**, so unpinning returns
a lane to where it always sat rather than stranding it at the top of the
unpinned group. The two groups then behave as independent lists for reordering:
▲▼ disable at each group's own ends, `moveLane` swaps within a group, and a
cross-group drag is a deliberate no-op that shows no drop indicator — the sort
would undo it on the next render, so offering the move would be a lie. The star
is how a lane changes groups.

Within the pinned group lanes keep their **board order**, not the order they
were pinned in. Predictability won over recency: pinning something should not
also silently reorder what is already pinned.

**The hidden-routine-blocks list is now collapsed** behind "N hidden from your
schedule". Prune a routine to the blocks you actually keep and it reaches a
dozen-plus chips — at which point an undo list taller than the timeline it
undoes has stopped being a safety net and become clutter. Native `<details>`,
so keyboard and screen-reader behaviour come free.

Its open state is read off the live element at render time rather than from a
flag maintained by the `toggle` event. **That event fires asynchronously**, so
collapsing the drawer and immediately doing anything that saves — ticking a
task, pinning a lane — re-rendered from a stale flag and sprang it back open.
Found in testing, and the sort of bug that only appears when two interactions
land in the same tick.

## 2026-09-05 — Board gains a second layout: Consolidated Checklist

The Board now switches between **Classic view** (the lane columns, untouched)
and **Consolidated checklist** — every task from every lane on one sheet of
ruled notebook paper, grouped under colour-coded lane headings, with finished
items struck through in red.

**It is a rendering, not a second list.** The checklist reads the same
`S.tasks` the columns do, so there is no copy to keep in step. Ticking in
either view calls the same new `toggleTask()` / `deleteTask()` helpers, which
the Classic handler was refactored to use as well. That refactor is the point:
`toggleTask` stamps `completedAt`, which **Reports** relies on to answer "what
got done this week", and a second view carrying its own toggle logic would
eventually forget that stamp and silently drop its completions out of every
report.

**The ruling rhythm is the whole trick.** `--rl` is the line pitch, and every
element on the page — rows, lane headers, and each wrapped line of a long task
— is exactly `--rl` tall or a whole multiple of it, achieved with
`line-height:var(--rl)` rather than padding. Without that, text drifts off the
ruling the moment a task wraps to a second line. Verified: a deliberately long
task measured 68px against a 34px pitch, and every element on the page came
back a clean multiple.

**Lane headings are solid bands in the lane's own colour**, which preserves the
lane context the brief asked for. Lane hues run from dark indigo to bright
cyan, and white text fails on the light end, so each band carries a flat 28%
black wash over the hue. That floors every lane past AA without needing a
hand-picked "dark version" of each colour: cyan `#00ACC1` is 2.74:1 with white
raw and 4.93:1 washed, the worst case in the set.

**Tasks whose lane was deleted get an "Unassigned" section** rather than
vanishing — "include all tasks across all board lanes" has to survive a lane
being removed.

Red and blue appear here as ruling lines and a margin rule, which is the one
place in the app they are decorative rather than semantic. They are their own
tokens (`--rule-a`, `--rule-b`, `--rule-margin`, `--paper-note`, `--note-ink`)
in all three palette blocks, so nothing reads a ruling line as an alert and the
notebook repaints correctly in dark. Note ink measures 14.4:1 on paper in
light, 13.2:1 in dark.

The chosen layout is stored as `boardView` and synced like `theme` and `focus`,
so the Board opens the same way on every device.

## 2026-09-04 — New colour system: energy semantics, not decoration

Rebuilt on five anchors — `#E53935` red, `#FB8C00` orange, `#43A047` green,
`#ECEFF1` light, `#263238` charcoal — assigned by **what each colour does to
you**, which is the brief David gave: red raises heart rate, orange carries
physical drive plus mental endurance, green sparks problem-solving and focus.

- **Green = focus.** Brand, progress fills, checkboxes, done, focus mode. The
  colour of a clear head, so it marks what you are working on and what is
  finished.
- **Orange = endurance.** The now-bar, streaks, the dual night shift, the
  circadian low, appointment bands. It sits on screen for hours without
  alarming, which is precisely the job it has here.
- **Red = adrenaline, and kept scarce.** Must-attend, overdue, sync failure,
  destructive actions. Red that shows up constantly stops raising anyone's
  pulse, which would waste the only colour here whose whole purpose is to.
- **Charcoal + light are the spine, and they swap.** `#263238` is text on
  `#ECEFF1` in light, and the card surface under `#ECEFF1` text in dark. Using
  the palette's own two neutrals for both halves is what keeps the themes
  recognisably one system rather than two designs.

**The header is charcoal, not brand green.** White on `#43A047` is 3.3:1 —
fine for the 26px title, failing for the 12px labels beside it — so a green
hero would have forced darkening the brand into something that is no longer the
palette colour. On `#263238` the same text is 14.8:1. It also frees green to be
the thing that *moves* on that surface (progress, stats, buttons) instead of
being the surface, which is what focus should look like: the one lit thing.
Layered radial and linear gradients give it depth rather than a flat fill.

**Two semantic splits that the old palette couldn't express.** Sync "needs
reconnecting" and sync "failed" shared one orange dot; failure now takes red,
reconnection keeps orange, because one is a chore and the other is data not
being saved. And a task open 3+ shifts is now the one nudge tier allowed to use
red — overdue, not merely pending.

**Lane hues were retuned, not left alone.** They moved to a harmonised
Material-600 set that deliberately excludes green, orange and red. The rule that
always applied to orange — never a lane, so orange always means "look here" —
now extends to all three semantic colours. A lane answers "whose time is this",
never "how urgent is this".

**Contrast was measured, not eyeballed.** Every text token was computed against
its own background in both themes; all pass AA (lowest 5.13:1). Three fixes came
out of it: the green fill darkened to `#2E7D32` in both themes so white clears
4.5:1; `--on-alert` deleted rather than shipped, since white on `#E53935` is
4.2:1 and anything needing text on red uses `--alert-ink` instead; and the icon
grey `--sage` (3.35:1 — correct for glyphs, which need only 3:1) was swapped for
`--muted` on the three places it was carrying actual text.

The two dark blocks were verified token-for-token identical afterwards — that
drift is a bug this file has hit before, so it is now checked rather than
assumed.

## 2026-09-04 — Editable shift start; Weekly targets folded into Non-negotiables

**The 07:00 roll is now a setting, not a constant.** Click the `7:00am → 7:00am`
chip on the Shift timeline to change when the logical day begins. This is not a
label edit: `ROLL` was a module constant feeding `today()`, `sm()` and `nowSm()`,
so it became `rollM()` reading `S.roll` — a function rather than a cached copy,
because a stale copy would surface as tasks silently landing on the wrong date
rather than as an obvious settings bug. Stored as a synced board scalar, since
two devices disagreeing about when "today" starts would file the same 3am edit
under two different dates.

The caption underneath is generated from the value instead of written down, and
handles its own edge cases: at midnight it reads "like an ordinary calendar", and
below 02:00 it drops the "so 3am work logs to the right shift" clause entirely,
because there is no pre-roll window left to give an example from. A hardcoded
sentence under a chip reading 5:00am would be worse than no sentence.

**Weekly targets and Non-negotiables merged**, since they were two lists holding
the same habits and disagreeing about which owned a given one. The card is now
**Non-negotiables & Goals**: any item can carry `target` (1–7 a week), set via
the ◎ button or the `×/wk` field when adding. With a target it shows progress
pips and a hit/target count; without one it shows a streak, exactly as before.
The daily tick is the same action for both — one place to tick, one place to
look. `weeklyCount()` survives the removal of the card it was written for, and
`.wk-p` pip styling is reused rather than duplicated.

**Removed the per-task day badge** (`21d`). `ageOf()` stays because the
stale-task nudge still uses it — the signal was worth keeping, a permanent column
of orange numbers beside every task was not.

Also added a **Frontend aesthetics** section to `CLAUDE.md`, with a subsection
recording which of its rules cannot apply to a single-file, build-step-free app
that must keep working offline from `file://` (shadcn, Tailwind, Motion, and
network-loaded Google Fonts).

## 2026-09-04 — My Personal Calendar: recurrence, lesson-plan days, derived reminders

A fourth tab holding personal scheduling: **Month**, **Week**, **Day**,
**Year**, **Agenda** and **Recurring** views over one activity store.

**No second scheduling store, deliberately.** Activities are rows in `S.events`
— the array appointments have always used — so every existing appointment keeps
working untouched, and calendar activities reach the Board's Shift Timeline and
the nudge strip through `dayBlocks()`, the one function all three already read.
The alternative (a `S.calendar` array beside `S.events`) would have needed
two-way sync between two schedules that mean the same thing, which is the class
of bug that never fully goes away. It also means sync, Board History and the
revision engine picked the feature up for free: `events` was already a KEYED
union-by-id key.

**Recurrence stores a rule, never expanded copies:**
`rr = {f, int, days[], until}` with `occursOn(e,k)` answering arithmetically
per day. A daily habit stays one row instead of 365 a year, in a document that
gets pushed to the Worker whole on mobile data — and editing the rule fixes
every occurrence at once rather than leaving stale copies behind. Monthly and
yearly clamp to the last valid day, so a commitment on the 31st doesn't vanish
in February and 29 Feb doesn't skip three years in four. Weekly counts its
interval from each date's own week start, because measuring from the raw anchor
drifts for any weekday earlier in the week than the anchor itself.

*"Ends after N times"* is converted to a concrete `until` date at save time.
That keeps `occursOn` O(1) — a year view asks it ~4000 times per render, and
counting occurrences from the anchor on each call would be visible.

**Reminders are derived, never stored.** `renderNudges()` recomputes from the
calendar on every render, which is the entire reason editing, rescheduling or
deleting an activity keeps its reminders correct: there is nothing to update,
because the reminder was never a separate object. Recurring activities notify
per occurrence for the same reason. Per-activity lead time (`remind`) defaults
to 120 minutes so every pre-existing appointment warns exactly as before.
All-day items announce themselves up front since they have no start minute to
count down to, and tomorrow's first commitment surfaces once the shift is
winding down.

**Per-occurrence, not per-series**, in both directions: ticking an activity done
writes `done[dateKey]`, and deleting one day adds to `ex[]` rather than killing
the series. The timeline's × button now asks which was meant — guessing wrong
there destroys a year of a commitment to cancel one afternoon.

**Day view is the lesson plan**: a per-date objective (new `S.plans` map, added
to `BOARD_KEYS`/`MAPS`) above the day's activities in time order, each with its
notes, category, recurrence and a done tick.

**Dates are shift keys, not wall-clock dates** — `date` means what it has always
meant to `dayBlocks()`. Since the shift rolls at 07:00 the two are identical
from 7am onward; only a 00:00–06:59 activity belongs to the previous shift, and
the editor says so when a start time crosses that line rather than filing a 3am
session on the wrong day silently.

**Colour means category here** (work/learning/health/family/admin/personal),
deliberately a different axis from the Board's lane colours, which mean life
area. A calendar answers "what kind of thing is this"; the board answers "whose
time is this".

Two layout fixes found by looking at it rather than reasoning about it: grid
cells needed `min-width:0` (a grid item's `min-width:auto` let nowrap chips push
the 7-column grid past its card, cutting off Friday and Saturday), and below
560px month view drops to category-coloured density bars, since seven columns on
a phone leaves ~50px per day — too narrow for any label to survive. Tapping a
day opens the Day view, where the detail fits.

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
