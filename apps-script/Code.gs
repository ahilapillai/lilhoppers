/**
 * Lil' Hoppers Christmas Carnival — booking backend (Google Apps Script).
 *
 * Bind this script to the bookings Google Sheet, owned by hello.lilhoppers@gmail.com,
 * run setup() once, then deploy as a web app (Execute as: Me, Who has access: Anyone).
 * See README.md for the full steps.
 */

var CONFIG = {
  EVENT_NAME: "Lil' Hoppers Christmas Carnival",
  EVENT_DATE: 'Saturday, 12 December 2026',
  VENUE: 'Vata Vriksha, Indiranagar',
  MAPS_URL: 'https://share.google/GE3sdUk4LarPOcGPW',
  // The QR in the confirmation email opens this site's volunteer check-in page.
  SITE_URL: 'https://lilhoppers.co',
  UPI_ID: 'ahilapil.26-1@okicici',
  UPI_PAYEE: 'Lil Hoppers',
  SENDER_EMAIL: 'hello.lilhoppers@gmail.com',
  SENDER_NAME: "Lil' Hoppers",
  // A short "new booking" alert goes here for every booking submitted (and a "refund needed" alert when a
  // payment arrives after the slot filled up). Add more addresses with commas, e.g. 'a@x.com, b@y.com'.
  // Empty = no alerts.
  ALERT_EMAIL: 'hello.lilhoppers@gmail.com',
  HOLD_MINUTES: 20,
  MAX_CHILDREN: 10,
  MAX_SCREENSHOT_BYTES: 5 * 1024 * 1024,
  // BOOKING_FEE: a flat 'Booking & support fee' added once per booking (0 = none: the ticket price is all-inclusive).
  // Keep in step with assets/js/config.js.
  // GROUP_DEALS: codes applied automatically by the number of children (the lowest price that applies wins).
  PRICES: {
    CHILD_TICKET: 899, EXTRA_PARENT: 199, SANTA_GIFT: 299, BOOKING_FEE: 0,
    GROUP_DEALS: [{ code: 'LILHOP5', minChildren: 5, childPrice: 749 }, { code: 'LILHOP2', minChildren: 2, childPrice: 799 }]
  },
  SCREENSHOT_FOLDER: 'Lil Hoppers – Payment screenshots',
  // The booking page reads each payment screenshot and only accepts it if it shows one of these names
  // (or the UPI ID), today's date and a time within this many minutes of upload. See assets/js/shotcheck.js.
  PAYEE_NAMES: ['AHILA PICHAIPILLAI'],
  SCREENSHOT_TOLERANCE_MINUTES: 15
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
  'Booking ID', 'Created At', 'Slot Time', 'Children', 'Child Names', 'Parent Name', 'Email', 'Phone',
  'Extra Parent', 'Extra Parent Charge', 'Ticket Subtotal', 'Santa Gift Qty', 'Santa Gift Subtotal', 'Expected Total',
  'UPI Transaction ID', 'Screenshot URL', 'Screenshot Check', 'Screenshot Shows', 'Screenshot Check Note', 'Status', 'Payment Status', 'Verified Amount', 'Verified At',
  'Hold Expires At', 'Submitted At', 'Pending Email Sent At', 'Confirmation Email Sent At', 'Rejection Reason', 'Admin Notes', 'Rejection Email Sent At', 'Checked In At'
];

var SLOT_HEADERS = ['Slot ID', 'Label', 'Time', 'Capacity'];

/* ------------------------------------------------------------------ */
/* Pure helpers (also unit-tested outside Apps Script)                 */
/* ------------------------------------------------------------------ */

/** The group deal for this many children (LILHOP2 from 2, LILHOP5 from 5), or null. */
function groupDeal_(children) {
  var best = null;
  (CONFIG.PRICES.GROUP_DEALS || []).forEach(function (d) {
    if (children >= d.minChildren && (!best || d.childPrice < best.childPrice)) best = d;
  });
  return best;
}

function computeAmounts(children, extraParent, giftQty) {
  var p = CONFIG.PRICES;
  var deal = groupDeal_(children);
  var childPrice = deal ? deal.childPrice : p.CHILD_TICKET;
  var ticketsAtFull = children * p.CHILD_TICKET;
  var ticketSubtotal = children * childPrice; // what is charged for the tickets
  var extraParentCharge = extraParent ? p.EXTRA_PARENT : 0;
  var giftSubtotal = giftQty * p.SANTA_GIFT;
  var bookingFee = p.BOOKING_FEE || 0; // flat, once per booking
  return {
    children: children,
    childPrice: childPrice,
    ticketsAtFull: ticketsAtFull,
    couponCode: deal ? deal.code : '',
    discount: ticketsAtFull - ticketSubtotal,
    ticketSubtotal: ticketSubtotal,
    extraParent: !!extraParent,
    extraParentCharge: extraParentCharge,
    giftQty: giftQty,
    giftSubtotal: giftSubtotal,
    bookingFee: bookingFee,
    total: ticketSubtotal + extraParentCharge + giftSubtotal + bookingFee
  };
}

/**
 * Amounts for a saved booking, from what was saved when it was made, so later price changes
 * (the booking fee, group deals) never change an existing booking's total.
 */
