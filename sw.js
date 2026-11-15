// Clutch · service worker: la web se puede instalar como app y se abre sin conexión con lo último que se vio.
const VERSION = 'clutch-v3';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/app.js', 'js/api.js', 'js/config.js', 'js/admin.js', 'js/majors.js', 'js/stats.js', 'js/extras.js',
  'manifest.webmanifest', 'img/icon.svg', 'img/icon-192.png', 'img/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;     // el Worker (pronósticos) siempre va a la red
  const isData = url.pathname.includes('/data/');
  const isImg = /\/img\//.test(url.pathname);
  if (isImg) {                                                                  // imágenes: primero la copia guardada
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }
  // código y datos: primero la red (siempre lo último), si no hay conexión lo guardado
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); const key = isData ? new Request(url.origin + url.pathname) : e.request; caches.open(VERSION).then((c) => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(isData ? new Request(url.origin + url.pathname) : e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || './#/pickem';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    if (open) { open.focus(); return open.navigate ? open.navigate(target) : null; }
    return self.clients.openWindow(target);
  }));
});
