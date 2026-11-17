/**
 * Lil' Hoppers Christmas Carnival — booking backend (Google Apps Script).
 *
 * Bind this script to the bookings Google Sheet, owned by hello.lilhoppers@gmail.com,
 * run setup() once, then deploy as a web app (Execute as: Me, Who has access: Anyone).
 * See README.md for the full steps.
 */

var CONFIG = {
  EVENT_NAME: "Lil' Hoppers Christmas Carnival",
  EVENT_DATE: 'Saturday, 19 December 2026',
  VENUE: 'Vata Vriksha, Indiranagar',
  MAPS_URL: 'https://share.google/GE3sdUk4LarPOcGPW',
  UPI_ID: 'ahilapil.26-1@okicici',
  UPI_PAYEE: 'Lil Hoppers',
  SENDER_EMAIL: 'hello.lilhoppers@gmail.com',
  SENDER_NAME: "Lil' Hoppers",
  HOLD_MINUTES: 20,
  MAX_CHILDREN: 10,
  MAX_SCREENSHOT_BYTES: 5 * 1024 * 1024,
  PRICES: { CHILD_TICKET: 899, EXTRA_PARENT: 199, SANTA_GIFT: 299 },
  SCREENSHOT_FOLDER: 'Lil Hoppers – Payment screenshots'
};

var DEFAULT_SLOTS = [
  { id: 'S1', label: 'Slot 1', time: '2:00 PM – 3:30 PM', capacity: 32 },
  { id: 'S2', label: 'Slot 2', time: '4:00 PM – 5:30 PM', capacity: 33 },
  { id: 'S3', label: 'Slot 3', time: '6:00 PM – 7:30 PM', capacity: 35 }
];

var STATUS = {
  AWAITING: 'Awaiting Payment',
  PENDING: 'Pending Verification',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  ABANDONED: 'Abandoned'
};

var PAYMENT = { NOT_PAID: 'Not paid', PENDING: 'Pending', VERIFIED: 'Verified', REJECTED: 'Rejected' };

var BOOKING_HEADERS = [
  'Booking ID', 'Created At', 'Slot ID', 'Slot Time', 'Children', 'Child Names', 'Parent Name', 'Email', 'Phone',
  'Extra Parent', 'Extra Parent Charge', 'Ticket Subtotal', 'Santa Gift Qty', 'Santa Gift Subtotal', 'Expected Total',
  'UPI Transaction ID', 'Screenshot URL', 'Status', 'Payment Status', 'Verified Amount', 'Verified At',
  'Hold Expires At', 'Submitted At', 'Pending Email Sent At', 'Confirmation Email Sent At', 'Rejection Reason', 'Admin Notes'
];

var SLOT_HEADERS = ['Slot ID', 'Label', 'Time', 'Capacity'];

/* ------------------------------------------------------------------ */
/* Pure helpers (also unit-tested outside Apps Script)                 */
/* ------------------------------------------------------------------ */

function computeAmounts(children, extraParent, giftQty) {
  var p = CONFIG.PRICES;
  var ticketSubtotal = children * p.CHILD_TICKET;
  var extraParentCharge = extraParent ? p.EXTRA_PARENT : 0;
  var giftSubtotal = giftQty * p.SANTA_GIFT;
  return {
    children: children,
    ticketSubtotal: ticketSubtotal,
    extraParent: !!extraParent,
    extraParentCharge: extraParentCharge,
    giftQty: giftQty,
    giftSubtotal: giftSubtotal,
    total: ticketSubtotal + extraParentCharge + giftSubtotal
  };
}

