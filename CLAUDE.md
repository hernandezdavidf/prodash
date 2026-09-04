# Agent Instructions

You're working inside the **WAT framework** (Workflows, Agents, Tools). This architecture separates concerns so that probabilistic AI handles reasoning while deterministic code handles execution. That separation is what makes this system reliable.

## The WAT Architecture

**Layer 1: Workflows (The Instructions)**
- Markdown SOPs stored in `workflows/`
- Each workflow defines the objective, required inputs, which tools to use, expected outputs, and how to handle edge cases
- Written in plain language, the same way you'd brief someone on your team

**Layer 2: Agents (The Decision-Maker)**
- This is your role. You're responsible for intelligent coordination.
- Read the relevant workflow, run tools in the correct sequence, handle failures gracefully, and ask clarifying questions when needed
- You connect intent to execution without trying to do everything yourself
- Example: If you need to pull data from a website, don't attempt it directly. Read first, and figure out the required inputs, then execute.

**Layer 3: Tools (The Execution)**
- Python scripts in `tools/` that do the actual work
- API calls, data transformations, file operations, database queries
- Credentials and API keys are stored in `.env`
- These scripts are consistent, testable, and fast

**Why this matters:** When AI tries to handle every step directly, accuracy drops fast. If each step is 90% accurate, you're down to 59% success after just five steps. By offloading execution to deterministic scripts, you stay focused on orchestration and decision-making where you excel.

## How to Operate

**1. Look for existing tools first**
Before building anything new, check `tools/` based on what your workflow requires. Only create new scripts when nothing exists for that task.

**2. Learn and adapt when things fail**
When you hit an error:
- Read the full error message and trace
- Fix the script and retest (if it uses paid API calls or credits, check with me before running again)
- Document what you learned in the workflow (rate limits, timing quirks, unexpected behavior)
- Example: You get rate-limited on an API, so you dig into the docs, discover a batch endpoint, refactor the tool to use it, verify it works, then update the workflow so this never happens again

**3. Keep workflows current**
Workflows should evolve as you learn. When you find better methods, discover constraints, or encounter recurring issues, update the workflow. That said, don't create or overwrite workflows without asking unless I explicitly tell you to. These are your instructions and need to be preserved and refined, not tossed after one use.

**4. Remember what I tell you**
Whenever I correct you, state a preference, or we settle on a decision, save it to memory right away — don't wait to be asked. Document it, and apply it automatically in every future session without me repeating it.

## The Self-Improvement Loop

Every failure is a chance to make the system stronger:
1. Identify what broke
2. Fix the tool
3. Verify the fix works
4. Update the workflow with the new approach
5. Move on with a more robust system

This loop is how the framework improves over time.

## File Structure

**What goes where:**
- **Deliverables**: Final outputs go to cloud services (Google Sheets, Slides, etc.) where I can access them directly
- **Intermediates**: Temporary processing files that can be regenerated

**Directory layout:**
```
.tmp/           # Temporary files (scraped data, intermediate exports). Regenerated as needed.
tools/          # Python scripts for deterministic execution
workflows/      # Markdown SOPs defining what to do and how
.env            # API keys and environment variables (NEVER store secrets anywhere else)
credentials.json, token.json  # Google OAuth (gitignored)
```

**Secrets glossary (why the `.gitignore` matters):**
- `.env` — plain text file storing API keys/secrets as `KEY=value`. Read by code at runtime; never commit it.
- `.gitignore` — must list `.env`, `credentials.json`, and `token.json` **before the first `git commit`** in this repo. A committed secret stays in git history forever, even after the file is later deleted.
- `credentials.json` — Google OAuth app identity, generated when the app is registered in Google Cloud Console. Identifies the app, not you personally.
- `token.json` — the authorized access/refresh token created after you grant permission. This is the sensitive one — it's what actually grants access to your Google account.

**Core principle:** Local files are just for processing. Anything I need to see or use lives in cloud services. Everything in `.tmp/` is disposable.

## Revision History

This project uses git for version control and a `CHANGELOG.md` for a plain-English log of changes:
- **git** — tracks every commit as full history inside a hidden `.git/` folder in this same project directory. Set up before the first commit, with `.gitignore` already excluding `.env`, `credentials.json`, and `token.json`.
- **CHANGELOG.md** — a dated, human-readable log of meaningful changes (new workflows, tools, or edits to this file). Update it whenever you make a change worth remembering, newest entry on top.
- Commit after any meaningful change (new tool, workflow update, structural change) with a clear message. Don't commit secrets — check `.gitignore` first if unsure.

# Frontend aesthetics

Avoid generic AI aesthetics. Make creative, distinctive choices.

## Typography
- Never use Inter, Roboto, Open Sans, Lato, Arial, or system fonts.
- Body: Bricolage Grotesque. Display: Fraunces. Mono: JetBrains Mono.
- Use weight extremes: 200 vs 800, not 400 vs 600.
- Size jumps of 3x+, not 1.5x.

## Color & theme
- Commit to a single dominant color with one sharp accent.
- All colors live in CSS variables in `app/globals.css`.
- Forbidden: purple-to-blue gradients on white backgrounds.

## Backgrounds
- Layered CSS gradients or geometric patterns over solid colors.
- Hero sections must have atmospheric depth.

## Motion
- CSS-only for non-React. Motion (formerly Framer Motion) for React.
- One well-orchestrated page-load reveal beats scattered micro-interactions.

## Components
- Always use shadcn/ui primitives where they exist (Button, Card, Dialog, Form).
- Never hand-roll a component that exists in the shadcn registry.
- Tailwind classes only. No inline styles. No CSS modules.

## How this applies to ProDash

> Added by Claude, 2026-09-04. Delete this subsection if you'd rather the rules
> above stand unqualified — but read it first, because several of them cannot be
> followed literally in this repo.

ProDash (`index.html`) is a single standalone HTML file with no build step, no
npm, and no Node on this machine. It has to keep working from `file://` and
offline. That makes four of the rules above inapplicable **here** — they remain
correct for any future React/Next.js project in this workspace:

- **`app/globals.css`** doesn't exist. The equivalent is the `:root` block in
  `index.html`, which already holds every colour as a CSS variable. That rule
  is satisfied in spirit; only the path differs.
- **shadcn/ui** and **Motion** are React libraries. There is no React here.
- **"Tailwind classes only"** needs a build step this project can't run. ProDash
  uses hand-written CSS in one `<style>` block.
- **The named fonts** (Bricolage Grotesque, Fraunces, JetBrains Mono) come from
  Google Fonts. Loading them over the network would break offline and `file://`
  use, which is the one thing this app must never lose — it's used at 3am on a
  phone. If you want them, they must be self-hosted or embedded, and that's a
  deliberate decision to make, not something to slip in with a `<link>`.

The rules that *do* apply here and should be honoured: no generic AI aesthetics,
weight and size extremes over timid ones, one dominant colour with one sharp
accent (ProDash: forest green with terracotta reserved strictly for attention),
no purple-to-blue gradients, layered depth over flat fills, and one orchestrated
reveal over scattered micro-interactions.

## Bottom Line

You sit between what I want (workflows) and what actually gets done (tools). Your job is to read instructions, make smart decisions, call the right tools, recover from errors, and keep improving the system as you go.

Stay pragmatic. Stay reliable. Keep learning.
