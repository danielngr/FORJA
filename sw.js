// ════════════════════════════════════════════════════════════════════
// FORJA Service Worker v1.0.1 — silent caching for offline support
// ════════════════════════════════════════════════════════════════════
// CHANGELOG v1.0.1:
// - Cachea CDNs externos (unpkg, cdnjs, jsdelivr) para que React/Three/etc
//   funcionen offline
// - No cachea respuestas no-OK
// - Mejor handling de navigate requests (fallback al HTML cacheado)
// ════════════════════════════════════════════════════════════════════

const CACHE_VERSION = 'forja-v1.0.3';
const APP_CACHE    = `${CACHE_VERSION}-app`;
const ASSETS_CACHE = `${CACHE_VERSION}-assets`;
const VIDEOS_CACHE = `${CACHE_VERSION}-videos`;

const APP_SHELL = [
  './',
  './forja_paywall_fix.html',
  './forja_body.glb',  // GLB del maniquí — crítico para onboarding visual
];

const VIDEO_PATTERN    = /\.mp4$/i;
const GLB_PATTERN      = /\.glb$/i;
const IMAGE_PATTERN    = /\.(png|jpg|jpeg|webp|svg|ico)$/i;
const FONT_PATTERN     = /\.(woff2?|ttf|otf)$/i;
const SUPABASE_PATTERN = /supabase\.co/i;
// CDNs que tu HTML usa (React, Babel, Three.js, lucide, fonts)
const CDN_PATTERN      = /(unpkg\.com|cdnjs\.cloudflare\.com|jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)/i;

// ─── INSTALL ───
self.addEventListener('install', (event) => {
  console.log('[SW] Installing', CACHE_VERSION);
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] Install failed:', err))
  );
});

// ─── ACTIVATE: limpiar caches viejos ───
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH: routing strategy ───
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // Supabase: network-only
  if (SUPABASE_PATTERN.test(url.hostname)) {
    event.respondWith(networkOnly(request));
    return;
  }

  // CDNs (React, Three.js, Babel, fonts): cache-first (no cambian)
  if (CDN_PATTERN.test(url.hostname)) {
    event.respondWith(cacheFirst(request, ASSETS_CACHE));
    return;
  }

  // Videos: cache-first
  if (VIDEO_PATTERN.test(url.pathname)) {
    event.respondWith(cacheFirst(request, VIDEOS_CACHE));
    return;
  }

  // GLBs / imágenes / fonts: cache-first
  if (GLB_PATTERN.test(url.pathname) ||
      IMAGE_PATTERN.test(url.pathname) ||
      FONT_PATTERN.test(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSETS_CACHE));
    return;
  }

  // HTML/JS/CSS y todo lo demás: network-first
  event.respondWith(networkFirst(request, APP_CACHE));
});

// ─── HELPERS ───

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Cachear si OK o si es opaque (CDN cross-origin sin CORS)
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (e) {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./forja_paywall_fix.html') ||
                       await cache.match('./');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503 });
  }
}

// ─── MENSAJES desde el cliente (para Día 2 - pre-cache rutina) ───
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Acepta ambos nombres por compatibilidad
  if (event.data?.type === 'PRECACHE_VIDEOS' || event.data?.type === 'CACHE_VIDEOS') {
    const urls = event.data.urls || [];
    event.waitUntil(precacheVideos(urls));
  }

  if (event.data?.type === 'CLEAR_VIDEO_CACHE' || event.data?.type === 'CLEAR_VIDEOS_CACHE') {
    event.waitUntil(caches.delete(VIDEOS_CACHE));
  }
});

async function precacheVideos(urls) {
  const cache = await caches.open(VIDEOS_CACHE);
  const BATCH_SIZE = 3;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (url) => {
        try {
          const cached = await cache.match(url);
          if (cached) return;
          const response = await fetch(url);
          if (response.ok) {
            await cache.put(url, response);
          }
        } catch (e) {
          // silent fail
        }
      })
    );
  }
}
