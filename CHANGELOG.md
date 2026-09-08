# Changelog

All notable changes to this project are logged here, newest entry on top.

## 2026-09-08 — All-day activities return to the day view (v4.10)

### The bug, and why it wasn't where it looked

An all-day activity appeared nowhere on the Board. Not a fault in the activity
or in the Must-attend switch — which is why toggling `must` changed nothing, and
why it looked so much like a save failure.

`dayBlocks()` has always excluded `e.allDay`, because the day view is laid out
by start/end minute and an all-day item has no position in it. That was
survivable while the nudge strip existed: it announced all-day items, so they
had *a* home on the Board. Deleting the strip in 4.7 took that home away and
left the exclusion behind. The v4.7 changelog and a comment at the exclusion
both recorded this as a known consequence; this is that consequence coming due.

### The fix

A new `allDayOn(k)`, read by `renderTimeline()` and drawn as its own band above
the timed list — where a calendar puts these, and the same shape the Calendar
tab already uses.

**They stay out of `dayBlocks()`/`daySpans()`, deliberately.** Those feed
`currentSpan()`, which prefers a calendar activity covering the current minute
over the routine block underneath it. An all-day item given a 00:00–24:00 span
would therefore win the Now bar every minute of every day and permanently
replace "Day Client" with "Bills: Water District". An all-day item is the frame
around the day, not the thing you are in.

### The Now bar, in the gaps only

`nowRotation()` makes the precedence explicit, and it is the whole safety
argument:

1. timed appointments happening this minute (rotating, must-attend first)
2. the routine block you are inside (no rotation — there is one)
3. today's outstanding all-day activities (rotating)
4. nothing, and the bar reads "Unscheduled"

Three is new. An all-day item can reach the headline **only** in a slot that
would otherwise say "Unscheduled", which is exactly what makes it safe: it can
never displace the block you are working, and it cannot hold the bar all day.
That answers the objection to giving all-day items a real span without touching
`daySpans()` or `currentSpan()` at all.

The pseudo-span carries `allDay:true` and no `st`/`en` — deliberately, so it
stays ineligible for the span layer. The rotation key includes the shape
(`id@ad` vs `id@st`) rather than keying on an undefined `st`. Label reads "All
day today", and the meta line states what the item *is* (repeat rule, note)
because there is no countdown to run.

The 8s ticker moved from `nowSpans()` to `nowRotation()`; asking a different
question than `renderNow()` answers would have left the dots and the headline
disagreeing about how many items there are.

Precedence verified across all six states: nothing → "Unscheduled"; one all-day
→ headline, no dots; two all-day → rotating with 2 dots; a timed appointment
present → it wins; routine block restored → it wins; all-day ticked done →
back to "Unscheduled".

The band carries no `now` and no `past` badge — it has no start to be current at
and no end to be over at. Its only state is done, ticked from the Calendar,
which renders `past doneb` and a done badge exactly as a timed activity does.

### Shared wiring

Tap-to-edit and the `×` were inline in `renderTimeline()`'s loop. They are now
`wireActivityRow(el, b, k)`, used by both the band and the timed list, so the
two cannot drift into disagreeing about what a row does — including the
recurring-activity prompt, where guessing wrong destroys a series to cancel one
day. The timed path passes yesterday's key for a carry-over occurrence, as
before.

Regression-checked after the refactor: tapping a timed appointment still opens
the right activity with the right start time, and a routine block's `×` is still
the hide-from-schedule path rather than a delete.

### Styling

`.blk.allday` takes a solid bottom rule against the dashed one every other row
carries — that change of rule is what separates the band from the clock-ordered
list without needing a heading to say so. "ALL DAY" is set in caps at label
weight in the time column, which is otherwise all tabular digits.

## 2026-09-08 — Section headings go sans (v4.9.1)

Follows the same call made for `.ngbar .ng-l b` in 4.9, applied to the headings
proper.

`h1,h2,h3{font-family:var(--serif)}` splits: **`h1` keeps Georgia**, `h2,h3`
take `--sans` at weight 800 with `-.2px` tracking. One serif line at the top of
the page reads as a signature; the same face repeated down every card reads as a
font choice. Sans headings also sit better beside the sans body text they
introduce, which is the job.

The 800 and the negative tracking are not decoration. At these sizes 800 gives a
sans heading the presence Georgia had at 700, and without the tightening a sans
line sets noticeably wider than the serif it replaced — enough to push the count
chips (`.card h2 .cnt`) along the row.

Rules changed alongside, because each overrides the `h3` default or has to match
one:

- **`.lane-name-edit`** — must track `.lane-h h3` exactly in face, weight, size
  and tracking, or the lane name visibly jumps the moment you click to rename
  it. This one is correctness, not taste.
- **`.chk-head`** — the lane band on the Consolidated Checklist is the same
  object as `.lane-h h3` in Classic view. Its **positive** tracking is kept,
  unlike the other headings: small white text on a dark colour wash wants air,
  not tightening.
- **`.am-card h3`** (dialog titles), **`.chk-title`**, **`.cal-title`** — all
  section headers, all previously setting `--serif` explicitly.

Serif deliberately retained where it is doing a job rather than decorating:
`h1`, `.nowbar .nt` (content, not a header), the ruled checklist page
(`.chk-t`, `.tnote-*` — the serif *is* the notebook being imitated, and the
heading above it is the app talking, not the notebook), the Bible reader
(`.bb-txt` et al, set for reading at length), and the numeric display faces
(`.stat b`, `.rep-totals b`, `.xsum-c b`, `.wc-time`).

Verified: `h1` Georgia 700, `.card h2` sans 800/15px, `.lane-h h3` sans 800/14px,
`.chk-title` and `.am-card h3` sans 800/17px.

## 2026-09-08 — /auth/me reads the nickname from the sheet, not the token (v4.9)

### The bug

v4.8 fixed the client half of the nickname (`applyGreeting()` re-runnable,
`PDAuth.mergeUser()`, `umPatch()` writing the session) and the deploy half
(`/health` versioning). Saving then worked — heading and tab title changed
instantly, the sheet was correct, the Nickname field kept the value — and a
refresh put a random pet name back.

The give-away was that the *field* stayed right while the *heading* reverted:
two sources disagreeing, not a failed write.

`me()` answered `nickname: session.nick`, read out of the **signed token**.
Everything else in that response can safely come from the token because
everything else bumps `sessionEpoch` when it changes, forcing a re-login and a
freshly-minted token. The nickname deliberately does **not** — `adminUpdateUser`
has an explicit `// No killSessions: this is a word in a heading`. That
exemption is exactly what broke it: `session.nick` is a snapshot from issue
time, so a nickname set afterwards stayed invisible to `/auth/me` for the life
of the token (up to 30 days), and boot merged that stale `""` back over the
good value the admin panel had just written.

### The fix

`me()` now reads the row and takes `F.nickname` from the sheet, falling back to
the token's copy inside a `try` so a Sheets hiccup degrades rather than fails
the confirmation. One row read per boot, on a background endpoint the board has
already opened from cache before it answers — not on any path the user waits on.

`WORKER_VERSION` and `WORKER_MIN` both go to 4.9, so the User & Role Management
banner demands the redeploy until it happens. Which is the versioning added in
4.8 doing precisely the job it was added for, one release later.

### Also

`.ngbar .ng-l b` drops `--serif` for the body sans (16px/800). The serif was
borrowed from `.nowbar .nt` when this row lived inside the Now bar and wanted to
read as its small sibling. It is not a sibling any more — it moved onto its own
card in 4.7 — and a Georgia line there read as a second headline competing with
the real one.

## 2026-09-08 — Eight palettes on a second theme axis; the outstanding bar leaves the header; the nickname actually applies (v4.8)

### The outstanding bar is its own card

`#ngbar` moved out of `<header>` to a sibling directly below it, inside `.wrap`
— so it inherits the 1200px max-width with no width plumbing of its own. It
also lost `.board-only`: it now follows you onto every tab, because a
non-negotiable does not stop being outstanding while you read the Calendar.

Moving off the brand ground onto the page meant dropping the alpha-white
literals it wore in the header; on the page there are real tokens for all of it
(`--paper`, `--line`, `--lift`, `--ivory`, `--muted`) and they flip with the
theme by themselves. That mattered more than it looked: those literals would
have been eight palettes' worth of wrong.

