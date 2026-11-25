// Backend tests: runs apps-script/Code.gs against in-memory stand-ins for Google services.
// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeSheet(name) {
  const data = [];
  const sheet = {
    name, data,
    getName: () => name,
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    appendRow: (row) => { data.push(row.slice()); },
    getLastRow: () => data.length,
    getLastColumn: () => data.reduce((m, r) => Math.max(m, r.length), 0),
    getRange: (r, c, nr = 1, nc = 1) => {
      const api = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((data[r - 1 + i] || [])[c - 1 + j]))),
        setValue: (v) => { while (data.length < r) data.push([]); data[r - 1][c - 1] = v; return api; },
        setFontWeight: () => api,
        setBackground: () => api,
        setDataValidation: (rule) => { sheet.validation = { col: c, rule }; return api; }
      };
      return api;
    },
    getMaxRows: () => 1000,
    deleteColumn: (c) => { data.forEach((r) => r.splice(c - 1, 1)); },
    setFrozenRows: () => {}
  };
  return sheet;
}

function load() {
  const sheets = {};
  const ss = {
    getId: () => 'sheet-id',
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: (s) => { delete sheets[s.name]; }
  };
  const props = {};
  const cache = {};
  const mails = []; // emails to parents
  const alerts = []; // booking alerts to Lil' Hoppers
  const quota = { left: 100 };
  const files = [];
  let lockHeld = false;
  const triggers = [];
  let uuidN = 1;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, openById: () => ss, flush() {},
      newDataValidation: () => { const r = {}; const b = { requireValueInList: (v) => { r.list = v; return b; }, setAllowInvalid: () => b, build: () => r }; return b; }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { assert.equal(lockHeld, false, 'lock must not be re-entered'); lockHeld = true; return true; },
        releaseLock: () => { lockHeld = false; }
      })
    },
    DriveApp: {
      createFolder: () => ({ getId: () => 'folder-1' }),
      getFolderById: () => ({ createFile: (blob) => { files.push(blob); return { getUrl: () => 'https://drive.google.com/file/d/' + files.length }; } })
    },
    Utilities: {
      base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      getUuid: () => (uuidN++) + 'bcdef12-3456-7890-abcd-ef1234567890'
    },
    MailApp: { sendEmail: (m) => (m.to === 'hello.lilhoppers@gmail.com' ? alerts : mails).push(m), getRemainingDailyQuota: () => quota.left },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'hello.lilhoppers@gmail.com' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
    ScriptApp: {
      getProjectTriggers: () => [],
      deleteTrigger() {},
      newTrigger: (h) => ({
        timeBased: () => ({ everyMinutes: () => ({ create() { triggers.push(h); } }) }),
        forSpreadsheet: () => ({ onEdit: () => ({ create() { triggers.push(h); } }) })
      })
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), ctx);
  ctx.setup();
  // The booking page sends email and phone with every hold; tests that leave the keys out get them filled in.
  // (Pass email: undefined to send a hold without contact, like a page loaded before that change.)
  const call = (body) => {
    if (body.action === 'createHold' && !('email' in body) && !('phone' in body)) body = { ...body, email: 'meera@example.com', phone: '98450 12345' };
    return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  };
  return { ctx, call, sheets, props, mails, alerts, quota, files, triggers };
}

const details = (n = 1, extra = {}) => ({
  parentName: 'Meera Iyer', email: 'meera@example.com', phone: '98450 12345',
  childNames: Array.from({ length: n }, (_, i) => 'Kid ' + (i + 1)),
  screenshot: { name: 'pay.png', mimeType: 'image/png', data: Buffer.from('fake-png').toString('base64') }, ...extra
});

function bookingRow(env, id) {
  const sh = env.sheets.Bookings.data;
  const head = sh[0];
  const row = sh.find((r) => r[0] === id);
  return Object.fromEntries(head.map((h, i) => [h, row[i]]));
}

test('price examples from the PRD', () => {
  const { ctx } = load();
  // Every booking adds the flat ₹39 booking & support fee.
  assert.equal(ctx.computeAmounts(1, false, 1).total, 1237);
  assert.equal(ctx.computeAmounts(1, false, 0).total, 938);
  assert.equal(ctx.computeAmounts(1, true, 1).total, 1436);
  // Group deals apply by themselves: LILHOP2 (₹799 each) from 2 kids, LILHOP5 (₹749 each) from 5.
  const three = ctx.computeAmounts(3, true, 2);
  assert.deepEqual([three.ticketsAtFull, three.discount, three.ticketSubtotal, three.extraParentCharge, three.giftSubtotal, three.bookingFee, three.total], [2697, 300, 2397, 199, 598, 39, 3233]);
  const deal = (n) => { const a = ctx.computeAmounts(n, false, 0); return [a.childPrice, a.couponCode, a.discount]; };
  assert.deepEqual(deal(1), [899, '', 0]);
  assert.deepEqual(deal(2), [799, 'LILHOP2', 200]);
  assert.deepEqual(deal(4), [799, 'LILHOP2', 400]);
  assert.deepEqual(deal(5), [749, 'LILHOP5', 750]);
  assert.deepEqual(deal(10), [749, 'LILHOP5', 1500]);
  assert.equal(ctx.computeAmounts(2, false, 0).total, 2 * 799 + 39);
  assert.equal(ctx.computeAmounts(5, true, 5).total, 5 * 749 + 199 + 5 * 299 + 39);
});

test('setup creates three slots of 40 kids (120 in all) and an admin passcode', () => {
  const env = load();
  const caps = env.sheets.Slots.data.slice(1).map((r) => r[3]);
  assert.deepEqual(caps, [40, 40, 40]);
  assert.equal(caps.reduce((a, b) => a + b), 120);
  assert.ok(env.props.ADMIN_PASSCODE && env.props.ADMIN_PASSCODE.length >= 8);
});

test('availability shows only sold-out flags, never counts or capacity', () => {
  const env = load();
  const res = env.call({ action: 'availability' });
  assert.equal(res.ok, true);
  for (const s of res.slots) assert.deepEqual(Object.keys(s).sort(), ['id', 'label', 'soldOut', 'time']);
  assert.ok(!JSON.stringify(res).includes('capacity'));
});

