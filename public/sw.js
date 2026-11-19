// Revalidate the entry document when the installed web app opens.
// Hashed assets can use the browser cache and API calls bypass this worker.
self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || request.mode !== "navigate" ||
      url.origin !== self.location.origin || url.pathname !== "/") return;

  event.respondWith(fetch(request, { cache: "no-cache" }));
});
