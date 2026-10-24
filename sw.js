// Car Finder – Service Worker
// App-Dateien werden offline vorgehalten; Kartenkacheln kommen immer aus dem Netz.
const CACHE = 'carfinder-v11';
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './theme.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './manrope.woff2',
  './sora.woff2',
  './leaflet.css',
  './leaflet.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Kartenkacheln: nicht cachen
  if (url.hostname.endsWith('tile.openstreetmap.org')) return;

  // Seite selbst: erst Netz (für Updates), sonst Cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        // Nur echte Seiten zwischenspeichern – eine 404-Fehlerseite darf die App im Cache nicht überschreiben
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Alles andere (Leaflet, Schriften, Icons): erst Cache, dann Netz – nur eigene Dateien
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