### Themes: a second, independent axis

`data-theme` says light or dark. `data-palette` says which family of colours
that is expressed in. Nine palettes (Forest plus the eight new swatch sets) ×
three modes, chosen in a new picker panel — a cycling button could carry three
states, it cannot carry nine palettes.

**`auto` now resolves to an explicit `data-theme` in JS** rather than removing
the attribute. This is the load-bearing change. Under the old scheme every
theme needed writing twice — a `prefers-color-scheme` copy and a
`[data-theme]` copy — with a standing comment warning the two must never drift.
Eight more palettes would have made that eighteen blocks to hold in lockstep.
Resolving in JS means each palette needs exactly one light block and one dark
block. A `matchMedia` listener keeps `auto` honest when the OS flips
mid-session. The forest media block survives as the pre-script paint.

Every palette block is `[data-palette][data-theme]` — (0,3,0) — so it outranks
both `:root` (0,1,0) and `:root[data-theme]` (0,2,0) regardless of source
order. A palette's light and dark blocks must set the **same token list**: they
are siblings of equal specificity, so light does not cascade into dark, and a
token set in one and forgotten in the other falls back to forest and shows up
as a stray charcoal in the middle of a purple theme. Verified in-browser that
all nine × two set all twenty tokens.

**`--terra*` and `--alert*` are off-limits to palettes**, as are the lane hues.
Orange means "a commitment you agreed to attend" and red means "overdue or
must-attend" across the Now bar, the day view, the activity badges and the lane
rules; a palette repainting those would trade the thing the colours are *for*
against prettiness, and on Chili spice it would make a must-attend appointment
indistinguishable from an ordinary one. Lane colour answers "whose time is
this", which is not decorative either. Asserted by test, not just by comment.

`--hdr-a` / `--hdr-b` are new: the header gradient was two hardcoded charcoals,
and a palette cannot own the app's most visible surface through a literal.

Where a swatch could not carry white text at 4.5:1 the brand is a darker draw
of the same hue and the swatch value survives as `--olive` — `#A0522D` (4.4:1),
`#AD56C4` (3.6:1), `#069494` (3.7:1). Blue eclipse and Chili spice have no
honest light form (four dark values each), so their light blocks tint toward
the palette rather than pretending to be it. Retro sunset's brand is the teal
because three of its four swatches are the endurance orange. Each case is named
in its own comment.

Audited in-browser across all eighteen combinations: fourteen contrast pairs
each, all ≥ 4.5:1. **Pre-existing failure left alone:** the default Forest light
`--forest-ink` on `--ivory` is 4.44:1, marginally under AA and untouched by
this change — the palette comment's claim that "every -ink token clears 4.5:1"
was already slightly false.

`palette` joins `theme` in `BOARD_KEYS`/`SCALARS`, so the choice syncs. It is
validated against the known list in `norm()` — the value arrives from other
devices through sync and history, and an unknown id would stamp a
`data-palette` no rule matches: a board that silently ignores your theme.

### The nickname

Two separate faults, one of which is not in this repo.

**Client (fixed here):** `GREETING` was a one-shot IIFE computed at boot from
the cached session, and nothing recomputed it. Even a *successful* save only
showed up after signing out and back in — which is exactly what "the save
didn't work" looks like. `applyGreeting()` is now re-runnable and listens for
`pdauth:userchanged`; `PDAuth.mergeUser()` (the merge `/auth/me` already
performed, exposed) writes the new nickname into the stored session, and
`umPatch()` calls it when the account you edited is your own. Fed from
`res.user`, not from what was typed, so the screen shows what the Worker
actually stored after its clamp.

The random pet name moved into `PET_FALLBACK`, drawn once per load. The old
"picked once, into a variable" rule is unchanged — it just needs its own
variable now that the thing reading it can run more than once, or any account
change would rename you.

**Server (cannot be fixed from here):** `"Nothing to change."` is thrown by the
Worker when it recognises no field in the patch. `cloud-worker/worker.js` has
handled `nickname` since `7419072`; the *deployed* Worker predates it. Workers
deploy separately from Pages — paste, Deploy, then **promote to Active** — and
there is no Node on this machine to run wrangler.

So: `/health` now returns `{ok, version}` (`WORKER_VERSION`), the app carries
`WORKER_MIN`, and User & Role Management shows a terracotta banner naming the
running version and the promote step when the Worker is behind. `umPatch()`
rewrites a bare "Nothing to change." into the same explanation as a fallback
for when `/health` cannot be reached. Terracotta rather than red on purpose: a
stale Worker is maintenance, not an emergency.

Verified: saving updates the heading and `document.title` immediately; blanking
falls back to the pet name; the pet name is stable across re-renders; the bar
renders on Calendar and Admin; chips still tick through to the card and the
header stats; picker works at desktop and 375px in both modes.

## 2026-09-08 — Delete the nudge strip; the outstanding bar moves into the header (v4.7)

**`renderNudges()` deleted in full**, along with `dismissedNudges`, `#nudges`,
every `.nudge*` rule and `@keyframes nudgeIn`. Gone with it: the sleep-window
and circadian-low advice, the school-fetch and Night Client A EOD window checks,
all-day activity announcements, `appt-soon` / `appt-now` reminders, tomorrow's
first commitment, and the stale-task count.

Three consequences are deliberate, documented at their sites, and worth naming
because each will read as a bug to a future maintainer:

1. **All-day activities no longer appear on the Board at all.** `dayBlocks()`
   excludes them (no start/end minute to lay out) and the strip was their only
   other renderer. Calendar tab only now. Noted at the exclusion in
   `dayBlocks()`, which is the line to revisit if they should come back.
2. **Nothing warns before an appointment starts.** `appt-soon` was the last
   reader of an activity's `remind` lead time; the field is still stored and
   still editable in the Calendar editor, but nothing consumes it. Noted at the
   head of `renderNow()`.
3. **The stale-task signal is unrendered.** `t.added` is still written on every
   task, so it is recoverable.

Dead code removed with the last caller: `ageOf()` (only the stale-task nudge
used it) and `dm()` (a `mins()` alias whose only callers were the time-window
nudges). `dmEnd()` is also unreferenced but was **already** dead before this
change, so it was left alone rather than widening the diff.

**The outstanding row moved from the Now bar to the header** as `#ngbar`,
occupying the exact lane the strip held — same `margin-top`/divider, same
`z-index:1`, so the header still grows to fit and collapses when empty. The Now
bar is back to answering one question: what am I in.

Shape is the Now bar's at small — coloured left rule, tiny uppercase label, the
count in `--serif` underneath. Colour is **olive, not terracotta**: orange means
"a commitment you agreed to attend" in the Now bar, the day view and the `.apt`
badges, and spending it on a promise-to-yourself would make the one loud colour
in the palette mean two things. Text stays uniform on-brand with the colour on
the rule — the contrast rule the old strip established, kept because it is what
keeps white safe on the header green.

**It does not rotate**, unlike the bar it echoes. Seeing five outstanding items
at once *is* the mechanism; a rotation would hide four fifths of the pressure at
any moment. The Now bar rotates only because one headline can hold one thing.

**Chips are buttons.** Clicking one writes through the same `day()`/`save()`
path the Non-negotiables card uses, so the bar, the card, the streak and the
RITUALS percentage can never disagree. 34px tall with an empty ring that fills
with a tick on hover — the affordance says "this completes it" without a word of
instruction.

One CSS trap worth recording: the label used `opacity:.72` with `opacity:1` on
the count inside it. `opacity` creates a group, so the child can never be
brighter than its parent and that override silently did nothing. Alpha now lives
in `color`, and the count is full `--on-brand`. Measured on the header green:
label ~4.7:1, count ~6:1, chip text ~6:1.

Verified in the browser at desktop, mobile (375px) and dark: the bar renders and
wraps, a chip click ticks through to the card and the header stats, the bar
disappears when the list is clear, weekly goals at target stay out, and the bar
is correctly hidden on the Calendar / Expenses / History tabs via `.board-only`.

