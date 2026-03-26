// FORJA Service Worker v1
const CACHE = 'forja-v1';
const OFFLINE_URL = '/FORJA/';

// Assets to cache on install
const PRECACHE = [
  '/FORJA/',
  '/FORJA/index.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  // Remove old caches
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Only handle GET requests
  if (e.request.method !== 'GET') return;
  
  const url = new URL(e.request.url);
  
  // For navigation requests (HTML pages): network first, fallback to cache
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return r;
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // For CDN videos (bunny.net): network only, no cache (too large)
  if (url.hostname.includes('b-cdn.net')) return;

  // For everything else: cache first, then network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(r => {
        if (r && r.status === 200 && r.type === 'basic') {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return r;
      });
    })
  );
});
