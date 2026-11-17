/* Admin: slot counts + capacity, bookings with itemized payments, verify / reject. */
(function () {
  var P = window.LH_PRICING;
  var API = window.LH_API;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'lh_admin_pass';
  var data = null;
  var current = null;

  if (API.demo) $('demoBanner').hidden = false;

  function pass() { try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function setPass(v) { try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  function show(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) { return v === '' || v === null || v === undefined ? '—' : P.rupees(v); }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'ad-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3800);
  }
  function badgeClass(status) {
    if (/^Pending/.test(status)) return 'ad-b-pending';
    if (/^Verified/.test(status)) return 'ad-b-verified';
    if (/^Awaiting/.test(status)) return 'ad-b-awaiting';
    if (/^Rejected/.test(status)) return 'ad-b-rejected';
    return 'ad-b-abandoned';
  }

  /* ---------------- login ---------------- */
  $('login').addEventListener('submit', function (e) {
    e.preventDefault();
    setPass($('passcode').value.trim());
    load(true);
  });
  $('logout').addEventListener('click', function () { setPass(''); data = null; $('dash').hidden = true; $('topActions').hidden = true; $('login').hidden = false; $('passcode').value = ''; });
  $('refresh').addEventListener('click', function () { load(false); });

  function load(fromLogin) {
    if (!pass()) { $('login').hidden = false; return; }
    API.call('adminList', { passcode: pass() }).then(function (res) {
      if (!res.ok) {
        if (res.code === 'UNAUTHORISED' || res.code === 'LOCKED') setPass('');
        $('login').hidden = false; $('dash').hidden = true; $('topActions').hidden = true;
        show($('loginError'), res.error);
        return;
      }
      show($('loginError'), '');
      data = res;
      $('login').hidden = true; $('dash').hidden = false; $('topActions').hidden = false;
      renderSlots();
      renderSlotFilter();
      renderRows();
      if (!fromLogin) toast('Updated');
    });
  }

  /* ---------------- slots ---------------- */
  function renderSlots() {
    var t = data.totals;
    $('totals').innerHTML = 'Children counted: <strong>' + t.counted + '</strong> of <strong>' + t.capacity + '</strong>' +
      (t.capacity !== 100 ? ' <span class="ad-bad">(total capacity is ' + t.capacity + ', not 100)</span>' : '');
    var box = $('slots');
    box.innerHTML = '';
    data.slots.forEach(function (s) {
      var cap = Math.max(s.capacity, s.total, 1);
      var card = document.createElement('div');
      card.className = 'ad-slot';
      card.innerHTML =
        '<div class="ad-slot-head"><div><strong>' + esc(s.label) + '</strong><span>' + esc(s.time) + '</span></div>' +
        '<span class="ad-badge ' + (s.soldOut ? 'ad-b-sold">Sold Out' : 'ad-b-open">Open') + '</span></div>' +
        '<div class="ad-bar" aria-hidden="true"><i class="v" style="width:' + (s.verified / cap * 100) + '%"></i><i class="p" style="width:' + (s.pending / cap * 100) + '%"></i><i class="h" style="width:' + (s.holds / cap * 100) + '%"></i></div>' +
        '<dl class="ad-nums"><div><dt>Verified</dt><dd>' + s.verified + '</dd></div><div><dt>Pending</dt><dd>' + s.pending + '</dd></div>' +
        '<div><dt>On hold</dt><dd>' + s.holds + '</dd></div><div><dt>Counted</dt><dd>' + s.total + '<small style="font-size:13px;color:#6E6482"> / ' + s.capacity + '</small></dd></div></dl>' +
        '<form class="ad-cap"><label for="cap-' + esc(s.id) + '">Capacity</label><input id="cap-' + esc(s.id) + '" type="number" min="0" max="1000" step="1" value="' + s.capacity + '" required>' +
        '<button type="submit" class="ad-btn ad-btn-sm">Save</button></form>';
      card.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        var v = Number(card.querySelector('input').value);
        var btn = card.querySelector('button');
        if (v < s.total && !confirm(s.label + ' already has ' + s.total + ' children counted. Set capacity to ' + v + ' anyway? Existing bookings stay; the slot will show Sold Out.')) return;
        btn.disabled = true;
        API.call('adminUpdateCapacity', { passcode: pass(), slotId: s.id, capacity: v }).then(function (res) {
          btn.disabled = false;
          if (!res.ok) { alert(res.error); return; }
          toast(s.label + ' capacity set to ' + v);
          load(true);
        });
      });
      box.appendChild(card);
    });
  }

  function renderSlotFilter() {
    var sel = $('fSlot');
    var keep = sel.value;
    sel.innerHTML = '<option value="all">All slots</option>' + data.slots.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.label + ' · ' + s.time) + '</option>'; }).join('');
    sel.value = keep || 'all';
    if (sel.value === '') sel.value = 'all';
  }

  /* ---------------- bookings ---------------- */
  ['fStatus', 'fSlot', 'fSearch'].forEach(function (id) { $(id).addEventListener('input', renderRows); });

  function filtered() {
    var st = $('fStatus').value, sl = $('fSlot').value, q = $('fSearch').value.trim().toLowerCase();
    return data.bookings.filter(function (b) {
      var status = String(b.status);
      if (st === 'active' && !(status === 'Pending Verification' || status === 'Verified')) return false;
      if (st !== 'active' && st !== 'all' && status.indexOf(st) !== 0) return false;
      if (sl !== 'all' && b.slotId !== sl) return false;
      if (q) {
        var hay = [b.bookingId, b.parentName, b.email, b.phone, b.childNames, b.utr].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function breakdown(b) {
    var rows = '<dt>Tickets ' + b.children + ' × ' + P.rupees(data.prices.CHILD_TICKET) + '</dt><dd>' + money(b.ticketSubtotal) + '</dd>' +
      '<dt>Extra parent</dt><dd>' + (b.extraParent === 'Yes' ? money(b.extraParentCharge) : '—') + '</dd>' +
      '<dt>Santa gift × ' + (Number(b.giftQty) || 0) + '</dt><dd>' + money(b.giftSubtotal) + '</dd>';
    return '<dl class="ad-break">' + rows + '</dl>';
  }

  function renderRows() {
    var list = filtered();
    $('count').textContent = list.length + (list.length === 1 ? ' booking' : ' bookings') + ' · ' +
      list.reduce(function (n, b) { return n + (Number(b.children) || 0); }, 0) + ' children';
    var body = $('rows');
    if (!list.length) { body.innerHTML = '<tr><td colspan="10" class="ad-empty">No bookings match.</td></tr>'; return; }
    body.innerHTML = list.map(function (b, i) {
      var slot = data.slots.filter(function (s) { return s.id === b.slotId; })[0];
      var verified = b.verifiedAmount !== '' && b.verifiedAmount !== null && b.verifiedAmount !== undefined;
      var mismatch = verified && Number(b.verifiedAmount) !== Number(b.expectedTotal);
      var proof = (b.utr ? '<span class="ad-id">' + esc(b.utr) + '</span>' : '') +
        (b.screenshotUrl ? '<a href="' + esc(b.screenshotUrl) + '" target="_blank" rel="noopener">Screenshot</a>' : '') ||
        '<small>—</small>';
      var actions = '';
      if (b.status === 'Pending Verification') actions = '<button class="ad-btn ad-btn-sm" data-act="verify" data-i="' + i + '">Verify</button>';
      if (b.status === 'Pending Verification' || /^Awaiting/.test(b.status)) actions += '<button class="ad-btn ad-btn-sm ad-btn-ghost" data-act="reject" data-i="' + i + '">Reject</button>';
      return '<tr>' +
        '<td><span class="ad-id">' + esc(b.bookingId) + '</span><small>' + esc(when(b.createdAt)) + '</small></td>' +
        '<td>' + esc(slot ? slot.label : b.slotId) + '<small>' + esc(b.slotTime) + '</small></td>' +
        '<td>' + (esc(b.parentName) || '<small>Not given yet</small>') + (b.email ? '<small><a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a></small>' : '') + (b.phone ? '<small>' + esc(b.phone) + '</small>' : '') + '</td>' +
        '<td><strong>' + esc(b.children) + '</strong><small>' + esc(b.childNames) + '</small></td>' +
        '<td>' + breakdown(b) + '</td>' +
        '<td><span class="ad-money">' + money(b.expectedTotal) + '</span></td>' +
        '<td><span class="ad-money' + (mismatch ? ' ad-mismatch' : '') + '">' + money(verified ? b.verifiedAmount : '') + '</span>' + (b.verifiedAt ? '<small>' + esc(when(b.verifiedAt)) + '</small>' : '') + '</td>' +
        '<td class="ad-proof">' + proof + '</td>' +
        '<td><span class="ad-badge ' + badgeClass(b.status) + '">' + esc(b.status) + '</span><small>Payment: ' + esc(b.paymentStatus) + '</small>' +
        (b.rejectionReason ? '<small>' + esc(b.rejectionReason) + '</small>' : '') + (b.adminNotes ? '<small>Note: ' + esc(b.adminNotes) + '</small>' : '') + '</td>' +
        '<td><div class="ad-actions">' + actions + '</div></td>' +
        '</tr>';
    }).join('');
    body.querySelectorAll('button[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var b = list[Number(btn.dataset.i)];
        if (btn.dataset.act === 'verify') openVerify(b); else openReject(b);
      });
    });
  }

  /* ---------------- verify ---------------- */
  function openVerify(b) {
    current = b;
    $('verifyWho').textContent = b.bookingId + ' · ' + b.parentName + ' · ' + (b.utr ? 'UTR ' + b.utr : 'screenshot');
    $('verifyBreak').innerHTML = breakdown(b).replace(/^<dl class="ad-break">|<\/dl>$/g, '') +
      '<dt><strong>Total expected</strong></dt><dd><strong>' + money(b.expectedTotal) + '</strong></dd>';
    $('verifyAmount').value = b.expectedTotal;
    $('verifyNote').value = '';
    show($('verifyWarn'), '');
    show($('verifyError'), '');
    $('verifyDlg').showModal();
  }
  $('verifyAmount').addEventListener('input', function () {
    var v = Number($('verifyAmount').value);
    show($('verifyWarn'), current && $('verifyAmount').value !== '' && v !== Number(current.expectedTotal)
      ? 'This is ' + (v > current.expectedTotal ? 'more' : 'less') + ' than the expected ' + P.rupees(current.expectedTotal) + '. Check before verifying.' : '');
  });
  $('verifyCancel').addEventListener('click', function () { $('verifyDlg').close(); });
  $('verifyForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var amt = $('verifyAmount').value;
    if (amt === '' || Number(amt) < 0) { show($('verifyError'), 'Enter the amount received.'); return; }
    var btn = $('verifyGo');
    btn.disabled = true;
    API.call('adminVerify', { passcode: pass(), bookingId: current.bookingId, verifiedAmount: Number(amt), note: $('verifyNote').value }).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { show($('verifyError'), res.error); return; }
      $('verifyDlg').close();
      toast(res.warning || (current.bookingId + ' verified · confirmation emailed'));
      load(true);
    });
  });

  /* ---------------- reject ---------------- */
  function openReject(b) {
    current = b;
    $('rejectWho').textContent = b.bookingId + ' · ' + (b.parentName || 'not submitted') + ' · ' + b.children + (b.children === 1 ? ' child' : ' children');
    $('rejectReason').value = '';
    show($('rejectError'), '');
    $('rejectDlg').showModal();
  }
  $('rejectCancel').addEventListener('click', function () { $('rejectDlg').close(); });
  $('rejectForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var reason = $('rejectReason').value.trim();
    if (!reason) { show($('rejectError'), 'Add a reason.'); return; }
    var btn = $('rejectGo');
    btn.disabled = true;
    API.call('adminReject', { passcode: pass(), bookingId: current.bookingId, reason: reason }).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { show($('rejectError'), res.error); return; }
      $('rejectDlg').close();
      toast(current.bookingId + ' rejected');
      load(true);
    });
  });

  if (pass()) load(true);
})();