## 2026-09-07 — Now bar: rotate concurrent appointments, drop Upcoming, add the outstanding row (v4.6)

**`Upcoming` / `Also now` removed.** `pendingItems()` and the whole `.nowup`
row are gone. The bar no longer looks forward at all — advance warning is the
nudge strip's job, and `appt-soon` already does it with a per-activity lead
time. Two features answering "what's next" with different rules was one too
many.

**Concurrent appointments rotate.** `nowSpans()` returns *every* running,
un-ticked appointment rather than just the one that won the headline. Order is
must-attend first, then chronological — a deliberate divergence from the day
view below, which stays purely chronological because down there you read a
sequence and up here you are told what to walk into. `Array.sort` is stable, so
equal-priority items keep their `daySpans()` order.

Rotation is **8 seconds**, driven by **one permanent `setInterval`** rather than
a timer started and cleared inside `renderNow()`. That matters: `renderNow()`
also runs on the 60s tick and on every `save()`, and a per-render timer would
restart its 8 seconds each time, so a busy minute could stall the rotation
indefinitely. The ticker owns the clock; `renderNow()` only reads the index.

Rotation state (`nowRotIdx`, `nowRotKey`, `nowRotPin`) is module-level so it
survives `renderAll()`. It is keyed by the **set of `id@start` pairs**, not the
count — ticking one appointment off must reset the index and the pin, because
"hold the second one" stops meaning anything once the list changes underneath
it. Same class of bug as a nudge dismissal keyed by array index.

**Dots are the pause control.** Rendered only at 2+ items (a lone dot controls
nothing). Clicking the active dot toggles the hold; clicking another jumps *and*
holds, because you only reach for a dot when the rotation took away what you
were reading. This is what satisfies WCAG 2.2.2 on a headline that changes
itself on a timer.

The button is **20px with an 8px `::after`**, not an 8px button with a
transparent `box-shadow` ring — `box-shadow` paints, it does not extend the hit
area. Size the element, shrink the paint. Negative margin cancels the padding so
adding dots doesn't move the label row.

**New second row: what you still owe today.** Same slot the Upcoming line used,
opposite tense. `pendingRituals()` filters the live `S.rituals` — the same list
the card below renders, so there is no second store — dropping anything ticked
today and any goal whose `weeklyCount()` has already met its `target`. A 2×/week
goal therefore stops nagging on days it isn't behind. Shows a count plus a chip
per item: **`r.l` only, never `r.tag`** — the subject, not the note under it.

Deliberately **not** orange. Orange means "a commitment you agreed to attend"
across the timeline, the nudges and the headline band; a non-negotiable is a
promise to yourself. It takes the sage/ivory treatment the old neutral Upcoming
row used, so the two can never be confused at a glance.

`dfDebug.nowSpans()` and `dfDebug.pendingRituals()` expose both lists.

Verified in the browser at desktop, mobile (375px, coarse pointer) and dark:
three overlapping appointments rotate and reorder correctly, ticking one resets
the pin and index, one appointment shows no dots, zero appointments falls back
to the routine block, and a met weekly target drops out of the row across a
reload.

## 2026-09-07 — Editable lane notes; drop the stale manifest description (v4.5.2)

**Lane notes.** The caption under each lane name (`L.ritual`) is now editable in
place: click it, Enter or blur commits, Escape cancels. Clearing it removes the
line, and an empty lane shows a faint `+ add a note` in its place so removal
stays reversible — the same reasoning as the hidden-blocks drawer under the day
list.

Mirrors the existing rename idiom rather than inventing a second one:
`laneNoteId`/`laneNoteDraft` alongside `laneRenamingId`/`laneRenamingDraft`, kept
separate so neither editor cancels the other. `role="button"` comes with a real
Enter/Space handler, and the coarse-pointer rule grows the tap target with
padding cancelled by an equal negative margin, so the line doesn't move.

Unlike `commitRename()`, `commitNote()` has **no** `if(value)` guard — empty is a
legitimate value here, it's how you delete the line. The key is `delete`d rather
than set to `""`, and `norm()` folds any empty string away, because `diffOps()`
compares by `JSON.stringify` and two boards that agreed the note was gone would
otherwise look permanently different.

**manifest.json:** `description` removed. It read "Personal shift, task and habit
tracker for the 2pm-7am schedule" — untrue since v4.5 took the shift model out.
Dropped rather than rewritten, as asked.

`"id": "./dayflow.html"` is deliberately left alone. It points at a file that no
longer exists, but `id` is only the install identity string — changing it makes
the phone treat ProDash as a different app and install a second icon.

## 2026-09-07 — Remove the inline quick-add appointment form (v4.5.1)

The `+ Appointment` button shipped in v4.5 made the form under the day list
redundant, so the form is gone. Removed: the `.apt-add` markup (`aptN`, `aptD`,
`aptS`, `aptE`, `aptL`, `aptM`, `aptBtn`), `addApt()` and its two listeners,
`renderAptLaneOptions()` and its call in `renderAll()`, the `aptD` boot default,
and the `.apt-add`/`.apt-row`/`.apt-dash`/`.apt-must`/`#aptBtn` rules plus the
mobile touch-target rule that sized its checkbox.

`.nudge.apt-must` is a **different** class — the must-attend notification tier —
and stays.

Adding an appointment from the Board is now the same single `openActivity()`
call the Calendar tab makes: one creation path, one store, and the repeat /
category / reminder / notes fields the small form never had.

## 2026-09-07 — "What does my day look like?", and the end of the 07:00 roll (v4.5)

The Shift timeline is renamed, and the shift model underneath it is gone. A day
in ProDash is now an ordinary calendar day, 12:00am to 11:59pm.

### The rename

`Shift timeline` → **What does my day look like?**, plus every visible string
that leaned on the old model: the header now reads `Monday, September 7 ·
12:00am → 11:59pm`, `Last 7 shifts` is `Last 7 days`, `Reset this shift` is
`Reset today`, and the stale-task nudge counts days. Version-history entries are
left as written — they are a record of what happened, not documentation.

### The time model

`rollM()`, `rollHHMM()` and `rollRange()` are deleted. `sm()/smEnd()/nowSm()`
(minutes from the 07:00 roll) are replaced by `dm()/dmEnd()/nowDm()` (minutes
past midnight). The rename is deliberate: any code still written against the old
model now fails loudly instead of being silently 420 minutes out.

`S.roll` is no longer normalised or read. It stays in `BOARD_KEYS`/`SCALARS` so
an older board still round-trips through sync and history without every revision
showing a phantom change — the same treatment the removed `focus` key got.

**The one behavioural cost, stated plainly:** work done between midnight and 7am
now files on the date it happens rather than on the previous day. A night that
used to sit under one date now spans two, and the day's checkmarks reset at
midnight. Nothing already stored was rewritten.

### Midnight, handled properly

New `spanOf()` / `daySpans()`. A span resolves one occurrence to real minute
coordinates on the day in view: `st` goes negative when it started yesterday,
`en` goes past 1440 when it runs into tomorrow. Every status question is now
answered by comparing `nowDm()` against those two numbers, so no caller reasons
about midnight itself.

That fixes the long-standing bug where a block crossing the day boundary was
drawn as `past` all day long, and it adds carry-over rows: something still
running from last night leads the list marked *from yesterday*, and something
running past midnight is marked *into tomorrow*.

`dual2`, `nbwriteup` and `naeod` moved from `WD` (Mon–Fri) to the new `WDN`
(Tue–Sat). They start after midnight, so they belong to the morning *after* the
weekday they were worked. Tagged `WD` under a 7am roll they were correct;
carried over unchanged they would have put an orphan 2:30am block on Monday and
left Saturday morning empty. `BLOCKS` and its weekday filter are otherwise
untouched.

Time-of-day nudges gained explicit end times. "Past 4:15pm" used to expire when
the day rolled at 7am; on a midnight day it would have reappeared at 00:00 and
sat there. Same lesson the company-hour nudge taught in v4.3.1.

### Appointments, from the day view

- **+ Appointment** in the card header opens the Personal Calendar's own
  activity editor (`openActivity`), not a second form.
- **Tapping any appointment row** opens it for editing or deleting. One editor,
  one store, whichever screen you started from.
