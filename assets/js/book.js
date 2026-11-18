/* Booking flow: choose → pay (UPI QR) → details + proof → ticket. */
(function () {
  var cfg = window.LH_CONFIG;
  var P = window.LH_PRICING;
  var API = window.LH_API;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'lh_booking_v1';
  var STEPS = ['choose', 'pay', 'details', 'done'];

  LH_FESTIVE.fillTemplates(document, LH_FESTIVE.generate());
  if (API.demo) $('demoBanner').hidden = false;

  var state = {
    step: 'choose', slots: [], slotId: null, children: 1, extraParent: false,
    giftOn: true, giftQty: 1, giftTouched: false, photoOk: true, hold: null, result: null, shot: null
  };
  try {
    var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved && (saved.hold || saved.result)) Object.assign(state, saved);
  } catch (e) { /* ignore */ }

  function persist() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        step: state.step, slotId: state.slotId, children: state.children, extraParent: state.extraParent,
        giftOn: state.giftOn, giftQty: state.giftQty, giftTouched: state.giftTouched, hold: state.hold, result: state.result
      }));
    } catch (e) { /* private mode */ }
  }

  /* ---------------- helpers ---------------- */
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function admitLabel(children, extraParent) {
    return plural(children, 'kid', 'kids') + ' + ' + plural(children + (extraParent ? 1 : 0), 'parent', 'parents');
  }
  function giftQty() { return state.giftOn ? state.giftQty : 0; }
  function localAmounts() { return P.computeAmounts(cfg.PRICES, state.children, state.extraParent, giftQty()); }
  function slotById(id) { return state.slots.filter(function (s) { return s.id === id; })[0]; }
  function showError(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }

  function renderLines(dl, a) {
    var rows = [[plural(a.children, 'kid', 'kids') + ' + ' + plural(a.children, 'parent', 'parents'), P.rupees(a.ticketSubtotal)]];
    if (a.extraParent) rows.push(['Extra parent', P.rupees(a.extraParentCharge)]);
    if (a.giftQty) rows.push(['Gift from Santa × ' + a.giftQty, P.rupees(a.giftSubtotal)]);
    dl.innerHTML = '';
    rows.forEach(function (r) {
      var d = document.createElement('div');
      var dt = document.createElement('dt'); dt.textContent = r[0];
      var dd = document.createElement('dd'); dd.textContent = r[1];
      d.appendChild(dt); d.appendChild(dd); dl.appendChild(d);
    });
  }

  function fill(name, value) {
    document.querySelectorAll('[data-fill="' + name + '"]').forEach(function (el) { el.textContent = value; });
  }

  /* ---------------- step switching ---------------- */
  function go(step, opts) {
    state.step = step;
    persist();
    STEPS.forEach(function (s) { $('step-' + s).hidden = s !== step; });
    var idx = STEPS.indexOf(step);
    document.querySelectorAll('.bk-steps li').forEach(function (li, i) {
      li.classList.toggle('is-current', i === idx);
      li.classList.toggle('is-done', i < idx);
      if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (step === 'pay') renderPay();
    if (step === 'details') renderDetails();
    if (step === 'done') renderDone();
    if (step === 'choose') renderChoose();
    if (!(opts && opts.quiet)) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      var h = $('step-' + step).querySelector('h1');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }

  /* ---------------- step 1: choose ---------------- */
  function loadAvailability() {
    $('slotList').innerHTML = '<p class="bk-muted">Loading slots…</p>';
    API.call('availability').then(function (res) {
      if (!res.ok) {
        $('slotList').innerHTML = '';
        var p = document.createElement('p'); p.className = 'bk-error'; p.textContent = res.error || 'Could not load the slots.';
        var b = document.createElement('button'); b.type = 'button'; b.className = 'bk-link'; b.textContent = 'Try again'; b.onclick = loadAvailability;
        $('slotList').appendChild(p); $('slotList').appendChild(b);
        return;
      }
      state.slots = res.slots;
      var sel = slotById(state.slotId);
      if (sel && sel.soldOut) state.slotId = null;
      renderChoose();
    });
  }

  function renderSlots() {
    var box = $('slotList');
    if (!state.slots.length) return;
    box.innerHTML = '';
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', 'Time slots');
    state.slots.forEach(function (s) {
      var label = document.createElement('label');
      label.className = 'bk-slot' + (s.soldOut ? ' is-sold' : '');
      var input = document.createElement('input');
      input.type = 'radio'; input.name = 'slot'; input.value = s.id;
      input.disabled = !!s.soldOut;
      input.checked = state.slotId === s.id;
      input.addEventListener('change', function () { state.slotId = s.id; showError($('chooseError'), ''); persist(); });
      var name = document.createElement('span'); name.className = 'bk-slot-name'; name.textContent = s.label;
      var time = document.createElement('span'); time.className = 'bk-slot-time'; time.textContent = String(s.time).replace(/^(\d{1,2}:\d{2}) (AM|PM) – (.+ \2)$/, '$1 – $3');
      label.appendChild(input); label.appendChild(name); label.appendChild(time);
      if (s.soldOut) {
        var badge = document.createElement('span'); badge.className = 'bk-slot-badge'; badge.textContent = 'Sold Out';
        label.appendChild(badge);
        label.setAttribute('aria-disabled', 'true');
      }
      box.appendChild(label);
    });
  }

  function renderChoose() {
    renderSlots();
    var n = state.children;
    $('kidsCount').textContent = n;
    $('kidsMinus').disabled = n <= 1;
    $('kidsPlus').disabled = n >= cfg.MAX_CHILDREN;
    $('kidsNote').textContent = admitLabel(n, state.extraParent);
    $('extraParent').checked = state.extraParent;
    $('giftOn').checked = state.giftOn;
    $('photoOk').checked = !!state.photoOk;
    var sel = $('giftQty');
    if (sel.options.length !== n) {
      sel.innerHTML = '';
      for (var i = 1; i <= n; i++) { var o = document.createElement('option'); o.value = i; o.textContent = i + (i === 1 ? ' gift' : ' gifts'); sel.appendChild(o); }
    }
    sel.value = String(state.giftQty);
    $('giftQtyRow').hidden = !(state.giftOn && n > 1);
    var a = localAmounts();
    renderLines($('chooseLines'), a);
    $('chooseTotal').textContent = P.rupees(a.total);
  }

  function setChildren(n) {
    n = Math.max(1, Math.min(cfg.MAX_CHILDREN, n));
    state.children = n;
    if (!state.giftTouched || state.giftQty > n) state.giftQty = n;
    persist();
    renderChoose();
  }

  $('kidsMinus').addEventListener('click', function () { setChildren(state.children - 1); });
  $('kidsPlus').addEventListener('click', function () { setChildren(state.children + 1); });
  $('extraParent').addEventListener('change', function (e) { state.extraParent = e.target.checked; persist(); renderChoose(); });
  $('giftOn').addEventListener('change', function (e) { state.giftOn = e.target.checked; persist(); renderChoose(); });
  $('giftQty').addEventListener('change', function (e) { state.giftQty = Number(e.target.value); state.giftTouched = true; persist(); renderChoose(); });

  $('photoOk').addEventListener('change', function (e) {
    state.photoOk = e.target.checked;
    $('consentRow').classList.remove('bk-nudge');
    if (state.photoOk && $('chooseError').textContent === CONSENT_MSG) showError($('chooseError'), '');
  });
  var CONSENT_MSG = 'Tick the box above to continue.';

  // "photo consent" opens the details: a popup on desktop, a bottom sheet on phones (CSS decides).
  var consentDlg = $('consentDlg');
  $('consentInfo').addEventListener('click', function (e) {
    e.preventDefault(); // don't tick the box just by opening the details
    if (consentDlg.showModal) consentDlg.showModal(); else consentDlg.setAttribute('open', '');
  });
  function closeConsent() { if (consentDlg.close) consentDlg.close(); else consentDlg.removeAttribute('open'); }
  $('consentClose').addEventListener('click', closeConsent);
  consentDlg.addEventListener('click', function (e) { if (e.target === consentDlg) closeConsent(); }); // tap outside
  $('consentAgree').addEventListener('click', function () {
    $('photoOk').checked = true;
    $('photoOk').dispatchEvent(new Event('change'));
    closeConsent();
  });

  $('toPay').addEventListener('click', function () {
    var err = $('chooseError');
    if (!state.slotId) { showError(err, 'Pick a time first.'); return; }
    if (!state.photoOk) { $('consentRow').classList.add('bk-nudge'); $('photoOk').focus(); showError(err, CONSENT_MSG); return; }
    var btn = this;
    btn.disabled = true;
    showError(err, '');
    API.call('createHold', {
      slotId: state.slotId, children: state.children, extraParent: state.extraParent, giftQty: giftQty(),
      previousBookingId: state.hold ? state.hold.bookingId : undefined
    }).then(function (res) {
      btn.disabled = false;
      if (!res.ok) {
        if (res.code === 'SOLD_OUT') {
          var s = slotById(state.slotId); if (s) s.soldOut = true;
          state.slotId = null; renderChoose();
        }
        showError(err, res.error);
        return;
      }
      state.hold = res;
      state.result = null;
      go('pay');
    });
  });

  /* ---------------- step 2: pay ---------------- */
  var timer = null;
  function renderPay() {
    var h = state.hold;
    if (!h) return go('choose');
    fill('bookingId', h.bookingId);
    fill('total', P.rupees(h.amounts.total));
    fill('slotLine', h.slot.label + ' · ' + h.slot.time + ' · ' + cfg.EVENT_DATE);
    document.querySelectorAll('[data-lines="server"]').forEach(function (dl) { renderLines(dl, h.amounts); });
    $('upiId').textContent = h.upi.id;
    $('upiLink').href = h.upi.uri;
    try {
      var qr = qrcode(0, 'M');
      qr.addData(h.upi.uri);
      qr.make();
      $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true, title: 'UPI QR code for ' + P.rupees(h.amounts.total) });
      $('qr').setAttribute('aria-label', 'UPI QR code to pay ' + P.rupees(h.amounts.total) + ' to ' + h.upi.id);
    } catch (e) {
      $('qr').textContent = 'QR code unavailable. Pay to the UPI ID instead.';
    }
    startCountdown();
  }

  function startCountdown() {
    clearInterval(timer);
    var end = new Date(state.hold.holdExpiresAt).getTime();
    function tick() {
      var left = Math.max(0, end - Date.now());
      var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      $('countdown').textContent = m + ':' + (s < 10 ? '0' : '') + s;
      $('holdExpired').hidden = left > 0;
      if (left <= 0) clearInterval(timer);
    }
    tick();
    timer = setInterval(tick, 1000);
  }

  $('copyUpi').addEventListener('click', function () {
    var btn = this;
    var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(state.hold.upi.id).then(done, done); else done();
  });
  $('paid').addEventListener('click', function () { go('details'); });
  $('changeBooking').addEventListener('click', function () {
    if (state.hold) API.call('cancelHold', { bookingId: state.hold.bookingId });
    state.hold = null;
    clearInterval(timer);
    go('choose');
    loadAvailability();
  });

  /* ---------------- step 3: details ---------------- */
  function renderDetails() {
    var h = state.hold;
    if (!h) return go('choose');
    fill('total', P.rupees(h.amounts.total));
    fill('slotTime', h.slot.time);
    fill('admit', admitLabel(h.amounts.children, h.amounts.extraParent));
    var box = $('childFields');
    var n = h.amounts.children;
    if (box.children.length !== n) {
      var old = Array.prototype.map.call(box.querySelectorAll('input'), function (i) { return i.value; });
      box.innerHTML = '';
      for (var i = 0; i < n; i++) {
        var f = document.createElement('div'); f.className = 'bk-field';
        var lab = document.createElement('label'); lab.htmlFor = 'child' + i; lab.textContent = n === 1 ? "Child's name" : 'Child ' + (i + 1) + "'s name";
        var inp = document.createElement('input'); inp.id = 'child' + i; inp.maxLength = 60; inp.required = true; inp.autocomplete = 'off'; inp.value = old[i] || '';
        f.appendChild(lab); f.appendChild(inp); box.appendChild(f);
      }
    }
  }

  $('phone').addEventListener('input', function (e) { e.target.value = e.target.value.replace(/[^\d ]/g, '').slice(0, 14); });
  $('utr').addEventListener('input', function (e) { e.target.value = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 35); });

  function readShot(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) return reject('Please choose an image file.');
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1600, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve({ name: file.name, mimeType: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1], previewUrl: url, img: img });
      };
      img.onerror = function () {
        if (file.size > 5 * 1024 * 1024) return reject('That image is too large. Please use one under 5 MB.');
        var fr = new FileReader();
        fr.onload = function () { resolve({ name: file.name, mimeType: file.type, data: String(fr.result).split(',')[1], previewUrl: '' }); };
        fr.onerror = function () { reject('We could not read that file.'); };
        fr.readAsDataURL(file);
      };
      img.src = url;
    });
  }

  /* Screenshot check: payee name, today's date, and a time close to now. */
  var checkSeq = 0;
  function showCheck(check) {
    var box = $('shotCheck');
    box.dataset.state = check.status;
    $('shotCheckText').textContent = check.message;
    $('shotPreview').classList.toggle('is-fail', check.status === 'fail');
  }
  function checkShot(shot) {
    var seq = ++checkSeq;
    shot.check = { status: 'checking', message: 'Checking the date and time on your screenshot…' };
    showCheck(shot.check);
    var opts = {
      payeeNames: cfg.PAYEE_NAMES || [], upiId: cfg.UPI_ID, toleranceMinutes: cfg.SCREENSHOT_TOLERANCE_MINUTES || 15,
      expectedAmount: state.hold && state.hold.amounts.total
    };
    var job = shot.img ? LH_SHOTCHECK.read(shot.img, opts) : Promise.resolve({
      status: 'unreadable', shows: '', minutesOff: null, problems: ['NOT_AN_IMAGE'], checkedAt: new Date().toISOString(),
      message: "We couldn't check this file automatically. You can still continue and we'll check it by hand.", summary: 'Not checked (file could not be read)'
    });
    job.then(function (res) {
      if (seq !== checkSeq || state.shot !== shot) return;
      shot.check = res;
      showCheck(res);
    });
  }
  ['pointerdown', 'focusin'].forEach(function (ev) { $('uploadBox').addEventListener(ev, function () { LH_SHOTCHECK.warmUp(); }, { once: true }); });

  $('shot').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    readShot(file).then(function (shot) {
      state.shot = shot;
      $('shotImg').src = shot.previewUrl || '';
      $('shotName').textContent = file.name;
      $('shotPreview').hidden = false;
      $('uploadBox').hidden = true;
      showError($('detailsError'), '');
      checkShot(shot);
    }, function (msg) { showError($('detailsError'), msg); });
    e.target.value = '';
  });
  function clearShot() {
    checkSeq++;
    state.shot = null;
    $('shotPreview').hidden = true;
    $('shotPreview').classList.remove('is-fail');
    $('uploadBox').hidden = false;
  }
  $('shotRemove').addEventListener('click', clearShot);

  function validate() {
    var name = $('parentName').value.trim();
    var email = $('email').value.trim();
    var phone = $('phone').value.replace(/\D/g, '');
    var kids = Array.prototype.map.call($('childFields').querySelectorAll('input'), function (i) { return i.value.trim(); });
    var utr = $('utr').value.trim();
    var bad = function (id, msg) { var el = $(id); if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); } return msg; };
    document.querySelectorAll('#detailsForm [aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
    if (name.length < 2) return bad('parentName', "Add the parent's name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad('email', 'Add a valid email address.');
    if (!/^[6-9]\d{9}$/.test(phone)) return bad('phone', 'Add a 10-digit mobile number.');
    for (var i = 0; i < kids.length; i++) if (!kids[i]) return bad('child' + i, kids.length === 1 ? "Add your child's name." : "Add each child's name.");
    if (utr && utr.length < 12) return bad('utr', 'The UPI transaction ID should be at least 12 characters.');
    if (!utr && !state.shot) return bad('utr', 'Add your UPI transaction ID or upload the payment screenshot.');
    if (state.shot && state.shot.check && state.shot.check.status === 'checking') return "Hold on, we're still checking your screenshot.";
    if (state.shot && state.shot.check && state.shot.check.status === 'fail') {
      $('shotRemove').focus();
      return "This screenshot doesn't look like the payment you just made. Upload the right one, or remove it and type the UPI transaction ID.";
    }
    return { parentName: name, email: email, phone: phone, childNames: kids, utr: utr };
  }

  $('detailsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('detailsError');
    var v = validate();
    if (typeof v === 'string') { showError(err, v); return; }
    var btn = $('submitDetails');
    btn.disabled = true;
    btn.firstChild.textContent = 'Sending… ';
    showError(err, '');
    var payload = Object.assign({ bookingId: state.hold.bookingId }, v);
    if (state.shot) {
      payload.screenshot = { name: state.shot.name, mimeType: state.shot.mimeType, data: state.shot.data };
      var c = state.shot.check || {};
      payload.screenshotCheck = { status: c.status, shows: c.shows || '', summary: c.summary || '', minutesOff: c.minutesOff, checkedAt: c.checkedAt };
    }
    API.call('submitBooking', payload).then(function (res) {
      btn.disabled = false;
      btn.firstChild.textContent = 'Get my ticket';
      if (!res.ok) { showError(err, res.error); return; }
      state.result = {
        bookingId: res.bookingId, amounts: res.amounts, slotTime: state.hold.slot.time,
        parentName: v.parentName, childNames: v.childNames.join(', '),
        phone: '+91 ' + v.phone.slice(0, 5) + ' ' + v.phone.slice(5),
        paymentRef: v.utr ? 'UPI ref ' + v.utr : 'Screenshot uploaded'
      };
      clearInterval(timer);
      go('done');
    });
  });
  $('backToPay').addEventListener('click', function () { go('pay'); });

  /* ---------------- step 4: done ---------------- */
  function renderDone() {
    var r = state.result;
    if (!r) return go('choose');
    fill('bookingId', r.bookingId);
    fill('admit', admitLabel(r.amounts.children, r.amounts.extraParent));
    fill('slotTime', r.slotTime);
    fill('parentName', r.parentName);
    fill('childNames', r.childNames);
    fill('phone', r.phone);
    fill('paymentRef', r.paymentRef);
    fill('total', P.rupees(r.amounts.total));
    document.querySelectorAll('#step-done [data-lines="server"]').forEach(function (dl) { renderLines(dl, r.amounts); });
  }
  $('bookAnother').addEventListener('click', function () {
    state.hold = null; state.result = null; state.shot = null; state.slotId = null;
    state.children = 1; state.extraParent = false; state.giftOn = true; state.giftQty = 1; state.giftTouched = false;
    $('detailsForm').reset();
    clearShot();
    go('choose');
    loadAvailability();
  });

  /* ---------------- start ---------------- */
  var start = state.result ? 'done' : (state.hold ? (state.step === 'details' ? 'details' : 'pay') : 'choose');
  go(start, { quiet: true });
  if (start === 'choose') loadAvailability();
  else API.call('availability').then(function (res) { if (res.ok) state.slots = res.slots; });
})();
