/* Nakhl Restaurant — Service Worker
 * Strategies:
 *  - Precache: app shell (manifest, icons, logo, hero) on install
 *  - /api/menu: stale-while-revalidate (offline menu browsing)
 *  - Static assets (/_next/static, /food, /uploads, icons, logo): cache-first
 *  - Navigation (HTML): network-first, fallback to cached "/"
 *  - Other /api/*: network-only (auth/session-dependent)
 *  - Cross-origin: pass-through (no interception)
 */
const VERSION = "nakhl-v2";
const CORE_ASSETS = [
  "/",
  "/manifest.json",
  "/logo.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/food/hero.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // core assets — use addAll but ignore individual failures (e.g. if a path 404s in dev)
      await Promise.all(
        CORE_ASSETS.map((url) =>
          cache.add(url).catch(() => {})
        )
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin: pass through

  // 1) menu API — stale-while-revalidate
  if (url.pathname === "/api/menu") {
    event.respondWith(staleWhileRevalidate(req, "nakhl-menu"));
    return;
  }

  // 2) static assets — cache-first
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/food/") ||
    url.pathname.startsWith("/uploads/") ||
    /^\/icon-(192|512|maskable-512)\.png$/.test(url.pathname) ||
    url.pathname === "/logo.svg" ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(cacheFirst(req, VERSION));
    return;
  }

  // 3) navigation (HTML) — network-first, fallback to cached shell
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  // 4) other same-origin GETs — try network, fall back to cache if present
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || networkPromise;
}

async function networkFirstNavigation(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    // offline: serve cached "/" shell (app continues with client-side routing)
    const shell = await cache.match("/");
    if (shell) return shell;
    return new Response(
      "<!doctype html><meta charset='utf-8'><title>رستوران نخل</title><body style='font-family:Tahoma,sans-serif;background:#f7f4ec;color:#1f5c40;display:flex;min-height:100vh;align-items:center;justify-content:center;flex-direction:column;gap:8px'><h1>🌴 رستوران نخل</h1><p>اتصال اینترنت برقرار نیست؛ لطفاً پس از اتصال مجدد تلاش کنید.</p></body>",
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}
