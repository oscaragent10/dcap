
    

    // Pont avec l'app. Chaîne de cadres : cette page → script.google.com (/exec) → sandbox *.googleusercontent.com
    // → userHtmlFrame (même origine que la sandbox, c'est là que tourne l'app). L'app écrit à window.top ;
    // on répond directement à event.source (sa fenêtre), sans repasser par les cadres intermédiaires.
    var APP_ORIGIN = { test: function (o) { return o === location.origin; } };
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var rec = null, peer = null;
    function post(m) { if (peer) peer.w.postMessage(Object.assign({ dcap: 1 }, m), peer.o); }
    function env() {
      return { type: 'env', wrapper: true, bottom: document.getElementById('probe').offsetHeight || 0,
        standalone: navigator.standalone === true || matchMedia('(display-mode: standalone)').matches, speech: !!(SR || WH.ok), stt: WH.ok ? 'whisper' : (SR ? 'safari' : 'none'), push: pushState() };
    }
    function startRec() {
      if (rec) return;
      try {
        rec = new SR(); rec.lang = 'fr-FR'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
        rec.onstart = function () { post({ type: 'speech-start' }); };
        rec.onresult = function (e) {
          var fin = '', tmp = '';
          for (var i = 0; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (tmp += e.results[i][0].transcript));
          post({ type: 'speech', text: (fin + tmp).replace(/\s+/g, ' ').trim(), interim: !!tmp });
        };
        rec.onerror = function (e) { post({ type: 'speech-error', error: e.error || 'error' }); };
        rec.onend = function () { rec = null; post({ type: 'speech-end' }); };
        rec.start();
      } catch (err) { rec = null; post({ type: 'speech-error', error: String(err && err.name || err) }); post({ type: 'speech-end' }); }
    }


    // ---- Dictée Whisper sur l'appareil (stt-worker.js, Transformers.js v3) ; secours : reconnaissance Safari ci-dessus
    var WH = (function () {
      var W = { ok: !!(window.Worker && window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.OfflineAudioContext || window.webkitOfflineAudioContext)),
        rec: null, worker: null, state: 'idle', loaded: false, failed: false, jobs: {}, seq: 0 };
      // v60 : dictée Safari par défaut (rapide, texte en direct). Whisper seulement sur demande explicite : ?stt=whisper (mémorisé), ?stt=safari pour revenir.
      var want = null; try { want = new URLSearchParams(location.search).get('stt'); if (want) localStorage.setItem('dcap-stt', want); else want = localStorage.getItem('dcap-stt'); } catch (e) {}
      if (want !== 'whisper') {
        W.ok = false;
        // libère le modèle Whisper déjà téléchargé (~250 Mo, cache Transformers.js) ; aucun autre cache ni brouillon touché
        try { if (window.caches) caches.delete('transformers-cache'); } catch (e) {}
      }
      function st(state, x) { post(Object.assign({ type: 'speech-state', state: state }, x || {})); }
      function fallback(why) {
        W.failed = true; W.ok = false; try { if (W.worker) W.worker.terminate(); } catch (e) {} W.worker = null;
        Object.keys(W.jobs).forEach(function (k) { W.jobs[k].rej(new Error(why)); }); W.jobs = {};
        st('fallback', { error: why }); post(env());
      }
      function worker() {
        if (W.worker || !W.ok) return W.worker;
        try { W.worker = new Worker('stt-worker.js', { type: 'module' }); } catch (e) { fallback('worker: ' + e); return null; }
        W.worker.onmessage = function (e) {
          var m = e.data || {};
          if (m.type === 'progress') st('loading', { loaded: m.loaded, total: m.total });
          else if (m.type === 'ready') { W.loaded = true; W.device = m.device; st('ready', { device: m.device }); }
          else if (m.type === 'load-error') fallback('modèle : ' + m.error);
          else if (m.type === 'result' && W.jobs[m.id]) { W.jobs[m.id].res(m); delete W.jobs[m.id]; }
          else if (m.type === 'error' && W.jobs[m.id]) { W.jobs[m.id].rej(new Error(m.error)); delete W.jobs[m.id]; }
        };
        W.worker.onerror = function (e) { fallback('worker: ' + (e.message || 'erreur')); };
        return W.worker;
      }
      W.preload = function () { var w = worker(); if (w && !W.loaded && !W.preloading) { W.preloading = true; w.postMessage({ type: 'load' }); } };
      // v87 : le micro n'est demandé (getUserMedia) qu'une fois par session d'app. Le MediaStream est gardé et réutilisé d'un vocal à l'autre
      // (piste désactivée entre deux enregistrements, coupée après 2 min d'inactivité ou quand l'app passe en arrière-plan) ;
      // on ne redemande que si la piste est terminée (ended) ou coupée par iOS (muted).
      W.stream = null; W.idle = null;
      function micLive() { var t = W.stream && W.stream.getAudioTracks()[0]; return !!(t && t.readyState === 'live' && !t.muted); }
      function micDrop() { clearTimeout(W.idle); W.idle = null; var s = W.stream; W.stream = null; if (s) s.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); }
      W.mic = function () {
        clearTimeout(W.idle); W.idle = null;
        if (micLive()) { W.stream.getAudioTracks().forEach(function (t) { t.enabled = true; }); return Promise.resolve(W.stream); }
        micDrop();
        return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
          W.stream = stream;
          stream.getAudioTracks().forEach(function (t) { t.addEventListener('ended', function () { if (W.stream === stream) W.stream = null; }); });
          return stream;
        });
      };
      W.micRelease = function () {
        if (!W.stream) return;
        W.stream.getAudioTracks().forEach(function (t) { t.enabled = false; });
        clearTimeout(W.idle); W.idle = setTimeout(micDrop, window.DCAP_MIC_IDLE_MS || 120000);
      };
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && !W.rec) micDrop(); });
      W.start = function () {
        if (W.rec) return; W.preload();
        W.mic().then(function (stream) {
          var mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].filter(function (t) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); })[0];
          var r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), parts = [], t0 = Date.now();
          W.rec = r;
          r.ondataavailable = function (e) { if (e.data && e.data.size) parts.push(e.data); };
          r.onstop = function () {
            clearInterval(W.tick); W.micRelease(); W.rec = null;
            var blob = new Blob(parts, { type: r.mimeType || mime || 'audio/mp4' });
            if (Date.now() - t0 < 500 || !blob.size) { post({ type: 'speech-end' }); return; }
            st('transcribing');
            blob.arrayBuffer().then(decode16k).then(function (pcm) {
              var w = worker(); if (!w) throw new Error('whisper indisponible');
              var id = ++W.seq;
              return new Promise(function (res, rej) { W.jobs[id] = { res: res, rej: rej }; w.postMessage({ type: 'transcribe', id: id, audio: pcm }, [pcm.buffer]); });
            }).then(function (m) {
              post({ type: 'speech', text: m.text, interim: false, ms: m.ms, device: m.device }); post({ type: 'speech-end' });
            }).catch(function (err) { post({ type: 'speech-error', error: 'whisper: ' + (err && err.message || err) }); post({ type: 'speech-end' }); });
          };
          r.start(1000); post({ type: 'speech-start' }); st('rec', { s: 0 });
          W.tick = setInterval(function () { var s = Math.round((Date.now() - t0) / 1000); st('rec', { s: s }); if (s >= 120) r.stop(); }, 500);
        }).catch(function (err) { post({ type: 'speech-error', error: err && err.name === 'NotAllowedError' ? 'not-allowed' : String(err && err.name || err) }); post({ type: 'speech-end' }); });
      };
      W.stop = function () { if (W.rec && W.rec.state !== 'inactive') W.rec.stop(); };
      // Décodage (mp4/AAC sur iOS, webm ailleurs) + rééchantillonnage 16 kHz mono via OfflineAudioContext
      function decode16k(buf) {
        var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, ctx = new OAC(1, 16000, 16000);
        return new Promise(function (res, rej) { var p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); }).then(function (ab) {
          if (ab.sampleRate === 16000 && ab.numberOfChannels === 1) return new Float32Array(ab.getChannelData(0));
          var n = Math.ceil(ab.duration * 16000), off = new OAC(1, n, 16000), src = off.createBufferSource();
          src.buffer = ab; src.connect(off.destination); src.start(0);
          return off.startRendering().then(function (r) { return new Float32Array(r.getChannelData(0)); });
        });
      }
      return W;
    })();

    // ---- Notifications Web Push (iOS 16.4+ : uniquement dans l'app ajoutée à l'écran d'accueil)
    var VAPID_PUBLIC = 'BE1MgRR6LQIOe6JiooFfUj4A66TPdx80NKHfnQFmZNfHen0Gj2ANEBEXqvqtBI2OT5p1g_KQHCunW72sQrZB4DI';
    var STANDALONE = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    var PUSH_OK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    var swReg = 'serviceWorker' in navigator ? navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () { return null; }) : Promise.resolve(null); // v52 : aussi pour le cache de la coquille
    function pushState() { return PUSH_OK ? Notification.permission : (STANDALONE ? 'unsupported' : 'need-install'); }
    function b64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var r = atob(s), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
    function sendSub(fresh) {
      return swReg.then(function (reg) { return reg ? navigator.serviceWorker.ready : null; }).then(function (reg) {
        if (!reg) throw new Error('service worker indisponible');
        return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID_PUBLIC) }); });
      }).then(function (sub) { post({ type: 'push-sub', sub: sub.toJSON(), ua: navigator.userAgent, fresh: !!fresh }); post({ type: 'push-state', push: 'granted' }); });
    }
    var sheet = document.getElementById('notif');
    function showSheet() { if (PUSH_OK && Notification.permission === 'default') sheet.classList.add('on'); }
    document.getElementById('notif-later').onclick = function () { sheet.classList.remove('on'); try { localStorage.setItem('dcap-notif-later', String(Date.now())); } catch (e) {} };
    document.getElementById('notif-go').onclick = function () {
      sheet.classList.remove('on');
      // appel direct dans le geste (exigence iOS)
      Notification.requestPermission().then(function (p) {
        post({ type: 'push-state', push: p });
        if (p === 'granted') return sendSub(true);
      }).catch(function (err) { post({ type: 'push-error', error: String(err && err.message || err) }); });
    };
    // toucher une notification alors que l'app est déjà ouverte : le worker nous prévient → on ouvre le Coach
    if (PUSH_OK) navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'open-coach') { if (peer) post({ type: 'open-coach' }); else wantCoach = true; } });
    var wantCoach = /[?&]tab=coach\b/.test(location.search);
    if (wantCoach && history.replaceState) history.replaceState(null, '', location.pathname);
    // première ouverture de l'app installée : proposer une fois (puis via 🔔 dans le Coach)
    if (STANDALONE && PUSH_OK && Notification.permission === 'default') { var later = 0; try { later = +localStorage.getItem('dcap-notif-later') || 0; } catch (e) {} if (Date.now() - later > 7 * 864e5) setTimeout(showSheet, 2500); }
    window.addEventListener('message', function (e) {
      var m = e.data;
      if (!m || m.dcap !== 1 || !APP_ORIGIN.test(e.origin) || !e.source) return;
      peer = { w: e.source, o: e.origin };
      if (m.type === 'hello') {
        post(env());
        if (wantCoach) { wantCoach = false; post({ type: 'open-coach' }); }
        if (PUSH_OK && Notification.permission === 'granted') sendSub(false).catch(function () {}); // rafraîchit l'abonnement dans le Sheet
      }
      else if (m.type === 'reload') { location.reload(); }
      else if (m.type === 'notif-ui') showSheet();
      else if (m.type === 'badge' && navigator.setAppBadge) { (m.n ? navigator.setAppBadge(m.n) : navigator.clearAppBadge()).catch(function () {}); }
      else if (m.type === 'mic-preload') WH.preload();
      else if (m.type === 'mic-start') { if (WH.ok) WH.start(); else if (SR) startRec(); }
      else if (m.type === 'mic-stop') { if (WH.rec) WH.stop(); else if (rec) rec.stop(); }
    });
    window.addEventListener('resize', function () { post(env()); });

    