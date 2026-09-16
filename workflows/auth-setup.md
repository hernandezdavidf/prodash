# Workflow: Setting up ProDash accounts (Google Sheets + login)

**What this gives you:** ProDash asks who you are before it opens. Each person
gets their own board, reachable from any device by logging in. The list of
accounts lives in a Google Sheet you own and can read at any time.

**One-time setup.** After this, adding a person is just them clicking Sign up.

> **This replaces the shared sync password.** The old
> [`cloud-sync-setup.md`](cloud-sync-setup.md) had one password that everybody
> typed and that opened one board. `SYNC_PASSWORD` is no longer read by the
> Worker at all. If you already did that setup, you keep your KV namespace and
> your Worker — you are only replacing the code and adding variables.

---

## Why the Worker is in the middle

ProDash is a single HTML file served as a public static page. Anything written
into it — including any Google API key — is visible to anyone who views source.
If the browser talked to the Google Sheet directly, every password hash and
secret answer in that sheet would be public.

So the browser never touches the sheet. It talks only to your Worker, and the
Worker is the only thing holding Google credentials. The Worker also decides
which board each request may touch, reading that from the signed session token
rather than from anything the browser sends — which is why nobody can reach
someone else's board by editing a URL or a stored value.

```
Browser  ->  your Worker  ->  Google Sheet   (accounts)
                         ->  Cloudflare KV   (each person's board)
```

---

## 1. Make the account sheet