function toInt(v) {
  var n = Number(v);
  return (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && isFinite(n) && Math.floor(n) === n ? n : NaN;
}

/** Validates the ticket selection. Returns {ok, value} or {ok:false, error}. */
function validateSelection(p, slots) {
  var slot = null;
  for (var i = 0; i < slots.length; i++) if (slots[i].id === p.slotId) slot = slots[i];
  if (!slot) return { ok: false, code: 'BAD_SLOT', error: 'Please choose a slot.' };
  var children = toInt(p.children);
  if (!(children >= 1 && children <= CONFIG.MAX_CHILDREN)) return { ok: false, code: 'BAD_CHILDREN', error: 'Choose between 1 and ' + CONFIG.MAX_CHILDREN + ' children.' };
  var giftQty = p.giftQty === undefined || p.giftQty === null ? 0 : toInt(p.giftQty);
  if (!(giftQty >= 0 && giftQty <= children)) return { ok: false, code: 'BAD_GIFTS', error: 'Santa gifts can be 0 up to the number of children.' };
  if (p.extraParent !== true && p.extraParent !== false && p.extraParent !== undefined) return { ok: false, code: 'BAD_EXTRA_PARENT', error: 'Extra parent must be yes or no.' };
  return { ok: true, value: { slot: slot, children: children, extraParent: p.extraParent === true, giftQty: giftQty } };
}

/** Counts children per slot. Pending Verification, Verified and live holds count; Abandoned and Rejected never do. */
function countUsage(bookings, slots, nowMs) {
  var usage = {};
  slots.forEach(function (s) { usage[s.id] = { verified: 0, pending: 0, holds: 0, total: 0 }; });
  bookings.forEach(function (b) {
    var u = usage[b.slotId];
    if (!u) return;
    var n = Number(b.children) || 0;
    if (b.status === STATUS.VERIFIED) u.verified += n;
    else if (b.status === STATUS.PENDING) u.pending += n;
    else if (b.status === STATUS.AWAITING && holdIsLive(b, nowMs)) u.holds += n;
  });
  Object.keys(usage).forEach(function (k) { var u = usage[k]; u.total = u.verified + u.pending + u.holds; });
  return usage;
}

function holdIsLive(b, nowMs) {
  var t = b.holdExpiresAt instanceof Date ? b.holdExpiresAt.getTime() : new Date(b.holdExpiresAt).getTime();
  return isFinite(t) && t > nowMs;
}

function validateDetails(p, children) {
  var name = String(p.parentName || '').trim();
  if (name.length < 2 || name.length > 80) return { ok: false, code: 'BAD_NAME', error: "Add the parent's name." };
  var email = String(p.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return { ok: false, code: 'BAD_EMAIL', error: 'Add a valid email address.' };
  var phone = String(p.phone || '').replace(/\D/g, '');
  if (phone.length === 12 && phone.indexOf('91') === 0) phone = phone.slice(2);
  if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, code: 'BAD_PHONE', error: 'Add a 10-digit mobile number.' };
  var names = (Array.isArray(p.childNames) ? p.childNames : []).map(function (n) { return String(n || '').trim(); });
  if (names.length !== children || names.some(function (n) { return n.length < 1 || n.length > 60; })) {
    return { ok: false, code: 'BAD_CHILD_NAMES', error: children === 1 ? "Add your child's name." : "Add each child's name." };
  }
  var utr = String(p.utr || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  var hasShot = !!(p.screenshot && p.screenshot.data);
  if (utr && (utr.length < 12 || utr.length > 35)) return { ok: false, code: 'BAD_UTR', error: 'The UPI transaction ID should be at least 12 characters.' };
  if (!utr && !hasShot) return { ok: false, code: 'NO_PROOF', error: 'Add your UPI transaction ID or upload the payment screenshot.' };
  if (hasShot && !/^image\/(png|jpe?g|webp|heic|heif)$/i.test(String(p.screenshot.mimeType || ''))) return { ok: false, code: 'BAD_SCREENSHOT', error: 'The screenshot must be an image (PNG, JPG or WebP).' };
  return { ok: true, value: { parentName: name, email: email, phone: phone, childNames: names, utr: utr, hasShot: hasShot } };
}

function upiUri(total, bookingId) {
  return 'upi://pay?pa=' + CONFIG.UPI_ID + '&pn=' + encodeURIComponent(CONFIG.UPI_PAYEE) +
    '&am=' + Number(total).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent(bookingId + ' Christmas Carnival');
}

function rupees(n) {
  var s = String(Math.round(Number(n) || 0));
  var last3 = s.slice(-3), rest = s.slice(0, -3);
  return '₹' + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3;
}

/* ------------------------------------------------------------------ */
/* Web app entry points                                                */
/* ------------------------------------------------------------------ */

function doGet() {
  return json({ ok: true, service: CONFIG.EVENT_NAME + ' booking API' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json({ ok: false, code: 'BAD_JSON', error: 'Invalid request.' });
  }
  try {
    var routes = {
      availability: apiAvailability,
      createHold: apiCreateHold,
      cancelHold: apiCancelHold,
      submitBooking: apiSubmitBooking,
      adminList: adminOnly(apiAdminList),
      adminVerify: adminOnly(apiAdminVerify),
      adminReject: adminOnly(apiAdminReject),
      adminUpdateCapacity: adminOnly(apiAdminUpdateCapacity)
    };
    var fn = routes[body.action];
    if (!fn) return json({ ok: false, code: 'BAD_ACTION', error: 'Unknown action.' });
    return json(fn(body));
  } catch (err) {
    console.error(err && err.stack || err);
    return json({ ok: false, code: 'SERVER_ERROR', error: 'Something went wrong. Please try again in a minute.' });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Only sold-out flags — never counts or capacity. */
function apiAvailability() {
  var slots = readSlots();
  var usage = countUsage(readBookings().map(function (r) { return r.b; }), slots, Date.now());
  return {
    ok: true,
    prices: CONFIG.PRICES,
    maxChildren: CONFIG.MAX_CHILDREN,
    holdMinutes: CONFIG.HOLD_MINUTES,
    slots: slots.map(function (s) { return { id: s.id, label: s.label, time: s.time, soldOut: usage[s.id].total >= s.capacity }; })
  };
}

function apiCreateHold(p) {
  var slots = readSlots();
  var v = validateSelection(p, slots);
  if (!v.ok) return v;
  var sel = v.value;
  return withLock(function () {
    var now = Date.now();
    var rows = readBookings();
    if (p.previousBookingId) abandonIfAwaiting(rows, String(p.previousBookingId));
    expireHolds_(rows, now);
    var usage = countUsage(rows.map(function (r) { return r.b; }), slots, now)[sel.slot.id];
    if (usage.total >= sel.slot.capacity) return { ok: false, code: 'SOLD_OUT', error: sel.slot.label + ' is sold out. Please choose another slot.' };
    if (usage.total + sel.children > sel.slot.capacity) {
      return { ok: false, code: 'NOT_ENOUGH_PLACES', error: "There aren't enough places left in " + sel.slot.label + ' for ' + sel.children + ' children. Try another slot or fewer children.' };
    }
    var amounts = computeAmounts(sel.children, sel.extraParent, sel.giftQty);
    var id = newBookingId_(rows);
    var holdExpires = new Date(now + CONFIG.HOLD_MINUTES * 60000);
    appendBooking_({
      'Booking ID': id, 'Created At': new Date(now), 'Slot ID': sel.slot.id, 'Slot Time': sel.slot.time,
      'Children': sel.children, 'Extra Parent': sel.extraParent ? 'Yes' : 'No', 'Extra Parent Charge': amounts.extraParentCharge,
      'Ticket Subtotal': amounts.ticketSubtotal, 'Santa Gift Qty': amounts.giftQty, 'Santa Gift Subtotal': amounts.giftSubtotal,
      'Expected Total': amounts.total, 'Status': STATUS.AWAITING, 'Payment Status': PAYMENT.NOT_PAID, 'Hold Expires At': holdExpires
    });
    return {
      ok: true,
      bookingId: id,
      slot: { id: sel.slot.id, label: sel.slot.label, time: sel.slot.time },
      amounts: amounts,
      holdExpiresAt: holdExpires.toISOString(),
      upi: { id: CONFIG.UPI_ID, payee: CONFIG.UPI_PAYEE, uri: upiUri(amounts.total, id) }
    };
  });
}

function apiCancelHold(p) {
  return withLock(function () {
    abandonIfAwaiting(readBookings(), String(p.bookingId || ''));
    return { ok: true };
  });
}

function apiSubmitBooking(p) {
  var bookingId = String(p.bookingId || '');
  var found = findBooking_(readBookings(), bookingId);
  if (!found) return { ok: false, code: 'NOT_FOUND', error: 'We could not find this booking. Please start again.' };
  var d = validateDetails(p, Number(found.b.children));
  if (!d.ok) return d;
  var det = d.value;

  // Duplicate submit (double tap, retry): answer with the saved booking.
  if (found.b.status === STATUS.PENDING || found.b.status === STATUS.VERIFIED) return publicResult_(found.b);

  // Save the screenshot before taking the lock so the lock is held only briefly.
  var screenshotUrl = '';
  if (det.hasShot) {
    var bytes = Utilities.base64Decode(String(p.screenshot.data));
    if (bytes.length > CONFIG.MAX_SCREENSHOT_BYTES) return { ok: false, code: 'BIG_SCREENSHOT', error: 'The screenshot is too large. Please use one under 5 MB.' };
    var ext = String(p.screenshot.mimeType).split('/')[1].replace('jpeg', 'jpg');
    var blob = Utilities.newBlob(bytes, p.screenshot.mimeType, bookingId + '-payment.' + ext);
    screenshotUrl = screenshotFolder_().createFile(blob).getUrl();
  }

  var outcome = withLock(function () {
    var now = Date.now();
    var rows = readBookings();
    var row = findBooking_(rows, bookingId);
    if (!row) return { ok: false, code: 'NOT_FOUND', error: 'We could not find this booking. Please start again.' };
    var b = row.b;
    if (b.status === STATUS.PENDING || b.status === STATUS.VERIFIED) return publicResult_(b);
    if (b.status === STATUS.REJECTED) return { ok: false, code: 'REJECTED', error: 'This booking was cancelled. Please contact hello.lilhoppers@gmail.com.' };

    var details = {
      'Child Names': det.childNames.join(', '), 'Parent Name': det.parentName, 'Email': det.email, 'Phone': det.phone,
      'UPI Transaction ID': det.utr, 'Screenshot URL': screenshotUrl, 'Submitted At': new Date(now)
    };

    // Hold expired or abandoned: only keep the booking if the places are still free.
    if (!(b.status === STATUS.AWAITING && holdIsLive(b, now))) {
      expireHolds_(rows, now);
      var allSlots = readSlots();
      var slot = allSlots.filter(function (s) { return s.id === b.slotId; })[0];
      var others = rows.filter(function (r) { return r.b.bookingId !== bookingId; }).map(function (r) { return r.b; });
      var used = slot ? countUsage(others, allSlots, now)[slot.id].total : Infinity;
      if (!slot || used + Number(b.children) > slot.capacity) {
        details['Status'] = STATUS.REJECTED;
        details['Payment Status'] = PAYMENT.PENDING;
        details['Rejection Reason'] = 'Slot full after hold expired — refund due';
        updateBooking_(row.rowIndex, details);
        return { ok: false, code: 'FULL_AFTER_EXPIRY', error: 'Sorry, your 20-minute hold ran out and ' + (slot ? slot.label : 'the slot') + ' filled up. We have saved your payment details and will refund you. We will contact you at ' + det.email + '.' };
      }
    }
    details['Status'] = STATUS.PENDING;
    details['Payment Status'] = PAYMENT.PENDING;
    details['Rejection Reason'] = '';
    updateBooking_(row.rowIndex, details);
    var fresh = findBooking_(readBookings(), bookingId);
    return { ok: true, booking: fresh.b, rowIndex: fresh.rowIndex };
  });

  if (!outcome.ok || !outcome.booking) return outcome;
  try {
    sendPendingEmail_(outcome.booking);
    updateBooking_(outcome.rowIndex, { 'Pending Email Sent At': new Date() });
  } catch (err) {
    console.error('Pending email failed: ' + err);
  }
  return publicResult_(outcome.booking);
}

function publicResult_(b) {
  return {
    ok: true,
    bookingId: b.bookingId,
    status: b.status,
    paymentStatus: b.paymentStatus,
    slot: { id: b.slotId, time: b.slotTime },
    amounts: computeAmounts(Number(b.children), b.extraParent === 'Yes', Number(b.giftQty))
  };
}

/* ------------------------------------------------------------------ */
/* Admin API                                                           */
/* ------------------------------------------------------------------ */

function adminOnly(fn) {
  return function (p) {
    var cache = CacheService.getScriptCache();
    var fails = Number(cache.get('admin_fails') || 0);
    if (fails >= 10) return { ok: false, code: 'LOCKED', error: 'Too many wrong passcodes. Try again in 10 minutes.' };
    var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSCODE');
    if (!expected || String(p.passcode || '') !== expected) {
      cache.put('admin_fails', String(fails + 1), 600);
      return { ok: false, code: 'UNAUTHORISED', error: 'Wrong passcode.' };
    }
    return fn(p);
  };
}

function apiAdminList() {
  var now = Date.now();
  var slots = readSlots();
  var rows = readBookings();
  var usage = countUsage(rows.map(function (r) { return r.b; }), slots, now);
  var totalCapacity = 0, totalCounted = 0;
  var slotView = slots.map(function (s) {
    var u = usage[s.id];
    totalCapacity += s.capacity;
    totalCounted += u.total;
    return { id: s.id, label: s.label, time: s.time, capacity: s.capacity, verified: u.verified, pending: u.pending, holds: u.holds, total: u.total, soldOut: u.total >= s.capacity };
  });
  var bookings = rows.map(function (r) {
    var b = r.b;
    if (b.status === STATUS.AWAITING && !holdIsLive(b, now)) b.status = STATUS.ABANDONED + ' (hold expired)';
    return b;
  }).reverse();
  return { ok: true, slots: slotView, totals: { capacity: totalCapacity, counted: totalCounted }, bookings: bookings, prices: CONFIG.PRICES };
}

function apiAdminVerify(p) {
  var amount = Number(p.verifiedAmount);
  if (!(amount >= 0)) return { ok: false, code: 'BAD_AMOUNT', error: 'Enter the amount received.' };
  var outcome = withLock(function () {
    var row = findBooking_(readBookings(), String(p.bookingId || ''));
    if (!row) return { ok: false, code: 'NOT_FOUND', error: 'Booking not found.' };
    if (row.b.status !== STATUS.PENDING) return { ok: false, code: 'BAD_STATE', error: 'Only bookings that are Pending Verification can be verified (this one is ' + row.b.status + ').' };
    updateBooking_(row.rowIndex, {
      'Status': STATUS.VERIFIED, 'Payment Status': PAYMENT.VERIFIED, 'Verified Amount': amount, 'Verified At': new Date(),
      'Admin Notes': appendNote_(row.b.adminNotes, p.note)
    });
    return { ok: true, rowIndex: row.rowIndex };
  });
  if (!outcome.ok) return outcome;
  var fresh = findBooking_(readBookings(), String(p.bookingId));
  try {
    sendConfirmationEmail_(fresh.b);
    updateBooking_(fresh.rowIndex, { 'Confirmation Email Sent At': new Date() });
    return { ok: true, emailSent: true };
  } catch (err) {
    console.error('Confirmation email failed: ' + err);
    return { ok: true, emailSent: false, warning: 'Verified, but the confirmation email could not be sent: ' + err };
  }
}

function apiAdminReject(p) {
  var reason = String(p.reason || '').trim();
  if (!reason) return { ok: false, code: 'NO_REASON', error: 'Add a reason for rejecting.' };
  return withLock(function () {
    var row = findBooking_(readBookings(), String(p.bookingId || ''));
    if (!row) return { ok: false, code: 'NOT_FOUND', error: 'Booking not found.' };
    if (row.b.status === STATUS.VERIFIED) return { ok: false, code: 'BAD_STATE', error: 'This booking is already verified.' };
    updateBooking_(row.rowIndex, { 'Status': STATUS.REJECTED, 'Payment Status': PAYMENT.REJECTED, 'Rejection Reason': reason });
    return { ok: true };
  });
}

function apiAdminUpdateCapacity(p) {
  var cap = toInt(p.capacity);
  if (!(cap >= 0 && cap <= 1000)) return { ok: false, code: 'BAD_CAPACITY', error: 'Capacity must be a whole number from 0 to 1000.' };
  return withLock(function () {
    var sh = sheet_('Slots');
    var values = sh.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === String(p.slotId)) {
        sh.getRange(i + 1, 4).setValue(cap);
        return { ok: true };
      }
    }
    return { ok: false, code: 'BAD_SLOT', error: 'Slot not found.' };
  });
}

/* ------------------------------------------------------------------ */
/* Sheet access                                                        */
/* ------------------------------------------------------------------ */

var KEY_BY_HEADER = {
  'Booking ID': 'bookingId', 'Created At': 'createdAt', 'Slot ID': 'slotId', 'Slot Time': 'slotTime', 'Children': 'children',
  'Child Names': 'childNames', 'Parent Name': 'parentName', 'Email': 'email', 'Phone': 'phone', 'Extra Parent': 'extraParent',
  'Extra Parent Charge': 'extraParentCharge', 'Ticket Subtotal': 'ticketSubtotal', 'Santa Gift Qty': 'giftQty',
  'Santa Gift Subtotal': 'giftSubtotal', 'Expected Total': 'expectedTotal', 'UPI Transaction ID': 'utr',
  'Screenshot URL': 'screenshotUrl', 'Status': 'status', 'Payment Status': 'paymentStatus', 'Verified Amount': 'verifiedAmount',
  'Verified At': 'verifiedAt', 'Hold Expires At': 'holdExpiresAt', 'Submitted At': 'submittedAt',
  'Pending Email Sent At': 'pendingEmailSentAt', 'Confirmation Email Sent At': 'confirmationEmailSentAt',
  'Rejection Reason': 'rejectionReason', 'Admin Notes': 'adminNotes'
};

function spreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var sh = spreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet "' + name + '". Run setup() first.');
  return sh;
}

function readSlots() {
  var values = sheet_('Slots').getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    out.push({ id: String(values[i][0]), label: String(values[i][1]), time: String(values[i][2]), capacity: Number(values[i][3]) || 0 });
  }
  return out;
}

function readBookings() {
  var sh = sheet_('Bookings');
  var values = sh.getDataRange().getValues();
  var head = values[0] || [];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    var b = {};
    for (var c = 0; c < head.length; c++) {
      var key = KEY_BY_HEADER[head[c]];
      if (!key) continue;
      var v = values[i][c];
      b[key] = v instanceof Date ? v.toISOString() : v;
    }
    out.push({ rowIndex: i + 1, b: b });
  }
  return out;
}

