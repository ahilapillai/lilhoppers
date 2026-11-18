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
  const mails = [];
  const files = [];
  let lockHeld = false;
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
      getUuid: () => 'abcdef12-3456-7890-abcd-ef1234567890'
    },
    MailApp: { sendEmail: (m) => mails.push(m) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'hello.lilhoppers@gmail.com' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
    ScriptApp: {
      getProjectTriggers: () => [],
      deleteTrigger() {},
      newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) })
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), ctx);
  ctx.setup();
  const call = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  return { ctx, call, sheets, props, mails, files };
}

const details = (n = 1, extra = {}) => ({
  parentName: 'Meera Iyer', email: 'meera@example.com', phone: '98450 12345',
  childNames: Array.from({ length: n }, (_, i) => 'Kid ' + (i + 1)), utr: '412345678901', ...extra
});

function bookingRow(env, id) {
  const sh = env.sheets.Bookings.data;
  const head = sh[0];
  const row = sh.find((r) => r[0] === id);
  return Object.fromEntries(head.map((h, i) => [h, row[i]]));
}

test('price examples from the PRD', () => {
  const { ctx } = load();
  assert.equal(ctx.computeAmounts(1, false, 1).total, 1198);
  assert.equal(ctx.computeAmounts(1, false, 0).total, 899);
  assert.equal(ctx.computeAmounts(1, true, 1).total, 1397);
  const three = ctx.computeAmounts(3, true, 2);
  assert.deepEqual([three.ticketSubtotal, three.extraParentCharge, three.giftSubtotal, three.total], [2697, 199, 598, 3494]);
});

test('setup creates slots 32 / 33 / 35 = 100 and an admin passcode', () => {
  const env = load();
  const caps = env.sheets.Slots.data.slice(1).map((r) => r[3]);
  assert.deepEqual(caps, [32, 33, 35]);
  assert.equal(caps.reduce((a, b) => a + b), 100);
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
  assert.equal(res.amounts.total, 1397);
  assert.match(res.upi.uri, /^upi:\/\/pay\?pa=ahilapil\.26-1@okicici&pn=Lil%20Hoppers&am=1397\.00&cu=INR&tn=LH-/);
  const row = bookingRow(env, res.bookingId);
  assert.equal(row['Status'], 'Awaiting Payment');
  assert.equal(row['Expected Total'], 1397);
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

test('capacity counts children: slot 1 takes exactly 32, then Sold Out', () => {
  const env = load();
  const results = [];
  for (let i = 0; i < 40; i++) results.push(env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 }));
  assert.equal(results.filter((r) => r.ok).length, 32);
  assert.equal(results[32].code, 'SOLD_OUT');
  assert.equal(env.call({ action: 'availability' }).slots.find((s) => s.id === 'S1').soldOut, true);
  assert.equal(env.call({ action: 'availability' }).slots.find((s) => s.id === 'S2').soldOut, false);
});

test('a booking larger than the places left is refused without revealing numbers', () => {
  const env = load();
  for (let i = 0; i < 10; i++) env.call({ action: 'createHold', slotId: 'S2', children: 3, giftQty: 0 }); // 30 of 33
  const res = env.call({ action: 'createHold', slotId: 'S2', children: 4, giftQty: 0 });
  assert.equal(res.code, 'NOT_ENOUGH_PLACES');
  assert.doesNotMatch(res.error, /\b3\b|\b33\b|left:/);
  assert.equal(env.call({ action: 'createHold', slotId: 'S2', children: 3, giftQty: 0 }).ok, true);
});

test('abandoned (expired hold) and rejected bookings free their places; pending and verified keep them', () => {
  const env = load();
  const holds = [];
  for (let i = 0; i < 32; i++) holds.push(env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 }));
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
  assert.deepEqual([s1.verified, s1.pending, s1.total], [1, 1, 30]);
  assert.equal(env.call({ action: 'createHold', slotId: 'S1', children: 2, giftQty: 0 }).ok, true);
  assert.equal(env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 }).code, 'SOLD_OUT');
  assert.equal(bookingRow(env, holds[3].bookingId)['Status'], 'Abandoned');
});

test('changing the selection releases the previous hold', () => {
  const env = load();
  const first = env.call({ action: 'createHold', slotId: 'S3', children: 2, giftQty: 2 });
  const second = env.call({ action: 'createHold', slotId: 'S3', children: 1, giftQty: 1, previousBookingId: first.bookingId });
  assert.equal(second.ok, true);
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
  assert.match(env.mails[0].htmlBody, /₹2,097/);
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
  const hold3 = env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 });
  env.call({ action: 'submitBooking', bookingId: hold3.bookingId, ...details(1) });
  assert.equal(bookingRow(env, hold3.bookingId)['Screenshot Check'], '');
});

test('proof is required: UTR or screenshot', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 1 });
  assert.equal(env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(1, { utr: '' }) }).code, 'NO_PROOF');
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
  for (let i = 0; i < 31; i++) env.call({ action: 'createHold', slotId: 'S1', children: 1, giftQty: 0 });
  const res = env.call({ action: 'submitBooking', bookingId: mine.bookingId, ...details(2) });
  assert.equal(res.code, 'FULL_AFTER_EXPIRY');
  const row = bookingRow(env, mine.bookingId);
  assert.equal(row['Status'], 'Rejected');
  assert.match(row['Rejection Reason'], /refund due/);
  assert.equal(row['UPI Transaction ID'], '412345678901');
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
  assert.equal(list.totals.capacity, 32 + 33 + 40);
  assert.equal(env.call({ action: 'adminUpdateCapacity', passcode: env.props.ADMIN_PASSCODE, slotId: 'S3', capacity: -1 }).code, 'BAD_CAPACITY');
});

test('admin list carries the itemized payment breakdown for every booking', () => {
  const env = load();
  const hold = env.call({ action: 'createHold', slotId: 'S1', children: 3, extraParent: true, giftQty: 2 });
  env.call({ action: 'submitBooking', bookingId: hold.bookingId, ...details(3) });
  const b = env.call({ action: 'adminList', passcode: env.props.ADMIN_PASSCODE }).bookings[0];
  assert.deepEqual(
    [b.ticketSubtotal, b.extraParentCharge, b.giftQty, b.giftSubtotal, b.expectedTotal, b.verifiedAmount],
    [2697, 199, 2, 598, 3494, '']
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
  const prices = { CHILD_TICKET: 899, EXTRA_PARENT: 199, SANTA_GIFT: 299 };
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
  for (let i = 0; i < 33; i++) env.call({ action: 'createHold', slotId: 'S2', children: 1, giftQty: 0 });
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
