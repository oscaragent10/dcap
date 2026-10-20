/* v58 — DCAP — service worker de l'enveloppe : notifications Web Push du coach + cache de la coquille.
   Coquille (index.html, manifeste, icônes, worker de dictée) servie depuis le cache tout de suite, puis mise à jour en fond
   (stale-while-revalidate). Seules les ressources de ce site (même origine, GET) sont mises en cache : jamais l'iframe Apps Script,
   ni les données, ni les modèles de dictée (déjà gérés par Transformers.js). */
var SHELL = 'dcap-shell-v61', SHELL_URLS = ['./', './index.html', './manifest.webmanifest', './icons/dcap-192.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(SHELL_URLS).catch(function () {}); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('dcap-shell-') === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.clients.claim(); }));
});
self.addEventListener('message', function (e) { if (e.data && e.data.type === 'refresh-shell') e.waitUntil(caches.delete(SHELL)); });
self.addEventListener('fetch', function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;
  if (/\/beta\//.test(u.pathname)) return; // v61 : la bêta PWA (/dcap/beta/) a son propre service worker
  if (/rpe-demo\.html$/.test(u.pathname)) return; // page de démo : toujours fraîche
  var key = r.mode === 'navigate' ? './index.html' : r;
  e.respondWith(caches.open(SHELL).then(function (c) {
    var net = fetch(r, r.mode === 'navigate' ? { cache: 'no-cache' } : undefined).then(function (res) { if (res && res.ok && res.type === 'basic') c.put(key, res.clone()); return res; });
    if (r.mode === 'navigate') { // v58 : page de l'enveloppe en réseau d'abord (3 s max), cache seulement hors ligne → une mise à jour arrive au lancement suivant au plus tard
      var to = new Promise(function (res) { setTimeout(res, 3000); });
      return Promise.race([net, to]).then(function (res) { return res || c.match(key, { ignoreSearch: true }).then(function (h) { return h || net; }); })
        .catch(function () { return c.match(key, { ignoreSearch: true }); });
    }
    return c.match(key, { ignoreSearch: true }).then(function (hit) { if (hit) { e.waitUntil(net.catch(function () {})); return hit; } return net; });
  }));
});

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  var title = d.title || 'Coach DCAP';
  var opts = { body: d.body || 'Nouveau message du coach', icon: 'icons/dcap-192.png', badge: 'icons/dcap-192.png',
    tag: d.tag || 'dcap-coach', renotify: true, data: { url: d.url || './?tab=coach' } };
  var jobs = [self.registration.showNotification(title, opts)];
  if (typeof d.badge === 'number' && self.navigator.setAppBadge) jobs.push(self.navigator.setAppBadge(d.badge).catch(function () {}));
  e.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || './?tab=coach', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) { c.postMessage({ dcap: 1, type: 'open-coach' }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
