/*
 * Payment screenshot check.
 * Reads the text on a UPI payment screenshot (in the parent's browser, with Tesseract) and checks:
 *   1. it shows the payee (AHILA PICHAIPILLAI, or the UPI ID),
 *   2. it shows today's date,
 *   3. its payment time is within TOLERANCE minutes of now.
 * analyze() is pure and works in Node for tests; read() needs a browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LH_SHOTCHECK = factory();
})(this, function () {
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var FAIL_MESSAGE = "This doesn't look like a payment to Lil' Hoppers. Please upload the screenshot of the payment you just made.";
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

  function validDate(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
    var dt = new Date(y, m - 1, d);
    return dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  function year(y, now) {
    if (y === undefined || y === null || y === '') return now.getFullYear();
    y = Number(y);
    return y < 100 ? 2000 + y : y;
  }

  /* All dates written on one line. */
  function datesIn(line, now) {
    var out = [], m, re;
    var low = line.toLowerCase();
    if (/\btoday\b/.test(low)) out.push({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(), word: 'Today' });
    if (/\byesterday\b/.test(low)) { var yd = new Date(now.getTime() - 864e5); out.push({ y: yd.getFullYear(), m: yd.getMonth() + 1, d: yd.getDate(), word: 'Yesterday' }); }
    // 16 November 2026 · 16 Nov, 2026 · 16th Nov · 16-Nov-26
    re = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-\\/.,]*' + MONTH_RE + '\\.?(?:[\\s\\-\\/.,]+(\\d{4}|\\d{2})(?![\\d:.]))?', 'gi');
    while ((m = re.exec(line))) out.push({ y: year(m[3], now), m: MONTHS[m[2].slice(0, 3).toLowerCase()], d: Number(m[1]) });
    // November 16, 2026 · Nov 16 2026
    re = new RegExp('\\b' + MONTH_RE + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:.])(?:,?\\s*(\\d{4}))?', 'gi');
    while ((m = re.exec(line))) out.push({ y: year(m[3], now), m: MONTHS[m[1].slice(0, 3).toLowerCase()], d: Number(m[2]) });
    // 2026-11-16
    re = /\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g;
    while ((m = re.exec(line))) out.push({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
    // 16/11/2026 · 16-11-26 (day first, as in India; month first only if the day can't be a month)
    re = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})(?![\d:])/g;
    while ((m = re.exec(line))) {
      var a = Number(m[1]), b = Number(m[2]);
      if (b > 12 && a <= 12) out.push({ y: year(m[3], now), m: a, d: b });
      else out.push({ y: year(m[3], now), m: b, d: a });
    }
    return out.filter(function (x) { return x.word || validDate(x.y, x.m, x.d); });
  }

  /* All clock times on one line. */
  function timesIn(line) {
    var out = [], m;
    var re = /(^|[^\d])(\d{1,2})\s?([:.])\s?(\d{2})(?:[:.](\d{2}))?\s*([ap])\.?\s?m\b\.?/gi;
    while ((m = re.exec(line))) {
      var h = Number(m[2]), mi = Number(m[4]);
      if (h >= 1 && h <= 12 && mi <= 59) out.push({ h: (h % 12) + (m[6].toLowerCase() === 'p' ? 12 : 0), mi: mi, ampm: true, raw: m[0].replace(/^[^\d]/, '') });
    }
    re = /(^|[^\d:.])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d]|\s*[ap]\.?\s?m\b)/gi;
    while ((m = re.exec(line))) {
      var h2 = Number(m[2]), m2 = Number(m[3]);
      if (h2 <= 23 && m2 <= 59) out.push({ h: h2, mi: m2, ampm: false, secs: m[4] !== undefined, raw: m[0].replace(/^[^\d]/, '') });
    }
    return out;
  }

  function compact(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function lev(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  /* Is `needle` in `hay`, allowing a couple of misread letters? */
  function fuzzyHas(hay, needle) {
    if (!needle) return false;
    if (hay.indexOf(needle) >= 0) return true;
    var allow = needle.length >= 12 ? 2 : (needle.length >= 6 ? 1 : 0);
    if (!allow) return false;
    for (var len = needle.length - allow; len <= needle.length + allow; len++) {
      for (var i = 0; i + len <= hay.length; i++) if (lev(hay.substr(i, len), needle) <= allow) return true;
    }
    return false;
  }

  function fmtTime(h, mi) { return ((h % 12) || 12) + ':' + (mi < 10 ? '0' : '') + mi + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function fmtDate(d) { return d.word ? d.word : d.d + ' ' + MON[d.m - 1] + ' ' + d.y; }
  function rupees(n) { return '₹' + Number(n).toLocaleString('en-IN'); }
  function joinWords(list) { return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]; }

  function amountSeen(text, amount) {
    if (!amount) return null;
    var plain = String(Math.round(amount));
    var withComma = Number(amount).toLocaleString('en-IN');
    var t = text.replace(/\s+/g, '');
    if (withComma !== plain && t.indexOf(withComma) >= 0) return true;
    return new RegExp('(^|[^\\d,])' + plain + '(\\.00)?(?![\\d,])').test(t);
  }

  /**
   * text: OCR text. opts: { now: Date, toleranceMinutes: 15, payeeNames: [], upiId: '', expectedAmount: 1198 }
   * Returns { status: 'pass'|'fail'|'unreadable', payeeOk, dateOk, timeOk, amountOk, shows, minutesOff, problems, message, summary }
   */
  function analyze(text, opts) {
    opts = opts || {};
    var now = opts.now ? new Date(opts.now) : new Date();
    var tol = opts.toleranceMinutes || 15;
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);

    var dates = [], dateLines = {};
    lines.forEach(function (l, i) { datesIn(l, now).forEach(function (d) { dates.push(d); dateLines[i] = true; }); });
    var times = [];
    lines.forEach(function (l, i) {
      var nearDate = dateLines[i] || dateLines[i - 1] || dateLines[i + 1];
      timesIn(l).forEach(function (t) { if (t.ampm || t.secs || nearDate) times.push(t); });
    });

    var isToday = function (d) { return d.y === now.getFullYear() && d.m === now.getMonth() + 1 && d.d === now.getDate(); };
    var todayDate = dates.filter(isToday)[0];
    var dateOk = dates.length ? !!todayDate : null;

    var best = null;
    times.forEach(function (t) {
      var hours = t.ampm || t.h > 12 || t.h === 0 ? [t.h] : [t.h, t.h + 12];
      hours.forEach(function (h) {
        var at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h % 24, t.mi);
        var off = Math.round((now.getTime() - at.getTime()) / 60000); // + means before now
        if (!best || Math.abs(off) < Math.abs(best.off)) best = { h: h % 24, mi: t.mi, off: off };
      });
    });
    var timeOk = best ? Math.abs(best.off) <= tol : null;

    var hay = compact(text);
    var payees = (opts.payeeNames || []).map(compact).filter(Boolean);
    var payeeOk = payees.some(function (p) { return fuzzyHas(hay, p); }) || (!!opts.upiId && fuzzyHas(hay, compact(opts.upiId)));
    var amountOk = amountSeen(String(text || ''), opts.expectedAmount);

    var shownDate = todayDate || dates[0];
    var shows = [shownDate ? fmtDate(shownDate) : '', best ? fmtTime(best.h, best.mi) : ''].filter(Boolean).join(', ');
    var payeeLabel = (opts.payeeNames || [])[0] || opts.upiId || 'us';

    var problems = [];
    if (dateOk === false) problems.push('OLD_DATE');
    if (dateOk && timeOk === false) problems.push(best.off > 0 ? 'TIME_EARLY' : 'TIME_LATE');
    if (!payeeOk && payees.length + (opts.upiId ? 1 : 0) > 0) problems.push('NO_PAYEE');

    var readSomething = dates.length > 0 || times.length > 0;
    var status;
    if (problems.indexOf('OLD_DATE') >= 0 || problems.indexOf('TIME_EARLY') >= 0 || problems.indexOf('TIME_LATE') >= 0) status = 'fail';
    else if (problems.indexOf('NO_PAYEE') >= 0 && readSomething) status = 'fail';
    else if (dateOk && timeOk && (payeeOk || !payees.length)) status = 'pass';
    else status = 'unreadable';

    var missing = [];
    if (dateOk === null) missing.push('date');
    if (timeOk === null) missing.push('time');
    if (!payeeOk && !readSomething) missing.push('name of the person paid');

    var message, summary;
    if (status === 'pass') {
      message = 'Checked: paid today at ' + fmtTime(best.h, best.mi) + '.';
      summary = best.off >= 0 ? best.off + ' min before upload' : -best.off + ' min after upload';
    } else if (status === 'fail') {
      var why = [];
      if (problems.indexOf('OLD_DATE') >= 0) why.push('This screenshot is from ' + shows + ', not today.');
      if (problems.indexOf('TIME_EARLY') >= 0) why.push('This screenshot shows a payment at ' + fmtTime(best.h, best.mi) + ' today, ' + best.off + ' minutes ago. It should be the payment you just made.');
      if (problems.indexOf('TIME_LATE') >= 0) why.push('The time on this screenshot (' + fmtTime(best.h, best.mi) + ') is later than now.');
      if (problems.indexOf('NO_PAYEE') >= 0) why.push("This doesn't look like a payment to Lil' Hoppers.");
      // Parents see one short message; the details stay in the summary for the admin.
      message = FAIL_MESSAGE;
      summary = why.join(' ');
    } else {
      message = "We couldn't read the " + joinWords(missing.length ? missing : ['details']) + ' on this screenshot. You can still continue and we\'ll check it by hand, or upload a clearer one that shows the whole payment screen.';
      summary = "Couldn't read the " + joinWords(missing.length ? missing : ['details']) + (shows ? ' (saw ' + shows + ')' : '');
    }
    if (status !== 'fail' && amountOk !== null) summary += amountOk ? ' · amount ' + rupees(opts.expectedAmount) + ' seen' : ' · amount not spotted';
    if (status !== 'fail' && payeeOk) summary = 'Paid to ' + payeeLabel + ' · ' + summary.charAt(0).toLowerCase() + summary.slice(1);

    return {
      status: status, payeeOk: payeeOk, dateOk: dateOk, timeOk: timeOk, amountOk: amountOk,
      shows: shows, minutesOff: best ? best.off : null, problems: problems, message: message, summary: summary,
      checkedAt: now.toISOString()
    };
  }

  /* ---------------- browser OCR ---------------- */
  var workerPromise = null;
  function base() {
    var s = document.querySelector('script[src*="shotcheck.js"]');
    return s ? s.src.replace(/assets\/js\/shotcheck\.js.*$/, '') : '';
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.Tesseract) return resolve();
      var el = document.createElement('script');
      el.src = src; el.onload = function () { resolve(); }; el.onerror = function () { reject(new Error('load')); };
      document.head.appendChild(el);
    });
  }
  function worker() {
    if (workerPromise) return workerPromise;
    var dir = base() + 'assets/vendor/tesseract/';
    workerPromise = loadScript(dir + 'tesseract.min.js').then(function () {
      return window.Tesseract.createWorker('eng', 1, { workerPath: dir + 'worker.min.js', corePath: dir, langPath: dir });
    });
    workerPromise.catch(function () { workerPromise = null; });
    return workerPromise;
  }
  /* Grey, high-contrast copy of the image; dark-mode screenshots are flipped to dark-on-light. */
  function prepare(img) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var big = Math.max(w, h);
    var k = big > 2400 ? 2400 / big : (big < 1000 ? 1.6 : 1);
    var c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    var px = ctx.getImageData(0, 0, c.width, c.height), d = px.data, sum = 0, i;
    for (i = 0; i < d.length; i += 4) { var g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = g; sum += g; }
    if (sum / (d.length / 4) < 110) for (i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
    ctx.putImageData(px, 0, 0);
    return c;
  }
  /** img: a loaded HTMLImageElement. Resolves with analyze() output plus { text }; never rejects. */
  function read(img, opts) {
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve('timeout'); }, 60000); });
    var job = worker().then(function (w) { return w.recognize(prepare(img)); }).then(function (r) { return r.data.text; });
    return Promise.race([job, timeout]).then(function (text) {
      if (text === 'timeout') throw new Error('timeout');
      var res = analyze(text, Object.assign({}, opts, { now: new Date() }));
      res.text = text;
      return res;
    }).catch(function () {
      return { status: 'unreadable', error: true, shows: '', minutesOff: null, problems: ['OCR_FAILED'], checkedAt: new Date().toISOString(),
        message: "We couldn't check this screenshot automatically. You can still continue and we'll check it by hand.",
        summary: 'Not checked (screenshot reader did not load)' };
    });
  }
  /** Start downloading the reader early (e.g. when the details step opens). */
  function warmUp() { try { worker(); } catch (e) { /* ignore */ } }

  return { analyze: analyze, read: read, warmUp: warmUp, _datesIn: datesIn, _timesIn: timesIn };
});
