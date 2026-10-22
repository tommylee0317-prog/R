// RUNLOG service worker: lets the demo open offline and be installed on a phone.
// Bump VERSION when files change so old caches are dropped.
const VERSION = 'runlog-v3';
const ASSETS = [
  './', 'index.html', 'styles.css', 'challenge.css', 'sports-theme.css', 'text-scale.css', 'taipei.css',
  'appearance.css', 'person.css', 'viewmode.css', 'features.css', 'sport.css',
  'xlsx.full.min.js', 'race-snapshot.js', 'script.js', 'appearance.js', 'viewmode.js', 'features.js',
  'runlog-logo.png', 'runlog-runner-white.png', 'icon.svg', 'manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => Promise.all(ASSETS.map(asset => cache.add(asset).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const store = (request, response) => {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(VERSION).then(cache => cache.put(request, copy));
  }
  return response;
};

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages and the downloaded race lists: always try the network first so updates show immediately.
  const networkFirst = request.mode === 'navigate' || /\/data-[^/]+\.html$/.test(url.pathname);
  if (networkFirst) {
    event.respondWith(
      fetch(request).then(response => store(request, response))
        .catch(() => caches.match(request).then(cached => cached || caches.match('index.html')))
    );
    return;
  }

  // Everything else: serve from cache, refresh in the background.
  event.respondWith(
    caches.match(request).then(cached => {
      const fresh = fetch(request).then(response => store(request, response)).catch(() => cached);
      return cached || fresh;
    })
  );
});
