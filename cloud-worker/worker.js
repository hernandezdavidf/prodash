// ProDash cloud sync — a Cloudflare Worker.
//
// This file is NOT deployed by GitHub Pages. GitHub Pages only serves static
// files; a Worker is a separate Cloudflare product with its own deployment
// step. Paste this file's contents into the Cloudflare dashboard's Quick Edit
// editor and click Deploy — see ../workflows/cloud-sync-setup.md for the
// full walkthrough. No secret lives in this file (the password is set as a
// Cloudflare environment variable, never written here), so committing it to
// the repo is safe even though the repo is public.
//
// Storage: one JSON blob under the key "state" in a KV namespace bound as
// PRODASH_KV. That's the whole database — one user, one document.
//
// GET  /data  -> the stored blob, or null if nothing's been saved yet
// PUT  /data  -> replace the stored blob with the request body
// Both require: Authorization: Bearer <password>
//
// CORS is wide open (`*`). That's deliberate, not an oversight: this app is
// opened from file://, from GitHub Pages, and potentially a custom domain
// later, so there's no one fixed origin to allow-list. The password is the
// actual gate, not the browser's origin check.

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/data") {
      return json({ error: "not found" }, 404);
    }

    const provided = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!env.SYNC_PASSWORD || provided !== env.SYNC_PASSWORD) {
      return json({ error: "unauthorized" }, 401);
    }

    if (request.method === "GET") {
      const stored = await env.PRODASH_KV.get("state");
      return json(stored ? JSON.parse(stored) : null);
    }

    if (request.method === "PUT") {
      let body;
      try {
        body = await request.text();
        JSON.parse(body); // reject anything that isn't valid JSON before storing it
      } catch (e) {
        return json({ error: "invalid JSON body" }, 400);
      }
      await env.PRODASH_KV.put("state", body);
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