1. Go to [sheets.new](https://sheets.new) and name the file something like
   **ProDash Accounts**.
2. Rename the first tab to exactly **`Users`** (bottom-left, double-click the
   "Sheet1" label). The Worker looks for this name.
3. Paste this as **row 1**, the header row. The Worker addresses columns by
   position, so the order matters — don't insert a column in the middle later.

```
user_id	first_name	last_name	username	username_key	email	email_key	password_hash	secret_question	secret_answer_hash	role	status	failed_attempts	locked_until	board_id	created_at	last_login_at	password_updated_at	session_epoch	perms	activated_at	nickname
```

   Paste it into cell **A1** and Sheets will spread it across A1:V1 by itself,
   because those are tab characters.

4. Copy the **spreadsheet id** out of the address bar — the long string between
   `/d/` and `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`1AbC…xyz`**`/edit`

**Never edit `password_hash` or `secret_answer_hash` by hand.** They are one-way
hashes; there is nothing to read there and typing over one locks that person out
until they use Forgot password.

## 2. Make a Google service account

This is the robot identity your Worker uses. It is not your Google account, and
it can only see files you explicitly share with it.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create
   a project (top bar → **New Project**). Call it `prodash`. Free.
2. **APIs & Services → Library**, search **Google Sheets API**, click **Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account**.
   Name it `prodash-worker`. Create, then **Done** (skip the optional grant steps).
4. Click the service account you just made → **Keys** tab → **Add key → Create
   new key → JSON**. A `.json` file downloads. Open it in Notepad; you need two
   values out of it:
   - `"client_email"` — looks like `prodash-worker@prodash-123456.iam.gserviceaccount.com`
   - `"private_key"` — a long block starting `-----BEGIN PRIVATE KEY-----`
5. **Share the sheet with that email.** Back in the Google Sheet: **Share**,
   paste the `client_email`, give it **Editor**, untick "Notify people", Share.
   Skipping this is the single most common reason the Worker returns
   "Could not reach the account database" — the robot can't see a file nobody
   shared with it.

> Treat that downloaded JSON like a password. Don't put it in this repo — it is
> not in `.gitignore` because it should never be in the folder at all. Once its
> two values are pasted into Cloudflare in step 4, delete the file.

## 3. Update the Worker code

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** →
   your `prodash-sync` Worker → **Edit code**.
2. Delete everything in the editor and paste the full contents of
   [`cloud-worker/worker.js`](../cloud-worker/worker.js).
3. **Deploy.**

If you never did the earlier cloud setup, do steps 1–3 of
[`cloud-sync-setup.md`](cloud-sync-setup.md) first to create the Worker and the
`prodash-kv` namespace bound as `PRODASH_KV` — that part is unchanged and still
required.

## 4. Set the variables

**Settings → Variables and Secrets.** Add each of these and mark every one
**Encrypt**:

| Name | Value |
|---|---|
| `AUTH_SECRET` | A long random string you invent. Signs login sessions. |
| `PASSWORD_PEPPER` | A different long random string. Mixed into every password hash. |
| `SHEET_ID` | The spreadsheet id from step 1.4 |
| `GOOGLE_SA_EMAIL` | The `client_email` from step 2.4 |
| `GOOGLE_SA_KEY` | The whole `private_key` value, including the BEGIN/END lines |
| `LEGACY_CLAIM` | `1` — only if you have existing ProDash data to carry over. See step 6. |

For the two random strings, anything long and unguessable works. In a browser
console: `crypto.randomUUID()+crypto.randomUUID()`.

**Changing `AUTH_SECRET` later signs everyone out immediately** — every existing
session was signed with the old value. That is the emergency lever if you ever
think a token leaked.

`PASSWORD_PEPPER` is different: **changing it invalidates every stored password**
and everyone has to use Forgot password. Set it once and leave it.

> **The deployment gotcha, unchanged from the old setup and still the most
> likely thing to go wrong:** Cloudflare saves each variable change as a new
> *version* but does not always push it live. After saving, go to
> **Deployments**, find the newest entry in Version History, open its **⋯** menu
> and explicitly **Deploy** / promote it to Active. Until you do, the Worker
> keeps serving the old config with no error and no warning.
>
> Sanity check: open `https://your-worker-url/health` in a browser. `{"ok":true}`
> means the code and all five required variables are live. A 500 naming a
> missing variable tells you exactly which one didn't take.

### The check that actually tests Google

`/health` never contacts Google, so it cannot tell you whether step 2.5 worked —
it will happily say `{"ok":true}` while the sheet is unshared, and you would not
find out until the first signup failed. This call does test it, reads only, and
creates nothing. Run it in PowerShell:

```bash
$u="https://YOUR-WORKER-URL"; try { Invoke-WebRequest "$u/auth/forgot/start" -Method POST -ContentType "application/json" -Body '{"username":"connectivity-test","email":"test@example.com"}' -UseBasicParsing } catch { $s=$_.Exception.Response; "STATUS $([int]$s.StatusCode)"; (New-Object IO.StreamReader($s.GetResponseStream())).ReadToEnd() }
```

Read the result like this:

- **404 `No account matches that username and email address.`** — success. The
  Worker authenticated to Google, read the `Users` tab, and found no such user,
  which is correct. Everything from step 1 to step 4 is working.
- **502 `Could not reach the account database.`** — Google refused. Almost
  always step 2.5 (sheet not shared with the service account), otherwise a bad
  `GOOGLE_SA_KEY` paste or the Sheets API not enabled. The Worker's live logs
  show the real Google error.
- **500 naming a variable** — that variable didn't deploy.

## 5. Point ProDash at it

**Get the URL by copying it, never by reconstructing it.** A `workers.dev`
address is `<worker-name>.<account-subdomain>.workers.dev` — exactly two labels
before `workers.dev`, and the account subdomain is rarely your name. Typing a
guessed one gives `DNS_PROBE_FINISHED_NXDOMAIN`, which looks alarming but only
means the hostname doesn't exist; nothing reached Cloudflare and none of your
variables are implicated.

Find it in either of these places:

- **Cloudflare dashboard → Compute (Workers) → `prodash-sync` → Settings →
  Domains & Routes.** Shows the real hostname *and* whether the `workers.dev`
  route is enabled. A disabled route also gives NXDOMAIN — a Worker can be
  deployed and healthy with no public hostname at all.
- **If cloud sync ever worked on this device**, the old URL is still in the
  browser. F12 → Console → `localStorage.getItem("prodash.cloudUrl")`. ProDash
  reads that key as a fallback anyway, so it may fill itself in.

Open ProDash. Because there is no session yet, you get the login screen, and on
a fresh device it asks for the **server address** first — paste the Worker URL
you just copied. That is stored on that device only. Then **Sign up**.

Do the same on your phone: same URL, then **Log in** with the account you just
made. Same board, both devices.

## 6. Carrying your existing board over

If you were already using ProDash with the old single-password sync, your data
is sitting in KV under the key `state`. With `LEGACY_CLAIM=1` set, **the first
account created on the upgraded Worker inherits it**. So sign up as yourself
before anyone else does.

The browser does the matching thing independently: the first account to sign in
on a device adopts whatever that browser had cached locally. Between the two,
your board arrives from whichever side had it.

Once you have confirmed your data is there, set `LEGACY_CLAIM` to `0` (or delete
it) so no later account can trigger the check again.

**Before starting, export a backup** from the ProDash header. It costs ten
seconds and it is the only thing that makes any of this reversible.

## 7. The admin bootstrap endpoint (rarely needed now)

The admin system is built (see **Roles and access** above). This endpoint exists
only for the case where you have **no Super Admin at all** and would rather not
edit the sheet by hand — for most situations, changing column K of your own row
to `superadmin` is quicker and needs no token.

To create the placeholder admin account:

1. Add a variable `ADMIN_BOOTSTRAP_TOKEN` with a random value. Deploy it.
2. Send one request (browser console, from any page):

```bash
curl -X POST https://YOUR-WORKER-URL/admin/bootstrap -H "X-Bootstrap-Token: YOUR-TOKEN" -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"ChooseAStrongOne1\",\"email\":\"you@example.com\"}"
```

3. **Delete `ADMIN_BOOTSTRAP_TOKEN` from the Worker's variables and redeploy.**
   It only ever needs to work once, and it creates a privileged account, so
   leaving it set is leaving the door unlocked.

The route refuses to run at all if an admin already exists.

---


---

## Roles and access

Three roles. Each is a named set of capabilities; a capability is just a string,
so adding a tab later means adding one name, not changing the sheet.

| Role | Can reach |
|---|---|
| **superadmin** | Everything, plus the People panel for managing other accounts |
| **user** | Board, Personal Calendar, Expense Tracker, and the app's version history only |
| **guest** | Board, Personal Calendar, Expense Tracker — **for 48 hours** |

**What this does and does not protect.** Every tab except the People panel shows
the signed-in person's *own* board. Hiding one is policy, not security — the data
was already theirs, and a determined person can un-hide a tab from devtools. The
two things that *are* boundaries are enforced by the Worker and cannot be
bypassed from the browser: anything that touches another account's row, and the
guest clock.

### Upgrading a sheet you already have

If your `Users` tab was created before roles existed, it stops at column S. Add
these headers and nothing else — appending columns is safe, inserting them in
the middle is not, because the Worker addresses columns by position:

- **T1** → `perms`
- **U1** → `activated_at`
- **V1** → `nickname`

Leave the cells beneath them blank. Blank means "no overrides", "clock never
started" and "no nickname", all of which are correct for every existing account.

**Then check the table actually grew.** If the tab is a Google *Table* (the
header row is coloured and each header has a filter chevron), typing a header
into the next cell does not always extend the table to cover it. V1 should look
exactly like `activated_at` does — same green header, same chevron. If it does
not, drag the table's bottom-right handle out to column V before deploying.
This matters more than it sounds: a mismatch between `COL_COUNT` in the Worker
and the real width of the range is what broke every login for a day, because
reads and appends kept working while every row *update* failed.

### Making yourself the Super Admin

Everyone who signed up is a plain `user`, including you. Open the sheet, find
your row, and change column **K** (`role`) from `user` to `superadmin`. Then sign
out and back in — a role lives inside the signed session token, so an open
session keeps whatever role it was issued with until it is replaced.

That is the only manual step. From then on you can change anyone's role from the
People panel: click your name in the header.

### Guests

Make someone a guest from the People panel and their 48 hours start then. What
happens at the end:

- Their **session token itself expires** at the 48-hour mark, because the token
  is issued with that cap baked into its signature. Nothing to bypass in
  localStorage, and no per-request lookup.
- Their row flips to **`deactivated`** on the next login attempt, which is what
  makes the expiry visible to you in the People panel rather than being silently
  recomputed and never recorded.
- **Restart 48h** in the People panel gives them another window and reactivates
  the account in one click.

### The User & Role Management tab

Everything below is done from that tab, which only a Super Admin can see. Pick
an account on the left and its whole picture appears on the right, in three
sections:

- **Account** — who this is, when they were created, when they last signed in,
  and whether they may sign in at all (Active / Inactive / Deactivated).
- **Role** — Super Admin, User or Guest. This is the *starting* set of access.
- **Tab & feature permissions** — tick boxes for the individual tabs. Use these
  to give one person something their role does not normally include, or take
  something away, without moving them to a different role. A small tag marks
  every place an account differs from its role, so overrides are visible rather
  than hidden in a spreadsheet cell.

"Reset to X defaults" clears every override at once.

**Your own row is read-only.** You cannot change your own role, status or
permissions, and the Worker refuses it independently even if the screen is
tampered with. There is no recovery path from a Super Admin who demotes
themselves short of editing the sheet by hand, so it is cheaper to refuse.

**Every change signs that person out everywhere.** A demotion that waited for a
30-day token to lapse would not be a demotion, so role, status and permission
changes all bump `session_epoch`. They come back with the new access on their
next sign-in.

**What a permission tick actually buys.** Every tab except this one shows the
signed-in person's *own* board, so hiding one simplifies their screen rather
than protecting anything — the data was already theirs, and someone determined
can un-hide a tab from browser devtools. The two things that genuinely are
enforced are the Super Admin tab itself and the guest clock, and both are
checked by the Worker against a signed token rather than by the browser. Use the
ticks to make the app simpler for someone, not to keep a secret from them.

### Temporary passwords

When someone cannot get in and Forgot password is not working for them, open the
People panel and click **Temp password** on their row.

- The password is shown **once**, in a copyable box. It is hashed before it
  reaches the sheet, so there is no way to look it up again — if you lose it,
  issue another.
- Their old password stops working immediately and they are **signed out
  everywhere**. If the reason they need one is that their account was
  compromised, leaving their old sessions alive would defeat the point.
- Any lockout on the account is cleared at the same time, so the password you
  just handed over actually works.
- Tell them to sign in with it and then set their own via Forgot password. There
  is no forced-change screen yet — that would need another sheet column, and it
  is a sensible next addition rather than something to bolt on now.

### Adding a second Super Admin

Two ways, neither needing new code:

1. **Promote an existing account** — People panel, change their Role dropdown to
   Super Admin. They are signed out and come back with the new role.
2. **From the sheet** — change column **K** of their row to `superadmin`. Useful
   when nobody can get in to use the panel.

Either way that person must sign out and back in: the role is baked into the
signed token at login.

Two Super Admins is worth having. The Worker refuses to let one demote or
deactivate *themselves*, so a second account is the recovery path if the first
is ever lost — otherwise the only way back is editing the sheet by hand.

### Per-account overrides

The `perms` cell holds JSON that layers on top of the role's defaults, so it can
grant something the role lacks *or* take away something it normally has:

```json
{"reports": true}
```

That gives one `user` access to Reports without promoting them. `{"exp": false}`
would take the Expense Tracker away from someone who would otherwise have it.
Leave the cell empty for the role's defaults. The Worker validates this on write;
a malformed value is refused rather than silently collapsing the account back to
defaults.

### If you lock yourself out

The Worker refuses to let a Super Admin demote or deactivate their own account,
so the usual way to lose access does not exist. If it happens anyway — say the
only Super Admin row is edited by hand into something else — fix column **K**
back to `superadmin` in the sheet and sign in again. The sheet is the source of
truth; nothing in the Worker or the browser can override it.

## Day-to-day

**Adding a person** — they open ProDash, enter the server address once, click
Sign up. Their row appears in the sheet with a new `board_id`. Nothing for you
to do.

**Someone is locked out** — three wrong passwords in a row locks an account for
15 minutes; the app tells them when they can retry. To clear it early, find
their row and set `failed_attempts` to `0` and `locked_until` to empty.

**Suspending someone** — set their `status` to anything other than `active`.
They cannot log in; their board is untouched.

**Signing someone out everywhere** — increase their `session_epoch` by 1.

**Forgot password** needs the username *and* the registered email to match
before it will even show the secret question. Answers ignore capitals and extra
spaces. Wrong answers count toward the same three-strike lockout.

## If something looks wrong

- **`DNS_PROBE_FINISHED_NXDOMAIN` / "site can't be reached"** — the hostname
  doesn't exist, so nothing reached Cloudflare and this is not a code or
  variable problem. Either the URL is wrong (see step 5) or the Worker's
  `workers.dev` route is disabled.
- **`/health` returns an empty body, or an HTML error page** — you reached
  Cloudflare but not this Worker. Every response from `worker.js` is JSON, so
  anything else means the name resolved to a different Worker, or the paste-in
  never deployed.
- **`/health` returns 500 naming a variable** — that variable didn't deploy.
  Promote the newest version (step 4's gotcha).
- **"Could not reach the account database"** — the Worker reached Google and was
  refused. Almost always step 2.5: the sheet isn't shared with the service
  account email. Check the Worker's live logs for the real Google error.
- **"Exceeded CPU limit" on login or signup** — password hashing is deliberately
  slow and the free plan allows ~10ms. Add `PBKDF2_ITERATIONS` = `50000` and
  redeploy. Existing passwords keep working; they re-hash themselves at each
  person's next login.
- **Everyone signed out at once** — `AUTH_SECRET` changed.
- **Everyone's password stopped working** — `PASSWORD_PEPPER` changed. Restore
  the old value if you still have it; otherwise everyone uses Forgot password.
- **A name shows up in the sheet with a leading apostrophe** (`'=hello`) — that
  is deliberate. Values starting with `=`, `+`, `-` or `@` are neutralised so a
  registration can't plant a live formula in a sheet you open.

---

# Sign in with Google (added 2026-09-16, app v4.14 / Worker 4.10)

Everything above still applies unchanged — this is additional setup, not a
replacement. Password sign-in keeps working with none of it done.

**Nothing here costs anything and nothing needs a card.** Sign in with Google is
authentication, not a metered API: there is no API to enable, no quota to buy,
and no client secret anywhere in this design.

## What changed that the steps above don't mention

Two things in the existing setup are now out of date, and are corrected here
rather than rewritten above:

- **The header row is no longer 22 columns.** It runs to **AA**, not V. The five
  added columns are listed in G.2 below.
- **The environment list gained entries.** `GOOGLE_OAUTH_CLIENT_ID`, and the
  four mail variables, all optional. See G.4.

## G.1 — Google Cloud Console

Reuse the same `prodash` project that already holds the service account. This
is an OAuth **client**, which is a different thing from the service account: the
service account is the Worker acting as itself against your sheet; this is a
person proving who they are.

1. **APIs & Services → OAuth consent screen** → **External**. App name, user
   support email, developer contact. No API to enable.
2. Leave publishing status on **Testing**, and add each person's Google address
   under **Test users**. See G.5 before considering Production.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
4. **Authorized JavaScript origins** — scheme and host only, Google rejects
   paths:
   - `https://hernandezdavidf.github.io`
   - `http://localhost` and `http://localhost:8761` for the test harness
5. **Authorized redirect URIs — leave empty.** The popup flow hands the token to
   a JavaScript callback in the page. There is no redirect, so no redirect URI,
   and no client secret to keep anywhere.
6. Copy the **Client ID** (ends `.apps.googleusercontent.com`). It is public by
   design — it appears in the page source of every site that uses Google
   sign-in — but it is still configured in exactly one place: Cloudflare.

## G.2 — Five new sheet columns

In the `Users` tab, **W1** through **AA1**:

```
google_sub	google_email	google_linked_at	google_picture	email_verified
```

`google_sub` is Google's permanent subject id and is the only thing a sign-in is
matched on. Never the email — Google addresses can be changed by their owner
and, on Workspace domains, reissued to someone else entirely.

**The Table trap from the column-width warning above applies here too.** If the
tab is a Google *Table*, typing into W1 does not always widen it: drag the
bottom-right handle out to column AA first. A width mismatch breaks every row
*update* while reads and appends keep working, which is the fault that once
looked like an intermittent database outage.

No backfill is needed. `readUsers` pads short rows, so existing accounts read
back with empty cells in the new columns.

## G.3 — Deploy the Worker

Exactly as step 3 and step 4's gotcha above: paste `cloud-worker/worker.js` into
**Edit code**, **Deploy**, then **Deployments → ⋯ → promote to Active**.

Confirm with `/health`, which now answers more than `ok`:

```json
{"ok":true,"version":"4.10","google":true,"googleClientId":"…","mail":false}
```

`google:true` is what the app reads to decide whether to draw the Google button
at all. If it says `false`, the variable in G.4 is missing or was never promoted.

## G.4 — New Worker variables

| Name | Required | What it does |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | for Google sign-in | The Web client id from G.1.6. Served to the app from `/health`, so `index.html` holds no copy of it and the two cannot drift. **Deliberately not in `requireConfig`** — a missing client id must not take password login down with it; the Google routes answer 503 and the app hides the button. |
| `MAIL_API_KEY` | no | Bearer key for a mail provider. |
| `MAIL_FROM` | no | The From address. |
| `MAIL_PROVIDER_URL` | no | Defaults to Resend's endpoint. |
| `APP_URL` | no | Where emailed links point, e.g. `https://hernandezdavidf.github.io/prodash`. Configured rather than read from the Origin header, or anyone could have the Worker mail someone a link to a site they control. |

**Email is off until both `MAIL_API_KEY` and `MAIL_FROM` exist.** Verification
and reset-link endpoints answer 503 `mail_not_configured`, and the secret
question remains the working recovery path — which needs no provider, costs
nothing, and works offline. That is the shipped behaviour, not a gap.

## G.5 — Before moving to Production

Not needed for Testing, and Testing works indefinitely for sign-in.

Production requires a public homepage, a Privacy Policy and Terms of Service, on
a domain **verified in Search Console**. Google verification review is *not*
required for `openid`/`email`/`profile` — those are non-sensitive scopes — so
publishing is self-service. Only a logo on the consent screen needs the lighter
brand-verification.

**The likely blocker:** `github.io` is a shared public-suffix domain and Google
may refuse it as an authorized domain. That would mean the custom domain this
project has already noted wanting. Try adding the domain in the console before
committing to a launch date — it costs nothing to find out.

## G.6 — Order of deployment

The app ships by git push to Pages, the Worker is pasted by hand. They cannot
land together, so the app was built to survive either order: the profile panel
probes `/health` and disables what an old Worker cannot serve, showing the same
stale-Worker banner the admin screen uses. Google's button stays hidden until a
client id exists.

Preferred order anyway: columns → variable → Worker → promote → confirm
`/health` → push the app.

## If something looks wrong — Google edition

- **No Google button, and a line saying it is not switched on** — `/health`
  reported no `googleClientId`. The variable is missing, or was saved but never
  promoted to Active.
- **No Google button, and a line about the hosted version** — the page is open
  from `file://`. Google will only run its script on a registered https origin
  and `file://` cannot be registered. This is expected; password sign-in is
  unaffected, and it is the reason Google sign-in is a hosted-app affordance
  only.
- **"That Google sign-in could not be verified"** — one 401 covers every
  verification failure on purpose; a detailed reason would help whoever forged
  the token. The real cause is in the Worker's live logs. The most common one is
  an `aud` mismatch: the client id in Cloudflare is not the one the page used.
- **"An account already exists for that email address"** on a Google sign-in —
  working as designed. ProDash never verified the addresses typed into its
  signup form, so an email match is not proof of ownership. Sign in with the
  password, then connect Google from Profile.
- **Profile controls greyed out with an orange banner** — the deployed Worker
  predates the app. Redeploy and promote.
- **A `google_sub` cell showing `1.078E+20`** — an old Worker wrote it before
  `cellSafe` learned to quote long digit runs. Re-link the account; the current
  code stores it as text.