test('server computes the amount and the UPI link, ignoring anything the browser claims', () => {
  const env = load();
  const res = env.call({ action: 'createHold', slotId: 'S1', children: 1, extraParent: true, giftQty: 1, total: 5 });
  assert.equal(res.ok, true);
  assert.equal(res.amounts.total, 1436);
  assert.equal(res.amounts.bookingFee, 39);
  assert.match(res.upi.uri, /^upi:\/\/pay\?pa=ahilapil\.26-1@okicici&pn=Lil%20Hoppers&am=1436\.00&cu=INR&tn=LH-/);
  const row = bookingRow(env, res.bookingId);
  assert.equal(row['Status'], 'Awaiting Payment');
  assert.equal(row['Expected Total'], 1436);
  assert.equal(row['Extra Parent'], 'Yes');
  assert.equal(row['Santa Gift Qty'], 1);
});

test('selection rules: gift quantity up to the number of children, max one extra parent, 1–10 children', () => {
  const env = load();
  assert.equal(env.call({ action: 'createHold', slotId: 'S1', children: 2, giftQty: 3 }).code, 'BAD_GIFTS');
  assert.equal(env.call({ action: 'createHold', slotId: 'S1', children: 0, giftQty: 0 }).code, 'BAD_CHILDREN');
  assert.equal(env.call({ action: 'createHold', slotId: 'S1', children: 11, giftQty: 0 }).code, 'BAD_CHILDREN');
  assert.equal(env.call({ action: 'createHold', slotId: 'S1', children: 1, extraParent: 2 }).code, 'BAD_EXTRA_PARENT');
  assert.equal(env.call({ action: 'createHold', slotId: 'S9', children: 1 }).code, 'BAD_SLOT');
  assert.equal(env.call({ action: 'createHold', slotId: 'S1', children: 2, giftQty: 2 }).ok, true);
});

test('capacity counts children: slot 1 takes exactly 40, then Sold Out', () => {
  const env = load();
  const results = [];
  for (let i = 0; i < 45; i++) results.push(env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 }));
  assert.equal(results.filter((r) => r.ok).length, 40);
  assert.equal(results[40].code, 'SOLD_OUT');
  assert.equal(env.call({ action: 'availability' }).slots.find((s) => s.id === 'S1').soldOut, true);
  assert.equal(env.call({ action: 'availability' }).slots.find((s) => s.id === 'S2').soldOut, false);
});

test('a booking larger than the places left is refused without revealing numbers', () => {
  const env = load();
  for (let i = 0; i < 12; i++) env.call({ action: 'createHold', slotId: 'S2', children: 3, giftQty: 0 }); // 36 of 40
  const res = env.call({ action: 'createHold', slotId: 'S2', children: 5, giftQty: 0 });
  assert.equal(res.code, 'NOT_ENOUGH_PLACES');
  assert.doesNotMatch(res.error, /\b4\b|\b40\b|left:/);
  assert.equal(env.call({ action: 'createHold', slotId: 'S2', children: 4, giftQty: 0 }).ok, true);
});

test('abandoned (expired hold) and rejected bookings free their places; pending and verified keep them', () => {
  const env = load();
  const holds = [];
  for (let i = 0; i < 40; i++) holds.push(env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 }));
  // 1: submitted (pending) 2: verified 3: rejected 4: hold expires
  env.call({ action: 'submitBooking', bookingId: holds[0].bookingId, ...details() });
  env.call({ action: 'submitBooking', bookingId: holds[1].bookingId, ...details() });
  env.call({ action: 'adminVerify', passcode: env.props.ADMIN_PASSCODE, bookingId: holds[1].bookingId, verifiedAmount: 899 });
  env.call({ action: 'submitBooking', bookingId: holds[2].bookingId, ...details() });
  env.call({ action: 'adminReject', passcode: env.props.ADMIN_PASSCODE, bookingId: holds[2].bookingId, reason: 'Payment not received' });
  const sh = env.sheets.Bookings.data;
  const col = sh[0].indexOf('Hold Expires At');
  sh.find((r) => r[0] === holds[3].bookingId)[col] = new Date(Date.now() - 1000);

  const list = env.call({ action: 'adminList', passcode: env.props.ADMIN_PASSCODE });
  const s1 = list.slots.find((s) => s.id === 'S1');
  assert.deepEqual([s1.verified, s1.pending, s1.total], [1, 1, 38]);
  assert.equal(env.call({ action: 'createHold', slotId: 'S1', children: 2, giftQty: 0 }).ok, true);
  assert.equal(env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 }).code, 'SOLD_OUT');
  assert.equal(bookingRow(env, holds[3].bookingId)['Status'], 'Abandoned');
});

test('changing the selection releases the previous hold', () => {
  const env = load();
  const first = env.call({ action: 'createHold', slotId: 'S3', children: 2, giftQty: 2 });
  const second = env.call({ action: 'createHold', slotId: 'S3', children: 1, giftQty: 1, previousBookingId: first.bookingId });
  assert.equal(second.ok, true);
  assert.equal(second.bookingId, first.bookingId, 'editing keeps the same booking');
  const row = bookingRow(env, first.bookingId);
  assert.deepEqual([row['Status'], row['Children'], row['Expected Total']], ['Awaiting Payment', 1, 1237]);
  assert.equal(env.sheets.Bookings.data.filter((r) => r[0] === first.bookingId).length, 1, 'no extra row');
});

