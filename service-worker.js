const CACHE_NAME = "grocery-pos-v88";
const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./firebase-config.js",
  "./app-icon-pos.png"
];

// Files are cached one at a time, and a failure is tolerated.
//
// The previous version used cache.addAll, which rejects the whole batch if any
// single file 404s. The icon files it listed were never in the repository, so
// installation failed every time and the service worker never activated at
// all — no offline support, and updates that only a manual cache clear could
// shift. Caching each file separately means one missing file costs that file
// and nothing else.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn("[sw] could not cache", url, err);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Two strategies, chosen by what the file is.
//
// THE PAGE AND ITS SCRIPTS — network first.
//   The previous version served these from the cache whenever a copy existed,
//   asking the server only when it had nothing. That made the app fast but
//   effectively un-updatable: a new version could sit on the server for days
//   while the phone kept showing the old one, and the only cure was clearing
//   site data by hand. Now the network is tried first and the fresh copy is
//   saved as it arrives; if the connection is down or slow to fail, the cached
//   copy is served instead, so the shop still opens with no signal.
//
// ICONS AND THE MANIFEST — cache first.
//   These change once in a blue moon and are worth nothing but load time.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Firebase's own traffic (Firestore sync, auth, the SDK from gstatic) is
  // cross-origin and must go straight to the network — Firestore's built-in
  // offline persistence handles queuing for those.
  if (url.origin !== self.location.origin) return;

  const isDocument =
    event.request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".js");

  if (isDocument) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) =>
            cached || caches.match("./index.html")
          )
        )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
