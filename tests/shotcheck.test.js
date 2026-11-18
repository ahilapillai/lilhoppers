const test = require('node:test');
const assert = require('node:assert');
const SC = require('../assets/js/shotcheck.js');

const OPTS = { payeeNames: ['AHILA PICHAIPILLAI'], upiId: 'ahilapil.26-1@okicici', toleranceMinutes: 15, expectedAmount: 1198 };
const at = (s) => new Date(s); // local time
const check = (text, now, extra) => SC.analyze(text, Object.assign({}, OPTS, { now: at(now) }, extra || {}));

// Text exactly as Tesseract read Ahila's GPay screenshot.
const GPAY = 'Paid to\nAHILA PICHAIPILLAI\n© Banking name: AHILA PICHAIPILLAI\n16 November 2026, 8:53am\n';

test("Ahila's sample screenshot (16 Nov) fails on 17 Nov", () => {
  const r = check(GPAY, '2026-11-17T13:51:00');
  assert.strictEqual(r.status, 'fail');
  assert.deepStrictEqual(r.problems, ['OLD_DATE']);
  assert.strictEqual(r.shows, '16 Nov 2026, 8:53 AM');
  assert.match(r.message, /from 16 Nov 2026, 8:53 AM, not today/);
  assert.strictEqual(r.payeeOk, true);
});

test('same screenshot passes when uploaded a few minutes after paying', () => {
  const r = check(GPAY, '2026-11-16T09:01:00');
  assert.strictEqual(r.status, 'pass');
  assert.strictEqual(r.minutesOff, 8);
  assert.match(r.message, /^Checked: paid today at 8:53 AM\.$/);
  assert.doesNotMatch(r.message, /AHILA/);
  assert.match(r.summary, /8 min before upload/);
});

test('15 minutes is fine, 16 is not', () => {
  assert.strictEqual(check(GPAY, '2026-11-16T09:08:00').status, 'pass');
  const r = check(GPAY, '2026-11-16T09:09:00');
  assert.strictEqual(r.status, 'fail');
  assert.deepStrictEqual(r.problems, ['TIME_EARLY']);
  assert.match(r.message, /16 minutes ago/);
});

test('a payment time later than now fails', () => {
  const r = check(GPAY, '2026-11-16T08:20:00');
  assert.deepStrictEqual(r.problems, ['TIME_LATE']);
});

test('today and right time but someone else paid fails', () => {
  const r = check('Paid to\nRAVI KUMAR\n16 November 2026, 8:53am', '2026-11-16T08:58:00');
  assert.strictEqual(r.status, 'fail');
  assert.deepStrictEqual(r.problems, ['NO_PAYEE']);
  assert.match(r.message, /doesn't look like a payment to Lil' Hoppers/);
  assert.doesNotMatch(r.message, /AHILA/);
});

test('small OCR slips in the name still match', () => {
  const r = check('Paid to\nAHILA PICHAIPILIAI\n16 November 2026, 8:53am', '2026-11-16T08:58:00');
  assert.strictEqual(r.status, 'pass');
});

test('PhonePe style: time before date, UPI ID and amount', () => {
  const r = check('Transaction Successful\n01:45 pm on 17 Nov 2026\nPaid to\nAhila Pichaipillai\nahilapil.26-1@okicici\n₹1,198\nUTR: 412345678901', '2026-11-17T13:50:00');
  assert.strictEqual(r.status, 'pass');
  assert.strictEqual(r.amountOk, true);
  assert.match(r.summary, /amount ₹1,198 seen/);
});

test('Paytm style and the UPI ID alone count as the payee', () => {
  const r = check('Paid Successfully\n%1,198\nTo: ahilapil.26-1@okicici\n01:45 PM, 17 Nov 2026', '2026-11-17T13:52:00');
  assert.strictEqual(r.status, 'pass');
  assert.strictEqual(r.amountOk, true);
});

test('bank app numeric date and 24-hour time with seconds', () => {
  const r = check('Payment successful\nBeneficiary: AHILA PICHAIPILLAI\nDate: 17/11/2026 13:44:10\nAmount INR 899.00', '2026-11-17T13:50:00', { expectedAmount: 899 });
  assert.strictEqual(r.status, 'pass');
  assert.strictEqual(r.amountOk, true);
});

test('US-style date and "Today" are understood', () => {
  assert.strictEqual(check('Paid to AHILA PICHAIPILLAI\nNov 17, 2026 1:45 PM', '2026-11-17T13:50:00').status, 'pass');
  assert.strictEqual(check('Paid to AHILA PICHAIPILLAI\nToday, 1:45 pm', '2026-11-17T13:50:00').status, 'pass');
  assert.strictEqual(check('Paid to AHILA PICHAIPILLAI\nYesterday, 1:45 pm', '2026-11-17T13:50:00').status, 'fail');
});

test("the phone's status-bar clock is not mistaken for the payment time", () => {
  const r = check('1:50\n\nPaid to\nAHILA PICHAIPILLAI\n\n17 November 2026, 9:05am', '2026-11-17T13:51:00');
  assert.strictEqual(r.status, 'fail');
  assert.deepStrictEqual(r.problems, ['TIME_EARLY']);
});

test('nothing readable is "unreadable", not a failure', () => {
  const r = check('', '2026-11-17T13:51:00');
  assert.strictEqual(r.status, 'unreadable');
  assert.match(r.message, /couldn't read the date, time and name of the person paid/);
});

test('name but no date or time is unreadable', () => {
  const r = check('Paid to\nAHILA PICHAIPILLAI\n₹1,198', '2026-11-17T13:51:00');
  assert.strictEqual(r.status, 'unreadable');
  assert.match(r.message, /date and time/);
});

test('amounts are not read as times, and phone numbers are not dates', () => {
  const r = check('AHILA PICHAIPILLAI\n₹5.00\n98450 12345', '2026-11-17T13:51:00');
  assert.strictEqual(r.status, 'unreadable');
  assert.strictEqual(r.minutesOff, null);
});