function storedAmounts_(b) {
  var a = computeAmounts(Number(b.children), b.extraParent === 'Yes', Number(b.giftQty));
  var has = function (v) { return v !== '' && v !== undefined && v !== null && isFinite(Number(v)); };
  if (has(b.ticketSubtotal)) {
    a.ticketSubtotal = Number(b.ticketSubtotal);
    a.childPrice = a.children ? a.ticketSubtotal / a.children : CONFIG.PRICES.CHILD_TICKET;
    a.ticketsAtFull = a.children * CONFIG.PRICES.CHILD_TICKET;
    a.discount = Math.max(0, a.ticketsAtFull - a.ticketSubtotal);
    var deal = null;
    (CONFIG.PRICES.GROUP_DEALS || []).forEach(function (d) { if (d.childPrice === a.childPrice) deal = d; });
    a.couponCode = a.discount && deal ? deal.code : '';
  }
  if (has(b.extraParentCharge)) a.extraParentCharge = Number(b.extraParentCharge);
  if (has(b.giftSubtotal)) a.giftSubtotal = Number(b.giftSubtotal);
  var items = a.ticketSubtotal + a.extraParentCharge + a.giftSubtotal;
  if (has(b.expectedTotal)) a.bookingFee = Math.max(0, Number(b.expectedTotal) - items);
  a.total = items + a.bookingFee;
  return a;
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

/** Email and phone: asked for before the payment QR, and checked again with the details. */
function validateContact_(p) {
  var email = String(p.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return { ok: false, code: 'BAD_EMAIL', error: 'Add a valid email address.' };
  var phone = String(p.phone || '').replace(/\D/g, '');
  if (phone.length === 12 && phone.indexOf('91') === 0) phone = phone.slice(2);
  if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, code: 'BAD_PHONE', error: 'Add a 10-digit mobile number.' };
  return { ok: true, value: { email: email, phone: phone } };
}

function validateDetails(p, children) {
  var name = String(p.parentName || '').trim();
  if (name.length < 2 || name.length > 80) return { ok: false, code: 'BAD_NAME', error: "Add the parent's name." };
  var contact = validateContact_(p);
  if (!contact.ok) return contact;
  var email = contact.value.email, phone = contact.value.phone;
  var names = (Array.isArray(p.childNames) ? p.childNames : []).map(function (n) { return String(n || '').trim(); });
  if (names.length !== children || names.some(function (n) { return n.length < 1 || n.length > 60; })) {
    return { ok: false, code: 'BAD_CHILD_NAMES', error: children === 1 ? "Add your child's name." : "Add each child's name." };
  }
  var utr = String(p.utr || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  var hasShot = !!(p.screenshot && p.screenshot.data);
  if (utr && (utr.length < 12 || utr.length > 35)) return { ok: false, code: 'BAD_UTR', error: 'The UPI transaction ID should be at least 12 characters.' };
  // The screenshot is the only proof now: it lets the booking page check the date, time and payee.
  if (!hasShot) return { ok: false, code: 'NO_PROOF', error: 'Upload the screenshot of your payment.' };
  if (hasShot && !/^image\/(png|jpe?g|webp|heic|heif)$/i.test(String(p.screenshot.mimeType || ''))) return { ok: false, code: 'BAD_SCREENSHOT', error: 'The screenshot must be an image (PNG, JPG or WebP).' };
  if (hasShot && p.screenshotCheck && p.screenshotCheck.status === 'fail') {
    return { ok: false, code: 'SCREENSHOT_MISMATCH', error: "This doesn't look like a payment to Lil' Hoppers. Please upload the screenshot of the payment you just made." };
  }
  return { ok: true, value: { parentName: name, email: email, phone: phone, childNames: names, utr: utr, hasShot: hasShot } };
}

/** The booking page's screenshot check, as saved to the sheet. */
function checkFromPayload_(p, hasShot) {
  if (!hasShot) return { 'Screenshot Check': '', 'Screenshot Shows': '', 'Screenshot Check Note': '' };
  var c = p.screenshotCheck || {};
  var label = { pass: 'Passed', unreadable: "Couldn't read", fail: 'Failed' }[c.status] || 'Not checked';
  return {
    'Screenshot Check': label,
    'Screenshot Shows': String(c.shows || '').slice(0, 60),
    'Screenshot Check Note': String(c.summary || '').slice(0, 300)
  };
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
      adminUpdateCapacity: adminOnly(apiAdminUpdateCapacity),
      staffCheck: staffOnly(function () { return { ok: true }; }),
      checkinLookup: staffOnly(apiCheckinLookup),
      checkin: staffOnly(apiCheckin),
      checkinUndo: staffOnly(apiCheckinUndo)
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
  // The booking page asks for email and phone before showing the QR, so every hold that might get paid
  // can be confirmed or followed up. (A page loaded before this change sends neither: still allowed.)
  var contact = null;
  if (p.email !== undefined || p.phone !== undefined) {
    var c = validateContact_(p);
    if (!c.ok) return c;
    contact = c.value;
  }
  return withLock(function () {
    var now = Date.now();
    var rows = readBookings();
    expireHolds_(rows, now);
    // Changing an unpaid hold (more kids, add-ons, another slot) updates that same booking.
    // Its own places are left out while counting; if the change doesn't fit, the old hold stays as it was.
    var prev = p.previousBookingId ? findBooking_(rows, String(p.previousBookingId)) : null;
    if (prev && prev.b.status !== STATUS.AWAITING) prev = null;
    if (prev) prev.b.status = STATUS.ABANDONED;
    var usage = countUsage(rows.map(function (r) { return r.b; }), slots, now)[sel.slot.id];
    if (prev) prev.b.status = STATUS.AWAITING;
    if (usage.total >= sel.slot.capacity) return { ok: false, code: 'SOLD_OUT', error: sel.slot.label + ' is sold out. Please choose another slot.' };
    if (usage.total + sel.children > sel.slot.capacity) {
      return { ok: false, code: 'NOT_ENOUGH_PLACES', error: "There aren't enough places left in " + sel.slot.label + ' for ' + sel.children + ' children. Try another slot or fewer children.' };
    }
    var amounts = computeAmounts(sel.children, sel.extraParent, sel.giftQty);
    var holdExpires = new Date(now + CONFIG.HOLD_MINUTES * 60000);
    var fields = {
      'Slot ID': sel.slot.id, 'Slot Time': sel.slot.time,
      'Children': sel.children, 'Extra Parent': sel.extraParent ? 'Yes' : 'No', 'Extra Parent Charge': amounts.extraParentCharge,
      'Ticket Subtotal': amounts.ticketSubtotal, 'Santa Gift Qty': amounts.giftQty, 'Santa Gift Subtotal': amounts.giftSubtotal,
      'Expected Total': amounts.total, 'Status': STATUS.AWAITING, 'Payment Status': PAYMENT.NOT_PAID, 'Hold Expires At': holdExpires
    };
    if (contact) { fields['Email'] = contact.email; fields['Phone'] = contact.phone; }
    var id;
    if (prev) {
      id = String(prev.b.bookingId);
      updateBooking_(prev.rowIndex, fields);
    } else {
      id = newBookingId_(rows);
      fields['Booking ID'] = id;
      fields['Created At'] = new Date(now);
      appendBooking_(fields);
    }
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

  // Duplicate submit (double tap, retry): answer with the saved booking. A booking that was marked Verified
  // in the sheet before the parent sent their details is not a duplicate: its details still need saving.
  if (alreadySubmitted_(found.b)) return publicResult_(found.b);

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
    if (alreadySubmitted_(b)) return publicResult_(b);
    if (b.status === STATUS.REJECTED) return { ok: false, code: 'REJECTED', error: 'This booking was cancelled. Please contact hello.lilhoppers@gmail.com.' };

    var details = {
      'Child Names': det.childNames.join(', '), 'Parent Name': det.parentName, 'Email': det.email, 'Phone': det.phone,
      'UPI Transaction ID': det.utr, 'Screenshot URL': screenshotUrl, 'Submitted At': new Date(now)
    };
    var check = checkFromPayload_(p, det.hasShot);
    Object.keys(check).forEach(function (k) { details[k] = check[k]; });

    // Already verified (marked in the sheet from the payment, before these details arrived): keep it
    // verified, save the details, and send the confirmation instead of "payment being checked".
    if (b.status === STATUS.VERIFIED) {
      details['Admin Notes'] = appendNote_(b.adminNotes, 'Details arrived after the payment was marked Verified.');
      updateBooking_(row.rowIndex, details);
      var v = findBooking_(readBookings(), bookingId);
      return { ok: true, booking: v.b, rowIndex: v.rowIndex, verified: true };
    }
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
        return { alertFor: findBooking_(readBookings(), bookingId).b, ok: false, code: 'FULL_AFTER_EXPIRY', error: 'Sorry, your 20-minute hold ran out and ' + (slot ? slot.label : 'the slot') + ' filled up. We have saved your payment details and will refund you. We will contact you at ' + det.email + '.' };
      }
    }
    details['Status'] = STATUS.PENDING;
    details['Payment Status'] = PAYMENT.PENDING;
    details['Rejection Reason'] = '';
    updateBooking_(row.rowIndex, details);
    var fresh = findBooking_(readBookings(), bookingId);
    return { ok: true, booking: fresh.b, rowIndex: fresh.rowIndex };
  });

  if (outcome.alertFor) {
    try { sendBookingAlert_(outcome.alertFor, true); } catch (err) { console.error('Refund alert failed: ' + err); }
    delete outcome.alertFor;
  }
  if (!outcome.ok || !outcome.booking) return outcome;
  if (outcome.verified) {
    if (!outcome.booking.confirmationEmailSentAt) {
      try {
        sendConfirmationEmail_(outcome.booking);
        updateBooking_(outcome.rowIndex, { 'Confirmation Email Sent At': new Date() });
      } catch (err) {
        console.error('Confirmation email failed: ' + err);
        updateBooking_(outcome.rowIndex, { 'Admin Notes': appendNote_(outcome.booking.adminNotes, 'Confirmation email failed: ' + err) });
      }
    }
    try { sendBookingAlert_(outcome.booking, false); } catch (err) { console.error('Booking alert failed: ' + err); }
    return publicResult_(outcome.booking);
  }
  try {
    sendPendingEmail_(outcome.booking);
    updateBooking_(outcome.rowIndex, { 'Pending Email Sent At': new Date() });
  } catch (err) {
    console.error('Pending email failed: ' + err);
  }
  try { sendBookingAlert_(outcome.booking, false); } catch (err) { console.error('Booking alert failed: ' + err); }
  return publicResult_(outcome.booking);
}

/** True once the parent's details (and proof) have been saved for this booking. */
function alreadySubmitted_(b) {
  if (b.status === STATUS.PENDING) return true;
  if (b.status === STATUS.VERIFIED) return !!b.submittedAt;
  return false;
}

