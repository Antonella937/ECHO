const CACHE = 'echo-shell-sessionfix-v3';
const ROOT = new URL('./', self.location.href);
const shell = ['.', 'manifest.webmanifest', 'icon.svg', 'icon-maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(shell.map((path) => new URL(path, ROOT).href)),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('echo-shell-') && key !== CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Never cache third-party APIs, credentials, or server requests.
  if (request.method !== 'GET' || url.origin !== ROOT.origin ||
      !url.pathname.startsWith(ROOT.pathname) ||
      url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(ROOT.href);
        return cached || new Response('ECHO necesita conexión para abrirse por primera vez.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }),
    );
    return;
  }
  if (!['script', 'style', 'image', 'font'].includes(request.destination)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // JS/CSS must be network-first: a stale app shell can keep an old
      // Clerk configuration after a deploy while the API is already updated.
      // Offline fallback is retained without clearing browser/session storage.
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    }),
  );
});
