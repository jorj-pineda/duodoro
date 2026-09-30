// Service worker for Duodoro PWA installability + an offline fallback.
//
// Deliberately does NOT cache app responses. Timer state is server-authoritative
// and socket.io / Supabase RPC replies would be actively harmful to serve stale,
// so the app shell still comes from the network every time.
//
// What it does add: a branded offline page. Without it, an *installed* PWA with
// no connection showed the browser's own error page — the worst possible result
// from tapping a home-screen icon, and indistinguishable from the app being
// broken.

const CACHE = "duodoro-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // reload bypasses the HTTP cache so a deploy can't leave a stale copy.
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // Drop caches from earlier versions of this file.
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  // Navigations only. Everything else — JS chunks, CSS, socket.io polling,
  // Supabase REST — is left completely untouched, which is what keeps stale
  // session data off the screen.
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      // If even the fallback is missing, let the browser do its usual thing.
      return cached ?? Response.error();
    }),
  );
});

// Notifications are requested by an open page, never scheduled or pushed.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const home = windows.find((client) => {
      const url = new URL(client.url);
      return url.origin === self.location.origin && url.pathname === "/";
    });
    if (home) return home.focus();
    return self.clients.openWindow("/");
  })());
});
