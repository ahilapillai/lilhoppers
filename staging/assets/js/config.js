// STAGING COPY (lilhoppers.co/staging): demo mode, no analytics. Live config is /assets/js/config.js.
/* Site settings. After deploying the Apps Script backend, paste its web app URL below. */
window.LH_CONFIG = {
  // The Apps Script web app URL (ends in /exec). Leave empty to run the site in demo mode (nothing is saved).
  API_URL: '',
  UPI_ID: 'ahilapil.26-1@okicici',
  UPI_PAYEE: 'Lil Hoppers',
  // BOOKING_FEE: the flat 'Booking & support fee' added once per booking.
  // GROUP_DEALS: codes applied automatically by the number of children (the lowest price that applies wins).
  PRICES: {
    CHILD_TICKET: 799, EXTRA_PARENT: 199, SANTA_GIFT: 299, BOOKING_FEE: 39,
    GROUP_DEALS: [{ code: 'LILHOP2', minChildren: 2, childPrice: 699 }]
  },
  MAX_CHILDREN: 10,
  HOLD_MINUTES: 20,
  EVENT_DATE: 'Sat, 12 Dec 2026',
  VENUE: 'Vata Vriksha, Indiranagar',
  MAPS_URL: 'https://share.google/GE3sdUk4LarPOcGPW',
  CONTACT_EMAIL: 'hello.lilhoppers@gmail.com',
  // Analytics (homepage and booking page only). Leave an ID empty to switch that tool off.
  //   GA4_ID: Google Analytics 4 measurement ID, e.g. 'G-AB12CD34EF' (Admin → Data streams → your web stream).
  //   CLARITY_ID: Microsoft Clarity project ID, e.g. 'abcd1234ef' (Settings → Overview). Free; records every visit.
  //   HOTJAR_ID: Hotjar site ID (numbers only), for an existing Hotjar account.
  //   CONTENTSQUARE_ID: Contentsquare tag ID (what new Hotjar sign-ups get), from the tag 't.contentsquare.net/uxa/<ID>.js'.
  //   META_PIXEL_ID: Meta Pixel (dataset) ID for Facebook/Instagram ads (Events Manager → Data sources), numbers only.
  ANALYTICS: { GA4_ID: '', CLARITY_ID: '', HOTJAR_ID: '', CONTENTSQUARE_ID: '', META_PIXEL_ID: '' },
  // Payment screenshots must show one of these names (or the UPI ID), today's date, and a time within this many minutes of upload.
  PAYEE_NAMES: ['AHILA PICHAIPILLAI'],
  SCREENSHOT_TOLERANCE_MINUTES: 15
};