function findBooking_(rows, bookingId) {
  for (var i = 0; i < rows.length; i++) if (String(rows[i].b.bookingId) === bookingId) return rows[i];
  return null;
}

function appendBooking_(record) {
  var sh = sheet_('Bookings');
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(head.map(function (h) { return record[h] === undefined ? '' : record[h]; }));
}

function updateBooking_(rowIndex, fields) {
  var sh = sheet_('Bookings');
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  Object.keys(fields).forEach(function (h) {
    var c = head.indexOf(h);
    if (c >= 0) sh.getRange(rowIndex, c + 1).setValue(fields[h]);
  });
}

function abandonIfAwaiting(rows, bookingId) {
  var row = findBooking_(rows, bookingId);
  if (row && row.b.status === STATUS.AWAITING) {
    updateBooking_(row.rowIndex, { 'Status': STATUS.ABANDONED });
    row.b.status = STATUS.ABANDONED;
  }
}

/** Marks Awaiting Payment rows whose hold has run out as Abandoned. Call inside the lock. */
function expireHolds_(rows, nowMs) {
  rows.forEach(function (r) {
    if (r.b.status === STATUS.AWAITING && !holdIsLive(r.b, nowMs)) {
      updateBooking_(r.rowIndex, { 'Status': STATUS.ABANDONED });
      r.b.status = STATUS.ABANDONED;
    }
  });
}