- The quick-add row underneath is kept, and now writes the full activity shape
  (category, reminder, `done`/`ex` maps) so a quick-added appointment is not a
  lesser record.
- Ticking an activity done in the Calendar now shows on the Board as `done` with
  a strikethrough, and it stops claiming to be "Happening now".

### Now bar

The orange runs the full width of the bar (`.16 → .07`) with a 3px rail, rather
than fading out at 62%. The second row is labelled **Upcoming**, gets the same
full-width treatment, and now falls back to the next routine block when nothing
is booked — orange still means "a commitment", so a routine block gets the row
without the wash.

### Fixed in passing

`.apt` was both the badge class and the nudge tier class, so every appointment
reminder inherited the badge's `text-transform:uppercase` and had been shouting
`DENTIST IS HAPPENING NOW` while every other nudge spoke normally. Scoped to
`span.apt`.


## 2026-09-07 — The Now bar carries appointments: Happening now / Up next (v4.4)

A **Board** change, in the `.nowbar` strip above the view switcher. The
Calendar tab's own rendering is untouched — the calendar is only where the
data comes from.

### What was actually missing

Two different gaps, and only one of them was a rendering problem.

**Ongoing already worked, but didn't look like anything.** `currentBlock()`
has always preferred an appointment over the routine block it sits inside, so
the bar was naming the right thing — it just gave "Chase: Sunday School" and
"Wake + prep" identical weight.

**Upcoming was missing outright.** The only warning about a commitment that
hadn't started was the `appt-soon` nudge, which is capped by that activity's
own lead time — 120 minutes by default, and `0` means never. Anything further
out than that was invisible on the Board.

### What it does now

- **Happening now** — when `currentBlock()` returns an appointment, `.nowbar`
  gains `.ev` and takes `rgba(251,140,0,.14)`, the same transparent orange
  `.blk.ev` already puts on appointments in the Shift timeline. Deliberately
  the same rgba, so a commitment doesn't get two dialects of orange. The title
  goes `--terra-ink` and picks up the existing `.apt` badge.
- **Up next** — a second row (`.nowup`, `flex-basis:100%` so it drops onto its
  own line inside the wrapping bar) showing the next pending activity: name,
  its time range, and a countdown. It flips to **Also now** with time
  remaining once that one starts, which is what covers two overlapping
  activities — the headline holds one, and the other would otherwise vanish.
- **Must attend** is *marked*, not promoted. Ordering stays chronological,
  because a calendar is a sequence and floating a 4pm must-attend above a 9am
  one would misstate what happens next.
- `+N more this shift` when others follow.

### Dropping off

An activity leaves on its own: `pendingAppts()` filters `n >= smEnd(b.e)`, and
the existing 60-second tick already calls `renderNow()`. Ticked-off activities
are filtered via `isDone()`, matching what the nudges do.

### Two bugs caught while testing, both real

1. **`hidden` did nothing.** `.nowup{display:flex}` overrides the UA
   `[hidden]{display:none}` rule, so on a day with no appointments the row kept
   its box and its orange wash while holding no text. Fixed with an explicit
   `.nowup[hidden]{display:none}`.
2. **Roll-crossing activities were swallowed.** Something running 6:46–7:31am
   has an end minute *smaller* than its start, because `sm()` measures from the
   07:00 roll and wraps there — so `n >= smEnd(b.e)` read it as long over and
   dropped it entirely. `apptSpan()` now tests for the wrap explicitly, and a
   started one measures its remaining time the long way round.

   Note this is a **pre-existing** limitation of the shift model, not something
   introduced here: `renderTimeline()` draws such a block as `.past` all day
   and `currentBlock()` never matches it. Only the new row handles it. Fixing
   `sm()` properly is a larger job.

### Deliberately excluded

All-day activities. They have no start to count down to and no end to pass, so
there is no upcoming → ongoing → over transition to show. They keep announcing
themselves in the nudge strip, which is the right shape for them.

### Contrast

The must-attend badge first used `background:var(--alert-ink)` with white text
— correct in light (5.6:1) but wrong in dark, where `--alert-ink` flips to
`#EF9A9A`, a light red meant to *be* text; white on it is ~1.9:1. It now uses
the `--alert-lt` / `--alert-ink` pair, exactly as `.cal-tag.must` does, because
those two tokens flip together and stay legible in both themes.

### Version

`APP_VERSION` 4.3.1 → 4.4, `CACHE_VERSION` `prodash-v7` → `prodash-v8`.

## 2026-09-07 — Removed the "company-hour" nudge (v4.3.1)

David flagged this as a bug, and it was one. The rule in `renderNudges()` was:

```js
if(n>sm("14:00")&&!l.biz)
  out.push(["","company-hour","<b>Your company didn't get its hour.</b> …"]);
```

`n` is minutes since the 07:00 roll and `sm("14:00")` is 420, so the condition
reads "any time after 2pm" — with **no upper bound**. Once the shift crossed
2pm the banner stayed up for the remaining seventeen hours, which is why it was
still on screen at 5:43am insisting that "Once Day Client starts it's gone"
about a Day Client block that had ended the previous afternoon. The copy is
written for the minutes around 2pm; the condition kept it alive all night.

Both lines are removed, replaced by a comment recording the failure mode so the
rule doesn't get re-added without an end time.

**Not touched:** the `biz` non-negotiable ("My company — 30 min") is still in
`DEFAULT_RITUALS` and still counts toward the Rituals percentage and the
streak. Only its nudge is gone.

**Same shape elsewhere:** `school-fetch` (16:15) and `nighta-eod` (06:30) are
written identically — no upper bound — so they also persist to the end of the
shift. Left as they are; both are arguably still actionable late, and neither
was reported. Worth a bounded window if they start reading as noise too.

### Version

`APP_VERSION` 4.3 → 4.3.1, `CACHE_VERSION` `prodash-v6` → `prodash-v7`.

## 2026-09-07 — Removed the shift progress bar and the editable roll time (v4.3)

Two removals, both requested by David. Neither changes any stored data.

### 1. The header progress bar is gone

The `.daybar` strip under the nudges — a green fill across the header footer
with "1h 9m until 7am" on the left and "95% through the shift" on the right.
It measured the clock rather than the work, so it read as pressure without
information: at 5am it always said 95%, whatever the state of the board.

Removed in three places:

- the `.daybar` / `.daybar-track` / `.daybar-fill` / `.daybar-lbl` rules in the
  `<style>` block
- the `<div class="daybar">` markup at the foot of `<header>`
- the last five lines of `renderHeader()`, which computed `pc`, `left`, and
  wrote `#dayFill`, `#dayPct` and `#dayLeft`

`nowSm()` stays — it is the shift-relative clock that the Now bar, the nudges
and the timeline all read. Only its use in the header went.

### 2. The shift start time is no longer editable

The `7:00am → 7:00am` chip on the Shift timeline header opened a `<input
type="time">` that wrote `S.roll` and re-rendered everything downstream. The
chip, its time picker and `editRoll()` are all removed, along with the
`.roll-edit` CSS and the click listener on `#rollBtn`.

**What deliberately stayed:**

- `S.roll` itself, and `rollM()` reading it with a 420 (07:00) fallback. The
  roll time is still the boundary of every logical day; it is just fixed now.
  Nothing forces `S.roll` back to 420, so a stored value keeps working rather
  than silently moving anyone's day boundary as a side effect of this change.
- `rollRange()`, which the header date line still uses
  (`… shift · 7:00am → 7:00am`).
- `renderRoll()` and the `#rollSub` caption under the timeline heading, slimmed
  to write the caption only. It is still *generated* from `rollM()` rather than
  hardcoded, so it cannot claim 7:00am while the app runs on something else.

Only the Shift timeline card's **header controls** were removed. The routine
block schedule, the Hidden-from-your-schedule restore list and the appointment
adder are all untouched.

### Version

`APP_VERSION` 4.2 → 4.3, `CACHE_VERSION` `prodash-v5` → `prodash-v6`.


## 2026-09-07 — Navigation hierarchy: Reports under Board, Subscriptions under Expenses (v4.2)

Seven main tabs became four. Reports and Subscriptions did not go away — they
moved **down a level**, each into the tab whose data it was already made of.

### Reports is a Board sub-view

