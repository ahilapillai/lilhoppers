/* Analytics for the homepage and booking page (never the admin or door check-in pages).
   - Google Analytics 4 counts visits and every booking step, so drop-off shows up as a funnel.
   - Session recordings: Microsoft Clarity, Hotjar or Contentsquare, whichever has an ID in config.js.
   Nothing loads until an ID is filled in (LH_CONFIG.ANALYTICS). Events carry only step names, counts and
   amounts, never names, email, phone or the screenshot, and those parts of the page are masked in recordings.
   Your own browser is left out once you've opened the admin or check-in page (or visited any page with
   ?notrack=1). Visit with ?notrack=0 to be counted again. */
(function () {
  var w = window, d = document;
  var A = (w.LH_CONFIG && w.LH_CONFIG.ANALYTICS) || {};
  var NOTRACK = 'lh_notrack';

  function store(fn) { try { return fn(w.localStorage); } catch (e) { return null; } }
  var q = (location.search.match(/[?&]notrack=([01])/) || [])[1];
  if (q === '1') store(function (s) { s.setItem(NOTRACK, '1'); });
  if (q === '0') store(function (s) { s.removeItem(NOTRACK); });
  var off = store(function (s) { return s.getItem(NOTRACK) === '1'; }) === true;

  var on = { ga: !off && !!A.GA4_ID, clarity: !off && !!A.CLARITY_ID, hotjar: !off && !!A.HOTJAR_ID, cs: !off && !!A.CONTENTSQUARE_ID };

  function addScript(src) {
    var s = d.createElement('script'); s.async = true; s.src = src;
    (d.head || d.documentElement).appendChild(s);
  }

  if (on.ga) {
    w.dataLayer = w.dataLayer || [];
    w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
    w.gtag('js', new Date());
    w.gtag('config', A.GA4_ID);
    addScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(A.GA4_ID));
  }
  if (on.clarity) {
    w.clarity = w.clarity || function () { (w.clarity.q = w.clarity.q || []).push(arguments); };
    addScript('https://www.clarity.ms/tag/' + encodeURIComponent(A.CLARITY_ID));
  }
  if (on.hotjar) {
    w.hj = w.hj || function () { (w.hj.q = w.hj.q || []).push(arguments); };
    w._hjSettings = { hjid: Number(A.HOTJAR_ID), hjsv: 6 };
    addScript('https://static.hotjar.com/c/hotjar-' + w._hjSettings.hjid + '.js?sv=6');
  }
  if (on.cs) {
    w._uxa = w._uxa || [];
    addScript('https://t.contentsquare.net/uxa/' + encodeURIComponent(A.CONTENTSQUARE_ID) + '.js');
  }

  /* track(name, params): sends the event to Google Analytics, and marks the recording with the same name
     so you can filter recordings by it (e.g. "begin_checkout but no purchase"). */
  function track(name, params) {
    try {
      if (on.ga) w.gtag('event', name, params || {});
      if (on.clarity) w.clarity('event', name);
      if (on.hotjar) w.hj('event', name);
      if (on.cs) w._uxa.push(['trackPageEvent', name]);
    } catch (e) { /* analytics must never break the page */ }
  }
  var sent = {};
  function once(name, params) { if (!sent[name]) { sent[name] = true; track(name, params); } }
  // tag(key, value): a label on the recording (Clarity), e.g. the furthest booking step reached.
  function tag(key, value) { try { if (on.clarity) w.clarity('set', key, String(value)); } catch (e) {} }

  /* The order lines as GA4 'items', so revenue and add-ons show up in the e-commerce reports. */
  function items(a) {
    if (!a) return [];
    var list = [{ item_id: 'ticket', item_name: 'Christmas Carnival ticket (1 kid + 1 parent)', price: a.childPrice, quantity: a.children }];
    if (a.couponCode) list[0].coupon = a.couponCode;
    if (a.extraParent) list.push({ item_id: 'extra_parent', item_name: 'Extra parent', price: a.extraParentCharge, quantity: 1 });
    if (a.giftQty) list.push({ item_id: 'santa_gift', item_name: 'Personalised gift from Santa', price: a.giftSubtotal / a.giftQty, quantity: a.giftQty });
    if (a.bookingFee) list.push({ item_id: 'booking_fee', item_name: 'Booking & support fee', price: a.bookingFee, quantity: 1 });
    return list;
  }
  function order(a, extra) {
    var p = { currency: 'INR', value: a ? a.total : 0, items: items(a) };
    if (a && a.couponCode) p.coupon = a.couponCode;
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) p[k] = extra[k];
    return p;
  }

  /* Clicks anywhere on the page: "Book tickets" buttons (which one) and ways of getting in touch. */
  d.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (/(^|\/)book\.html$/.test(href)) return track('book_click', { cta_location: a.getAttribute('data-cta') || 'link' });
    if (/^tel:/.test(href)) return track('contact_click', { method: 'phone' });
    if (/wa\.me|whatsapp/i.test(href)) return track('contact_click', { method: 'whatsapp' });
    if (/instagram\.com/i.test(href)) return track('contact_click', { method: 'instagram' });
    if (/share\.google|maps\.google|goo\.gl\/maps/i.test(href)) return track('directions_click', {});
  }, true);

  /* Homepage: how far down people get (each section once per visit). */
  function watchSections() {
    if (!('IntersectionObserver' in w)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        track('section_view', { section: en.target.id });
      });
    }, { rootMargin: '0px 0px -40% 0px' }); // counts once the section reaches the upper 60% of the screen
    d.querySelectorAll('[data-track-section]').forEach(function (el) { io.observe(el); });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', watchSections); else watchSections();

  w.LH_TRACK = { track: track, once: once, tag: tag, order: order, enabled: on.ga || on.clarity || on.hotjar || on.cs };
})();