test('editing a hold counts its own places only once, and a change that does not fit keeps the old hold', () => {
  const env = load();
  env.call({ action: 'adminUpdateCapacity', passcode: env.props.ADMIN_PASSCODE, slotId: 'S1', capacity: 3 });
  const mine = env.call({ action: 'createHold', slotId: 'S1', children: 3, giftQty: 0 });
  assert.equal(mine.ok, true);
  // Same 3 places, now with gifts: fits, because its own places aren't counted twice.
  const edited = env.call({ action: 'createHold', slotId: 'S1', children: 3, giftQty: 3, previousBookingId: mine.bookingId });
  assert.equal(edited.ok, true);
  assert.equal(edited.amounts.total, 3 * 799 + 3 * 299 + 39);
  // 4 children won't fit: refused, and the 3-child hold is still there.
  const tooMany = env.call({ action: 'createHold', slotId: 'S1', children: 4, giftQty: 0, previousBookingId: mine.bookingId });
  assert.equal(tooMany.code, 'NOT_ENOUGH_PLACES');
  const row = bookingRow(env, mine.bookingId);
  assert.deepEqual([row['Status'], row['Children']], ['Awaiting Payment', 3]);
  // Moving it to another slot frees Slot 1.
  const moved = env.call({ action: 'createHold', slotId: 'S2', children: 3, giftQty: 0, previousBookingId: mine.bookingId });
  assert.equal(moved.bookingId, mine.bookingId);
  assert.equal(bookingRow(env, mine.bookingId)['Slot Time'], '4:00 PM – 5:30 PM');
  assert.equal(env.call({ action: 'createHold', slotId: 'S1', children: 3, giftQty: 0 }).ok, true);
});

test('editing a hold that has already run out starts a new booking', () => {
  const env = load();
  const first = env.call({ action: 'createHold', slotId: 'S3', children: 1, giftQty: 0 });
  const sh = env.sheets.Bookings.data;
  sh.find((r) => r[0] === first.bookingId)[sh[0].indexOf('Hold Expires At')] = new Date(Date.now() - 1000);
  const again = env.call({ action: 'createHold', slotId: 'S3', children: 2, giftQty: 0, previousBookingId: first.bookingId });
  assert.equal(again.ok, true);
  assert.notEqual(again.bookingId, first.bookingId);
  assert.equal(bookingRow(env, first.bookingId)['Status'], 'Abandoned');
});

test('submitting proof: saves details, screenshot to Drive, sets Pending, sends the pending email from hello.lilhoppers', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S2', children: 2, extraParent: false, giftQty: 1 });
  const res = env.call({
    action: 'submitBooking', bookingId: hold.bookingId, ...details(2, { utr: '' }),
    screenshot: { name: 'pay.png', mimeType: 'image/png', data: Buffer.from('fake-png').toString('base64') }
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 'Pending Verification');
  const row = bookingRow(env, hold.bookingId);
  assert.equal(row['Payment Status'], 'Pending');
  assert.equal(row['Child Names'], 'Kid 1, Kid 2');
  assert.equal(row['Phone'], '9845012345');
  assert.match(row['Screenshot URL'], /^https:\/\/drive\.google\.com/);
  assert.equal(env.files[0].name, hold.bookingId + '-payment.png');
  assert.equal(Object.prototype.toString.call(row['Pending Email Sent At']), '[object Date]');
  assert.equal(env.mails.length, 1);
  assert.equal(env.mails[0].to, 'meera@example.com');
  assert.equal(env.mails[0].replyTo, 'hello.lilhoppers@gmail.com');
  assert.match(env.mails[0].subject, /payment being checked/);
  assert.match(env.mails[0].htmlBody, /not confirmed yet/);
  assert.match(env.mails[0].htmlBody, /Booking &amp; support fee<\/td><td[^>]*>₹39/);
  assert.match(env.mails[0].htmlBody, /Code LILHOP2 applied \(₹799 per child\)/);
  assert.match(env.mails[0].htmlBody, /−₹200/);
  assert.match(env.mails[0].htmlBody, /₹1,936/);
});

test('screenshot check result is saved to the sheet and shown to admin; a failed check is refused', () => {
  const env = load();
  const shot = { name: 'pay.png', mimeType: 'image/png', data: Buffer.from('fake-png').toString('base64') };
  const hold = env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 1 });
  const bad = env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(1, { utr: '' }), screenshot: shot,
    screenshotCheck: { status: 'fail', shows: '16 Nov 2026, 8:53 AM', summary: 'This screenshot is from 16 Nov 2026, 8:53 AM, not today.' } });
  assert.equal(bad.code, 'SCREENSHOT_MISMATCH');
  assert.equal(bookingRow(env, hold.bookingId)['Status'], 'Awaiting Payment');
  assert.equal(env.files.length, 0);

  const ok = env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(1, { utr: '' }), screenshot: shot,
    screenshotCheck: { status: 'pass', shows: '17 Nov 2026, 1:42 PM', summary: 'Paid to AHILA PICHAIPILLAI · paid today 1:42 PM (3 min before upload) · amount ₹1,198 seen' } });
  assert.equal(ok.ok, true);
  const row = bookingRow(env, hold.bookingId);
  assert.equal(row['Screenshot Check'], 'Passed');
  assert.equal(row['Screenshot Shows'], '17 Nov 2026, 1:42 PM');
  assert.match(row['Screenshot Check Note'], /3 min before upload/);
  const listed = env.call({ action: 'adminList', passcode: env.props.ADMIN_PASSCODE }).bookings.find((b) => b.bookingId === hold.bookingId);
  assert.equal(listed.screenshotCheck, 'Passed');
  assert.equal(listed.screenshotShows, '17 Nov 2026, 1:42 PM');

  const hold2 = env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 });
  env.call({ action: 'submitBooking', bookingId: hold2.bookingId, ...details(1, { utr: '' }), screenshot: shot });
  assert.equal(bookingRow(env, hold2.bookingId)['Screenshot Check'], 'Not checked');
});

test('proof is required: the payment screenshot (a transaction ID alone is not enough)', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 1 });
  const noShot = env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(1, { screenshot: undefined, utr: '412345678901' }) });
  assert.equal(noShot.code, 'NO_PROOF');
  assert.equal(noShot.error, 'Upload the screenshot of your payment.');
  assert.equal(env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(1, { phone: '12345' }) }).code, 'BAD_PHONE');
  assert.equal(env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(1, { email: 'nope' }) }).code, 'BAD_EMAIL');
  assert.equal(env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(2) }).code, 'BAD_CHILD_NAMES');
});