`#view-reports` reads `S.tasks` and `S.lanes` and nothing else. "The lanes as
columns", "the lanes as one checklist" and "the lanes counted up over a date
range" are three views of one dataset, so they now share one switcher: the
Board's pennant strip gained a third tab, **Reports**, beside Classic view and
Consolidated checklist.

Mechanically that meant `#view-reports` becoming `.board-only` and its `hidden`
attribute changing owner — from `setView()` to `setBoardView()`, which now
drives three panes instead of two:

```js
document.getElementById("boardCols").hidden   = (v!=="classic");
document.getElementById("checklist").hidden   = (v!=="checklist");
document.getElementById("view-reports").hidden= (v!=="reports");
```

`body.view-reports` is gone, and so is the `if(document.body.classList
.contains("view-reports"))renderReportsView()` line in `renderAll()` —
`setBoardView()` re-renders whichever pane is showing, so Reports stays live
while you tick tasks off in another window.

**The bug this shipped with, and the fix.** `norm()` had its own copy of the
valid sub-view list:

```js
if(["classic","checklist"].indexOf(s.boardView)<0)s.boardView="classic";
```

`setBoardView()` accepted `"reports"`, saved it, and `norm()` silently rewrote
it back on the next load — the Board reopened on Classic every time. Both now
read one `BOARD_VIEWS` map, declared beside `NOTE_MAX` at the top of the script
for the same hoisting reason: `norm()` runs during `var S = load()`, so a `var`
declared beside `setBoardView()` would still be `undefined` there, and an
`undefined` lookup would send *every* board to Classic.

### Subscriptions is an Expense Tracker section

A subscription is a rule that produces ordinary expense rows in the same array;
it has always ridden on the same `exp` capability. It was originally its own tab
on the argument that the two are used at different rhythms — expenses many times
a day, subscriptions set up once and left alone. That is a reason to make
something a second *stop*, not a second *place*.

`#view-subs` moved inside `#view-exp`, alongside a new `#exp-pane-tracker`
wrapper, switched by `setExpNav()`. That state is a plain `var expNav`, not part
of `S`: the Board reopens where you left it because you live in one layout for
weeks, whereas reopening the app onto the subscription form instead of today's
spending would be wrong every time.

### One idiom for a nested section

The Board's pennant CSS was scoped under `.bview`. It is now `.pnav` and shared
by both switchers, so the app has one look for "which part of this tab am I in"
rather than a second one invented per tab. `.bview` survives as the Board's own
hook and carries no styling. Both groups gained `role="tablist"` /
`aria-selected`, kept in step by their set functions.

### The active tab now says so in colour

Three layered cues on `.tabbar .tab.on`, replacing "it is the pale one":

* a **4px `--olive` cap** along the top edge — a `border-top`, not a pseudo-
  element, so it follows the 12px corner radius and cannot escape the tab's
  silhouette. `--olive`, not `--forest`, because it has to read as green on
  both `--panel` values (`#E4E9EB` light, `#141B1E` dark) and `--forest`
  vanishes into the dark one;
* a **green wash that fades out by 62%**, so the bottom of the tab is still
  exactly `--panel` — the seamless join with the sheet below is the whole
  illusion and tinting through it would break it;
* the label at **weight 800** against the inactive tabs' 600.

The label stays `--ink`. `--forest-ink` on `--panel` is 4.2:1 and this text is
12.5px, so a green label would have been the one part of this change that failed
AA — colour carries the emphasis, the neutral carries the words. The pennants
and the pill sub-tabs were already brand-green when active, so the same rule now
reads top to bottom.

Fixed in passing: the phone-width `.tab.on{padding-top:10px}` rule was `(0,2,0)`
against a `(0,3,0)` desktop rule and had never applied. A media query does not
change specificity.

### Access control follows the move

`CAP_TABS` now points two capabilities at sub-tabs rather than main tabs. `exp`
no longer lists a second tab for Subscriptions; `reports` points at the Reports
pennant. An account granted `reports` without `board` is let through the Board
tab — it is the only door to the screen it was granted — and then sees only
Reports, stated as one CSS rule:

```css
body.reports-only .board-only:not(.bview):not(#view-reports){display:none}
```

`setBoardView()` refuses any other sub-view for that account even if one were
clicked, and the two other pennants are hidden. Same shape as the existing
`history.appver` case, one level down.

### Unchanged

Every Reports filter, the Current Day Report and its Excel export, every
subscription rule, its filed charges and its effect on the weekly/monthly/yearly
totals, the breakdown and the twelve-month trend. Nothing to re-enter and no
migration: `boardView` is the only synced value that changed meaning, and an
unknown one falls back to Classic in both directions, so a device on the old
build and a device on this one can sync to each other without either losing its
place.

Also added: a version-history line for v4.1 (sub-notes), which shipped without
one.


## 2026-09-06 — Sub-notes on tasks (v4.1)

A task on the Board can now carry notes. Every task row grew one quiet speech
bubble; tap it and a drawer opens underneath the task holding as many notes as
you want, each with its own edit and delete. Collapsed, the bubble turns green
and shows a count, so you can see which tasks have detail behind them without
opening anything.

This exists because of rows like *"Scheduling Project: Check each roles
permissions first before moving to the next."* — a heading with the detail
crammed into the title, because there was nowhere else to put it. The follow-up
(the doc link, the answer someone gave you, the three sub-steps) either became
another top-level task, inflating the lane's open count, or it lived outside the
app entirely.

### Notes live on the task object

```js
t.notes = [ {id:"note_…", text:"…", at:1757…, ed:1757…} ]
```

That one decision does most of the work. `tasks` is already in `BOARD_KEYS` and
`KEYED`, and `diffOps()` compares keyed items with `JSON.stringify`, so notes
sync to the Worker and the OneDrive file and enter Board History with **no
registry change at all**. They ride along automatically when a task changes
lane, gets ticked, sorts to the bottom, or falls into the checklist's
"Unassigned" section — there is nothing to keep in step. `deleteTask()` filters
the task out and the notes go with it, so nothing can orphan.

`norm()` defends the new key the way it defends every other one: a board saved
before this feature has no `notes` at all, a junk value is dropped, malformed
entries are filtered, and a task with no notes keeps **no empty array** — an
absent key and an empty one must not look like different objects to `diffOps()`.

### Whether a drawer is open is not board data

`noteOpen`, `noteDraft` and `noteEdit` sit in module scope, outside `S`. Your
phone does not need to know which drawer is open on the laptop. That is also
what lets them survive the `renderLanes()` rebuild that every save and the
60-second tick trigger — the same reason `laneRenamingId` and `laneDraft` exist.

**Not `<details>`.** Its `toggle` event fires asynchronously, and this app
already paid for that once: the comment in `renderHiddenBlocks()` records
ticking a task re-rendering from a stale flag and springing the drawer back
open. With one `<details>` per task that would happen to every row at once.

The composer restores its text, its focus **and its caret position** after a
rebuild. Without the caret restore, the minute tick lands mid-sentence and drops
you back at the start of your own note. `laneDraft` gets away without this
because a lane name is one short line; a note is not.

### The panel is inside the task, not beside it

`.tsk` gained `flex-wrap:wrap` and the notes panel is a full-width child of the
task row itself. No wrapper element — a wrapper would have changed what
`.tsk:last-of-type`, the drag handlers and `closest(".tsk")` all match. This way
the notes are grouped with their task by construction rather than by agreement
between two siblings, and `e.target.closest(".tsk")` still resolves correctly
from inside the panel. The checklist uses the same trick on `.chk-row`.

Note actions are dispatched from a `data-nact` branch that runs **before** the
existing `data-act` line, because that line reads the attribute off `e.target`
directly rather than via `closest()` (a button containing an `<svg>` would never
have dispatched), and because the `save(); renderAll();` after it is
unconditional — which must not fire for merely opening a drawer.

### Links, and nothing else

Notes keep their line breaks and turn `http(s)://` and bare `www.` runs into
real links. That is the whole formatting story — no markdown, no rich text.