function publicResult_(b) {
  return {
    ok: true,
    bookingId: b.bookingId,
    status: b.status,
    paymentStatus: b.paymentStatus,
    slot: { id: b.slotId, time: b.slotTime },
    amounts: storedAmounts_(b)
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

/* ------------------------------------------------------------------ */
/* Entry check-in (volunteers at the door)                             */
/* ------------------------------------------------------------------ */

/** Volunteers use their own passcode; the admin passcode works too. */
function staffOnly(fn) {
  return function (p) {
    var cache = CacheService.getScriptCache();
    var fails = Number(cache.get('staff_fails') || 0);
    if (fails >= 10) return { ok: false, code: 'LOCKED', error: 'Too many wrong passcodes. Try again in 10 minutes.' };
    var props = PropertiesService.getScriptProperties();
    var given = String(p.passcode || '');
    var ok = given && (given === props.getProperty('VOLUNTEER_PASSCODE') || given === props.getProperty('ADMIN_PASSCODE'));
    if (!ok) {
      cache.put('staff_fails', String(fails + 1), 600);
      return { ok: false, code: 'UNAUTHORISED', error: 'Wrong passcode.' };
    }
    return fn(p);
  };
}

/** Accepts a booking ID, or the text of the entry QR (a link ending in ?b=LH-XXXXX). */
function parseBookingId_(raw) {
  var m = String(raw || '').toUpperCase().match(/LH-[A-Z0-9]{3,12}/);
  return m ? m[0] : '';
}

/** What the volunteer needs to see at the door. */
function entryPass_(b) {
  var kids = Number(b.children) || 0;
  var extra = b.extraParent === 'Yes';
  var slot = null;
  readSlots().forEach(function (s) { if (s.id === b.slotId) slot = s; });
  var verdict = b.status === STATUS.VERIFIED ? (b.checkedInAt ? 'already' : 'valid')
    : b.status === STATUS.PENDING ? 'pending'
    : b.status === STATUS.REJECTED ? 'rejected' : 'unpaid';
  return {
    bookingId: String(b.bookingId), verdict: verdict, status: b.status,
    parentName: b.parentName || '', childNames: b.childNames || '',
    children: kids, parentsIncluded: kids, extraParent: extra, grownUps: kids + (extra ? 1 : 0),
    giftQty: Number(b.giftQty) || 0,
    slotId: b.slotId || '', slotLabel: slot ? slot.label : '', slotTime: b.slotTime || '',
    checkedInAt: b.checkedInAt || ''
  };
}

function apiCheckinLookup(p) {
  var id = parseBookingId_(p.bookingId);
  if (!id) return { ok: false, code: 'BAD_ID', error: "That doesn't look like a booking ID. It starts with LH-." };
  var row = findBooking_(readBookings(), id);
  if (!row) return { ok: false, code: 'NOT_FOUND', error: 'No booking found for ' + id + '.' };
  return { ok: true, pass: entryPass_(row.b) };
}

function apiCheckin(p) {
  var id = parseBookingId_(p.bookingId);
  return withLock(function () {
    var row = id ? findBooking_(readBookings(), id) : null;
    if (!row) return { ok: false, code: 'NOT_FOUND', error: 'No booking found for ' + (id || 'that code') + '.' };
    var pass = entryPass_(row.b);
    if (row.b.status !== STATUS.VERIFIED) return { ok: false, code: 'NOT_CONFIRMED', error: "This booking isn't confirmed, so it can't be checked in.", pass: pass };
    if (row.b.checkedInAt) return { ok: true, already: true, pass: pass };
    var at = new Date();
    updateBooking_(row.rowIndex, { 'Checked In At': at });
    pass.checkedInAt = at.toISOString();
    pass.verdict = 'checkedIn';
    return { ok: true, pass: pass };
  });
}

function apiCheckinUndo(p) {
  var id = parseBookingId_(p.bookingId);
  return withLock(function () {
    var row = id ? findBooking_(readBookings(), id) : null;
    if (!row) return { ok: false, code: 'NOT_FOUND', error: 'No booking found for ' + (id || 'that code') + '.' };
    updateBooking_(row.rowIndex, { 'Checked In At': '' });
    row.b.checkedInAt = '';
    return { ok: true, pass: entryPass_(row.b) };
  });
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
    var arrived = rows.reduce(function (n, r) { return n + (r.b.slotId === s.id && r.b.status === STATUS.VERIFIED && r.b.checkedInAt ? Number(r.b.children) || 0 : 0); }, 0);
    return { id: s.id, label: s.label, time: s.time, capacity: s.capacity, verified: u.verified, pending: u.pending, holds: u.holds, total: u.total, arrived: arrived, soldOut: u.total >= s.capacity };
  });
  var bookings = rows.map(function (r) {
    var b = r.b;
    if (b.status === STATUS.AWAITING && !holdIsLive(b, now)) b.status = STATUS.ABANDONED + ' (hold expired)';
    return b;
  }).reverse();
  return {
    ok: true, slots: slotView, totals: { capacity: totalCapacity, counted: totalCounted }, bookings: bookings, prices: CONFIG.PRICES,
    checkin: { url: CONFIG.SITE_URL + '/checkin', passcode: PropertiesService.getScriptProperties().getProperty('VOLUNTEER_PASSCODE') || '' }
  };
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
  var outcome = withLock(function () {
    var row = findBooking_(readBookings(), String(p.bookingId || ''));
    if (!row) return { ok: false, code: 'NOT_FOUND', error: 'Booking not found.' };
    updateBooking_(row.rowIndex, { 'Status': STATUS.REJECTED, 'Payment Status': PAYMENT.REJECTED, 'Rejection Reason': reason });
    return { ok: true };
  });
  if (!outcome.ok) return outcome;
  var sent = sendRejectionOnce_(String(p.bookingId));
  return sent === false ? { ok: true, emailSent: false, warning: 'Rejected, but the email to the parent could not be sent.' } : { ok: true, emailSent: sent === true };
}

/** Emails the parent that their payment couldn't be verified, once per booking. Returns true (sent), false (failed) or null (nothing to send). */
function sendRejectionOnce_(bookingId) {
  var row = findBooking_(readBookings(), bookingId);
  // Only bookings that sent their payment proof get the "couldn't verify" email (a hold has an email too).
  if (!row || !row.b.email || !row.b.submittedAt || row.b.rejectionEmailSentAt) return null;
  try {
    sendRejectionEmail_(row.b);
    updateBooking_(row.rowIndex, { 'Rejection Email Sent At': new Date() });
    return true;
  } catch (err) {
    console.error('Rejection email failed for ' + bookingId + ': ' + err);
    updateBooking_(row.rowIndex, { 'Admin Notes': appendNote_(row.b.adminNotes, 'Rejection email failed: ' + err) });
    return false;
  }
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
  'Screenshot URL': 'screenshotUrl', 'Screenshot Check': 'screenshotCheck', 'Screenshot Shows': 'screenshotShows',
  'Screenshot Check Note': 'screenshotCheckNote', 'Status': 'status', 'Payment Status': 'paymentStatus', 'Verified Amount': 'verifiedAmount',
  'Verified At': 'verifiedAt', 'Hold Expires At': 'holdExpiresAt', 'Submitted At': 'submittedAt',
  'Pending Email Sent At': 'pendingEmailSentAt', 'Confirmation Email Sent At': 'confirmationEmailSentAt',
  'Rejection Reason': 'rejectionReason', 'Admin Notes': 'adminNotes', 'Rejection Email Sent At': 'rejectionEmailSentAt', 'Checked In At': 'checkedInAt'
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
  var slots = null;
  for (var i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    var b = {};
    for (var c = 0; c < head.length; c++) {
      var key = KEY_BY_HEADER[head[c]];
      if (!key) continue;
      var v = values[i][c];
      b[key] = v instanceof Date ? v.toISOString() : v;
    }
    // The sheet only keeps the slot's time; find which slot that is.
    if (!b.slotId && b.slotTime) {
      slots = slots || readSlots();
      for (var s = 0; s < slots.length; s++) if (sameSlotTime_(slots[s].time, b.slotTime)) b.slotId = slots[s].id;
    }
    out.push({ rowIndex: i + 1, b: b });
  }
  return out;
}

