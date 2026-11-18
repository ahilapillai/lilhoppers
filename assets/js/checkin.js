/* Volunteer door check-in: passcode once, then scan the entry QR (or type the booking ID),
   see who is allowed in, and check them in. Works when opened from the phone's own camera
   too: the QR is a link to this page with ?b=LH-XXXXX. */
(function () {
  var cfg = window.LH_CONFIG;
  var API = window.LH_API;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'lh_staff_passcode';

  var passcode = '';
  try { passcode = localStorage.getItem(KEY) || ''; } catch (e) {}
  var current = null;     // the pass on screen
  var busy = false;

  if (API.demo) $('demoBanner').hidden = false;

  function show(name) {
    ['Login', 'Scan', 'Result'].forEach(function (n) { $('screen' + n).hidden = n !== name; });
    $('logout').hidden = name === 'Login';
    if (name === 'Scan') startCamera(); else pauseScanning();
    window.scrollTo(0, 0);
  }
  function err(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }

  /* ---------- passcode ---------- */
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = $('passcode').value.trim();
    if (!code) { err($('loginError'), 'Enter the passcode.'); return; }
    $('loginBtn').disabled = true;
    API.call('staffCheck', { passcode: code }).then(function (res) {
      $('loginBtn').disabled = false;
      if (!res.ok) { err($('loginError'), res.error || 'Wrong passcode.'); return; }
      passcode = code;
      try { localStorage.setItem(KEY, code); } catch (e2) {}
      err($('loginError'), '');
      $('passcode').value = '';
      afterLogin();
    });
  });
  $('logout').addEventListener('click', function () {
    passcode = '';
    try { localStorage.removeItem(KEY); } catch (e) {}
    stopCamera();
    show('Login');
  });
  function needLogin(res) {
    if (res && (res.code === 'UNAUTHORISED' || res.code === 'LOCKED')) {
      passcode = '';
      try { localStorage.removeItem(KEY); } catch (e) {}
      show('Login');
      err($('loginError'), res.code === 'LOCKED' ? res.error : 'The passcode has changed. Enter the new one.');
      return true;
    }
    return false;
  }

  /* ---------- camera + QR ---------- */
  var video = $('video'), stream = null, scanning = false, detector = null, canvas = null, lastText = '', lastAt = 0;

  function cameraMsg(text, withButton) {
    $('camera').classList.remove('is-live');
    $('cameraMsg').textContent = text;
    $('cameraBtn').hidden = !withButton;
  }

  function startCamera() {
    if (stream) { scanning = true; tick(); return; }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      cameraMsg("This browser can't use the camera. Type the booking ID below, or scan the QR with the phone's camera app.");
      return;
    }
    cameraMsg('Starting the camera…');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (s) {
      stream = s;
      video.srcObject = s;
      return video.play();
    }).then(prepareDecoder).then(function () {
      $('camera').classList.add('is-live');
      $('cameraBtn').hidden = true;
      scanning = !$('screenScan').hidden;
      tick();
    }).catch(function () {
      stopCamera();
      cameraMsg('Allow camera access to scan tickets, or type the booking ID below.', true);
    });
  }
  $('cameraBtn').addEventListener('click', startCamera);

  function stopCamera() {
    scanning = false;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    video.srcObject = null;
  }
  function pauseScanning() { scanning = false; }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopCamera();
    else if (!$('screenScan').hidden && passcode) startCamera();
  });

  // Phones with a built-in QR reader use it; others use the bundled jsQR.
  function prepareDecoder() {
    if (detector || window.jsQR) return Promise.resolve();
    if ('BarcodeDetector' in window) {
      return window.BarcodeDetector.getSupportedFormats().then(function (f) {
        if (f.indexOf('qr_code') >= 0) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        else return loadJsQR();
      }).catch(loadJsQR);
    }
    return loadJsQR();
  }
  function loadJsQR() {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'assets/vendor/jsQR.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function tick() {
    if (!scanning || !stream) return;
    if (video.readyState < 2) { setTimeout(tick, 150); return; }
    readFrame().then(function (text) {
      if (text && scanning) found(text);
      else setTimeout(tick, 120);
    }, function () { setTimeout(tick, 250); });
  }
  function readFrame() {
    if (detector) return detector.detect(video).then(function (codes) { return codes.length ? codes[0].rawValue : ''; });
    var w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return Promise.resolve('');
    var scale = Math.min(1, 720 / Math.max(w, h));
    canvas = canvas || document.createElement('canvas');
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    return Promise.resolve(code ? code.data : '');
  }

  function found(text) {
    var now = Date.now();
    // The family is often still holding the same QR up after "Scan next": ignore it for a few seconds.
    if (text === lastText && now - lastAt < 4000) { setTimeout(tick, 300); return; }
    lastText = text; lastAt = now;
    if (!/LH-[A-Z0-9]{3,12}/i.test(text)) {
      cameraMsg('');
      $('camera').classList.add('is-live');
      err($('manualError'), "That QR isn't a Lil' Hoppers ticket.");
      setTimeout(tick, 900);
      return;
    }
    scanning = false;
    if (navigator.vibrate) navigator.vibrate(60);
    lookup(text);
  }

  /* ---------- look up and show the pass ---------- */
  $('manualForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('manualId').value.trim();
    if (!v) { err($('manualError'), 'Type the booking ID, e.g. LH-7K2QX.'); return; }
    if (!/^LH-/i.test(v)) v = 'LH-' + v;
    lookup(v);
  });

  function lookup(text) {
    if (busy) return;
    busy = true;
    err($('manualError'), '');
    API.call('checkinLookup', { passcode: passcode, bookingId: text }).then(function (res) {
      busy = false;
      if (needLogin(res)) return;
      if (!res.ok) {
        if (!$('screenScan').hidden) { err($('manualError'), res.error); setTimeout(function () { scanning = true; tick(); }, 900); return; }
        showError(res.error);
        return;
      }
      $('manualId').value = '';
      showPass(res.pass);
    });
  }

  var VERDICTS = {
    valid: { tone: 'ok', icon: '✓', title: 'Valid ticket', note: function () { return 'Not checked in yet'; } },
    checkedIn: { tone: 'ok', icon: '✓', title: 'Checked in', note: function (p) { return 'At ' + clock(p.checkedInAt) + '. Welcome them in!'; } },
    already: { tone: 'warn', icon: '!', title: 'Already checked in', note: function (p) { return 'At ' + clock(p.checkedInAt) + '. This ticket has been used.'; } },
    pending: { tone: 'stop', icon: '✕', title: 'Payment not verified yet', note: function () { return "Don't let in yet. Ask the organiser to check the payment."; } },
    rejected: { tone: 'stop', icon: '✕', title: 'Booking rejected', note: function () { return "Don't let in. Send them to the organiser."; } },
    unpaid: { tone: 'stop', icon: '✕', title: 'Not paid', note: function () { return "This booking wasn't completed. Send them to the organiser."; } }
  };

  function showPass(p) {
    current = p;
    $('pass').hidden = false;
    var v = VERDICTS[p.verdict] || VERDICTS.unpaid;
    $('verdict').dataset.tone = v.tone;
    $('verdictIcon').textContent = v.icon;
    $('verdictTitle').textContent = v.title;
    $('verdictNote').textContent = v.note(p);

    $('kidsNum').textContent = p.children;
    $('kidsWord').textContent = p.children === 1 ? 'kid' : 'kids';
    $('adultsNum').textContent = p.grownUps;
    $('adultsWord').textContent = p.grownUps === 1 ? 'grown-up' : 'grown-ups';
    $('adultsNote').innerHTML = esc(p.parentsIncluded + (p.parentsIncluded === 1 ? ' parent' : ' parents') + ' included') +
      (p.extraParent ? ' + <strong>1 extra parent</strong>' : ' · no extra parent');
    $('factId').textContent = p.bookingId;
    $('factParent').textContent = p.parentName || '—';
    $('factKids').textContent = p.childNames || '—';
    $('factSlot').textContent = [p.slotLabel, p.slotTime].filter(Boolean).join(' · ');
    var chip = slotWarning(p.slotTime);
    $('slotChip').hidden = !chip; $('slotChip').textContent = chip;
    $('factGifts').textContent = p.giftQty ? p.giftQty + (p.giftQty === 1 ? ' gift' : ' gifts') : 'None';
    $('pass').classList.toggle('is-muted', v.tone === 'stop');

    var canCheckIn = p.verdict === 'valid';
    $('checkinBtn').hidden = !canCheckIn;
    $('nextBtn').classList.toggle('ci-next', canCheckIn); // when there's nothing to do, "Scan next" is the main button
    $('undoBtn').hidden = !(p.verdict === 'checkedIn' || p.verdict === 'already');
    err($('resultError'), '');
    show('Result');
    if (canCheckIn) $('checkinBtn').focus(); else $('nextBtn').focus();
  }

  function showError(msg) {
    current = null;
    $('verdict').dataset.tone = 'stop';
    $('verdictIcon').textContent = '✕';
    $('verdictTitle').textContent = 'No booking found';
    $('verdictNote').textContent = msg;
    $('pass').hidden = true;
    $('checkinBtn').hidden = true; $('undoBtn').hidden = true;
    $('nextBtn').classList.remove('ci-next');
    show('Result');
  }

  $('checkinBtn').addEventListener('click', function () {
    if (!current || busy) return;
    busy = true; this.disabled = true;
    var btn = this;
    API.call('checkin', { passcode: passcode, bookingId: current.bookingId }).then(function (res) {
      busy = false; btn.disabled = false;
      if (needLogin(res)) return;
      if (!res.ok) { if (res.pass) showPass(res.pass); err($('resultError'), res.error); return; }
      showPass(res.pass); // a ticket checked in on another phone comes back as 'already'
    });
  });
  $('undoBtn').addEventListener('click', function () {
    if (!current || busy) return;
    busy = true;
    API.call('checkinUndo', { passcode: passcode, bookingId: current.bookingId }).then(function (res) {
      busy = false;
      if (needLogin(res)) return;
      if (!res.ok) { err($('resultError'), res.error); return; }
      showPass(res.pass);
    });
  });
  $('nextBtn').addEventListener('click', function () {
    current = null;
    $('pass').hidden = false;
    lastAt = Date.now(); // the same ticket can be scanned again after a few seconds
    show('Scan');
  });

  /* ---------- helpers ---------- */
  function clock(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var h = d.getHours(), m = d.getMinutes();
    return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // On the event day, flag tickets for a slot that hasn't started (more than 30 minutes early) or has ended.
  function slotWarning(slotTime) {
    var d = String(cfg.EVENT_DATE).match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    var now = new Date();
    if (!d) return '';
    var month = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(d[2].toLowerCase()) / 3;
    var event = new Date(Number(d[3]), month, Number(d[1]));
    if (event.toDateString() !== now.toDateString()) return '';
    var t = String(slotTime || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!t) return '';
    var at = function (h, m, ap) { var d = new Date(now); d.setHours((Number(h) % 12) + (/pm/i.test(ap) ? 12 : 0), Number(m), 0, 0); return d; };
    var start = at(t[1], t[2], t[3]), end = at(t[4], t[5], t[6]);
    if (now < start.getTime() - 30 * 60000) return 'Starts ' + t[1] + ':' + t[2] + ' ' + t[3].toUpperCase();
    if (now > end) return 'Ended ' + t[4] + ':' + t[5] + ' ' + t[6].toUpperCase();
    return '';
  }

  /* ---------- start ---------- */
  var fromLink = new URLSearchParams(location.search).get('b');
  if (fromLink) history.replaceState(null, '', location.pathname); // keep the address tidy

  function afterLogin() {
    if (fromLink) { var id = fromLink; fromLink = null; show('Scan'); pauseScanning(); lookup(id); }
    else show('Scan');
  }
  if (passcode) afterLogin(); else show('Login');
})();