The body is built from **DOM nodes** — text nodes for prose, `<a>` elements for
links — and never assigns `innerHTML`. `esc()` would have been safe enough, but
this is the position already stated at the greeting: the strongest guarantee is
the one that never parses the string as markup at all, and a note body is the
one place in this app that renders a URL pasted in from somewhere else. Only
`http(s)` and `www.` match, so `javascript:` and `data:` can never become an
href. Trailing sentence punctuation is trimmed back off, along with an
unbalanced closing bracket, so `see https://x.dev/a).` links the URL and leaves
the `).` as prose — while a balanced Wikipedia `..._(disambiguation)` stays whole.

Deleting a note asks first, unlike deleting a task. A note holds far more typing
than a one-line task and lives in a drawer that is shut most of the time, so a
stray tap is both easier to make and more expensive. The confirm quotes the
first line back, so it says *which* note.

### Both Board layouts, one set of classes

Full add/edit/delete in the lane columns **and** in the Consolidated Checklist,
sharing `noteOpen` — a task expanded in one is expanded in the other. On the
ruled page the notes are re-tuned to the notebook's rhythm: every height and
line-height a whole multiple of `var(--rl)`, no vertical margins, and a textarea
with no chrome at all, so a note is simply written on the next line in the same
serif hand, one size down. Three bugs came out of holding that line — a
textarea's inline-block baseline reserving 5px of descender space, a
`flex-basis:100%` panel overflowing by exactly its own left margin, and the
`pointer: coarse` block's negative side margins pulling ✎ and × nine pixels into
each other so "edit" could delete.

### Board History stopped guessing

An update to a task used to mean one thing only — the box was ticked — so
`opText()` assumed it. Sub-notes made that assumption wrong, and *"Reopened
task"* is a bad thing for the history to say about someone pasting a link into a
note. `diffOps()` now records `ch`, the **names** of the fields that actually
moved (names only: storing the whole previous object would roughly double the
size of every task edit in a document that syncs over mobile data). Revisions
written before `ch` existed have none and fall through to the old wording, which
was correct for them.

### Not touched

Reports and the XLSX export read `t.text` and still do. Worth revisiting; not
part of adding notes to the Board.


## 2026-09-06 — App Widgets: World Clocks and Bible (v4.0)

A **Widgets** button in the header opens a dock that floats over whatever tab is
open. Two widgets ship in it: multiple time zones, and a Bible reader.

**It is a dock, not an eighth tab, and not a modal.** The entire point is to
check a clock or a verse *without* leaving what you were doing, so at its normal
size it draws no backdrop and the board underneath stays clickable. Only the
expanded size dims the page, because at that size it has taken over the screen
anyway. It never calls `setView()`, never touches the `view-*` body classes and
never reads the tab strip — opening a widget cannot cost you your place.

The dock markup is a sibling of `#profModal`, deliberately **outside**
`.viewpanel`. The comment at the top of the stylesheet explains why: a
transform, filter or `contain` on `.viewpanel` traps a `position:fixed`
descendant inside it. That is a trap this file has fallen into before.

### The registry is the feature list

```js
var WG_LIST=[
  {id:"clocks",name:"World Clocks",mount:wcMount,unmount:wcUnmount},
  {id:"bible", name:"Bible",       mount:bbMount, unmount:bbUnmount}
];
```

Chips, panel routing and lifecycle all read from this array and nothing else
enumerates widgets, so a third one is a `<section class="wg-panel">` plus one
entry. `wgShow()` always unmounts the outgoing widget before mounting the next,
which is what stops the clock's one-second interval from surviving a switch to
the Bible and ticking against a panel nobody is looking at.

### World Clocks

Up to four zones, plus **your own time pinned at the top** — tinted, badged
`Local`, not removable, and not counted against the four. It is the anchor every
other row is read against, so it should be findable without reading.

**No time zone database ships with this.** `Intl` has the whole IANA set built
into the browser, so the widget costs no bytes and no network and gets DST right
for free. Offsets are derived by formatting the same instant in two zones and
diffing the readings, rather than by keeping a table this file would then have
to maintain. Each row carries the time, the date, the offset, and — only when
the calendar date differs from yours — a `Tomorrow` or `Yesterday` chip in the
attention colour. When your shifts run 2PM–7AM, "it is already tomorrow there"
is the fact that actually bites.

**Reordering is arrow buttons, not drag.** For four items with a phone as a
first-class target, `↑`/`↓` are reliable; HTML5 drag on a touchscreen is not.

**The tick does not rebuild the list.** `wcRender()` rewrites the rows only when
the list itself changes; `wcTick()` writes just the text that moved. Rebuilding
`innerHTML` every second destroys the focus ring, which would take the Move-up
button out from under a keyboard user's finger once a second. It falls back to a
full rebuild only when the row count drifts or a day-difference chip has to
appear, which is at most once a day per zone.

### Bible

King James and New King James, from **bolls.life** — free, no key, no account,
CORS-open, and it carries both translations plus real full-text search. Their
API docs ask explicitly that `get-chapter` not be used to pull whole
translations, so this fetches **one chapter on demand** and caches it. No
prefetching, no background warming.

**The 66-book table is hardcoded rather than fetched.** It is about 2KB, both
translations share the same canon and chapter counts, and it means book and
chapter browsing work with **no network at all** — only the verse text needs
one. Their own books endpoint is a 1MB JSON file; that would have been the lazy
choice and a worse one.

**Verse text is sanitised, not trusted.** It arrives as HTML. KJV carries inline
Strong's numbers (`<S>3778</S>`) and translators' marginal notes in `<sup>` —
John 1:5 ends `<sup>comprehended: or, did not admit, or, receive</sup>`, which
splices straight into the sentence and reads as if it were scripture if you strip
only the tags. Both are dropped **with their contents**; everything else is
stripped and re-escaped through the existing `esc()`, so nothing the API sends
can become live markup. `<mark>` is the single exception, carried across the
escape on a placeholder because it is how search shows what it matched.

**Search takes a phrase or a reference.** `faith without works` returns ranked
verses with the match highlighted; `John 3:16`, `1 cor 13`, `ps 23`, `1jn 4:8`
offer a *Go to* row instead of making you read results to find a place you
already named. Results past book 66 are dropped — the index also covers
apocryphal books, which are in neither translation as presented here.

**Offline is a first-class path, not an error case.** Chapters already read
render from cache; an unread one says so plainly and honestly; search says it
needs a connection; and all 66 books stay browsable regardless. Nothing throws,
nothing blocks a render, nothing signs anyone out.

### Details that would have been bugs

- **The chapter text never enters `S`.** It is per-device cache under its own
  unnamespaced key — scripture is not the user's data, and pushing megabytes of
  it through the sync document on mobile data would be indefensible. The cache
  is LRU-capped at 80 chapters, and a quota failure **drops the whole cache**
  rather than fighting the board for room. The board is the user's data; this is
  a copy of a public text a network call can always fetch again.

- **Escape runs on the capture phase.** The modals register their Escape
  handlers earlier in the file, so in the bubble phase they run first and have
  already set `hidden=true` by the time a guard could look — which let one press
  close the modal *and* the dock behind it. Capture means the guard sees the
  modal while it is still open. Escape now steps back exactly one level:
  expanded → docked → closed.

- **Async stage writes take a ticket.** Submitting a search and then clicking its
  *Go to* row raced: the slower search response landed after the chapter and
  replaced it with the list you had already moved on from. A `busy` flag would
  have blocked the navigation instead — trading a wrong render for a dead click.
  A sequence token lets the newest action win, which is what the user meant.

- **`WC_MAX` is declared above `norm()`**, not with the widget code. `norm()`
  clamps `s.zones` against it and runs at `load()`; a `var` further down would
  hoist as `undefined` and the clamp would quietly never fire.

- **The header row now wraps on phones.** It was already about 28px past the
  header's inner width before Widgets joined it — `header` has `overflow:hidden`,
  so *Sign out* was being silently clipped rather than wrapping. `flex-shrink:0`
  on `.hdr-user` is right on a desktop where the row fits; below 620px the group
  now wraps, and the Widgets button drops its label to an icon.

### Sync

`zones` joins `KEYED` — two devices that each add a zone while offline keep
both, rather than one silently winning. `bibleVer`, `bibleAt`, `bibleSize` and
`wgLast` join `SCALARS`, where last-write-wins is the right rule for "which
translation, how big, where I stopped reading". `adopt()` normalises the remote
document first, so a board saved before this release defaults the new keys
instead of tripping over their absence.


