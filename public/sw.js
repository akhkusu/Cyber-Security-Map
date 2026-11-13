const APP_BASE = new URL(self.registration.scope);
const CACHE_PREFIX = `cyber-security-map-shell:${APP_BASE.pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}v6`;
const STATIC_PATH = /^(?:assets\/[^/]+\.(?:js|css)|manifest\.webmanifest|icons\/[^/]+\.svg|favicon\.svg)$/;
const appUrl = (path) => new URL(path, APP_BASE).href;
const isAppStatic = (url) => url.origin === APP_BASE.origin && url.pathname.startsWith(APP_BASE.pathname) && STATIC_PATH.test(url.pathname.slice(APP_BASE.pathname.length));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const response = await fetch(appUrl('index.html'), { cache: 'no-cache' });
    if (!response.ok) throw new Error('App shell unavailable');
    const html = await response.text();
    const manifestResponse = await fetch(appUrl('asset-manifest.json'), { cache: 'no-cache' });
    if (!manifestResponse.ok) throw new Error('Static asset manifest unavailable');
    const buildManifest = await manifestResponse.json();
    const buildAssets = Object.values(buildManifest).flatMap((entry) => [entry.file, ...(entry.css ?? [])]).map((path) => new URL(path, APP_BASE)).filter(isAppStatic).map((url) => url.href);
    const htmlAssets = [...html.matchAll(/(?:src|href)="([^\"]+)"/g)].map((match) => new URL(match[1], APP_BASE)).filter(isAppStatic).map((url) => url.href);
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...new Set([APP_BASE.href, appUrl('index.html'), appUrl('manifest.webmanifest'), appUrl('icons/icon.svg'), appUrl('favicon.svg'), ...htmlAssets, ...buildAssets])]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== APP_BASE.origin || !url.pathname.startsWith(APP_BASE.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch { return (await caches.open(CACHE_NAME).then((cache) => cache.match(appUrl('index.html')))) ?? Response.error(); }
    })());
    return;
  }
  if (!isAppStatic(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) void cache.put(request, response.clone());
      return response;
    } catch { return Response.error(); }
  })());
});
