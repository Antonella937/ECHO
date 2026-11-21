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

/* Display server-sent Web Push messages and open the relevant ECHO conversation. */
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = typeof payload.title === 'string' ? payload.title.slice(0, 100) : 'ECHO';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 240) : 'Tenés un mensaje nuevo.';
  const groupId = typeof payload.groupId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(payload.groupId) ? payload.groupId : '';
  const target = new URL(groupId ? 'messages/group/' + encodeURIComponent(groupId) + '?from=messages' : 'messages', ROOT);
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: new URL('icon.svg', ROOT).href,
    tag: groupId ? 'echo-group-' + groupId : 'echo-message',
    data: { url: target.href },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || new URL('messages', ROOT).href);
  if (target.origin !== ROOT.origin) return;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (new URL(client.url).origin === target.origin) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
