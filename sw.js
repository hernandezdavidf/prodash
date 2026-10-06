// ProDash service worker.
//
// Bump CACHE_VERSION whenever index.html (or this file) changes in a way
// that should reach every device promptly - the old cache is deleted on the
// next activate, so this is the mechanism that pushes an update out.
//
// The app moved from dayflow.html to index.html so the URL is a clean
// ".../prodash/" instead of ".../prodash/dayflow.html". Bumping the version
// below is what evicts the old cached dayflow.html; without it a phone would
// keep serving the file from the previous name indefinitely.
//
// Two strategies, deliberately different:
//   - the app shell (index.html, manifest.json): network-first, falling
//     back to cache when offline. This is a frequently-edited personal app;
//     cache-first here would mean "why isn't my update showing up" every
//     single time something changes. Online should always mean fresh.
//   - static assets (icons): cache-first. They never change without also
//     changing CACHE_VERSION, so there's nothing to gain by re-fetching them
//     every load, and it's one less network round-trip before the icon paints.
const CACHE_VERSION = "prodash-v33";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
];
const STATIC_ASSETS = [
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

// The offline Bible: 4 MB of KJV, in a cache OF ITS OWN.
//
// This is load-bearing, not tidiness. CACHE_VERSION is bumped on essentially
// every release, and activate wipes every cache that is not the current one -
// so if this file lived in the app-shell cache, each routine update would
// throw away 4 MB and re-download it, on a phone, possibly on mobile data.
// Here it survives app updates and is re-fetched only when the name below
// changes, which should happen only if the file itself does.
const BIBLE_CACHE = "prodash-bible-kjv-v1";
const BIBLE_ASSET = "./bible/kjv.json";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll([...APP_SHELL, ...STATIC_ASSETS])
    )
  );
  /* Separately, and deliberately NOT part of the install promise above: a
     slow or failed 4 MB download must not fail the whole service worker
     install and leave the app with no offline copy of itself. Already-cached
     is checked first so a reinstall (new CACHE_VERSION) costs nothing. */
  event.waitUntil(
    caches.open(BIBLE_CACHE)
      .then((cache) => cache.match(BIBLE_ASSET)
        .then((hit) => (hit ? null : cache.add(BIBLE_ASSET))))
      .catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_VERSION && name !== BIBLE_CACHE)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;               // never intercept sync PUT/POST
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin (the sync endpoint)

  // Cache-first, from its own cache, and never network-first: it is a fixed
  // public-domain text, it is what makes the widget work on a plane, and
  // re-validating 4 MB on each open would defeat the point of having it.
  if (url.pathname.endsWith("/bible/kjv.json")) {
    event.respondWith(
      caches.open(BIBLE_CACHE).then((cache) =>
        cache.match(req).then((hit) =>
          hit || fetch(req).then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
        )
      )
    );
    return;
  }

  const isAppShell = APP_SHELL.some((p) => url.pathname.endsWith(p.replace("./", "/")));

  if (isAppShell || req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