test('confirmation email only after admin verification; verified amount saved', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S3', children: 1, giftQty: 1 });
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details() });
  assert.equal(env.mails.length, 1);
  assert.equal(bookingRow(env, hold.bookingId)['Payment Status'], 'Pending');
  const bad = env.call({ action: 'adminVerify', passcode: 'wrong', bookingId: hold.bookingId, verifiedAmount: 1198 });
  assert.equal(bad.code, 'UNAUTHORISED');
  assert.equal(env.mails.length, 1);
  const ok = env.call({ action: 'adminVerify', passcode: env.props.ADMIN_PASSCODE, bookingId: hold.bookingId, verifiedAmount: 1198, note: 'Matched GPay' });
  assert.equal(ok.ok, true);
  assert.equal(ok.emailSent, true);
  const row = bookingRow(env, hold.bookingId);
  assert.deepEqual([row['Status'], row['Payment Status'], row['Verified Amount'], row['Admin Notes']], ['Verified', 'Verified', 1198, 'Matched GPay']);
  assert.equal(env.mails.length, 2);
  assert.match(env.mails[1].subject, /You're booked/);
  assert.match(env.mails[1].htmlBody, /Amount received/);
  assert.equal(env.call({ action: 'adminVerify', passcode: env.props.ADMIN_PASSCODE, bookingId: hold.bookingId, verifiedAmount: 1198 }).code, 'BAD_STATE');
});

test('expired hold + slot now full: the submission is kept as Rejected for a refund', () => {
  const env = load();
  const mine = env.call({ action: 'createHold', slotId: 'S1', children: 2, giftQty: 0 });
  const sh = env.sheets.Bookings.data;
  sh.find((r) => r[0] === mine.bookingId)[sh[0].indexOf('Hold Expires At')] = new Date(Date.now() - 1000);
  for (let i = 0; i < 39; i++) env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 });
  const res = env.call({ action: 'submitBooking', bookingId: mine.bookingId, ...details(2) });
  assert.equal(res.code, 'FULL_AFTER_EXPIRY');
  const row = bookingRow(env, mine.bookingId);
  assert.equal(row['Status'], 'Rejected');
  assert.match(row['Rejection Reason'], /refund due/);
  assert.ok(row['Screenshot URL'], 'the screenshot is kept so the refund can be checked');
});

test('expired hold but places still free: the booking goes through', () => {
  const env = load();
  const mine = env.call({ action: 'createHold', slotId: 'S3', children: 1, giftQty: 1 });
  const sh = env.sheets.Bookings.data;
  sh.find((r) => r[0] === mine.bookingId)[sh[0].indexOf('Hold Expires At')] = new Date(Date.now() - 1000);
  const res = env.call({ action: 'submitBooking', bookingId: mine.bookingId, ...details() });
  assert.equal(res.status, 'Pending Verification');
});

test('a double submit does not create a second booking or a second email', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 1 });
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details() });
  const again = env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details() });
  assert.equal(again.status, 'Pending Verification');
  assert.equal(env.mails.length, 1);
});

test('admin can change capacity; lower than the count makes the slot sold out', () => {
  const env = load();
  for (let i = 0; i < 5; i++) env.call({ action: 'createHold', slotId: 'S3', children: 1, giftQty: 0 });
  assert.equal(env.call({ action: 'adminUpdateCapacity', passcode: env.props.ADMIN_PASSCODE, slotId: 'S3', capacity: 4 }).ok, true);
  assert.equal(env.call({ action: 'availability' }).slots.find((s) => s.id === 'S3').soldOut, true);
  assert.equal(env.call({ action: 'adminUpdateCapacity', passcode: env.props.ADMIN_PASSCODE, slotId: 'S3', capacity: 40 }).ok, true);
  const list = env.call({ action: 'adminList', passcode: env.props.ADMIN_PASSCODE });
  assert.equal(list.totals.capacity, 40 + 40 + 40);
  assert.equal(env.call({ action: 'adminUpdateCapacity', passcode: env.props.ADMIN_PASSCODE, slotId: 'S3', capacity: -1 }).code, 'BAD_CAPACITY');
});

test('admin list carries the itemized payment breakdown for every booking', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S1', children: 3, extraParent: true, giftQty: 2 });
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(3) });
  const b = env.call({ action: 'adminList', passcode: env.props.ADMIN_PASSCODE }).bookings[0];
  assert.deepEqual(
    [b.ticketSubtotal, b.extraParentCharge, b.giftQty, b.giftSubtotal, b.expectedTotal, b.verifiedAmount],
    [2397, 199, 2, 598, 3233, '']
  );
});

test('wrong passcodes lock the admin out after 10 tries', () => {
  const env = load();
  for (let i = 0; i < 10; i++) env.call({ action: 'adminList', passcode: 'x' });
  assert.equal(env.call({ action: 'adminList', passcode: env.props.ADMIN_PASSCODE }).code, 'LOCKED');
});

test('browser price maths (assets/js/pricing.js) matches the backend for every combination', () => {
  const { ctx } = load();
  const P = require('../assets/js/pricing.js');
  // The site's prices (assets/js/config.js) must be the backend's prices.
  const win = {}; new Function('window', require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'js', 'config.js'), 'utf8'))(win);
  const prices = win.LH_CONFIG.PRICES;
  assert.deepEqual({ ...prices }, JSON.parse(JSON.stringify(ctx.CONFIG.PRICES)));
  for (let n = 1; n <= 10; n++) for (const x of [false, true]) for (let g = 0; g <= n; g++) {
    assert.deepEqual(JSON.parse(JSON.stringify(P.computeAmounts(prices, n, x, g))), JSON.parse(JSON.stringify(ctx.computeAmounts(n, x, g))));
  }
  assert.equal(P.rupees(1198), '₹1,198');
  assert.equal(P.rupees(123456), '₹1,23,456');
  assert.equal(P.upiUri('ahilapil.26-1@okicici', 'Lil Hoppers', 1198, 'LH-AB123'), ctx.upiUri(1198, 'LH-AB123'));
});