## 2026-09-06 — Recurring Subscriptions (v3.9)

A new tab for things billed on a schedule. Add a service with an amount, a
frequency and a billing date; from then on it files its own expense each time it
comes due.

**A subscription is a rule; what it produces are ordinary transactions.** They
go into the same `S.expenses` array with the same shape and the same id space,
so every existing total, breakdown, trend, search, filter and CSV export counts
them with **no change to any of those functions**. That is the whole
integration: there is no second set of numbers to keep in step, because there is
no second set. The only thing marking a generated row is a `sub` field carrying
the rule's id, which the transaction list shows as a small green tag.

### Two properties do the real work

**The expense id is derived, not random:** `exps_<subId>_<period>`, where the
period is `2026-09` for a monthly and `2026` for a yearly. Two devices that both
notice September's charge is due generate the *same* id, and the existing
union-by-id merge collapses them into one row. A "have I already added this?"
scan would pass on both devices while they were offline and produce two charges
the moment they synced. Deriving the id makes the duplicate impossible rather
than unlikely — which is what "count each charge once only" has to mean in an
app that syncs.

**Generation is a pure catch-up**, not a scheduled job: every billing date from
the anchor up to today that is not already on the books. Nothing records "last
run", so opening the app after three months away files the three charges that
happened, and opening it twice in a minute files nothing the second time. There
is no state that can drift.

### Details that would have been bugs

- **Month-end clamping.** A subscription anchored on the 31st still bills in
  February, and a 29 February yearly bills on the 28th in ordinary years. Without
  it those charges would silently never fire, and a *missing* expense is the
  failure nobody notices.
- **Deleting a generated charge sticks.** Because the id is derived, simply
  removing the row would let the next catch-up recreate it — the app arguing
  with you. Deleted ids go into a `subSkip` list, merged as a union so a deletion
  made on one device is not undone by a device that never saw it.
- **Editing the amount does not rewrite history.** Charges already filed are what
  you actually paid; the new price applies from the next one.
- **Pausing keeps the history** and stops future filing. Resuming catches up what
  was missed, which matches what actually happened to the bill.

### Access

Subscriptions rides on the existing `exp` capability rather than getting one of
its own — if you can see the Expense Tracker you can see what feeds it. That
made `CAP_TABS` values lists instead of single ids, and avoided a Worker deploy
to add one string to three role defaults for a screen nobody would want
separately.

### Verified

Date maths: 31st-anchor clamping across six months, leap-day yearlies across
2024–2028, unique period keys over 80 monthly occurrences, every occurrence date
inside the month its key names, future anchors filing nothing, an anchor of today
filing exactly one.

End to end in a browser against the real UI: a monthly anchored two months back
filed exactly three charges and a yearly filed one; overview showed ₱649/month
and ₱7,788/year from ₱549 monthly plus ₱1,200 yearly; the Expense Tracker's
Today, This week, September, 2026 and All time totals and all four breakdown
scopes picked them up with correct categories. Ten tab switches filed nothing
extra. Pausing kept four rows and stopped filing. A deleted charge survived three
further catch-ups and a resume without returning. Editing ₱549 to ₱699 left both
filed charges at ₱549.

Contrast measured on every new text pair in both themes: lowest 4.56:1, nothing
fails AA. No horizontal overflow at 375px.

### One thing to know

Backdating is real. Setting a billing date years in the past files every charge
since — a 2020 monthly anchor produces 80 transactions and changes historical
totals. The form says so above the fields. The date defaults to today, so the
ordinary path creates nothing retroactive.

## 2026-09-06 — Nicknames in the greeting (v3.8)

The heading and the browser tab now read "How's our &lt;you&gt; looking?", where
&lt;you&gt; is a nickname set at signup or by a Super Admin — and, when nobody has
set one, a pet name picked fresh on every page load from fourteen: Honey, Hon,
Sweetheart, Darling, Honeybun, Pumpkin, Cupcake, Goofball, Stinker, Silly Goose,
Giggles, Butterfingers, Grumpy, Nutty.

**`first_name` is deliberately not in the fallback chain.** Someone who set no
nickname gets something silly, not their registration form read back at them.

**Schema:** `nickname` at column **V**, `COL_COUNT` 21 → 22. Every range derives
from `COL_COUNT` via `colLetter()`, so `LAST_COL` follows to "V" on its own —
which is the whole point of the change that made those ranges derived rather
than three independent literals. `readUsers()` already pads short rows to full
width, so index 21 exists as `""` on every pre-existing account without any
extra handling.

