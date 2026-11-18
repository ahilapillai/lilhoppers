# Lil' Hoppers Christmas Carnival — Product Requirements

Version 2.0 · 17 November 2026 · Owner: Ahila (design) for Lil' Hoppers

This version adds the final slot, add-on, payment and admin requirements to the booking site already designed (the "Lil' Hoppers Christmas Party" canvas). Everything not changed below stays as designed.

---

## 1. Event

| | |
|---|---|
| Event | Lil' Hoppers Christmas Carnival |
| Date | Saturday, 19 December 2026 |
| Venue | Vata Vriksha, Indiranagar — [Google Maps](https://share.google/GE3sdUk4LarPOcGPW) |
| Activities | Art station, cookie decoration, meet & greet Santa, photobooth, tattoo station (temporary), tote bag making, stalls, and more |
| Contact | hello.lilhoppers@gmail.com · Call or WhatsApp +91 96864 53295 · Instagram [@lil.hoppers](https://instagram.com/lil.hoppers) |

## 2. Users

- **Parents** book and pay on the public site (mostly on phones).
- **Admins** (the Lil' Hoppers team) check payments, confirm bookings and manage slot capacity.

## 3. Slots and capacity

| Slot | Time | Maximum children |
|---|---|---|
| Slot 1 | 2:00 PM – 3:30 PM | 32 |
| Slot 2 | 4:00 PM – 5:30 PM | 33 |
| Slot 3 | 6:00 PM – 7:30 PM | 35 |
| **Total** | | **100** |

Rules:

1. Capacity counts **children**, not bookings. A booking for 3 children uses 3 places.
2. Bookings that count toward capacity: **Pending Verification** and **Verified**.
3. Bookings that never count: **Abandoned** and **Rejected**.
4. Customers never see counts, capacity or remaining places.
5. When a slot is full it shows **"Sold Out"** and can't be selected.
6. If a slot has some places left but fewer than the children in a booking, the parent sees: "There aren't enough places left in this slot for N children. Try another slot or fewer children." No numbers are shown.
7. **No overbooking, including simultaneous submissions.** Every check-and-save runs inside a single server-side lock, so two parents can't take the last places at the same time.
8. **Payment hold (implementation decision).** When a parent moves to the payment step, their places are held for **20 minutes** so nobody else can take them while they pay. An active hold counts toward capacity. If proof of payment isn't submitted within 20 minutes, the booking becomes **Abandoned** and the places are released. This is what makes "Abandoned" a real state. Without a hold, a parent could pay for a place that someone else took in the meantime.
9. If a hold has expired and the slot filled up before the parent submits proof, the submission is still saved, but as **Rejected** with the reason "Slot full after hold expired — refund due". The admin can then refund the payment. The parent is told the same on screen.
10. Admins can see registration counts per slot and change each slot's capacity. Capacities below the current count are allowed (the slot simply shows Sold Out). Existing bookings are never removed automatically.
11. Maximum 10 children per booking.

## 4. Tickets and add-ons

| Item | Price | Rules |
|---|---|---|
| Child ticket | ₹899 per child | Includes entry for one parent. At least 1, at most 10 per booking. |
| Extra Parent | ₹199 | Optional. **Unchecked** by default. Maximum one per booking. |
| Personalised Gift from Santa | ₹299 per child | Labelled **"Optional"**. **Checked** by default. Parents can untick it before paying. With more than one child, the parent picks the gift quantity from 1 up to the number of children (default: one per child). |

- The price is shown beside every add-on.
- The total recalculates immediately whenever the number of children or any add-on changes.
- The server recalculates every amount itself and never trusts the amount sent by the browser.

Price checks (must always hold):

| Booking | Total |
|---|---|
| 1 child + Santa gift (default) | ₹1,198 |
| 1 child, no add-ons | ₹899 |
| 1 child + Santa gift + extra parent | ₹1,397 |

## 5. Customer journey

### 5.1 Landing page (unchanged from the design)

Dark purple-to-black background with very slow falling snow and twinkling fairy lights. Sections:

- **Hero:** "Christmas Carnival for kids", the date and venue on the left (no intro paragraph), a 3D Christmas tree in the centre that turns only with the visitor's hand (mouse, finger drag, or tilting an Android phone), and the activities on the right (titles and pictures only, no descriptions).
- **The party:** centred description.
- **What's inside:** the activities on a fairy-light arc.
- **Tickets and how booking works.** The When box shows the date and "From 2:00 PM onwards, 3 slots".
- **Footer:** "Call or WhatsApp +91 96864 53295" (tap to call) and an Instagram button linking to instagram.com/lil.hoppers.

Price and time copy is updated to ₹899 per ticket and the three slots. Every "Book tickets" button opens the booking flow (header, hero and tickets section).

### 5.2 Booking flow

1. **Choose:** pick a slot (sold-out slots disabled), the number of children, and add-ons. An itemized order summary updates live.
2. **Pay:** the itemized order summary is shown again, then:
   - A **UPI QR code** generated from the final total and the UPI ID `ahilapil.26-1@okicici`.
   - The UPI ID with a Copy button on its right, an "Open UPI app" button for paying on the same phone, a "pay the exact amount" note, and a countdown for the 20-minute hold.
   - A **Payment done** button.
   - The QR uses `upi://pay?pa=ahilapil.26-1@okicici&pn=Lil Hoppers&am=<total>.00&cu=INR&tn=<booking ID>`, so the booking ID appears in the payment note.
3. **Details (ticket):** parent's name, email, phone (10-digit Indian mobile), each child's name, and proof of payment: the UPI transaction ID (12-digit UTR) **or** a screenshot. At least one is required.
   - **Screenshot check.** As soon as a screenshot is chosen, the page reads its text and checks that it shows:
     1. the payee **AHILA PICHAIPILLAI** (or the UPI ID `ahilapil.26-1@okicici`), allowing for a couple of misread letters;
     2. **today's date**;
     3. a payment time within **15 minutes** of now (before or after).

     | Result | What the parent sees | Can they continue? |
     |---|---|---|
     | Passed | "Checked: paid to AHILA PICHAIPILLAI today at 1:42 PM." | Yes |
     | Failed: wrong date, time more than 15 minutes off, or a different payee | What the screenshot shows (for example "from 16 Nov 2026, 8:53 AM, not today") and a request to upload the right screenshot or type the UPI transaction ID instead | No, not with that screenshot |
     | Couldn't read (blurry, cropped, or the reader didn't load) | "We couldn't read the date and time… we'll check it by hand" | Yes, flagged for the admin |

     Dates are read in common app formats (16 November 2026, 16 Nov, Nov 16 2026, 16/11/2026, Today), and times as 8:53am, 08:53 PM or 13:44:10. The phone's status-bar clock is ignored. The amount is also looked for and reported to the admin, but doesn't block the booking.
     The check runs in the parent's browser (Tesseract OCR, about 7 MB downloaded the first time someone uploads a screenshot), so it stops honest mistakes and reused old screenshots. A determined person could still fake one, so the admin still confirms the money arrived before verifying. The payee names and the 15-minute window are set in `assets/js/config.js`.
4. **Ticket:** the booking ID, the status "Payment being checked", the slot, the names and the itemized amount. It says the confirmation email will follow once the payment is verified.

The in-progress booking survives a page reload during payment.

## 6. Statuses

| Booking status | Payment status | Counts toward capacity | How it gets there |
|---|---|---|---|
| Awaiting Payment | Not paid | Yes, while the 20-minute hold is active | Parent reached the payment step |
| Abandoned | Not paid | No | Hold expired without proof, or parent went back to change the booking |
| Pending Verification | **Pending** | Yes | Parent submitted proof of payment |
| Verified | Verified | Yes | Admin checked the payment and entered the amount received |
| Rejected | Rejected | No | Admin rejected it, or the hold expired and the slot was full |

Payment status stays **Pending** until an admin verifies it manually. Nothing is verified automatically.

## 7. Emails

All emails are sent from **hello.lilhoppers@gmail.com**. The backend runs under that Google account.

| Email | When | Contents |
|---|---|---|
| Pending verification | Automatically, as soon as proof is submitted | Booking ID, slot, children, itemized amount, the payment reference received, and a clear note that the booking is **not confirmed yet** |
| Booking confirmed | Only after an admin verifies the payment | Booking ID, slot, date, venue and map link, children, what each ticket admits, itemized amount, amount received, and "show this email at the entrance" |

No email is sent for rejections. The admin contacts the parent directly, for example to arrange a refund.

## 8. Admin

The admin page is protected by a passcode stored on the server. It shows:

- **Slots:** capacity (editable), verified children, pending children, active holds, total counted, and whether the slot is sold out. Also the overall total against the overall capacity (100).
- **Bookings:** every booking with an itemized breakdown:
  - Ticket subtotal (children × ₹899)
  - Extra parent charge
  - Santa gift quantity and subtotal
  - **Total expected**
  - **Actual verified amount**

  Each booking also shows the parent, contact details, children's names, UTR, a screenshot link (Google Drive), the **screenshot check** result (Screenshot OK / Couldn't read / Not checked, what date and time it shows, minutes before upload, and whether the amount was seen), statuses and timestamps. Bookings can be filtered by status and slot, and searched.
- **Actions:**
  - **Verify:** the admin enters the amount actually received (defaults to the expected amount, and warns if they differ). This sets the booking to Verified and sends the confirmation email.
  - **Reject:** requires a reason.

## 9. Data and integrations

- **Google Sheets is the system of record.** Every booking and payment detail is written to the "Bookings" sheet as it happens, and capacities live in the "Slots" sheet. Columns: Booking ID, Created At, Slot ID, Slot Time, Children, Child Names, Parent Name, Email, Phone, Extra Parent, Extra Parent Charge, Ticket Subtotal, Santa Gift Qty, Santa Gift Subtotal, Expected Total, UPI Transaction ID, Screenshot URL, Screenshot Check, Screenshot Shows, Screenshot Check Note, Status, Payment Status, Verified Amount, Verified At, Hold Expires At, Submitted At, Pending Email Sent At, Confirmation Email Sent At, Rejection Reason, Admin Notes.
- **Google Drive:** screenshots are saved to the "Lil Hoppers – Payment screenshots" folder, named with the booking ID, and linked from the booking row. They stay private to the hello.lilhoppers account.
- **Backend:** a Google Apps Script web app bound to the sheet, deployed as hello.lilhoppers@gmail.com. A timer job marks expired holds as Abandoned every 10 minutes. Capacity checks also do this on the spot.
- **Hosting:** the public site and admin page are static files on GitHub Pages.

## 10. Non-functional

- No counts or capacity in any public response from the server. The public API only returns sold-out flags.
- Mobile first. Touch targets are at least 44 px, and forms work with UPI apps on the same phone.
- Falling snow appears on the home page only, not in the booking flow.
- Visitors whose devices ask for reduced motion get no falling snow and still lights.
- If 3D isn't available, the tree falls back to an image.
- Screenshots up to 5 MB (images only). They are compressed in the browser before upload.

## 11. Open items

1. Confirm the 20-minute payment hold (section 3, rule 8).
2. Personal UPI IDs can hit app limits or warnings when a payment link includes the amount. Do one real test payment from GPay, PhonePe and Paytm before launch, and consider a merchant UPI ID.
3. Refund policy wording for rejected or duplicate payments.
4. Parental consent for the photos of children used on the site.