test('bookings sheet has no Slot ID column; an older sheet loses it on setup and counting still works', () => {
  const env = load();
  assert.equal(env.sheets.Bookings.data[0].includes('Slot ID'), false);
  assert.equal(env.sheets.Bookings.data[0].includes('Slot Time'), true);
  for (let i = 0; i < 40; i++) env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 0 });
  assert.equal(env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 0 }).code, 'SOLD_OUT');
  assert.equal(env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 }).ok, true);

  // An older sheet with a Slot ID column next to Slot Time:
  const sh = env.sheets.Bookings.data;
  const at = sh[0].indexOf('Slot Time');
  sh.forEach((r, i) => r.splice(at, 0, i === 0 ? 'Slot ID' : 'S2'));
  env.ctx.setup();
  assert.equal(sh[0].includes('Slot ID'), false);
  assert.equal(env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 0 }).code, 'SOLD_OUT');
  // Typed with a plain hyphen instead of an en dash still matches.
  sh.slice(1).forEach((r) => { if (/^4:00/.test(r[at])) r[at] = '4:00 PM - 5:30 PM'; });
  assert.equal(env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 0 }).code, 'SOLD_OUT');
});

test('Status column has a dropdown of the booking statuses', () => {
  const env = load();
  const v = env.sheets.Bookings.validation;
  assert.equal(v.col, env.sheets.Bookings.data[0].indexOf('Status') + 1);
  assert.deepEqual([...v.rule.list], ['Awaiting Payment', 'Pending Verification', 'Verified', 'Rejected', 'Abandoned']);
});

test('a verified booking can be rejected and its places go back on sale', () => {
  const env = load();
  const P = env.props.ADMIN_PASSCODE;
  env.call({ action: 'adminUpdateCapacity', passcode: P, slotId: 'S3', capacity: 2 });
  const hold = env.call({ action: 'createHold', slotId: 'S3', children: 2, giftQty: 0 });
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(2) });
  assert.equal(env.call({ action: 'adminVerify', passcode: P, bookingId: hold.bookingId, verifiedAmount: 1798 }).ok, true);
  assert.equal(env.call({ action: 'createHold', slotId: 'S3', children: 1, giftQty: 0 }).code, 'SOLD_OUT');
  const res = env.call({ action: 'adminReject', passcode: P, bookingId: hold.bookingId, reason: 'Cancelled by parent' });
  assert.equal(res.ok, true);
  assert.equal(bookingRow(env, hold.bookingId)['Status'], 'Rejected');
  const s3 = env.call({ action: 'adminList', passcode: P }).slots.find((s) => s.id === 'S3');
  assert.equal(s3.verified, 0);
  assert.equal(env.call({ action: 'createHold', slotId: 'S3', children: 2, giftQty: 0 }).ok, true);
});

test('changing Status to Rejected straight in the sheet also frees the places', () => {
  const env = load();
  const P = env.props.ADMIN_PASSCODE;
  env.call({ action: 'adminUpdateCapacity', passcode: P, slotId: 'S1', capacity: 1 });
  const hold = env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 });
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(1) });
  env.call({ action: 'adminVerify', passcode: P, bookingId: hold.bookingId, verifiedAmount: 899 });
  assert.equal(env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 }).code, 'SOLD_OUT');
  const sh = env.sheets.Bookings.data;
  sh.find((r) => r[0] === hold.bookingId)[sh[0].indexOf('Status')] = 'Rejected';
  assert.equal(env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 }).ok, true);
});

// Simulates a hand edit of one Status cell, as the sheet's edit trigger would see it.
function editStatus(env, bookingId, value) {
  const sh = env.sheets.Bookings;
  const col = sh.data[0].indexOf('Status');
  const r = sh.data.findIndex((row) => row[0] === bookingId);
  sh.data[r][col] = value;
  env.ctx.onBookingEdit({ range: { getSheet: () => sh, getRow: () => r + 1, getNumRows: () => 1, getColumn: () => col + 1, getNumColumns: () => 1 }, value });
}

test('setup installs the sheet edit trigger', () => {
  const env = load();
  assert.ok(env.triggers.includes('onBookingEdit'));
  assert.ok(env.triggers.includes('expireHoldsJob'));
});

test('setting Status to Verified in the sheet sends the confirmation email once', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 1 });
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details() });
  assert.equal(env.mails.length, 1); // "we're checking your payment"
  editStatus(env, hold.bookingId, 'Verified');
  assert.equal(env.mails.length, 2);
  assert.match(env.mails[1].subject, /You're booked/);
  assert.equal(env.mails[1].to, 'meera@example.com');
  const row = bookingRow(env, hold.bookingId);
  assert.equal(row['Payment Status'], 'Verified');
  assert.equal(row['Verified Amount'], 1237);
  assert.ok(row['Verified At'] && typeof row['Verified At'].getTime === 'function');
  assert.ok(row['Confirmation Email Sent At'] && typeof row['Confirmation Email Sent At'].getTime === 'function');
  editStatus(env, hold.bookingId, 'Verified');
  assert.equal(env.mails.length, 2, 'no second email');
});

test('a booking already confirmed on the admin page gets no extra email from the sheet', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 });
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details() });
  env.call({ action: 'adminVerify', passcode: env.props.ADMIN_PASSCODE, bookingId: hold.bookingId, verifiedAmount: 899 });
  assert.equal(env.mails.length, 2);
  editStatus(env, hold.bookingId, 'Verified');
  assert.equal(env.mails.length, 2);
});

test('setting Status to Rejected in the sheet marks the payment rejected and emails the parent once', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S3', children: 1, giftQty: 0 });
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details() });
  editStatus(env, hold.bookingId, 'Rejected');
  assert.equal(bookingRow(env, hold.bookingId)['Payment Status'], 'Rejected');
  assert.equal(env.mails.length, 2);
  assert.match(env.mails[1].subject, /couldn't verify your payment/);
  assert.match(env.mails[1].htmlBody, /hello\.lilhoppers@gmail\.com/);
  assert.equal(env.mails[1].to, 'meera@example.com');
  editStatus(env, hold.bookingId, 'Rejected');
  assert.equal(env.mails.length, 2, 'no second email');
});

