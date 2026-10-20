/* Bêta retirée : ce service worker remplace l'ancien, vide les caches de la bêta, se désinscrit et renvoie vers l'app principale. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('dcapb-') === 0; }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.registration.unregister(); })
    .then(function () { return self.clients.matchAll({ type: 'window' }); })
    .then(function (cs) { cs.forEach(function (c) { try { c.navigate(new URL('../', self.registration.scope).href); } catch (err) {} }); }));
});
self.addEventListener('fetch', function () { /* rien : réseau direct */ });