function newBookingId_(rows) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var taken = {};
  rows.forEach(function (r) { taken[r.b.bookingId] = true; });
  for (;;) {
    var id = 'LH-';
    for (var i = 0; i < 5; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
    if (!taken[id]) return id;
  }
}

function appendNote_(existing, note) {
  note = String(note || '').trim();
  if (!note) return existing || '';
  return (existing ? existing + '\n' : '') + note;
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, code: 'BUSY', error: 'Lots of people are booking right now. Please try again in a moment.' };
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function screenshotFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  var folder = DriveApp.createFolder(CONFIG.SCREENSHOT_FOLDER);
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

/* ------------------------------------------------------------------ */
/* Emails                                                              */
/* ------------------------------------------------------------------ */

function sendPendingEmail_(b) {
  var subject = 'We have your booking — payment being checked (' + b.bookingId + ')';
  var html = emailShell_(
    'Thanks, ' + escapeHtml_(firstName_(b.parentName)) + '!',
    '<p>We have received your booking and payment details for the ' + escapeHtml_(CONFIG.EVENT_NAME) + '. ' +
      'We check every payment by hand, and you will get a confirmation email as soon as yours is verified.</p>' +
      '<p style="padding:12px 14px;background:#FFF6D1;border-radius:10px;color:#5B4A00"><strong>Your booking is not confirmed yet.</strong> Please keep this email until the confirmation arrives.</p>' +
      bookingTable_(b, false) +
      '<p>Payment reference we received: <strong>' + escapeHtml_(b.utr || 'Screenshot uploaded') + '</strong></p>'
  );
  sendMail_(b.email, subject, html);
}

