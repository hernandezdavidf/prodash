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
const CACHE_VERSION = "prodash-v2";

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

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll([...APP_SHELL, ...STATIC_ASSETS])
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_VERSION)
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
