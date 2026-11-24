/* Price maths shared by the booking page, admin page and demo backend. Must match apps-script/Code.gs. */
(function (root) {
  /** The group deal for this many children (LILHOP2: ₹699 each from 2 kids), or null. */
  function groupDeal(prices, children) {
    var best = null;
    (prices.GROUP_DEALS || []).forEach(function (d) {
      if (children >= d.minChildren && (!best || d.childPrice < best.childPrice)) best = d;
    });
    return best;
  }
  function computeAmounts(prices, children, extraParent, giftQty) {
    var deal = groupDeal(prices, children);
    var childPrice = deal ? deal.childPrice : prices.CHILD_TICKET;
    var ticketsAtFull = children * prices.CHILD_TICKET;
    var ticketSubtotal = children * childPrice; // what is charged for the tickets
    var extraParentCharge = extraParent ? prices.EXTRA_PARENT : 0;
    var giftSubtotal = giftQty * prices.SANTA_GIFT;
    var bookingFee = prices.BOOKING_FEE || 0; // flat, once per booking
    return {
      children: children, childPrice: childPrice, ticketsAtFull: ticketsAtFull,
      couponCode: deal ? deal.code : '', discount: ticketsAtFull - ticketSubtotal,
      ticketSubtotal: ticketSubtotal, extraParent: !!extraParent,
      extraParentCharge: extraParentCharge, giftQty: giftQty, giftSubtotal: giftSubtotal, bookingFee: bookingFee,
      total: ticketSubtotal + extraParentCharge + giftSubtotal + bookingFee
    };
  }
  function rupees(n) {
    var s = String(Math.round(Number(n) || 0));
    var last3 = s.slice(-3), rest = s.slice(0, -3);
    return '₹' + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3;
  }
  function upiUri(upiId, payee, total, bookingId) {
    return 'upi://pay?pa=' + upiId + '&pn=' + encodeURIComponent(payee) + '&am=' + Number(total).toFixed(2) +
      '&cu=INR&tn=' + encodeURIComponent(bookingId + ' Christmas Carnival');
  }
  var api = { computeAmounts: computeAmounts, groupDeal: groupDeal, rupees: rupees, upiUri: upiUri };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LH_PRICING = api;
})(this);