function sameSlotTime_(a, b) {
  var norm = function (t) { return String(t || '').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, '').toLowerCase(); };
  return norm(a) === norm(b);
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
    b.parentName ? "You're booked, " + escapeHtml_(firstName_(b.parentName)) + '!' : "You're booked!",
    '<p>We have verified your payment. See you at the ' + escapeHtml_(CONFIG.EVENT_NAME) + '!</p>' +
      bookingTable_(b, true) +
      '<p><strong>When:</strong> ' + escapeHtml_(CONFIG.EVENT_DATE) + ', ' + escapeHtml_(b.slotTime) + '<br>' +
      '<strong>Where:</strong> ' + escapeHtml_(CONFIG.VENUE) + ' (<a href="' + CONFIG.MAPS_URL + '">map</a>)</p>' +
      '<p>Each child ticket lets in one child and one parent' + (b.extraParent === 'Yes' ? ', and you added one extra parent' : '') + '.</p>' +
      entryQrBlock_(b)
  );
  sendMail_(b.email, subject, html, { entryqr: entryQr_(b.bookingId) });
}

function sendRejectionEmail_(b) {
  var subject = "We couldn't verify your payment (" + b.bookingId + ')';
  var html = emailShell_(
    'Hi ' + escapeHtml_(firstName_(b.parentName)) + ',',
    "<p>We couldn't verify the payment for your " + escapeHtml_(CONFIG.EVENT_NAME) + ' booking, so it is not confirmed.</p>' +
      '<p style="padding:12px 14px;background:#FDEEEC;border-radius:10px;color:#9F2A1E"><strong>Please email a screenshot of your payment to ' +
      '<a href="mailto:' + CONFIG.SENDER_EMAIL + '" style="color:#9F2A1E">' + CONFIG.SENDER_EMAIL + '</a></strong>, with your booking ID ' +
      escapeHtml_(b.bookingId) + '. You can also just reply to this email.</p>' +
      bookingTable_(b, false) +
      '<p>Payment reference we received: <strong>' + escapeHtml_(b.utr || 'Screenshot uploaded') + '</strong></p>'
  );
  sendMail_(b.email, subject, html);
}

/** The alert to Lil' Hoppers for each booking submitted: who, what, the total, and links to check the payment. */
function sendBookingAlert_(b, refund) {
  if (!CONFIG.ALERT_EMAIL) return;
  // Parents' emails matter more: Gmail lets a script email about 100 people a day, so alerts stop first.
  if (MailApp.getRemainingDailyQuota() < 25) { console.warn('Booking alert skipped to save email quota for parents.'); return; }
  var a = storedAmounts_(b);
  var kids = a.children + (a.children === 1 ? ' kid' : ' kids');
  var phone = String(b.phone || '').replace(/\D/g, '');
  var subject = refund
    ? 'Refund needed: ' + b.bookingId + ' paid after ' + b.slotTime + ' filled up (' + rupees(a.total) + ')'
    : 'New booking ' + b.bookingId + ' · ' + b.slotTime + ' · ' + kids + ' · ' + rupees(a.total);
  var row = function (k, v) { return '<tr><td style="padding:5px 12px 5px 0;color:#5E5470;vertical-align:top">' + k + '</td><td style="padding:5px 0">' + v + '</td></tr>'; };
  var extras = [];
  if (a.extraParent) extras.push('extra parent');
  if (a.giftQty) extras.push(a.giftQty + (a.giftQty === 1 ? ' Santa gift' : ' Santa gifts'));
  var html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#2A1D45;max-width:560px">' +
    (refund
      ? '<p style="padding:12px 14px;background:#FDEEEC;border-radius:10px;color:#9F2A1E"><strong>This parent paid after their 20-minute hold ran out, and the slot is now full.</strong> The booking is saved as Rejected. Please refund them, or raise the slot\'s capacity and verify it.</p>'
      : b.status === STATUS.VERIFIED
      ? '<p style="padding:12px 14px;background:#E3F5E9;border-radius:10px;color:#1D6B3A"><strong>Already verified.</strong> You marked this payment Verified before the parent sent their details. Their confirmation with the entry QR has been emailed.</p>'
      : '<p style="padding:12px 14px;background:#FFF6D1;border-radius:10px;color:#5B4A00"><strong>Payment to check.</strong> Match the screenshot with your UPI app, then verify it on the admin page or pick <em>Verified</em> in the sheet. The parent already has the "payment being checked" email.</p>') +
    '<table style="border-collapse:collapse">' +
    row('Booking', '<strong>' + escapeHtml_(b.bookingId) + '</strong>') +
    row('Slot', escapeHtml_(b.slotTime)) +
    row('Parent', escapeHtml_(b.parentName)) +
    row('Phone', escapeHtml_(b.phone) + (phone.length === 10 ? ' · <a href="https://wa.me/91' + phone + '">WhatsApp</a>' : '')) +
    row('Email', '<a href="mailto:' + escapeHtml_(b.email) + '">' + escapeHtml_(b.email) + '</a>') +
    row('Children', escapeHtml_(kids + ': ' + b.childNames)) +
    row('Add-ons', escapeHtml_(extras.length ? extras.join(', ') : 'none')) +
    row('Total', '<strong>' + rupees(a.total) + '</strong>' + (a.couponCode ? ' (' + escapeHtml_(a.couponCode) + ')' : '')) +
    row('Screenshot check', escapeHtml_([b.screenshotCheck, b.screenshotShows].filter(function (x) { return x; }).join(' · ') || 'none')) +
    '</table><p>' +
    (b.screenshotUrl ? '<a href="' + escapeHtml_(b.screenshotUrl) + '">Payment screenshot</a> · ' : '') +
    '<a href="' + CONFIG.SITE_URL + '/admin">Admin page</a> · ' +
    '<a href="https://docs.google.com/spreadsheets/d/' + spreadsheet_().getId() + '/edit">Bookings sheet</a></p></div>';
  MailApp.sendEmail({ to: CONFIG.ALERT_EMAIL, subject: subject, htmlBody: html, name: "Lil' Hoppers bookings" });
}

/** The entry QR: a link to the volunteer check-in page for this booking. */
function entryUrl_(bookingId) { return CONFIG.SITE_URL + '/checkin.html?b=' + encodeURIComponent(bookingId); }

function entryQr_(bookingId) {
  var qr = qrcode(0, 'M');
  qr.addData(entryUrl_(bookingId));
  qr.make();
  // 8px per module and a 4-module quiet zone, so phone cameras pick it up easily.
  var dataUrl = qr.createDataURL(8, 32);
  return Utilities.newBlob(Utilities.base64Decode(dataUrl.split(',')[1]), 'image/gif', 'entry-' + bookingId + '.gif');
}

function entryQrBlock_(b) {
  var kids = Number(b.children) || 0;
  var lets = kids + (kids === 1 ? ' kid' : ' kids') + ' + ' + kids + (kids === 1 ? ' parent' : ' parents') + (b.extraParent === 'Yes' ? ' + 1 extra parent' : '');
  return '<div style="margin:18px 0;padding:20px 16px;border-radius:14px;background:#F1ECFA;text-align:center">' +
    '<div style="font-weight:700;font-size:17px;color:#2A1D45">Show this QR at the entrance</div>' +
    '<img src="cid:entryqr" width="220" height="220" alt="Entry QR code for booking ' + escapeHtml_(b.bookingId) + '" style="display:block;margin:12px auto;width:220px;height:220px;border-radius:10px">' +
    '<div style="font-size:14px;color:#5E5470">Booking <strong style="color:#2A1D45">' + escapeHtml_(b.bookingId) + '</strong> · lets in ' + escapeHtml_(lets) + '</div></div>';
}

function sendMail_(to, subject, html, inlineImages) {
  var me = Session.getEffectiveUser().getEmail();
  if (me && me.toLowerCase() !== CONFIG.SENDER_EMAIL) {
    console.warn('Emails are being sent from ' + me + ', not ' + CONFIG.SENDER_EMAIL + '. Deploy the web app while signed in as ' + CONFIG.SENDER_EMAIL + '.');
  }
  var msg = { to: to, subject: subject, htmlBody: html, name: CONFIG.SENDER_NAME, replyTo: CONFIG.SENDER_EMAIL };
  if (inlineImages) msg.inlineImages = inlineImages;
  MailApp.sendEmail(msg);
}

