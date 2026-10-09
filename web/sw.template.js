// melty service worker. It caches the app itself (the built HTML, scripts, styles, fonts
// and images) so the start screen opens fast and offline. That's all it does:
//   - it only answers GET requests for our own origin's static files
//   - it never sees messages: they travel over the WebSocket to the relay, which a
//     service worker can't intercept, and live only in the page's memory
//   - it never stores anything a page sends it, and nothing with a query string
//   - the part of a room link after # never reaches a service worker (browsers strip it)
const VERSION = "__VERSION__";
const CACHE = `melty-app-${VERSION}`;
const ASSETS = __ASSETS__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.search !== "") return;

  // pages (/, /r, /how): the network first, so a new version shows up; the cached shell when offline
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/index.html", { cacheName: CACHE })));
    return;
  }
  // hashed build files and brand images: from the cache, which install filled
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname, { cacheName: CACHE }).then((hit) => hit ?? fetch(req)));
  }
});
