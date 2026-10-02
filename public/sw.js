/*
 * Offline support: network-first for navigations, cache-first for same-origin static assets.
 *
 * Several app versions are hosted side by side (root = current, /v0.1/, /v0.2/ … = archived),
 * each with its own service worker scope. To keep them independent:
 *  - cache names are scoped: "bsc:<scope>:<version>", and activate deletes only older caches
 *    with this worker's own prefix (never another version's cache, e.g. v0.1's "bsc-v1");
 *  - requests for a nested archived version (<scope>vX.Y/…) are left to that version.
 */
const APP = 'v0.2.1';
const SCOPE = self.registration.scope;
const PREFIX = `bsc:${SCOPE}:`;
const CACHE = PREFIX + APP;
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/favicon.svg', './icons/icon-192.png', './versions.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE.filter((u) => u !== './versions.json')).then(() => c.add('./versions.json').catch(() => {}))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(SCOPE)) return;
  const rel = url.href.slice(SCOPE.length);
  if (/^v\d+\.\d+(\/|$)/.test(rel)) return; // an archived version: not ours
  if (req.mode === 'navigate' || rel === 'versions.json') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? './index.html' : req, copy)); }
      return res;
    }).catch(() => caches.open(CACHE).then((c) => c.match(req.mode === 'navigate' ? './index.html' : req)).then((r) => r || caches.open(CACHE).then((c) => c.match('./')))));
    return;
  }
  e.respondWith(caches.open(CACHE).then((c) => c.match(req)).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