**The clamp lives on the server**, not on the form. `/auth/signup` is public and
unauthenticated, so a `maxlength` there is decoration — one `curl` bypasses it.
`cleanNickname()` takes strings only (a JSON body carrying an object would
otherwise stringify into someone's greeting as "[object Object]"), turns control
characters into spaces so a nickname cannot smuggle line breaks into the sheet
or the heading, trims, cuts to 24, and trims again so a cut landing mid-space
leaves nothing trailing. `/admin/user` uses the same function, so the two entry
points cannot drift apart. Verified against 16 inputs including newlines, nulls,
DEL, over-length, emoji and markup: nothing exceeds 24, no control character
survives, everything comes back trimmed.

**`nick` rides in the session token.** Display-only is exactly why it can:
nothing keys off it and no permission consults it, so a stale one is a wrong
word in a heading rather than access. In the token, the greeting renders at boot
with no network call — which is what `file://` use and the 30-day offline grace
need. It is in `publicUser()` too, for the same reason `caps` had to be: the
browser draws from that stored object.

The cost, stated plainly: **a nickname a Super Admin sets lands on that person's
next sign-in.** Changing it deliberately does *not* bump the session epoch —
signing someone out of every device because a word in their heading changed is
the worse trade. The People panel reads the sheet, so the admin sees their own
edit immediately.

**No self-service profile endpoint yet.** That is new authenticated surface and
can wait until auth has settled. In the meantime the People panel is not
disabled on your own row for this field — the Worker's self-guard covers role
and status only, so it is how a Super Admin sets their own.

### The part most likely to have gone wrong

The pick is made **once per page load**, into a module-level variable that both
the heading and `document.title` read. A pick inside a render function would
rename the user every minute: `renderHeader()` runs on a 60-second timer for the
progress bar and the "1h 5m until 7am" line. It does not touch the heading
today, and the variable means it still could not cause flicker if anyone moved
it there. Verified statically: one assignment, one read feeding both, and zero
references to the heading inside `renderHeader()`.

Not persisted — "a different one every refresh" is what a variable already does.
Re-picking on sign-in needs no hook: `enter()` and `signOut()` both call
`location.reload()`, so the script is re-evaluated.

`Math.random` is correct here and commented as such, in both directions: nothing
is guarded by which name comes up, and this is not a precedent for the
temporary-password generator, which uses `crypto.getRandomValues` for reasons
that do not apply to decoration. With 14 names roughly one refresh in 14 repeats
the previous one; that is left alone rather than coded around. Distribution
checked over 14,000 draws — 952 to 1034 against an expected 1000.

### Where escaping is a real boundary

The heading uses `textContent`, which never parses the string as markup at all —
stronger than escaping it. `document.title` is a plain assignment from the same
variable.

The People panel is the one place one person's nickname renders in *someone
else's* browser, inside an HTML attribute, so that is where `esc()` matters
rather than being tidiness. Tested with `"><img src=x onerror=alert(1)>` as a
nickname: zero elements injected, and the value round-trips through the input
unchanged.

The auth gate's `.ag-brand` heading stays hardcoded. Nobody is signed in there,
so it cannot name anyone.

## 2026-09-06 — Weekly view in the Expense Tracker (v3.7)

"Where it goes" gains a **This week** breakdown alongside month, year and all
time, and the totals strip gains a matching **This week** card.

The card is the part that was actually missing. A filter with no total would
have left the week the one period whose number appears nowhere on screen —
every other tab has a card above it. It shows the week's spend, the dates it
covers ("Sep 6–12", and "Dec 27–Jan 2" when the week crosses a year), and the
average per day *so far*, dividing by days elapsed rather than by seven, the
same reasoning the month card already used.

**Weeks run Sunday to Saturday**, borrowed from the calendar's `weekStartOf()`
rather than defined again here. A second convention would mean the same Sunday
fell in different weeks on two tabs of one app.

Verified against every day of 2026 — 365 windows checked for starting on a
Sunday, ending on a Saturday, being seven days long, containing their own date,
and excluding the days either side — plus year-crossing weeks and a leap day.
Zero failures.

One consequence worth expecting rather than reporting as a bug: on a Sunday the
"This week" and "Today" cards show the same figure, because one day has elapsed.

## 2026-09-06 — The browser was never told what it could reach (v3.6)

A Super Admin saw the SUPER ADMIN badge and no User & Role Management tab. The
tab was deployed, the markup was present, and `applyAccess()` was hiding it
correctly given what it had to work with.

`publicUser()` — the object the browser stores as "who I am" — returned `role`
but not `caps`. The signed token carried the capabilities all along, so the
**server was enforcing correctly and nothing was exposed that should not have
been**. But the client decides what to *draw* from that stored object, and
`myCaps()` reads an absent list as an old pre-capabilities token and falls back
to a full-access account **without** `admin`. Hence the right badge, read from
`role`, above a missing tab, decided by `caps`. A guest's countdown in the
profile was missing for the same reason — `guestExpiresAt` was not in there
either.

Worth noting what this means about the earlier work: the People panel inside the
profile was gated on the same `can("admin")`, so it had never actually been
reachable in production. It went unnoticed because the account that would have
used it was locked out by the column-range bug for that whole period.

**Two halves, because they fix different populations.**

- `publicUser()` now returns `caps` and `guestExpiresAt`, shaped exactly like
  `/auth/me` so the two can never disagree about the same account. Correct at
  login, from the next Worker deploy onward.
- The client stops discarding the `/auth/me` reply. It was already fetched on
  every load purely to confirm the session was still alive, and it already
  contained the right answer. Merging it heals every session issued before the
  change above — no re-login — and, more usefully, means a role or permission
  change made by an admin reaches an already-open browser on its next load
  rather than waiting out a 30-day token. It widens or narrows only what is
  **drawn**; every request still has to get past the Worker's signature check,
  which reads capabilities from the signed token and not from anything stored
  in the browser.

`applyAccess()` only ever *hid* the Board History sub-views and never restored
them, so an account that gained the capability kept them hidden. Made symmetric,
since it can now run more than once.

**Verified by reproducing it.** In a browser against a stubbed Worker, with
`/auth/me` deliberately delayed so both phases are observable. Phase 1, drawing
from a stored session with no caps: badge "Super Admin", admin tab hidden, five
tabs — exactly the reported screenshot. Phase 2, after the merge: caps stored,
six tabs, the tab opens and loads the account list, own row read-only.

## 2026-09-06 — User & Role Management tab (v3.5)

A Super Admin screen of its own, replacing the people list that was folded into
the profile panel. Account, Role and Permissions are three separate sections
because they fail differently: whether someone may sign in at all, what bundle
of access they start from, and where this particular person departs from it.

**No Worker changes.** `adminUpdateUser` already accepted, validated and stored
a `perms` object and already bumped the session epoch for it — the column was
being read by `capsFor()` and written by nothing. This is the UI that was
missing, not new machinery.

**The client never keeps its own copy of the rules.** Role defaults arrive with
the user list (`res.caps`, the Worker's own `CAPS` table), so the screen cannot
drift out of step with the server the first time a capability is added.

**Overrides are derived, not stored twice.** The Worker returns effective
capabilities rather than the override object, so the screen reconstructs the
overrides by differencing effective against role defaults. Lossless for anything
that changes behaviour: an override that merely restates a role default is both
indistinguishable from no override and identical in effect, so dropping it is a
tidy-up. Ticking a box back to what the role already says therefore *removes* the
override rather than pinning it — which matters, because a pinned value would
silently stop a later role change from moving that person. Derivation runs over
the union of both sets, so an `admin` override typed into the sheet by hand
survives an unrelated tick; verified.

**`admin` is not offered as a tick.** It is what the Super Admin role means, and
granting it to a "User" would produce an account whose badge contradicts what it
can do. Role is the way to grant it.

### What is and is not a boundary

Every tab except this one renders the signed-in person's **own** board. Turning
one off is policy — it simplifies their screen; it does not protect data that was
already theirs, and a determined person can un-hide a tab from devtools. The two
things that genuinely are boundaries — reaching another account's row, and the
guest clock — are enforced by the Worker against a signed token, so a forged
capability list gets a 403 rather than an admin panel.

The client-side guards exist so the app never renders a screen it would then have
to fill with 403s: the tab is hidden without the capability, and `setView`
refuses `admin` outright, which covers the arrow keys and the console alike.
A Super Admin's own row is read-only throughout, matching the Worker's refusal to
let one demote or deactivate themselves.

### Three bugs found by testing, not by reading

- **Tab clicks were bound by five hand-written lines.** The sixth tab rendered,
  revealed itself correctly to a Super Admin, and did nothing when clicked. The
  bindings now come from `MAIN_TABS`, the same map `setView` and the keyboard
  handler already read, so a seventh tab cannot arrive half-wired.
- **Arrow-key navigation walked hidden tabs.** It queried every `[role="tab"]`
  in the markup against a hard-coded parallel array of view names. A Guest could
  arrow onto Reports. Now derived from the tabs actually visible. Pre-existing;
  this feature only made it easier to notice.
- **List rows ran together on one line.** `.um-rn` and `.um-rs` are spans,
  because a `<button>` may not contain a `<div>`, and without an explicit
  `display` they stayed inline.

### A contrast bug this uncovered, and its eight older siblings

`--forest-dk` is a *fill* token: it stays `#1B5E20` in both themes. `--olive-lt`
is a *surface* token: it flips to `#1B3A20` in dark. Nine rules paired them as
text-on-background, which measures **1.60:1 in dark** — effectively invisible.
Two were mine; seven were already there, including the "saved" confirmation
message, the calendar's repeat tags and month-day markers, the Super Admin badge
in the profile, and the Expense Tracker's optional-field labels.

All nine now use `--forest-ink`, which *is* theme-aware: **4.56:1 light,
6.24:1 dark**. Fill uses of `--forest-dk` (button hovers, the header gradient)
are untouched — the lookbehind in the sweep excludes `border-color:` and
`background-color:`, and they were verified individually afterwards.

Every text pair on the new screen was then measured in both themes: lowest is
4.56:1, nothing fails AA.

## 2026-09-06 — Admin-issued temporary passwords (v3.4)

Role and status management already shipped with the profile panel; this adds the
piece that was missing for "they cannot get in, and Forgot password is not
working for them either" — a Super Admin can hand someone a password directly.

**The plaintext exists for exactly one response and is never stored.** It is
hashed with the same PBKDF2 + pepper as any other password before it reaches the
sheet, so there is nothing to look up afterwards and losing it means issuing
another. That is the property worth having, not a limitation to work around.

**Issuing one signs the account out everywhere**, by bumping `session_epoch`. If
the reason someone needs a temp password is that their account was compromised,
leaving their old sessions alive defeats the point of resetting it. Any lockout
is cleared in the same write — otherwise the password just handed over would be
refused by an account still serving out its fifteen minutes.

**The generated password is meant to be read aloud.** The alphabet excludes
`O`/`0` and `I`/`l`/`1`, and it is grouped `xxxx-xxxx-xxxx`. A guaranteed
upper/lower/digit trio is appended rather than rejecting and redrawing: the
entropy of the twelve random characters is what matters, and appending only makes
the result longer. Verified across 200 samples — all satisfy the same complexity
rules the signup form enforces, none contain an ambiguous character, all unique.

It renders into the row rather than an `alert()`, which cannot be copied from on
a phone and will usually be pasted into a message. Shown in terracotta rather
than red: handing out a credential is consequential, not an error, and red stays
reserved for things that have actually gone wrong.

**Not yet: forced change on next login.** That needs another sheet column, and
the schema is still settling. It is written up in the workflow as the natural
next step rather than bolted on now.

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
