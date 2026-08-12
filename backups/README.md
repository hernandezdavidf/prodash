# backups/

Drop your exported JSON files here.

**Why this folder exists:** the dashboard keeps its data in the browser's local storage.
That is tied to this PC and this browser. Clearing browsing data, switching browsers, or
moving to a new machine loses it. An export is the only copy that survives.

## How to make one
Open `dashboard.html`, click the **⇩** button in the top bar (or press **E**).
A file named `pd8-YYYY-MM-DD.json` lands in your Downloads folder. Move it here.

Do this weekly. The dashboard nags you with a "last backup Nd ago" chip after 7 days.

## How to restore one
Open `dashboard.html`, click **⇧**, pick the file. It shows you what will change and
downloads a snapshot of your current data first, so an accidental import is recoverable.

## Note on the starting state
The initial seed (David's schedule, the 21 tasks carried over from dayflow, the habits)
is not stored here — it lives in `seed()` inside `dashboard.html` and is reproducible at
any time by running `pd8Seed()` in the browser console. Only real, evolving data is
worth committing to this folder.
