/* v50 (dictée Whisper) — DCAP — service worker de l'enveloppe : notifications Web Push du coach (iPhone : app ajoutée à l'écran d'accueil, iOS 16.4+).
   Pas de cache hors ligne : l'app vit dans Apps Script ; ce worker ne sert qu'aux notifications. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

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
