const version = "kalendare-reader-v2";
importScripts("./assets.js");
self.addEventListener("install", event => {
  event.waitUntil(caches.open(version).then(cache => cache.addAll(self.readerAssets)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("kalendare-reader-") && key !== version).map(key => caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(version).then(async cache => (await cache.match(event.request,{ignoreSearch:true})) ?? fetch(event.request)));
});