function bookingTable_(b, verified) {
  var a = storedAmounts_(b);
  var rows = [
    ['Booking ID', '<strong>' + escapeHtml_(b.bookingId) + '</strong>'],
    ['Slot', escapeHtml_(CONFIG.EVENT_DATE + ', ' + b.slotTime)],
    [a.children + (a.children === 1 ? ' kid' : ' kids') + ' + ' + a.children + (a.children === 1 ? ' parent' : ' parents'), rupees(a.discount ? a.ticketsAtFull : a.ticketSubtotal)]
  ];
  if (b.childNames) rows.splice(2, 0, ['Children', escapeHtml_(b.childNames)]); // not known yet if verified before the details
  if (a.extraParent) rows.push(['Extra parent', rupees(a.extraParentCharge)]);
  if (a.giftQty) rows.push(['Personalised gift from Santa (' + a.giftQty + ' × ' + rupees(CONFIG.PRICES.SANTA_GIFT) + ')', rupees(a.giftSubtotal)]);
  if (a.bookingFee) rows.push(['Booking &amp; support fee', rupees(a.bookingFee)]);
  if (a.discount) rows.push(['<span style="color:#1D6B3A">Code ' + escapeHtml_(a.couponCode || 'group discount') + ' applied (' + rupees(a.childPrice) + ' per child)</span>', '<span style="color:#1D6B3A">−' + rupees(a.discount) + '</span>']);
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
  } else {
    // Sheet made by an older version: add any new columns at the end.
    var have = bookings.getRange(1, 1, 1, bookings.getLastColumn()).getValues()[0];
    BOOKING_HEADERS.filter(function (h) { return have.indexOf(h) < 0; }).forEach(function (h) {
      var col = bookings.getLastColumn() + 1;
      bookings.getRange(1, col).setValue(h).setFontWeight('bold').setBackground('#F1ECFA');
    });
  }
  // Bookings keep only the slot's time, not a separate Slot ID column.
  var headNow = bookings.getRange(1, 1, 1, bookings.getLastColumn()).getValues()[0];
  if (headNow.indexOf('Slot ID') >= 0) bookings.deleteColumn(headNow.indexOf('Slot ID') + 1);
  // Status dropdown. Changing a booking to Rejected here (or on the admin page) puts its places back on sale.
  var statusCol = bookings.getRange(1, 1, 1, bookings.getLastColumn()).getValues()[0].indexOf('Status') + 1;
  if (statusCol > 0) {
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList([STATUS.AWAITING, STATUS.PENDING, STATUS.VERIFIED, STATUS.REJECTED, STATUS.ABANDONED], true)
      .setAllowInvalid(false).build();
    bookings.getRange(2, statusCol, Math.max(bookings.getMaxRows() - 1, 1), 1).setDataValidation(rule);
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
  // A separate passcode for volunteers at the door: it opens the check-in page only, not the admin page.
  if (!props.getProperty('VOLUNTEER_PASSCODE')) {
    var vcode = Utilities.getUuid().replace(/-/g, '').slice(0, 6);
    props.setProperty('VOLUNTEER_PASSCODE', vcode);
    console.log('Volunteer passcode: ' + vcode + '  (for ' + CONFIG.SITE_URL + '/checkin; it is also shown on the admin page)');
  }

  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'expireHoldsJob' || h === 'onBookingEdit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('expireHoldsJob').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('onBookingEdit').forSpreadsheet(ss).onEdit().create();

  var me = Session.getEffectiveUser().getEmail();
  console.log(me === CONFIG.SENDER_EMAIL ? 'Emails will be sent from ' + me + '.' : 'WARNING: you are signed in as ' + me + '. Emails must come from ' + CONFIG.SENDER_EMAIL + ', so redo this as that account.');
}

/**
 * Runs when the Bookings sheet is edited by hand.
 * Status set to Verified: the payment is marked verified and the parent gets the confirmation email (once).
 * Status set to Rejected: the payment is marked rejected and the parent is emailed that it couldn't be verified (once).
 * Places are counted from Status, so a rejected booking's places go back on sale.
 */
function onBookingEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== 'Bookings') return;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var statusCol = head.indexOf('Status') + 1;
  var c0 = e.range.getColumn(), c1 = c0 + e.range.getNumColumns() - 1;
  if (statusCol < c0 || statusCol > c1) return;
  var r0 = Math.max(e.range.getRow(), 2), r1 = e.range.getRow() + e.range.getNumRows() - 1;

  var toConfirm = [], toReject = [];
  var outcome = withLock(function () {
    readBookings().forEach(function (row) {
      if (row.rowIndex < r0 || row.rowIndex > r1) return;
      var b = row.b;
      if (b.status === STATUS.VERIFIED) {
        if (b.paymentStatus !== PAYMENT.VERIFIED) {
          var amount = b.verifiedAmount === '' || b.verifiedAmount === null || b.verifiedAmount === undefined ? (Number(b.expectedTotal) || '') : b.verifiedAmount;
          updateBooking_(row.rowIndex, { 'Payment Status': PAYMENT.VERIFIED, 'Verified Amount': amount, 'Verified At': new Date() });
        }
        if (!b.confirmationEmailSentAt && b.email) toConfirm.push(String(b.bookingId));
        if (!b.email && String(b.adminNotes || '').indexOf('Waiting for the parent') < 0) {
          updateBooking_(row.rowIndex, { 'Admin Notes': appendNote_(b.adminNotes, "Waiting for the parent's details: the confirmation email goes out as soon as they submit.") });
        }
      } else if (b.status === STATUS.REJECTED) {
        if (b.paymentStatus !== PAYMENT.REJECTED) updateBooking_(row.rowIndex, { 'Payment Status': PAYMENT.REJECTED });
        if (!b.rejectionEmailSentAt && b.email && b.submittedAt) toReject.push(String(b.bookingId));
      }
    });
    return { ok: true };
  });
  if (!outcome.ok) return;

  toReject.forEach(function (id) { sendRejectionOnce_(id); });
  var rows = readBookings();
  toConfirm.forEach(function (id) {
    var row = findBooking_(rows, id);
    if (!row) return;
    try {
      sendConfirmationEmail_(row.b);
      updateBooking_(row.rowIndex, { 'Confirmation Email Sent At': new Date() });
    } catch (err) {
      console.error('Confirmation email failed for ' + id + ': ' + err);
      updateBooking_(row.rowIndex, { 'Admin Notes': appendNote_(row.b.adminNotes, 'Confirmation email failed: ' + err) });
    }
  });
}