function sendConfirmationEmail_(b) {
  var subject = "You're booked! Christmas Carnival, " + b.slotTime + ' (' + b.bookingId + ')';
  var html = emailShell_(
    "You're booked, " + escapeHtml_(firstName_(b.parentName)) + '!',
    '<p>We have verified your payment. See you at the ' + escapeHtml_(CONFIG.EVENT_NAME) + '!</p>' +
      bookingTable_(b, true) +
      '<p><strong>When:</strong> ' + escapeHtml_(CONFIG.EVENT_DATE) + ', ' + escapeHtml_(b.slotTime) + '<br>' +
      '<strong>Where:</strong> ' + escapeHtml_(CONFIG.VENUE) + ' (<a href="' + CONFIG.MAPS_URL + '">map</a>)</p>' +
      '<p>Each child ticket lets in one child and one parent' + (b.extraParent === 'Yes' ? ', and you added one extra parent' : '') + '.</p>' +
      '<p style="padding:12px 14px;background:#F1ECFA;border-radius:10px"><strong>Show this email at the entrance.</strong></p>'
  );
  sendMail_(b.email, subject, html);
}

function sendMail_(to, subject, html) {
  var me = Session.getEffectiveUser().getEmail();
  if (me && me.toLowerCase() !== CONFIG.SENDER_EMAIL) {
    console.warn('Emails are being sent from ' + me + ', not ' + CONFIG.SENDER_EMAIL + '. Deploy the web app while signed in as ' + CONFIG.SENDER_EMAIL + '.');
  }
  MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: CONFIG.SENDER_NAME, replyTo: CONFIG.SENDER_EMAIL });
}

