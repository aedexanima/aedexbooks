const CACHE = 'aedexbooks-v4';
const APP_SHELL = [
  '/app',
  '/app.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// Install: cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(APP_SHELL.filter(u => u.startsWith('/'))))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches (don't claim existing clients — avoids mid-session reload)
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Never cache these — let them go straight to network
  if (url.includes('googleapis.com') ||
      url.includes('accounts.google.com') ||
      url.includes('gsi/client') ||
      url.includes('formspree.io') ||
      url.includes('cloudflareinsights.com')) {
    return;
  }

  // Network-first for HTML (always get latest app), cache-first for other assets
  const isDocument = e.request.destination === 'document' || url.endsWith('/') || url.endsWith('/index.html') || url.endsWith('/app') || url.endsWith('/app.html');

  if (isDocument) {
    e.respondWith(
      fetch(e.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return response;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (e.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      });
    }).catch(() => {
      if (e.request.destination === 'document') {
        return caches.match('/app.html');
      }
    })
  );
});
