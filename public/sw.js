const CACHE_NAME = 'personal-cyber-os-shell-v4';
const STATIC_PATH = /^\/(?:assets\/[^/]+\.(?:js|css)|manifest\.webmanifest|icons\/[^/]+\.svg|favicon\.svg)$/;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const response = await fetch('/index.html');
    if (!response.ok) throw new Error('App shell unavailable');
    const html = await response.text();
    const manifestResponse = await fetch('/asset-manifest.json');
    if (!manifestResponse.ok) throw new Error('Static asset manifest unavailable');
    const buildManifest = await manifestResponse.json();
    const buildAssets = Object.values(buildManifest).flatMap((entry) => [entry.file, ...(entry.css ?? [])]).filter((path) => /\.(?:js|css)$/.test(path)).map((path) => path.startsWith('/') ? path : `/${path}`);
    const htmlAssets = [...html.matchAll(/(?:src|href)="(\/(?:assets\/[^\"]+\.(?:js|css)|manifest\.webmanifest|icons\/[^\"]+\.svg|favicon\.svg))"/g)].map((match) => match[1]);
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...new Set(['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/favicon.svg', ...htmlAssets, ...buildAssets])]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch { return (await caches.match('/index.html')) ?? Response.error(); }
    })());
    return;
  }
  if (!STATIC_PATH.test(url.pathname)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreVary: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    } catch { return Response.error(); }
  })());
});
