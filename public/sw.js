const CACHE_NAME = 'qalumo-shell-v6';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/qalumo.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const assets = new Set(APP_SHELL);
      const manifestResponse = await fetch('/build-manifest.json');
      if (!manifestResponse.ok) throw new Error('The production asset manifest could not be loaded.');
      const manifest = await manifestResponse.json();
      const entry = manifest['index.html'] || Object.values(manifest).find((item) => item.isEntry);
      if (!entry || !entry.isEntry) throw new Error('The production app entry was not found in the build manifest.');

      const visited = new Set();
      const addEntry = (item) => {
        if (visited.has(item)) return;
        visited.add(item);
        assets.add(`/${item.file}`);
        (item.css || []).forEach((file) => assets.add(`/${file}`));
        (item.assets || []).forEach((file) => assets.add(`/${file}`));
        (item.imports || []).forEach((key) => {
          if (manifest[key]) addEntry(manifest[key]);
        });
        (item.dynamicImports || []).forEach((key) => {
          if (manifest[key]) addEntry(manifest[key]);
        });
      };
      addEntry(entry);
      assets.add('/build-manifest.json');
      await cache.addAll([...assets]);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreVary: true });
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      if (request.mode === 'navigate') {
        const shell = await caches.match('/index.html');
        if (shell) return shell;
      }
      throw error;
    }
  })());
});
