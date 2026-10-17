importScripts("./precache.js");
const PREFIX = `pdfhelper:${self.registration.scope}:`;
const CACHE = PREFIX + self.PDFHELPER_VERSION;
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(
        self.PDFHELPER_ASSETS.map(
          (path) =>
            new Request(new URL(path, self.registration.scope), {
              cache: "reload",
            }),
        ),
      );
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith(PREFIX) && name !== CACHE)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.href.startsWith(self.registration.scope)
  )
    return;
  const known = new Set(
    self.PDFHELPER_ASSETS.map(
      (path) => new URL(path, self.registration.scope).href,
    ),
  );
  if (event.request.mode === "navigate")
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) =>
          cache.match(new URL("./index.html", self.registration.scope)),
        ),
    );
  else if (known.has(url.href))
    event.respondWith(
      caches
        .open(CACHE)
        .then(
          async (cache) =>
            (await cache.match(event.request)) || fetch(event.request),
        ),
    );
});
function queryClient(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, 3000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data?.ready === true);
    };
    client.postMessage({ type: "UPDATE_QUERY" }, [channel.port2]);
  });
}
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE") {
    if (
      event.source?.scriptURL === self.location.href &&
      event.source.state === "activated"
    )
      event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type === "REQUEST_UPDATE")
    event.waitUntil(
      (async () => {
        const clients = (
          await self.clients.matchAll({ type: "window" })
        ).filter((client) => client.url.startsWith(self.registration.scope));
        const answers = await Promise.all(clients.map(queryClient));
        if (!answers.every(Boolean) || !self.registration.waiting) {
          event.source?.postMessage({ type: "UPDATE_BLOCKED" });
          return;
        }
        for (const client of clients)
          client.postMessage({ type: "UPDATE_APPROVED" });
        self.registration.waiting.postMessage({ type: "ACTIVATE" });
      })(),
    );
});
