/* Insightyyy service worker — APP SHELL ONLY (PRD §2.3).
 * IndexedDB data is never duplicated into the SW cache. The build id and precache
 * list are stamped at build time, so every deploy busts the shell cache. */
const BUILD_ID = __BUILD_ID__;
const SHELL_CACHE = `insightyyy-shell-${BUILD_ID}`;
const SHARE_CACHE = 'insightyyy-share-intake';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // A new shell must activate promptly — never serve a stale shell against a
      // newer schema version (PRD §2.3).
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('insightyyy-shell-') && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Android share_target intake (PRD §3.A.2): stash shared payload, redirect to app. */
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    const files = formData.getAll('images').filter((f) => typeof f !== 'string');
    let index = 0;
    for (const file of files) {
      await cache.put(
        new Request(`/__share__/file-${Date.now()}-${index++}`),
        new Response(file, { headers: { 'Content-Type': file.type || 'image/*' } }),
      );
    }
    const text = [formData.get('title'), formData.get('text'), formData.get('url')]
      .filter((v) => typeof v === 'string' && v.trim())
      .join('\n');
    if (text) {
      await cache.put(
        new Request(`/__share__/text-${Date.now()}`),
        new Response(text, { headers: { 'Content-Type': 'text/plain' } }),
      );
    }
  } catch (err) {
    // Fall through to the redirect; the app will simply find no intake.
  }
  return Response.redirect('/?share-target=1', 303);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/__share__/')) return;

  // ignoreVary: crossorigin module-script requests carry an Origin header the
  // precache request lacked; a served `Vary` header would otherwise force a miss.
  const matchOpts = { cacheName: SHELL_CACHE, ignoreVary: true };
  event.respondWith(
    caches.match(event.request, matchOpts).then((cached) => {
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        // Offline navigation falls back to the cached shell.
        return caches.match('/index.html', matchOpts).then((shell) => shell ?? fetch(event.request));
      }
      // Anything not precached is fetched from the network and NOT cached —
      // the shell cache never grows beyond the build's own assets.
      return fetch(event.request);
    }),
  );
});
