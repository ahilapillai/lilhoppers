/* Price maths shared by the booking page, admin page and demo backend. Must match apps-script/Code.gs. */
(function (root) {
  function computeAmounts(prices, children, extraParent, giftQty) {
    var ticketSubtotal = children * prices.CHILD_TICKET;
    var extraParentCharge = extraParent ? prices.EXTRA_PARENT : 0;
    var giftSubtotal = giftQty * prices.SANTA_GIFT;
    var bookingFee = prices.BOOKING_FEE || 0; // flat, once per booking
    return {
      children: children, ticketSubtotal: ticketSubtotal, extraParent: !!extraParent,
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
  var api = { computeAmounts: computeAmounts, rupees: rupees, upiUri: upiUri };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LH_PRICING = api;
})(this);
