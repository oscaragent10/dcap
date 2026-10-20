/* DCAP PWA — couche données : API JSON Apps Script + cache IndexedDB + file d'attente hors ligne.
   Aucun secret ici : le jeton UI (le même que la page /exec publique) est récupéré au démarrage via ?api=boot. */
(function () {
  'use strict';
  var EXEC = 'https://script.google.com/macros/s/AKfycbyunieVSGlSiZE0ZwaN_oAKHC9ZP7cRzIcttweKO-_ulkpsDzItiS67UT0ziRDr6otL/exec';
  var P = 'dcapb-';
  // écritures rejouables plus tard si hors ligne (idempotentes côté serveur : dernier état gagne)
  var QUEUE = { uiStrengthSave: 1, uiStrengthStep: 1, uiSetRpe: 1, uiSavePush: 1, uiMarkRead: 1 };
  // lectures : réseau d'abord, cache IndexedDB si réseau absent
  var READ = { uiWeek: 1, uiMonth: 1, uiGraph: 1, uiActivity: 1, uiStrength: 1, uiPerf: 1, uiRacePlan: 1, uiChat: 1, uiCoachBrief: 1, uiPreload: 1 };
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(P + k); localStorage.setItem(P + k, v); } catch (e) { return null; } }
  // ---- IndexedDB minimal (stores : cache, queue)
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open('dcap', 1);
      r.onupgradeneeded = function () { var d = r.result; d.createObjectStore('cache'); d.createObjectStore('queue', { autoIncrement: true }); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function tx(store, mode, f) {
    return db().then(function (d) { return new Promise(function (res, rej) {
      var t = d.transaction(store, mode), s = t.objectStore(store), out = f(s);
      t.oncomplete = function () { res(out && 'result' in out ? out.result : out); }; t.onerror = function () { rej(t.error); };
    }); });
  }
  var idb = {
    get: function (k) { return tx('cache', 'readonly', function (s) { return s.get(k); }); },
    put: function (k, v) { return tx('cache', 'readwrite', function (s) { s.put({ v: v, at: Date.now() }, k); }); },
    push: function (item) { return tx('queue', 'readwrite', function (s) { s.add(item); }); },
    all: function () { return tx('queue', 'readonly', function (s) { return s.getAll(); }); },
    keys: function () { return tx('queue', 'readonly', function (s) { return s.getAllKeys(); }); },
    del: function (k) { return tx('queue', 'readwrite', function (s) { s.delete(k); }); }
  };
  function post(body, ms) {
    var ctl = window.AbortController ? new AbortController() : null, h = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 20000);
    return fetch(EXEC, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow', signal: ctl && ctl.signal })
      .then(function (r) { clearTimeout(h); if (!r.ok) throw net('HTTP ' + r.status); return r.json(); }, function (e) { clearTimeout(h); throw net(e && e.message || 'réseau'); });
  }
  function net(m) { var e = new Error(m); e.offline = true; return e; }
  var bootP = null;
  function boot(force) {
    if (bootP && !force) return bootP;
    bootP = fetch(EXEC + '?api=boot&t=' + Date.now(), { redirect: 'follow' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) throw new Error('boot');
      ls('k', d.k); ls('srv', String(d.build || ''));
      if (d.week) { ls('boot', JSON.stringify(d.week)); idb.put('uiWeek|[null]', d.week).catch(function () {}); }
      return d;
    });
    bootP.catch(function () { bootP = null; });
    return bootP;
  }
  function token() { var k = ls('k'); return k ? Promise.resolve(k) : boot().then(function (d) { return d.k; }); }
  function remote(fn, args, ms) {
    return token().then(function (k) { return post({ ui: fn, k: k, args: args }, ms); }).then(function (d) {
      if (d && d.ok) { if (d.build) ls('srv', String(d.build)); return d.r; }
      var msg = d && d.error || 'erreur';
      if (/Accès refusé/.test(msg)) return boot(true).then(function (b) { return post({ ui: fn, k: b.k, args: args }, ms); }).then(function (d2) { if (d2.ok) return d2.r; throw new Error(d2.error); });
      throw new Error(msg);
    });
  }
  function setStatus() { document.documentElement.classList.toggle('is-offline', !navigator.onLine); }
  function call(fn, args) {
    args = args || [];
    if (fn === 'uiVersion') return Promise.resolve({ build: window.APP_BUILD }); // le front est versionné par le service worker
    var key = fn + '|' + JSON.stringify(args.length ? args : [null]);
    if (READ[fn]) {
      return remote(fn, args, 15000).then(function (r) {
        idb.put(key, r).catch(function () {});
        if (fn === 'uiWeek' && r && r.monday && r.today && r.monday <= r.today && r.today < addDays(r.monday, 7)) ls('boot', JSON.stringify(r));
        return r;
      }, function (e) {
        return idb.get(key).then(function (hit) { if (hit) { hit.v && typeof hit.v === 'object' && (hit.v._cachedAt = hit.at); return hit.v; } throw e; });
      });
    }
    if (QUEUE[fn]) {
      if (!navigator.onLine) return enqueue(fn, args);
      return remote(fn, args, 20000).catch(function (e) { if (e.offline) return enqueue(fn, args); throw e; });
    }
    if (!navigator.onLine) return Promise.reject(new Error('Hors ligne : réessaie quand le réseau revient'));
    return remote(fn, args, 60000);
  }
  function addDays(s, k) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
  function enqueue(fn, args) {
    return idb.push({ fn: fn, args: args, at: Date.now() }).then(function () { badge(); return { queued: true }; });
  }
  var flushing = false;
  function flush() {
    if (flushing || !navigator.onLine) return Promise.resolve();
    flushing = true;
    return Promise.all([idb.keys(), idb.all()]).then(function (kv) {
      var ks = kv[0], items = kv[1], i = 0;
      function next() {
        if (i >= items.length) return;
        var k = ks[i], it = items[i++];
        return remote(it.fn, it.args, 30000).then(function () { return idb.del(k); }, function (e) { if (e.offline) throw e; return idb.del(k); /* refus serveur : on n'insiste pas */ }).then(next);
      }
      return next();
    }).catch(function () {}).then(function () { flushing = false; badge(); });
  }
  function badge() { idb.keys().then(function (ks) { document.documentElement.classList.toggle('has-queue', ks.length > 0); window.DCAP.queued = ks.length; }).catch(function () {}); }
  window.addEventListener('online', function () { setStatus(); flush(); });
  window.addEventListener('offline', setStatus);
  setInterval(flush, 60000);
  window.DCAP = { call: call, boot: boot, flush: flush, queued: 0, exec: EXEC };
  setStatus(); setTimeout(flush, 3000);
})();
