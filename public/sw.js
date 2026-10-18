// Minimal app-shell service worker. API calls are never cached; downloaded audio lives in its own
// cache ("decibel-offline-v1"), written by the page and kept across versions.
const CACHE = "decibel-v4"
const KEEP = new Set([CACHE, "decibel-offline-v1"])
const SHELL = ["/", "/search/", "/library/", "/liked/", "/login/", "/downloads/", "/album/", "/playlist/", "/manifest.webmanifest", "/brand/decibel-mark-symmetric.png", "/brand/decibel-symmetric-icon-192.png"]

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/rest/")) return
  // immutable build assets: cache first
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/")) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copy))
            return res
          }),
      ),
    )
    return
  }
  // pages: network first, fall back to cache (offline)
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(e.request, copy))
          return res
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("/"))),
    )
  }
})
