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
user_id	first_name	last_name	username	username_key	email	email_key	password_hash	secret_question	secret_answer_hash	role	status	failed_attempts	locked_until	board_id	created_at	last_login_at	password_updated_at	session_epoch
```

   Paste it into cell **A1** and Sheets will spread it across A1:S1 by itself,
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

## 7. The temporary admin (optional, not built yet)

The `role` column and an `/admin/*` route exist so the admin system can be added
later without rearranging any of this. Nothing is built behind it yet — every
`/admin/*` call returns "not built yet" after checking the role.

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
