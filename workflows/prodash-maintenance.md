# Workflow: Maintaining ProDash (agent-facing)

This is the SOP *I* (the agent) follow when I ship a change to `index.html`
or anything else in this repo — not a guide for David to use the app. That's
`workflows/prodash-usage.md`.

---

## Whenever a change is worth a CHANGELOG.md entry, mirror it in-app

`CHANGELOG.md` is the technical, detailed record — full of implementation
reasoning, for whoever's maintaining the code (me, mostly). It is **not**
what David sees in the app.

`index.html` also carries `APP_VERSION_HISTORY` (near `APP_VERSION`, just
above the Board History revision-engine code), which powers the **PRODASH
Version History** sub-tab under Board History — a plain-English, read-only
mirror of the changelog for anyone using the app day to day.

**Every time I add a new dated `## ` entry to `CHANGELOG.md` for a real
deploy or significant production change, I also add one line to
`APP_VERSION_HISTORY` in the same change.** Concretely:

1. Write the `CHANGELOG.md` entry as usual (detailed, technical, for me).
2. Add a matching object to the **top** of `APP_VERSION_HISTORY`:
   ```js
   {ts:"<ISO timestamp, +08:00>", text:"<one sentence, plain English, no jargon>"}
   ```
   - `ts` should be the timestamp the change actually went live — in
     practice, the commit that ships it. If committing right away, use the
     current time (`date +"%Y-%m-%dT%H:%M:%S%:z"` in Git Bash). If the entry
     is written before committing, it's close enough; exactness beyond "the
     right minute or two" doesn't matter here.
   - `text` should read like the summary line in `CHANGELOG.md`'s own
     heading, stripped of implementation detail — the "what changed" a user
     would care about, not the "how" or "why" a maintainer would.
3. Load `index.html` in the browser and check the PRODASH Version History
   tab renders the new line correctly before considering the change done.

**Why this can't be automatic in the literal sense:** there's no backend or
build step in this project ([no Python/Node on this PC](../CLAUDE.md) —
see project memory), and `index.html` still has to work opened via plain
`file://`, which rules out `fetch()`-ing `CHANGELOG.md` at runtime (Chrome
blocks that under `file://`, and local-file use is a real, supported mode
for this app, not just a fallback). So "automatically updated" means: this
step is a required part of my deploy process, every time, not something
David has to ask for or that happens via some separate mechanism.

**What does NOT get a version-history entry:** workflow-doc edits, comment
cleanup, or anything that wouldn't itself warrant a `CHANGELOG.md` heading.
Match the same bar `CHANGELOG.md` already uses.

## Where the two logs live

| | `CHANGELOG.md` | `APP_VERSION_HISTORY` (in `index.html`) |
|---|---|---|
| Audience | Me / future maintainers | David, in the app |
| Tone | Technical, detailed, reasoning included | Plain English, one sentence |
| Where it's read | The repo | Board History → PRODASH Version History tab |
| Editable at runtime? | N/A (source file) | No — read-only in the UI, hand-maintained in source |

---

## Shipping: a commit is not a deploy

*Added 2026-09-07, after finishing v4.2 and reporting it done while the app in
David's browser still said 4.0. Everything below had been correct in the working
tree and wrong everywhere he could see.*

ProDash is served by **GitHub Pages from `origin/main`**. There is no build and
no deploy job: whatever is on that branch IS the live app. So a local commit
changes nothing David can see, and "committed" must never be reported as
"shipped".

**Every change to `index.html` or `sw.js` ends with all four of these:**

1. **Bump `APP_VERSION`** (near `APP_VERSION_HISTORY`). This is the number the
   PRODASH Version History sub-view prints as "Current version", and it is how
   David checks whether an update actually reached him. v4.1 shipped without a
   bump, so the live app reported 4.0 for two releases and there was no way to
   tell the old build from the new one.
2. **Bump `CACHE_VERSION` in `sw.js`.** `index.html` is network-first, so an
   online device gets the new file on its next load regardless — the bump is
   what evicts the OFFLINE fallback copy on the service worker's next
   `activate`. For an app used at 3am on a dead connection, that copy is the
   one that matters.
3. **`git push origin main`.** Check `git status -sb` says `## main...origin/main`
   with no `[ahead N]` afterwards.
4. **Verify the live origin, not the working tree:**
   ```bash
   curl -s "https://hernandezdavidf.github.io/prodash/index.html?cb=$RANDOM" | grep -o 'var APP_VERSION="[0-9.]*"'
   ```
   Pages takes roughly 30–60 seconds to rebuild, so poll a few times rather
   than concluding from one stale read. Do the same for `sw.js` and
   `prodash-v*`.

**Then tell David to reload.** An installed PWA can need two loads: the first
fetches the new `sw.js` and installs it, the second activates it and drops the
old cache. `Ctrl+Shift+R` on the desktop covers both.

**Testing locally proves the code, not the deploy.** The PowerShell
`HttpListener` harness (see project memory) serves the working tree, so it is
green the moment the file is saved — which is exactly why it cannot tell you
whether anything shipped. Step 4 is the only check that can.
