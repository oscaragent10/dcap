/* DCAP — mise à jour automatique : nouveau service worker (skipWaiting + claim) → rechargement unique, jamais pendant une saisie.
   Vérifications : ouverture, retour au premier plan, toutes les 5 min, et quand l'API annonce un APP_BUILD différent du front. */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  var LOCAL = String(window.APP_BUILD || '').split('-')[0], want = false, hadCtl = !!navigator.serviceWorker.controller, lastCheck = 0;
  function app() { return window.DCAP_APP || null; }
  function busy() { var a = app(); try { return a ? a.busy() : false; } catch (e) { return false; } }
  function reload() {
    try { var t = +sessionStorage.getItem('dcap-reload-at') || 0; if (Date.now() - t < 15000) return; sessionStorage.setItem('dcap-reload-at', String(Date.now())); sessionStorage.setItem('dcap-updated', '1'); } catch (e) {}
    try { var a = app(); if (a) a.save(); } catch (e) {}
    location.reload();
  }
  function tryReload() {
    if (!want) return;
    if (document.visibilityState === 'hidden' || !busy()) reload(); // en arrière-plan : toujours sûr (brouillons sauvés)
  }
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadCtl) { hadCtl = true; return; } // première installation : la page est déjà la bonne
    want = true; tryReload();
  });
  document.addEventListener('focusout', function () { setTimeout(tryReload, 300); });
  document.addEventListener('click', function () { setTimeout(tryReload, 500); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') tryReload(); else check(); });
  setInterval(function () { tryReload(); }, 3000);
  function check(force) {
    if (!force && Date.now() - lastCheck < 20000) return; lastCheck = Date.now();
    navigator.serviceWorker.getRegistration().then(function (r) { if (r) return r.update(); }).catch(function () {});
  }
  // l'API renvoie son APP_BUILD à chaque réponse (api.js → localStorage dcapb-srv) : différent du front → vérification immédiate
  setInterval(function () {
    var srv = ''; try { srv = localStorage.getItem('dcapb-srv') || ''; } catch (e) {}
    if (srv && LOCAL && srv !== LOCAL) check();
  }, 15000);
  setInterval(function () { check(true); }, 5 * 60000);
  setTimeout(function () { check(true); }, 4000);
  // ↻ (en haut à droite) : la sync habituelle + vérification immédiate de la version ; nouvelle version → appliquée tout de suite
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#btn-import')) return;
    check(true);
    navigator.serviceWorker.getRegistration().then(function (r) { if (r && r.waiting) r.waiting.postMessage({ type: 'skip-waiting' }); }).catch(function () {});
    var srv = ''; try { srv = localStorage.getItem('dcapb-srv') || ''; } catch (err) {}
    if (srv && LOCAL && srv !== LOCAL) setTimeout(function () { want = true; tryReload(); }, 2500); // build serveur plus récent : rechargement (réseau d'abord)
  }, true);
  window.DCAP_UPDATE = { check: function () { check(true); }, pending: function () { return want; } };
})();
