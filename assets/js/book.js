/* Booking flow: choose & pay (choices + UPI QR on one page) → details + proof → ticket. */
(function () {
  var cfg = window.LH_CONFIG;
  var P = window.LH_PRICING;
  var API = window.LH_API;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'lh_booking_v1';
  var STEPS = ['choose', 'details', 'done'];
  // Analytics (assets/js/analytics.js): booking steps as GA4 events, and markers in session recordings.
  var T = window.LH_TRACK || { track: function () {}, once: function () {}, tag: function () {}, order: function () { return {}; } };

  LH_FESTIVE.fillTemplates(document, LH_FESTIVE.generate());
  if (API.demo) $('demoBanner').hidden = false;

  var state = {
    step: 'choose', slots: [], slotId: null, children: 1, extraParent: false,
    giftOn: false, giftQty: 1, giftTouched: false, photoOk: true, hold: null, holdStale: false, result: null, shot: null,
    email: '', phone: ''
  };
  try {
    var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved && (saved.hold || saved.result)) Object.assign(state, saved);
    else if (saved) { state.email = saved.email || ''; state.phone = saved.phone || ''; } // keep the contact typed so far
  } catch (e) { /* ignore */ }
  state.email = state.email || ''; state.phone = state.phone || '';

  function persist() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        step: state.step, slotId: state.slotId, children: state.children, extraParent: state.extraParent,
        giftOn: state.giftOn, giftQty: state.giftQty, giftTouched: state.giftTouched, hold: state.hold, holdStale: state.holdStale, result: state.result,
        email: state.email, phone: state.phone
      }));
    } catch (e) { /* private mode */ }
  }

  /* ---------------- helpers ---------------- */
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function admitLabel(children, extraParent) {
    return plural(children, 'kid', 'kids') + ' + ' + plural(children + (extraParent ? 1 : 0), 'parent', 'parents');
  }
  function giftQty() { return state.giftOn ? state.giftQty : 0; }
  // The server's prices win (from 'availability'), so the summary always matches the amount in the QR.
  function localAmounts() { return P.computeAmounts(state.prices || cfg.PRICES, state.children, state.extraParent, giftQty()); }
  function slotById(id) { return state.slots.filter(function (s) { return s.id === id; })[0]; }
  function showError(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }

  function renderLines(dl, a) {
    var rows = [[plural(a.children, 'kid', 'kids') + ' + ' + plural(a.children, 'parent', 'parents'), P.rupees(a.discount ? a.ticketsAtFull : a.ticketSubtotal)]];
    if (a.extraParent) rows.push(['Extra parent', P.rupees(a.extraParentCharge)]);
    if (a.giftQty) rows.push(['Gift from Santa × ' + a.giftQty, P.rupees(a.giftSubtotal)]);
    if (a.bookingFee) rows.push(['Booking & support fee', P.rupees(a.bookingFee)]);
    // Group deal, applied automatically: shown last, just above the total.
    if (a.discount) rows.push(['Code ' + a.couponCode + ' auto-applied', '−' + P.rupees(a.discount), 'bk-line-deal']);
    dl.innerHTML = '';
    rows.forEach(function (r) {
      var d = document.createElement('div');
      if (r[2]) d.className = r[2];
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
    T.tag('booking_step', step);
    STEPS.forEach(function (s) { $('step-' + s).hidden = s !== step; });
    var idx = STEPS.indexOf(step);
    document.querySelectorAll('.bk-steps li').forEach(function (li, i) {
      li.classList.toggle('is-current', i === idx);
      li.classList.toggle('is-done', i < idx);
      if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (step === 'details') renderDetails();
    if (step === 'done') renderDone();
    if (step === 'choose') renderChoose();
    if (!(opts && opts.quiet)) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      var h = $('step-' + step).querySelector('h1');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }

  /* ---------------- step 1: choose & pay ---------------- */
  // A live hold is one the server is holding for the current choices. After a change that couldn't be
  // held (e.g. not enough places), the hold is "stale": the QR is hidden until they tap Pay again.
  function live() { return !!(state.hold && !state.holdStale); }
  function mySlot(id) { return live() && state.hold.slot.id === id; }

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
      if (res.prices) state.prices = res.prices;
      var sel = slotById(state.slotId);
      if (sel && sel.soldOut && !mySlot(sel.id)) state.slotId = null;
      renderChoose();
      if (state.step === 'choose') T.once('view_item', T.order(localAmounts(), {}));
    });
  }

  function renderSlots() {
    var box = $('slotList');
    if (!state.slots.length) return;
    box.innerHTML = '';
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', 'Time slots');
    state.slots.forEach(function (s) {
      var sold = s.soldOut && !mySlot(s.id); // the places they're holding don't count against them
      var label = document.createElement('label');
      label.className = 'bk-slot' + (sold ? ' is-sold' : '');
      var input = document.createElement('input');
      input.type = 'radio'; input.name = 'slot'; input.value = s.id;
      input.disabled = !!sold;
      input.checked = state.slotId === s.id;
      input.addEventListener('change', function () {
        state.slotId = s.id; showError($('chooseError'), ''); changed(true);
        T.track('slot_select', { slot: s.label });
        T.once('add_to_cart', T.order(localAmounts(), { slot: s.label }));
      });
      var name = document.createElement('span'); name.className = 'bk-slot-name'; name.textContent = s.label;
      var time = document.createElement('span'); time.className = 'bk-slot-time'; time.textContent = String(s.time).replace(/^(\d{1,2}:\d{2}) (AM|PM) – (.+ \2)$/, '$1 – $3');
      label.appendChild(input); label.appendChild(name); label.appendChild(time);
      if (sold) {
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
    renderDeal(n);
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
    renderSummary();
  }

  /* Group deals, under "1 kid + 1 parent": what's applied now, and what the next one is. */
  function renderDeal(n) {
    var prices = state.prices || cfg.PRICES;
    var deals = (prices.GROUP_DEALS || []).slice().sort(function (a, b) { return a.minChildren - b.minChildren; });
    var box = $('kidsDeal');
    if (!deals.length) { box.hidden = true; return; }
    var now = P.groupDeal(prices, n);
    var next = deals.filter(function (d) { return d.minChildren > n && (!now || d.childPrice < now.childPrice); })[0];
    var parts = [];
    if (now) parts.push('<strong>' + esc(now.code) + '</strong> applied: ' + P.rupees(now.childPrice) + ' per child');
    if (next) parts.push((now ? '' : 'Book ') + next.minChildren + '+ kids for ' + P.rupees(next.childPrice) + ' each' + (now ? '' : ' (' + esc(next.code) + ')'));
    box.innerHTML = parts.join(' · ');
    box.classList.toggle('is-on', !!now);
    box.hidden = !parts.length;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function renderSummary() {
    var a = localAmounts();
    renderLines($('chooseLines'), a);
    $('chooseTotal').textContent = P.rupees(a.total);
    $('toPayAmount').textContent = P.rupees(a.total);
    var s = slotById(state.slotId);
    $('chooseSlotLine').hidden = !s;
    if (s) $('chooseSlotLine').textContent = s.label + ' · ' + s.time + ' · ' + cfg.EVENT_DATE;
    renderPayPanel();
  }

  /* Any change to the choices. Once they're paying, the hold (and the QR) follows the change. */
  function changed(slotOnly) {
    persist();
    if (slotOnly) renderSummary(); else renderChoose();
    if (live()) scheduleRehold();
  }

  function setChildren(n) {
    n = Math.max(1, Math.min(cfg.MAX_CHILDREN, n));
    state.children = n;
    if (!state.giftTouched || state.giftQty > n) state.giftQty = n;
    changed();
  }

  $('kidsMinus').addEventListener('click', function () { setChildren(state.children - 1); T.track('kids_change', { children: state.children }); });
  $('kidsPlus').addEventListener('click', function () { setChildren(state.children + 1); T.track('kids_change', { children: state.children }); });
  $('extraParent').addEventListener('change', function (e) { state.extraParent = e.target.checked; changed(); if (e.target.checked) T.track('add_extra_parent'); });
  $('giftOn').addEventListener('change', function (e) { state.giftOn = e.target.checked; changed(); if (e.target.checked) T.track('add_santa_gift'); });
  $('giftQty').addEventListener('change', function (e) { state.giftQty = Number(e.target.value); state.giftTouched = true; changed(); });

  $('photoOk').addEventListener('change', function (e) {
    state.photoOk = e.target.checked;
    if (!state.photoOk) T.track('consent_unticked');
    $('consentRow').classList.remove('bk-nudge');
    if (state.photoOk && $('chooseError').textContent === CONSENT_MSG) showError($('chooseError'), '');
  });
  var CONSENT_MSG = 'Tick the box above to continue.';
  function needConsent() {
    if (state.photoOk) return false;
    T.track('booking_error', { step: state.step, reason: 'no_consent' });
    $('consentRow').classList.add('bk-nudge'); $('photoOk').focus(); showError($('chooseError'), CONSENT_MSG);
    return true;
  }

  // "photo consent" opens the details: a popup on desktop, a bottom sheet on phones (CSS decides).
  var consentDlg = $('consentDlg');
  $('consentInfo').addEventListener('click', function (e) {
    e.preventDefault(); // don't tick the box just by opening the details
    T.track('consent_info_open');
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

  /* Contact: email and phone are needed before the QR, so every booking that might get paid can be
     confirmed (or followed up) even if the parent closes the page after paying. */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function phoneDigits(v) { var d = String(v || '').replace(/\D/g, ''); return d.length === 12 && d.indexOf('91') === 0 ? d.slice(2) : d; }
  function prettyPhone(d) { return d.length > 5 ? d.slice(0, 5) + ' ' + d.slice(5) : d; }
  var CONTACT_MSGS = { email: 'Add a valid email address.', phone: 'Add a 10-digit mobile number.' };
  function contactProblem() {
    if (!EMAIL_RE.test(state.email) || state.email.length > 120) return 'email';
    if (!/^[6-9]\d{9}$/.test(state.phone)) return 'phone';
    return '';
  }
  function needContact() {
    var id = contactProblem();
    if (!id) return false;
    T.track('booking_error', { step: state.step, reason: id });
    $(id).setAttribute('aria-invalid', 'true'); $(id).focus();
    showError($('chooseError'), CONTACT_MSGS[id]);
    return true;
  }
  $('email').value = state.email;
  $('phone').value = prettyPhone(state.phone);
  $('email').addEventListener('input', function (e) { state.email = e.target.value.trim(); contactEdited(e.target); });
  $('phone').addEventListener('input', function (e) {
    e.target.value = e.target.value.replace(/[^\d +]/g, '').slice(0, 16);
    state.phone = phoneDigits(e.target.value); contactEdited(e.target);
  });
  function contactEdited(el) {
    el.removeAttribute('aria-invalid');
    var err = $('chooseError');
    if (err.textContent === CONTACT_MSGS.email || err.textContent === CONTACT_MSGS.phone) showError(err, '');
    persist();
  }

  /* Holding places: "Pay" asks for a hold; later changes update the same booking. */
  var holdSeq = 0, reholdTimer = null;
  function setUpdating(on) {
    $('payPanel').classList.toggle('is-updating', on);
    $('payUpdating').hidden = !on;
    $('paid').disabled = on;
  }
  function scheduleRehold() {
    setUpdating(true);
    clearTimeout(reholdTimer);
    reholdTimer = setTimeout(requestHold, 450);
  }
  function requestHold() {
    var err = $('chooseError');
    var seq = ++holdSeq;
    var first = !live();
    if (first) $('toPay').disabled = true;
    API.call('createHold', {
      slotId: state.slotId, children: state.children, extraParent: state.extraParent, giftQty: giftQty(),
      email: state.email, phone: state.phone,
      previousBookingId: state.hold ? state.hold.bookingId : undefined
    }).then(function (res) {
      if (seq !== holdSeq) return; // a newer change has been sent since
      $('toPay').disabled = false;
      setUpdating(false);
      if (!res.ok) {
        T.track('booking_error', { step: first ? 'hold' : 'update', reason: res.code || 'error' });
        if (res.code === 'BAD_EMAIL' || res.code === 'BAD_PHONE') { var f = $(res.code === 'BAD_EMAIL' ? 'email' : 'phone'); f.setAttribute('aria-invalid', 'true'); f.focus(); }
        if (res.code === 'SOLD_OUT') { var s = slotById(state.slotId); if (s) s.soldOut = true; state.slotId = null; }
        if (state.hold) state.holdStale = true;
        persist();
        renderChoose();
        showError(err, res.error);
        return;
      }
      state.hold = res;
      state.holdStale = false;
      state.result = null;
      // First hold = the QR is on screen: 'begin_checkout'. Later changes while paying: 'update_order'.
      if (first) T.track('begin_checkout', T.order(res.amounts, { slot: res.slot.label }));
      else T.track('update_order', { currency: 'INR', value: res.amounts.total });
      showError(err, '');
      persist();
      renderSummary();
      if (first) $('payPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  $('toPay').addEventListener('click', function () {
    if (!state.slotId) { showError($('chooseError'), 'Pick a time first.'); T.track('booking_error', { step: 'choose', reason: 'no_slot' }); return; }
    if (needContact()) return;
    if (needConsent()) return;
    showError($('chooseError'), '');
    requestHold();
  });

  var timer = null, shownUri = null;
  function renderPayPanel() {
    var on = live();
    $('payPanel').hidden = !on;
    $('toPay').hidden = on;
    $('chooseCard').classList.toggle('has-pay', on);
    if (!on) { clearInterval(timer); shownUri = null; return; }
    var h = state.hold;
    fill('bookingId', h.bookingId);
    $('upiId').textContent = h.upi.id;
    $('qr').dataset.uri = h.upi.uri;
    $('payTotalNote').textContent = P.rupees(h.amounts.total);
    if (shownUri !== h.upi.uri) {
      shownUri = h.upi.uri;
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
  }

  function startCountdown() {
    clearInterval(timer);
    var end = new Date(state.hold.holdExpiresAt).getTime();
    function tick() {
      var left = Math.max(0, end - Date.now());
      var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      $('countdown').textContent = m + ':' + (s < 10 ? '0' : '') + s;
      $('holdExpired').hidden = left > 0;
      if (left <= 0) { clearInterval(timer); T.once('hold_expired'); }
    }
    tick();
    timer = setInterval(tick, 1000);
  }

  /* "Save QR image": UPI apps refuse payment links to a personal UPI ID, but scanning a saved QR from the
     gallery works. Phones get the share sheet (Save Image → Photos); others download a PNG. */
  function qrPng() {
    var h = state.hold, qr = qrcode(0, 'M');
    qr.addData(h.upi.uri); qr.make();
    var n = qr.getModuleCount(), cell = 14, quiet = 4 * cell, size = n * cell + quiet * 2;
    var c = document.createElement('canvas');
    c.width = size; c.height = size + 120;
    var x = c.getContext('2d');
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#000000';
    for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) if (qr.isDark(r, k)) x.fillRect(quiet + k * cell, quiet + r * cell, cell, cell);
    x.fillStyle = '#2A1D45'; x.textAlign = 'center';
    x.font = '700 34px Nunito, Arial, sans-serif';
    x.fillText('Pay ' + P.rupees(h.amounts.total) + " to Lil' Hoppers", size / 2, size + 44);
    x.font = '600 26px Nunito, Arial, sans-serif'; x.fillStyle = '#5E5470';
    x.fillText('Booking ' + h.bookingId + ' · ' + h.upi.id, size / 2, size + 88);
    return new Promise(function (resolve) { c.toBlob(resolve, 'image/png'); });
  }
  $('saveQr').addEventListener('click', function () {
    var btn = this, name = state.hold.bookingId + '-pay.png';
    T.track('save_qr');
    qrPng().then(function (blob) {
      var file = window.File ? new File([blob], name, { type: 'image/png' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: "Lil' Hoppers payment QR" }).catch(function () {});
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      btn.textContent = 'Saved'; setTimeout(function () { btn.textContent = 'Save QR image'; }, 1800);
    });
  });

  $('copyUpi').addEventListener('click', function () {
    var btn = this;
    T.track('copy_upi_id');
    var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(state.hold.upi.id).then(done, done); else done();
  });
  $('paid').addEventListener('click', function () {
    if (needContact()) return; // edited after the QR appeared
    if (needConsent()) return;
    T.track('add_payment_info', T.order(state.hold.amounts, { payment_type: 'UPI' }));
    go('details');
  });
  $('changeBooking').addEventListener('click', function () {
    T.track('start_again');
    if (state.hold) API.call('cancelHold', { bookingId: state.hold.bookingId });
    state.hold = null;
    state.holdStale = false;
    persist();
    renderChoose();
    loadAvailability();
  });

  /* ---------------- step 2: details ---------------- */
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
      T.track('screenshot_check', { result: res.status });
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
      $('uploadBox').classList.remove('is-missing');
      showError($('detailsError'), '');
      T.track('screenshot_upload');
      checkShot(shot);
    }, function (msg) { showError($('detailsError'), msg); T.track('booking_error', { step: 'details', reason: 'unreadable_file' }); });
    e.target.value = '';
  });
  function clearShot() {
    checkSeq++;
    state.shot = null;
    $('shotPreview').hidden = true;
    $('shotPreview').classList.remove('is-fail');
    $('uploadBox').hidden = false;
  }
  $('shotRemove').addEventListener('click', function () { T.track('screenshot_remove'); clearShot(); });

  var invalid = ''; // why the last validate() failed, for analytics: the field id or the screenshot problem
  function validate() {
    invalid = '';
    var name = $('parentName').value.trim();
    var kids = Array.prototype.map.call($('childFields').querySelectorAll('input'), function (i) { return i.value.trim(); });
    var bad = function (id, msg) { invalid = id; var el = $(id); if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); } return msg; };
    document.querySelectorAll('#detailsForm [aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
    if (name.length < 2) return bad('parentName', "Add the parent's name.");
    for (var i = 0; i < kids.length; i++) if (!kids[i]) return bad('child' + i, kids.length === 1 ? "Add your child's name." : "Add each child's name.");
    if (contactProblem()) { invalid = 'contact'; return 'Add your email and phone number: tap "Back to payment" to fill them in.'; }
    if (!state.shot) { $('uploadBox').classList.add('is-missing'); return bad('shot', 'Upload the screenshot of your payment.'); }
    if (state.shot && state.shot.check && state.shot.check.status === 'checking') { invalid = 'screenshot_checking'; return "Hold on, we're still checking your screenshot."; }
    if (state.shot && state.shot.check && state.shot.check.status === 'fail') {
      $('shotRemove').focus();
      invalid = 'screenshot_not_payment';
      return "This doesn't look like a payment to Lil' Hoppers. Please upload the screenshot of the payment you just made.";
    }
    return { parentName: name, email: state.email, phone: state.phone, childNames: kids };
  }

  $('detailsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('detailsError');
    var v = validate();
    if (typeof v === 'string') { showError(err, v); T.track('booking_error', { step: 'details', reason: invalid.replace(/^child\d+$/, 'child_name') }); return; }
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
      if (!res.ok) { showError(err, res.error); T.track('booking_error', { step: 'submit', reason: res.code || 'error' }); return; }
      // Booking received (payment still to be verified by an admin).
      T.track('purchase', T.order(res.amounts, { transaction_id: res.bookingId }));
      state.result = {
        bookingId: res.bookingId, amounts: res.amounts, slotTime: state.hold.slot.time,
        parentName: v.parentName, childNames: v.childNames.join(', '),
        phone: '+91 ' + v.phone.slice(0, 5) + ' ' + v.phone.slice(5),
        paymentRef: 'Screenshot uploaded',
        verified: res.status === 'Verified'
      };
      clearInterval(timer);
      go('done');
    });
  });
  $('backToPay').addEventListener('click', function () { T.track('back_to_payment'); go('choose'); });

  /* ---------------- step 3: done ---------------- */
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
    // Already verified (the payment was matched before the details arrived): show it as confirmed.
    $('doneStatus').classList.toggle('is-ok', !!r.verified);
    $('doneStatusText').textContent = r.verified ? 'Confirmed' : 'Payment being checked';
    $('doneSub').textContent = r.verified
      ? "Your payment is verified and your booking is confirmed. Your confirmation email with the entry QR is on its way from hello.lilhoppers@gmail.com (check spam too)."
      : "We're checking your payment now. Your confirmation email will come from hello.lilhoppers@gmail.com once it's verified, so keep an eye on your inbox (and spam).";
    $('doneHelpText').textContent = r.verified ? 'Confirmed. Show the QR in your confirmation email at the entrance. ' : 'Not confirmed yet. Show your confirmation email at the entrance. ';
    document.querySelectorAll('#step-done [data-lines="server"]').forEach(function (dl) { renderLines(dl, r.amounts); });
  }
  $('bookAnother').addEventListener('click', function () {
    T.track('book_another');
    state.hold = null; state.holdStale = false; state.result = null; state.shot = null; state.slotId = null;
    state.children = 1; state.extraParent = false; state.giftOn = false; state.giftQty = 1; state.giftTouched = false;
    $('detailsForm').reset();
    clearShot();
    go('choose');
    loadAvailability();
  });

  /* ---------------- start ---------------- */
  var start = state.result ? 'done' : (live() && state.step === 'details' ? 'details' : 'choose');
  go(start, { quiet: true });
  if (start === 'choose') loadAvailability();
  else API.call('availability').then(function (res) { if (res.ok) state.slots = res.slots; });
})();