function bookingTable_(b, verified) {
  var a = computeAmounts(Number(b.children), b.extraParent === 'Yes', Number(b.giftQty));
  var rows = [
    ['Booking ID', '<strong>' + escapeHtml_(b.bookingId) + '</strong>'],
    ['Slot', escapeHtml_(CONFIG.EVENT_DATE + ', ' + b.slotTime)],
    ['Children', escapeHtml_(b.childNames)],
    ['Child tickets (' + a.children + ' × ' + rupees(CONFIG.PRICES.CHILD_TICKET) + ', each with one parent)', rupees(a.ticketSubtotal)]
  ];
  if (a.extraParent) rows.push(['Extra parent', rupees(a.extraParentCharge)]);
  if (a.giftQty) rows.push(['Personalised gift from Santa (' + a.giftQty + ' × ' + rupees(CONFIG.PRICES.SANTA_GIFT) + ')', rupees(a.giftSubtotal)]);
  rows.push(['<strong>Total</strong>', '<strong>' + rupees(a.total) + '</strong>']);
  if (verified) rows.push(['Amount received', rupees(b.verifiedAmount)]);
  return '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:15px">' + rows.map(function (r) {
    return '<tr><td style="padding:8px 0;border-bottom:1px solid #EEE8F7;color:#5E5470">' + r[0] + '</td><td style="padding:8px 0;border-bottom:1px solid #EEE8F7;text-align:right">' + r[1] + '</td></tr>';
  }).join('') + '</table>';
}

