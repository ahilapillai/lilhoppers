/* Site settings. After deploying the Apps Script backend, paste its web app URL below. */
window.LH_CONFIG = {
  // The Apps Script web app URL (ends in /exec). Leave empty to run the site in demo mode (nothing is saved).
  API_URL: 'https://script.google.com/macros/s/AKfycbxpT8i_y2TjPHl-6cMQ4o7_Le266Rb6W945TDDivvx3KYQw7uHRS7YPDTIHNLcNycSs/exec',
  UPI_ID: 'ahilapil.26-1@okicici',
  UPI_PAYEE: 'Lil Hoppers',
  // BOOKING_FEE: the flat 'Booking & support fee' added once per booking.
  // GROUP_DEALS: codes applied automatically by the number of children (the lowest price that applies wins).
  PRICES: {
    CHILD_TICKET: 899, EXTRA_PARENT: 199, SANTA_GIFT: 299, BOOKING_FEE: 39,
    GROUP_DEALS: [{ code: 'LILHOP5', minChildren: 5, childPrice: 749 }, { code: 'LILHOP2', minChildren: 2, childPrice: 799 }]
  },
  MAX_CHILDREN: 10,
  HOLD_MINUTES: 20,
  EVENT_DATE: 'Sat, 12 Dec 2026',
  VENUE: 'Vata Vriksha, Indiranagar',
  MAPS_URL: 'https://share.google/GE3sdUk4LarPOcGPW',
  CONTACT_EMAIL: 'hello.lilhoppers@gmail.com',
  // Payment screenshots must show one of these names (or the UPI ID), today's date, and a time within this many minutes of upload.
  PAYEE_NAMES: ['AHILA PICHAIPILLAI'],
  SCREENSHOT_TOLERANCE_MINUTES: 15
};