test('rejecting on the admin page emails the parent; a hold with no details gets no email', () => {
  const env = load();
  const P = env.props.ADMIN_PASSCODE;
  const hold = env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 1 });
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details() });
  const res = env.call({ action: 'adminReject', passcode: P, bookingId: hold.bookingId, reason: 'No payment found' });
  assert.equal(res.emailSent, true);
  assert.equal(env.mails.length, 2);
  assert.match(env.mails[1].subject, /couldn't verify your payment \(LH-/);
  assert.match(env.mails[1].htmlBody, /email a screenshot of your payment/);
  assert.doesNotMatch(env.mails[1].htmlBody, /No payment found/, 'the internal reason is not shown to the parent');
  assert.ok(bookingRow(env, hold.bookingId)['Rejection Email Sent At']);
  const bare = env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 0 });
  const r2 = env.call({ action: 'adminReject', passcode: P, bookingId: bare.bookingId, reason: 'test' });
  assert.equal(r2.ok, true);
  assert.equal(r2.emailSent, false);
  assert.equal(r2.warning, undefined);
  assert.equal(env.mails.length, 2);
});

test('the automatic sold-out rejection does not send the "could not verify" email', () => {
  const env = load();
  const mine = env.call({ action: 'createHold', slotId: 'S1', children: 2, giftQty: 0 });
  const sh = env.sheets.Bookings.data;
  sh.find((r) => r[0] === mine.bookingId)[sh[0].indexOf('Hold Expires At')] = new Date(Date.now() - 1000);
  for (let i = 0; i < 39; i++) env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 });
  assert.equal(env.call({ action: 'submitBooking', bookingId: mine.bookingId, ...details(2) }).code, 'FULL_AFTER_EXPIRY');
  assert.equal(env.mails.filter((m) => /couldn't verify/.test(m.subject)).length, 0);
});

test('edits to other columns or other sheets are ignored', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S3', children: 1, giftQty: 0 });
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details() });
  const sh = env.sheets.Bookings;
  const col = sh.data[0].indexOf('Status');
  sh.data.find((r) => r[0] === hold.bookingId)[col] = 'Verified';
  env.ctx.onBookingEdit({ range: { getSheet: () => sh, getRow: () => 2, getNumRows: () => 1, getColumn: () => col, getNumColumns: () => 1 } });
  env.ctx.onBookingEdit({ range: { getSheet: () => env.sheets.Slots, getRow: () => 2, getNumRows: () => 1, getColumn: () => col + 1, getNumColumns: () => 1 } });
  assert.equal(env.mails.length, 1);
});

/* ---------------- entry QR and volunteer check-in ---------------- */

function verifiedBooking(env, opts = {}) {
  const hold = env.call({ action: 'createHold', slotId: opts.slotId || 'S2', children: opts.children || 2, extraParent: !!opts.extraParent, giftQty: opts.giftQty ?? 1 });
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(opts.children || 2) });
  if (opts.verify !== false) env.call({ action: 'adminVerify', passcode: env.props.ADMIN_PASSCODE, bookingId: hold.bookingId, verifiedAmount: hold.amounts.total });
  return hold.bookingId;
}

test('the confirmation email carries the entry QR', () => {
  const env = load();
  const id = verifiedBooking(env, { children: 2, extraParent: true });
  const mail = env.mails.find((m) => /You're booked/.test(m.subject));
  assert.ok(mail.inlineImages && mail.inlineImages.entryqr, 'QR attached inline');
  const qr = mail.inlineImages.entryqr;
  assert.equal(qr.type, 'image/gif');
  assert.equal(qr.name, 'entry-' + id + '.gif');
  assert.equal(Buffer.from(qr.bytes).subarray(0, 6).toString(), 'GIF87a');
  assert.match(mail.htmlBody, /src="cid:entryqr"/);
  assert.match(mail.htmlBody, /Show this QR at the entrance/);
  assert.match(mail.htmlBody, /lets in 2 kids \+ 2 parents \+ 1 extra parent/);
  assert.doesNotMatch(mail.htmlBody, /Show this email at the entrance/);
  assert.equal(env.ctx.entryUrl_(id), 'https://lilhoppers.co/checkin.html?b=' + id);
});

test('setup creates a separate volunteer passcode; it opens check-in but not admin', () => {
  const env = load();
  const V = env.props.VOLUNTEER_PASSCODE, A = env.props.ADMIN_PASSCODE;
  assert.ok(V && V.length === 6 && V !== A);
  assert.equal(env.call({ action: 'staffCheck', passcode: V }).ok, true);
  assert.equal(env.call({ action: 'staffCheck', passcode: A }).ok, true, 'admin passcode works at the door too');
  assert.equal(env.call({ action: 'staffCheck', passcode: 'nope' }).code, 'UNAUTHORISED');
  assert.equal(env.call({ action: 'adminList', passcode: V }).code, 'UNAUTHORISED', 'volunteers cannot open admin');
  const list = env.call({ action: 'adminList', passcode: A });
  assert.deepEqual({ ...list.checkin }, { url: 'https://lilhoppers.co/checkin', passcode: V });
});

test('check-in: valid ticket shows who is allowed in, checks in once, can be undone', () => {
  const env = load();
  const V = env.props.VOLUNTEER_PASSCODE;
  const id = verifiedBooking(env, { children: 2, extraParent: true, giftQty: 2 });
  const look = env.call({ action: 'checkinLookup', passcode: V, bookingId: 'https://lilhoppers.co/checkin.html?b=' + id });
  assert.equal(look.ok, true);
  const p = look.pass;
  assert.deepEqual([p.verdict, p.children, p.parentsIncluded, p.extraParent, p.grownUps, p.giftQty, p.slotLabel, p.slotTime],
    ['valid', 2, 2, true, 3, 2, 'Slot 2', '4:00 PM – 5:30 PM']);
  assert.equal(p.parentName, 'Meera Iyer');

  const first = env.call({ action: 'checkin', passcode: V, bookingId: id.toLowerCase() });
  assert.equal(first.ok, true);
  assert.equal(first.pass.verdict, 'checkedIn');
  assert.ok(first.pass.checkedInAt);
  assert.ok(bookingRow(env, id)['Checked In At']);
  assert.equal(env.call({ action: 'adminList', passcode: env.props.ADMIN_PASSCODE }).slots.find((s) => s.id === 'S2').arrived, 2);

  const again = env.call({ action: 'checkin', passcode: V, bookingId: id });
  assert.equal(again.already, true, 'a second scan does not let them in twice');
  assert.equal(env.call({ action: 'checkinLookup', passcode: V, bookingId: id }).pass.verdict, 'already');

  const undo = env.call({ action: 'checkinUndo', passcode: V, bookingId: id });
  assert.equal(undo.pass.verdict, 'valid');
  assert.equal(bookingRow(env, id)['Checked In At'], '');
});

test('check-in: single parent, unconfirmed, rejected, unknown and bad codes', () => {
  const env = load();
  const V = env.props.VOLUNTEER_PASSCODE;
  const solo = verifiedBooking(env, { children: 1, extraParent: false, giftQty: 0 });
  const p = env.call({ action: 'checkinLookup', passcode: V, bookingId: solo }).pass;
  assert.deepEqual([p.children, p.grownUps, p.extraParent, p.giftQty], [1, 1, false, 0]);

  const pending = verifiedBooking(env, { verify: false });
  assert.equal(env.call({ action: 'checkinLookup', passcode: V, bookingId: pending }).pass.verdict, 'pending');
  const refused = env.call({ action: 'checkin', passcode: V, bookingId: pending });
  assert.equal(refused.code, 'NOT_CONFIRMED');
  assert.equal(bookingRow(env, pending)['Checked In At'], '');

  env.call({ action: 'adminReject', passcode: env.props.ADMIN_PASSCODE, bookingId: pending, reason: 'x' });
  assert.equal(env.call({ action: 'checkinLookup', passcode: V, bookingId: pending }).pass.verdict, 'rejected');

  assert.equal(env.call({ action: 'checkinLookup', passcode: V, bookingId: 'LH-ZZZZZ' }).code, 'NOT_FOUND');
  assert.equal(env.call({ action: 'checkinLookup', passcode: V, bookingId: 'hello' }).code, 'BAD_ID');
  assert.equal(env.call({ action: 'checkinLookup', passcode: 'wrong', bookingId: solo }).code, 'UNAUTHORISED');
});

test('bookings made before the booking & support fee keep their old totals in emails', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 1 });
  const sh = env.sheets.Bookings.data;
  sh.find((r) => r[0] === hold.bookingId)[sh[0].indexOf('Expected Total')] = 1198; // saved before the fee existed
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(1) });
  const body = env.mails[0].htmlBody;
  assert.match(body, /₹1,198/);
  assert.doesNotMatch(body, /support fee/);
  assert.equal(env.call({ action: 'adminVerify', passcode: env.props.ADMIN_PASSCODE, bookingId: hold.bookingId, verifiedAmount: 1198 }).ok, true);
});

