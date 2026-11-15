// A bare service worker: it makes the app installable and does nothing else.
// No caching and no offline page. Every request goes straight to the network.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// A fetch listener is what the install prompt looks for; it leaves the request alone.
self.addEventListener("fetch", () => {});
