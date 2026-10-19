
const CACHE_NAME = "penny-shell-v1";
const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.webmanifest",
  "./icons/icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      if (event.request.mode === "navigate") {
        return caches.match("./index.html");
      }

      return new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain" }
      });
    })
  );
});
