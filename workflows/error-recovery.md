# Workflow: error recovery, learning and improvement (agent-facing)

Applies to the main development agent and to both review subagents
(`security-reviewer`, `ux-reviewer`). It governs what happens when something
breaks: a failed check, a broken feature, a build or deploy failure, a
security finding, a sync problem, or any behaviour that surprised you.

**The rule it exists to enforce: an error is the start of the work, not the
end of it.** Stopping at the first failure and reporting the task blocked is
only correct when the blocker is genuinely outside this machine's reach — and
that has to be demonstrated, not assumed.

---

## The loop

1. **Detect and acknowledge.** Capture the actual error: the message, the
   failing check, the console output, the component, what you observed versus
   what you expected. Not a paraphrase — the text.
2. **Find the root cause.** Why did it fail? Keep going until the answer
   explains the symptom completely. Three superficial fixes cost more than one
   real diagnosis.
3. **Consult what is already known.** `ERRORS.md` first if the component has
   a history, then `CHANGELOG.md` (most entries say why a thing is the way it
   is), then the workflow docs and the code comments. This codebase documents
   its own scar tissue; much of what looks like a mistake has a story.
4. **Design the smallest safe correction.** It must fix the cause, not mask
   the symptom, and must not weaken security, accessibility, offline
   behaviour or an existing feature to do it.
5. **Implement it.**
6. **Verify.** Reproduce the original failure scenario and show it is gone.
   For anything in `index.html`, that means loading the page in a browser —
   nothing else on this machine can tell you the file parses.
7. **Regression-check.** Re-run `tools/validate.ps1`, re-exercise the
   workflows the change touches, and confirm you have not traded one failure
   for another.
8. **Write the lesson down.** If it can recur, it goes in `ERRORS.md` with
   the fields that file specifies. If it changes how work should be done, it
   goes in the relevant workflow doc or `CLAUDE.md` as well.
9. **Prevent recurrence.** Where it is cheap and deterministic, add a check
   to `tools/validate.ps1` so the next occurrence is caught by a machine
   instead of a person. Every check in that file exists because the thing it
   checks for actually broke once.
10. **Continue.** Resume the original objective. A recovered error is not a
    finished task.

## Non-negotiables

- **Do not stop at the first error.** Investigate and resolve what is
  recoverable before escalating.
- **Recover autonomously.** Use the tools, logs, docs, code and browser you
  already have before asking David to intervene.
- **Do not repeat a failed approach** without new evidence or a changed
  strategy. Two identical attempts is a loop; note what you tried.
- **Bounded retries.** After roughly three failed attempts at the same thing,
  stop and re-diagnose from the top. The Stop gate enforces this shape too —
  it blocks three times, then stands down and requires the failure to be
  reported rather than deadlocking the session.
- **Never weaken a control to make an error disappear.** Not authentication,
  not authorization, not validation, not a test, not a validator check, not a
  required review. If a check is wrong, fix the check and say so in the
  commit; do not delete it quietly.
- **Never forge verification.** `tools/mark-verified.ps1` records that a human
  or an agent actually loaded the page. Running it without having done so is
  falsifying a test result, and the reviewers treat evidence of it as
  Critical.
- **Distinguish a code defect from an environment limit.** "No Node on this
  machine", "service workers do not register under the test harness" and
  "GitHub Pages takes 60 seconds" are environment facts, documented in
  project memory. Do not fix code to chase them.
- **Handle unavailable resources intelligently.** If a service, dependency or
  free tier is unavailable, look for an alternative that meets the project's
  constraints (free, offline-capable, no build step) before declaring the task
  blocked.
- **Escalate with specifics.** When something genuinely needs David —
  credentials, a paid resource, a destructive action, a GitHub setting only he
  can change — say exactly what the blocker is, what you already tried, what
  the risk is, and what you recommend.
- **Never conceal an unresolved failure.** Report it, keep the release block
  in place, and do not describe partial work as finished.

## What counts as verified

| Claim | What verifies it |
|---|---|
| "It parses / it runs" | Loaded in a browser via the HttpListener harness, console checked |
| "The check passes" | `tools/validate.ps1` run, output quoted |
| "It is accessible" | Measured in the browser: computed contrast, focus order, target size |
| "It works offline" | Exercised with the network blocked, not inferred from the code |
| "It shipped" | The live URL polled and the new `APP_VERSION` seen |
| "It was reviewed" | An entry in `REVIEWS.md` written by `tools/record-review.ps1` |

Anything not on that list is an assumption, and should be labelled as one.
