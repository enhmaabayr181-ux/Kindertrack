/* KinderTrack service worker
   - Versioned app-shell cache
   - Network-first for navigations (so ?v= updates always load newest)
   - Never caches Supabase API, auth, or any non-GET request
   - Update flow driven by the page (SKIP_WAITING message)
*/
const SW_VERSION = 'kt-v3';
const SHELL_CACHE = SW_VERSION + '-shell';
const STATIC_CACHE = SW_VERSION + '-static';
const SHELL_KEY = 'shell';

// Origins whose responses must NEVER be cached (private user data / auth)
function isPrivateHost(url) {
  return url.hostname.indexOf('supabase.co') >= 0 ||
         url.hostname.indexOf('supabase.in') >= 0;
}

self.addEventListener('install', function (e) {
  // Do not force activation; the page decides when to update.
  e.waitUntil(self.skipWaiting ? Promise.resolve() : Promise.resolve());
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k.indexOf(SW_VERSION) !== 0) return caches.delete(k);
          return null;
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  const req = e.request;

  // Only GET is ever cached or served from cache.
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Never touch Supabase (API, auth, storage) — always straight to network.
  if (isPrivateHost(url)) return;

  // App shell: network-first, fall back to last good copy when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          try {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then(function (c) { c.put(SHELL_KEY, copy); });
          } catch (_) {}
          return res;
        })
        .catch(function () {
          return caches.open(SHELL_CACHE).then(function (c) {
            return c.match(SHELL_KEY).then(function (hit) {
              return hit || new Response(
                '<!doctype html><meta charset="utf-8"><title>KinderTrack</title>' +
                '<div style="font-family:system-ui;padding:40px;text-align:center;color:#374151">' +
                '<div style="font-size:34px">📴</div>' +
                '<h1 style="font-size:18px">Интернэтгүй байна</h1>' +
                '<p style="font-size:14px;color:#6b7280">Аппыг нэг удаа онлайнаар нээсний дараа офлайнаар ажиллана.</p></div>',
                { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
              );
            });
          });
        })
    );
    return;
  }

  // Safe same-origin static assets: stale-while-revalidate.
  if (url.origin === self.location.origin && /\.(css|js|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname)) {
    e.respondWith(
      caches.open(STATIC_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          const net = fetch(req).then(function (res) {
            if (res && res.status === 200 && res.type === 'basic') {
              try { cache.put(req, res.clone()); } catch (_) {}
            }
            return res;
          }).catch(function () { return hit; });
          return hit || net;
        });
      })
    );
    return;
  }

  // Everything else: default network behaviour, no caching.
});
