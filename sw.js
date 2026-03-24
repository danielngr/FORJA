// FORJA Service Worker v2 — actualizar este número fuerza recarga en todos los dispositivos
const CACHE = 'forja-v2';
const ASSETS = [
  '/FORJA/',
  '/FORJA/index.html',
  '/FORJA/manifest.json',
];

// Instalar — cachear assets principales
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting()) // fuerza activación inmediata
  );
});

// Activar — borrar caches viejos (v1, etc)
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => {
        console.log('[SW] Borrando cache viejo:', k);
        return caches.delete(k);
      }))
    ).then(() => self.clients.claim()) // toma control de todas las tabs
  );
});

// Fetch — network first para HTML (siempre versión nueva), cache first para assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Supabase, Google APIs, Bunny CDN — siempre network, nunca cachear
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('bunny.net') ||
      url.hostname.includes('fonts.gstatic.com')) {
    return;
  }

  // HTML principal — network first, fallback a caché
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match('/FORJA/index.html'))
    );
    return;
  }

  // Otros assets — cache first, fallback network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && e.request.method === 'GET') {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => caches.match('/FORJA/'));
    })
  );
});
