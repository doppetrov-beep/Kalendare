const CACHE_NAME = 'my-shifts-v2';
const ASSETS = ['./','./index.html','./manifest.webmanifest','./icon-192.png','./apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method!=='GET' || new URL(event.request.url).origin!==self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
