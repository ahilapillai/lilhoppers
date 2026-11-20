/* Talks to the Apps Script backend. With no API_URL set, a demo backend in this browser stands in (nothing is saved). */
(function () {
  var cfg = window.LH_CONFIG;
  var P = window.LH_PRICING;
  var demo = !cfg.API_URL;

  function call(action, payload) {
    var body = Object.assign({ action: action }, payload || {});
    if (demo) return Promise.resolve(demoCall(body));
    return fetch(cfg.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, code: 'NETWORK', error: "We couldn't reach the booking system. Check your connection and try again." }; });
  }

  /* ---------------- demo backend (same rules as the real one) ---------------- */
  var KEY = 'lh_demo_db_v1';
  var SLOTS = [
    { id: 'S1', label: 'Slot 1', time: '2:00 PM – 3:30 PM', capacity: 32 },
    { id: 'S2', label: 'Slot 2', time: '4:00 PM – 5:30 PM', capacity: 33 },
    { id: 'S3', label: 'Slot 3', time: '6:00 PM – 7:30 PM', capacity: 35 }
  ];
  function load() {
    try { var d = JSON.parse(localStorage.getItem(KEY)); if (d && d.slots) return d; } catch (e) {}
    return { slots: JSON.parse(JSON.stringify(SLOTS)), bookings: [] };
  }
  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {
      // Browser storage is small: keep the screenshots of the newest 3 bookings only.
      var withShots = db.bookings.filter(function (b) { return /^data:/.test(b.screenshotUrl); });
      withShots.slice(0, -3).forEach(function (b) { b.screenshotUrl = '#demo-screenshot-removed'; });
      try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e2) {}
    }
  }
  var CHECK_LABEL = { pass: 'Passed', unreadable: "Couldn't read", fail: 'Failed' };
  /* Same rules as checkFromPayload_() in Code.gs. */
  function checkFields(p) {
    if (!(p.screenshot && p.screenshot.data)) return { screenshotCheck: '', screenshotShows: '', screenshotCheckNote: '' };
    var c = p.screenshotCheck || {};
    return {
      screenshotCheck: CHECK_LABEL[c.status] || 'Not checked',
      screenshotShows: String(c.shows || '').slice(0, 60),
      screenshotCheckNote: String(c.summary || '').slice(0, 300)
    };
  }
  function live(b, now) { return b.status === 'Awaiting Payment' && new Date(b.holdExpiresAt).getTime() > now; }
  function usage(db, now) {
    var u = {};
    db.slots.forEach(function (s) { u[s.id] = { verified: 0, pending: 0, holds: 0, total: 0 }; });
    db.bookings.forEach(function (b) {
      var x = u[b.slotId]; if (!x) return;
      if (b.status === 'Verified') x.verified += b.children;
      else if (b.status === 'Pending Verification') x.pending += b.children;
      else if (live(b, now)) x.holds += b.children;
    });
    Object.keys(u).forEach(function (k) { u[k].total = u[k].verified + u[k].pending + u[k].holds; });
    return u;
  }
  function expire(db, now) { db.bookings.forEach(function (b) { if (b.status === 'Awaiting Payment' && !live(b, now)) b.status = 'Abandoned'; }); }
  function find(db, id) { return db.bookings.filter(function (b) { return b.bookingId === id; })[0]; }

  function entryPass(db, b) {
    var slot = db.slots.filter(function (x) { return x.id === b.slotId; })[0];
    var extra = b.extraParent === 'Yes';
    var verdict = b.status === 'Verified' ? (b.checkedInAt ? 'already' : 'valid') : b.status === 'Pending Verification' ? 'pending' : b.status === 'Rejected' ? 'rejected' : 'unpaid';
    return { bookingId: b.bookingId, verdict: verdict, status: b.status, parentName: b.parentName || '', childNames: b.childNames || '',
      children: b.children, parentsIncluded: b.children, extraParent: extra, grownUps: b.children + (extra ? 1 : 0), giftQty: b.giftQty || 0,
      slotId: b.slotId, slotLabel: slot ? slot.label : '', slotTime: b.slotTime, checkedInAt: b.checkedInAt || '' };
  }

  function demoCall(p) {
    var db = load(), now = Date.now(), out;
    var isAdmin = /^admin/.test(p.action);
    var isStaff = /^(staffCheck|checkin)/.test(p.action);
    if ((isAdmin || isStaff) && p.passcode !== 'demo') return { ok: false, code: 'UNAUTHORISED', error: 'Wrong passcode. In demo mode the passcode is "demo".' };
    if (p.action === 'availability') {
      var u0 = usage(db, now);
      out = { ok: true, prices: cfg.PRICES, maxChildren: cfg.MAX_CHILDREN, holdMinutes: cfg.HOLD_MINUTES,
        slots: db.slots.map(function (s) { return { id: s.id, label: s.label, time: s.time, soldOut: u0[s.id].total >= s.capacity }; }) };
    } else if (p.action === 'createHold') {
      var slot = db.slots.filter(function (s) { return s.id === p.slotId; })[0];
      var n = Number(p.children), g = Number(p.giftQty || 0);
      if (!slot) return { ok: false, code: 'BAD_SLOT', error: 'Please choose a slot.' };
      if (!(n >= 1 && n <= cfg.MAX_CHILDREN) || !(g >= 0 && g <= n)) return { ok: false, code: 'BAD_INPUT', error: 'Check the number of children and gifts.' };
      // Email and phone come before the QR (same rules as the backend).
      var em = String(p.email || '').trim(), ph = String(p.phone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
      if (p.email !== undefined || p.phone !== undefined) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return { ok: false, code: 'BAD_EMAIL', error: 'Add a valid email address.' };
        if (!/^[6-9]\d{9}$/.test(ph)) return { ok: false, code: 'BAD_PHONE', error: 'Add a 10-digit mobile number.' };
      }
      expire(db, now);
      var prev = p.previousBookingId ? find(db, p.previousBookingId) : null;
      if (prev && prev.status !== 'Awaiting Payment') prev = null;
      if (prev) prev.status = 'Abandoned';
      var used = usage(db, now)[slot.id].total;
      if (prev) prev.status = 'Awaiting Payment';
      if (used >= slot.capacity) { save(db); return { ok: false, code: 'SOLD_OUT', error: slot.label + ' is sold out. Please choose another slot.' }; }
      if (used + n > slot.capacity) { save(db); return { ok: false, code: 'NOT_ENOUGH_PLACES', error: "There aren't enough places left in " + slot.label + ' for ' + n + ' children. Try another slot or fewer children.' }; }
      var a = P.computeAmounts(cfg.PRICES, n, p.extraParent === true, g);
      if (prev) db.bookings.splice(db.bookings.indexOf(prev), 1);
      var id = prev ? prev.bookingId : 'LH-DEMO' + Math.floor(100 + Math.random() * 900);
      var b = { bookingId: id, createdAt: new Date(now).toISOString(), slotId: slot.id, slotTime: slot.time, children: n, childNames: '', parentName: '', email: em, phone: ph,
        extraParent: a.extraParent ? 'Yes' : 'No', extraParentCharge: a.extraParentCharge, ticketSubtotal: a.ticketSubtotal, giftQty: a.giftQty, giftSubtotal: a.giftSubtotal,
        expectedTotal: a.total, utr: '', screenshotUrl: '', status: 'Awaiting Payment', paymentStatus: 'Not paid', verifiedAmount: '', verifiedAt: '',
        holdExpiresAt: new Date(now + cfg.HOLD_MINUTES * 60000).toISOString(), submittedAt: '', rejectionReason: '', adminNotes: '' };
      db.bookings.push(b);
      out = { ok: true, bookingId: id, slot: { id: slot.id, label: slot.label, time: slot.time }, amounts: a, holdExpiresAt: b.holdExpiresAt,
        upi: { id: cfg.UPI_ID, payee: cfg.UPI_PAYEE, uri: P.upiUri(cfg.UPI_ID, cfg.UPI_PAYEE, a.total, id) } };
    } else if (p.action === 'cancelHold') {
      var c = find(db, p.bookingId); if (c && c.status === 'Awaiting Payment') c.status = 'Abandoned';
      out = { ok: true };
    } else if (p.action === 'submitBooking') {
      var s = find(db, p.bookingId);
      if (!s) return { ok: false, code: 'NOT_FOUND', error: 'We could not find this booking. Please start again.' };
      if (!(p.screenshot && p.screenshot.data)) return { ok: false, code: 'NO_PROOF', error: 'Upload the screenshot of your payment.' };
      if (p.screenshot && p.screenshot.data && p.screenshotCheck && p.screenshotCheck.status === 'fail') return { ok: false, code: 'SCREENSHOT_MISMATCH', error: "This doesn't look like a payment to Lil' Hoppers. Please upload the screenshot of the payment you just made." };
      if (s.status === 'Awaiting Payment' || s.status === 'Abandoned') {
        s.parentName = p.parentName; s.email = p.email; s.phone = String(p.phone).replace(/\D/g, '').slice(-10);
        s.childNames = (p.childNames || []).join(', '); s.utr = p.utr || ''; s.screenshotUrl = p.screenshot ? 'data:' + p.screenshot.mimeType + ';base64,' + p.screenshot.data : '';
        Object.assign(s, checkFields(p));
        s.status = 'Pending Verification'; s.paymentStatus = 'Pending'; s.submittedAt = new Date(now).toISOString();
      }
      out = { ok: true, bookingId: s.bookingId, status: s.status, paymentStatus: s.paymentStatus, slot: { id: s.slotId, time: s.slotTime },
        amounts: P.computeAmounts(cfg.PRICES, s.children, s.extraParent === 'Yes', s.giftQty) };
    } else if (p.action === 'adminList') {
      var u1 = usage(db, now), tc = 0, tt = 0;
      out = { ok: true, prices: cfg.PRICES, slots: db.slots.map(function (sl) {
        var x = u1[sl.id]; tc += sl.capacity; tt += x.total;
        var arrived = db.bookings.reduce(function (n, bk) { return n + (bk.slotId === sl.id && bk.status === 'Verified' && bk.checkedInAt ? bk.children : 0); }, 0);
        return { id: sl.id, label: sl.label, time: sl.time, capacity: sl.capacity, verified: x.verified, pending: x.pending, holds: x.holds, total: x.total, arrived: arrived, soldOut: x.total >= sl.capacity };
      }), bookings: db.bookings.slice().reverse().map(function (bk) {
        var copy = Object.assign({}, bk); if (copy.status === 'Awaiting Payment' && !live(copy, now)) copy.status = 'Abandoned (hold expired)'; return copy;
      }) };
      out.totals = { capacity: tc, counted: tt };
      out.checkin = { url: location.origin + '/checkin', passcode: 'demo' };
    } else if (p.action === 'adminVerify') {
      var v = find(db, p.bookingId);
      if (!v || v.status !== 'Pending Verification') return { ok: false, code: 'BAD_STATE', error: 'Only bookings that are Pending Verification can be verified.' };
      v.status = 'Verified'; v.paymentStatus = 'Verified'; v.verifiedAmount = Number(p.verifiedAmount); v.verifiedAt = new Date(now).toISOString();
      if (p.note) v.adminNotes = (v.adminNotes ? v.adminNotes + '\n' : '') + p.note;
      out = { ok: true, emailSent: false, warning: 'Demo mode: no email was sent.' };
    } else if (p.action === 'adminReject') {
      var r = find(db, p.bookingId);
      if (!r) return { ok: false, code: 'NOT_FOUND', error: 'Booking not found.' };
      if (!String(p.reason || '').trim()) return { ok: false, code: 'NO_REASON', error: 'Add a reason for rejecting.' };
      r.status = 'Rejected'; r.paymentStatus = 'Rejected'; r.rejectionReason = p.reason;
      out = { ok: true };
    } else if (p.action === 'adminUpdateCapacity') {
      var cap = Number(p.capacity), sl2 = db.slots.filter(function (x) { return x.id === p.slotId; })[0];
      if (!sl2 || !(cap >= 0 && cap <= 1000 && Math.floor(cap) === cap)) return { ok: false, code: 'BAD_CAPACITY', error: 'Capacity must be a whole number from 0 to 1000.' };
      sl2.capacity = cap; out = { ok: true };
    } else if (p.action === 'staffCheck') {
      out = { ok: true };
    } else if (isStaff) {
      // Same rules as the check-in API in Code.gs.
      var m = String(p.bookingId || '').toUpperCase().match(/LH-[A-Z0-9]{3,12}/);
      if (!m) return { ok: false, code: 'BAD_ID', error: "That doesn't look like a booking ID. It starts with LH-." };
      var c = find(db, m[0]);
      if (!c) return { ok: false, code: 'NOT_FOUND', error: 'No booking found for ' + m[0] + '.' };
      if (p.action === 'checkin') {
        if (c.status !== 'Verified') return { ok: false, code: 'NOT_CONFIRMED', error: "This booking isn't confirmed, so it can't be checked in.", pass: entryPass(db, c) };
        if (c.checkedInAt) return { ok: true, already: true, pass: entryPass(db, c) };
        c.checkedInAt = new Date(now).toISOString();
        out = { ok: true, pass: Object.assign(entryPass(db, c), { verdict: 'checkedIn' }) };
      } else {
        if (p.action === 'checkinUndo') c.checkedInAt = '';
        out = { ok: true, pass: entryPass(db, c) };
      }
    } else {
      return { ok: false, code: 'BAD_ACTION', error: 'Unknown action.' };
    }
    save(db);
    return out;
  }

  window.LH_API = { call: call, demo: demo };
})();
