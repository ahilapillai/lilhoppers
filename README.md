# Lil' Hoppers Christmas Carnival

Booking site for the Lil' Hoppers Christmas Carnival (Sat 12 Dec 2026, Vata Vriksha, Indiranagar).

- **`index.html`**: the landing page, with the 3D tree that turns with the visitor's hand, snow and fairy lights.
- **`book.html`**: the booking flow. Parents pick a slot and add-ons and pay by UPI QR on one page (they can still change things while paying), then share proof of payment and get a ticket.
- **`checkin.html`**: the volunteer door check-in page (`https://lilhoppers.co/checkin`). Volunteers scan the entry QR from the confirmation email and see who is allowed in.
- **`admin.html`**: the admin page (`https://lilhoppers.co/admin`). Shows slot counts and capacity, and every booking with the parent's details, itemized payment, screenshot and screenshot check. Admins verify or reject payments here.
- **`apps-script/`**: the backend, a Google Apps Script web app. It stores bookings in Google Sheets, saves screenshots to Google Drive, and sends email from hello.lilhoppers@gmail.com.
- **`docs/PRD.md`**: the product requirements.

Until the backend is connected, the site runs in **demo mode**. Everything works, but bookings are only kept in your own browser. The admin passcode in demo mode is `demo`.

## 1. Put the site online (GitHub Pages)

1. In this repo on GitHub, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*, then choose the **main** branch and the **/ (root)** folder, and click **Save**.
3. After a minute the site is live at `https://lilhoppers.co` (the `CNAME` file sets the custom domain; DNS at Namecheap has four A records for `@` pointing to 185.199.108.153 / 109 / 110 / 111 and a CNAME `www` → `ahilapillai.github.io`). The admin page is at `https://lilhoppers.co/admin`.

## 2. Set up the backend (once, as hello.lilhoppers@gmail.com)

Do every step signed in to Google as **hello.lilhoppers@gmail.com**. Emails are sent from whichever account deploys the backend.

1. **Create the sheet.** Go to [sheets.new](https://sheets.new) and name the sheet "Lil Hoppers – Christmas Carnival bookings".
2. **Add the code.** Open **Extensions → Apps Script**, delete the sample code, and paste in everything from `apps-script/Code.gs`.
3. **Add the manifest.** Click **Project Settings** (gear icon), tick **Show "appsscript.json" manifest file in editor**, go back to the editor, and replace that file's contents with `apps-script/appsscript.json`.
4. **Run setup.** Click **Save**, choose **setup** in the function dropdown and click **Run**.
   - Allow the permissions it asks for. Google warns that the app isn't verified: click **Advanced → Go to (project name)**.
   - `setup` creates the **Bookings** and **Slots** tabs (with capacities 32, 33 and 35), the Drive folder "Lil Hoppers – Payment screenshots", a 10-minute job that releases expired holds, and the **admin passcode**.
5. **Note the passcode.** Open **Executions** (left bar) and click the latest `setup` run to see the admin passcode. You can change it any time under **Project Settings → Script properties → ADMIN_PASSCODE**.
6. **Deploy.** Click **Deploy → New deployment**, choose **Web app**, set **Execute as: Me** and **Who has access: Anyone**, then click **Deploy**. Copy the **Web app URL** (it ends in `/exec`).
7. **Connect the site.** Paste that URL into `assets/js/config.js` as `API_URL`, then commit. Demo mode switches off automatically.
8. **Test it.** Make one real booking with a real UPI payment, then verify it on the admin page. Check that both emails arrive and that the payment links work in GPay, PhonePe and Paytm.

**Changing the code later:** edit it in Apps Script, then go to **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same.

## How it works

- **Places are counted per child.** Pending Verification and Verified bookings count toward capacity, and so does a 20-minute hold while a parent is paying. Abandoned and Rejected bookings never count.
- **No overbooking.** Every capacity check and save happens inside a single Apps Script lock, so simultaneous bookings can't take the same last place.
- **No numbers shown to parents.** The public site only ever learns whether a slot is sold out.
- **Payment screenshots are checked on upload.** The booking page reads the screenshot and only accepts it if it shows AHILA PICHAIPILLAI (or the UPI ID), today's date and a time within 15 minutes of now. Unreadable screenshots are accepted but flagged "Couldn't read" for the admin. Change the names or the window in `assets/js/config.js` (`PAYEE_NAMES`, `SCREENSHOT_TOLERANCE_MINUTES`). See `docs/PRD.md` section 5.2.
- **Payment status stays Pending** until an admin verifies it.
  - On submission the parent automatically gets the "payment being checked" email.
  - When an admin verifies the payment, the parent gets the confirmation email.
- **Changing prices or the ₹39 booking & support fee (`BOOKING_FEE`):** update both `CONFIG.PRICES` in `apps-script/Code.gs` and `PRICES` in `assets/js/config.js`, and the line under "₹899 a ticket." on the homepage. The booking page takes the prices from the backend, so its summary always matches the QR amount.
- **Changing capacities:** use the admin page, or edit the **Slots** tab.
- **Rejecting a booking, even a verified one:** click **Reject** on the admin page, or pick **Rejected** in the booking's **Status** dropdown in the sheet. Its places go back on sale straight away, and the parent gets an email saying the payment couldn't be verified, asking them to email the payment screenshot to hello.lilhoppers@gmail.com (sent once per booking).
- **Confirming a booking:** click **Send confirmation** on the admin page, or pick **Verified** in its **Status** dropdown in the sheet. Either way the parent gets the confirmation email (only once), and the amount received is filled in as the expected total unless you've typed one.
- **Door check-in:** the confirmation email has an entry QR, a link to `lilhoppers.co/checkin.html?b=<booking ID>`.
  - Volunteers open **lilhoppers.co/checkin** on their phone and enter the **volunteer passcode** (setup creates it; it's shown at the top of the admin page and only opens the check-in page). The phone remembers it.
  - They scan the QR with the page's camera (or with the phone's own camera app, which opens the page) or type the booking ID.
  - They see a green **Valid ticket**, an amber **Already checked in**, or a red **Payment not verified yet / Booking rejected / Not paid**, with how many kids and grown-ups to let in (one parent per child, plus the extra parent if booked), the names, the slot and the Santa gifts.
  - **Check in** records the time in the **Checked In At** column; scanning the same ticket again shows "Already checked in". **Undo check-in** fixes a mistake. The admin page shows arrivals per slot.
- **Slots in the Bookings tab** are recorded by their time (the **Slot Time** column). If you change a slot's time in the **Slots** tab after bookings exist, change it in those bookings too.

## Tests

```bash
node --test tests/*.test.js  # backend logic (pricing, capacity, holds, emails, admin) and the screenshot reader rules
python3 tests/e2e.py         # browser tests of every page in demo mode, including real OCR on sample screenshots and a fake camera scanning the entry QR (needs Playwright, Chrome and ffmpeg)
```
