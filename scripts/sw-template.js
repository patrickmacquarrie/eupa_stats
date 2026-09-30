// Service worker for field use: the app works with no connection once it has loaded once.
// Built by vite.config.ts, which fills in the file list and a version per build.
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `eupa-stats-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", ...PRECACHE])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  // Drop caches from earlier builds.
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("eupa-stats-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    // Pages: the latest when online, the cached app when not.
    event.respondWith(fetch(req).then((res) => { caches.open(CACHE).then((c) => c.put("./", res.clone())); return res; })
      .catch(() => caches.match("./")));
    return;
  }
  if (url.pathname.endsWith(".json") && url.pathname.includes("/assets/")) return; // demo seasons: never cached
  // Built files never change once built: cache first.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
    return res;
  })));
});
