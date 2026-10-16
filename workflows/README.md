# workflows/

Markdown SOPs: objective, required inputs, which tools to use, expected outputs, and edge-case handling for each recurring task.

Don't create or overwrite a workflow without asking first, unless explicitly told to.

| Workflow | When it applies |
|---|---|
| `prodash-maintenance.md` | Shipping any change to `index.html` or `sw.js`. The four-step release rule. |
| `error-recovery.md` | Any failure: failed check, broken feature, deploy problem, security finding. Applies to the main agent and both review subagents. |
| `auth-setup.md` | The Worker, the accounts sheet, the secrets. |
| `cloud-sync-setup.md` | Board sync configuration. |
| `prodash-usage.md` | David-facing: how to use the app. Everything else here is agent-facing. |

## The review gates

Two subagents in `.claude/agents/` are release gates, not advisors:

- **`security-reviewer`** — security and code review. Required for **every
  changed file**, with one exemption (`REVIEWS.md`, which the recorder
  appends to). Default-deny, because Pages publishes the whole branch.
- **`ux-reviewer`** — UI/UX, accessibility and product quality. Required for
  anything a browser parses as a document: `.html`, `.htm`, `.xhtml`, `.xht`.

The authoritative rule is `Get-ReviewNeeds` in `tools/review-lib.ps1`.

They record verdicts with `tools/record-review.ps1`; `tools/validate.ps1`
reads `REVIEWS.md` and fails when a required review is missing, `blocked`, or
stale against the content it covers.

The same script also runs in GitHub Actions on every push, which catches a
*local* skip — an uninstalled hook, `--no-verify`, a hand-edited
`.tmp/verified.json`. It is **not** an independent check: it runs the
validator from the pushed commit, and on a push to `main` it runs after Pages
already has the commit, so it reports rather than prevents. The things that
prevent are `.git/hooks/pre-push` and branch protection with `validate`
required.

Which paths need which review is decided by `Get-ReviewNeeds` in
`tools/review-lib.ps1`, and it is **default-deny**: everything needs the
security review unless explicitly exempt, because Pages publishes the whole
branch — including `.md`, which Jekyll renders into pages on the app's own
origin.
