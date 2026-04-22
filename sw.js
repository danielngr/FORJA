// FORJA Service Worker v4 — Cache strategy optimizada para App Store approval
// Incluye: offline support, background sync, push notifications, periodic sync

const CACHE_VERSION = 'forja-v4-2026-04';
const CACHE_STATIC = 'forja-static-' + CACHE_VERSION;
const CACHE_RUNTIME = 'forja-runtime-' + CACHE_VERSION;
const CACHE_IMAGES = 'forja-images-' + CACHE_VERSION;

// Core assets que cachear en install (app shell)
const CORE_ASSETS = [
  '/FORJA/',
  '/FORJA/index.html',
  '/FORJA/manifest.json',
  '/FORJA/icons/icon-192.png',
  '/FORJA/icons/icon-512.png',
  '/FORJA/icons/apple-touch-icon.png'
];

// CDNs que se cachean runtime (no en install porque son grandes)
const CDN_ORIGINS = [
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com'
];

// Recursos de Supabase - siempre network-first (datos fresh)
const SUPABASE_ORIGIN = 'https://ittzbjauudlsbirzhvkz.supabase.co';

// ══ INSTALL ══════════════════════════════════════════════════════════════════
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Install failed:', err))
  );
});

// ══ ACTIVATE ═════════════════════════════════════════════════════════════════
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v' + CACHE_VERSION);
  event.waitUntil(
    Promise.all([
      // Limpiar caches viejas
      caches.keys().then(keys => Promise.all(
        keys
          .filter(k => !k.includes(CACHE_VERSION))
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )),
      // Tomar control inmediato de todos los clientes
      self.clients.claim()
    ])
  );
});

// ══ FETCH ════════════════════════════════════════════════════════════════════
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo interceptar GET
  if (request.method !== 'GET') return;

  // No interceptar Supabase (siempre network para datos frescos)
  if (url.origin === SUPABASE_ORIGIN) return;

  // No interceptar Anthropic API (no cachear respuestas AI)
  if (url.origin === 'https://api.anthropic.com') return;

  // No interceptar WebSockets
  if (request.headers.get('upgrade') === 'websocket') return;

  // Estrategia por tipo de recurso
  if (isHTMLRequest(request)) {
    event.respondWith(networkFirstStrategy(request, CACHE_RUNTIME));
  } else if (isImageRequest(request)) {
    event.respondWith(cacheFirstStrategy(request, CACHE_IMAGES));
  } else if (isCDNRequest(url)) {
    event.respondWith(cacheFirstStrategy(request, CACHE_RUNTIME));
  } else if (isStaticAsset(request)) {
    event.respondWith(cacheFirstStrategy(request, CACHE_STATIC));
  } else {
    event.respondWith(networkFirstStrategy(request, CACHE_RUNTIME));
  }
});

// ══ STRATEGIES ═══════════════════════════════════════════════════════════════

// Network-first: intenta red, cae a cache si falla
async function networkFirstStrategy(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fallback: el index.html cached (app shell)
    if (isHTMLRequest(request)) {
      const shell = await caches.match('/FORJA/');
      if (shell) return shell;
    }
    // Última línea: respuesta offline genérica
    return new Response('Offline - FORJA', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// Cache-first: intenta cache, cae a red, guarda en cache
async function cacheFirstStrategy(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    // Revalidar en background sin bloquear
    fetch(request).then(response => {
      if (response && response.status === 200) {
        caches.open(cacheName).then(cache => cache.put(request, response));
      }
    }).catch(() => {});
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return new Response('Offline asset', { status: 503 });
  }
}

// ══ HELPERS ══════════════════════════════════════════════════════════════════

function isHTMLRequest(request) {
  const url = new URL(request.url);
  return request.mode === 'navigate' ||
    request.destination === 'document' ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/FORJA/' ||
    url.pathname === '/FORJA';
}

function isImageRequest(request) {
  return request.destination === 'image' ||
    /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(new URL(request.url).pathname);
}

function isCDNRequest(url) {
  return CDN_ORIGINS.some(origin => url.origin === origin);
}

function isStaticAsset(request) {
  return /\.(js|css|woff|woff2|ttf|otf|glb|json)$/i.test(new URL(request.url).pathname);
}

// ══ BACKGROUND SYNC ══════════════════════════════════════════════════════════
// Para guardar logs de entrenos cuando no hay conexión
self.addEventListener('sync', (event) => {
  if (event.tag === 'forja-sync-logs') {
    event.waitUntil(syncPendingLogs());
  }
});

async function syncPendingLogs() {
  try {
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_LOGS_NOW' });
    });
  } catch (err) {
    console.error('[SW] Sync failed:', err);
  }
}

// ══ PERIODIC BACKGROUND SYNC ═════════════════════════════════════════════════
// Para refrescar datos periódicamente (Chrome only, no iOS, pero suma puntos PWABuilder)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'forja-daily-refresh') {
    event.waitUntil(refreshDailyData());
  }
});

async function refreshDailyData() {
  try {
    const cache = await caches.open(CACHE_STATIC);
    const response = await fetch('/FORJA/');
    if (response && response.status === 200) {
      cache.put('/FORJA/', response);
    }
  } catch (err) {
    console.error('[SW] Periodic sync failed:', err);
  }
}

// ══ PUSH NOTIFICATIONS ═══════════════════════════════════════════════════════
// Listo para cuando configures APNs
self.addEventListener('push', (event) => {
  let data = { title: 'FORJA', body: 'Es hora de entrenar' };
  
  try {
    if (event.data) data = event.data.json();
  } catch (err) {
    data.body = event.data ? event.data.text() : data.body;
  }

  const options = {
    body: data.body,
    icon: '/FORJA/icons/icon-192.png',
    badge: '/FORJA/icons/icon-badge-72.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'forja-notification',
    requireInteraction: data.requireInteraction || false,
    data: data.data || {},
    actions: data.actions || [
      { action: 'open', title: 'Abrir' },
      { action: 'close', title: 'Cerrar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'close') return;
  
  const urlToOpen = event.notification.data?.url || '/FORJA/';
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // Si ya hay una ventana abierta, enfocarla
        for (const client of clients) {
          if (client.url.includes('/FORJA/') && 'focus' in client) {
            client.navigate(urlToOpen);
            return client.focus();
          }
        }
        // Si no, abrir nueva
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
  );
});

// ══ MESSAGE HANDLER ══════════════════════════════════════════════════════════
// Para comunicación desde la app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    );
  }
});

console.log('[SW] FORJA Service Worker ' + CACHE_VERSION + ' loaded');