/** Timer job: releases places held by people who never finished paying. */
function expireHoldsJob() {
  withLock(function () {
    expireHolds_(readBookings(), Date.now());
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Vendored: QR Code Generator for JavaScript 1.4.x by Kazuhiko Arase,  */
/* MIT license (https://github.com/kazuhikoarase/qrcode-generator).     */
/* Used to draw the entry QR in the confirmation email. Do not edit.    */
/* ------------------------------------------------------------------ */
var qrcode=function(){var t=function(t,r){var e=t,n=g[r],o=null,i=0,a=null,u=[],f={},c=function(t,r){o=function(t){for(var r=new Array(t),e=0;e<t;e+=1){r[e]=new Array(t);for(var n=0;n<t;n+=1)r[e][n]=null}return r}(i=4*e+17),l(0,0),l(i-7,0),l(0,i-7),s(),h(),d(t,r),e>=7&&v(t),null==a&&(a=p(e,n,u)),w(a,r)},l=function(t,r){for(var e=-1;e<=7;e+=1)if(!(t+e<=-1||i<=t+e))for(var n=-1;n<=7;n+=1)r+n<=-1||i<=r+n||(o[t+e][r+n]=0<=e&&e<=6&&(0==n||6==n)||0<=n&&n<=6&&(0==e||6==e)||2<=e&&e<=4&&2<=n&&n<=4)},h=function(){for(var t=8;t<i-8;t+=1)null==o[t][6]&&(o[t][6]=t%2==0);for(var r=8;r<i-8;r+=1)null==o[6][r]&&(o[6][r]=r%2==0)},s=function(){for(var t=B.getPatternPosition(e),r=0;r<t.length;r+=1)for(var n=0;n<t.length;n+=1){var i=t[r],a=t[n];if(null==o[i][a])for(var u=-2;u<=2;u+=1)for(var f=-2;f<=2;f+=1)o[i+u][a+f]=-2==u||2==u||-2==f||2==f||0==u&&0==f}},v=function(t){for(var r=B.getBCHTypeNumber(e),n=0;n<18;n+=1){var a=!t&&1==(r>>n&1);o[Math.floor(n/3)][n%3+i-8-3]=a}for(n=0;n<18;n+=1){a=!t&&1==(r>>n&1);o[n%3+i-8-3][Math.floor(n/3)]=a}},d=function(t,r){for(var e=n<<3|r,a=B.getBCHTypeInfo(e),u=0;u<15;u+=1){var f=!t&&1==(a>>u&1);u<6?o[u][8]=f:u<8?o[u+1][8]=f:o[i-15+u][8]=f}for(u=0;u<15;u+=1){f=!t&&1==(a>>u&1);u<8?o[8][i-u-1]=f:u<9?o[8][15-u-1+1]=f:o[8][15-u-1]=f}o[i-8][8]=!t},w=function(t,r){for(var e=-1,n=i-1,a=7,u=0,f=B.getMaskFunction(r),c=i-1;c>0;c-=2)for(6==c&&(c-=1);;){for(var g=0;g<2;g+=1)if(null==o[n][c-g]){var l=!1;u<t.length&&(l=1==(t[u]>>>a&1)),f(n,c-g)&&(l=!l),o[n][c-g]=l,-1==(a-=1)&&(u+=1,a=7)}if((n+=e)<0||i<=n){n-=e,e=-e;break}}},p=function(t,r,e){for(var n=A.getRSBlocks(t,r),o=b(),i=0;i<e.length;i+=1){var a=e[i];o.put(a.getMode(),4),o.put(a.getLength(),B.getLengthInBits(a.getMode(),t)),a.write(o)}var u=0;for(i=0;i<n.length;i+=1)u+=n[i].dataCount;if(o.getLengthInBits()>8*u)throw"code length overflow. ("+o.getLengthInBits()+">"+8*u+")";for(o.getLengthInBits()+4<=8*u&&o.put(0,4);o.getLengthInBits()%8!=0;)o.putBit(!1);for(;!(o.getLengthInBits()>=8*u||(o.put(236,8),o.getLengthInBits()>=8*u));)o.put(17,8);return function(t,r){for(var e=0,n=0,o=0,i=new Array(r.length),a=new Array(r.length),u=0;u<r.length;u+=1){var f=r[u].dataCount,c=r[u].totalCount-f;n=Math.max(n,f),o=Math.max(o,c),i[u]=new Array(f);for(var g=0;g<i[u].length;g+=1)i[u][g]=255&t.getBuffer()[g+e];e+=f;var l=B.getErrorCorrectPolynomial(c),h=k(i[u],l.getLength()-1).mod(l);for(a[u]=new Array(l.getLength()-1),g=0;g<a[u].length;g+=1){var s=g+h.getLength()-a[u].length;a[u][g]=s>=0?h.getAt(s):0}}var v=0;for(g=0;g<r.length;g+=1)v+=r[g].totalCount;var d=new Array(v),w=0;for(g=0;g<n;g+=1)for(u=0;u<r.length;u+=1)g<i[u].length&&(d[w]=i[u][g],w+=1);for(g=0;g<o;g+=1)for(u=0;u<r.length;u+=1)g<a[u].length&&(d[w]=a[u][g],w+=1);return d}(o,n)};f.addData=function(t,r){var e=null;switch(r=r||"Byte"){case"Numeric":e=M(t);break;case"Alphanumeric":e=x(t);break;case"Byte":e=m(t);break;case"Kanji":e=L(t);break;default:throw"mode:"+r}u.push(e),a=null},f.isDark=function(t,r){if(t<0||i<=t||r<0||i<=r)throw t+","+r;return o[t][r]},f.getModuleCount=function(){return i},f.make=function(){if(e<1){for(var t=1;t<40;t++){for(var r=A.getRSBlocks(t,n),o=b(),i=0;i<u.length;i++){var a=u[i];o.put(a.getMode(),4),o.put(a.getLength(),B.getLengthInBits(a.getMode(),t)),a.write(o)}var g=0;for(i=0;i<r.length;i++)g+=r[i].dataCount;if(o.getLengthInBits()<=8*g)break}e=t}c(!1,function(){for(var t=0,r=0,e=0;e<8;e+=1){c(!0,e);var n=B.getLostPoint(f);(0==e||t>n)&&(t=n,r=e)}return r}())},f.createTableTag=function(t,r){t=t||2;var e="";e+='<table style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: "+(r=void 0===r?4*t:r)+"px;",e+='">',e+="<tbody>";for(var n=0;n<f.getModuleCount();n+=1){e+="<tr>";for(var o=0;o<f.getModuleCount();o+=1)e+='<td style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: 0px;",e+=" width: "+t+"px;",e+=" height: "+t+"px;",e+=" background-color: ",e+=f.isDark(n,o)?"#000000":"#ffffff",e+=";",e+='"/>';e+="</tr>"}return e+="</tbody>",e+="</table>"},f.createSvgTag=function(t,r,e,n){var o={};"object"==typeof arguments[0]&&(t=(o=arguments[0]).cellSize,r=o.margin,e=o.alt,n=o.title),t=t||2,r=void 0===r?4*t:r,(e="string"==typeof e?{text:e}:e||{}).text=e.text||null,e.id=e.text?e.id||"qrcode-description":null,(n="string"==typeof n?{text:n}:n||{}).text=n.text||null,n.id=n.text?n.id||"qrcode-title":null;var i,a,u,c,g=f.getModuleCount()*t+2*r,l="";for(c="l"+t+",0 0,"+t+" -"+t+",0 0,-"+t+"z ",l+='<svg version="1.1" xmlns="http://www.w3.org/2000/svg"',l+=o.scalable?"":' width="'+g+'px" height="'+g+'px"',l+=' viewBox="0 0 '+g+" "+g+'" ',l+=' preserveAspectRatio="xMinYMin meet"',l+=n.text||e.text?' role="img" aria-labelledby="'+y([n.id,e.id].join(" ").trim())+'"':"",l+=">",l+=n.text?'<title id="'+y(n.id)+'">'+y(n.text)+"</title>":"",l+=e.text?'<description id="'+y(e.id)+'">'+y(e.text)+"</description>":"",l+='<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>',l+='<path d="',a=0;a<f.getModuleCount();a+=1)for(u=a*t+r,i=0;i<f.getModuleCount();i+=1)f.isDark(a,i)&&(l+="M"+(i*t+r)+","+u+c);return l+='" stroke="transparent" fill="black"/>',l+="</svg>"},f.createDataURL=function(t,r){t=t||2,r=void 0===r?4*t:r;var e=f.getModuleCount()*t+2*r,n=r,o=e-r;return I(e,e,function(r,e){if(n<=r&&r<o&&n<=e&&e<o){var i=Math.floor((r-n)/t),a=Math.floor((e-n)/t);return f.isDark(a,i)?0:1}return 1})},f.createImgTag=function(t,r,e){t=t||2,r=void 0===r?4*t:r;var n=f.getModuleCount()*t+2*r,o="";return o+="<img",o+=' src="',o+=f.createDataURL(t,r),o+='"',o+=' width="',o+=n,o+='"',o+=' height="',o+=n,o+='"',e&&(o+=' alt="',o+=y(e),o+='"'),o+="/>"};var y=function(t){for(var r="",e=0;e<t.length;e+=1){var n=t.charAt(e);switch(n){case"<":r+="&lt;";break;case">":r+="&gt;";break;case"&":r+="&amp;";break;case'"':r+="&quot;";break;default:r+=n}}return r};return f.createASCII=function(t,r){if((t=t||1)<2)return function(t){t=void 0===t?2:t;var r,e,n,o,i,a=1*f.getModuleCount()+2*t,u=t,c=a-t,g={"██":"█","█ ":"▀"," █":"▄","  ":" "},l={"██":"▀","█ ":"▀"," █":" ","  ":" "},h="";for(r=0;r<a;r+=2){for(n=Math.floor((r-u)/1),o=Math.floor((r+1-u)/1),e=0;e<a;e+=1)i="█",u<=e&&e<c&&u<=r&&r<c&&f.isDark(n,Math.floor((e-u)/1))&&(i=" "),u<=e&&e<c&&u<=r+1&&r+1<c&&f.isDark(o,Math.floor((e-u)/1))?i+=" ":i+="█",h+=t<1&&r+1>=c?l[i]:g[i];h+="\n"}return a%2&&t>0?h.substring(0,h.length-a-1)+Array(a+1).join("▀"):h.substring(0,h.length-1)}(r);t-=1,r=void 0===r?2*t:r;var e,n,o,i,a=f.getModuleCount()*t+2*r,u=r,c=a-r,g=Array(t+1).join("██"),l=Array(t+1).join("  "),h="",s="";for(e=0;e<a;e+=1){for(o=Math.floor((e-u)/t),s="",n=0;n<a;n+=1)i=1,u<=n&&n<c&&u<=e&&e<c&&f.isDark(o,Math.floor((n-u)/t))&&(i=0),s+=i?g:l;for(o=0;o<t;o+=1)h+=s+"\n"}return h.substring(0,h.length-1)},f.renderTo2dContext=function(t,r){r=r||2;for(var e=f.getModuleCount(),n=0;n<e;n++)for(var o=0;o<e;o++)t.fillStyle=f.isDark(n,o)?"black":"white",t.fillRect(n*r,o*r,r,r)},f};t.stringToBytes=(t.stringToBytesFuncs={default:function(t){for(var r=[],e=0;e<t.length;e+=1){var n=t.charCodeAt(e);r.push(255&n)}return r}}).default,t.createStringToBytes=function(t,r){var e=function(){for(var e=S(t),n=function(){var t=e.read();if(-1==t)throw"eof";return t},o=0,i={};;){var a=e.read();if(-1==a)break;var u=n(),f=n()<<8|n();i[String.fromCharCode(a<<8|u)]=f,o+=1}if(o!=r)throw o+" != "+r;return i}(),n="?".charCodeAt(0);return function(t){for(var r=[],o=0;o<t.length;o+=1){var i=t.charCodeAt(o);if(i<128)r.push(i);else{var a=e[t.charAt(o)];"number"==typeof a?(255&a)==a?r.push(a):(r.push(a>>>8),r.push(255&a)):r.push(n)}}return r}};var r,e,n,o,i,a=1,u=2,f=4,c=8,g={L:1,M:0,Q:3,H:2},l=0,h=1,s=2,v=3,d=4,w=5,p=6,y=7,B=(r=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]],e=1335,n=7973,i=function(t){for(var r=0;0!=t;)r+=1,t>>>=1;return r},(o={}).getBCHTypeInfo=function(t){for(var r=t<<10;i(r)-i(e)>=0;)r^=e<<i(r)-i(e);return 21522^(t<<10|r)},o.getBCHTypeNumber=function(t){for(var r=t<<12;i(r)-i(n)>=0;)r^=n<<i(r)-i(n);return t<<12|r},o.getPatternPosition=function(t){return r[t-1]},o.getMaskFunction=function(t){switch(t){case l:return function(t,r){return(t+r)%2==0};case h:return function(t,r){return t%2==0};case s:return function(t,r){return r%3==0};case v:return function(t,r){return(t+r)%3==0};case d:return function(t,r){return(Math.floor(t/2)+Math.floor(r/3))%2==0};case w:return function(t,r){return t*r%2+t*r%3==0};case p:return function(t,r){return(t*r%2+t*r%3)%2==0};case y:return function(t,r){return(t*r%3+(t+r)%2)%2==0};default:throw"bad maskPattern:"+t}},o.getErrorCorrectPolynomial=function(t){for(var r=k([1],0),e=0;e<t;e+=1)r=r.multiply(k([1,C.gexp(e)],0));return r},o.getLengthInBits=function(t,r){if(1<=r&&r<10)switch(t){case a:return 10;case u:return 9;case f:case c:return 8;default:throw"mode:"+t}else if(r<27)switch(t){case a:return 12;case u:return 11;case f:return 16;case c:return 10;default:throw"mode:"+t}else{if(!(r<41))throw"type:"+r;switch(t){case a:return 14;case u:return 13;case f:return 16;case c:return 12;default:throw"mode:"+t}}},o.getLostPoint=function(t){for(var r=t.getModuleCount(),e=0,n=0;n<r;n+=1)for(var o=0;o<r;o+=1){for(var i=0,a=t.isDark(n,o),u=-1;u<=1;u+=1)if(!(n+u<0||r<=n+u))for(var f=-1;f<=1;f+=1)o+f<0||r<=o+f||0==u&&0==f||a==t.isDark(n+u,o+f)&&(i+=1);i>5&&(e+=3+i-5)}for(n=0;n<r-1;n+=1)for(o=0;o<r-1;o+=1){var c=0;t.isDark(n,o)&&(c+=1),t.isDark(n+1,o)&&(c+=1),t.isDark(n,o+1)&&(c+=1),t.isDark(n+1,o+1)&&(c+=1),0!=c&&4!=c||(e+=3)}for(n=0;n<r;n+=1)for(o=0;o<r-6;o+=1)t.isDark(n,o)&&!t.isDark(n,o+1)&&t.isDark(n,o+2)&&t.isDark(n,o+3)&&t.isDark(n,o+4)&&!t.isDark(n,o+5)&&t.isDark(n,o+6)&&(e+=40);for(o=0;o<r;o+=1)for(n=0;n<r-6;n+=1)t.isDark(n,o)&&!t.isDark(n+1,o)&&t.isDark(n+2,o)&&t.isDark(n+3,o)&&t.isDark(n+4,o)&&!t.isDark(n+5,o)&&t.isDark(n+6,o)&&(e+=40);var g=0;for(o=0;o<r;o+=1)for(n=0;n<r;n+=1)t.isDark(n,o)&&(g+=1);return e+=Math.abs(100*g/r/r-50)/5*10},o),C=function(){for(var t=new Array(256),r=new Array(256),e=0;e<8;e+=1)t[e]=1<<e;for(e=8;e<256;e+=1)t[e]=t[e-4]^t[e-5]^t[e-6]^t[e-8];for(e=0;e<255;e+=1)r[t[e]]=e;var n={glog:function(t){if(t<1)throw"glog("+t+")";return r[t]},gexp:function(r){for(;r<0;)r+=255;for(;r>=256;)r-=255;return t[r]}};return n}();function k(t,r){if(void 0===t.length)throw t.length+"/"+r;var e=function(){for(var e=0;e<t.length&&0==t[e];)e+=1;for(var n=new Array(t.length-e+r),o=0;o<t.length-e;o+=1)n[o]=t[o+e];return n}(),n={getAt:function(t){return e[t]},getLength:function(){return e.length},multiply:function(t){for(var r=new Array(n.getLength()+t.getLength()-1),e=0;e<n.getLength();e+=1)for(var o=0;o<t.getLength();o+=1)r[e+o]^=C.gexp(C.glog(n.getAt(e))+C.glog(t.getAt(o)));return k(r,0)},mod:function(t){if(n.getLength()-t.getLength()<0)return n;for(var r=C.glog(n.getAt(0))-C.glog(t.getAt(0)),e=new Array(n.getLength()),o=0;o<n.getLength();o+=1)e[o]=n.getAt(o);for(o=0;o<t.getLength();o+=1)e[o]^=C.gexp(C.glog(t.getAt(o))+r);return k(e,0).mod(t)}};return n}var A=function(){var t=[[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]],r=function(t,r){var e={};return e.totalCount=t,e.dataCount=r,e},e={};return e.getRSBlocks=function(e,n){var o=function(r,e){switch(e){case g.L:return t[4*(r-1)+0];case g.M:return t[4*(r-1)+1];case g.Q:return t[4*(r-1)+2];case g.H:return t[4*(r-1)+3];default:return}}(e,n);if(void 0===o)throw"bad rs block @ typeNumber:"+e+"/errorCorrectionLevel:"+n;for(var i=o.length/3,a=[],u=0;u<i;u+=1)for(var f=o[3*u+0],c=o[3*u+1],l=o[3*u+2],h=0;h<f;h+=1)a.push(r(c,l));return a},e}(),b=function(){var t=[],r=0,e={getBuffer:function(){return t},getAt:function(r){var e=Math.floor(r/8);return 1==(t[e]>>>7-r%8&1)},put:function(t,r){for(var n=0;n<r;n+=1)e.putBit(1==(t>>>r-n-1&1))},getLengthInBits:function(){return r},putBit:function(e){var n=Math.floor(r/8);t.length<=n&&t.push(0),e&&(t[n]|=128>>>r%8),r+=1}};return e},M=function(t){var r=a,e=t,n={getMode:function(){return r},getLength:function(t){return e.length},write:function(t){for(var r=e,n=0;n+2<r.length;)t.put(o(r.substring(n,n+3)),10),n+=3;n<r.length&&(r.length-n==1?t.put(o(r.substring(n,n+1)),4):r.length-n==2&&t.put(o(r.substring(n,n+2)),7))}},o=function(t){for(var r=0,e=0;e<t.length;e+=1)r=10*r+i(t.charAt(e));return r},i=function(t){if("0"<=t&&t<="9")return t.charCodeAt(0)-"0".charCodeAt(0);throw"illegal char :"+t};return n},x=function(t){var r=u,e=t,n={getMode:function(){return r},getLength:function(t){return e.length},write:function(t){for(var r=e,n=0;n+1<r.length;)t.put(45*o(r.charAt(n))+o(r.charAt(n+1)),11),n+=2;n<r.length&&t.put(o(r.charAt(n)),6)}},o=function(t){if("0"<=t&&t<="9")return t.charCodeAt(0)-"0".charCodeAt(0);if("A"<=t&&t<="Z")return t.charCodeAt(0)-"A".charCodeAt(0)+10;switch(t){case" ":return 36;case"$":return 37;case"%":return 38;case"*":return 39;case"+":return 40;case"-":return 41;case".":return 42;case"/":return 43;case":":return 44;default:throw"illegal char :"+t}};return n},m=function(r){var e=f,n=t.stringToBytes(r),o={getMode:function(){return e},getLength:function(t){return n.length},write:function(t){for(var r=0;r<n.length;r+=1)t.put(n[r],8)}};return o},L=function(r){var e=c,n=t.stringToBytesFuncs.SJIS;if(!n)throw"sjis not supported.";!function(){var t=n("友");if(2!=t.length||38726!=(t[0]<<8|t[1]))throw"sjis not supported."}();var o=n(r),i={getMode:function(){return e},getLength:function(t){return~~(o.length/2)},write:function(t){for(var r=o,e=0;e+1<r.length;){var n=(255&r[e])<<8|255&r[e+1];if(33088<=n&&n<=40956)n-=33088;else{if(!(57408<=n&&n<=60351))throw"illegal char at "+(e+1)+"/"+n;n-=49472}n=192*(n>>>8&255)+(255&n),t.put(n,13),e+=2}if(e<r.length)throw"illegal char at "+(e+1)}};return i},D=function(){var t=[],r={writeByte:function(r){t.push(255&r)},writeShort:function(t){r.writeByte(t),r.writeByte(t>>>8)},writeBytes:function(t,e,n){e=e||0,n=n||t.length;for(var o=0;o<n;o+=1)r.writeByte(t[o+e])},writeString:function(t){for(var e=0;e<t.length;e+=1)r.writeByte(t.charCodeAt(e))},toByteArray:function(){return t},toString:function(){var r="";r+="[";for(var e=0;e<t.length;e+=1)e>0&&(r+=","),r+=t[e];return r+="]"}};return r},S=function(t){var r=t,e=0,n=0,o=0,i={read:function(){for(;o<8;){if(e>=r.length){if(0==o)return-1;throw"unexpected end of file./"+o}var t=r.charAt(e);if(e+=1,"="==t)return o=0,-1;t.match(/^\s$/)||(n=n<<6|a(t.charCodeAt(0)),o+=6)}var i=n>>>o-8&255;return o-=8,i}},a=function(t){if(65<=t&&t<=90)return t-65;if(97<=t&&t<=122)return t-97+26;if(48<=t&&t<=57)return t-48+52;if(43==t)return 62;if(47==t)return 63;throw"c:"+t};return i},I=function(t,r,e){for(var n=function(t,r){var e=t,n=r,o=new Array(t*r),i={setPixel:function(t,r,n){o[r*e+t]=n},write:function(t){t.writeString("GIF87a"),t.writeShort(e),t.writeShort(n),t.writeByte(128),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(255),t.writeByte(255),t.writeByte(255),t.writeString(","),t.writeShort(0),t.writeShort(0),t.writeShort(e),t.writeShort(n),t.writeByte(0);var r=a(2);t.writeByte(2);for(var o=0;r.length-o>255;)t.writeByte(255),t.writeBytes(r,o,255),o+=255;t.writeByte(r.length-o),t.writeBytes(r,o,r.length-o),t.writeByte(0),t.writeString(";")}},a=function(t){for(var r=1<<t,e=1+(1<<t),n=t+1,i=u(),a=0;a<r;a+=1)i.add(String.fromCharCode(a));i.add(String.fromCharCode(r)),i.add(String.fromCharCode(e));var f,c,g,l=D(),h=(f=l,c=0,g=0,{write:function(t,r){if(t>>>r!=0)throw"length over";for(;c+r>=8;)f.writeByte(255&(t<<c|g)),r-=8-c,t>>>=8-c,g=0,c=0;g|=t<<c,c+=r},flush:function(){c>0&&f.writeByte(g)}});h.write(r,n);var s=0,v=String.fromCharCode(o[s]);for(s+=1;s<o.length;){var d=String.fromCharCode(o[s]);s+=1,i.contains(v+d)?v+=d:(h.write(i.indexOf(v),n),i.size()<4095&&(i.size()==1<<n&&(n+=1),i.add(v+d)),v=d)}return h.write(i.indexOf(v),n),h.write(e,n),h.flush(),l.toByteArray()},u=function(){var t={},r=0,e={add:function(n){if(e.contains(n))throw"dup key:"+n;t[n]=r,r+=1},size:function(){return r},indexOf:function(r){return t[r]},contains:function(r){return void 0!==t[r]}};return e};return i}(t,r),o=0;o<r;o+=1)for(var i=0;i<t;i+=1)n.setPixel(i,o,e(i,o));var a=D();n.write(a);for(var u=function(){var t=0,r=0,e=0,n="",o={},i=function(t){n+=String.fromCharCode(a(63&t))},a=function(t){if(t<0);else{if(t<26)return 65+t;if(t<52)return t-26+97;if(t<62)return t-52+48;if(62==t)return 43;if(63==t)return 47}throw"n:"+t};return o.writeByte=function(n){for(t=t<<8|255&n,r+=8,e+=1;r>=6;)i(t>>>r-6),r-=6},o.flush=function(){if(r>0&&(i(t<<6-r),t=0,r=0),e%3!=0)for(var o=3-e%3,a=0;a<o;a+=1)n+="="},o.toString=function(){return n},o}(),f=a.toByteArray(),c=0;c<f.length;c+=1)u.writeByte(f[c]);return u.flush(),"data:image/gif;base64,"+u};return t}();qrcode.stringToBytesFuncs["UTF-8"]=function(t){return function(t){for(var r=[],e=0;e<t.length;e++){var n=t.charCodeAt(e);n<128?r.push(n):n<2048?r.push(192|n>>6,128|63&n):n<55296||n>=57344?r.push(224|n>>12,128|n>>6&63,128|63&n):(e++,n=65536+((1023&n)<<10|1023&t.charCodeAt(e)),r.push(240|n>>18,128|n>>12&63,128|n>>6&63,128|63&n))}return r}(t)};
