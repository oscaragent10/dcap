/* =====================================================================
   App.html — Interface (une seule page) : Semaine, Mois, Km hebdo, Détail sortie,
   bulle du coach (propositions Valider/Refuser), modale « Description ».
   Toutes les données passent par google.script.run (fonctions ui* côté serveur).
   ===================================================================== */
(function () {
  'use strict';
  var K = window.UI_TOKEN;
  var MOBILE = window.matchMedia('(max-width:760px)');
  var S = { from: 'week', view: 'week', weekDay: null, ym: null, activityId: null, charts: [], map: null, colorBy: 'pace', last: null };

  // ------------------------------------------------------------------ utilitaires
  function call(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (res, rej) {
      window.DCAP.call(fn, args).then(res, rej); // PWA : API JSON + cache IndexedDB (pwa/api.js)
    });
  }
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v, d) { return v === null || v === undefined || v === '' || isNaN(v) ? '–' : Number(v).toFixed(d || 0).replace('.', ','); }
  function pace(s) { if (!s || !isFinite(s)) return '–'; s = Math.round(s); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function dur(s) { if (!s && s !== 0) return '–'; s = Math.round(s); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + 'h' + ('0' + m).slice(-2) : m + ':' + ('0' + x).slice(-2)); }
  var DOW = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'], DOW_L = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function ymdDate(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function addDays(s, k) { var d = ymdDate(s); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
  function dowIdx(s) { var d = ymdDate(s).getUTCDay(); return d === 0 ? 6 : d - 1; }
  // v85 : « aujourd'hui » = TOUJOURS la date de New York (jamais le fuseau de l'appareil ni UTC) ; DST géré par Intl
  function etYmd() {
    try { var p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day; }
    catch (e) { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  }
  function dm(s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '–'; }
  function dayLabel(s) { return DOW[dowIdx(s)] + ' ' + dm(s); }
  function toast(msg, ms) { var t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, ms || 3500); }
  function fail(e) { console.error(e); toast('Erreur : ' + (e && e.message ? e.message : e), 6000); }
  var ABBR = { 'EF': 'EF', 'SL': 'SL', 'fractionné': 'FRA', 'seuil': 'SEU', 'fartlek': 'FAR', 'côtes': 'CÔT', 'récup': 'RÉC', 'course': 'RACE', 'route': 'RTE', 'trail': 'TRL', 'tapis': 'TAP' };
  var TYPE_LBL = { 'route': 'Route', 'trail': 'Trail', 'tapis': 'Tapis', 'course': 'Course', 'marche': 'Marche', 'natation': 'Natation', 'velo': 'Vélo', 'autre': 'Autre', 'muscu': 'Muscu' };
  // Autres sports (v34) : affichés partout, jamais comptés dans les km course / cible / projection / ACWR.
  var SPORTS = ['marche', 'natation', 'velo', 'autre'], SPORT_TAG = { marche: 'Marche', natation: 'Nage', velo: 'Vélo', autre: 'Autre' };
  /** Palette unique : variables CSS --c-<type> (Styles.html), relues ici pour les graphiques. */
  var PAL = (function () { var cs = getComputedStyle(document.documentElement), o = {};
    ['route', 'trail', 'race', 'marche', 'natation', 'velo', 'autre', 'muscu'].forEach(function (k) { o[k] = cs.getPropertyValue('--c-' + k).trim(); o[k + '_d'] = cs.getPropertyValue('--c-' + k + '-d').trim(); }); return o; })();
  function rgba(hex, a) { var h = String(hex).replace('#', ''); if (h.length !== 6) return hex; return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'; }
  /** Stats d'un autre sport : distance (m pour la natation), durée, allure / vitesse adaptée, FC, D+. */
  function sportTag(o) { return o.type === 'autre' && o.label && o.label !== 'Autre' && o.label.length <= 8 ? o.label : (SPORT_TAG[o.type] || 'Autre'); }
  function sportMeta(o) {
    var km = +o.distance_km || 0, mv = +o.moving_s || +o.duration_s || 0, out = [];
    if (km) out.push(o.type === 'natation' ? '<b>' + n(km * 1000) + ' m</b>' : '<b>' + n(km, km < 10 ? 2 : 1) + ' km</b>');
    if (o.duration_s) out.push(hm(o.duration_s));
    if (km && mv) out.push(o.type === 'natation' ? pace(mv / (km * 10)) + '/100 m' : o.type === 'marche' ? pace(mv / km) + '/km' : n(km / (mv / 3600), 1) + ' km/h');
    if (o.avg_hr) out.push('FC ' + o.avg_hr);
    if (+o.d_plus_m > 0) out.push('<span class="up">+' + n(o.d_plus_m) + ' m</span>');
    return out;
  }
  function sportRow(o) {
    return '<div class="prow cap sport is-done sp-' + esc(o.type) + '" data-act="' + esc(o.activity_id) + '" role="button" tabindex="0"><span class="pt">' + esc(sportTag(o)) + '</span>' +
      '<span class="pm"><span class="ttl">' + esc(o.name || TYPE_LBL[o.type]) + '</span><span class="meta did">✓ ' + sportMeta(o).map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</span></span><span class="go">›</span></div>';
  }
  function statusLbl(s) { return { planned: 'prévu', done: 'fait', missed: 'manqué', modified: 'modifié' }[s] || s; }

  function destroyCharts() { S.charts.forEach(function (c) { try { c.destroy(); } catch (e) {} }); S.charts = []; if (S.map) { S.map.remove(); S.map = null; } }
  // v78 : pastille de l'onglet actif qui glisse (200 ms)
  function tabInd() {
    var tb = $('#tabbar'); if (!tb) return; var ind = $('#tab-ind');
    if (!ind) { ind = document.createElement('i'); ind.id = 'tab-ind'; ind.setAttribute('aria-hidden', 'true'); tb.appendChild(ind); }
    var bs = $$('#tabbar > button'), on = document.body.classList.contains('chat-open') ? $('#tab-coach') : $('#tabbar [data-nav].on'), i = bs.indexOf(on);
    ind.style.opacity = i < 0 ? '0' : '1'; if (i >= 0) ind.style.transform = 'translateX(' + (i * 100) + '%)';
  }
  if (window.MutationObserver) { var tmo = new MutationObserver(function () { tabInd(); }); tmo.observe(document.body, { attributes: true, attributeFilter: ['class'] }); setTimeout(function () { $$('#tabbar > button').forEach(function (b) { tmo.observe(b, { attributes: true, attributeFilter: ['class'] }); }); tabInd(); }, 0); }
  function setNav(v) {
    $$('#nav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-nav') === v); });
    // barre d'onglets mobile : la fiche sortie garde l'onglet d'origine (Semaine ou Mois) actif
    var tv = v === 'detail' || v === 'gym' ? S.from : v === 'race' ? 'graph' : v;
    $$('#tabbar [data-nav]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-nav') === tv); });
  }
  function loading() { $('#view').innerHTML = '<div class="loading">Chargement…</div>'; }

  // ------------------------------------------------------------------ navigation
  // v78 : transitions — onglets = fondu 150 ms ; fiche (sortie, séance, course) = poussée iOS 300 ms ; retour = inverse.
  // View Transitions API si disponible (Safari 18+), sinon animation CSS du contenu. Rien si « réduire les animations ».
  var REDUCED = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var DEEP = { detail: 1, gym: 1, race: 1 };
  function go(view, opts) {
    var prev = S.view, kind = DEEP[view] && !DEEP[prev] ? 'push' : DEEP[prev] && !DEEP[view] ? 'pop' : 'fade';
    if (!S.booted || REDUCED.matches || prev === view) { S.booted = true; return goNow(view, opts); }
    var de = document.documentElement;
    if (document.startViewTransition) {
      de.setAttribute('data-vt', kind);
      try { var t = document.startViewTransition(function () { goNow(view, opts); }); t.finished.then(function () { de.removeAttribute('data-vt'); }, function () { de.removeAttribute('data-vt'); }); return; }
      catch (e) { de.removeAttribute('data-vt'); }
    }
    goNow(view, opts);
    var v = $('#view'); v.classList.remove('vt-fade', 'vt-push', 'vt-pop'); void v.offsetWidth; v.classList.add('vt-' + kind);
    clearTimeout(v._vt); v._vt = setTimeout(function () { v.classList.remove('vt-' + kind); }, 360);
  }
  function goNow(view, opts) {
    opts = opts || {};
    // téléphone : le coach est une page comme les autres ; tout changement d'onglet le quitte
    if (MOBILE.matches && $('#chat').classList.contains('open')) Chat.close();
    destroyCharts();
    if (view === 'week' || view === 'month') S.from = view;
    S.view = view; setNav(view); document.body.classList.remove('panel-open'); rwCleanup();
    navSave(view, opts);
    if (view === 'week') { if (opts.day !== undefined) S.weekDay = opts.day; loadWeek(); }
    else if (view === 'month') { if (opts.ym) S.ym = opts.ym; loadMonth(); }
    else if (view === 'graph') loadGraph();
    else if (view === 'perf') loadPerf();
    else if (view === 'race') { if (opts.name) S.race = opts.name; loadRace(); }
    else if (view === 'gym') loadGym(opts);
    else if (view === 'detail') { if (opts.id) S.activityId = opts.id; $('#nav-detail').style.display = ''; loadDetail(); }
    window.scrollTo(0, 0);
  }
  function refresh() { go(S.view); }
  /** v52 : écran ouvert mémorisé ; si iOS recharge l'app, on revient au même endroit (séance muscu comprise). */
  var NAV_KEY = 'dcap-nav1', NAV_TTL = 12 * 3600 * 1000;
  function navSave(view, opts) {
    var o = { view: view, at: Date.now(), d: etYmd() };
    if (view === 'week') o.day = S.weekDay || null;
    if (view === 'month') o.ym = S.ym || null;
    if (view === 'race') o.name = S.race || opts.name || null;
    if (view === 'detail') o.id = S.activityId || opts.id || null;
    if (view === 'gym') { o.plan_id = opts.plan_id || null; o.date = opts.date || null; }
    try { localStorage.setItem(NAV_KEY, JSON.stringify(o)); } catch (e) {}
  }
  function navRestore() {
    var o = null; try { o = JSON.parse(localStorage.getItem(NAV_KEY) || 'null'); } catch (e) {}
    if (!o || Date.now() - o.at > NAV_TTL) return go('week');
    // v85 : à l'ouverture on revient sur la semaine / le mois EN COURS ; le jour ou le mois mémorisé n'est gardé que s'il est dans la semaine / le jour d'aujourd'hui (New York)
    var T = etYmd(), keepDay = o.day && mondayOf(o.day) === mondayOf(T) ? o.day : null;
    if (o.view === 'month' && o.ym && o.d === T) S.ym = o.ym;
    if (o.view === 'week') return go('week', { day: keepDay });
    if (o.view === 'detail') return o.id ? go('detail', { id: o.id }) : go('week');
    if (o.view === 'gym') return (o.plan_id || o.date) ? go('gym', { plan_id: o.plan_id, date: o.date }) : go('week');
    if (['month', 'graph', 'perf', 'race'].indexOf(o.view) >= 0) return go(o.view, o.name ? { name: o.name } : {});
    go('week');
  }

  // ------------------------------------------------------------------ cache client + préchargement
  // Semaines et mois gardés en mémoire : retour instantané, puis revalidation discrète (> 2 min).
  // v52 : chaque vue est aussi gardée dans localStorage (téléphone de Paul, données d'entraînement seulement, aucun jeton) :
  // après un déchargement par iOS, affichage immédiat de la dernière version puis revalidation en fond.
  var LS_P = 'dcap-c1:', LS_MAX = 40;
  function mkStore(nm) { var o = {}; Object.defineProperty(o, '_n', { value: nm }); return o; }
  function lsGet(k) { try { var v = localStorage.getItem(LS_P + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, d) {
    var put = function () { localStorage.setItem(LS_P + k, JSON.stringify({ at: Date.now(), data: d })); };
    try { put(); } catch (e) { lsPrune(LS_MAX / 2); try { put(); } catch (e2) {} }
    if (Math.random() < 0.1) lsPrune(LS_MAX);
  }
  function lsPrune(max) {
    try {
      var ks = []; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(LS_P) === 0) ks.push(k); }
      if (ks.length <= max) return;
      ks.map(function (k) { var a = 0; try { a = JSON.parse(localStorage.getItem(k)).at; } catch (e) {} return [a, k]; }).sort(function (a, b) { return a[0] - b[0]; })
        .slice(0, ks.length - max).forEach(function (x) { localStorage.removeItem(x[1]); });
    } catch (e) {}
  }
  function lsClear() { try { var ks = []; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(LS_P) === 0) ks.push(k); } ks.forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {} }
  /** Nouvelle version arrivée en fond pour une vue affichée : re-rendu sur place (sans écran de chargement). */
  function quietRender(nm, key, d) {
    if (nm === 'wk' && S.view === 'week' && (curWeekMonday() || S.curMonday) === key) renderWeek(d, true);
    else if (nm === 'mo' && S.view === 'month' && S.ym && S.ym[0] + '-' + S.ym[1] === key) renderMonth(d);
    else if (nm === 'gr' && S.view === 'graph') lib('Chart').then(function () { if (S.view === 'graph') { destroyCharts(); renderGraph(d); } });
    else if (nm === 'rp' && S.view === 'race' && (S.race || '_') === key) lib('Chart').then(function () { if (S.view !== 'race') return; destroyCharts(); if (S.map) { S.map.remove(); S.map = null; } renderRace(d); }); // v92 : fiche course rafraîchie
    else if (nm === 'pf' && S.view === 'perf') lib('Chart').then(function () { if (S.view === 'perf') { destroyCharts(); renderPerf(d); } });
  }
  var WK = mkStore('wk'), MO = mkStore('mo'), STALE_MS = 120000;
  function mondayOf(s) { return addDays(s, -dowIdx(s)); }
  function todayLocal() { return etYmd(); }
  function fetchCached(store, key, fn, args) {
    var e = store[key];
    if (e && e.data) return Promise.resolve(e.data);
    if (e && e.p) return e.p;
    var ls = store._n && lsGet(store._n + ':' + key);
    if (ls && ls.data) {
      store[key] = { data: ls.data, at: 0 }; // périmé d'office → revalidation immédiate
      setTimeout(function () { revalidate(store, key, fn, args, function (d) { quietRender(store._n, key, d); }); }, 0);
      return Promise.resolve(ls.data);
    }
    var p = call.apply(null, [fn].concat(args)).then(function (d) { store[key] = { data: d, at: Date.now() }; if (store._n) lsSet(store._n + ':' + key, d); return d; });
    store[key] = { p: p }; p.catch(function () { delete store[key]; });
    return p;
  }
  function revalidate(store, key, fn, args, onChange) {
    var e = store[key]; if (!e || !e.data || e.busy || Date.now() - e.at < STALE_MS) return;
    e.busy = true;
    call.apply(null, [fn].concat(args)).then(function (d) {
      var changed = JSON.stringify(d) !== JSON.stringify(e.data);
      store[key] = { data: d, at: Date.now() }; if (store._n) lsSet(store._n + ':' + key, d); if (changed) onChange(d);
    }).catch(function () { e.busy = false; });
  }
  function fetchWeek(mon) { return fetchCached(WK, mon, 'uiWeek', [mon]); }
  function fetchMonth(y, m) { return fetchCached(MO, y + '-' + m, 'uiMonth', [y, m]); }
  function invalidateAll() { WK = mkStore('wk'); MO = mkStore('mo'); GR = mkStore('gr'); PF = mkStore('pf'); RP = mkStore('rp'); }
  /** v52 : un seul appel au démarrage pour le mois en cours, l'Aperçu et la Performance. */
  function preloadAll() {
    if (S.preloaded || !S.today) return; S.preloaded = true;
    var t = S.today, y = +t.slice(0, 4), m = +t.slice(5, 7);
    call('uiPreload', y, m).then(function (r) {
      var put = function (store, key, d) { if (!d) return; var old = store[key]; store[key] = { data: d, at: Date.now() }; lsSet(store._n + ':' + key, d);
        if (old && old.data && JSON.stringify(old.data) !== JSON.stringify(d)) quietRender(store._n, key, d); };
      put(MO, y + '-' + m, r.month); put(GR, 'g', r.graph); put(PF, 'p', r.perf);
    }).catch(function () { S.preloaded = false; });
  }
  // préchargement en arrière-plan : semaine précédente d'abord (usage le plus fréquent), puis suivante, puis le mois
  function prefetchWeeks(mon) {
    fetchWeek(addDays(mon, -7)).catch(function () {}).then(function () {
      fetchWeek(addDays(mon, 7)).catch(function () {});
      preloadAll();
    });
  }
  function hideSplash() {
    var sp = $('#splash'); if (!sp || sp.classList.contains('out')) return;
    sp.classList.add('out'); setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 500);
  }

  // ------------------------------------------------------------------ SEMAINE
  function curWeekMonday() { return S.weekDay ? mondayOf(S.weekDay) : S.curMonday; }
  function loadWeek() {
    var mon = curWeekMonday(), e = mon && WK[mon];
    if (e && e.data) {
      renderWeek(e.data); prefetchWeeks(mon);
      revalidate(WK, mon, 'uiWeek', [mon], function (d) { if (S.view === 'week' && curWeekMonday() === d.monday) renderWeek(d, true); });
      return;
    }
    loading();
    (mon ? fetchWeek(mon) : call('uiWeek', null).then(function (d) { WK[d.monday] = { data: d, at: Date.now() }; return d; }))
      .then(function (d) {
        if (!S.curMonday) { S.curMonday = mondayOf(d.today); S.today = d.today; }
        if (S.view === 'week' && (curWeekMonday() || d.monday) === d.monday) renderWeek(d);
        prefetchWeeks(d.monday);
      }).catch(function (e) { hideSplash(); fail(e); });
  }
  /** « 1h05 », « 35 min » */
  function hm(sec) { if (!sec && sec !== 0) return ''; var m = Math.round(sec / 60), h = Math.floor(m / 60); return h ? h + 'h' + ('0' + m % 60).slice(-2) : m + ' min'; }
  function kmRange(p) {
    var lo = p.distance_min_km, hi = p.distance_max_km;
    if (lo && hi && +lo !== +hi) return n(lo, lo % 1 ? 1 : 0) + '–' + n(hi, hi % 1 ? 1 : 0) + ' km';
    return p.distance_km ? n(p.distance_km, p.distance_km % 1 ? 1 : 0) + ' km' : '';
  }
  function planMeta(p) {
    return [kmRange(p), p.duration_min && !p.distance_km ? hm(p.duration_min * 60) : '', p.pace_target ? esc(String(p.pace_target).replace(/\s*\/\s*km$/, '')) + '/km' : '',
      p.hr_target ? 'FC ' + esc(p.hr_target) : '', p.lieu ? esc(p.lieu) : ''].filter(Boolean).map(function (x) { return '<span>' + x + '</span>'; }).join('');
  }
  function actMeta(a) {
    return '<span><b>' + n(a.distance_km, 1) + ' km</b></span><span>' + dur(a.duration_s) + '</span><span>' + pace(a.avg_pace_s_km) + '/km</span>' +
      (a.avg_hr ? '<span>FC ' + a.avg_hr + '</span>' : '') + (a.d_plus_m ? '<span class="up">+' + n(a.d_plus_m) + ' m</span>' : '');
  }
  /** Couples séance prévue ↔ sortie du jour : lien explicite, sinon par date (ordre). */
  function pairDay(day) {
    var acts = day.acts.slice(), out = [];
    day.plans.forEach(function (p) {
      var i = -1;
      acts.forEach(function (a, k) { if (i < 0 && p.linked_activity_id && String(p.linked_activity_id) === a.activity_id) i = k; });
      if (i < 0) acts.forEach(function (a, k) { if (i < 0 && !day.plans.some(function (q) { return q.linked_activity_id && String(q.linked_activity_id) === a.activity_id; })) i = k; });
      out.push({ plan: p, act: i >= 0 ? acts.splice(i, 1)[0] : null });
    });
    acts.forEach(function (a) { out.push({ plan: null, act: a }); });
    return out;
  }
  /** Étiquette de gauche : surface réelle (Route / Trail / Tapis / Course), sinon déduite de la séance prévue. */
  function surfTag(a, p) {
    if (a) return TYPE_LBL[a.type] || (/trail/i.test(a.type) ? 'Trail' : 'Route');
    if (p.type === 'course') return 'Course';
    return /trail|devou|ludlow/i.test([p.title, p.lieu, p.description].join(' ')) ? 'Trail' : 'Route';
  }
  /** Nom court d'une séance prévue : sans parenthèses ni lieu, ~22 caractères max (le nom complet reste dans la fiche). */
  function shortTitle(t) {
    t = String(t || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+(à|au|a)\s+[A-ZÉ][\w-]*.*$/, '').replace(/\b(Devou( Park)?|Ludlow|Cincinnati)\b/g, '').replace(/\s{2,}/g, ' ').trim();
    if (t.length > 22) {
      var w = t.split(' '), o = '';
      for (var i = 0; i < w.length && (o + ' ' + w[i]).trim().length <= 22; i++) o = (o + ' ' + w[i]).trim();
      t = o || t.slice(0, 22); var t0; do { t0 = t; t = t.replace(/\s+(de|du|des|la|le|et|à|en|sur|post|veille|avant|après)$/i, ''); } while (t !== t0);
    }
    return t;
  }
  /** Ligne « course » du Programme (prévu ↔ réalisé). */
  function capRow(x, day, past) {
    var p = x.plan, a = x.act, rcn = !a && p && p.type === 'course' && day.races && day.races.length ? day.races[0].name : null, st = a ? 'done' : (p.status === 'missed' || (past && p.status !== 'done') ? 'missed' : 'todo');
    var tg = surfTag(a, p), sf = tg === 'Trail' ? 'trail' : tg === 'Course' ? 'race' : 'route';
    return '<div class="prow cap is-' + st + ' sp-' + sf + '"' + (a ? ' data-act="' + esc(a.activity_id) + '" role="button" tabindex="0"' : rcn ? ' data-race="' + esc(rcn) + '" role="button" tabindex="0"' : ' data-desc="' + esc(p.plan_id) + '" role="button" tabindex="0"') + '>' +
      '<span class="pt">' + tg + '</span><span class="pm">' +
      '<span class="ttl"' + (p && p.title ? ' title="' + esc(p.title) + '"' : '') + '>' + esc(p ? shortTitle(p.title || p.type) : a.name) + (st === 'missed' ? ' <em class="miss">manquée</em>' : '') + (!p && day.plans.length ? ' <em>hors plan</em>' : '') + '</span>' +
      (p ? '<span class="meta plan">' + planMeta(p) + '</span>' : '') +
      (a ? '<span class="meta did">✓ ' + actMeta(a) + '</span>' : '') + '</span>' +
      (p && a ? '<button class="info" data-desc="' + esc(p.plan_id) + '" aria-label="Description de la séance">i</button>' : '') +
      '<span class="go">' + (a || rcn ? '›' : '') + '</span></div>';
  }
  /** Ligne « muscu » : même gabarit qu'une sortie, libellé Muscu + type (Push, Pull…), accent jaune. */
  function gymRow(kind, meta, st, p) {
    return '<div class="prow cap gym is-' + st + '"' + (p ? ' data-gym="' + esc(p.plan_id) + '" role="button" tabindex="0"' : '') + '>' +
      '<span class="pt">Muscu</span><span class="pm"><span class="ttl">' + esc(kind || 'Séance') + (st === 'missed' ? ' <em class="miss">manquée</em>' : '') + '</span>' +
      (meta ? '<span class="meta ' + (st === 'done' ? 'did' : 'plan') + '">' + meta + '</span>' : '') + '</span><span class="go">' + (p ? '›' : '') + '</span></div>';
  }
  function renderWeek(d, keepScroll) {
    S.last = d; if (!S.today) S.today = d.today;
    var s = d.summary, L = d.load, y = window.scrollY;
    $('#sync').textContent = d.last_sync_at ? 'Sync ' + dm(d.last_sync_at.slice(0, 10)) + ' ' + d.last_sync_at.slice(11, 16) : (d.last_import_at ? 'Import ' + dm(d.last_import_at.slice(0, 10)) + ' ' + d.last_import_at.slice(11, 16) : '');
    var pct = s.target_km ? Math.min(100, s.done_km / s.target_km * 100) : 0;
    var projSt = !s.target_km ? '' : (s.projection_km >= s.target_km * 0.95 && s.projection_km <= s.target_km * 1.1 ? 'ok' : (s.projection_km > s.target_km * 1.1 ? 'warn' : 'low'));
    var race = d.next_race, mob = MOBILE.matches, isCur = d.monday === S.curMonday;
    var h = '';
    h += '<div class="sec"><h2><span class="n">1.</span>Ma semaine</h2><div class="right">' +
      '<span class="mono-label">S' + d.iso_week.slice(6) + ' · ' + dm(d.monday) + ' → ' + dm(addDays(d.monday, 6)) + '</span>' +
      '<button class="btn btn-ghost btn-sm" data-wk="-7" aria-label="Semaine précédente">‹</button><button class="btn btn-ghost btn-sm' + (isCur ? ' cur' : '') + '" data-wk="0">' + (mob ? 'Auj.' : 'Aujourd\'hui') + '</button><button class="btn btn-ghost btn-sm" data-wk="7" aria-label="Semaine suivante">›</button></div></div>';
    h += '<div class="card band">' +
      '<div class="cell"><div class="mono-label">Km</div><div class="big">' + n(s.done_km, 1) + '<small>/ ' + (s.target_km ? n(s.target_km, s.target_km % 1 ? 1 : 0) : '–') + '</small></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div><div class="sub">' + (s.target_km ? s.pct_target + ' % ' + (s.target_source === 'plan' ? 'des km prévus' : 'de la cible') : 'rien de prévu') + '</div></div>' +
      '<div class="cell"><div class="mono-label">D+</div><div class="big">' + n(s.done_d_plus_m) + '<small>m</small></div>' +
      '<div class="sub">' + (s.target_d_plus_m ? 'cible ' + s.target_d_plus_m + ' m' : '&nbsp;') + '</div></div>' +
      '<div class="cell"><div class="mono-label">Séances</div><div class="big">' + s.sessions_done + '<small>/ ' + s.sessions_planned + '</small></div><div class="sub">faites / prévues</div></div>' +
      '<div class="cell"><div class="mono-label">Projection</div><div class="big ' + (projSt ? 't-' + projSt : '') + '">' + n(s.projection_km, 1) + '<small>km</small></div>' +
      '<div class="sub">' + (s.remaining_km ? 'reste ' + n(s.remaining_km, 1) + ' km prévus' : (s.projection_vs_target_km !== null ? (s.projection_vs_target_km >= 0 ? '+' : '') + n(s.projection_vs_target_km, 1) + ' km vs prévu' : '&nbsp;')) + '</div></div>' +
      '<div class="cell"><div class="mono-label">Prochaine course</div>' + (race ? '<div class="big">J-' + race.days_left + '</div><div class="sub">' + esc(race.name) + ' · ' + dm(race.date) + ' · ' + esc(race.priority) + '</div>' : '<div class="big">–</div>') + '</div>' +
      '</div>';
    // Indicateurs discrets : ACWR (charge course 7 j / 28 j) + état de l'agenda
    var cal = d.calendar || {};
    h += '<div class="minis"><span class="mini" data-s="' + (L.insufficient_history ? 'na' : L.status) + '" title="Charge aiguë 7 j / chronique 28 j">ACWR ' +
      (L.ratio === null || L.insufficient_history ? '– <em>(' + L.history_days + ' j / 21)</em>' : n(L.ratio, 2)) + '</span>' +
      '<span class="mini" data-s="' + (cal.status === 'ok' ? 'ok' : cal.status === 'unauthorized' ? 'warn' : 'na') + '">' + (cal.status === 'ok' && cal.at ? 'Agenda · ' + dm(cal.at.slice(0, 10)) + ' ' + cal.at.slice(11, 16)
        : cal.status === 'unauthorized' ? 'Agenda non autorisé' : 'Agenda pas encore lu') + '</span></div>';
    if (d.alerts.length) h += '<div class="alerts">' + d.alerts.filter(function (a) { return !/^ACWR/.test(a.text) || a.level === 'danger'; }).map(function (a) { return '<div class="alert ' + a.level + '">⚠ <span>' + esc(a.text) + '</span></div>'; }).join('') + '</div>';
    // 2. Programme : jour par jour, prévu (agenda) + réalisé ; course et muscu mêlées dans l'ordre chronologique
    h += '<div class="sec"><h2><span class="n">2.</span>Programme</h2><div class="right">' +
      (d.pending_proposals ? '<button class="btn btn-blue btn-sm" id="open-props">' + d.pending_proposals + ' proposition(s)</button>' : '') + '</div></div>';
    h += '<div class="prog card">';
    d.days.forEach(function (day) {
      var di = dowIdx(day.date), past = day.date < d.today, pairs = pairDay(day);
      h += '<div class="pday' + (day.is_today ? ' today' : '') + (past ? ' past' : '') + '"><div class="pd-date"><b>' + DOW[di] + '</b><span>' + dm(day.date) + '</span>' + (day.is_today ? '<i>auj.</i>' : '') + '</div><div class="pd-body">';
      day.races.forEach(function (rc) { h += '<div class="race-flag rf-go" data-race="' + esc(rc.name) + '" role="button" tabindex="0">🏁 ' + esc(rc.name) + ' · ' + n(rc.distance_km, 1) + ' km · ' + n(rc.d_plus_m) + ' m D+' + (rc.target_time ? ' · objectif ' + esc(rc.target_time) : '') + '<span class="go">Plan ›</span></div>'; });
      // Toutes les séances du jour (course + muscu) dans l'ordre chronologique (heure réelle, sinon heure prévue).
      var rows = [], seq = 0;
      pairs.forEach(function (x) { rows.push({ t: (x.act && x.act.start_time) || (x.plan && x.plan.start_time) || '', k: seq++, html: capRow(x, day, past) }); });
      // muscu : séances faites (durée réelle) puis séances prévues restantes (durée prévue)
      var gymLeft = day.gym.slice();
      day.strength.forEach(function (g) {
        var k = -1; gymLeft.forEach(function (p, i) { if (k < 0 && (p.plan_id === g.plan_id || !g.plan_id)) k = i; });
        var p = k >= 0 ? gymLeft.splice(k, 1)[0] : null;
        rows.push({ t: g.start_time || (p && p.start_time) || '', k: seq++, html: gymRow(g.kind || (p && p.title) || '', '✓ <b>' + hm(g.duration_s) + '</b>' + (g.avg_hr ? '<span>FC ' + g.avg_hr + '</span>' : ''), 'done', p) });
      });
      gymLeft.forEach(function (p) {
        rows.push({ t: p.start_time || '', k: seq++, html: gymRow(p.title, (p.duration_min ? '<span>' + hm(p.duration_min * 60) + '</span>' : '') + (p.start_time ? '<span>' + esc(p.start_time) + '</span>' : ''), past ? 'missed' : 'todo', p) });
      });
      (day.other || []).forEach(function (o) { rows.push({ t: o.start_time || '', k: seq++, html: sportRow(o) }); });
      rows.sort(function (a, b) { var x = a.t || '99', y = b.t || '99'; return x !== y ? (x < y ? -1 : 1) : a.k - b.k; }); // sans heure : en fin de journée
      rows.forEach(function (r) { h += r.html; });
      if (!pairs.length && !day.strength.length && !day.gym.length && !day.races.length && !(day.other || []).length) h += '<div class="rest">' + (past || day.date <= (d.horizon || '') ? 'Repos' : 'Pas encore planifié') + '</div>';
      h += '</div></div>';
    });
    h += '</div>';
    $('#view').innerHTML = h;
    if (keepScroll) window.scrollTo(0, y);
    $$('[data-wk]').forEach(function (b) { b.onclick = function () { var k = +b.getAttribute('data-wk'); go('week', { day: k ? addDays(d.monday, k) : null }); }; });
    bindCommon(d.days.reduce(function (acc, x) { return acc.concat(x.plans, x.gym); }, []));
    $$('.prow[role=button]').forEach(function (el) { el.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } }; });
    bindRaceLinks(); // v91 : course → Plan de course
    var op = $('#open-props'); if (op) op.onclick = function () { Chat.open(); };
    hideSplash();
  }

  /** Clics communs : boutons Description (modale) et ouverture d'une sortie. */
  function bindCommon(plans) {
    $$('[data-gym]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); go('gym', { plan_id: b.getAttribute('data-gym') }); }; });
    $$('[data-desc]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); var p = plans.filter(function (x) { return x.plan_id === b.getAttribute('data-desc'); })[0]; if (p) showPlan(p); }; });
    $$('[data-act]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); go('detail', { id: b.getAttribute('data-act') }); }; });
  }

  // ------------------------------------------------------------------ modale « Description »
  // Description de séance : markdown léger (**gras**, listes « - ») + mise en gras automatique des infos clés
  // (FC cible, allures, distances, durées, formats de répétitions, type de séance). Le détail « | S42 : … » reste en gris.
  var KEY_RX = new RegExp([
    '\\d{1,2}:\\d{2}(?:\\s*(?:à|a|-|–)\\s*\\d{1,2}:\\d{2})?\\s*(?:min)?\\/(?:km|100\\s?m)',                         // allures 5:25 à 5:50/km
    '(?:FC\\s*:?\\s*)?(?:sous|en dessous de|max(?:imum)?|moins de|&lt;|≤)\\s*\\d{3}(?:\\s*bpm)?',                       // sous 140
    '(?:FC|HR)\\s*:?\\s*\\d{2,3}\\s*(?:à|-|–)\\s*\\d{2,3}(?:\\s*bpm)?', '\\b\\d{2,3}\\s*(?:à|-|–)\\s*\\d{2,3}\\s*bpm', '\\b\\d{3}\\s*bpm', // FC 130–145
    '\\b\\d+\\s?[x×]\\s?\\d+(?:[.,]\\d+)?(?:\\s?(?:km|m|min|s|′|\'|"))?(?![\\d\\w])',                               // 6×800 m, 2x10, 3×6′
    '\\b\\d+(?:[.,]\\d+)?\\s?km\\b', '\\b\\d{2,4}\\s?m\\b(?![\\wé])',                                                // 8 km, 800 m
    '\\b\\d+\\s?h\\s?\\d{2}\\b', '\\b\\d+\\s?min(?:\\s?\\d{2})?\\b', '\\b\\d+\\s?(?:minutes|heures?)\\b', '\\b\\d+′\\d*',  // durées
    '\\b\\d+(?:[.,]\\d+)?\\s?(?:lbs|kg)\\b'                                                                       // charges
  ].join('|'), 'gi');
  var TYPE_RX = /\b(sortie longue|footing(?: récup| facile)?|fractionné|VMA|seuil|tempo|endurance fondamentale|côtes|spécifique|allure spé|récup(?:ération)?|Push|Pull|Legs|KOM)\b/i;
  function boldKeys(t) {
    return t.split(/(<b>[\s\S]*?<\/b>)/).map(function (seg, i) { return i % 2 ? seg : seg.replace(KEY_RX, '<b>$&</b>'); }).join('');
  }
  function richDesc(text) {
    var typed = false, out = [], list = null;
    String(text || '').split(/\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) { if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; } out.push(''); return; }
      var bullet = /^[-•*]\s+/.test(line); if (bullet) line = line.replace(/^[-•*]\s+/, '');
      var h = esc(line).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      var bar = h.indexOf(' | '), tail = '';
      if (bar > 0) { tail = '<span class="pd-hist">' + h.slice(bar) + '</span>'; h = h.slice(0, bar); }
      var lab = h.match(/^([A-ZÀ-Ý][\wÀ-ÿ' ]{1,22}) :\s/); // « Distance : », « Allure : »
      var body = lab ? h.slice(lab[0].length) : h;
      if (!typed && !lab) { var mm = body.match(TYPE_RX); if (mm) { typed = true; body = body.replace(TYPE_RX, '<b>$1</b>'); } }
      body = boldKeys(body);
      var html = (lab ? '<span class="pd-lab">' + lab[1] + '</span> ' : '') + body + tail;
      if (bullet) (list = list || []).push('<li>' + html + '</li>');
      else { if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; } out.push('<p>' + html + '</p>'); }
    });
    if (list) out.push('<ul>' + list.join('') + '</ul>');
    return out.join('').replace(/(<p><\/p>)+/g, '');
  }
  function showPlan(p) {
    var rows = [['Date', dayLabel(p.date) + (p.start_time ? ' · ' + p.start_time : '')], ['Type', p.type === 'muscu' ? 'Muscu' : p.type], ['Distance', kmRange(p)], ['Durée', p.duration_min ? hm(p.duration_min * 60) : ''],
      ['Allure', p.pace_target],
      ['D+ cible', p.d_plus_target_m ? p.d_plus_target_m + ' m' : ''], ['Lieu', p.lieu], ['Structure', p.structure], ['FC cible', p.hr_target ? p.hr_target + (/bpm/.test(p.hr_target) ? '' : ' bpm') : ''],
      ['Nutrition', p.fueling], ['Statut', statusLbl(p.status)], ['Source', p.source === 'calendar' ? 'Google Agenda' : p.source === 'proposal' ? 'validée via le coach' : '']];
    var h = '<div class="sec" style="margin-top:0"><h2>' + esc(p.title || p.type) + '</h2><button class="btn btn-ghost btn-sm" id="m-close">✕</button></div><dl class="kv">' +
      rows.filter(function (r) { return r[1]; }).map(function (r) { return '<dt>' + r[0] + '</dt><dd class="' + (r[0] === 'Structure' || r[0] === 'FC cible' ? 'code' : '') + '">' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' +
      (p.description ? '<div class="panel"><div class="ttl">Description</div><div class="pdesc">' + richDesc(p.description) + '</div></div>' : '<div class="muted">Pas de description.</div>') +
      '<div class="row" style="margin-top:14px;justify-content:flex-end">' +
      (p.linked_activity_id ? '<button class="btn btn-ghost" id="m-act">Voir la sortie</button>' : '') +
      (p.type === 'muscu' ? '<button class="btn" id="m-gym">Ouvrir la séance</button>' : '') +
      '<button class="btn btn-green" id="m-ask">Demander au coach</button></div>';
    $('#modal-box').innerHTML = h; $('#modal').classList.remove('closing'); $('#modal').classList.add('open');
    $('#m-close').onclick = closeModal;
    $('#m-ask').onclick = function () { closeModal(); Chat.open('séance ' + p.plan_id + ' · ' + p.type + ' du ' + p.date + ' « ' + (p.title || '') + ' »'); };
    var mg = $('#m-gym'); if (mg) mg.onclick = function () { closeModal(); go('gym', { plan_id: p.plan_id }); };
    var ma = $('#m-act'); if (ma) ma.onclick = function () { closeModal(); go('detail', { id: String(p.linked_activity_id) }); };
  }
  function closeModal() { // v78 : la feuille redescend (250 ms) avant de disparaître
    var m = $('#modal'); if (!m.classList.contains('open')) return;
    if (REDUCED.matches) { m.classList.remove('open'); return; }
    m.classList.add('closing'); clearTimeout(m._c); m._c = setTimeout(function () { m.classList.remove('open', 'closing'); }, 250);
  }
  $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });

  // ------------------------------------------------------------------ SÉANCE DE MUSCU (v51)
  // Pré-remplie depuis la description Gym (parse serveur), une carte par exercice, une ligne par série.
  // Sauvegarde auto (debounce + reprise sur erreur réseau + brouillon localStorage), « Terminer la séance ».
  var G = null;
  function loadGym(o) {
    var ck = 'gy:' + (o.plan_id || 'free-' + (o.date || '')), c = lsGet(ck);
    if (c && c.data) { gymInit(c.data); renderGym(); } else loading();
    call('uiStrength', o.plan_id || null, o.date || null).then(function (d) {
      lsSet(ck, d);
      if (S.view !== 'gym') return;
      if (!G || G.d.plan_id !== d.plan_id || !G.touched) { gymInit(d); renderGym(); }
      else { G.d.activity = d.activity; G.d.steps = d.steps; }
    }).catch(function (e) { if (!(c && c.data)) fail(e); });
  }
  function gymInit(d) {
    var ex;
    var draftKey = 'dcap-gym-' + d.date + '|' + d.plan_id, draft = null;
    try { draft = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch (e) {}
    if (d.log && d.log.exercises.length && !(draft && draft.t > Date.parse(d.log.updated_at || 0))) {
      ex = d.log.exercises.map(function (e) { return { name: e.name, unilateral: !!e.unilateral, rpe: e.rpe === null || e.rpe === '' ? null : +e.rpe, note: e.note || '', target: e.target || '', sets: e.sets.map(function (s) { return { weight_lbs: s.weight_lbs === null ? null : +s.weight_lbs, weight_d: s.weight_d === null || s.weight_d === undefined || s.weight_d === '' ? null : +s.weight_d, reps: s.reps === null ? null : +s.reps, reps_g: s.reps_g === null ? null : +s.reps_g, reps_d: s.reps_d === null ? null : +s.reps_d, status: s.status === 'done' ? 'done' : 'todo' }; }) }; });
    } else if (draft && draft.ex) ex = draft.ex;
    else {
      var src = d.parsed.exercises.length ? d.parsed.exercises : (d.program[d.session] || []).map(function (p) { return { name: p[0], sets: 3, reps_min: 8, reps_max: 10, weight_lbs: p[1], unilateral: /bulgar|step|unilat|pallof/i.test(p[0]) }; });
      ex = src.map(gymFromParsed);
    }
    ex.forEach(function (x) { if (x.rpe !== null && x.rpe !== undefined) x.rpeSaved = true; });
    G = { d: d, ex: ex, note: (draft && draft.note) || (d.log && d.log.note) || '', key: draftKey, finished: d.log && d.log.finished_at, saveSt: d.log ? 'saved' : '', timer: null, inflight: false, dirty: false, prevMap: {} };
    d.parsed.exercises.forEach(function (p) { G.prevMap[p.name] = p; });
  }
  function gymTarget(p) {
    var r = p.reps_min ? (p.reps_max && p.reps_max !== p.reps_min ? p.reps_min + '–' + p.reps_max : p.reps_min) + (p.reps_unit === 's' ? ' s' : '') : '';
    var w = p.weight_lbs !== null && p.weight_lbs !== undefined ? (p.bodyweight ? 'PDC +' : '') + String(p.weight_lbs).replace('.', ',') + ' lbs' : (p.weight_text || '');
    var rs = +p.rest_s > 0 ? ' · récup ' + (p.rest_s >= 60 ? Math.floor(p.rest_s / 60) + "'" + (p.rest_s % 60 ? ('0' + p.rest_s % 60).slice(-2) : '') : p.rest_s + ' s') : '';
    return [(p.sets ? p.sets + '×' : '') + r, w].filter(Boolean).join(' · ') + (p.unilateral ? ' · /côté' : '') + rs;
  }
  function gymFromParsed(p) {
    var nSets = p.sets || 3, reps = p.reps_max || p.reps_min || null, w = p.weight_lbs === undefined ? null : p.weight_lbs, sets = [];
    for (var i = 0; i < nSets; i++) sets.push(p.unilateral ? { weight_lbs: w, reps_g: reps, reps_d: reps, status: 'todo' } : { weight_lbs: w, reps: reps, status: 'todo' });
    return { name: p.name, unilateral: !!p.unilateral, rpe: null, note: '', target: gymTarget(p), sets: sets };
  }
  function gymSaveSoon(ms) {
    G.dirty = true; G.touched = true; G.saveSt = 'pending'; gymSaveBadge();
    try { localStorage.setItem(G.key, JSON.stringify({ t: Date.now(), ex: G.ex, note: G.note })); } catch (e) {}
    clearTimeout(G.timer); G.timer = setTimeout(function () { gymSave(false, 0); }, ms === undefined ? 900 : ms);
  }
  function gymSave(finish, attempt) {
    if (!G) return Promise.resolve();
    if (G.inflight && !finish) { clearTimeout(G.timer); G.timer = setTimeout(function () { gymSave(false, 0); }, 700); return Promise.resolve(); }
    var g = G; g.inflight = true; g.dirty = false; g.saveSt = 'saving'; gymSaveBadge();
    var payload = { date: g.d.date, plan_id: g.d.plan_id, session: g.d.session, exercises: g.ex.map(function (x) { var c = Object.assign({}, x); if (!x.rpeTouched && !x.rpeSaved) c.rpe = null; return c; }), note: g.note, finish: !!finish };
    return call('uiStrengthSave', payload).then(function (r) {
      g.inflight = false; g.saveSt = g.dirty ? 'pending' : 'saved'; if (r.finished_at) g.finished = r.finished_at; if (r.activity) g.d.activity = r.activity;
      if (!g.dirty) try { localStorage.removeItem(g.key); } catch (e) {}
      if (G === g) { gymSaveBadge(); if (finish) renderGym(); }
      return r;
    }).catch(function (e) {
      g.inflight = false; g.saveSt = 'retry'; g.dirty = true; if (G === g) gymSaveBadge();
      var wait = Math.min(30000, 2000 * Math.pow(2, attempt || 0));
      clearTimeout(g.timer); g.timer = setTimeout(function () { if (G === g) gymSave(finish, (attempt || 0) + 1); }, wait);
      if (finish) toast('Réseau indisponible : la séance sera enregistrée dès que possible', 5000);
    });
  }
  function gymSaveBadge() {
    var b = $('#gym-save'); if (!b || !G) return;
    var t = { pending: 'modifié…', saving: 'enregistrement…', saved: '✓ enregistré', retry: '⚠ hors ligne, nouvel essai…' }[G.saveSt] || '';
    b.textContent = t; b.className = 'gym-save st-' + G.saveSt;
  }
  function gymNum(v) { return v === null || v === undefined || v === '' ? '–' : String(v).replace('.', ','); }
  function renderGym() {
    var d = G.d, a = d.activity, h = '';
    h += '<div class="sec"><h2><span class="n">◆</span>' + esc(d.session === 'Muscu' ? 'Séance' : d.session) + '</h2><div class="right"><span class="mono-label">' + esc(dayLabel(d.date)) + '</span>' +
      '<button class="btn btn-ghost btn-sm" id="gym-back" aria-label="Retour">‹ Semaine</button></div></div>';
    h += '<div class="gym-head card"><div class="gx-top"><div class="gym-ttl">' + esc(d.title || '') + '</div><button class="btn btn-ghost btn-sm gym-order' + (G.order ? ' on' : '') + '" id="gym-order">' + (G.order ? 'OK' : '≡ Ordre') + '</button></div>' + (G.order ? '<div class="gym-ord-hint">Glisse ≡ (ou ↑ ↓) pour changer l\'ordre des exos.</div>' : '') + '<div class="gym-sub"><span id="gym-save" class="gym-save"></span>' +
      (a ? '<span class="gym-act">Garmin : ' + esc(dur(a.duration_s)) + (a.avg_hr ? ' · FC ' + a.avg_hr : '') + '</span>' : '<span class="gym-act muted">pas encore d\'activité Garmin ce jour</span>') +
      (G.finished ? '<span class="gym-fin">Terminée ✓</span>' : '') + '</div></div>';
    G.ex.forEach(function (e, i) {
      if (G.order) { // v90 : mode « Modifier » → cartes compactes, poignée ≡ à droite
        var nd = e.sets.filter(function (s) { return s.status === 'done'; }).length;
        h += '<div class="card gym-ex gx-ord" data-ex="' + i + '"><div class="gx-ordn">' + (i + 1) + '</div><div class="gx-ordt"><div class="gx-name">' + esc(e.name) + '</div><div class="gx-obj">' + nd + '/' + e.sets.length + ' séries validées</div></div>' +
          '<span class="gx-ud"><button data-act="up" aria-label="Monter"' + (i === 0 ? ' disabled' : '') + '>↑</button><button data-act="down" aria-label="Descendre"' + (i === G.ex.length - 1 ? ' disabled' : '') + '>↓</button></span><span class="gx-handle" aria-label="Glisser pour réordonner">≡</span></div>';
        return;
      }
      var p = G.prevMap[e.name], prev = p && p.prev ? p.prev.text : '';
      h += '<div class="card gym-ex" data-ex="' + i + '"><div class="gx-top"><div><div class="gx-name">' + esc(e.name) + (e.unilateral ? ' <em class="gx-uni">G/D</em>' : '') + '</div>' +
        (e.target ? '<div class="gx-obj">' + esc(e.target) + '</div>' : '') + (prev ? '<div class="gx-prev">Dernière : ' + esc(prev) + '</div>' : '') +
        (p && p.notes ? '<div class="gx-prev">' + esc(p.notes) + '</div>' : '') + '</div>' +
        '<button class="gx-menu btn btn-ghost btn-sm" data-act="edit" aria-label="Modifier l\'exercice">Modifier</button></div>';
      h += '<div class="gx-sets">';
      e.sets.forEach(function (s, j) {
        h += '<div class="gx-set' + (e.unilateral ? ' uni' : '') + (s.status === 'done' ? ' done' : '') + '" data-set="' + j + '"><span class="gx-n">' + (j + 1) + '</span>' +
          '<span class="gx-w"><button data-act="w-" aria-label="Moins">−</button><b>' + gymNum(s.weight_lbs) + '</b><small>lbs' + (e.unilateral && s.weight_d !== null && s.weight_d !== undefined ? ' <em class="gx-wd">D ' + gymNum(s.weight_d) + '</em>' : '') + '</small><button data-act="w+" aria-label="Plus">+</button></span>' +
          (e.unilateral ? gymReps('reps_g', s.reps_g, 'G') + gymReps('reps_d', s.reps_d, 'D') : gymReps('reps', s.reps, '')) +
          '<button class="gx-ok" data-act="ok" aria-label="Valider la série">✓</button></div>';
      });
      h += '</div>' + (RPE_UI === 'claude2' ? rpeClaude2Html(e) : RPE_UI === 'claude' ? rpeClaudeHtml(e) : rpeWheelHtml(e)) + '<div class="gx-tools"><button class="btn btn-ghost btn-sm" data-act="add">+ série</button><button class="btn btn-ghost btn-sm" data-act="del"' + (e.sets.length <= 1 ? ' disabled' : '') + '>− série</button></div></div>';
    });
    var prog = []; Object.keys(d.program).forEach(function (k) { d.program[k].forEach(function (p) { prog.push(p); }); });
    h += '<datalist id="gym-prog">' + prog.map(function (p) { return '<option value="' + esc(p[0]) + '">'; }).join('') + '</datalist>';
    h += '<div class="card gym-add"><input id="gym-new" list="gym-prog" placeholder="Ajouter un exercice…"><button class="btn btn-sm" id="gym-new-ok">Ajouter</button></div>';
    h += '<div class="card gym-note"><div class="mono-label">Note de séance</div><textarea id="gym-note" rows="3" placeholder="Sensations, matériel, douleur…">' + esc(G.note) + '</textarea></div>';
    h += '<div class="gym-end"><button class="btn btn-green" id="gym-finish">' + (G.finished ? 'Réenregistrer la séance' : 'Terminer la séance') + '</button></div>';
    if (d.parsed.notes && d.parsed.notes.length) h += '<div class="panel gym-notes"><div class="ttl">Consignes</div>' + d.parsed.notes.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') + '</div>';
    gymPanel(false); rwCleanup();
    $('#view').innerHTML = '<div class="gym">' + h + '</div>';
    gymSaveBadge(); gymBind();
  }
  function gymReps(f, v, lab) {
    return '<span class="gx-r" data-f="' + f + '">' + (lab ? '<i>' + lab + '</i>' : '') + '<button data-act="r-" aria-label="−1 rép">−</button><b data-f="' + f + '">' + gymNum(v) + '</b><button data-act="r+" aria-label="+1 rép">+</button></span>';
  }
  function gymBind() {
    $('#gym-back').onclick = function () { go('week'); };
    $('#gym-note').oninput = function () { G.note = this.value; gymSaveSoon(1500); };
    $('#gym-finish').onclick = function () { clearTimeout(G.timer); this.disabled = true; this.textContent = 'Enregistrement…'; gymSave(true, 0); };
    $('#gym-new').addEventListener('focus', function () { gymPanel(true); });
    $('#gym-new').addEventListener('blur', function () { setTimeout(function () { if (!$('.gx-repl:not([hidden])')) gymPanel(false); }, 150); });
    $('#gym-new-ok').onclick = function () {
      var v = $('#gym-new').value.trim(); if (!v) return;
      G.ex.push(gymFromParsed(gymLookup(v))); gymSaveSoon(); renderGym();
    };
    $('#gym-order').onclick = function () { G.order = !G.order; gymPanel(false); renderGym(); };
    if (G.order) { gymOrderBind(); return; }
    $$('.gym-ex').forEach(function (card) {
      var i = +card.getAttribute('data-ex'), e = G.ex[i];
      if (RPE_UI === 'claude2') rpeClaude2(card, e); else if (RPE_UI === 'claude') rpeClaude(card, e); else rpeWheel(card, e);
      card.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act'), row = b.closest('[data-set]'), j = row ? +row.getAttribute('data-set') : -1, s = j >= 0 ? e.sets[j] : null, re = false;
        if (act === 'w-' || act === 'w+') { var st = gymStep(e, i); s.weight_lbs = Math.max(0, Math.round(((+s.weight_lbs || 0) + (act === 'w+' ? st : -st)) * 2) / 2); if (s.weight_d !== null && s.weight_d !== undefined) { s.weight_d = Math.max(0, Math.round((s.weight_d + (act === 'w+' ? st : -st)) * 2) / 2); re = true; } }
        else if (act === 'step') { var sv = +b.getAttribute('data-v'); G.d.steps = G.d.steps || {}; G.d.steps[gymKey(e.name)] = sv; gymPersistStep(e.name, sv, 0); gymPanel(false); renderGym(); return; }
        else if (act === 'r-' || act === 'r+') { var f = b.parentNode.getAttribute('data-f'); s[f] = Math.max(0, (+s[f] || 0) + (act === 'r+' ? 1 : -1)); }
        else if (act === 'ok') {
          s.status = s.status === 'done' ? 'todo' : 'done';
          var nx = e.sets[j + 1]; if (s.status === 'done' && nx && nx.status !== 'done') { nx.weight_lbs = s.weight_lbs; ['reps', 'reps_g', 'reps_d'].forEach(function (k) { if (s[k] !== undefined) nx[k] = s[k]; }); }
          if (s.status === 'done' && navigator.vibrate) navigator.vibrate(15);
          re = true;
        }
        else if (act === 'rpe') { var v = +b.getAttribute('data-v'); e.rpe = e.rpe === v ? null : v; re = true; }
        else if (act === 'add') { var last = e.sets[e.sets.length - 1] || { weight_lbs: null }; var c = JSON.parse(JSON.stringify(last)); c.status = 'todo'; e.sets.push(c); re = true; }
        else if (act === 'del') { if (e.sets.length > 1) e.sets.pop(); re = true; }
        else if (act === 'menu') { var rp = $('.gx-repl', card); rp.hidden = !rp.hidden; gymPanel(!rp.hidden); if (!rp.hidden) { var rpi = $('input', rp); setTimeout(function () { rpi.scrollIntoView({ block: 'center' }); }, 50); } return; }
        else if (act === 'repl-ok') { var nv = $('.gx-repl input', card).value.trim(); if (!nv) return; var ne = gymFromParsed(gymLookup(nv)); ne.sets = e.sets.map(function () { return JSON.parse(JSON.stringify(ne.sets[0])); }); G.ex[i] = ne; re = true; }
        else if (act === 'edit') { gymEdit(i); return; }
        else if (act === 'order') { G.order = true; gymPanel(false); renderGym(); var oc = $('.gym-ex[data-ex="' + i + '"]'); if (oc) oc.scrollIntoView({ block: 'center' }); return; }
        else if (act === 'rm') { if (!confirm('Retirer « ' + e.name + ' » ?')) return; G.ex.splice(i, 1); re = true; }
        else return;
        if (re) gymPanel(false);
        ev.stopPropagation(); gymSaveSoon();
        if (re) renderGym(); else gymPaint(card, e);
      });
    });
  }
  // v90 : page plein écran « Modifier l'exercice » (champs existants uniquement : nom, objectif/récup, séries charge/reps, pas de charge, note).
  // Travaille sur une copie ; « Enregistrer » remplace l'exo (même objet logique, séries conservées), « Annuler » ne change rien.
  function gymEdit(i) {
    var src = G.ex[i]; if (!src) return;
    var e = JSON.parse(JSON.stringify(src)), y0 = window.scrollY, step0 = gymStep(src, i), step = step0;
    var ov = document.createElement('div'); ov.id = 'gx-edit'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Modifier l\'exercice');
    var num = function (v) { return v === null || v === undefined || v === '' ? '' : String(v); };
    var setsHtml = function () {
      return e.sets.map(function (s, j) {
        var side = function (lb, wf, rf) { return '<div class="ge-side"><i>' + lb + '</i><label><input inputmode="decimal" data-f="' + wf + '" value="' + num(wf === 'weight_d' && (s.weight_d === null || s.weight_d === undefined) ? s.weight_lbs : s[wf]) + '"><small>lbs</small></label><label><input inputmode="numeric" data-f="' + rf + '" value="' + num(s[rf]) + '"><small>reps</small></label></div>'; };
        return '<div class="ge-set' + (e.unilateral ? ' uni' : '') + '" data-set="' + j + '"><span class="gx-n">' + (j + 1) + '</span>' +
          (e.unilateral ? '<div class="ge-lr">' + side('G', 'weight_lbs', 'reps_g') + side('D', 'weight_d', 'reps_d') + '</div>'
            : '<label><input inputmode="decimal" data-f="weight_lbs" value="' + num(s.weight_lbs) + '"><small>lbs</small></label><label><input inputmode="numeric" data-f="reps" value="' + num(s.reps) + '"><small>reps</small></label>') +
          (s.status === 'done' ? '<span class="ge-done">✓</span>' : '<span class="ge-done"></span>') + '</div>';
      }).join('');
    };
    ov.innerHTML = '<div class="ge-bar"><button class="btn btn-ghost btn-sm" data-ge="cancel">Annuler</button><b>Modifier l\'exercice</b><button class="btn btn-green btn-sm" data-ge="save">Enregistrer</button></div>' +
      '<div class="ge-body">' +
      '<label class="ge-f"><span class="mono-label">Exercice</span><input id="ge-name" list="gym-prog" value="' + esc(e.name) + '"></label>' +
      '<label class="ge-f"><span class="mono-label">Objectif · récup</span><input id="ge-target" value="' + esc(e.target || '') + '" placeholder="ex. 3×8–10 · 45 lbs · récup 1\'30"></label>' +
      '<div class="ge-f"><span class="mono-label">Côtés</span><div class="gx-step"><button class="pill' + (e.unilateral ? '' : ' on') + '" data-ge="uni" data-v="0">Les deux ensemble</button><button class="pill' + (e.unilateral ? ' on' : '') + '" data-ge="uni" data-v="1">Gauche / Droite</button></div></div>' +
      '<div class="ge-f"><span class="mono-label">Séries</span><div class="ge-sets">' + setsHtml() + '</div>' +
      '<div class="ge-row"><button class="btn btn-ghost btn-sm" data-ge="add">+ série</button><button class="btn btn-ghost btn-sm" data-ge="del">− série</button></div></div>' +
      '<div class="ge-f"><span class="mono-label">Pas de charge</span><div class="gx-step">' + [5, 2.5].map(function (v) { return '<button class="pill' + (step === v ? ' on' : '') + '" data-ge="step" data-v="' + v + '">' + String(v).replace('.', ',') + ' lbs</button>'; }).join('') + '</div></div>' +
      '<label class="ge-f"><span class="mono-label">Note de l\'exercice</span><textarea id="ge-note" rows="3" placeholder="Réglage machine, sensations…">' + esc(e.note || '') + '</textarea></label>' +
      '<button class="btn btn-ghost btn-sm ge-rm" data-ge="rm">Retirer cet exercice de la séance</button></div>';
    document.body.appendChild(ov); document.body.classList.add('ge-open'); gymPanel(true);
    var read = function () { // relit les champs dans la copie
      e.name = $('#ge-name', ov).value.trim() || src.name; e.target = $('#ge-target', ov).value.trim(); e.note = $('#ge-note', ov).value;
      $$('.ge-set', ov).forEach(function (r) { var s = e.sets[+r.getAttribute('data-set')]; $$('input', r).forEach(function (inp) { var v = inp.value.replace(',', '.').trim(); s[inp.getAttribute('data-f')] = v === '' || isNaN(+v) ? null : Math.max(0, +v); });
        if (e.unilateral && s.weight_d === s.weight_lbs) s.weight_d = null; });
    };
    var paintSets = function () { $('.ge-sets', ov).innerHTML = setsHtml(); $('[data-ge="del"]', ov).disabled = e.sets.length <= 1; };
    var close = function () { ov.remove(); document.body.classList.remove('ge-open'); gymPanel(false); };
    paintSets();
    ov.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-ge]'); if (!b) return; var a = b.getAttribute('data-ge');
      if (a === 'cancel') { close(); return; }
      if (a === 'add') { read(); var c = JSON.parse(JSON.stringify(e.sets[e.sets.length - 1] || { weight_lbs: null, reps: null })); c.status = 'todo'; e.sets.push(c); paintSets(); return; }
      if (a === 'del') { read(); if (e.sets.length > 1) e.sets.pop(); paintSets(); return; }
      if (a === 'uni') { read(); var on = b.getAttribute('data-v') === '1'; if (on === !!e.unilateral) return; e.unilateral = on; // v92 : split G/D, rien n'est effacé
        if (on) e.sets.forEach(function (s) { if (s.reps_g === null || s.reps_g === undefined) s.reps_g = s.reps; if (s.reps_d === null || s.reps_d === undefined) s.reps_d = s.reps; });
        else e.sets.forEach(function (s) { if (s.reps === null || s.reps === undefined) s.reps = s.reps_g !== null && s.reps_g !== undefined ? s.reps_g : s.reps_d; });
        $$('[data-ge="uni"]', ov).forEach(function (x) { x.classList.toggle('on', x === b); }); paintSets(); return; }
      if (a === 'step') { step = +b.getAttribute('data-v'); $$('[data-ge="step"]', ov).forEach(function (x) { x.classList.toggle('on', x === b); }); return; }
      if (a === 'rm') { if (!confirm('Retirer « ' + src.name + ' » de la séance ?')) return; close(); G.ex.splice(i, 1); gymSaveSoon(); renderGym(); window.scrollTo(0, y0); return; }
      if (a === 'save') {
        read(); G.ex[i] = e;
        if (step !== step0) { G.d.steps = G.d.steps || {}; G.d.steps[gymKey(e.name)] = step; gymPersistStep(e.name, step, 0); }
        close(); gymSaveSoon(); renderGym(); window.scrollTo(0, y0);
      }
    });
  }
  // v90 : réordonner les exos (mode « Modifier »). Les séries/notes/RPE voyagent avec l'objet exercice ; l'ordre est enregistré via uiStrengthSave (StrengthLog.ex_idx), jamais dans Plan.
  function gymMove(order) {
    var old = G.ex; G.ex = order.map(function (k) { return old[k]; });
    if (order.some(function (k, n) { return k !== n; })) gymSaveSoon();
    renderGym();
  }
  function gymOrderBind() {
    var list = $$('.gym-ex.gx-ord'), n = G.ex.length;
    list.forEach(function (card) {
      var i = +card.getAttribute('data-ex');
      card.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-act]'); if (!b) return;
        var j = b.getAttribute('data-act') === 'up' ? i - 1 : i + 1; if (j < 0 || j >= n) return;
        var o = []; for (var k = 0; k < n; k++) o.push(k); o[i] = j; o[j] = i;
        if (navigator.vibrate) navigator.vibrate(8);
        gymMove(o);
      });
      var hd = $('.gx-handle', card), drag = null;
      var y = function (ev) { return ev.touches ? ev.touches[0].clientY : ev.clientY; };
      var start = function (ev) {
        if (drag) return; ev.preventDefault();
        var r = card.getBoundingClientRect();
        drag = { grab: y(ev) - r.top, t: 0 }; card.classList.add('drag'); if (navigator.vibrate) navigator.vibrate(8);
      };
      var move = function (ev) {
        if (!drag) return; ev.preventDefault();
        var py = y(ev), nat = card.getBoundingClientRect().top - drag.t;
        var pv = card.previousElementSibling, nx = card.nextElementSibling;
        if (pv && pv.classList.contains('gx-ord')) { var pr = pv.getBoundingClientRect(); if (py - drag.grab < pr.top + pr.height / 2) { card.parentNode.insertBefore(card, pv); nat = card.getBoundingClientRect().top - drag.t; if (navigator.vibrate) navigator.vibrate(4); } }
        if (nx && nx.classList.contains('gx-ord')) { var nr = nx.getBoundingClientRect(); if (py - drag.grab + card.offsetHeight > nr.top + nr.height / 2) { card.parentNode.insertBefore(nx, card); nat = card.getBoundingClientRect().top - drag.t; if (navigator.vibrate) navigator.vibrate(4); } }
        drag.t = py - drag.grab - nat; card.style.transform = 'translateY(' + drag.t.toFixed(1) + 'px)';
      };
      var end = function () {
        if (!drag) return; drag = null; card.classList.remove('drag'); card.style.transform = '';
        gymMove($$('.gym-ex.gx-ord').map(function (c) { return +c.getAttribute('data-ex'); }));
      };
      hd.addEventListener('touchstart', start, { passive: false });
      hd.addEventListener('touchmove', move, { passive: false });
      hd.addEventListener('touchend', end); hd.addEventListener('touchcancel', end);
      hd.addEventListener('mousedown', function (ev) {
        start(ev);
        var mm = function (e2) { move(e2); }, mu = function () { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); end(); };
        document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
      });
    });
  }
  // v53 : sélecteur RPE « roue crantée » — chiffres sur les entiers, trait sur les demi-points, aimant sur chaque 0,5.
  var RPE_V = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10], RPE_W = 22;
  var RPE_WORD = { 6: 'facile', 6.5: 'facile +', 7: 'modéré', 7.5: 'modéré +', 8: 'difficile', 8.5: 'difficile +', 9: 'très dur', 9.5: 'quasi max', 10: 'max' };
  var RPE_RIR = { 6: '4 reps en réserve', 6.5: '3–4 en réserve', 7: '3 reps en réserve', 7.5: '2–3 en réserve', 8: '2 reps en réserve', 8.5: '1–2 en réserve', 9: '1 rep en réserve', 9.5: '0–1 en réserve', 10: 'aucune en réserve' };
  function rpeLab(v) { return !RPE_WORD[v] ? '<span class="muted">RPE · faire tourner la roue</span>' : '<b>RPE ' + String(v).replace('.', ',') + '</b> · ' + RPE_WORD[v] + ' · ' + RPE_RIR[v]; }
  function rpeWheelHtml(e) {
    return '<div class="rw' + (!RPE_WORD[e.rpe] ? ' unset' : '') + '"><div class="rw-sc"><div class="rw-tr"><i class="rw-pad"></i>' +
      RPE_V.map(function (v) { return '<span class="rw-c' + (v % 1 ? '' : ' maj') + '" data-v="' + v + '">' + (v % 1 ? '' : '<b>' + v + '</b>') + '</span>'; }).join('') +
      '<i class="rw-pad"></i></div></div><i class="rw-ind"></i></div><div class="rw-lab">' + rpeLab(e.rpe) + '</div>';
  }
  function rpeWheel(card, e) {
    var w = $('.rw', card); if (!w) return;
    var sc = $('.rw-sc', w), cs = $$('.rw-c', w), lab = $('.rw-lab', card), user = false, last = e.rpe, tEnd = null;
    $$('.rw-pad', w).forEach(function (p) { p.style.width = (sc.clientWidth / 2 - RPE_W / 2) + 'px'; });
    var idx = function () { return Math.max(0, Math.min(RPE_V.length - 1, Math.round(sc.scrollLeft / RPE_W))); };
    var paint = function () {
      var c = sc.scrollLeft + sc.clientWidth / 2, half = sc.clientWidth / 2;
      cs.forEach(function (el, i) { // courbure : crans plus petits, resserrés et estompés vers les bords
        var dx = (i * RPE_W + RPE_W / 2 + (sc.clientWidth / 2 - RPE_W / 2)) - c, t = Math.min(1, Math.abs(dx) / half);
        el.style.transform = 'translateX(' + (-dx * t * 0.28).toFixed(1) + 'px) scale(' + (1 - t * 0.38).toFixed(3) + ')'; el.style.opacity = (1 - t * 0.8).toFixed(2);
      });
      var v = RPE_V[idx()];
      if (user && v !== last) { last = v; if (navigator.vibrate) navigator.vibrate(4); lab.innerHTML = rpeLab(v); w.classList.remove('unset'); }
    };
    var commit = function () { if (!user) return; var v = RPE_V[idx()]; if (e.rpe !== v) { e.rpe = v; lab.innerHTML = rpeLab(v); w.classList.remove('unset'); gymSaveSoon(); } };
    if (!RPE_WORD[e.rpe]) { e.rpe = null; last = null; }
    sc.scrollLeft = RPE_V.indexOf(e.rpe === null ? 8 : e.rpe) * RPE_W; paint();
    sc.addEventListener('scroll', function () { requestAnimationFrame(paint); clearTimeout(tEnd); tEnd = setTimeout(commit, 140); }, { passive: true });
    ['pointerdown', 'touchstart', 'wheel'].forEach(function (ev) { sc.addEventListener(ev, function () { user = true; }, { passive: true }); });
    cs.forEach(function (el, i) { el.addEventListener('click', function (ev) { ev.stopPropagation(); user = true; if (Math.abs(sc.scrollLeft - i * RPE_W) < 2) commit(); else sc.scrollTo({ left: i * RPE_W, behavior: 'smooth' }); }); });
  }
  // v54 : molette RPE modélisée par Claude (live/rpe-claude/molette-rpe-claude.html), intégrée telle quelle autant que possible.
  // Retour à la roue v53 : RPE_UI = 'v53' (un déploiement).
  // Sélecteur RPE : 'claude2' (v55, molette v2) · 'claude' (v54, molette v1) · 'v53' (roue crantée). Repère v2 : 'a' | 'b' | 'c'.
  // v57 : RPE_INK = sélection en encre noire (false = vert v55/v56) ; RPE_FRAME = boîtier (true = bordure + ombre + fond v55/v56, false = roue seule).
  var RPE_UI = 'claude2', RPE_MARK = 'a', RPE_INK = true, RPE_FRAME = 'wheel'; // v59 : 'wheel' = cadre à la largeur de la roue · true = cadre pleine largeur · false = roue seule
  function rpeClaudeHtml(e) {
    var set = !!RPE_WORD[e.rpe];
    return '<div class="rpe-wheel' + (set ? '' : ' rw-unset') + '" data-value="' + (set ? e.rpe : 8) + '" data-min="6" data-max="10" data-step="0.5" aria-label="RPE"></div><div class="rw-lab">' + rpeLab(set ? e.rpe : null) + '</div>';
  }
  function rpeClaude(card, e) {
    var w = $('.rpe-wheel', card), lab = $('.rw-lab', card); if (!w) return;
    if (!RPE_WORD[e.rpe]) e.rpe = null;
    var user = false;
    ['pointerdown', 'wheel', 'keydown'].forEach(function (t) { w.addEventListener(t, function () { user = true; }, { passive: true }); });
    w.addEventListener('change', function (ev) {
      ev.stopPropagation(); if (!user) return;
      var v = +ev.detail.value; if (!RPE_WORD[v]) return;
      lab.innerHTML = rpeLab(v); w.classList.remove('rw-unset');
      if (e.rpe !== v) { e.rpe = v; gymSaveSoon(); }
    });
    RpeWheel.init(w);
  }
  // v55 : molette RPE v2 de Claude (live/rpe-claude/molette-rpe-claude-v2.html), adaptée : hauteur = 75 % d'une ligne de série,
  // repère discret (variantes A/B/C), faux tap au défilement corrigé, molette souris horizontale seulement, libération des écouteurs.
  var RpeWheel2 = (function () {
    var DTH = 14, RIDGE_STEP = 6, rad = function (d) { return d * Math.PI / 180; };
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    function init(wheel, live) {
      if (wheel._rw) return; wheel._rw = true; if (live) live.push(wheel);
      var MIN = +wheel.dataset.min || 1, MAX = +wheel.dataset.max || 10, STEP = +wheel.dataset.step || 0.5;
      var N = Math.round((MAX - MIN) / STEP) + 1, i, k;
      wheel.tabIndex = 0; wheel.setAttribute('role', 'slider');
      wheel.setAttribute('aria-valuemin', MIN); wheel.setAttribute('aria-valuemax', MAX);
      wheel.innerHTML = '<div class="rw-body"></div><div class="rw-stage"><div class="rw-ring"></div></div><div class="rw-light"></div><div class="rw-mk"><i class="rw-mk1"></i><i class="rw-mk2"></i></div>';
      var stage = wheel.querySelector('.rw-stage'), ring = wheel.querySelector('.rw-ring'), items = [], ridges = [];
      for (i = 0; i < N; i++) {
        var v = MIN + i * STEP, el = document.createElement('div');
        el.className = 'rw-it'; el.dataset.i = i;
        el.innerHTML = v % 1 === 0 ? '<b>' + v + '</b>' : '<i></i>';
        ring.appendChild(el); items.push(el);
      }
      for (k = 0; k < 360 / RIDGE_STEP; k++) { var r = document.createElement('div'); r.className = 'rw-rg'; ring.appendChild(r); ridges.push(r); }
      var clampI = function (x) { return Math.max(0, Math.min(N - 1, x)); };
      var R = 160, unit = 0, tch = false, p = clampI(Math.round(((+wheel.dataset.value || MIN) - MIN) / STEP)), cur = -1, target = p, anim = 0, dragging = false;
      function show(el, on) { if (el._v !== on) { el.style.visibility = on ? 'visible' : 'hidden'; el._v = on; } }
      function measure() {
        if (!wheel.isConnected || !wheel.clientWidth || !wheel.clientHeight) return;
        R = wheel.classList.contains('rw-fit') ? Math.max(60, stage.clientWidth / 2) : Math.max(100, wheel.clientWidth / 2); unit = R * rad(DTH); // v59 : en rw-fit, R = demi-largeur du cadre
        stage.style.perspective = Math.round(R * 3.2) + 'px'; ring.style.transform = 'translateZ(' + (-R) + 'px)';
        render(true);
      }
      function render(silent) {
        for (var i = 0; i < N; i++) {
          var th = (i - p) * DTH, el = items[i];
          if (Math.abs(th) >= 90) { show(el, false); continue; }
          show(el, true);
          el.style.transform = 'rotateY(' + th.toFixed(2) + 'deg) translateZ(' + R + 'px)';
          el.style.opacity = (0.35 + 0.65 * Math.cos(rad(th))).toFixed(3);
        }
        var off = p * DTH;
        for (var k = 0; k < ridges.length; k++) {
          var t2 = ((k * RIDGE_STEP - off) % 360 + 540) % 360 - 180, r = ridges[k];
          if (Math.abs(t2) >= 89) { show(r, false); continue; }
          show(r, true); r.style.transform = 'rotateY(' + t2.toFixed(2) + 'deg) translateZ(' + R + 'px)';
        }
        var idx = clampI(Math.round(p));
        if (idx !== cur) {
          if (cur >= 0) items[cur].classList.remove('rw-on');
          items[idx].classList.add('rw-on'); cur = idx;
          var v = MIN + idx * STEP;
          wheel.value = v; wheel.dataset.value = v;
          wheel.setAttribute('aria-valuenow', v); wheel.setAttribute('aria-valuetext', String(v).replace('.', ','));
          if (!silent && tch) {
            wheel.dispatchEvent(new CustomEvent('change', { detail: { value: v, user: true }, bubbles: true }));
            if (dragging && navigator.vibrate) try { navigator.vibrate(3); } catch (e) {}
          }
        }
      }
      function animateTo(t) {
        target = clampI(t); cancelAnimationFrame(anim);
        var from = p, d = target - from;
        if (reduce || Math.abs(d) < 1e-3) { p = target; render(); return; }
        var dur = Math.min(900, Math.max(240, 220 + Math.abs(d) * 55)), t0 = performance.now();
        var step = function (now) { var q = Math.min(1, (now - t0) / dur); p = from + d * (1 - Math.pow(1 - q, 3)); render(); if (q < 1) anim = requestAnimationFrame(step); };
        anim = requestAnimationFrame(step);
      }
      wheel.setValue = function (v) { animateTo(Math.round((v - MIN) / STEP)); };
      wheel._touched = function () { return tch; };
      var x0 = 0, p0 = 0, moved = 0, samples = [];
      wheel.addEventListener('pointerdown', function (e) {
        if (e.button > 0) return;
        cancelAnimationFrame(anim); dragging = true; moved = 0; x0 = e.clientX; p0 = p;
        samples = [{ t: e.timeStamp, x: e.clientX }]; wheel.classList.add('rw-grab');
        try { wheel.setPointerCapture(e.pointerId); } catch (err) {}
      });
      wheel.addEventListener('pointermove', function (e) {
        if (!dragging || !unit) return;
        var dx = e.clientX - x0; moved = Math.max(moved, Math.abs(dx));
        var np = p0 - dx / unit; if (!isFinite(np)) return; if (moved >= 8) tch = true;
        if (np < 0) np *= 0.3; else if (np > N - 1) np = N - 1 + (np - (N - 1)) * 0.3;
        p = np; render();
        samples.push({ t: e.timeStamp, x: e.clientX });
        while (samples.length > 2 && e.timeStamp - samples[0].t > 100) samples.shift();
      });
      function release(e) {
        if (!dragging) return; dragging = false; wheel.classList.remove('rw-grab');
        if (e.type === 'pointercancel') { cancelAnimationFrame(anim); p = Math.round(p0); render(true); return; } // intégration DCAP : défilement vertical pris par le navigateur → retour au cran de départ
        if (moved < 8) {
          var hit = document.elementsFromPoint(e.clientX, e.clientY).filter(function (n) { return n.classList && n.classList.contains('rw-it') && wheel.contains(n); })[0];
          if (hit) { tch = true; animateTo(+hit.dataset.i); } else animateTo(Math.round(p0)); return;
        }
        var a = samples[0], b = samples[samples.length - 1], dt = Math.max(16, b.t - a.t);
        tch = true; animateTo(Math.round(p - (b.x - a.x) / dt / unit * 240));
      }
      wheel.addEventListener('pointerup', release);
      wheel.addEventListener('pointercancel', release);
      wheel.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      var acc = 0;
      wheel.addEventListener('wheel', function (e) {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // intégration DCAP : geste vertical = défilement de la page
        e.preventDefault(); tch = true; acc += e.deltaX;
        var n = 0; while (Math.abs(acc) >= 28) { n += Math.sign(acc); acc -= Math.sign(acc) * 28; }
        if (n) animateTo(target + n);
      }, { passive: false });
      wheel.addEventListener('keydown', function (e) {
        var m = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 2, PageDown: -2 };
        if (e.key in m) { e.preventDefault(); tch = true; animateTo(target + m[e.key]); }
        else if (e.key === 'Home') { e.preventDefault(); animateTo(0); }
        else if (e.key === 'End') { e.preventDefault(); animateTo(N - 1); }
      });
      var ro = null;
      if (window.ResizeObserver) { ro = new ResizeObserver(measure); ro.observe(wheel); } else window.addEventListener('resize', measure);
      wheel._rwDestroy = function () { cancelAnimationFrame(anim); if (ro) ro.disconnect(); else window.removeEventListener('resize', measure); };
      measure();
    }
    return { init: init };
  })();

  function rpeClaude2Html(e) {
    var set = !!RPE_WORD[e.rpe];
    return '<div class="rpe-wheel v2 mk-' + RPE_MARK + (RPE_INK ? ' sel-ink' : '') + (RPE_FRAME === 'wheel' ? ' rw-fit' : RPE_FRAME ? '' : ' rw-bare') + (set ? '' : ' rw-unset') + '" data-value="' + (set ? e.rpe : 8) + '" data-min="6" data-max="10" data-step="0.5" aria-label="RPE"></div><div class="rw-lab">' + rpeLab(set ? e.rpe : null) + '</div>';
  }
  function rpeClaude2(card, e) {
    var w = $('.rpe-wheel', card), lab = $('.rw-lab', card), row = $('.gx-set', card); if (!w) return;
    if (row && row.offsetHeight) w.style.setProperty('--rw-h', Math.round(row.offsetHeight * 0.75) + 'px'); // 75 % d'une ligne de série
    if (!RPE_WORD[e.rpe]) e.rpe = null;
    var user = false;
    ['pointerdown', 'wheel', 'keydown'].forEach(function (t) { w.addEventListener(t, function () { user = true; }, { passive: true }); });
    w.addEventListener('change', function (ev) {
      ev.stopPropagation(); if (!(ev.detail && ev.detail.user) || !w._touched || !w._touched()) return; // règle stricte : geste réel de l'utilisateur sur CETTE molette
      var v = +ev.detail.value; if (!RPE_WORD[v]) return;
      lab.innerHTML = rpeLab(v); w.classList.remove('rw-unset');
      if (e.rpe !== v) { e.rpe = v; e.rpeTouched = true; gymSaveSoon(); }
    });
    RpeWheel2.init(w, RW_LIVE);
  }
  /** Libère les molettes (ResizeObserver, animations) avant un re-rendu ou un changement d'onglet. */
  var RW_LIVE = [];
  function rwCleanup() { RW_LIVE.forEach(function (w) { try { w._rwDestroy && w._rwDestroy(); } catch (x) {} }); RW_LIVE = []; }
  var RpeWheel = (function () {
    var DTH = 17, RIDGE_STEP = 4, rad = function (d) { return d * Math.PI / 180; };
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    function init(wheel) {
      if (wheel._rw) return; wheel._rw = true; RW_LIVE.push(wheel);
      var MIN = +wheel.dataset.min || 1, MAX = +wheel.dataset.max || 10, STEP = +wheel.dataset.step || 0.5;
      var N = Math.round((MAX - MIN) / STEP) + 1, i, k;
      wheel.tabIndex = 0; wheel.setAttribute('role', 'slider');
      wheel.setAttribute('aria-valuemin', MIN); wheel.setAttribute('aria-valuemax', MAX);
      wheel.innerHTML = '<div class="rw-body"></div><div class="rw-fill"></div><div class="rw-stage"><div class="rw-ring"></div></div><div class="rw-light"></div><div class="rw-frame"></div>';
      var ring = wheel.querySelector('.rw-ring'), items = [], ridges = [];
      for (i = 0; i < N; i++) {
        var v = MIN + i * STEP, el = document.createElement('div');
        el.className = 'rw-it'; el.dataset.i = i;
        el.innerHTML = v % 1 === 0 ? '<b>' + v + '</b>' : '<i></i>';
        ring.appendChild(el); items.push(el);
      }
      for (k = 0; k < 360 / RIDGE_STEP; k++) { var r = document.createElement('div'); r.className = 'rw-rg'; ring.appendChild(r); ridges.push(r); }
      var clampI = function (x) { return Math.max(0, Math.min(N - 1, x)); };
      var R = 160, unit = 48, p = clampI(Math.round(((+wheel.dataset.value || MIN) - MIN) / STEP)), cur = -1, target = p, anim = 0, dragging = false;
      function measure() { if (!wheel.isConnected) return; R = Math.max(110, wheel.clientWidth * 0.40); unit = R * rad(DTH); ring.style.transform = 'translateZ(' + (-R) + 'px)'; render(true); }
      function render(silent) {
        for (var i = 0; i < N; i++) {
          var th = (i - p) * DTH, el = items[i];
          if (Math.abs(th) >= 90) { el.style.visibility = 'hidden'; continue; }
          var c = Math.cos(rad(th));
          el.style.visibility = 'visible'; el.style.transform = 'rotateY(' + th + 'deg) translateZ(' + R + 'px)'; el.style.opacity = (0.15 + 0.85 * c * c).toFixed(3);
        }
        var off = p * DTH;
        for (var k = 0; k < ridges.length; k++) {
          var t2 = ((k * RIDGE_STEP - off) % 360 + 540) % 360 - 180, r = ridges[k];
          if (Math.abs(t2) >= 88) { r.style.visibility = 'hidden'; continue; }
          r.style.visibility = 'visible'; r.style.transform = 'rotateY(' + t2 + 'deg) translateZ(' + R + 'px)';
        }
        var idx = clampI(Math.round(p));
        if (idx !== cur) {
          if (cur >= 0) items[cur].classList.remove('rw-on');
          items[idx].classList.add('rw-on'); cur = idx;
          var v = MIN + idx * STEP;
          wheel.value = v; wheel.dataset.value = v;
          wheel.setAttribute('aria-valuenow', v); wheel.setAttribute('aria-valuetext', String(v).replace('.', ','));
          if (!silent) {
            wheel.dispatchEvent(new CustomEvent('change', { detail: { value: v }, bubbles: true }));
            if (dragging && navigator.vibrate) try { navigator.vibrate(3); } catch (e) {}
          }
        }
      }
      function animateTo(t) {
        target = clampI(t); cancelAnimationFrame(anim);
        var from = p, d = target - from;
        if (reduce || Math.abs(d) < 1e-3) { p = target; render(); return; }
        var dur = Math.min(900, Math.max(240, 220 + Math.abs(d) * 55)), t0 = performance.now();
        var step = function (now) { var q = Math.min(1, (now - t0) / dur); p = from + d * (1 - Math.pow(1 - q, 3)); render(); if (q < 1) anim = requestAnimationFrame(step); };
        anim = requestAnimationFrame(step);
      }
      wheel.setValue = function (v) { animateTo(Math.round((v - MIN) / STEP)); };
      var x0 = 0, p0 = 0, moved = 0, samples = [];
      wheel.addEventListener('pointerdown', function (e) {
        cancelAnimationFrame(anim); dragging = true; moved = 0; x0 = e.clientX; p0 = p;
        samples = [{ t: e.timeStamp, x: e.clientX }]; wheel.classList.add('rw-grab'); try { wheel.setPointerCapture(e.pointerId); } catch (x) {}
      });
      wheel.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var dx = e.clientX - x0; moved = Math.max(moved, Math.abs(dx));
        var np = p0 - dx / unit;
        if (np < 0) np *= 0.3; else if (np > N - 1) np = N - 1 + (np - (N - 1)) * 0.3;
        p = np; render();
        samples.push({ t: e.timeStamp, x: e.clientX }); if (samples.length > 6) samples.shift();
      });
      function release(e) {
        if (!dragging) return; dragging = false; wheel.classList.remove('rw-grab');
        if (moved < 5) {
          var hit = document.elementsFromPoint(e.clientX, e.clientY).filter(function (n) { return n.classList && n.classList.contains('rw-it') && wheel.contains(n); })[0];
          animateTo(hit ? +hit.dataset.i : Math.round(p)); return;
        }
        var a = samples[0], b = samples[samples.length - 1], dt = Math.max(1, b.t - a.t);
        animateTo(Math.round(p - (b.x - a.x) / dt / unit * 260));
      }
      wheel.addEventListener('pointerup', release);
      // intégration DCAP : pointercancel = le navigateur a pris la main (défilement vertical) → on revient au cran de départ, sans « tap »
      wheel.addEventListener('pointercancel', function () { if (!dragging) return; dragging = false; wheel.classList.remove('rw-grab'); animateTo(Math.round(p0)); });
      var acc = 0;
      wheel.addEventListener('wheel', function (e) {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // intégration DCAP : molette verticale = défilement de la page
        e.preventDefault(); acc += e.deltaX;
        var n = 0; while (Math.abs(acc) >= 28) { n += Math.sign(acc); acc -= Math.sign(acc) * 28; }
        if (n) animateTo(target + n);
      }, { passive: false });
      wheel.addEventListener('keydown', function (e) {
        var m = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 2, PageDown: -2 };
        if (e.key in m) { e.preventDefault(); animateTo(target + m[e.key]); }
        else if (e.key === 'Home') { e.preventDefault(); animateTo(0); }
        else if (e.key === 'End') { e.preventDefault(); animateTo(N - 1); }
      });
      var ro = null;
      if (window.ResizeObserver) { ro = new ResizeObserver(measure); ro.observe(wheel); } else window.addEventListener('resize', measure);
      wheel._rwDestroy = function () { cancelAnimationFrame(anim); if (ro) ro.disconnect(); else window.removeEventListener('resize', measure); };
      measure();
    }
    return { init: init };
  })();
  function gymPaint(card, e) {
    $$('[data-set]', card).forEach(function (row) {
      var s = e.sets[+row.getAttribute('data-set')];
      $('.gx-w b', row).textContent = gymNum(s.weight_lbs);
      $$('.gx-r', row).forEach(function (r) { $('b', r).textContent = gymNum(s[r.getAttribute('data-f')]); });
    });
  }
  /** Panneau remplacer / ajouter ouvert : barre d'onglets masquée (remise à la fermeture). */
  function gymPanel(on) { document.body.classList.toggle('panel-open', !!on); }
  function gymKey(name) { return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80); }
  /** Pas de charge : réglage mémorisé (Sheet) sinon 2,5 si la cible ou la dernière charge n'est pas un multiple de 5, sinon 5. */
  function gymStep(e, i) {
    var m = (G.d.steps || {})[gymKey(e.name)]; if (m === 2.5 || m === 5) return m;
    var p = G.prevMap[e.name], ws = [p && p.weight_lbs, p && p.prev && p.prev.weight_lbs, e.sets[0] && e.sets[0].weight_lbs];
    var tw = /(\d+(?:[.,]\d+)?)\s*lbs/.exec(e.target || ''); if (tw) ws.push(+tw[1].replace(',', '.'));
    return ws.some(function (w) { return w !== null && w !== undefined && w !== '' && Math.abs(+w % 5) > 0.01; }) ? 2.5 : 5;
  }
  function gymPersistStep(name, v, attempt) {
    call('uiStrengthStep', name, v).catch(function () { if (attempt < 4) setTimeout(function () { gymPersistStep(name, v, attempt + 1); }, 2000 * Math.pow(2, attempt)); else toast('Pas non enregistré (réseau)'); });
  }
  function gymLookup(name) {
    var P = G.d.program, hit = null;
    Object.keys(P).forEach(function (k) { P[k].forEach(function (p) { if (!hit && p[0].toLowerCase() === name.toLowerCase()) hit = p; }); });
    var uni = /bulgar|split squat|step ?down|unilat|pallof|fente|lunge/i.test(name);
    return { name: hit ? hit[0] : name, sets: 3, reps_min: 8, reps_max: 10, weight_lbs: hit ? hit[1] : null, unilateral: uni };
  }
  window.addEventListener('beforeunload', function () { if (G && G.dirty) try { localStorage.setItem(G.key, JSON.stringify({ t: Date.now(), ex: G.ex, note: G.note })); } catch (e) {} });

  // ------------------------------------------------------------------ MOIS
  function loadMonth() {
    if (!S.ym) { var t = S.today || (S.last && S.last.today) || todayLocal(); S.ym = [+t.slice(0, 4), +t.slice(5, 7)]; }
    var y = S.ym[0], m = S.ym[1], key = y + '-' + m, e = MO[key];
    var pre = function () { var py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; fetchMonth(py, pm).catch(function () {}); };
    if (e && e.data) {
      renderMonth(e.data); pre();
      revalidate(MO, key, 'uiMonth', [y, m], function (d) { if (S.view === 'month' && S.ym[0] === d.year && S.ym[1] === d.month) renderMonth(d); });
      return;
    }
    if (!$('#view .mcal')) loading(); else $('#view .mcal-card').classList.add('mt-wait');
    fetchMonth(y, m).then(function (d) { if (S.view === 'month' && S.ym[0] === d.year && S.ym[1] === d.month) renderMonth(d); pre(); }).catch(fail);
  }
  // Cercles du mois : aire ∝ km (bornée), couleur = surface (route / trail / course), lettre R / T / C ;
  // trait pointillé = séance prévue, rouge = manquée ; plusieurs sorties le même jour = km cumulés + pastille du nombre.
  var SURF = { road: { l: 'R', n: 'Route' }, trail: { l: 'T', n: 'Trail' }, race: { l: 'C', n: 'Course' } };
  function surfOf(it) { return it.surface || (/trail/i.test(it.type || '') ? 'trail' : it.type === 'course' ? 'race' : 'road'); }
  function dotSize(km) { var mob = MOBILE.matches, lo = mob ? 15 : 20, hi = mob ? 38 : 60; return Math.round(Math.max(lo, Math.min(hi, hi * Math.sqrt((+km || 0) / 30)))); }
  function runDot(km, surf, opts) {
    opts = opts || {}; var d = opts.size || dotSize(km);
    return '<span class="run su-' + surf + (opts.planned ? ' planned' : '') + (opts.missed ? ' missed' : '') + '" style="width:' + d + 'px;height:' + d + 'px;font-size:' + Math.max(9, Math.round(d * 0.46)) + 'px">' +
      SURF[surf].l + (opts.count > 1 ? '<i class="cnt">' + opts.count + '</i>' : '') + '</span>';
  }
  function dominant(list) { var by = {}; list.forEach(function (x) { by[x.s] = (by[x.s] || 0) + x.km; }); return Object.keys(by).sort(function (a, b) { return by[b] - by[a]; })[0]; }
  function dayContent(c) {
    var shown = !c.beyond_horizon, done = [], todo = [];
    c.items.forEach(function (it) {
      var km = +(it.act_km || it.km) || 0, x = { s: surfOf(it), km: km, it: it };
      if (it.status === 'done') done.push(x); else if (shown || it.kind === 'act') todo.push(x);
    });
    var race = c.races[0], mob = MOBILE.matches;
    if (done.length) {
      var km = done.reduce(function (a, x) { return a + x.km; }, 0);
      var isRace = race || done.some(function (x) { return x.s === 'race'; });
      return { km: km, html: runDot(km, isRace ? 'race' : dominant(done), { count: done.length }) + '<span class="kl">' + n(km, 1) + (mob ? '' : ' km') + '</span>' };
    }
    if (race) return { km: 0, html: runDot(race.distance_km || 21, 'race', { planned: true }) + '<span class="kl pl">' + (mob ? n(race.distance_km, 0) : esc(race.name)) + '</span>' };
    if (todo.length) {
      var pk = todo.reduce(function (a, x) { return a + x.km; }, 0), missed = todo.every(function (x) { return x.it.status === 'missed'; });
      return { km: 0, html: runDot(pk, dominant(todo), { planned: true, missed: missed, count: todo.length }) +
        '<span class="kl pl">' + (mob ? (pk ? n(pk, 0) : '') : (ABBR[todo[0].it.type] || esc(todo[0].it.type || '')) + (pk ? ' · ' + n(pk, 0) + ' km' : '')) + '</span>' };
    }
    return { km: 0, html: '' };
  }
  var MT_SEL = '.sec h2 .mt, .msum .big, .msum .sub, .splitlbl b, .wk b';
  function renderMonth(d) {
    var mob = MOBILE.matches, S0 = d.summary;
    // v80 : 6 semaines toujours (pas de saut de hauteur d'un mois à l'autre)
    while (d.cells.length && d.cells.length < 42) { var lc = d.cells[d.cells.length - 1]; d.cells.push({ date: addDays(lc.date, 1), in_month: false, pad: true, items: [], races: [], other: [], strength: [], gym_plans: [] }); }
    // v80 : passage de mois façon « Focus time » : instantané de l'ancien mois
    var oldCal = !REDUCED.matches && S.view === 'month' && $('#view .mcal'), oldKey = oldCal && $('#view .mcal-card').getAttribute('data-ym'), oldTx = null;
    if (oldCal && oldKey !== d.year + '-' + d.month) oldTx = $$(MT_SEL).map(function (e) { return e.innerHTML; }); else oldCal = null;
    var h = '<div class="sec"><h2><span class="n">◷</span><span class="mt">' + MONTHS[d.month - 1] + ' ' + d.year + '</span></h2><div class="right">' +
      '<span class="mono-label">horizon ' + (d.horizon ? dm(d.horizon) : '–') + '</span>' +
      '<button class="btn btn-ghost btn-sm" data-m="-1" aria-label="Mois précédent">‹</button><button class="btn btn-ghost btn-sm" data-m="0">' + (mob ? 'Auj.' : 'Ce mois') + '</button><button class="btn btn-ghost btn-sm" data-m="1" aria-label="Mois suivant">›</button></div></div>';
    if (S0) {
      var tot = S0.road_km + S0.trail_km, rp = tot ? Math.round(S0.road_km / tot * 100) : 0;
      h += '<div class="card msum">' +
        '<div class="cell"><div class="mono-label">Km</div><div class="big">' + n(S0.km, 1) + '<small>km</small></div><div class="sub">' + (d.km_planned ? n(d.km_planned, 0) + ' prévus' : 'plus longue ' + n(S0.longest_km, 1)) + '</div></div>' +
        '<div class="cell"><div class="mono-label">D+</div><div class="big">' + n(S0.d_plus_m) + '<small>m</small></div><div class="sub">' + (S0.km ? n(S0.d_plus_m / S0.km, 0) + ' m/km' : '&nbsp;') + '</div></div>' +
        '<div class="cell"><div class="mono-label">Sorties</div><div class="big">' + S0.runs + '</div><div class="sub">' + S0.active_days + ' jours actifs' + (S0.strength_n ? ' · ' + S0.strength_n + ' muscu' : '') + (S0.other_n ? ' · ' + S0.other_n + ' autres' : '') + '</div></div>' +
        '<div class="cell streak"><div class="mono-label">Série</div><div class="big">' + (S0.streak_current || 0) + '<small>j</small></div><div class="sub">' + (S0.streak_best ? 'record du mois ' + S0.streak_best + ' j' : 'toutes activités') + '</div></div>' +
        '<div class="cell split"><div class="mono-label">Route / Trail</div><div class="splitbar">' + (tot ? '<i class="r" style="width:' + rp + '%"></i><i class="t" style="width:' + (100 - rp) + '%"></i>' : '') + '</div>' +
        '<div class="splitlbl"><span>' + runDot(0, 'road', { size: 16 }) + ' <b>' + n(S0.road_km, 1) + ' km</b> · ' + S0.road_n + '</span><span>' + runDot(0, 'trail', { size: 16 }) + ' <b>' + n(S0.trail_km, 1) + ' km</b> · ' + S0.trail_n + '</span></div></div>' +
        '</div>';
    }
    h += '<div class="mbody">';
    h += '<div class="card mcal-card" data-ym="' + d.year + '-' + d.month + '"><div class="mcal">' + DOW.map(function (x) { return '<div class="dh">' + x + '</div>'; }).join('') + '<div class="dh wkh">Sem.</div>';
    var wkKm = 0;
    d.cells.forEach(function (c, i) {
      var dc = dayContent(c); wkKm += dc.km;
      var cls = 'md' + (c.in_month ? '' : ' out') + (c.is_today ? ' today' : '') + (c.date === d.horizon ? ' horizon' : '') + (dc.html ? '' : ' empty');
      var gym = (c.strength || []).length ? '<i class="gymdot" title="Muscu">M</i>' : (c.gym_plans || []).length ? '<i class="gymdot plan" title="Muscu prévue">M</i>' : '';
      var sd = (c.other || []).slice(0, 3).map(function (o) { return '<i class="sdot sp-' + esc(o.type) + '" title="' + esc(o.label || TYPE_LBL[o.type]) + '"></i>'; }).join('');
      if (gym || sd) { cls = cls.replace(' empty', ''); gym = '<span class="mk">' + gym + sd + '</span>'; }
      h += '<div class="' + cls + '" data-day="' + c.date + '" role="button" tabindex="0" aria-label="' + dayLabel(c.date) + '"><span class="dn">' + (+c.date.slice(8, 10)) + '</span>' + dc.html + gym + '</div>';
      if (i % 7 === 6) { h += '<div class="wk"><span>S' + isoW(c.date) + '</span><b>' + (wkKm ? n(wkKm, 1) : '–') + '</b></div>'; wkKm = 0; }
    });
    h += '</div></div></div>';
    $('#view').innerHTML = h;
    if (oldCal) monthMorph(oldCal, oldTx);
    $$('[data-m]').forEach(function (b) {
      b.onclick = function () {
        var k = +b.getAttribute('data-m'), y = d.year, m = d.month;
        if (!k) { var t = d.today; y = +t.slice(0, 4); m = +t.slice(5, 7); } else { m += k; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } }
        go('month', { ym: [y, m] });
      };
    });
    $$('[data-day]').forEach(function (el) {
      el.onclick = function () { showDay(d, el.getAttribute('data-day'), el); };
      el.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.onclick(); } };
    });
  }
  /** v80 : cases en fondu enchaîné simultané (200 ms, sans glissement) ; chiffres et libellés empilés : l'ancien sort vers le haut (−8 px), le nouveau monte de +8 px (200 ms ease-out). */
  function monthMorph(oldCal, oldTx) {
    var card = $('#view .mcal-card'), cal = card && card.querySelector('.mcal'); if (!cal) return;
    var news = $$(MT_SEL);
    var g = oldCal.cloneNode(true); g.classList.add('mt-ghost'); g.setAttribute('aria-hidden', 'true'); g.querySelectorAll('[data-day]').forEach(function (x) { x.removeAttribute('data-day'); }); card.appendChild(g); cal.classList.add('mt-in');
    news.forEach(function (e, i) {
      var o = oldTx[i]; if (o === undefined || o === e.innerHTML) return;
      e.innerHTML = '<span class="mt-w"><span class="mt-o" aria-hidden="true">' + o + '</span><span class="mt-n">' + e.innerHTML + '</span></span>';
    });
    setTimeout(function () {
      if (g.parentNode) g.parentNode.removeChild(g); cal.classList.remove('mt-in');
      $$('.mt-w').forEach(function (w) { var n = w.querySelector('.mt-n'), p = w.parentNode; if (p) p.innerHTML = n.innerHTML; });
    }, 240);
  }
  /** v80 : pastille glissante des sélecteurs segmentés (.seg) : 300 ms cubic-bezier(0.4,0,0.2,1), sans rebond */
  function segPills() {
    $$('.seg').forEach(function (sg) {
      var on = sg.querySelector('button.on'), p = sg.querySelector('.seg-pill');
      if (!p) { p = document.createElement('i'); p.className = 'seg-pill'; p.setAttribute('aria-hidden', 'true'); sg.insertBefore(p, sg.firstChild); sg.classList.add('has-pill'); p.style.transition = 'none'; }
      if (!on) { p.style.opacity = '0'; return; }
      p.style.opacity = '1'; p.style.width = on.offsetWidth + 'px'; p.style.transform = 'translateX(' + on.offsetLeft + 'px)';
      if (p.style.transition === 'none') { void p.offsetWidth; requestAnimationFrame(function () { p.style.transition = ''; }); }
    });
  }
  (function () { var v = document.getElementById('view'), q = 0; if (!v || !window.MutationObserver) return;
    new MutationObserver(function () { if (q) return; q = requestAnimationFrame(function () { q = 0; if ($$('.seg').length) segPills(); }); }).observe(v, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); })();
  function isoW(ymd) { var t = ymdDate(ymd), day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3); var f = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7); }

  /** Feuille « jour » (toucher une case du mois) : sorties, séances et course du jour, chacune ouvrable. */
  function showDay(d, date, el) {
    $$('.md.sel').forEach(function (x) { x.classList.remove('sel'); }); if (el) el.classList.add('sel');
    var c = d.cells.filter(function (x) { return x.date === date; })[0]; if (!c) return;
    var h = '<div class="sec" style="margin-top:0"><h2>' + DOW_L[dowIdx(date)] + ' ' + dm(date) + '</h2><button class="btn btn-ghost btn-sm" id="m-close" aria-label="Fermer">✕</button></div><div class="dsheet">';
    c.races.forEach(function (r) { h += '<button class="race-flag rf-go" data-race="' + esc(r.name) + '" style="margin-bottom:8px">🏁 ' + esc(r.name) + (r.distance_km ? ' · ' + n(r.distance_km, 1) + ' km' : '') + (r.d_plus_m ? ' · ' + n(r.d_plus_m) + ' m D+' : '') + '<span class="go">Plan ›</span></button>'; });
    var list = c.items.filter(function (it) { return it.status === 'done' || !c.beyond_horizon; });
    list.forEach(function (it) {
      var done = it.status === 'done', km = +(it.act_km || it.km) || 0, k = c.items.indexOf(it);
      var meta = [km ? n(km, done ? 2 : 1) + ' km' : '', it.duration_s ? dur(it.duration_s) : '', it.pace_s_km ? pace(it.pace_s_km) + '/km' : '', it.d_plus_m ? '+' + n(it.d_plus_m) + ' m' : '', done ? '' : statusLbl(it.status)].filter(Boolean).join(' · ');
      h += '<button class="it" data-k="' + k + '"' + (!done && it.type === 'course' && c.races.length ? ' data-race="' + esc(c.races[0].name) + '"' : '') + '>' + runDot(km, c.races.length && done ? 'race' : surfOf(it), { size: 40, planned: !done, missed: it.status === 'missed' }) +
        '<span class="tx"><b>' + esc(it.title || it.type) + '</b><span>' + meta + '</span></span><span class="go">›</span></button>';
    });
    (c.other || []).forEach(function (o) { h += '<button class="it sp-' + esc(o.type) + '" data-oact="' + esc(o.activity_id) + '"><span class="sbig">' + esc(sportTag(o).charAt(0)) + '</span><span class="tx"><b>' + esc(o.name || TYPE_LBL[o.type]) + '</b><span>' + sportMeta(o).join(' · ').replace(/<[^>]+>/g, '') + '</span></span><span class="go">›</span></button>'; });
    (c.gym_plans || []).forEach(function (g) { h += '<div class="it gymit plan" data-gym="' + esc(g.plan_id) + '" role="button" tabindex="0"><i class="gymdot plan">M</i><span class="tx"><b>Muscu prévue' + (g.title ? ' · ' + esc(g.title) : '') + '</b><span>' + (g.status === 'missed' ? 'manquée' : 'à faire') + '</span></span></div>'; });
    (c.strength || []).forEach(function (g) { h += '<div class="it gymit"><i class="gymdot">M</i><span class="tx"><b>Muscu' + (g.kind ? ' · ' + esc(g.kind) : '') + '</b><span>' + hm(g.duration_s) + (g.avg_hr ? ' · FC ' + g.avg_hr : '') + '</span></span></div>'; });
    if (!c.races.length && !list.length && !(c.strength || []).length && !(c.gym_plans || []).length && !(c.other || []).length) h += '<div class="empty">' + (date < d.today ? 'Repos.' : c.beyond_horizon ? 'Pas encore planifié.' : 'Rien de prévu.') + '</div>';
    h += '</div><div class="row" style="margin-top:6px"><button class="btn btn-ghost" id="m-week">Voir la semaine</button></div>';
    $('#modal-box').innerHTML = h; $('#modal').classList.remove('closing'); $('#modal').classList.add('open');
    $('#m-close').onclick = closeModal;
    $('#m-week').onclick = function () { closeModal(); go('week', { day: date }); };
    $$('.dsheet [data-gym]').forEach(function (b) { b.onclick = function () { closeModal(); go('gym', { plan_id: b.getAttribute('data-gym') }); }; });
    $$('.dsheet [data-oact]').forEach(function (b) { b.onclick = function () { closeModal(); go('detail', { id: b.getAttribute('data-oact') }); }; });
    $$('.dsheet [data-race]').forEach(function (b) { b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); closeModal(); go('race', { name: b.getAttribute('data-race') }); }; });
    $$('.dsheet button.it:not([data-oact]):not([data-race])').forEach(function (b) {
      b.onclick = function () {
        var it = c.items[+b.getAttribute('data-k')]; closeModal();
        if (it.activity_id && it.status === 'done') go('detail', { id: String(it.activity_id) }); else go('week', { day: date });
      };
    });
  }

  // ------------------------------------------------------------------ GRAPHIQUE KM HEBDO (v38 : sélecteur fixe en case 12, le graphique défile dessous)
  var G_VIS = 16, G_SLOT = 11; // 16 semaines visibles ; la semaine sélectionnée est toujours la 12e (11 avant, 4 après)
  // Sélecteur fixe (bande + repères) et semaines de course (pointillé + « RACE WEEK » vertical).
  var raceMarkers = {
    id: 'raceMarkers',
    beforeDatasetsDraw: function (chart, args, opts) {
      if (opts.center === null || opts.center === undefined) return;
      var ctx = chart.ctx, a = chart.chartArea, x = chart.scales.x, w = x.getPixelForValue(1) - x.getPixelForValue(0), xp = x.getPixelForValue(opts.center);
      ctx.save(); ctx.fillStyle = 'rgba(31,36,34,.07)'; ctx.fillRect(xp - w / 2, a.top, w, a.bottom - a.top); ctx.restore();
    },
    afterDatasetsDraw: function (chart, args, opts) {
      var ctx = chart.ctx, a = chart.chartArea, x = chart.scales.x;
      (opts.items || []).forEach(function (idx) {
        if (idx < x.min || idx > x.max) return;
        var xp = Math.round(x.getPixelForValue(idx)) + 0.5;
        ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip();
        ctx.font = '600 9.5px "IBM Plex Mono", monospace';
        var spaced = 'letterSpacing' in ctx; if (spaced) ctx.letterSpacing = '1.5px';
        var txt = spaced ? 'RACE WEEK' : 'R A C E  W E E K', tw = ctx.measureText(txt).width;
        var g0 = a.top + 6, g1 = g0 + tw + 8;
        ctx.strokeStyle = '#C89020'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(xp, a.top); ctx.lineTo(xp, g0); ctx.moveTo(xp, g1); ctx.lineTo(xp, a.bottom); ctx.stroke(); ctx.setLineDash([]);
        ctx.translate(xp, g1 - 4); ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#9A6E10'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, 0, 0);
        ctx.restore();
      });
      if (opts.center === null || opts.center === undefined) return;
      // repères du sélecteur : cadre fin + triangles haut / bas
      var w = x.getPixelForValue(1) - x.getPixelForValue(0), xp = x.getPixelForValue(opts.center);
      ctx.save(); ctx.strokeStyle = 'rgba(31,36,34,.55)'; ctx.lineWidth = 1; ctx.strokeRect(Math.round(xp - w / 2) + 0.5, a.top + 0.5, Math.round(w) - 1, a.bottom - a.top - 1);
      ctx.fillStyle = '#1F2422';
      ctx.beginPath(); ctx.moveTo(xp - 6, a.top - 1); ctx.lineTo(xp + 6, a.top - 1); ctx.lineTo(xp, a.top + 6); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(xp - 6, a.bottom + 1); ctx.lineTo(xp + 6, a.bottom + 1); ctx.lineTo(xp, a.bottom - 6); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  };
  // Autres activités de la semaine : une pastille par type présent (couleur de la palette), sous les libellés de l'axe.
  var sportDots = {
    id: 'sportDots',
    afterDraw: function (chart, args, opts) {
      var x = chart.scales.x, a = chart.chartArea, ctx = chart.ctx, yy = chart.height - 7, order = ['muscu'].concat(SPORTS);
      (opts.weeks || []).forEach(function (w, i) {
        var ts = order.filter(function (t) { return w.other && w.other[t]; }); if (!ts.length) return;
        var r = 3, gap = 2, tot = ts.length * (2 * r) + (ts.length - 1) * gap, x0 = x.getPixelForValue(i) - tot / 2 + r;
        if (x0 - r < a.left - 2 || x0 + tot > a.right + 2) return;
        ts.forEach(function (t, k) { ctx.save(); ctx.beginPath(); ctx.arc(x0 + k * (2 * r + gap), yy, r, 0, 2 * Math.PI); ctx.fillStyle = PAL[t]; ctx.fill(); ctx.restore(); });
      });
    }
  };
  function chartDefaults() {
    Chart.defaults.font.family = '"IBM Plex Mono", monospace'; Chart.defaults.font.size = 11; Chart.defaults.color = '#4A4F4C';
    Chart.defaults.plugins.legend.labels.boxWidth = 12; Chart.defaults.plugins.legend.labels.boxHeight = 8;
  }
  /** Chart.js / Leaflet sont chargés en defer (la semaine s'affiche sans les attendre). */
  var LIB_SRC = { Chart: ['https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js'], L: ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'] }, LIB_ON = {};
  /** v52 : Chart.js / Leaflet injectés seulement à la première vue qui en a besoin (plus au démarrage). */
  function lib(name) {
    if (!window[name] && !LIB_ON[name] && LIB_SRC[name]) {
      LIB_ON[name] = 1;
      LIB_SRC[name].forEach(function (u) {
        var el = /\.css$/.test(u) ? document.createElement('link') : document.createElement('script');
        if (el.tagName === 'LINK') { el.rel = 'stylesheet'; el.href = u; } else { el.src = u; el.async = true; }
        el.crossOrigin = ''; document.head.appendChild(el);
      });
    }
    return new Promise(function (res, rej) { var t0 = Date.now(); (function w() { if (window[name]) res(); else if (Date.now() - t0 > 15000) rej(new Error(name + ' non chargé')); else setTimeout(w, 50); })(); });
  }
  var GR = mkStore('gr'); // cache du graphique (préchargé en arrière-plan après l'ouverture)
  function fetchGraph() { return fetchCached(GR, 'g', 'uiGraph', []); }
  function loadGraph() {
    var e = GR.g;
    if (e && e.data && window.Chart) {
      renderGraph(e.data);
      revalidate(GR, 'g', 'uiGraph', [], function (d) { if (S.view === 'graph') renderGraph(d); });
      return;
    }
    loading(); Promise.all([fetchGraph(), lib('Chart')]).then(function (r) { if (S.view === 'graph') renderGraph(r[0]); }).catch(fail);
  }
  // ------------------------------------------------------------------ v42 : Performance
  var PF = mkStore('pf');
  function loadPerf() {
    var e = PF.p;
    if (e && e.data && window.Chart) {
      renderPerf(e.data);
      revalidate(PF, 'p', 'uiPerf', [], function (d) { if (S.view === 'perf') { destroyCharts(); renderPerf(d); } });
      return;
    }
    if (!lsGet('pf:p')) loading();
    Promise.all([fetchCached(PF, 'p', 'uiPerf', []), lib('Chart')]).then(function (r) { if (S.view === 'perf') renderPerf(r[0]); }).catch(fail);
  }
  function pfNum(m, v) { return m.pace ? pace(v) : n(v, m.dec !== undefined ? m.dec : (v % 1 ? 1 : 0)); }
  function pfVal(m) {
    if (!m || m.value === null || m.value === undefined || m.value === '') return '—';
    var v = m.text ? esc(m.value) : m.pace ? esc(m.value) : n(+m.value, m.dec !== undefined ? m.dec : ((+m.value) % 1 ? 1 : 0));
    return v + (m.unit ? '<small>' + esc(m.unit) + '</small>' : '');
  }
  function pfDelta(m) {
    var h = (m && m.history) || []; if (h.length < 2) return '';
    var d = h[h.length - 1].v - h[0].v; if (!d) return '<span class="pf-d">= sur ' + h.length + ' relevés</span>';
    var good = m.up === undefined ? null : (d > 0) === m.up, txt = m.pace ? (d > 0 ? '+' : '−') + Math.abs(Math.round(d)) + ' s' : (d > 0 ? '+' : '') + n(d, m.dec !== undefined ? m.dec : (d % 1 ? 1 : 0));
    return '<span class="pf-d ' + (good === null ? '' : good ? 'good' : 'bad') + '">' + (d > 0 ? '▲ ' : '▼ ') + txt + ' depuis ' + dm(h[0].date) + '</span>';
  }
  var PF_EXPL = {
    endurance_score: 'Capacité à tenir des efforts longs, calculée d\'après le volume et l\'intensité de tes dernières semaines (tous sports).',
    hill_score: 'Capacité en montée, calculée d\'après ta force (côtes courtes et raides) et ton endurance en côte (montées longues).'
  };
  /** Courbe condensée 4 semaines : x = jours, tous les points visibles ; bande optionnelle (plage bas–haut datée). */
  function pfSpark(id, m, lo, hi, today, band) {
    var el = document.getElementById(id); if (!el || !m || !m.history || !m.history.length) return;
    var x0 = Date.parse(today) - 28 * 864e5, X = function (d) { return Math.round((Date.parse(d) - x0) / 864e5); };
    var data = m.history.map(function (p) { return { x: X(p.date), y: p.v, d: p.date }; }), ds = [];
    if (band && band.length) { // v79 : plage optimale grisée (calculée)
      ds.push({ data: band.map(function (p) { return { x: X(p.date), y: p.hi }; }), borderColor: 'transparent', pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0, fill: '+1', backgroundColor: 'rgba(31,36,34,.10)', tension: .3 });
      ds.push({ data: band.map(function (p) { return { x: X(p.date), y: p.lo }; }), borderColor: 'transparent', pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0, fill: false, tension: .3 });
    } else if (lo && hi && lo.history.length && hi.history.length) {
      ds.push({ data: hi.history.map(function (p) { return { x: X(p.date), y: p.v }; }), borderColor: 'transparent', pointRadius: 0, fill: '+1', backgroundColor: 'rgba(61,187,106,.16)', stepped: true });
      ds.push({ data: lo.history.map(function (p) { return { x: X(p.date), y: p.v }; }), borderColor: 'transparent', pointRadius: 0, fill: false, stepped: true });
    }
    ds.unshift({ data: data, borderColor: '#2E9A55', backgroundColor: '#2E9A55', borderWidth: 1.8, pointRadius: data.length > 20 ? 2 : 3, pointBackgroundColor: '#2E9A55', tension: .25, fill: false });
    S.charts.push(new Chart(el, { type: 'line', data: { datasets: ds }, options: { responsive: true, maintainAspectRatio: false, animation: false, parsing: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false }, // v79 : valeur du point le plus proche sur l'axe des x
      plugins: { legend: { display: false }, tooltip: { mode: 'nearest', axis: 'x', intersect: false, filter: function (it) { return it.datasetIndex === 0; }, callbacks: { title: function (it) { return dm(it[0].raw.d); }, label: function (it) { return pfNum(m, it.parsed.y) + (m.unit ? ' ' + m.unit : ''); } } } },
      scales: { x: { type: 'linear', min: 0, max: 28, display: true, grid: { display: false }, border: { display: false }, ticks: { stepSize: 7, maxRotation: 0, autoSkip: false, font: { size: 9 }, callback: function (v) { return v === 28 ? 'auj.' : '−' + (4 - v / 7) + 's'; } } },
        y: { display: true, position: 'right', grace: '15%', border: { display: false }, grid: { color: 'rgba(0,0,0,.05)' }, ticks: { maxTicksLimit: 3, font: { size: 9 }, callback: function (v) { return m.pace ? pace(v) : n(v, m.dec || 0); } } } } } }));
  }
  /** v79 : zone optimale de charge calculée (Garmin n'en publie pas les bornes) : 0,8–1,4 × moyenne de la charge aiguë Garmin sur les 28 j précédents. */
  function pfBand(L) {
    var h = (L && L.history) || []; if (h.length < 7) return [];
    return h.map(function (p) { var w = h.filter(function (q) { return q.date <= p.date && Date.parse(q.date) > Date.parse(p.date) - 28 * 864e5; }), c = w.reduce(function (a, q) { return a + q.v; }, 0) / w.length;
      return { date: p.date, lo: Math.round(c * 0.8), hi: Math.round(c * 1.4) }; });
  }
  var TS_COL = { 'pic': '#8E4FC9', 'productif': '#45B04B', 'maintien': '#B5B31E', 'récupération': '#2E8BD8', 'recuperation': '#2E8BD8', 'improductif': '#F08A24', 'désentraînement': '#E5483B', 'desentrainement': '#E5483B', 'surmenage': '#C8102E', 'tension': '#F26B3A', 'aucun statut': '#A3A8AD' };
  function tsCol(s) { return TS_COL[String(s || '').toLowerCase().trim()] || '#A3A8AD'; }
  /** v79 : barre d'historique du statut (segments réellement relevés dans Garmin, 4 dernières semaines) */
  function pfStatusBar(h, today) {
    h = (h || []).filter(function (x) { return x.from && x.status; }).sort(function (a, b) { return a.from < b.from ? -1 : 1; }); if (!h.length) return '';
    var t1 = Date.parse(today), t0 = Math.min(t1 - 28 * 864e5, Date.parse(h[0].from)), span = t1 - t0 + 864e5;
    var segs = h.map(function (x, i) { var a = Date.parse(x.from), b = Date.parse(x.to || (h[i + 1] ? h[i + 1].from : today)) + (x.to ? 864e5 : 0);
      return '<span class="pf-ts-s" style="left:' + ((a - t0) / span * 100).toFixed(2) + '%;width:' + (Math.max(0, b - a) / span * 100).toFixed(2) + '%;background:' + tsCol(x.status) + '" title="' + esc(x.status) + '"></span>'; }).join('');
    var leg = h.map(function (x) { return '<span><b style="background:' + tsCol(x.status) + '"></b>' + esc(x.status) + ' ' + dm(x.from) + (x.to ? '–' + dm(x.to) : '') + '</span>'; }).join('');
    return '<div class="pf-ts">' + segs + '</div><div class="pf-ts-l">' + leg + '</div>';
  }
  function renderPerf(d) {
    destroyCharts();
    var M = {}; d.metrics.forEach(function (m) { M[m.key] = m; });
    var sp = function (k) { return '<div class="pf-sp"><canvas id="sp-' + k + '"></canvas></div>'; };
    var hasH = function (k) { return M[k] && M[k].history && M[k].history.length; };
    var dt = function (m) { return m && m.date ? 'relevé ' + dm(m.date) : 'pas encore de relevé'; };
    var card = function (k, o) {
      o = o || {}; var m = M[k]; if (!m) return '';
      return '<div class="card pf-c' + (o.big ? ' big' : '') + (o.wide ? ' wide' : '') + '"><div class="pf-l">' + esc(o.label || m.label) + '</div><div class="pf-v">' + pfVal(m) + '</div>' +
        '<div class="pf-s">' + (o.sub || dt(m)) + pfDelta(m) + '</div>' + (!m.text ? sp(k) : '') + (o.expl ? '<div class="pf-x">' + o.expl + '</div>' : m.note ? '<div class="pf-n">' + esc(m.note) + '</div>' : '') + '</div>';
    };
    var since = M.training_status_since && M.training_status_since.value ? M.training_status_since.value : null;
    if (since && /^\d{4}-\d{2}-\d{2}$/.test(since)) since = dm(since);
    var L = M.acute_load, lo = M.acute_load_low, hi = M.acute_load_high, ref = d.ref || {}, a = d.acwr.current || {};
    var band = pfBand(L);
    var ls = M.acute_load_status, range = band.length ? 'zone optimale (calculée) ' + n(band[band.length - 1].lo) + '–' + n(band[band.length - 1].hi) + ' ·' : lo && lo.value && hi && hi.value ? 'plage optimale ' + n(+lo.value) + '–' + n(+hi.value) : (ls && ls.value ? '<span class="pf-tag">' + esc(ls.value) + '</span>' : '');
    var hv = M.hrv_night, h7 = M.hrv_7d, hl = M.hrv_baseline_low, hh = M.hrv_baseline_high, st = M.hrv_status;
    var hrm = M.hr_max, obs = d.hr_max_observed;
    var html = '<div class="pf-head"><h2><span class="n">▮</span>Performance</h2><span class="mono-label">Garmin · relevé ' + (d.last_reading ? dm(d.last_reading) : '—') + '</span></div>' +
      '<div class="pf-grid">' + card('vo2max_run', { big: true }) +
      card('training_status', { big: true, sub: (since ? 'depuis le ' + esc(since) + ' · ' : '') + dt(M.training_status) + pfStatusBar(d.status_hist, d.today) }) + '</div>' +
      '<h3 class="pf-h">Charge</h3><div class="pf-grid">' +
      '<div class="card pf-c wide"><div class="pf-l">Charge aiguë Garmin</div><div class="pf-v">' + pfVal(L) + '</div><div class="pf-s">' + (range ? range + ' ' : '') + dt(L) + pfDelta(L) + '</div><div class="pf-sp tall"><canvas id="sp-acute_load"></canvas></div></div>' +
      card('load_focus') +
      '<div class="card pf-c"><div class="pf-l">ACWR course (DCAP)</div><div class="pf-v">' + (a.ratio === null || a.ratio === undefined ? '—' : n(a.ratio, 2)) + '</div><div class="pf-s">aiguë 7 j ' + n(a.acute, 0) + ' · chronique 28 j ' + n(a.chronic, 0) + '</div></div></div>' +
      '<h3 class="pf-h">Cœur &amp; récup</h3><div class="pf-grid">' +
      card('rhr', { label: 'FC au repos', sub: 'moy. 7 j <b>' + (M.rhr_7d && M.rhr_7d.value ? n(+M.rhr_7d.value, 1) + ' bpm' : '—') + '</b>' + (M.rhr_7d && /calcul/i.test(M.rhr_7d.note || '') ? ' (calculé)' : '') + ' · ' + dt(M.rhr) }) +
      '<div class="card pf-c"><div class="pf-l">VFC (nuit)</div><div class="pf-v">' + pfVal(hv) + '</div><div class="pf-s">moy. 7 j <b>' + (h7 && h7.value ? esc(h7.value) + ' ms' : '—') + '</b> · plage ' + (hl && hl.value && hh && hh.value ? esc(hl.value) + '–' + esc(hh.value) + ' ms' : '—') + '</div>' +
        '<div class="pf-s">' + (st && st.value ? '<span class="pf-tag">' + esc(st.value) + '</span>' : '') + dt(hv) + pfDelta(hv) + '</div>' + sp('hrv_night') + '</div>' +
      '<div class="card pf-c"><div class="pf-l">FC max mesurée</div><div class="pf-v">' + (hrm && hrm.value ? pfVal(hrm) : obs ? n(obs.v) + '<small>bpm</small>' : '—') + '</div><div class="pf-s">' +
        (hrm && hrm.value ? dt(hrm) + (hrm.note ? ' · ' + esc(hrm.note) : '') : obs ? 'max observée · ' + dm(obs.date) + (obs.name ? ' · ' + esc(obs.name) : '') : 'pas encore de relevé') + '</div></div>' +
      (function () { var ss = M.sleep_score, q = M.sleep_quality, du = M.sleep_duration, h = (ss && ss.history) || [], last7 = h.filter(function (p) { return p.date > addDays(d.today, -7); });
        var avg = last7.length ? last7.reduce(function (a, p) { return a + p.v; }, 0) / last7.length : null;
        var qd = q && q.value && q.date === (ss && ss.date) ? q.value : null, dd = du && du.value && du.date === (ss && ss.date) ? du.value : null;
        return '<div class="card pf-c"><div class="pf-l">Score de sommeil</div><div class="pf-v">' + (ss && ss.value ? n(+ss.value) + '<small>/100</small>' : '—') + '</div>' +
          '<div class="pf-s">' + (qd ? '<span class="pf-tag">' + esc(qd) + '</span>' : '') + (dd ? '<b>' + esc(String(dd).replace(':', 'h')) + '</b>' : '') + '</div>' +
          '<div class="pf-s">moy. 7 j <b>' + (avg !== null ? n(avg) : '—') + '</b> (calculé) · ' + dt(ss) + '</div>' + sp('sleep_score') + '</div>'; })() +
      '</div>' +
      '<h3 class="pf-h">Seuil lactique</h3><div class="pf-grid">' + card('lt_pace', { label: 'Allure seuil' }) + card('lt_hr', { label: 'FC seuil' }) +
      '<div class="card pf-c wide"><div class="pf-l">Référence dashboard</div><div class="pf-v">' + (ref.allure_seuil ? esc(ref.allure_seuil) + '<small>/km</small>' : '—') + ' · ' + (ref.fc_seuil ? esc(ref.fc_seuil) + '<small>bpm</small>' : '—') + '</div><div class="pf-s">utilisée pour les cibles des séances' + (ref.fc_max ? ' · FC max réf. ' + esc(ref.fc_max) : '') + '</div></div></div>';
    // Records : le meilleur 10 km officiel = record, le second reste visible
    var prs = d.prs.slice(), tens = prs.filter(function (p) { return /^pr_10k(_official.*)?$/.test(p.key) && p.value; }).sort(function (x, y) { return durMin(x.value) - durMin(y.value); });
    var rows = [];
    prs.forEach(function (p) {
      if (/^pr_10k_official/.test(p.key)) { if (p.key === 'pr_10k_official') tens.filter(function (t, i, arr) { return arr.findIndex(function (u) { return u.value === t.value; }) === i; }).forEach(function (t, i) { rows.push({ label: i ? '10 km officiel (2e)' : '10 km officiel', value: t.value, note: t.note || '', date: t.date }); }); return; }
      if (p.key === 'pr_10k') return;
      rows.push(p);
    });
    html += '<h3 class="pf-h">Records</h3><div class="card pf-pr">' + rows.map(function (p) {
        return '<div class="pf-pr-r"><div class="pf-pr-t"><span>' + esc(p.label) + '</span><b>' + (p.value ? esc(p.value) : '—') + '</b></div>' + (p.note ? '<em>' + esc(p.note) + '</em>' : '') + '</div>'; }).join('') + '</div>';
    $('#view').innerHTML = html;
    chartDefaults();
    ['vo2max_run', 'lt_pace', 'lt_hr', 'rhr', 'sleep_score'].forEach(function (k) { pfSpark('sp-' + k, M[k], null, null, d.today); });
    pfSpark('sp-acute_load', L, lo, hi, d.today, band);
    pfSpark('sp-hrv_night', hv, hl, hh, d.today);
  }

  // ------------------------------------------------------------------ v42 : plan de course
  var RP = mkStore('rp');
  function fetchRace(name) { return fetchCached(RP, name || '_', 'uiRacePlan', [name || '']); }
  function loadRace() {
    loading();
    var key = S.race || '_';
    Promise.all([fetchRace(S.race), lib('Chart'), lib('L')]).then(function (r) { if (S.view !== 'race') return; renderRace(r[0]);
      revalidate(RP, key, 'uiRacePlan', [S.race || ''], function (d) { quietRender('rp', key, d); }); }).catch(fail); // v92 : jamais figé sur une vieille fiche
  }
  function clockAdd(start, min) { var m = /^(\d{1,2})[:h](\d{2})/.exec(start || ''); if (!m) return ''; var t = (+m[1]) * 60 + (+m[2]) + Math.round(min); return Math.floor(t / 60) % 24 + 'h' + ('0' + t % 60).slice(-2); }
  function hmin(min) { min = Math.round(min); return Math.floor(min / 60) + ':' + ('0' + min % 60).slice(-2); }
  function durMin(s) { var p = String(s || '').split(':').map(Number); return p.length >= 2 && !p.some(isNaN) ? p[0] * 60 + p[1] + (p[2] || 0) / 60 : null; }
  /** Modèle de temps : effort = km + D+/100 (km-effort) réparti au prorata de l'objectif. */
  function raceModel(d) {
    var R = d.race, C = d.course, dist = +R.distance_km || (C ? C.points[C.points.length - 1][3] : 0), total = durMin(R.target_time) || null;
    var pts = C ? C.points : [], scale = pts.length ? dist / pts[pts.length - 1][3] : 1, up = 0, eff = [];
    pts.forEach(function (p, i) { if (i) { var dz = p[2] - pts[i - 1][2]; if (dz > 0) up += dz; } eff.push(p[3] * scale + up / 100); });
    var effT = eff.length ? eff[eff.length - 1] : dist;
    var kmAt = function (min) { if (!pts.length || !total) return total ? dist * min / total : null; var e = effT * min / total; for (var i = 1; i < eff.length; i++) if (eff[i] >= e) { var f = (e - eff[i - 1]) / ((eff[i] - eff[i - 1]) || 1); return (pts[i - 1][3] + f * (pts[i][3] - pts[i - 1][3])) * scale; } return dist; };
    var minAt = function (km) { if (!total) return null; if (!pts.length) return total * km / dist; var c = km / scale; for (var i = 1; i < pts.length; i++) if (pts[i][3] >= c) { var f = (c - pts[i - 1][3]) / ((pts[i][3] - pts[i - 1][3]) || 1); return total * (eff[i - 1] + f * (eff[i] - eff[i - 1])) / effT; } return total; };
    return { dist: dist, total: total, scale: scale, kmAt: kmAt, minAt: minAt, up: Math.round(up) };
  }
  function racePlanEvents(d, md) {
    var R = d.race, C = d.course, T = md.total; if (!T) return [];
    var carbs = +R.carbs_g_h || 0, every = +R.gel_every_min || (carbs ? Math.max(15, Math.min(45, Math.round(60 * 24 / carbs / 5) * 5)) : 20);
    var fromStart = /1re minute|1ère minute|dès le départ|dès la 1/i.test(R.fueling || ''), ev = [];
    var caf = String(R.caffeine || ''), cafTimes = (caf.match(/\d{1,2}:\d{2}/g) || []).map(durMin), cafHalf = /moiti|2e|second/i.test(caf);
    var gels = []; for (var t = fromStart ? 0 : every; t < T - 8; t += every) gels.push(t);
    var GP = gelPlan(R), gG = Math.round(+R.gel_g || 24);
    gels.forEach(function (t, i) {
      var c, sub = '', mg = 0;
      if (GP) { var k = i < GP.gold ? 'gold' : i < GP.gold + GP.kiwi ? 'kiwi' : 'ravito'; c = k === 'kiwi'; mg = c ? GP.mg : 0;
        sub = k === 'gold' ? 'Honey Stinger Gold · sans caféine' : k === 'kiwi' ? 'Kiwi fraise · ' + GP.mg + ' mg caféine' : 'Kiwi max atteint · glucides au ravito'; }
      else { c = cafTimes.length ? cafTimes.some(function (x) { return Math.abs(x - t) <= every / 2; }) : (cafHalf && t >= T / 2 && i % 2 === 0); mg = c ? cafMg(R) : 0; }
      var na = GP && sub.indexOf('ravito') < 0 ? (c ? 50 : 45) : 0;
      ev.push({ na: na, t: t, km: md.kmAt(t), kind: 'gel', txt: 'Gel ' + (i + 1) + ' (' + gG + ' g G)' + (!GP && c ? ' · caféiné' : ''), sub: sub, caf: c, g: gG, mg: mg, rav: GP && sub.indexOf('ravito') > 0 });
    });
    var water = +R.water_ml_h || 0, sod = +R.sodium_mg_l || 0, aid = (C && C.aid) || [], scale = md.scale, stops = [0].concat(aid.map(function (a) { return a.km * scale; })).concat([md.dist]);
    for (var i = 0; i < stops.length - 1; i++) {
      var t0 = md.minAt(stops[i]), t1 = md.minAt(stops[i + 1]), ml = water ? Math.round(water * (t1 - t0) / 60 / 50) * 50 : 0;
      var nm = i === 0 ? 'Départ' : aid[i - 1].name, need = ml ? 'porter ~' + ml + ' mL jusqu\'au ' + (i + 1 < stops.length - 1 ? 'ravito suivant' : 'bout') + ' (' + hmin(t1 - t0) + ')' + (sod ? ', ' + Math.round(ml * sod / 1000) + ' mg de sodium' : '') : '';
      ev.push({ t: t0, km: stops[i], kind: i === 0 ? 'start' : 'aid', txt: nm + (i === 0 ? '' : ' · ravito'), sub: need });
    }
    saltEvents(d, md).forEach(function (x) { ev.push(x); });
    ev.push({ t: T, km: md.dist, kind: 'end', txt: 'Arrivée' });
    ev.sort(function (a, b) { return a.t - b.t || (a.kind === 'gel' || a.kind === 'salt' ? 1 : -1); });
    return ev;
  }
  function cafMg(R) { var m = /(\d+)\s*mg/i.exec(String(R.caffeine || '') + ' ' + String(R.fueling || '')); return m ? +m[1] : 32; }
  /** v92 : SaltStick (215 mg Na/caps) selon la règle du profil nutrition : 0 caps/h sous 20 °C, 1 de 20 à 25 °C, 2 au-dessus de 25 °C (température de l'heure). */
  var SALT_NA = 215;
  function saltPerH(temp) { return temp === null || temp === undefined || isNaN(temp) ? null : temp > 25 ? 2 : temp >= 20 ? 1 : 0; }
  function raceTempAt(d, min) { var W = d.weather || {}, hs = W.hours || [], m = /^(\d{1,2})(?:[:h](\d{2}))?/.exec(d.race.start_time || ''); if (!m) return null; var hh = +m[1] + Math.floor(((+m[2] || 0) + min) / 60);
    var x = hs.filter(function (h) { return parseInt(h.h, 10) === hh; })[0]; return x ? +x.t : null; }
  function saltEvents(d, md) {
    var T = md.total, out = []; if (!T) return out;
    for (var h = 0; h * 60 < T - 10; h++) {
      var tp = raceTempAt(d, h * 60 + 30), k = saltPerH(tp);
      if (!k) { out.push({ t: h * 60 + 30, km: md.kmAt(h * 60 + 30), kind: 'salt', zero: true, txt: 'SaltStick : 0 caps', sub: k === 0 ? n(tp, 0) + ' °C prévus (< 20 °C) · 1 caps dès 20 °C' : 'météo inconnue · 1 caps/h si 20–25 °C, 2 au-dessus', na: 0 }); continue; }
      (k === 2 ? [15, 45] : [30]).forEach(function (m) { var t = h * 60 + m; if (t < T - 5) out.push({ t: t, km: md.kmAt(t), kind: 'salt', txt: 'SaltStick (' + SALT_NA + ' mg Na)', sub: 'avec de l\'eau · ' + n(tp, 0) + ' °C prévus', na: SALT_NA }); });
    }
    return out;
  }
  /** v91 : marques des gels lues sur la fiche course (« 3 Honey Stinger Gold puis Kiwi fraise caféinés (32 mg, 10 max) »). */
  function gelPlan(R) {
    var f = String(R.fueling || '') + ' ' + String(R.caffeine || ''), g = /(\d+)\s*(?:Honey Stinger\s*)?Gold/i.exec(f), k = /Kiwi[^.;]*?(\d+)\s*max/i.exec(f), mg = /(\d+)\s*mg/i.exec(String(R.caffeine || '')) || /Kiwi[^.;]*?(\d+)\s*mg/i.exec(f);
    return g && k ? { gold: +g[1], kiwi: +k[1], mg: mg ? +mg[1] : 32 } : null;
  }
  /** v91 : glucides par heure (barres) + caféine dans le corps (demi-vie 5 h, somme des prises). */
  function drawFuelChart(d, md, ev) {
    var el = document.getElementById('rp-fuel'); if (!el) return;
    var R = d.race, T = md.total, gels = ev.filter(function (e) { return e.kind === 'gel'; }), H = Math.ceil(T / 60), bars = [], caf = [];
    for (var h = 0; h < H; h++) bars.push({ x: h * 60 + 30, y: gels.filter(function (g) { return g.t >= h * 60 && g.t < h * 60 + 60; }).reduce(function (a, g) { return a + g.g; }, 0) });
    var sod = []; for (var h2 = 0; h2 < H; h2++) sod.push({ x: h2 * 60 + 30, y: ev.filter(function (g) { return g.na && g.t >= h2 * 60 && g.t < h2 * 60 + 60; }).reduce(function (a, g) { return a + g.na; }, 0) });
    for (var t = 0; t <= T + 60; t += 5) caf.push({ x: t, y: Math.round(gels.reduce(function (a, g) { return a + (g.mg && g.t <= t ? g.mg * Math.pow(0.5, (t - g.t) / 300) : 0); }, 0)) });
    var ch = new Chart(el, { data: { datasets: [
      { type: 'bar', label: 'Glucides (g/h)', data: bars, yAxisID: 'y', backgroundColor: 'rgba(232,168,48,.55)', borderColor: '#E8A830', borderWidth: 1, barPercentage: 1, categoryPercentage: .9 },
      { type: 'line', label: 'Caféine (mg)', data: caf, yAxisID: 'y1', borderColor: '#C2410C', backgroundColor: 'rgba(194,65,12,.12)', borderWidth: 3, pointRadius: 0, tension: .2, fill: true, order: -1 },
      { type: 'line', label: 'Sodium (mg/h)', data: sod, yAxisID: 'y1', borderColor: '#2F6DB5', borderWidth: 2, borderDash: [5, 4], pointRadius: 3, pointBackgroundColor: '#2F6DB5', fill: false, order: -2 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, parsing: true, interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: { title: function (it) { var x = it[0].parsed.x; return it[0].dataset.type === 'bar' ? clockAdd(R.start_time, x - 30) + ' → ' + clockAdd(R.start_time, x + 30) : clockAdd(R.start_time, x); },
            label: function (it) { return it.dataset.type === 'bar' ? it.parsed.y + ' g de glucides' : it.datasetIndex === 2 ? it.parsed.y + ' mg de sodium/h' : it.parsed.y + ' mg de caféine'; } } } },
        scales: { x: { type: 'linear', min: 0, max: T + 60, ticks: { stepSize: 60, callback: function (v) { return clockAdd(R.start_time, v); } }, grid: { display: false } },
          y: { position: 'left', beginAtZero: true, suggestedMax: 90, title: { display: true, text: 'g/h' }, ticks: { maxTicksLimit: 5 } },
          y1: { display: true, position: 'right', beginAtZero: true, suggestedMax: 300, grid: { display: false }, title: { display: true, text: 'mg', color: '#C2410C' }, ticks: { maxTicksLimit: 5, color: '#C2410C' } } } } });
    S.charts.push(ch);
  }
  function wxIcon(h) { var c = h.code; if (c === undefined) return h.mm > 0.2 ? '🌧' : ''; return c >= 95 ? '⛈' : c >= 71 && c <= 86 ? '🌨' : c >= 51 ? '🌧' : c >= 45 ? '🌫' : c >= 2 ? '⛅' : '☀️'; }
  function renderRaceList(d) {
    return d.races.map(function (r) { return '<a href="#" class="card rp-li" data-race="' + esc(r.name) + '"><b>' + esc(r.name) + '</b><span>' + DOW[dowIdx(r.date)] + ' ' + dm(r.date) + ' · ' + n(r.distance_km, 1) + ' km · +' + n(r.d_plus_m) + ' m</span><span class="go">Plan ›</span></a>'; }).join('');
  }
  function renderRace(d) {
    destroyCharts();
    if (!d.race) { $('#view').innerHTML = '<div class="sec"><h2><span class="n">▮</span>Plans de course</h2></div>' + renderRaceList(d); bindRaceLinks(); return; }
    var R = d.race, C = d.course, md = raceModel(d), ev = racePlanEvents(d, md), W = d.weather || {}, days = Math.round((Date.parse(R.date) - Date.parse(d.today)) / 864e5);
    var head = '<div class="rp-top"><a href="#" class="btn btn-ghost btn-sm" id="rp-back">‹ Aperçu</a><span class="mono-label">J-' + days + '</span></div>' +
      '<div class="sec"><h2><span class="n">▮</span>' + esc(R.name) + '</h2><div class="right"><span class="mono-label">' + DOW[dowIdx(R.date)] + ' ' + dm(R.date) + (R.start_time ? ' · départ ' + esc(R.start_time) : '') + '</span></div></div>' +
      '<div class="rp-kpi"><span><b>' + n(md.dist, 1) + '</b> km</span><span><b>+' + n(R.d_plus_m) + '</b> m</span><span>obj. <b>' + esc(String(R.target_time || '—').replace(/:00$/, '')) + '</b></span>' + (R.location ? '<span>' + esc(R.location) + '</span>' : '') + '</div>';
    var src = d.course_source ? '<div class="sub rp-src">Trace : ' + esc(d.course_source.source) + (d.course_source.url ? ' — <a href="' + esc(d.course_source.url) + '" target="_blank" rel="noopener">source</a>' : '') + (C && C.computed_d_plus_m ? ' · D+ calculé sur la trace ' + n(C.computed_d_plus_m) + ' m' : '') + '</div>'
      : '<div class="card pad rp-warn">GPX officiel introuvable : plan calculé sur la distance et le D+ annoncés (pas de profil ni de carte).</div>';
    var prof = C ? '<div class="card rp-prof"><canvas id="rp-prof"></canvas></div><div class="card rp-map" id="map"></div>' : '';
    var segs = C && C.segments ? '<h3 class="pf-h">Segments</h3><div class="card rp-seg">' + C.segments.map(function (s, i) {
      var a = s.from_km * md.scale, b = s.to_km * md.scale, t0 = md.minAt(a), t1 = md.minAt(b), up = 0, dn = 0, pp = C.points.filter(function (p) { return p[3] >= s.from_km && p[3] <= s.to_km; });
      for (var k = 1; k < pp.length; k++) { var dz = pp[k][2] - pp[k - 1][2]; if (dz > 0) up += dz; else dn -= dz; }
      return '<div class="rp-sr"><i style="background:' + (i % 2 ? PAL.route : PAL.trail) + '"></i><span class="nm">' + esc(s.name) + '</span><span>' + n(b - a, 1) + ' km · +' + n(up) + ' / −' + n(dn) + ' m</span>' +
        (t0 !== null ? '<em>' + hmin(t0) + ' → ' + hmin(t1) + ' · ' + clockAdd(R.start_time, t1) + '</em>' : '') + '</div>'; }).join('') + '</div>' : '';
    var gl = ev.filter(function (e) { return e.kind === 'gel'; }), gT = gl.reduce(function (a, e) { return a + e.g; }, 0), mT = gl.reduce(function (a, e) { return a + (e.mg || 0); }, 0), GP = gelPlan(R), naT = ev.reduce(function (a, e) { return a + (e.na || 0); }, 0), nSalt = ev.filter(function (e) { return e.kind === 'salt' && !e.zero; }).length;
    var fsum = md.total && gl.length ? '<div class="card pad rp-fs"><div><b>' + gl.length + ' gels</b><small>' + (GP ? GP.gold + ' Gold · ' + Math.min(GP.kiwi, Math.max(0, gl.length - GP.gold)) + ' Kiwi' + (gl.length > GP.gold + GP.kiwi ? ' · ' + (gl.length - GP.gold - GP.kiwi) + ' ravito' : '') : '1 toutes les ' + (gl[1] ? gl[1].t - gl[0].t : 20) + ' min') + '</small></div>' +
      '<div><b>' + n(gT / md.total * 60) + ' g/h</b><small>' + n(gT) + ' g G au total</small></div><div><b>' + n(mT) + ' mg</b><small>caféine · demi-vie 5 h</small></div>' +
      '<div><b>' + n(naT / md.total * 60) + ' mg/h</b><small>sodium · ' + n(naT) + ' mg' + (R.water_ml_h && R.sodium_mg_l ? ' (cible ' + n(R.water_ml_h * R.sodium_mg_l / 1000) + '/h)' : '') + '</small></div>' +
      '<div><b>' + nSalt + ' SaltStick</b><small>' + SALT_NA + ' mg Na/caps</small></div>' +
      '<div><b>' + (R.water_ml_h ? n(R.water_ml_h) + ' mL/h' : '—') + '</b><small>eau</small></div></div>' +
      '<div class="sub rp-salt">SaltStick selon la température de chaque heure : 0 caps/h sous 20 °C · 1 de 20 à 25 °C · 2 au-dessus (plan nutrition).' + (nSalt ? '' : ' Météo prévue sous 20 °C : aucune capsule, le sodium vient des gels.') + '</div>' +
      '<div class="card rp-fuel"><canvas id="rp-fuel"></canvas></div>' : '';
    var tl = '<h3 class="pf-h">Gels &amp; hydratation</h3>' + fsum + (md.total ? '<div class="card rp-tl">' + ev.map(function (e) {
      return '<div class="rp-ev k-' + e.kind + (e.caf ? ' caf' : '') + (e.rav ? ' rav' : '') + (e.zero ? ' zero' : '') + '"><span class="t">' + hmin(e.t) + '<small>' + clockAdd(R.start_time, e.t) + '</small></span><span class="km">km ' + n(e.km, 1) + '</span><span class="tx"><b>' + esc(e.txt) + '</b>' + (e.sub ? '<small>' + esc(e.sub) + '</small>' : '') + '</span></div>'; }).join('') +
      '</div><div class="sub">Heures estimées pour l\'objectif ' + esc(String(R.target_time).replace(/:00$/, '')) + ' (effort = km + D+/100).' + (R.fueling ? ' ' + esc(R.fueling) : '') + '</div>' : '<div class="card pad">Pas d\'objectif de temps : ajoute target_time.</div>');
    var wx = '<h3 class="pf-h">Météo</h3>';
    if (W.hours && W.hours.length) {
      wx += '<div class="card rp-wx"><div class="rp-wl ' + (W.kind === 'forecast' ? 'fc' : 'cl') + '">' + esc(W.label) + '</div><div class="rp-wh">' + W.hours.map(function (h) {
        return '<div><span class="h">' + esc(h.h.replace(':00', 'h')) + '</span><span class="i">' + wxIcon(h) + '</span><b>' + n(h.t, 0) + '°</b><small>ress. ' + n(h.feel, 0) + '°</small><small>💧' + (h.pp === null || h.pp === undefined ? '—' : h.pp + '%') + '</small><small>' + n(h.wind, 0) + ' km/h</small></div>'; }).join('') + '</div></div>';
      if (W.outfit) wx += '<h3 class="pf-h">Tenue conseillée</h3><div class="card pad rp-out"><ul>' + W.outfit.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul><div class="sub">' + esc(W.outfit.why) + (W.kind === 'climate' ? ' · d\'après les normales, à revoir avec les prévisions' : '') + '</div></div>';
    } else wx += '<div class="card pad">' + esc(W.note || 'Météo indisponible.') + '</div>';
    $('#view').innerHTML = head + src + prof + segs + tl + wx;
    $('#rp-back').onclick = function (e) { e.preventDefault(); go('graph'); };
    if (C) drawRaceProfile(d, md, ev);
    if (md.total) drawFuelChart(d, md, ev);
  }
  function drawRaceProfile(d, md, ev) {
    var C = d.course, P = C.points, sc = md.scale; chartDefaults();
    var segOf = function (km) { var s = C.segments || []; for (var i = 0; i < s.length; i++) if (km <= s[i].to_km) return i; return 0; };
    var gels = ev.filter(function (e) { return e.kind === 'gel'; }), eleAt = function (km) { var c = km / sc; for (var i = 1; i < P.length; i++) if (P[i][3] >= c) return P[i][2]; return P[P.length - 1][2]; };
    var bands = { id: 'segb', beforeDraw: function (c) { var x = c.scales.x, y = c.scales.y, g = c.ctx; (C.segments || []).forEach(function (s, i) { if (i % 2) return; g.save(); g.fillStyle = 'rgba(61,187,106,.08)'; var a = x.getPixelForValue(s.from_km * sc), b = x.getPixelForValue(s.to_km * sc); g.fillRect(a, y.top, b - a, y.bottom - y.top); g.restore(); }); } };
    var ch = new Chart(document.getElementById('rp-prof'), { type: 'line', plugins: [bands], data: { datasets: [
      { data: P.map(function (p) { return { x: p[3] * sc, y: p[2] }; }), borderColor: '#4A4F4C', borderWidth: 1.5, pointRadius: 0, fill: true, backgroundColor: 'rgba(61,187,106,.18)', tension: .2 },
      { type: 'scatter', data: gels.map(function (g) { return { x: g.km, y: eleAt(g.km) }; }), pointRadius: 4, pointBackgroundColor: gels.map(function (g) { return g.caf ? '#7A4A1E' : '#E8A830'; }), pointBorderColor: '#fff', pointBorderWidth: 1.5 },
      { type: 'scatter', data: (C.aid || []).map(function (a) { return { x: a.km * sc, y: eleAt(a.km * sc) }; }), pointStyle: 'rectRot', pointRadius: 6, pointBackgroundColor: '#2F6DB5', pointBorderColor: '#fff' }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'nearest', axis: 'x', intersect: false }, parsing: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: function (it) { return 'km ' + n(it[0].parsed.x, 1); }, label: function (it) { return n(it.parsed.y, 0) + ' m'; } } } },
        scales: { x: { type: 'linear', min: 0, max: md.dist, ticks: { maxTicksLimit: 8, callback: function (v) { return v + ' km'; } }, grid: { display: false } }, y: { ticks: { maxTicksLimit: 5, callback: function (v) { return v + ' m'; } } } },
        onHover: function (e, els) { if (!S.cursor || !els.length) return; var p = P[Math.min(P.length - 1, els[0].index)]; if (els[0].datasetIndex === 0) S.cursor.setLatLng([p[0], p[1]]).setStyle({ opacity: 1, fillOpacity: 1 }); } } });
    S.charts.push(ch);
    S.map = L.map('map', { scrollWheelZoom: false, dragging: !MOBILE.matches, tap: false });
    L.tileLayer(BASEMAPS[0][1], BASEMAPS[0][2]).addTo(S.map);
    var segs = C.segments || [{ from_km: 0, to_km: P[P.length - 1][3] }], all = [];
    segs.forEach(function (s, i) { var ll = P.filter(function (p) { return p[3] >= s.from_km - 1e-6 && p[3] <= s.to_km + 1e-6; }).map(function (p) { return [p[0], p[1]]; }); all = all.concat(ll);
      L.polyline(ll, { color: i % 2 ? PAL.route : PAL.trail_d || PAL.trail, weight: 4, opacity: .9 }).addTo(S.map).bindTooltip(s.name || ''); });
    (C.aid || []).forEach(function (a) { var c = a.km, p = P.reduce(function (b, q) { return Math.abs(q[3] - c) < Math.abs(b[3] - c) ? q : b; }); L.circleMarker([p[0], p[1]], { radius: 6, color: '#fff', weight: 2, fillColor: '#2F6DB5', fillOpacity: 1 }).addTo(S.map).bindTooltip(a.name + ' · km ' + n(a.km * sc, 1)); });
    L.circleMarker([P[0][0], P[0][1]], { radius: 7, color: '#fff', weight: 2, fillColor: '#E8A830', fillOpacity: 1 }).addTo(S.map).bindTooltip('Départ / arrivée');
    S.cursor = L.circleMarker([P[0][0], P[0][1]], { radius: 6, color: '#1F2422', weight: 2, fillColor: '#E8A830', fillOpacity: 0, opacity: 0 }).addTo(S.map);
    S.map.fitBounds(L.latLngBounds(all), { padding: [10, 10] });
  }
  function bindRaceLinks() { $$('[data-race]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); go('race', { name: a.getAttribute('data-race') }); }; }); }
  /** Durée compacte : « 45 min », « 1 h 54 », « 8,6 h ». */
  function hmC(s) { s = +s || 0; var m = Math.round(s / 60); if (m < 60) return m + ' min'; if (s < 3 * 3600) return Math.floor(m / 60) + ' h ' + ('0' + m % 60).slice(-2); return n(s / 3600, 1) + ' h'; }
  /** Bandeau de la semaine sélectionnée (hauteur fixe, en haut) : « S39 · 64,1 km · +720 m · R 44 · T 20 » puis les autres activités. */
  function graphInfo(w) {
    if (!w) return '';
    var k = function (x) { return x === null || x === undefined ? '–' : n(x, x % 1 ? 1 : 0); }, parts = [];
    if (w.is_future) { parts.push(w.projection_km ? '<b>' + k(w.projection_km) + ' km</b> prévus' : 'rien de prévu'); if (w.target_km) parts.push('cible ' + k(w.target_km)); }
    else {
      parts.push('<b>' + k(w.done_km) + ' km</b>' + (w.is_current && w.target_km ? ' / ' + k(w.target_km) : ''));
      if (w.is_current && w.projection_km !== null && w.projection_km !== undefined) parts.push('proj ' + k(w.projection_km));
      if (w.done_d_plus_m) parts.push('+' + n(w.done_d_plus_m) + ' m');
      if (w.road_km) parts.push('R ' + n(w.road_km, 0)); if (w.trail_km) parts.push('T ' + n(w.trail_km, 0));
    }
    var oth = ['muscu'].concat(SPORTS).filter(function (t) { return w.other && w.other[t]; }).map(function (t) {
      var o = w.other[t], lb = t === 'autre' && o.labels && o.labels.length ? o.labels.join(', ') : TYPE_LBL[t];
      var v = t === 'natation' && o.km ? n(o.km * 1000) + ' m' : hmC(o.s);
      return '<span><i style="background:' + PAL[t] + '"></i>' + esc(lb) + ' ' + v + '</span>'; }).join('');
    return '<div class="gi-h"><b>S' + w.iso_week.slice(6) + ' · ' + dm(w.monday) + '</b>' + (w.is_current ? ' <em>en cours</em>' : w.is_future ? ' <em>à venir</em>' : '') + '</div>' +
      '<div class="gi-v">' + parts.join(' · ') + '</div>' + (oth ? '<div class="gi-o">' + oth + '</div>' : '') +
      w.races.map(function (r) { return '<div class="gi-r">🏁 ' + DOW[dowIdx(r.date)] + ' ' + dm(r.date) + ' : ' + esc(r.name) + '</div>'; }).join('');
  }
  function renderGraph(d) {
    destroyCharts();
    var W = d.weeks, N = W.length, mob = MOBILE.matches;
    var cur = W.findIndex(function (w) { return w.is_current; }); if (cur < 0) cur = N - 1;
    $('#view').innerHTML = '<div class="sec"><h2><span class="n">▮</span>Km hebdo</h2><div class="right"><span class="mono-label">course uniquement · horizon ' + (d.horizon ? dm(d.horizon) : '–') + '</span></div></div>' +
      '<div class="ginfo" id="ginfo" aria-live="polite"></div>' +
      '<div class="card graph-box" id="gbox" tabindex="0" aria-label="Graphique des km par semaine : glisser pour changer de semaine"><canvas id="g"></canvas></div>' +
      '<div class="glegend" id="glegend"></div><div class="sub ghint">Glisse le graphique pour changer de semaine.</div><div id="rp-list"></div>';
    fetchRace(null).then(function (r) { var el = document.getElementById('rp-list'); if (!el || !r.races || !r.races.length) return; el.innerHTML = '<div class="sec"><h2><span class="n">▮</span>Plans de course</h2></div>' + renderRaceList(r); bindRaceLinks(); }).catch(function () {});
    chartDefaults();
    var proj = W.map(function (w, i) { return { x: i, y: i === cur - 1 ? w.done_km : (i >= cur ? w.projection_km : null) }; });
    var races = []; W.forEach(function (w, i) { if (w.races.length) races.push(i); });
    var pts = function (f) { return W.map(function (w, i) { return { x: i, y: f(w) }; }); };
    var view = cur, sel = cur;
    // échelle : km course + cibles + projection des semaines affichées, +10 %, arrondi à 10 (D+ à 100)
    var scaleFor = function (c) {
      var lo = Math.max(0, Math.round(c) - G_SLOT), hi = Math.min(N - 1, Math.round(c) + (G_VIS - 1 - G_SLOT)), m = 0, m2 = 0;
      for (var i = lo; i <= hi; i++) { var w = W[i]; [(+w.road_km || 0) + (+w.trail_km || 0), w.done_km, w.target_km, proj[i].y].forEach(function (v) { if (+v > m) m = +v; }); if (+w.done_d_plus_m > m2) m2 = +w.done_d_plus_m; }
      return { y: Math.max(20, Math.ceil(m * 1.1 / 10) * 10), y2: Math.max(200, Math.ceil(m2 * 1.1 / 100) * 100) };
    };
    var sc0 = scaleFor(cur);
    var chart = new Chart($('#g'), {
      type: 'bar',
      data: {
        datasets: [
          { type: 'bar', label: 'Route', stack: 'km', data: pts(function (w) { return w.road_km; }), backgroundColor: W.map(function (w) { return w.is_current ? rgba(PAL.route, .55) : PAL.route; }), borderRadius: 0, yAxisID: 'y', order: 3, barPercentage: .9, categoryPercentage: .8 },
          { type: 'bar', label: 'Trail', stack: 'km', data: pts(function (w) { return w.trail_km; }), backgroundColor: W.map(function (w) { return w.is_current ? rgba(PAL.trail, .55) : PAL.trail; }), borderRadius: 0, yAxisID: 'y', order: 3, barPercentage: .9, categoryPercentage: .8 },
          { type: 'line', label: 'Cible', stack: 'cible', data: pts(function (w) { return w.target_km; }), borderColor: '#E8A830', backgroundColor: '#E8A830', stepped: 'middle', pointRadius: 0, borderWidth: 2, spanGaps: false, yAxisID: 'y', order: 1 },
          { type: 'line', label: 'Projection', stack: 'proj', data: proj, borderColor: '#1F2422', borderDash: [6, 4], pointRadius: 3, pointBackgroundColor: '#fff', borderWidth: 1.5, yAxisID: 'y', order: 2 },
          { type: 'line', label: 'D+ (m)', stack: 'dplus', data: pts(function (w) { return w.done_d_plus_m; }), borderColor: '#8B5E34', backgroundColor: '#8B5E34', pointRadius: 2, borderWidth: 1.2, yAxisID: 'y2', order: 0 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, events: [], parsing: { xAxisKey: 'x', yAxisKey: 'y' },
        scales: {
          x: { type: 'linear', offset: false, min: cur - G_SLOT - 0.5, max: cur + (G_VIS - 1 - G_SLOT) + 0.5, stacked: true, grid: { display: false },
            afterBuildTicks: function (s) { var t = []; for (var i = Math.ceil(s.min); i <= Math.floor(s.max); i++) t.push({ value: i }); s.ticks = t; },
            ticks: { autoSkip: false, maxRotation: 0, callback: function (v) { return W[v] && (!mob || v % 2 === 0) ? W[v].label : ''; } } },
          // deux bandes empilées à gauche : km (bas, 3/4) et D+ (haut, 1/4) → la courbe D+ ne recouvre plus les barres
          y: { stacked: true, beginAtZero: true, max: sc0.y, stack: 'v', stackWeight: 3, title: { display: !mob, text: 'km' }, grid: { color: '#ECE6DA' } },
          y2: { position: 'left', stack: 'v', stackWeight: 1, offset: true, beginAtZero: true, max: sc0.y2, title: { display: !mob, text: 'D+ m' },
            grid: { color: '#F3EEE3' }, border: { display: false }, ticks: { maxTicksLimit: 3, color: '#8B5E34', callback: function (v) { return v ? n(v) : ''; } } }
        },
        layout: { padding: { top: 8, bottom: 14 } },
        plugins: { raceMarkers: { items: races, center: cur }, sportDots: { weeks: W }, legend: { display: false }, tooltip: { enabled: false } }
      },
      plugins: [raceMarkers, sportDots]
    });
    S.charts.push(chart);
    $('#ginfo').innerHTML = graphInfo(W[sel]);
    // légende compacte (mêmes couleurs que partout) : barres, lignes, pastilles des autres activités présentes
    var present = ['muscu'].concat(SPORTS).filter(function (t) { return W.some(function (w) { return w.other && w.other[t]; }); });
    $('#glegend').innerHTML = '<span><i class="sq" style="background:' + PAL.route + '"></i>Route</span><span><i class="sq" style="background:' + PAL.trail + '"></i>Trail</span>' +
      '<span><i class="ln" style="border-color:#E8A830"></i>Cible</span><span><i class="ln dash" style="border-color:#1F2422"></i>Projection</span><span><i class="ln" style="border-color:#8B5E34"></i>D+ (bande du haut)</span>' +
      present.map(function (t) { return '<span><i class="dot" style="background:' + PAL[t] + '"></i>' + TYPE_LBL[t] + '</span>'; }).join('');
    // v74 : glisser fluide — une seule mise à jour du graphique par image (requestAnimationFrame), échelle verticale figée pendant le geste,
    // inertie à décroissance exponentielle, élastique doux aux bords, puis aimantation sur une semaine (échelle mise à jour une fois à la fin).
    var drawRaf = 0, gesture = false;
    var render = function () {
      drawRaf = 0;
      var xs = chart.options.scales.x; xs.min = view - G_SLOT - 0.5; xs.max = view + (G_VIS - 1 - G_SLOT) + 0.5;
      chart.options.plugins.raceMarkers.center = view;
      var i = Math.max(0, Math.min(N - 1, Math.round(view)));
      if (i !== sel) { sel = i; $('#ginfo').innerHTML = graphInfo(W[sel]); }
      if (!gesture) { var sc = scaleFor(sel); chart.options.scales.y.max = sc.y; chart.options.scales.y2.max = sc.y2; }
      chart.update('none');
    };
    var setView = function (v, free) { view = free ? v : Math.max(0, Math.min(N - 1, v)); if (!drawRaf) drawRaf = requestAnimationFrame(render); };
    var rubber = function (v) { // au-delà des bords : résistance (max ~1,2 semaine)
      if (v < 0) return -1.2 * (1 - Math.exp(v / 1.2)); if (v > N - 1) return N - 1 + 1.2 * (1 - Math.exp(-(v - N + 1) / 1.2)); return v;
    };
    var raf = 0;
    var animateTo = function (target) {
      cancelAnimationFrame(raf); target = Math.max(0, Math.min(N - 1, Math.round(target)));
      var from = view, t0 = performance.now(), T = Math.min(380, 180 + Math.abs(target - from) * 40);
      gesture = false; var sc = scaleFor(target); chart.options.scales.y.max = sc.y; chart.options.scales.y2.max = sc.y2; // échelle : une fois
      (function step(t) { var p = Math.min(1, (t - t0) / T), e = 1 - Math.pow(1 - p, 3); setView(from + (target - from) * e, true); if (p < 1) raf = requestAnimationFrame(step); })(t0);
    };
    var glide = function (velSlots) { // velSlots : semaines / ms
      cancelAnimationFrame(raf); var last = performance.now(), v = velSlots;
      (function step(t) {
        var dt = Math.min(32, t - last); last = t;
        v *= Math.exp(-dt / 325); // décroissance exponentielle (~iOS)
        var nx = view + v * dt;
        if (nx < 0 || nx > N - 1) { v *= Math.exp(-dt / 60); nx = rubber(nx); } // freinage fort au-delà du bord
        setView(nx, true);
        if (Math.abs(v) > 0.0008 && nx > -1.1 && nx < N + 0.1) raf = requestAnimationFrame(step); else animateTo(view);
      })(last);
    };
    // Glisser (doigt : glissé horizontal ; souris : cliquer-glisser) → tout le graphique défile sous la case 12.
    // Touche simple → la semaine touchée vient en case 12. Glissé vertical → défilement normal de la page (touch-action: pan-y).
    var cv = $('#g'), box = $('#gbox'), lp = 0, pan = false, sx = 0, sy = 0, v0 = 0, moved = false, samples = [];
    cv.style.touchAction = 'pan-y';
    var slotW = function () { var x = chart.scales.x; return Math.max(8, x.getPixelForValue(1) - x.getPixelForValue(0)); };
    var valAt = function (px) { var r = cv.getBoundingClientRect(); return chart.scales.x.getValueForPixel(px - r.left); };
    var start = function (x, y) { cancelAnimationFrame(raf); sx = x; sy = y; v0 = view; pan = false; moved = false; samples = [{ x: x, t: performance.now() }]; };
    var beginPan = function () { pan = true; gesture = true; box.classList.add('scrub'); v0 = view; };
    var move = function (x) {
      var t = performance.now(); samples.push({ x: x, t: t }); while (samples.length > 2 && t - samples[0].t > 100) samples.shift();
      setView(rubber(v0 - (x - sx) / slotW()), true);
    };
    var finish = function (x, tap) {
      clearTimeout(lp); box.classList.remove('scrub');
      if (pan) {
        var a = samples[0], b = samples[samples.length - 1], dt = b.t - a.t, vel = dt > 0 && performance.now() - b.t < 80 ? (b.x - a.x) / dt : 0; // px/ms
        var vs = -vel / slotW();
        if (Math.abs(vs) > 0.002 && view >= 0 && view <= N - 1) glide(vs); else animateTo(view);
      }
      else if (tap) { var v = Math.round(valAt(x)); if (v >= 0 && v < N) animateTo(v); }
      pan = false;
    };
    cv.addEventListener('touchstart', function (e) { if (e.touches.length !== 1) return; var t = e.touches[0]; start(t.clientX, t.clientY); clearTimeout(lp); lp = setTimeout(beginPan, 220); }, { passive: true });
    cv.addEventListener('touchmove', function (e) {
      if (e.touches.length !== 1) return;
      var t = e.touches[0], dx = Math.abs(t.clientX - sx), dy = Math.abs(t.clientY - sy);
      if (dx > 6 || dy > 6) moved = true;
      if (!pan) { if (dx > 6 && dx > dy) { clearTimeout(lp); beginPan(); sx = t.clientX; } else if (dy > 8) { clearTimeout(lp); return; } else return; }
      move(t.clientX);
    }, { passive: true });
    cv.addEventListener('touchend', function (e) { var t = e.changedTouches[0]; finish(t ? t.clientX : sx, !moved && !pan); });
    cv.addEventListener('touchcancel', function () { finish(sx, false); });
    cv.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return; e.preventDefault(); start(e.clientX, e.clientY);
      var mm = function (ev) { if (!pan && Math.abs(ev.clientX - sx) > 4) { moved = true; beginPan(); sx = ev.clientX; } if (pan) move(ev.clientX); };
      var mu = function (ev) { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); finish(ev.clientX, !moved); };
      document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
    });
    cv.addEventListener('wheel', function (e) { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); cancelAnimationFrame(raf); setView(view + e.deltaX / slotW()); clearTimeout(lp); lp = setTimeout(function () { animateTo(view); }, 120); } }, { passive: false });
    box.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') { e.preventDefault(); animateTo(sel - 1); } else if (e.key === 'ArrowRight') { e.preventDefault(); animateTo(sel + 1); } });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  // ------------------------------------------------------------------ DÉTAIL SORTIE
  function loadDetail() {
    var id = S.activityId, shown = null, here = function () { return S.view === 'detail' && S.activityId === id; };
    var libs = Promise.all([lib('Chart'), lib('L')]);
    var fast = window.DCAP.peek('uiActivity', [id]).then(function (c) { return c ? libs.then(function () { if (here() && !shown) { shown = JSON.stringify(c); renderDetail(c); } }) : null; }).catch(function () {});
    setTimeout(function () { if (!shown && here()) loading(); }, 150);
    Promise.all([call('uiActivity', id), libs, fast]).then(function (r) { if (here() && JSON.stringify(r[0]) !== shown) { shown = JSON.stringify(r[0]); renderDetail(r[0]); } }).catch(function (e) { if (!shown) fail(e); });
  }
  var SCALE = ['#3DBB6A', '#A4C84A', '#F2C94C', '#F2994A', '#D64545']; // intensité croissante
  function quantiles(vals, qs) { var v = vals.filter(function (x) { return x !== null && isFinite(x); }).sort(function (a, b) { return a - b; }); return qs.map(function (q) { return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : null; }); }
  /** Fiche d'un autre sport (marche, natation, vélo, autre) ou d'une séance de muscu : stats adaptées, pas de carte ni de splits. */
  function renderSportDetail(d) {
    var a = d.activity, km = +a.distance_km || 0, mv = +a.moving_s || +a.duration_s || 0, t = a.type;
    var h = '<div class="sec"><h2><span class="n" style="color:' + (PAL[t + '_d'] || PAL[t]) + '">●</span>' + esc(a.name || TYPE_LBL[t]) + '</h2><div class="right"><span class="mono-label">' + dayLabel(a.date) + ' · ' + esc(a.start_time) + ' · ' + esc(a.label || TYPE_LBL[t] || t) + '</span>' +
      '<button class="btn btn-ghost btn-sm" id="back">‹ Retour</button></div></div>';
    var cell = function (l, v, u) { return '<div class="cell"><div class="mono-label">' + l + '</div><div class="big">' + v + (u ? '<small>' + u + '</small>' : '') + '</div></div>'; };
    var c = [];
    if (km) c.push(t === 'natation' ? cell('Distance', n(km * 1000), 'm') : cell('Distance', n(km, 2), 'km'));
    c.push(cell('Temps', dur(a.duration_s)));
    if (a.moving_s && a.moving_s !== a.duration_s) c.push(cell('En mouvement', dur(a.moving_s)));
    if (km && mv) c.push(t === 'natation' ? cell('Allure', pace(mv / (km * 10)), '/100 m') : t === 'marche' ? cell('Allure', pace(mv / km), '/km') : t !== 'muscu' ? cell('Vitesse', n(km / (mv / 3600), 1), 'km/h') : '');
    c.push(cell('FC moy', n(a.avg_hr), 'bpm')); c.push(cell('FC max', n(a.max_hr), 'bpm'));
    if (+a.d_plus_m > 0) c.push(cell('D+ / D-', '+' + n(a.d_plus_m) + '<small> / -' + n(a.d_minus_m) + '</small>'));
    h += '<div class="card stats sp-' + esc(t) + '" style="border-left:3px solid var(--c)">' + c.filter(Boolean).join('') + '</div>';
    h += '<div class="panel" style="margin-top:10px"><div class="ttl">' + (t === 'muscu' ? 'Muscu' : 'Autre activité') + '</div>' +
      (t === 'muscu' ? 'Séance de renforcement.' : 'Hors km course : ne compte ni dans la cible hebdo, ni dans la projection, ni dans la charge ACWR.') +
      (d.debrief && d.debrief.text ? '<div class="debrief cmd" style="margin-top:8px">' + (mdRender ? mdRender(d.debrief.text) : esc(d.debrief.text)) + '</div>' : '') + '</div>';
    $('#view').innerHTML = h;
    $('#back').onclick = function () { go(S.from || 'week'); };
  }
  function renderDetail(d) {
    if (d.sport) return renderSportDetail(d);
    var a = d.activity, sp = d.splits, tr = d.track;
    var h = '<div class="sec"><h2><span class="n">◎</span>' + esc(a.name) + '</h2><div class="right"><span class="mono-label">' + dayLabel(a.date) + ' · ' + esc(a.start_time) + ' · ' + (TYPE_LBL[a.type] || esc(a.type)) + '</span>' +
      '<button class="btn btn-ghost btn-sm" id="back">‹ Retour</button></div></div>';
    var cell = function (l, v, u) { return '<div class="cell"><div class="mono-label">' + l + '</div><div class="big">' + v + (u ? '<small>' + u + '</small>' : '') + '</div></div>'; };
    h += '<div class="card stats">' + cell('Distance', n(a.distance_km, 2), 'km') + cell('Temps', dur(a.duration_s)) + cell('Allure', pace(a.avg_pace_s_km), '/km') +
      cell('GAP', pace(a.gap_s_km), '/km') + cell('FC moy', n(a.avg_hr), 'bpm') + cell('FC max', n(a.max_hr), 'bpm') +
      cell('D+ / D-', '+' + n(a.d_plus_m) + '<small> / -' + n(a.d_minus_m) + '</small>') + cell('Charge', n(a.load)) + '</div>';
    if (d.plan) h += '<div class="panel" style="margin-top:10px"><div class="ttl">Séance prévue · ' + esc(d.plan.type) + '</div>' + esc(d.plan.title || '') +
      (d.plan.structure ? ' · <b>' + esc(d.plan.structure) + '</b>' : '') + (d.plan.hr_target ? ' · FC ' + esc(d.plan.hr_target) : '') + (d.plan.distance_km ? ' · ' + n(d.plan.distance_km, 1) + ' km' : '') + '</div>';
    h += '<div class="detail-grid"><div class="card chart-box"><canvas id="prof"></canvas></div><div class="card map-card" style="padding:6px"><div id="map"></div>' +
      '<div class="row" style="justify-content:space-between;padding:6px 4px 2px"><div class="seg"><button data-cb="pace" class="' + (S.colorBy === 'pace' ? 'on' : '') + '">Allure</button><button data-cb="hr" class="' + (S.colorBy === 'hr' ? 'on' : '') + '">FC</button></div><div class="map-legend" id="mleg"></div></div></div></div>';
    // Debrief puis splits (sur téléphone : splits d'abord, voir .detail-tail)
    h += '<div class="detail-tail"><div class="dbf"><div class="sec"><h2><span class="n">✎</span>Debrief</h2><div class="right"><span class="mono-label" title="Valeur Garmin (lecture seule)">RPE ' + (a.rpe ? '<b class="rpe-v">' + esc(a.rpe) + '</b>/10' : '–') + '</span></div></div>';
    h += '<div class="panel"><div class="ttl">' + (d.debrief.from_coach ? 'Debrief coach' : d.debrief.auto ? 'Résumé auto · en attente du debrief coach' : 'Notes') + '</div><div class="debrief cmd">' +
      (mdRender ? mdRender(String(d.debrief.text).replace(/^\[Coach\]\s*/, '')) : esc(String(d.debrief.text).replace(/^\[Coach\]\s*/, ''))) + '</div></div></div>';
    // Splits
    h += '<div class="spl"><div class="sec"><h2><span class="n">≡</span>Splits</h2></div><div class="card" style="overflow-x:auto"><table class="tbl"><thead><tr><th>Km</th><th class="opt-m">Temps</th><th>Allure</th><th>GAP</th><th>FC</th><th>D+</th><th class="opt">D-</th><th class="opt">Pente</th></tr></thead><tbody>';
    var paces = sp.map(function (s) { return +s.pace_s_km; }), pmin = Math.min.apply(null, paces), pmax = Math.max.apply(null, paces);
    sp.forEach(function (s) {
      var w = pmax > pmin ? 30 + 70 * (pmax - s.pace_s_km) / (pmax - pmin) : 60;
      h += '<tr><td>' + s.km + (s.km === sp.length && a.distance_km % 1 > 0.005 ? ' <span class="muted">(' + n((a.distance_km % 1), 2) + ')</span>' : '') + '</td><td class="opt-m">' + dur(s.time_s) + '</td><td class="pace-cell"><b>' + pace(s.pace_s_km) + '</b><i style="width:' + Math.round(w * 0.42) + '%"></i></td><td>' + pace(s.gap_s_km) +
        '</td><td>' + n(s.avg_hr) + '</td><td style="color:#2E9A55">' + (+s.d_plus_m ? '+' + n(s.d_plus_m) : '0') + '</td><td class="opt">' + (+s.d_minus_m ? '−' + n(s.d_minus_m) : '0') + '</td><td class="opt">' + n(s.avg_grade_pct, 1) + ' %</td></tr>';
    });
    h += '</tbody></table>' + (sp.length ? '' : '<div class="empty">Pas de splits (activité sans trace GPX).</div>') + '</div></div></div>';
    $('#view').innerHTML = h;
    $('#back').onclick = function () { history.length > 1 ? go('week') : go('week'); };
    $$('[data-cb]').forEach(function (b) { b.onclick = function () { S.colorBy = b.getAttribute('data-cb'); $$('[data-cb]').forEach(function (x) { x.classList.toggle('on', x === b); }); drawTrack(tr); }; });
    if (tr && tr.profile && tr.profile.length) { drawProfile(tr); initMap(tr); drawTrack(tr); }
    else { $('#prof').parentNode.innerHTML = '<div class="empty">Pas de trace.</div>'; $('#map').innerHTML = '<div class="empty">Pas de carte.</div>'; }
  }

  /** Profil altitude (lissée) + FC sur les points bruts du fichier tracks/. */
  function drawProfile(tr) {
    chartDefaults();
    var P = tr.profile; // [dist_m, ele_lissee, hr, t_s, ele_brute, lat, lon]
    var hasHr = P.some(function (p) { return p[2]; });
    var ds = [{ label: 'Altitude (m)', data: P.map(function (p) { return { x: p[0] / 1000, y: p[1] }; }), borderColor: '#1F2422', borderWidth: 1.4, backgroundColor: 'rgba(200,144,32,.18)', fill: 'start', pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#fff', pointHoverBorderWidth: 2, yAxisID: 'y', tension: 0 }];
    if (hasHr) ds.push({ label: 'FC (bpm)', data: P.map(function (p) { return { x: p[0] / 1000, y: p[2] }; }), borderColor: '#D64545', borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#fff', pointHoverBorderWidth: 2, yAxisID: 'y2', tension: 0 });
    var c = new Chart($('#prof'), {
      type: 'line', data: { datasets: ds }, plugins: [hoverLine],
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: true, normalized: true,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 46 } }, // place réservée à l'infobulle, au-dessus de la zone tracée
        scales: {
          x: { type: 'linear', min: 0, max: P[P.length - 1][0] / 1000, title: { display: true, text: 'km' }, grid: { color: '#ECE6DA' } },
          y: { title: { display: true, text: 'm' }, grid: { color: '#ECE6DA' } },
          y2: { display: hasHr, position: 'right', title: { display: true, text: 'bpm' }, grid: { display: false } }
        },
        plugins: { legend: { position: 'bottom' }, tooltip: { enabled: false, external: profTip } },
        onHover: function (e, els) { if (els && els.length && S.map) { var p = P[els[0].index]; if (p) S.cursor.setLatLng([p[5], p[6]]).setStyle({ opacity: 1, fillOpacity: 1 }); } }
      }
    });
    S.charts.push(c);
  }
  /** Infobulle du profil : au-dessus de la zone tracée, centrée sur le curseur (bornée aux bords), jamais sur la courbe. */
  function profTip(ctx) {
    var ch = ctx.chart, t = ctx.tooltip, box = ch.canvas.parentNode, el = box.querySelector('.ptip');
    if (!el) { el = document.createElement('div'); el.className = 'ptip'; box.appendChild(el); }
    if (!t.opacity || !t.dataPoints || !t.dataPoints.length) { el.style.opacity = 0; return; }
    var dp = t.dataPoints, alt = dp.filter(function (d) { return d.datasetIndex === 0; })[0], hr = dp.filter(function (d) { return d.datasetIndex === 1; })[0];
    el.innerHTML = '<b>' + n(dp[0].parsed.x, 2) + ' km</b><span><i class="a"></i>' + (alt ? n(alt.parsed.y, 0) + ' m' : '–') + '</span>' + (hr ? '<span><i class="h"></i>' + n(hr.parsed.y, 0) + ' bpm</span>' : '');
    var a = ch.chartArea, x = ch.canvas.offsetLeft + dp[0].element.x, w = el.offsetWidth, cw = ch.canvas.offsetLeft + ch.width;
    el.style.left = Math.max(ch.canvas.offsetLeft + 2, Math.min(cw - w - 2, x - w / 2)) + 'px';
    el.style.top = (ch.canvas.offsetTop + Math.max(2, a.top - 44)) + 'px';
    el.style.opacity = 1;
  }
  // Trait vertical au curseur (du bas de l'infobulle au bas de la zone tracée)
  var hoverLine = {
    id: 'hoverLine',
    afterDatasetsDraw: function (chart) {
      var act = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
      if (!act.length) return;
      var x = act[0].element.x, a = chart.chartArea, ctx = chart.ctx;
      ctx.save(); ctx.strokeStyle = 'rgba(31,36,34,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, a.top - 6); ctx.lineTo(Math.round(x) + 0.5, a.bottom); ctx.stroke(); ctx.restore();
    }
  };

  /** Fonds de carte gratuits sans clé (licences / attributions respectées). Choix mémorisé dans localStorage. */
  var OSM_A = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  var BASEMAP_KEY = 'dcap_basemap_v19';
  var ESRI_HS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}';
  var BASEMAPS = [
    // Défaut : Esri Topo (clair, lisible en ville) + ombrage du relief Esri World Hillshade en « multiply » (les zones claires restent claires)
    ['Esri Topo', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri — Esri, HERE, Garmin, USGS, NGA, EPA, NPS, sources' }, { hillshade: 0.5 }],
    ['CyclOSM', 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '<a href="https://www.cyclosm.org">CyclOSM</a> · ' + OSM_A }],
    ['OpenTopoMap', 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: OSM_A + ', SRTM · style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' }],
    ['OpenStreetMap', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_A }],
    ['Satellite (Esri)', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri — Maxar, Earthstar Geographics, GIS User Community' }]
  ];
  function initMap(tr) {
    var layers = {}, pref = null;
    // Clé versionnée : v19 repart sur le nouveau défaut (Esri Topo) même si un autre fond était mémorisé.
    try { pref = localStorage.getItem(BASEMAP_KEY); localStorage.removeItem('dcap_basemap'); } catch (e) {}
    BASEMAPS.forEach(function (b) {
      var t = L.tileLayer(b[1], b[2]);
      layers[b[0]] = b[3] && b[3].hillshade ? L.layerGroup([t, L.tileLayer(ESRI_HS, { maxZoom: 19, maxNativeZoom: 16, opacity: b[3].hillshade, pane: 'relief', attribution: 'Relief © Esri World Hillshade' })]) : t;
    });
    var base = layers[pref] || layers[BASEMAPS[0][0]];
    // Téléphone : un doigt fait défiler la page (pas de piège de défilement), deux doigts zooment.
    S.map = L.map('map', { scrollWheelZoom: false, dragging: !MOBILE.matches, tap: false });
    var rp = S.map.createPane('relief'); rp.style.zIndex = 250; rp.style.mixBlendMode = 'multiply'; rp.style.pointerEvents = 'none';
    base.addTo(S.map);
    L.control.layers(layers, null, { position: 'topright' }).addTo(S.map);
    S.map.on('baselayerchange', function (e) { try { localStorage.setItem(BASEMAP_KEY, e.name); } catch (x) {} });
    S.map.fitBounds(tr.bounds, { padding: [12, 12] });
    S.cursor = L.circleMarker(tr.bounds[0], { radius: 6, color: '#1F2422', weight: 2, fillColor: '#E8A830', fillOpacity: 0, opacity: 0 }).addTo(S.map);
    S.trackLayer = L.layerGroup().addTo(S.map);
    var a = tr.simplified[0], b = tr.simplified[tr.simplified.length - 1];
    L.circleMarker([a[0], a[1]], { radius: 6, color: '#fff', weight: 2, fillColor: '#3DBB6A', fillOpacity: 1 }).addTo(S.map).bindTooltip('Départ');
    L.circleMarker([b[0], b[1]], { radius: 6, color: '#fff', weight: 2, fillColor: '#1F2422', fillOpacity: 1 }).addTo(S.map).bindTooltip('Arrivée');
  }

  /** Trace colorée par allure ou FC (5 classes par quantiles de la sortie). */
  function drawTrack(tr) {
    if (!S.map || !tr) return;
    S.trackLayer.clearLayers();
    var pts = tr.simplified, segs = [], i0 = 0; // [lat, lon, ele, t, hr, dist]
    for (var i = 1; i < pts.length; i++) {
      var dd = pts[i][5] - pts[i0][5];
      if (dd >= 40 || i === pts.length - 1) {
        var hrs = []; for (var j = i0; j <= i; j++) if (pts[j][4]) hrs.push(pts[j][4]);
        var v = S.colorBy === 'pace' ? (dd > 0 ? (pts[i][3] - pts[i0][3]) / dd * 1000 : null) : (hrs.length ? hrs.reduce(function (s, x) { return s + x; }, 0) / hrs.length : null);
        segs.push({ from: i0, to: i, v: v }); i0 = i;
      }
    }
    var q = quantiles(segs.map(function (s) { return s.v; }), [0.2, 0.4, 0.6, 0.8]);
    var cls = function (v) {
      if (v === null || q[0] === null) return 2;
      var k = 0; for (var t = 0; t < 4; t++) if (v > q[t]) k = t + 1;
      return S.colorBy === 'pace' ? 4 - k : k; // allure : plus petit = plus intense
    };
    var cur = null;
    segs.forEach(function (s) {
      var c = cls(s.v), latlngs = pts.slice(s.from, s.to + 1).map(function (p) { return [p[0], p[1]]; });
      if (cur && cur.c === c) cur.ll = cur.ll.concat(latlngs.slice(1));
      else { if (cur) L.polyline(cur.ll, { color: SCALE[cur.c], weight: 4, opacity: .95 }).addTo(S.trackLayer); cur = { c: c, ll: latlngs }; }
    });
    if (cur) L.polyline(cur.ll, { color: SCALE[cur.c], weight: 4, opacity: .95 }).addTo(S.trackLayer);
    var f = S.colorBy === 'pace' ? function (v) { return pace(v); } : function (v) { return Math.round(v); };
    var labels = S.colorBy === 'pace'
      ? ['> ' + f(q[3]), f(q[3]) + '–' + f(q[2]), f(q[2]) + '–' + f(q[1]), f(q[1]) + '–' + f(q[0]), '< ' + f(q[0])]
      : ['< ' + f(q[0]), f(q[0]) + '–' + f(q[1]), f(q[1]) + '–' + f(q[2]), f(q[2]) + '–' + f(q[3]), '> ' + f(q[3])];
    $('#mleg').innerHTML = q[0] === null ? '' : SCALE.map(function (c, k) { return '<span><i style="background:' + c + '"></i> ' + labels[k] + '</span>'; }).join('');
  }

  // ------------------------------------------------------------------ CHAT
  // ------------------------------------------------------------------ ENVELOPPE (oscaragent10.github.io/dcap)
  // L'app tourne dans userHtmlFrame (sandbox Google), elle-même dans /exec, lui-même dans l'enveloppe.
  // window.top = l'enveloppe : on lui écrit directement ; elle répond à notre fenêtre (event.source).
  // Messages acceptés uniquement de cette origine. Hors enveloppe : rien ne répond, le bouton micro reste caché.
  var Wrapper = (function () {
    var ORIGIN = location.origin, ls = [], W = { active: false, env: null, send: send, on: function (f) { ls.push(f); } };
    function send(m) { if (W.active) try { window.postMessage(Object.assign({ dcap: 1 }, m), ORIGIN); } catch (e) { /* hors enveloppe */ } }
    window.addEventListener('message', function (e) {
      var m = e.data; if (e.origin !== ORIGIN || !m || m.dcap !== 1) return;
      if (m.type === 'env') {
        W.active = true; W.env = m; document.documentElement.classList.add('in-wrapper');
        // bas : zone sûre réelle mesurée par l'enveloppe (remplace le repli 22 px) ; haut : géré par l'enveloppe seule
        document.documentElement.style.setProperty('--sab', (m.bottom || 0) + 'px'); 
        $('#chat-mic').hidden = !m.speech;
        notifBtn(m.push);
      }
      if (m.type === 'push-state') notifBtn(m.push);
      if (m.type === 'push-sub' && m.sub) call('uiSavePush', m.sub, m.ua || '').then(function () { notifBtn('granted'); if (m.fresh) toast('Notifications du coach activées ✓'); }).catch(fail);
      if (m.type === 'push-error') toast('Notifications : ' + (m.error || 'erreur'), 6000);
      ls.forEach(function (f) { f(m); });
    });
    // 🔔 : visible tant que les notifications ne sont pas actives ; l'invite iOS ne peut venir que d'un appui DANS l'enveloppe → elle affiche sa propre feuille
    function notifBtn(st) {
      W.push = st; var b = $('#chat-notif'); if (!b) return;
      b.hidden = !st || st === 'granted' || st === 'unsupported';
    }
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#chat-notif')) return;
      if (W.push === 'need-install') toast('D\'abord : Partager → « Sur l\'écran d\'accueil », puis ouvre DCAP depuis l\'icône.', 7000);
      else if (W.push === 'denied') toast('Notifications refusées : Réglages iPhone → Notifications → DCAP → Autoriser.', 7000);
      else send({ type: 'notif-ui' });
    });
    try { window.postMessage({ dcap: 1, type: 'hello' }, ORIGIN); } catch (e) { /* autre parent */ }
    return W;
  })();

  // Coach v30 : fil « carnet de terrain » (cartes coach, debriefs, propositions à valider), bandeau de contexte,
  // suggestions, attente animée + interrogation du serveur, défilement fiable jusqu'au dernier message (iPhone).
  var mdRender = null;
  window.addEventListener('dcap-flushed', function () { try { Chat.load(); } catch (e) {} });
  var Chat = (function () {
    var C = { msgs: [], props: {}, acts: {}, qsel: {}, pending: 0, mode: '', timer: null, isOpen: false, ctx: null, sending: false, seen: 0,
      brief: null, briefAt: 0, keys: null, sig: '', stick: true, unseen: false, tick: null, copyT: {} };
    var box = $('#msgs'), comp = $('#composer'), pill = $('#new-pill'), endEl = $('#chat-end'), input = $('#chat-input');
    var TZ = 'America/New_York';
    function etNow() {
      var p = {};
      try { new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); } catch (e) { return new Date().toISOString().slice(0, 19); }
      return p.year + '-' + p.month + '-' + p.day + 'T' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute + ':' + p.second;
    }
    function etToday() { return etNow().slice(0, 10); }
    function tsMs(ts) { var t = Date.parse(ts); return isNaN(t) ? Date.parse(String(ts).slice(0, 19)) : t; }
    function dayLbl(ymd) {
      var t = etToday(); if (ymd === t) return 'Aujourd\'hui'; if (ymd === addDays(t, -1)) return 'Hier';
      return DOW_L[dowIdx(ymd)] + ' ' + (+ymd.slice(8, 10)) + ' ' + MONTHS[+ymd.slice(5, 7) - 1];
    }
    // ---- rendu Markdown léger (texte échappé d'abord : aucune balise du message n'est interprétée)
    function inl(s) {
      return s.replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>').replace(/__([^_]+?)__/g, '<b>$1</b>')
        .replace(/(^|[\s(«])\*([^*\s][^*]*?)\*(?=[\s).,;:!?»]|$)/g, '$1<i>$2</i>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }
    mdRender = function (t) { return md(t); }; // v76 : même rendu (échappé) pour les debriefs hors du fil
    function md(text) {
      var out = [], list = null, para = [];
      function fp() { if (para.length) { out.push('<p>' + para.map(inl).join('<br>') + '</p>'); para = []; } }
      function fl() { if (list) { out.push('<' + list.t + '>' + list.items.map(function (x) { return '<li>' + inl(x) + '</li>'; }).join('') + '</' + list.t + '>'); list = null; } }
      esc(text).split(/\r?\n/).forEach(function (l) {
        var m;
        if (!l.trim()) { fp(); fl(); return; }
        if ((m = l.match(/^\s*[-*•·–]\s+(.*)$/))) { fp(); if (!list || list.t !== 'ul') { fl(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); return; }
        if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { fp(); if (!list || list.t !== 'ol') { fl(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); return; }
        if ((m = l.match(/^\s*#{1,4}\s+(.*)$/))) { fp(); fl(); out.push('<h4>' + inl(m[1]) + '</h4>'); return; }
        if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(l)) { fp(); fl(); out.push('<hr>'); return; }
        if (list && /^\s{2,}\S/.test(l)) { list.items[list.items.length - 1] += ' ' + l.trim(); return; }
        fl(); para.push(l);
      });
      fp(); fl(); return out.join('');
    }
    // ---- v82 : défilement refait selon le motif « stick to bottom » (StackBlitz use-stick-to-bottom) :
    // UN seul défileur (#chat-sc, jamais la fenêtre), UN ResizeObserver, recalage instantané scrollTop = scrollHeight
    // seulement si l'on est « collé ». On ne se décolle que si le DOIGT / la molette remonte. Aucun timer, aucun smooth.
    var sc = $('#chat-sc'), REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
    function nearBottom(th) { return sc.scrollHeight - sc.scrollTop - sc.clientHeight < (th || 70); }
    function stickNow() { if (C.isOpen && C.stick) sc.scrollTop = sc.scrollHeight; }
    function toEnd(smooth) {
      if (!C.isOpen) return;
      C.stick = true; C.unseen = false; setPill();
      if (smooth && !(REDUCED && REDUCED.matches)) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); else sc.scrollTop = sc.scrollHeight;
    }
    function hardEnd() { stickNow(); }      // compat : anciens appels v77–v81, désormais un simple recalage
    function pin() { C.stick = true; }
    function pinned() { return false; }
    function userBusy() { return C.touching || Date.now() - (C.userAt || 0) < 900; }
    function setPill() {
      var show = C.isOpen && !C.stick && C.unseen;
      pill.hidden = !show; pill.classList.toggle('new', C.unseen);
      pill.textContent = C.unseen ? 'Nouveau message ↓' : 'Dernier message ↓';
    }
    // hauteur visible réelle (clavier iOS compris) → variables CSS ; le Coach est un panneau fixe qui suit visualViewport
    function layout() {
      var vv = window.visualViewport, de = document.documentElement, tb = $('.topbar');
      if (tb) de.style.setProperty('--tbh', tb.getBoundingClientRect().height + 'px');
      de.style.setProperty('--vvh', (vv ? vv.height : window.innerHeight) + 'px');
      de.style.setProperty('--vvt', (vv ? Math.max(0, vv.offsetTop) : 0) + 'px');
      pill.style.bottom = (comp.offsetHeight + 12) + 'px';
    }
    var lastTop = 0;
    sc.addEventListener('scroll', function () {
      var t = sc.scrollTop, up = t < lastTop - 1; lastTop = t;
      if (nearBottom()) { if (!C.stick || C.unseen) { C.stick = true; C.unseen = false; setPill(); } }
      else if (up && userBusy() && C.stick) { C.stick = false; setPill(); } // décroché seulement par Paul
    }, { passive: true });
    sc.addEventListener('touchstart', function () { C.touching = true; C.userAt = Date.now(); }, { passive: true });
    sc.addEventListener('touchmove', function () { C.userAt = Date.now(); }, { passive: true });
    ['touchend', 'touchcancel'].forEach(function (ev) { sc.addEventListener(ev, function () { C.touching = false; C.userAt = Date.now(); }, { passive: true }); });
    sc.addEventListener('wheel', function () { C.userAt = Date.now(); }, { passive: true });
    if (window.ResizeObserver) { var ro = new ResizeObserver(function () { stickNow(); }); ro.observe(box); ro.observe(sc); }
    box.addEventListener('load', stickNow, true); // images chargées après coup
    var lq = 0; function relayout() { if (lq) return; lq = requestAnimationFrame(function () { lq = 0; layout(); stickNow(); }); }
    if (window.visualViewport) { visualViewport.addEventListener('resize', relayout); visualViewport.addEventListener('scroll', relayout); }
    window.addEventListener('resize', relayout);
    if (window.ResizeObserver) { var rl = new ResizeObserver(relayout); rl.observe($('.topbar')); rl.observe(comp); }
    layout();
    pill.onclick = function () { toEnd(true); };

    // ---- données
    function apply(r) {
      C.msgs = r.messages || C.msgs; C.mode = r.mode || C.mode; C.pending = r.pending || 0;
      (r.proposals || []).forEach(function (p) { C.props[p.proposal_id] = p; });
      (r.actions || []).forEach(function (a) { C.acts[a.action_id] = a; });
      if (r.unread !== undefined) setUnread(r.unread);
      $('#chat-mode').textContent = C.mode === 'xai' ? 'mode API xAI · réponse immédiate' : 'répond en 1 à 2 min';
      var nAssist = C.msgs.filter(function (m) { return m.role !== 'user'; }).length;
      if (!C.isOpen && nAssist > C.seen && C.seen) setNew(true);
      if (C.isOpen) C.seen = nAssist; else if (!C.seen) C.seen = nAssist;
      render(); schedule();
    }
    var briefPeek = false;
    function loadBrief(force) {
      if (!briefPeek && !C.brief) { briefPeek = true; window.DCAP.peek('uiCoachBrief', []).then(function (b) { if (b && !C.brief) { C.brief = b; strip(); render(); } }); }
      if (!force && C.brief && Date.now() - C.briefAt < 300000) return;
      C.briefAt = Date.now();
      call('uiCoachBrief').then(function (b) {
        C.brief = b; (b.pending || []).forEach(function (p) { if (!C.props[p.proposal_id] || C.props[p.proposal_id].status === 'pending') C.props[p.proposal_id] = p; });
        strip(); render();
      }).catch(function (e) { C.briefAt = 0; console.warn(e); });
    }
    function oldestPending() { return C.msgs.filter(function (m) { return m.role === 'user' && m.status === 'pending'; })[0]; }
    function waiting() { return C.sending || C.pending > 0; }
    // interrogation : toutes les 6 s les 4 premières minutes d'attente, puis 15 s (même coach fermé → pastille)
    function schedule() {
      clearTimeout(C.timer);
      if (C.pending > 0) { var o = oldestPending(), age = o ? Date.now() - tsMs(o.ts) : 0; C.timer = setTimeout(load, age < 240000 ? 6000 : 15000); }
      else if (Object.keys(C.acts).some(function (id) { return C.acts[id].status === 'pending'; })) C.timer = setTimeout(load, 20000); // demande en cours chez l'assistant
      clearInterval(C.tick);
      if (waiting() && C.isOpen) C.tick = setInterval(function () { var el = $('#th-el'); if (el) el.textContent = elapsed(); if (lateNow() !== C.late) render(); }, 1000);
    }
    function elapsed() { var o = oldestPending(), s = o ? Math.max(0, Math.round((Date.now() - tsMs(o.ts)) / 1000)) : 0; return s > 180 ? Math.floor(s / 60) + ' min' : Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
    function sentAt() { var o = oldestPending(), d = o ? new Date(tsMs(o.ts)) : new Date(); return d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); } // v61 : heure d'envoi réelle (avant : seule la durée m:ss s'affichait, lue comme une heure)
    function lateNow() { var o = oldestPending(); return !!(o && Date.now() - tsMs(o.ts) > 180000); }
    var peeked = false;
    function load() { if (!peeked) { peeked = true; window.DCAP.peek('uiChat', []).then(function (c) { if (c && !C.msgs.length) apply(c); }); } return call('uiChat', null).then(apply).catch(function (e) { console.warn(e); schedule(); }); }

    // v41 : bandeau de contexte retiré (trop de place) ; les suggestions gardent le contexte
    function strip() { suggest(); }
    // ---- suggestions (s'adaptent au contexte ; un appui envoie la question)
    function suggestions() {
      var b = C.brief || {}, s = [], r = (b.races || [])[0], L = b.load || {};
      if (b.last) s.push(b.last.has_debrief ? { t: 'Comment s\'est passée ma dernière sortie ?', ref: lastRef(), hot: true } : { t: 'Debriefe ma dernière sortie', ref: lastRef(), hot: true });
      if (r && r.days_left <= 21) s.push({ t: 'Stratégie ' + r.name, hot: r.days_left <= 10 });
      s.push({ t: b.dow >= 6 ? 'Prépare ma semaine prochaine' : 'Ajuste ma semaine' });
      s.push({ t: L.status === 'warn' || L.status === 'danger' ? 'Ma charge est-elle trop haute ?' : 'Ma charge' });
      if (r && r.days_left <= 10) s.push({ t: 'Nutrition pour ' + r.name });
      if (b.next) s.push({ t: 'Conseils pour ma prochaine séance', ref: 'séance ' + b.next.plan_id + ' · ' + b.next.type + ' du ' + b.next.date + ' « ' + (b.next.title || '') + ' »' });
      return s.slice(0, 6);
    }
    function lastRef() { var a = C.brief && C.brief.last; return a ? 'sortie ' + a.activity_id + ' du ' + a.date + ' (' + n(a.distance_km, 1) + ' km, ' + (a.name || a.type) + ')' : null; }
    function suggest() {
      C.sugg = []; return; // v63 : suggestions retirées
      var el = $('#sugg'), list = suggestions();
      C.sugg = list;
      el.innerHTML = list.map(function (x, i) { return '<button type="button" class="sg' + (x.hot ? ' hot' : '') + '" data-sg="' + i + '">' + esc(x.t) + '</button>'; }).join('');
      el.classList.toggle('off', !!input.value.trim() || waiting());
    }

    // ---- cartes
    var OPS = [[/^Échanger/, '⇄', ''], [/^Déplacer/, '→', ''], [/^Ajouter/, '+', 'add'], [/^Supprimer/, '−', 'del'], [/^Modifier/, '✎', ''], [/^Objectif/, '◎', '']];
    function propCard(p) {
      var st = p.status === 'pending' ? 'à valider' : p.status === 'accepted' ? 'validée ✓' : 'refusée';
      var h = '<div class="pc ' + esc(p.status) + (C.just === p.proposal_id ? ' just' : '') + '"><div class="pc-h"><span>Proposition de plan</span><span class="pc-st">' + st + '</span></div><ul class="pc-ops">' +
        (p.preview || []).map(function (l) { var o = OPS.filter(function (x) { return x[0].test(l); })[0] || [0, '•', '']; return '<li><i class="op ' + o[2] + '">' + o[1] + '</i><span>' + esc(l) + '</span></li>'; }).join('') + '</ul>' +
        (p.rationale ? '<div class="pc-why">' + esc(p.rationale) + '</div>' : '');
      if (p.status === 'pending') h += '<div class="pc-act"><button class="btn btn-green" data-ok="' + esc(p.proposal_id) + '">Valider</button><button class="btn btn-ghost" data-no="' + esc(p.proposal_id) + '">Refuser</button></div><div class="pc-note">Ton plan ne change que si tu valides.</div>';
      return h + '</div>';
    }
    // ---- réponses rapides (v36) : un appui ENVOIE (contrairement aux suggestions) ; plusieurs questions → réponses puis « Envoyer mes réponses »
    function jparse(s, d) { if (!s) return d; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch (e) { return d; } }
    function choicesText(g, picks) { return g.length === 1 ? g[0].o[picks[0]].value : g.map(function (x, i) { return x.q + ' → ' + x.o[picks[i]].value; }).join('\n'); }
    function qrBlock(m, live) {
      var g = jparse(m.choices, null); if (!g || !g.length) return '';
      var picks = jparse(m.picks, null), sel = C.qsel[m.msg_id] || {}, multi = g.length > 1, locked = !!picks || !live || waiting();
      var h = '<div class="qr' + (picks ? ' done' : '') + (locked && !picks ? ' off' : '') + '" data-qm="' + esc(m.msg_id) + '">';
      g.forEach(function (x, gi) {
        h += '<div class="qg">' + (x.q ? '<div class="qg-q">' + esc(x.q) + '</div>' : '') + '<div class="qg-o">';
        x.o.forEach(function (o, oi) {
          var on = picks ? picks[gi] === oi : sel[gi] === oi;
          h += '<button type="button" class="qb' + (on ? ' on' : '') + (picks && !on ? ' dim' : '') + '" data-qo="' + gi + ':' + oi + '"' + (locked ? ' disabled' : '') + '>' + (picks && on ? '✓ ' : '') + esc(o.label) + '</button>';
        });
        h += '</div></div>';
      });
      if (multi && !picks && !locked) {
        var n0 = Object.keys(sel).length;
        h += '<button type="button" class="btn btn-green qsend" data-qsend' + (n0 < g.length ? ' disabled' : '') + '>Envoyer mes réponses' + (n0 < g.length ? ' (' + n0 + '/' + g.length + ')' : '') + '</button>';
      }
      return h + '</div>';
    }
    function answer(mid, picks) {
      var m = C.msgs.filter(function (x) { return x.msg_id === mid; })[0]; if (!m || waiting()) return;
      var g = jparse(m.choices, []), text = choicesText(g, picks);
      m.picks = JSON.stringify(picks); delete C.qsel[mid];
      C.sending = true; C.msgs.push({ role: 'user', text: text, ts: etNow(), status: 'pending' }); render(); schedule(); // pas de saut forcé : on reste collé en bas seulement si on y était
      call('uiAnswerChoices', mid, picks).then(function (r) { C.sending = false; apply(r); })
        .catch(function (e) { C.sending = false; m.picks = ''; C.msgs.pop(); render(); fail(e); });
    }
    // ---- demandes d'action (v36) : création d'entraînement Garmin… exécutée par l'assistant après confirmation
    var STEP_LBL = { warmup: 'Échauffement', run: 'Course', interval: 'Effort', recovery: 'Récup', rest: 'Repos', cooldown: 'Retour au calme', other: 'Étape' };
    function stepDur(d) { d = d || {}; return d.distance_km != null ? n(d.distance_km, d.distance_km % 1 ? (Math.round(d.distance_km * 10) === d.distance_km * 10 ? 1 : 2) : 0) + ' km' : d.time_s != null ? (d.time_s % 60 ? Math.floor(d.time_s / 60) + '′' + ('0' + d.time_s % 60).slice(-2) : d.time_s / 60 + '′') : 'jusqu\'au tour'; }
    function stepTgt(t) { t = t || {}; return t.hr ? 'FC ' + t.hr.join('-') : t.pace ? t.pace.join('-') + '/km' : ''; }
    function stepLines(steps, depth) {
      return (steps || []).map(function (s) {
        if (s.type === 'repeat') return '<li class="st-rep"><b>' + s.times + '×</b><ul>' + stepLines(s.steps, depth + 1) + '</ul></li>';
        var tg = stepTgt(s.target);
        return '<li><span class="st-k">' + esc(STEP_LBL[s.type] || s.type) + '</span><span class="st-d">' + esc(stepDur(s.duration)) + '</span>' + (tg ? '<span class="st-t">' + esc(tg) + '</span>' : '') + (s.note ? '<i class="st-n">' + esc(s.note) + '</i>' : '') + '</li>';
      }).join('');
    }
    function actCard(a) {
      var p = a.payload || {}, st = a.status;
      var badge = { offered: 'à confirmer', pending: 'envoyée', done: 'fait ✓', failed: 'échec', declined: 'pas maintenant' }[st] || st;
      var h = '<div class="ac ' + esc(st) + '"><div class="pc-h"><span>' + (a.kind === 'garmin_workout' || a.kind === 'garmin_pacepro' ? 'Entraînement Garmin' : 'Demande d\'action') + '</span><span class="pc-st">' + esc(badge) + '</span></div>' +
        '<div class="ac-t">' + esc(a.title) + '</div>' + (a.summary ? '<div class="ac-s">' + esc(a.summary) + '</div>' : '');
      if (p.steps && p.steps.length) h += '<ul class="ac-steps">' + stepLines(p.steps, 0) + '</ul>';
      var extra = [];
      (p.alerts || []).forEach(function (al) { extra.push('⏰ ' + (al.text || al.type) + (al.every_min ? ' toutes les ' + al.every_min + ' min' : al.every_km ? ' tous les ' + al.every_km + ' km' : '')); });
      if (p.pacepro) extra.push('PacePro : ' + (p.pacepro.course ? p.pacepro.course + ' · ' : '') + 'objectif ' + p.pacepro.goal_time + (p.pacepro.strategy ? ' · ' + p.pacepro.strategy : ''));
      if (p.date) extra.push('Prévu le ' + DOW[dowIdx(p.date)] + ' ' + dm(p.date));
      if (extra.length) h += '<div class="ac-x">' + extra.map(esc).join('<br>') + '</div>';
      if (st === 'offered') h += '<div class="pc-act"><button class="btn btn-green" data-aok="' + esc(a.action_id) + '">' + esc(a.confirm_label || 'Oui, crée-le') + '</button><button class="btn btn-ghost" data-ano="' + esc(a.action_id) + '">' + esc(a.decline_label || 'Continuer à modifier') + '</button></div>';
      else if (st === 'pending') h += '<div class="ac-f"><i class="ac-spin"></i>Demande envoyée à l\'assistant…</div>';
      else if (st === 'done') h += '<div class="ac-f ok">Fait ✓' + (a.note ? ' · ' + esc(a.note) : '') + '</div>';
      else if (st === 'failed') h += '<div class="ac-f ko">Échec' + (a.note ? ' · ' + esc(a.note) : '') + '</div>';
      return h + '</div>';
    }
    function decideAct(id, dec, btn) {
      $$('[data-aok="' + id + '"],[data-ano="' + id + '"]', box).forEach(function (b) { b.disabled = true; });
      btn.textContent = dec === 'confirm' ? 'Envoi…' : '…';
      if (dec === 'decline') { C.sending = true; render(); }
      call('uiActionDecide', id, dec).then(function (r) { C.sending = false; if (r.action) C.acts[id] = r.action; apply(r); if (dec === 'confirm') toast('Demande envoyée à l\'assistant'); })
        .catch(function (e) { C.sending = false; C.sig = ''; dirty(); render(); fail(e); });
    }
    function copyBtn(text, id) { id = String(id || text.length); C.copyT[id] = text; return '<div class="cm-foot"><button class="cm-copy" data-copy="' + esc(id) + '">Copier</button></div>'; }
    function msgItem(m) {
      var t = m.ts ? String(m.ts).slice(11, 16) : '';
      if (m.role === 'user') {
        var mm = String(m.text).match(/^([\s\S]*?)\n\n\[contexte : ([\s\S]*)\]$/), body = mm ? mm[1] : m.text;
        var st = m.status === 'error' ? 'erreur' : m.status === 'pending' ? (m.queued ? 'en attente réseau' : 'envoyé') : 'lu ✓';
        return '<div class="cm me"><div class="me-b">' + esc(body) + (m.reaction ? '<span class="me-react" title="Réaction du coach">' + esc(m.reaction) + '</span>' : '') + '</div>' + (mm ? '<div class="me-ctx">↳ ' + esc(mm[2]) + '</div>' : '') + '<div class="me-meta">' + t + ' · ' + st + '</div></div>';
      }
      if (m.role === 'system') return '<div class="cm sys' + (/erreur/i.test(m.text) ? ' err' : '') + '">' + esc(m.text) + '</div>';
      var p = m.proposal_id && C.props[m.proposal_id], ac = m.action_id && C.acts[m.action_id];
      return '<article class="cm coach"><header><span class="who"><i class="dot"></i>Coach</span><time>' + t + '</time></header><div class="cmd">' + md(m.text) + '</div>' +
        (p ? propCard(p) : '') + (ac ? actCard(ac) : '') + qrBlock(m, m.msg_id === C.lastCoach) + copyBtn(m.text, m.msg_id || m.ts) + '</article>';
    }
    function debriefItem(a) {
      return '<article class="cm dbc sp-' + (/trail/.test(a.type) ? 'trail' : a.type === 'course' ? 'race' : 'route') + '" data-k="d' + esc(a.activity_id) + '"><header><span class="who"><i class="dot"></i>Debrief</span><time>' + DOW[dowIdx(a.date)] + ' ' + dm(a.date) + (a.start_time ? ' · ' + esc(String(a.start_time).slice(0, 5)) : '') + '</time></header>' +
        '<div class="dbc-t">' + esc(a.name || TYPE_LBL[a.type] || 'Sortie') + '</div>' +
        '<div class="dbc-st"><span><b>' + n(a.distance_km, 1) + '</b>km</span><span><b>' + pace(a.avg_pace_s_km) + '</b>/km</span><span><b>' + (a.avg_hr || '–') + '</b>FC moy</span><span><b>' + (a.d_plus_m ? '+' + n(a.d_plus_m) : '–') + '</b>D+ m</span></div>' +
        '<div class="cmd dbc-x">' + md(a.text) + '</div><div class="dbc-f">' + (String(a.text).length > 170 ? '<button class="lnk mut" data-more>Lire tout</button>' : '<span></span>') + '<button class="lnk" data-go="' + esc(a.activity_id) + '">Voir la sortie ›</button></div></article>';
    }
    function thinkItem() {
      var late = C.late = lateNow();
      return '<article class="cm think' + (late ? ' late' : '') + '"><header><span class="who"><i class="dot"></i>Coach</span><time></time></header><div class="th-row">' +
        '<svg class="th-svg" viewBox="0 0 66 28" aria-hidden="true"><path d="M2 24 L12 18 L18 21 L27 9 L34 15 L41 6 L50 16 L56 12 L64 20"/><circle cx="41" cy="6" r="2.2"/></svg>' +
        '<div><div class="th-t">' + (late ? 'Toujours en attente' : 'Le coach réfléchit…') + '</div><div class="th-s">' +
        (late ? 'Message bien enregistré à ' + sentAt() + ' (il y a <span id="th-el">' + elapsed() + '</span>). Le coach a été relancé, il répond dès qu\'il se réveille.' :
          C.mode === 'xai' ? 'réponse en quelques secondes' : '<span id="th-el">' + elapsed() + '</span> · réponse en 1 à 2 min d\'habitude, tu peux quitter l\'onglet') + '</div></div></div></article>';
    }
    function welcomeItem() {
      return '<article class="cm welcome"><header><span class="who"><i class="dot"></i>Coach</span><time></time></header><div class="cmd"><p><b>Salut Paul.</b> Pose-moi une question sur ta semaine, ta dernière sortie ou ta prépa course.</p><p>Je peux aussi proposer des changements de plan : rien ne bouge tant que tu ne les as pas validés.</p></div></article>';
    }
    function timeline() {
      var items = [];
      C.msgs.forEach(function (m) {
        if (m.role === 'system' && m.proposal_id) return; // la carte suffit
        items.push({ ts: String(m.ts || ''), k: m.role === 'user' ? 'u|' + m.text : 'm|' + (m.msg_id || m.ts), m: m });
      });
      var shown = {}; C.msgs.forEach(function (m) { if (m.proposal_id) shown[m.proposal_id] = 1; });
      ((C.brief && C.brief.debriefs) || []).forEach(function (a) { items.push({ ts: a.date + 'T' + (a.start_time || '12:00'), k: 'd|' + a.activity_id, d: a }); });
      items.sort(function (x, y) { return x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : 0; });
      Object.keys(C.props).forEach(function (id) { var p = C.props[id]; if (!shown[id] && (p.status === 'pending' || C.just === id)) items.push({ ts: '', k: 'p|' + id, p: p }); });
      return items;
    }
    // Rendu incrémental (v40) : chaque élément du fil a une clé ; on ne remplace que ceux qui ont changé,
    // on ajoute les nouveaux à leur place et on retire les disparus — jamais de remise à zéro de la liste (pas de flash, défilement stable).
    var normH = function (h) { return h.replace(/<span id="th-el">[^<]*<\/span>/g, ''); };
    function dirty() { Array.prototype.slice.call(box.children).forEach(function (el) { el._h = null; }); } // boutons désactivés à la main : à reconstruire
    function patch(list) {
      var cur = {};
      Array.prototype.slice.call(box.children).forEach(function (el) { if (el.getAttribute('data-key')) cur[el.getAttribute('data-key')] = el; else el.remove(); });
      var prev = null, tmp = document.createElement('div');
      list.forEach(function (it) {
        var el = cur[it.k], nh = normH(it.h);
        if (el && el._h === nh) delete cur[it.k];
        else {
          tmp.innerHTML = it.h; var nn = tmp.firstElementChild; nn.setAttribute('data-key', it.k); nn._h = nh;
          if (el) { if (el.classList.contains('open')) nn.classList.add('open'); el.replaceWith(nn); delete cur[it.k]; }
          else if (it.fresh) nn.classList.add('fresh');
          el = nn;
        }
        var want = prev ? prev.nextElementSibling : box.firstElementChild;
        if (want !== el) box.insertBefore(el, want);
        prev = el;
      });
      Object.keys(cur).forEach(function (k) { cur[k].remove(); });
    }
    function render(forceEnd) {
      C.copyT = {};
      C.lastCoach = null; for (var li = C.msgs.length - 1; li >= 0; li--) { var lm = C.msgs[li]; if (lm.role === 'user') break; if (lm.role === 'assistant') { C.lastCoach = lm.msg_id; break; } }
      var items = timeline(), list = [], keys = {}, day = null, first = C.keys === null, newCoach = false;
      if (!items.length && !waiting()) list.push({ k: '__welcome', h: welcomeItem() });
      items.forEach(function (it) {
        var d = it.ts.slice(0, 10);
        if (d && d !== day) { day = d; list.push({ k: 'sep|' + d, h: '<div class="dsep">' + esc(dayLbl(d)) + '</div>' }); }
        var k = it.k; while (keys[k]) k += '+'; // deux messages identiques : clés distinctes
        var fresh = !first && !C.keys[k];
        if (fresh && !(it.m && it.m.role === 'user')) newCoach = true;
        keys[k] = 1;
        var h = it.m ? msgItem(it.m) : it.d ? debriefItem(it.d) : '<article class="cm coach solo"><header><span class="who"><i class="dot"></i>En attente de ta validation</span></header>' + propCard(it.p) + '</article>';
        list.push({ k: k, h: h, fresh: fresh });
      });
      if (waiting()) { list.push({ k: '__think', h: thinkItem(), fresh: !!(C.keys && !C.keys.__think) }); keys.__think = 1; }
      var sig = list.map(function (x) { return x.k + '\u0001' + normH(x.h); }).join('\u0002');
      $('#ch-mark').classList.toggle('busy', waiting());
      suggest();
      C.keys = keys;
      if (sig === C.sig && !forceEnd) { if (pinned()) toEnd(false); return; }
      var stick = C.stick || nearBottom() || pinned();
      C.sig = sig; patch(list);
      if (forceEnd || first || stick) { if (forceEnd) C.stick = true; stickNow(); toEnd(false); hardEnd(first ? 1200 : 600); } // v81 : plus de smooth (il décollait du bas)
      else if (newCoach) { C.unseen = true; setPill(); }
      C.just = null;
    }
    function decide(id, dec, btn) {
      $$('[data-ok="' + id + '"],[data-no="' + id + '"]', box).forEach(function (b) { b.disabled = true; });
      btn.textContent = dec === 'accept' ? 'Validation…' : 'Refus…';
      call('uiDecide', id, dec).then(function (r) {
        C.props[id] = r.proposal; C.just = id; render();
        toast(dec === 'accept' ? 'Plan mis à jour ✓' : 'Proposition refusée');
        load(); loadBrief(true); if (dec === 'accept') { invalidateAll(); if (S.view !== 'detail' && !(MOBILE.matches && C.isOpen)) refresh(); }
      }).catch(function (e) { C.sig = ''; dirty(); render(); fail(e); });
    }
    function copyText(t, b) {
      var ok = function () { b.textContent = 'Copié ✓'; setTimeout(function () { b.textContent = 'Copier'; }, 1500); };
      var legacy = function () { var ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (e) { toast('Copie impossible : appui long sur le texte'); } document.body.removeChild(ta); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, legacy); else legacy();
    }
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-qo')) {
        var qm = b.closest('[data-qm]').getAttribute('data-qm'), gq = b.getAttribute('data-qo').split(':').map(Number), mq = C.msgs.filter(function (x) { return x.msg_id === qm; })[0];
        var gg = mq && jparse(mq.choices, []);
        if (!gg || !gg.length) return;
        if (gg.length === 1) return answer(qm, [gq[1]]); // une seule question : envoi immédiat
        var sl = C.qsel[qm] = C.qsel[qm] || {}; sl[gq[0]] = gq[1]; C.sig = ''; render(); return;
      }
      if (b.hasAttribute('data-qsend')) {
        var qm2 = b.closest('[data-qm]').getAttribute('data-qm'), m2 = C.msgs.filter(function (x) { return x.msg_id === qm2; })[0], g2 = jparse(m2 && m2.choices, []), s2 = C.qsel[qm2] || {};
        if (g2.every(function (x, i) { return s2[i] !== undefined; })) answer(qm2, g2.map(function (x, i) { return s2[i]; }));
        return;
      }
      if (b.hasAttribute('data-aok')) return decideAct(b.getAttribute('data-aok'), 'confirm', b);
      if (b.hasAttribute('data-ano')) return decideAct(b.getAttribute('data-ano'), 'decline', b);
      if (b.hasAttribute('data-ok')) decide(b.getAttribute('data-ok'), 'accept', b);
      else if (b.hasAttribute('data-no')) decide(b.getAttribute('data-no'), 'reject', b);
      else if (b.hasAttribute('data-copy')) copyText(C.copyT[b.getAttribute('data-copy')] || '', b);
      else if (b.hasAttribute('data-more')) { var c = b.closest('.dbc'); c.classList.toggle('open'); b.textContent = c.classList.contains('open') ? 'Réduire' : 'Lire tout'; }
      else if (b.hasAttribute('data-go')) go('detail', { id: b.getAttribute('data-go') });
    });
    if ($('#cstrip')) $('#cstrip').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-go')) go('detail', { id: b.getAttribute('data-go') });
      else if (b.hasAttribute('data-ask') && !input.value.trim()) { input.value = b.getAttribute('data-ask') + ' '; input.dispatchEvent(new Event('input')); input.focus(); try { input.setSelectionRange(input.value.length, input.value.length); } catch (err) { /* ignore */ } }
    });
    $('#sugg').addEventListener('click', function (e) {
      // suggestion : remplit seulement le champ (curseur à la fin), n'envoie jamais ; le contexte éventuel (dernière sortie…)
      // passe par la puce « À propos de » et n'est joint qu'à l'envoi
      var b = e.target.closest('[data-sg]'); if (!b) return; var s = C.sugg[+b.getAttribute('data-sg')]; if (!s) return;
      input.value = s.t; input.dispatchEvent(new Event('input')); if (s.ref) setCtx(s.ref);
      input.focus(); try { var L = input.value.length; input.setSelectionRange(L, L); } catch (err) { /* ignore */ }
    });

    function send(text, ref) {
      C.sending = true;
      var r0 = ref !== undefined && ref !== null ? ref : C.ctx;
      C.msgs.push({ role: 'user', text: text + (r0 ? '\n\n[contexte : ' + r0 + ']' : ''), ts: etNow(), status: 'pending', queued: !navigator.onLine });
      setCtx(null); render(true); schedule();
      call('uiSendChat', text, r0 || null).then(function (r) { C.sending = false; try { if (localStorage.getItem('dcap-chat-draft') === text && !input.value.trim()) localStorage.removeItem('dcap-chat-draft'); } catch (err) {} apply(r); if (r.queued) toast('Hors ligne : message gardé, envoyé dès le retour du réseau', 4500); if (r.error) toast('Erreur xAI : ' + r.error, 6000); if (r.reply && r.reply.proposal) toast('Nouvelle proposition à valider'); })
        .catch(function (e) { C.sending = false; C.msgs.pop(); render(); input.value = input.value || text; input.dispatchEvent(new Event('input')); fail(e); });
    }
    function setCtx(c) { C.ctx = c; $('#ctx-chip').style.display = c ? 'flex' : 'none'; $('#ctx-text').textContent = c ? 'À propos de : ' + c : ''; }
    function open(ctx) {
      if (Wrapper.env && Wrapper.env.stt === 'whisper') Wrapper.send({ type: 'mic-preload' }); // dictée Whisper : préchargement du modèle
      C.isOpen = true; $('#chat').classList.add('open'); setNew(false); if (C.unread) setUnread(C.unread); document.body.classList.add('chat-open'); $('#tab-coach').classList.add('on');
      if (ctx) setCtx(ctx);
      pin(3500); C.touching = false; C.userAt = 0; layout(); toEnd(); hardEnd(1500); load().then(function () { if (C.stick || pinned()) { toEnd(false); hardEnd(800); } }); loadBrief(); schedule();
      if (!MOBILE.matches) setTimeout(function () { input.focus(); }, 50); // mobile : pas de clavier imposé
    }
    function close() {
      if (MOBILE.matches && C.isOpen) window.scrollTo(0, 0);
      C.isOpen = false; pill.hidden = true; clearInterval(C.tick);
      $('#chat').classList.remove('open'); document.body.classList.remove('chat-open'); $('#tab-coach').classList.remove('on');
    }
    // messages spontanés du coach non lus : pastille avec le nombre sur l'onglet Coach ; lus dès que le coach est ouvert
    function setUnread(k) {
      C.unread = k || 0;
      if (C.unread && C.isOpen) { C.unread = 0; call('uiMarkRead').catch(function (e) { console.warn(e); }); }
      [$('#tab-coach .badge'), $('#bubble .badge')].forEach(function (b) { if (b) { b.textContent = C.unread ? (C.unread > 9 ? '9+' : String(C.unread)) : ''; b.classList.toggle('cnt', !!C.unread); } });
      if (C.unread) setNew(true);
      Wrapper.send({ type: 'badge', n: C.unread }); // pastille sur l'icône de l'écran d'accueil (iOS 16.4+)
    }
    function setNew(on) { $('#bubble').classList.toggle('has-new', on); $('#tab-coach').classList.toggle('has-new', on); }
    $('#bubble').onclick = function () { C.isOpen ? close() : open(); };
    // onglet Coach (téléphone) : ouvre la page coach ; déjà ouverte → retour au dernier message
    $('#tab-coach').onclick = function () { if (!C.isOpen) open(); else { pin(1500); toEnd(false); hardEnd(800); } };
    document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); }); // retour dans l'app : nouveaux messages du coach (pastille)
    // zone de saisie : grandit avec le texte (max ~5 lignes) ; suggestions masquées dès qu'on écrit
    input.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight + 2, 132) + 'px'; $('#sugg').classList.toggle('off', !!this.value.trim() || waiting()); });
    $('#chat-close').onclick = close;
    // clavier ouvert : la barre d'onglets s'efface, la saisie se colle au clavier ; on garde le dernier message visible
    // v64 : clavier ouvert → barre du haut + en-tête COACH + onglets masqués (CSS body.kb.chat-open). Hauteur retirée compensée
    // pour que les messages ne sautent pas ; dernier message ramené en vue si on était en bas ; visualViewport suit le clavier iOS.
    // v66 : pendant la saisie, rien d'autre de focalisable hors du Coach (barre ⌃ ⌄ d'iOS : flèches désactivées)
    function kbInert(on) { ['#view', '.topbar', '.tabbar'].forEach(function (s) { var e = $(s); if (e) { if (on) e.setAttribute('inert', ''); else e.removeAttribute('inert'); } }); }
    // v82 : clavier = simple classe CSS ; le panneau suit visualViewport (relayout), le ResizeObserver garde le bas si on y était
    input.addEventListener('focus', function () { if (MOBILE.matches) { document.body.classList.add('kb'); kbInert(true); } relayout(); });
    input.addEventListener('blur', function () { document.body.classList.remove('kb'); kbInert(false); relayout(); });
    // Dictée : bouton micro → la page enveloppe (oscaragent10.github.io) lance la reconnaissance vocale fr-FR
    var mic = { on: false, base: '', busy: false };
    function micStatus(h) { var el = $('#mic-status'); if (!el) { el = document.createElement('div'); el.id = 'mic-status'; el.setAttribute('aria-live', 'polite'); $('#chat-form').parentNode.insertBefore(el, $('#chat-form')); } el.innerHTML = h; el.hidden = !h; }
    function micUi(on) { mic.on = on; var b = $('#chat-mic'); b.classList.toggle('rec', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    $('#chat-mic').onclick = function () {
      if (mic.on) { Wrapper.send({ type: 'mic-stop' }); micUi(false); return; }
      if (mic.busy) return; // transcription en cours
      var v = input.value; mic.base = v && !/\s$/.test(v) ? v + ' ' : v;
      micUi(true); Wrapper.send({ type: 'mic-start' });
    };
    Wrapper.on(function (m) {
      if (m.type === 'speech') { mic.busy = false; if (m.text || m.interim) { input.value = mic.base + m.text; input.dispatchEvent(new Event('input')); } }
      else if (m.type === 'speech-end') { micUi(false); micStatus(''); }
      else if (m.type === 'speech-state') {
        if (m.state === 'rec') micStatus('<i class="dot"></i>Enregistrement ' + Math.floor(m.s / 60) + ':' + ('0' + m.s % 60).slice(-2) + ' · touche ■ pour arrêter');
        else if (m.state === 'transcribing') { mic.busy = true; micStatus('Transcription…'); }
        else if (m.state === 'loading' && m.total) { var pc = Math.round(100 * m.loaded / m.total); if (!mic.on && !mic.busy) micStatus(pc < 100 ? 'Dictée : modèle ' + pc + ' % (' + Math.round(m.total / 1e6) + ' Mo, une seule fois)' : ''); $('#mic-status').style.setProperty('--p', pc + '%'); }
        else if (m.state === 'ready') { if (!mic.on && !mic.busy) micStatus(''); var ms = $('#mic-status'); if (ms) ms.style.setProperty('--p', '0%'); }
        else if (m.state === 'fallback') toast('Dictée Whisper indisponible : retour à la dictée Safari', 4000);
      }
      else if (m.type === 'speech-error') { micUi(false); mic.busy = false; micStatus(''); toast(m.error === 'not-allowed' || m.error === 'service-not-allowed' ? 'Micro refusé : autorise le micro et la dictée (Réglages › Safari / Siri) ou utilise la dictée du clavier' : m.error === 'no-speech' ? 'Rien entendu' : 'Dictée indisponible (' + m.error + ')', 5000); }
      else if (m.type === 'env') layout();
      else if (m.type === 'open-coach') { if (!C.isOpen) open(); pin(2500); load().then(function () { C.stick = true; pin(2500); toEnd(false); hardEnd(800); }); } // v88 : toucher une notification → Coach ouvert, messages rechargés du serveur, fil au dernier message // toucher une notification
    });
    $('#ctx-clear').onclick = function (e) { e.preventDefault(); setCtx(null); };
    // v81 : envoi sur pointerdown (+ preventDefault) : le champ garde le focus, le clavier reste ouvert et le blur n'avale plus le tap.
    // Anti double envoi : C.sending + même texte ignoré pendant 1,5 s. Brouillon gardé en localStorage jusqu'à confirmation (serveur ou file hors ligne).
    var sendBtn = $('#chat-send'), DKEY = 'dcap-chat-draft', lastSend = { t: '', at: 0 };
    function trySend(e) {
      if (e) { e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); }
      var t = input.value.trim(); if (!t || C.sending) return;
      if (t === lastSend.t && Date.now() - lastSend.at < 1500) return;
      lastSend = { t: t, at: Date.now() };
      if (mic.on) { Wrapper.send({ type: 'mic-stop' }); micUi(false); }
      try { localStorage.setItem(DKEY, t); } catch (err) {}
      input.value = ''; input.dispatchEvent(new Event('input')); send(t);
    }
    sendBtn.addEventListener(window.PointerEvent ? 'pointerdown' : 'touchstart', function (e) { if (e.button > 0) return; sendBtn._pd = Date.now(); trySend(e); }, { passive: false });
    sendBtn.addEventListener('mousedown', function (e) { e.preventDefault(); }); // garde le focus du champ
    sendBtn.addEventListener('click', function (e) { e.preventDefault(); if (Date.now() - (sendBtn._pd || 0) < 800) return; trySend(e); }); // clavier / lecteur d'écran
    $('#chat-form').onsubmit = trySend;
    try { var dr = localStorage.getItem(DKEY); if (dr && !input.value) { input.value = dr; setTimeout(function () { input.dispatchEvent(new Event('input')); }, 0); } } catch (err) {}
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); trySend(e); } });

    // ---- v84 : fenêtre du Coach redimensionnable (grand écran / iPad). Aucune action sur iPhone (panneau plein écran, v82 intact).
    // Le panneau est ancré en bas à droite : on tire la poignée (haut gauche) vers le haut / la gauche pour l'agrandir.
    (function () {
      var chatEl = $('#chat'), grip = $('#chat-grip'), SK = 'dcap-chat-size', drag = null;
      try { localStorage.removeItem('dcap-chat-z'); localStorage.removeItem('dcap-chat-full'); } catch (err) {} // restes de la v83 (boutons retirés)
      function clamp(w, h) { return [Math.max(320, Math.min(window.innerWidth - 24, Math.round(w))), Math.max(360, Math.min(window.innerHeight - 120, Math.round(h)))]; }
      function setSize(w, h, save) {
        if (w === null) { chatEl.style.removeProperty('--cw'); chatEl.style.removeProperty('--chh'); if (save) try { localStorage.removeItem(SK); } catch (err) {} return; }
        var c = clamp(w, h); chatEl.style.setProperty('--cw', c[0] + 'px'); chatEl.style.setProperty('--chh', c[1] + 'px');
        if (save) try { localStorage.setItem(SK, JSON.stringify(c)); } catch (err) {}
      }
      try { var sv = JSON.parse(localStorage.getItem(SK) || 'null'); if (sv && sv.length === 2) setSize(sv[0], sv[1], false); } catch (err) {}
      grip.addEventListener('pointerdown', function (e) {
        if (MOBILE.matches) return; e.preventDefault();
        var r = chatEl.getBoundingClientRect(); drag = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
        try { grip.setPointerCapture(e.pointerId); } catch (err) {} document.body.classList.add('chat-resizing');
      });
      grip.addEventListener('pointermove', function (e) { if (drag) setSize(drag.w + (drag.x - e.clientX), drag.h + (drag.y - e.clientY), false); });
      function end() { if (!drag) return; drag = null; document.body.classList.remove('chat-resizing'); var r = chatEl.getBoundingClientRect(); setSize(r.width, r.height, true); }
      grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
      grip.addEventListener('dblclick', function () { setSize(null, null, true); });
      window.addEventListener('resize', function () { if (!MOBILE.matches && chatEl.style.getPropertyValue('--cw')) { var r = chatEl.getBoundingClientRect(); setSize(r.width, r.height, false); } });
    })();
    return { open: open, close: close, load: load };
  })();

  // ------------------------------------------------------------------ démarrage
  $$('[data-nav]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); var v = a.getAttribute('data-nav'); go(v, v === 'week' ? { day: null } : {}); }; });
  /** v52 : ↻ en arrière-plan — import inbox + agenda + recalcul + réveil « DCAP wake: sync » (sync Garmin des sorties).
   *  L'écran reste utilisable ; l'icône tourne ; les vues se rafraîchissent sur place, puis encore à +75 s et +180 s (arrivée de la sync Garmin). */
  function quietRefresh() {
    invalidateAll(); S.preloaded = false;
    if (S.view === 'week') { var mon = curWeekMonday() || S.curMonday; fetchWeek(mon).then(function (d) { quietRender('wk', d.monday, d); }).catch(function () {}); }
    else if (S.view === 'month' && S.ym) fetchMonth(S.ym[0], S.ym[1]).then(function (d) { quietRender('mo', S.ym[0] + '-' + S.ym[1], d); }).catch(function () {});
    else if (S.view === 'graph') fetchGraph().then(function (d) { quietRender('gr', 'g', d); }).catch(function () {});
    else if (S.view === 'perf') fetchCached(PF, 'p', 'uiPerf', []).then(function (d) { quietRender('pf', 'p', d); }).catch(function () {});
    setTimeout(preloadAll, 4000);
  }
  $('#btn-import').onclick = function () {
    var b = this; if (b.classList.contains('spin')) return;
    b.classList.add('spin'); b.setAttribute('aria-busy', 'true');
    call('uiRefresh').then(function (r) {
      b.classList.remove('spin'); b.removeAttribute('aria-busy');
      var im = r.import || {}, n = im.imported ? im.imported.length : 0;
      if (n) toast(n + ' activité(s) importée(s)', 3000);
      if (r.wake && r.wake.sent) toast('Sync Garmin demandée', 2500);
      quietRefresh();
      clearTimeout(S.reT1); clearTimeout(S.reT2);
      S.reT1 = setTimeout(quietRefresh, 75000); S.reT2 = setTimeout(quietRefresh, 180000);
    }).catch(function (e) { b.classList.remove('spin'); b.removeAttribute('aria-busy'); toast('Mise à jour impossible (réseau)', 3500); console.error(e); });
  };
  // barre du haut : se réduit au défilement
  (function () { var on = false; window.addEventListener('scroll', function () { var y = window.scrollY, v = on ? y > 8 : y > 40; if (v !== on) { on = v; document.body.classList.toggle('scrolled', v); } }, { passive: true }); })();
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  // Écran d'accueil iOS : dans notre iframe, env(safe-area-inset-*) vaut souvent 0 alors que la page Google
  // s'étend sous l'indicateur d'accueil (viewport-fit=cover). Repli : marge basse 22 px (le CSS prend le max).
  (function safeAreaFallback() {
    var ios = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    try { standalone = standalone || window.top.navigator.standalone === true; } catch (e) { /* cadre d'une autre origine */ }
    if (ios && standalone && Math.max(screen.width, screen.height) >= 812) document.documentElement.style.setProperty('--sab', '22px');
  })();
  // rotation / redimensionnement à travers le seuil mobile : re-rendu (graphique, libellés compacts, carte)
  if (MOBILE.addEventListener) MOBILE.addEventListener('change', function () { if (!$('#chat').classList.contains('open')) refresh(); });
  // Démarrage : semaine en cours embarquée par doGet (window.BOOT) → rendu immédiat, sans aller-retour serveur.
  // v85 : la semaine en cours se calcule d'après la date de New York, pas d'après le cache BOOT (qui peut dater de la veille / de la semaine dernière)
  S.today = etYmd(); S.curMonday = mondayOf(S.today); S.weekDay = null;
  if (window.BOOT && window.BOOT.monday && window.BOOT.today === S.today) WK[window.BOOT.monday] = { data: window.BOOT, at: Date.now() };
  /** v86 : note de séance — le clavier se ferme dès qu'on fait défiler la page (geste du doigt > 14 px) ; le texte reste dans le champ (brouillon intact, rien n'est envoyé). Le glissement qui démarre dans le champ lui-même, et les 700 ms après l'ouverture du clavier, sont ignorés. Chat du coach et autres champs : inchangés. */
  (function () {
    var y0 = null, x0 = 0, inTa = false, focusAt = 0;
    document.addEventListener('focusin', function (e) { if (e.target && e.target.id === 'gym-note') focusAt = Date.now(); }, true);
    document.addEventListener('touchstart', function (e) { var t = e.touches && e.touches[0]; if (!t) return; y0 = t.clientY; x0 = t.clientX; var ae = document.activeElement; inTa = !!(e.target && e.target.closest && e.target.closest('#gym-note')); }, { passive: true, capture: true });
    document.addEventListener('touchmove', function (e) {
      var ae = document.activeElement; if (y0 === null || !ae || ae.id !== 'gym-note' || inTa) return;
      if (Date.now() - focusAt < 700) return;
      var t = e.touches && e.touches[0]; if (!t) return;
      if (Math.abs(t.clientY - y0) > 14 && Math.abs(t.clientY - y0) > Math.abs(t.clientX - x0)) { y0 = null; ae.blur(); }
    }, { passive: true, capture: true });
    document.addEventListener('touchend', function () { y0 = null; }, { passive: true, capture: true });
  })();
  /** v85 : nouveau jour (minuit à New York) pendant que l'app est ouverte ou en arrière-plan → semaine / mois en cours, sans toucher aux autres écrans */
  function dayRoll() {
    var T = etYmd(); if (T === S.today) return;
    S.today = T; S.curMonday = mondayOf(T); S.weekDay = null; S.ym = null; S.preloaded = false; invalidateAll();
    if (S.view === 'week' || S.view === 'month') { if ($('#modal').classList.contains('open')) return; go(S.view, S.view === 'week' ? { day: null } : {}); }
    setTimeout(preloadAll, 3000);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') dayRoll(); });
  window.addEventListener('pageshow', dayRoll); window.addEventListener('focus', dayRoll);
  setInterval(dayRoll, 60000);
  /** v58 : version servie ≠ version affichée → purge des caches de vues puis rechargement par l'enveloppe (une seule tentative par build). */
  var VER_LAST = 0;
  function checkVersion() {
    if (Date.now() - VER_LAST < 60000) return; VER_LAST = Date.now();
    call('uiVersion').then(function (r) {
      var nb = r && r.build; if (!nb || nb === window.APP_BUILD) return;
      var key = 'dcap-reload-to', tried = null; try { tried = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {}
      if (tried && tried.b === nb && Date.now() - tried.at < 10 * 60000) { toast('Nouvelle version ' + nb + ' : ferme puis rouvre l\'app', 8000); return; } // pas de boucle
      try { localStorage.setItem(key, JSON.stringify({ b: nb, at: Date.now() })); } catch (e) {}
      if (G && G.dirty) try { localStorage.setItem(G.key, JSON.stringify({ t: Date.now(), ex: G.ex, note: G.note })); } catch (e) {} // la séance en cours survit
      lsClear(); // caches de vues (données) ; brouillons de séance et écran ouvert conservés
      if (Wrapper.active) { Wrapper.send({ type: 'reload', build: nb }); setTimeout(function () { toast('Nouvelle version ' + nb + ' : ferme puis rouvre l\'app', 8000); }, 5000); }
      else toast('Nouvelle version ' + nb + ' : recharge la page', 8000);
    }).catch(function () { VER_LAST = 0; });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') checkVersion(); });
  setTimeout(checkVersion, 2500);
  // v75 : mise à jour auto (pwa/updater.js) — occupation, brouillons, toast après rechargement
  window.DCAP_APP = {
    busy: function () { var a = document.activeElement; if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return true;
      if ($('#modal').classList.contains('open')) return true; if (G && (G.inflight || G.saveSt === 'pending')) return true; return false; },
    save: function () { try { if (G && G.dirty) localStorage.setItem(G.key, JSON.stringify({ t: Date.now(), ex: G.ex, note: G.note })); } catch (e) {}
      try { var v = $('#chat-input').value; if (v) localStorage.setItem('dcap-chat-draft', v); } catch (e) {} }
  };
  try { var cd = localStorage.getItem('dcap-chat-draft'); if (cd && !$('#chat-input').value) { $('#chat-input').value = cd; $('#chat-input').dispatchEvent(new Event('input')); } localStorage.removeItem('dcap-chat-draft'); } catch (e) {}
  try { if (sessionStorage.getItem('dcap-updated')) { sessionStorage.removeItem('dcap-updated'); setTimeout(function () { toast('Mis à jour', 2200); }, 600); } } catch (e) {}
  navRestore();
  if (S.view !== 'week') { hideSplash(); setTimeout(function () { if (S.curMonday) prefetchWeeks(S.curMonday); }, 1500); }
  setTimeout(hideSplash, 12000); // filet de sécurité
  Chat.load(); // reprend l'attente si un message est encore pending
})();