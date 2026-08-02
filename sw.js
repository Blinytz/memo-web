const CACHE = 'memo-v90';
const PRECACHE = ['./memo.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // Network-first partout : les images locales changent souvent pendant les audits.
  // Le cache ne sert que de secours hors ligne, jamais de source prioritaire.
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        const copy = resp.clone();
        if (resp.status === 200) {
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
