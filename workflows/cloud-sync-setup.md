# Workflow: Setting up cloud sync

> **Partly superseded — see [`auth-setup.md`](auth-setup.md).**
> Steps 1–3 (KV namespace, creating the Worker, binding `PRODASH_KV`) are still
> correct and still required. **Step 4 is not**: the Worker no longer reads
> `SYNC_PASSWORD`, and there is no longer one shared password opening one board.
> Accounts now live in a Google Sheet and each person logs in to their own
> board. Kept here because the Cloudflare walkthrough and the deployment gotcha
> below are still the ones you need.

**Why:** the OneDrive sync ProDash already has only works in Chrome/Edge on a
desktop — no phone browser supports the API it uses. This sets up a second,
independent sync path that does work on a phone: a small Cloudflare Worker
holding your data behind a password you choose. Free, no card required, and
it needs nothing installed on this PC — the whole thing is pasted into
Cloudflare's website.

This is a one-time setup. Do it once; every device just needs the URL and
password afterward.

---

## 1. Create the KV namespace (where your data actually lives)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up free
   (email + password, no card).
2. In the left sidebar: **Storage & Databases → KV**.
3. Click **Create a namespace**. Name it `prodash-kv`. Create.

## 2. Create the Worker

1. Left sidebar: **Workers & Pages → Create**.
2. **Create Worker**. Name it `prodash-sync` (this name becomes part of your
   URL: `https://prodash-sync.<your-subdomain>.workers.dev`). Deploy the
   default starter — you'll replace it next.
3. Click **Edit code** (the Quick Edit online editor).
4. Delete everything in the editor and paste in the full contents of
   [`cloud-worker/worker.js`](../cloud-worker/worker.js) from this project.
5. Click **Deploy**.

## 3. Bind the KV namespace to the Worker

1. On the Worker's page: **Settings → Bindings → Add binding → KV Namespace**.
2. Variable name: `PRODASH_KV` (must match exactly — the Worker code refers
   to it by this name). Namespace: the `prodash-kv` you made in step 1. Save.

## 4. Set your password

1. Same **Settings** page: **Variables and Secrets → Add**.
2. Name: `SYNC_PASSWORD` (must match exactly). Value: any password you'll
   remember — this is what every device will need to type in once. Mark it
   **Encrypt** if offered. Save and redeploy if prompted.
3. **Then go to the Deployments tab and confirm your change is actually live**
   (see the gotcha below — this bit us during the real setup and is the most
   likely thing to go wrong).

> **Gotcha, confirmed the hard way:** Cloudflare's newer Workers dashboard
> saves each Settings change (a new/updated variable, a binding) as a new
> **version**, but does **not** automatically push it live. The **Active
> deployment** box on the Deployments tab can keep serving an *older* version
> for several minutes after you've saved a "newer" one in Version History —
> there's no error, no warning, it just silently keeps using the old
> config. Symptom: the Worker responds and looks healthy, but every request
> gets `401 {"error":"unauthorized"}` no matter how carefully the password is
> re-entered, because the live code is still checking the *previous* value.
>
> **The fix:** after saving any variable/secret/binding change, go to
> **Deployments**, find the newest entry in Version History, open its **⋯**
> menu, and explicitly **Deploy** / **promote to Active** it. Only then does
> the "Active deployment" box at the top update to that version and 100% of
> traffic. Verify with a plain unauthenticated request first — an
> unauthenticated `GET /data` should return `401`, which confirms the Worker
> itself is live, before spending time chasing what looks like a password
> problem but might just be an unpromoted deployment.

## 5. Get your Worker's URL

On the Worker's overview page, copy the URL — something like
`https://prodash-sync.davidh.workers.dev`. You'll paste this into ProDash
next, on every device you want synced.

---

## Connecting a device

In ProDash, click the **Cloud: not set up** pill next to the OneDrive one.
You'll be asked for two things, once:

1. The Worker URL from step 5
2. The password from step 4

That's it — the pill turns into **Cloud synced**, and from then on this
device pulls on open/focus and pushes shortly after every change, the same
rhythm the OneDrive sync already uses. Do this on your phone too, same URL
and password, and the two devices are now talking to the same document.

**The password is never written into your data.** It's stored only in this
browser's local storage, never inside the JSON that gets exported, imported,
or sent to the Worker as your actual task data — only sent as a header
proving you're allowed to read/write.

## If something looks wrong

- **"Cloud sync error"** — usually a typo in the URL, or the password doesn't
  match what's set as `SYNC_PASSWORD`. Click the pill to reconnect and
  re-enter both.
- **Data not appearing on the other device** — check both are actually
  connected (pill says "Cloud synced", not "not set up"), then bring the app
  to the foreground on the other device — sync runs on focus, not only in
  the background.
- **Want to disconnect one device** — click its cloud pill, confirm. Data
  already saved to the Worker is untouched; only that device stops talking
  to it.
- **Both OneDrive and cloud sync are on at once** — that's fine. Both use the
  same "whichever copy is newer wins" rule, so they don't conflict with each
  other, just with whichever actually has the latest edit.