test('a booking saved before the group deals keeps its full-price total', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S1', children: 2, giftQty: 0 });
  const sh = env.sheets.Bookings.data, H = sh[0], row = sh.find((r) => r[0] === hold.bookingId);
  row[H.indexOf('Ticket Subtotal')] = 1798; row[H.indexOf('Expected Total')] = 1798; // saved at ₹899 each, before the fee and deals
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(2) });
  const body = env.mails[0].htmlBody;
  assert.match(body, /<strong>₹1,798<\/strong>/);
  assert.doesNotMatch(body, /LILHOP|support fee/);
});

test('every booking submitted sends Lil\' Hoppers a "new booking" alert, once', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S2', children: 2, extraParent: true, giftQty: 1 });
  assert.equal(env.alerts.length, 0, 'no alert for a hold');
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(2) });
  assert.equal(env.alerts.length, 1);
  const m = env.alerts[0];
  assert.equal(m.to, 'hello.lilhoppers@gmail.com');
  assert.equal(m.subject, 'New booking ' + hold.bookingId + ' · 4:00 PM – 5:30 PM · 2 kids · ₹2,135');
  assert.match(m.htmlBody, /Meera Iyer/);
  assert.match(m.htmlBody, /https:\/\/wa\.me\/919845012345/);
  assert.match(m.htmlBody, /Kid 1, Kid 2/);
  assert.match(m.htmlBody, /extra parent, 1 Santa gift/);
  assert.match(m.htmlBody, /LILHOP2/);
  assert.match(m.htmlBody, /href="https:\/\/drive\.google\.com\/file\/d\/1">Payment screenshot/);
  assert.match(m.htmlBody, /https:\/\/lilhoppers\.co\/admin/);
  assert.match(m.htmlBody, /docs\.google\.com\/spreadsheets\/d\/sheet-id/);
  assert.equal(env.mails.length, 1, 'the parent still gets their email');
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(2) });
  assert.equal(env.alerts.length, 1, 'a double submit sends no second alert');
});

test('a payment that arrives after the slot filled up sends a "refund needed" alert', () => {
  const env = load();
  const mine = env.call({ action: 'createHold', slotId: 'S1', children: 2, giftQty: 0 });
  const sh = env.sheets.Bookings.data;
  sh.find((r) => r[0] === mine.bookingId)[sh[0].indexOf('Hold Expires At')] = new Date(Date.now() - 1000);
  for (let i = 0; i < 39; i++) env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 });
  const res = env.call({ action: 'submitBooking', bookingId: mine.bookingId, ...details(2) });
  assert.equal(res.code, 'FULL_AFTER_EXPIRY');
  assert.equal(res.alertFor, undefined, 'booking details are not sent back to the page');
  assert.equal(env.alerts.length, 1);
  assert.match(env.alerts[0].subject, new RegExp('^Refund needed: ' + mine.bookingId));
  assert.match(env.alerts[0].htmlBody, /Please refund them/);
});

