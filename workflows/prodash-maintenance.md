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