function emailShell_(heading, body) {
  return '<div style="font-family:Nunito,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2A1D45">' +
    '<div style="background:#4E2F92;color:#fff;border-radius:16px 16px 0 0;padding:22px 26px"><div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#FCD419">' +
    escapeHtml_(CONFIG.EVENT_NAME) + '</div><div style="font-size:24px;font-weight:700;margin-top:6px">' + heading + '</div></div>' +
    '<div style="background:#ffffff;border:1px solid #EEE8F7;border-top:0;border-radius:0 0 16px 16px;padding:8px 26px 22px;font-size:15px;line-height:1.55">' +
    body + '<p style="color:#5E5470">Questions? Just reply to this email.<br>— The Lil\' Hoppers team</p></div></div>';
}

function firstName_(name) { return String(name || '').trim().split(/\s+/)[0] || 'there'; }

function escapeHtml_(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ------------------------------------------------------------------ */
/* One-time setup and the hold-expiry timer                            */
/* ------------------------------------------------------------------ */

/** Run once from the Apps Script editor while signed in as hello.lilhoppers@gmail.com. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());

  var bookings = ss.getSheetByName('Bookings') || ss.insertSheet('Bookings');
  if (bookings.getLastRow() === 0) {
    bookings.appendRow(BOOKING_HEADERS);
    bookings.setFrozenRows(1);
    bookings.getRange(1, 1, 1, BOOKING_HEADERS.length).setFontWeight('bold').setBackground('#F1ECFA');
  }
  var slots = ss.getSheetByName('Slots') || ss.insertSheet('Slots');
  if (slots.getLastRow() === 0) {
    slots.appendRow(SLOT_HEADERS);
    DEFAULT_SLOTS.forEach(function (s) { slots.appendRow([s.id, s.label, s.time, s.capacity]); });
    slots.setFrozenRows(1);
    slots.getRange(1, 1, 1, SLOT_HEADERS.length).setFontWeight('bold').setBackground('#F1ECFA');
  }
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  screenshotFolder_();

  if (!props.getProperty('ADMIN_PASSCODE')) {
    var code = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    props.setProperty('ADMIN_PASSCODE', code);
    console.log('Admin passcode: ' + code + '  (change it under Project Settings → Script properties)');
  }

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'expireHoldsJob') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('expireHoldsJob').timeBased().everyMinutes(10).create();

  var me = Session.getEffectiveUser().getEmail();
  console.log(me === CONFIG.SENDER_EMAIL ? 'Emails will be sent from ' + me + '.' : 'WARNING: you are signed in as ' + me + '. Emails must come from ' + CONFIG.SENDER_EMAIL + ', so redo this as that account.');
}

/** Timer job: releases places held by people who never finished paying. */
function expireHoldsJob() {
  withLock(function () {
    expireHolds_(readBookings(), Date.now());
    return { ok: true };
  });
}