test('alerts stop before parents\' emails when the daily email quota runs low, and can be switched off', () => {
  const env = load();
  env.quota.left = 20;
  const a = env.call({ action: 'createHold', slotId: 'S3', children: 1, giftQty: 0 });
  env.call({ action: 'submitBooking', bookingId: a.bookingId, ...details() });
  assert.equal(env.alerts.length, 0);
  assert.equal(env.mails.length, 1, 'the parent still gets their email');
  env.quota.left = 100;
  env.ctx.CONFIG.ALERT_EMAIL = '';
  const b = env.call({ action: 'createHold', slotId: 'S3', children: 1, giftQty: 0 });
  env.call({ action: 'submitBooking', bookingId: b.bookingId, ...details() });
  assert.equal(env.alerts.length, 0);
});

test('a hold without contact (page from before the change) marked Verified early: the confirmation goes out when the details arrive', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S3', children: 1, giftQty: 1, email: undefined, phone: undefined });
  editStatus(env, hold.bookingId, 'Verified'); // admin saw the payment arrive and marked it straight away
  assert.equal(env.mails.length, 0, 'no email address yet, so nothing is sent');
  assert.match(bookingRow(env, hold.bookingId)['Admin Notes'], /Waiting for the parent's details/);

  const res = env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details() });
  assert.equal(res.ok, true);
  assert.equal(res.status, 'Verified');
  const row = bookingRow(env, hold.bookingId);
  assert.deepEqual([row['Status'], row['Payment Status'], row['Parent Name'], row['Email'], row['Child Names']], ['Verified', 'Verified', 'Meera Iyer', 'meera@example.com', 'Kid 1']);
  assert.match(row['Screenshot URL'], /^https:\/\/drive\.google\.com/);
  assert.ok(row['Confirmation Email Sent At'], 'confirmation recorded');
  assert.equal(env.mails.length, 1);
  assert.match(env.mails[0].subject, /You're booked/);
  assert.equal(env.mails[0].to, 'meera@example.com');
  assert.ok(env.mails[0].inlineImages && env.mails[0].inlineImages.entryqr, 'with the entry QR');
  assert.equal(env.alerts.length, 1);
  assert.match(env.alerts[0].htmlBody, /Already verified/);

  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details() });
  assert.equal(env.mails.length, 1, 'a second submit sends nothing more');
  assert.equal(env.alerts.length, 1);
});

test('email and phone are required: a booking without them is refused and nothing is saved', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 });
  assert.equal(env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(1, { email: '' }) }).code, 'BAD_EMAIL');
  assert.equal(env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(1, { email: '   ' }) }).code, 'BAD_EMAIL');
  assert.equal(env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(1, { phone: '' }) }).code, 'BAD_PHONE');
  const p = details(1); delete p.email; delete p.phone;
  assert.equal(env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...p }).code, 'BAD_EMAIL');
  const row = bookingRow(env, hold.bookingId);
  assert.deepEqual([row['Status'], row['Parent Name'], row['Submitted At']], ['Awaiting Payment', '', '']);
  assert.equal(env.mails.length + env.alerts.length, 0);
});

test('email and phone are asked for before the QR: saved on the hold, and a hold without valid ones is refused', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 0, email: ' divya@example.com ', phone: '+91 95913 00331' });
  assert.equal(hold.ok, true);
  let row = bookingRow(env, hold.bookingId);
  assert.deepEqual([row['Status'], row['Email'], row['Phone']], ['Awaiting Payment', 'divya@example.com', '9591300331']);
  const n = env.sheets.Bookings.data.length;
  assert.equal(env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 0, email: '', phone: '9591300331' }).code, 'BAD_EMAIL');
  assert.equal(env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 0, email: 'divya@example.com', phone: '' }).code, 'BAD_PHONE');
  assert.equal(env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 0, email: 'divya@example.com', phone: '12345' }).code, 'BAD_PHONE');
  assert.equal(env.sheets.Bookings.data.length, n, 'no hold was created');
  // Changing the selection while paying keeps (or updates) the contact on the same row.
  const edited = env.call({ action: 'createHold', slotId: 'S2', children: 2, giftQty: 0, email: 'divya.c@example.com', phone: '9591300331', previousBookingId: hold.bookingId });
  assert.equal(edited.bookingId, hold.bookingId);
  row = bookingRow(env, hold.bookingId);
  assert.equal(row['Email'], 'divya.c@example.com');
  assert.equal(env.mails.length + env.alerts.length, 0, 'no emails for a hold');
});

test('paid and marked Verified before the details: the confirmation goes out straight away, then the details are saved', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S3', children: 1, giftQty: 1, email: 'divya@example.com', phone: '9591300331' });
  editStatus(env, hold.bookingId, 'Verified');
  assert.equal(env.mails.length, 1);
  assert.equal(env.mails[0].to, 'divya@example.com');
  assert.match(env.mails[0].subject, /You're booked/);
  assert.match(env.mails[0].htmlBody, /You're booked!/, 'no name yet, so no name in the greeting');
  assert.doesNotMatch(env.mails[0].htmlBody, />Children</, 'no empty Children row');
  assert.ok(env.mails[0].inlineImages.entryqr, 'with the entry QR');

  const res = env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(1, { email: 'divya@example.com', phone: '9591300331' }) });
  assert.equal(res.status, 'Verified');
  const row = bookingRow(env, hold.bookingId);
  assert.deepEqual([row['Status'], row['Parent Name'], row['Child Names']], ['Verified', 'Meera Iyer', 'Kid 1']);
  assert.ok(row['Submitted At']);
  assert.equal(env.mails.length, 1, 'no second confirmation and no "payment being checked"');
  assert.equal(env.alerts.length, 1);
});

test('a hold that never sent proof gets no "couldn\'t verify" email when rejected, even though it has an email', () => {
  const env = load();
  const a = env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 });
  editStatus(env, a.bookingId, 'Rejected');
  const b = env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 });
  env.call({ action: 'adminReject', passcode: env.props.ADMIN_PASSCODE, bookingId: b.bookingId, reason: 'No payment' });
  assert.equal(env.mails.length, 0);
});

test('a hold without contact is still accepted from a page loaded before the change', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0, email: undefined, phone: undefined });
  assert.equal(hold.ok, true);
  assert.equal(bookingRow(env, hold.bookingId)['Email'], '');
});
