/* DCAP PWA (bêta) — service worker : coquille hors ligne + bibliothèques CDN + notifications Web Push du coach.
   Les données ne passent jamais par ce cache (API Apps Script en POST, cache IndexedDB géré par api.js). */
var SHELL = 'dcapb-shell-d113bf8922', LIBS = 'dcapb-libs-v1';
var SHELL_URLS = ['./', './index.html', './app.js', './api.js', './bridge.js', './manifest.webmanifest', './icons/dcap-192.png', './icons/dcap-180.png'];
var LIB_HOSTS = /^(cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(SHELL_URLS.map(function (u) { return new Request(u, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return (k.indexOf('dcapb-shell-') === 0 || k.indexOf('dcap-shell-') === 0) && k !== SHELL; }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (u.origin === self.location.origin) {
    if (u.pathname.indexOf(new URL('./', self.registration.scope).pathname) !== 0) return; // hors de notre dossier : pas touche
    if (/\/beta\//.test(u.pathname) || /rpe-demo\.html$/.test(u.pathname)) return; // ancienne bêta / démo : jamais via ce cache
    var key = r.mode === 'navigate' ? './index.html' : u.pathname.replace(/^.*\//, './') || './';
    e.respondWith(caches.open(SHELL).then(function (c) {
      return c.match(key, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(r).then(function (res) { return res; });
        return hit || net.catch(function () { return c.match('./index.html'); });
      });
    }));
    return;
  }
  if (LIB_HOSTS.test(u.hostname)) {
    e.respondWith(caches.open(LIBS).then(function (c) {
      return c.match(r).then(function (hit) {
        var net = fetch(r).then(function (res) { if (res && (res.ok || res.type === 'opaque')) c.put(r, res.clone()); return res; });
        if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
        return net;
      });
    }));
  }
});
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  var opts = { body: d.body || 'Nouveau message du coach', icon: 'icons/dcap-192.png', badge: 'icons/dcap-192.png', tag: d.tag || 'dcap-coach', renotify: true, data: { url: './?tab=coach' } };
  var jobs = [self.registration.showNotification(d.title || 'Coach DCAP', opts)];
  if (typeof d.badge === 'number' && self.navigator.setAppBadge) jobs.push(self.navigator.setAppBadge(d.badge).catch(function () {}));
  e.waitUntil(Promise.all(jobs));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL('./?tab=coach', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { var c = list[i]; if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) { c.postMessage({ dcap: 1, type: 'open-coach' }); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
