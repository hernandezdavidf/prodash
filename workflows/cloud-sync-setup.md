# Workflow: Setting up cloud sync

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
