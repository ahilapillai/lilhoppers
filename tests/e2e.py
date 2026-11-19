"""Browser tests for the site in demo mode (no backend). Run: python3 tests/e2e.py
Needs: pip install playwright opencv-python-headless && a Chrome/Chromium."""
import http.server, socketserver, threading, os, sys, re, functools
import cv2, numpy as np
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(ROOT, 'tests', 'fixtures', 'gpay-16-nov-2026.png')  # a copy of the GPay screenshot Ahila shared (16 Nov 2026, 8:53am)
OUT = os.environ.get('E2E_SHOTS', '/tmp/lh-shots')
os.makedirs(OUT, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        # Always test in demo mode: serve config.js with API_URL emptied, so tests never touch the real bookings.
        if self.path.split('?')[0] == '/assets/js/config.js':
            src = open(os.path.join(ROOT, 'assets', 'js', 'config.js'), encoding='utf-8').read()
            body = re.sub(r"API_URL:\s*'[^']*'", "API_URL: ''", src).encode('utf-8')
            self.send_response(200); self.send_header('Content-Type', 'application/javascript'); self.send_header('Content-Length', str(len(body))); self.end_headers()
            self.wfile.write(body); return
        return super().do_GET()
handler = functools.partial(Quiet, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.ThreadingTCPServer(('127.0.0.1', 0), handler)
httpd.daemon_threads = True
PORT = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{PORT}'

failures = []
FAIL_MSG = "This doesn't look like a payment to Lil' Hoppers. Please upload the screenshot of the payment you just made."
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: failures.append(msg)

def decode_qr(png_bytes):
    img = cv2.imdecode(np.frombuffer(png_bytes, np.uint8), cv2.IMREAD_COLOR)
    img = cv2.copyMakeBorder(img, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    data, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    return data

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
        # keep the tests offline: anything other than the local test server fails fast
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'])

    # ---------- landing ----------
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE + '/index.html')
    page.wait_for_timeout(2500)
    check(not errors, 'landing: no script errors ' + str(errors[:2]))
    check(page.locator('.lh-bulb').count() == 18 + 18 + 8, 'landing: fairy lights rendered (%d)' % page.locator('.lh-bulb').count())
    n = page.locator('.lh-flake').count(); check(60 < n < 150, 'landing: snowflakes rendered, fewer than before (%d)' % n)
    check(page.locator('template').count() == 0, 'landing: all templates expanded')
    body = page.inner_text('body')
    check('₹899' in body and '₹799' not in body, 'landing: shows ₹899, no old ₹799')
    check('Plus a ₹39 booking & support fee per booking.' in body, 'landing: the booking & support fee is shown next to the ticket price')
    check('Christmas Carnival' in body, 'landing: says Christmas Carnival')
    check('From 2:00 PM onwards, 3 slots' in body and 'Slot 1' not in body, 'landing: When box says "From 2:00 PM onwards, 3 slots"')
    check('An afternoon of art' not in body and 'Paint and glitter fun' not in body and 'Each ticket lets in' not in body, 'landing: removed copy is gone')
    check('+91 96864 53295' in body and page.locator('footer a[href="https://instagram.com/lil.hoppers"]').count() == 1 and page.locator('footer a[href="book.html"]').count() == 0, 'landing: footer has the phone number and Instagram, no Book tickets')
    check(page.locator('a[href="book.html"]').count() >= 3, 'landing: Book tickets buttons go to book.html')
    canvas_ok = page.evaluate("() => { const c = document.getElementById('tree3d'); return !c.hidden && c.width > 0; }")
    fallback = page.evaluate("() => !document.getElementById('treeFallback').hidden")
    check(canvas_ok or fallback, 'landing: 3D tree drawn (or image fallback shown)')
    page.screenshot(path=f'{OUT}/landing-hero.png')
    page.mouse.move(1200, 400); page.wait_for_timeout(1200)
    page.screenshot(path=f'{OUT}/landing-hero-turned.png')
    page.screenshot(path=f'{OUT}/landing-full.png', full_page=True)
    page.close()  # one 3D tree at a time keeps the software renderer responsive
    m = browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    m.goto(BASE + '/index.html', wait_until='domcontentloaded'); m.wait_for_timeout(2500)
    m.screenshot(path=f'{OUT}/landing-mobile.png')
    check(m.evaluate('document.documentElement.scrollWidth') <= 391, 'landing mobile: no sideways scrolling')
    m.close()

    # ---------- booking ----------
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE + '/book.html')
    page.wait_for_selector('.bk-slot')
    check(page.locator('#demoBanner').is_visible(), 'book: demo banner shown when no API_URL')
    total = lambda: page.inner_text('#chooseTotal')
    check('Booking & support fee' in page.inner_text('#chooseLines') and '₹39' in page.inner_text('#chooseLines'), 'book: the ₹39 booking & support fee is a line in the order summary from the start')
    check(total() == '₹938', 'book: default 1 child, no add-ons = ₹938 (got %s)' % total())
    check(not page.is_checked('#giftOn') and not page.is_checked('#extraParent'), 'book: gift and extra parent unchecked by default')
    check(page.inner_text('#kidsDeal') == 'Book 2+ kids for ₹799 each (LILHOP2)', 'book: one child sees the 2+ kids deal (%s)' % page.inner_text('#kidsDeal'))
    kids_card = page.locator('.bk-card-groups')
    check(kids_card.count() == 1 and 'How many children?' in kids_card.inner_text() and 'Add-ons' in kids_card.inner_text(), 'book: add-ons sit in the same card as "How many children?"')
    check(page.evaluate("getComputedStyle(document.querySelector('.bk-group-sep')).borderTopStyle") == 'solid', 'book: a separator line above Add-ons')
    page.check('#giftOn')
    check(total() == '₹1,237', 'book: 1 child + Santa gift = ₹1,237 (got %s)' % total())
    check('optional' in page.inner_text('.bk-addon-gift').lower(), 'book: Santa gift labelled Optional')
    check(page.locator('.bk-addon .bk-price').count() == 2, 'book: price shown beside each add-on')
    page.uncheck('#giftOn')
    check(total() == '₹938', 'book: 1 child no add-ons = ₹938 (got %s)' % total())
    page.check('#giftOn'); page.check('#extraParent')
    check(total() == '₹1,436', 'book: 1 child + gift + extra parent = ₹1,436 (got %s)' % total())
    check(not page.locator('#giftQtyRow').is_visible(), 'book: gift quantity hidden for one child')
    page.click('#kidsPlus'); page.click('#kidsPlus')
    check(page.locator('#giftQtyRow').is_visible(), 'book: gift quantity appears for 3 children')
    check(page.locator('#giftQty option').count() == 3 and page.input_value('#giftQty') == '3', 'book: gift quantity goes up to 3, defaults to 3')
    check(total() == '₹3,532', 'book: 3 kids + 3 gifts + extra parent = ₹3,532 (got %s)' % total())
    check(page.inner_text('#kidsDeal') == 'LILHOP2 applied: ₹799 per child · 5+ kids for ₹749 each', 'book: deal line under the stepper (%s)' % page.inner_text('#kidsDeal'))
    deal_line = page.locator('#chooseLines .bk-line-deal')
    check(deal_line.count() == 1 and deal_line.inner_text().replace('\n', ' ').replace('\t', ' ') .split() == ['Code', 'LILHOP2', 'auto-applied', '−₹300'], 'book: "Code LILHOP2 auto-applied −₹300" just above the total (%s)' % deal_line.inner_text())
    check(page.evaluate("[...document.querySelectorAll('#chooseLines > div')].pop().className") == 'bk-line-deal', 'book: the deal is the last line before the total')
    page.select_option('#giftQty', '1')
    check(total() == '₹2,934', 'book: 3 kids + 1 gift + extra parent = ₹2,934 (got %s)' % total())
    page.screenshot(path=f'{OUT}/book-choose.png', full_page=True)
    page.click('#toPay')
    check('Pick a time first' in page.inner_text('#chooseError'), 'book: needs a slot before continuing')
    page.click('.bk-slot >> nth=1')
    check(page.locator('#consentRow').is_visible() and page.inner_text('#consentRow').strip() == 'I agree to photo consent', 'book: "I agree to photo consent" shown in the order summary')
    check(page.is_checked('#photoOk'), 'book: photo consent is ticked by default')
    page.uncheck('#photoOk')
    page.click('#consentInfo')
    check(page.locator('#consentDlg').is_visible() and 'collaborating with various brands' in page.inner_text('#consentDlg') and not page.is_checked('#photoOk'), 'book: "photo consent" opens the popup without changing the box')
    page.click('#consentClose')
    check(page.locator('#consentDlg').is_hidden() and not page.is_checked('#photoOk'), 'book: closing the popup leaves the box as it was')
    box = page.locator('#consentRow').bounding_box()
    check(box and box['height'] < 30, 'book: photo consent fits on one line (%s px tall)' % (box and round(box['height'])))
    page.click('#toPay')
    check('Tick the box' in page.inner_text('#chooseError') and page.locator('#payPanel').is_hidden(), 'book: needs the photo consent tick before paying')
    page.click('#consentInfo'); page.click('#consentAgree')
    check(page.is_checked('#photoOk') and page.locator('#consentDlg').is_hidden(), 'book: "I agree" in the popup ticks the box')
    check(page.locator('#chooseError').is_hidden(), 'book: ticking the box clears the message')
    check(page.locator('.bk-steps li').count() == 3 and 'Choose & pay' in page.inner_text('.bk-steps'), 'book: three steps, the first is "Choose & pay"')
    check('Pay ₹2,934' in page.inner_text('#toPay'), 'book: Pay button shows the total')
    page.click('#toPay')
    page.wait_for_selector('#payPanel:not([hidden])'); page.wait_for_timeout(900)
    check(page.locator('#step-choose').is_visible() and page.locator('#toPay').is_hidden(), 'book: QR appears on the same page, next to the choices')
    href = page.get_attribute('#upiLink', 'href')
    check(href.startswith('upi://pay?pa=ahilapil.26-1@okicici&pn=Lil%20Hoppers&am=2934.00&cu=INR&tn=LH-'), 'book: UPI link uses the final total and UPI ID')
    qr = decode_qr(page.locator('#qr').screenshot())
    check(qr == href, 'book: QR code decodes to the same UPI payment link (%s)' % qr[:60])
    check(re.match(r'^\d{1,2}:\d\d$', page.inner_text('#countdown')) is not None, 'book: hold countdown running')
    first_id = page.inner_text('#payPanel [data-fill="bookingId"]')
    # Edit while paying: one more child and no extra parent. Same booking, new total, new QR.
    page.click('#kidsPlus'); page.uncheck('#extraParent')
    page.wait_for_function("() => !document.getElementById('payPanel').classList.contains('is-updating') && /am=3534\\.00/.test(document.getElementById('upiLink').href)", timeout=8000)
    page.wait_for_timeout(500)  # QR un-blurs
    check(page.inner_text('#chooseTotal') == '₹3,534', 'book: editing while paying updates the total (got %s)' % page.inner_text('#chooseTotal'))
    href2 = page.get_attribute('#upiLink', 'href')
    check('am=3534.00' in href2 and decode_qr(page.locator('#qr').screenshot()) == href2, 'book: QR follows the edit')
    check(page.inner_text('#payPanel [data-fill="bookingId"]') == first_id, 'book: editing keeps the same booking ID (%s)' % first_id)
    page.click('#kidsMinus'); page.check('#extraParent')
    page.wait_for_function("() => !document.getElementById('payPanel').classList.contains('is-updating') && /am=2934\\.00/.test(document.getElementById('upiLink').href)", timeout=8000)
    page.screenshot(path=f'{OUT}/book-pay.png', full_page=True)
    page.reload(); page.wait_for_selector('#payPanel:not([hidden])')
    check(page.inner_text('#chooseTotal') == '₹2,934' and page.locator('#qr svg').count() == 1, 'book: payment survives a reload')
    page.click('#paid')
    page.wait_for_selector('#step-details:not([hidden])')
    check(page.locator('#childFields input').count() == 3, 'book: one name field per child')
    page.click('#submitDetails')
    check("parent's name" in page.inner_text('#detailsError'), 'book: validates the form')
    page.fill('#parentName', 'Meera Iyer'); page.fill('#email', 'meera@example.com'); page.fill('#phone', '98450 12345')
    for i in range(3): page.fill(f'#child{i}', ['Aarav', 'Diya', 'Kabir'][i])
    page.click('#submitDetails')
    check(page.inner_text('#detailsError') == 'Upload the screenshot of your payment.' and 'is-missing' in page.get_attribute('#uploadBox', 'class'), 'book: the payment screenshot is required')
    check(page.locator('#utr').count() == 0 and 'transaction ID' not in page.inner_text('#step-details'), 'book: no UPI transaction ID field; screenshot is the only proof')
    page.set_input_files('#shot', files=[{'name': 'pay.png', 'mimeType': 'image/png', 'buffer': cv2.imencode('.png', np.full((40, 40, 3), 200, np.uint8))[1].tobytes()}])
    page.wait_for_selector('#shotPreview:not([hidden])')
    page.wait_for_selector('#shotCheck[data-state=unreadable]', timeout=90000)
    check("couldn't read" in page.inner_text('#shotCheck').lower(), 'book: a screenshot with no text is "couldn\'t read", and can still be sent')
    page.screenshot(path=f'{OUT}/book-details.png', full_page=True)
    page.click('#submitDetails')
    page.wait_for_selector('#step-done:not([hidden])')
    done = page.inner_text('#step-done')
    check('Payment being checked' in done and 'LH-DEMO' in done and 'Aarav, Diya, Kabir' in done and '₹2,934' in done, 'book: ticket shows ID, pending status, names and total')
    check('3 kids + 4 parents' in done, 'book: ticket admits 3 kids + 4 parents')
    page.screenshot(path=f'{OUT}/book-done.png', full_page=True)
    check(not errors, 'book: no script errors ' + str(errors[:2]))

    mob = ctx.new_page(); mob.set_viewport_size({'width': 390, 'height': 844})
    mob.goto(BASE + '/book.html'); mob.click('text=Book another') if mob.locator('#step-done:not([hidden])').count() else None
    mob.wait_for_selector('.bk-slot'); mob.screenshot(path=f'{OUT}/book-mobile.png', full_page=True)
    check(mob.evaluate('document.documentElement.scrollWidth') <= 391, 'book mobile: no sideways scrolling')
    mob.close()

    # ---------- payment screenshot check (real OCR in the browser) ----------
    IST = ZoneInfo('Asia/Kolkata')
    now = datetime.now(IST)
    def receipt(payee, when, amount='₹1,237', dark=False):
        bg, fg, sub = ('#111318', '#F1F1F1', '#B5B5B5') if dark else ('#FFFFFF', '#1F1F1F', '#5F6368')
        stamp = when.strftime('%-d %B %Y, %-I:%M') + when.strftime('%p').lower()
        html = f'''<body style="margin:0;background:{bg};font-family:Roboto,Arial,sans-serif;color:{fg}">
        <div style="width:420px;padding:40px 24px;text-align:center">
        <div style="text-align:left;font-size:14px;color:{sub}">{now.strftime('%-I:%M')}</div>
        <div style="margin-top:60px;font-size:44px">{amount}</div>
        <div style="margin-top:30px;font-size:18px;color:{sub}">Paid to</div>
        <div style="margin-top:6px;font-size:28px">{payee}</div>
        <div style="margin-top:12px;font-size:16px">Banking name: {payee}</div>
        <div style="margin-top:14px;font-size:17px;color:{sub}">{stamp}</div>
        <div style="margin-top:40px;font-size:15px;color:{sub}">UPI transaction ID<br>412345678901</div></div></body>'''
        pg = browser.new_page(viewport={'width': 420, 'height': 640}, device_scale_factor=2)
        pg.set_content(html); png = pg.screenshot(); pg.close()
        return png
    fresh = receipt('AHILA PICHAIPILLAI', now - timedelta(minutes=3))
    old_dark = receipt('AHILA PICHAIPILLAI', now - timedelta(minutes=40), dark=True)
    stranger = receipt('RAVI KUMAR', now - timedelta(minutes=2))
    for name, png in [('fresh', fresh), ('old-dark', old_dark), ('stranger', stranger)]:
        open(f'{OUT}/receipt-{name}.png', 'wb').write(png)

    sc = browser.new_context(viewport={'width': 1280, 'height': 900}, timezone_id='Asia/Kolkata')
    pg = sc.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(BASE + '/book.html'); pg.wait_for_selector('.bk-slot')
    check(pg.locator('.lh-flake').count() == 0, 'book: no snowflakes on the booking pages')
    pg.check('#giftOn')  # 1 kid + gift = ₹1,237, the amount on the sample receipts
    pg.click('.bk-slot >> nth=2'); pg.click('#toPay'); pg.wait_for_selector('#payPanel:not([hidden])'); pg.wait_for_timeout(900)  # let the panel scroll into view
    box = pg.locator('.bk-upi-row').bounding_box(); cp = pg.locator('#copyUpi').bounding_box(); code = pg.locator('#upiId').bounding_box()
    check(abs((cp['y'] + cp['height'] / 2) - (code['y'] + code['height'] / 2)) < 4 and cp['x'] > code['x'] + code['width'] - 2, 'book: Copy button sits to the right of the UPI ID')
    pg.locator('#chooseCard').screenshot(path=f'{OUT}/book-pay-card.png')
    check('1 kid + 1 parent' in pg.inner_text('#chooseCard') and 'Child tickets' not in pg.inner_text('#chooseCard') and 'Pay exactly' not in pg.inner_text('#chooseCard'), 'pay: summary says "1 kid + 1 parent"; no repeated exact-amount note')
    check(pg.locator('#changeBooking').is_visible() is False and 'Change my booking' not in pg.inner_text('#step-choose'), 'pay: no "Change my booking" button')
    pg.click('#paid'); pg.wait_for_selector('#step-details:not([hidden])')
    check('so that we can confirm your booking' in pg.inner_text('#step-details'), 'details: new subtitle')
    pg.fill('#parentName', 'Priya Nair'); pg.fill('#email', 'priya@example.com'); pg.fill('#phone', '9876543210'); pg.fill('#child0', 'Ira')
    def upload(name, data):
        if pg.locator('#shotPreview:not([hidden])').count(): pg.click('#shotRemove')
        pg.set_input_files('#shot', files=[{'name': name, 'mimeType': 'image/png', 'buffer': data}])
        pg.wait_for_selector('#shotCheck:not([data-state=checking])', timeout=90000)
        return pg.get_attribute('#shotCheck', 'data-state'), pg.inner_text('#shotCheck')
    st, msg = upload('gpay-16-nov.png', open(SAMPLE, 'rb').read())
    check(st == 'fail' and msg.strip() == FAIL_MSG, "check: the 16 Nov GPay screenshot is rejected with the one short message (%s: %s)" % (st, msg[:90]))
    pg.locator('#shotPreview').screenshot(path=f'{OUT}/check-fail-old-date.png')
    pg.click('#submitDetails')
    check(pg.inner_text('#detailsError') == FAIL_MSG, 'check: a rejected screenshot blocks "Get my ticket"')
    st, msg = upload('old-dark.png', old_dark)
    check(st == 'fail' and msg.strip() == FAIL_MSG, 'check: dark-mode screenshot from 40 min ago is rejected (%s: %s)' % (st, msg[:90]))
    st, msg = upload('stranger.png', stranger)
    check(st == 'fail' and msg.strip() == FAIL_MSG and 'AHILA' not in msg, 'check: payment to someone else is rejected (%s: %s)' % (st, msg[:90]))
    st, msg = upload('fresh.png', fresh)
    check(st == 'pass' and 'Checked: paid today at' in msg and 'AHILA' not in msg, 'check: fresh screenshot to Ahila passes (%s: %s)' % (st, msg[:90]))
    pg.locator('#shotPreview').screenshot(path=f'{OUT}/check-pass.png')
    pg.locator('.bk-proof').screenshot(path=f'{OUT}/check-proof-section.png')
    pg.click('#submitDetails'); pg.wait_for_selector('#step-done:not([hidden])')
    check('Screenshot uploaded' in pg.inner_text('#step-done'), 'check: booking goes through with a passing screenshot')
    check(pg.locator('#step-done a[href="https://wa.me/919686453295"]').count() == 1 and 'in 2 days' in pg.inner_text('#step-done'), 'ticket: WhatsApp line for missing confirmations')
    check(not errors, 'check: no script errors ' + str(errors[:2]))
    ad2 = sc.new_page(); ad2.goto(BASE + '/admin.html'); ad2.fill('#passcode', 'demo'); ad2.click('#login button'); ad2.wait_for_selector('#dash:not([hidden])')
    r0 = ad2.locator('#rows tr >> nth=0').inner_text()
    check('Priya Nair' in r0 and 'Screenshot OK' in r0 and 'amount ₹1,237 seen' in r0, 'admin: shows the screenshot check result (%s)' % r0.replace('\n', ' | ')[-160:])
    ad2.click('#rows button[data-act=shot]')
    check(ad2.locator('#shotView').evaluate('i => i.complete && i.naturalWidth > 100'), 'admin: screenshot opens in a viewer')
    ad2.screenshot(path=f'{OUT}/admin-shot-viewer.png')
    ad2.click('#shotClose')
    ad2.locator('.ad-table-wrap').screenshot(path=f'{OUT}/admin-table.png')
    ad2.close(); sc.close()

    # ---------- admin ----------
    adm = ctx.new_page()
    errors = []
    adm.on('pageerror', lambda e: errors.append(str(e)))
    adm.goto(BASE + '/admin.html')
    adm.fill('#passcode', 'wrong'); adm.click('#login button')
    adm.wait_for_selector('#loginError:not([hidden])')
    check('Wrong passcode' in adm.inner_text('#loginError'), 'admin: wrong passcode refused')
    adm.fill('#passcode', 'demo'); adm.click('#login button')
    adm.wait_for_selector('#dash:not([hidden])')
    check('of 100' in adm.inner_text('#totals'), 'admin: overall capacity is 100')
    s2 = adm.locator('.ad-slot >> nth=1').inner_text()
    check('Pending\n3' in s2 or 'PENDING\n3' in s2.upper(), 'admin: slot 2 shows 3 pending children')
    row = adm.locator('#rows tr >> nth=0').inner_text()
    for frag in ['₹2,397', 'LILHOP2', '₹199', '₹299', '₹39', '₹2,934', 'Santa gift × 1', 'Meera Iyer', 'Pending Verification']:
        check(frag in row, 'admin: row shows ' + frag)
    adm.screenshot(path=f'{OUT}/admin.png', full_page=True)
    adm.click('#rows button[data-act=verify]')
    check(adm.input_value('#verifyAmount') == '2934', 'admin: verify defaults to the expected amount')
    adm.fill('#verifyAmount', '3000')
    check(adm.locator('#verifyWarn').is_visible(), 'admin: warns when amount differs')
    adm.fill('#verifyAmount', '2934'); adm.fill('#verifyNote', 'Matched in GPay')
    adm.click('#verifyGo')
    adm.wait_for_function("() => document.querySelector('#rows').innerText.includes('Verified')")
    row = adm.locator('#rows tr >> nth=0').inner_text()
    check('Verified' in row and row.count('₹2,934') >= 2, 'admin: booking verified with the verified amount')
    # capacity: set slot 1 to 0 -> sold out on the booking page
    adm.fill('#cap-S1', '0'); adm.click('.ad-slot >> nth=0 >> button')
    adm.wait_for_function("() => document.querySelector('.ad-slot').innerText.includes('Sold Out')")
    check(True, 'admin: capacity change makes slot 1 Sold Out')
    check(not errors, 'admin: no script errors ' + str(errors[:2]))
    adm.close()

    bk = ctx.new_page()
    bk.goto(BASE + '/book.html')
    if bk.locator('#step-done:not([hidden])').count(): bk.click('#bookAnother')
    bk.wait_for_selector('.bk-slot.is-sold')
    check(bk.locator('.bk-slot.is-sold input').is_disabled() and 'sold out' in bk.inner_text('.bk-slot.is-sold').lower(), 'book: sold-out slot shows "Sold Out" and is disabled')
    check(not re.search(r'\b(32|33|35|remaining|left:)\b', bk.inner_text('#slotList')), 'book: no counts or capacity shown')
    bk.screenshot(path=f'{OUT}/book-soldout.png', full_page=True)
    browser.close()

    # ---------- volunteer door check-in (fake camera plays the entry QR) ----------
    import subprocess
    from PIL import Image
    Y4M = '/tmp/lh-cam.y4m'
    if os.path.exists(Y4M): os.remove(Y4M)
    cam = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
        '--use-file-for-fake-video-capture=' + Y4M, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'])
    cctx = cam.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    cctx.grant_permissions(['camera'], origin=BASE)
    v = cctx.new_page(); verrors = []
    v.on('pageerror', lambda e: verrors.append(str(e)))
    v.goto(BASE + '/book.html'); v.wait_for_selector('.bk-slot')
    ids = v.evaluate('''async () => {
      const A = window.LH_API, out = {};
      const mk = async (n, extra, verify) => {
        const h = await A.call('createHold', { slotId: 'S2', children: n, extraParent: extra, giftQty: n });
        await A.call('submitBooking', { bookingId: h.bookingId, parentName: 'Meera Iyer', email: 'm@example.com', phone: '9845012345', childNames: n === 2 ? ['Ira', 'Kabir'] : ['Zoya'], screenshot: { name: 'pay.png', mimeType: 'image/png', data: 'iVBORw0KGgo=' } });
        if (verify) await A.call('adminVerify', { passcode: 'demo', bookingId: h.bookingId, verifiedAmount: h.amounts.total });
        return h.bookingId; };
      out.family = await mk(2, true, true); out.solo = await mk(1, false, true); out.pending = await mk(1, false, false);
      return out; }''')
    subprocess.run(['node', os.path.join(ROOT, 'tests', 'make_qr.js'), 'https://lilhoppers.co/checkin.html?b=' + ids['family'], '/tmp/lh-cam-qr.gif'], check=True)
    Image.open('/tmp/lh-cam-qr.gif').convert('RGB').save('/tmp/lh-cam-qr.png')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-loop', '1', '-i', '/tmp/lh-cam-qr.png', '-t', '4', '-r', '10',
        '-vf', 'scale=480:480,pad=640:480:80:0:white,format=yuv420p', '-f', 'yuv4mpegpipe', Y4M], check=True)

    v.goto(BASE + '/checkin.html'); v.wait_for_selector('#screenLogin:not([hidden])')
    v.fill('#passcode', 'nope'); v.click('#loginBtn'); v.wait_for_selector('#loginError:not([hidden])')
    check('Wrong passcode' in v.inner_text('#loginError'), 'checkin: wrong volunteer passcode refused')
    v.fill('#passcode', 'demo'); v.click('#loginBtn')
    v.wait_for_selector('#screenResult:not([hidden])', timeout=20000)
    check(v.inner_text('#verdictTitle') == 'Valid ticket' and v.inner_text('#factId') == ids['family'], 'checkin: camera scan of the entry QR finds the booking')
    check((v.inner_text('#kidsNum'), v.inner_text('#adultsNum')) == ('2', '3') and v.inner_text('#adultsNote') == '2 parents included + 1 extra parent', 'checkin: shows 2 kids, 3 grown-ups incl. the extra parent (%s)' % v.inner_text('#adultsNote'))
    check(v.inner_text('#factKids') == 'Ira, Kabir' and v.inner_text('#factGifts') == '2 gifts' and 'Slot 2' in v.inner_text('#factSlot'), 'checkin: names, gifts and slot shown')
    v.screenshot(path=f'{OUT}/checkin-valid.png', full_page=True)
    v.click('#checkinBtn'); v.wait_for_function("document.getElementById('verdictTitle').textContent === 'Checked in'")
    check(v.locator('#checkinBtn').is_hidden() and v.locator('#undoBtn').is_visible(), 'checkin: checked in; undo offered')
    v.click('#nextBtn'); v.wait_for_selector('#screenScan:not([hidden])'); v.wait_for_timeout(1500)
    check(v.locator('#screenScan').is_visible(), 'checkin: the same QR is ignored for a moment after "Scan next"')
    v.wait_for_selector('#screenResult:not([hidden])', timeout=15000)
    check(v.inner_text('#verdictTitle') == 'Already checked in', 'checkin: scanning a used ticket again says "Already checked in"')
    v.screenshot(path=f'{OUT}/checkin-already.png', full_page=True)
    v.click('#undoBtn'); v.wait_for_function("document.getElementById('verdictTitle').textContent === 'Valid ticket'")
    check(True, 'checkin: undo makes the ticket valid again')

    # typed booking ID, a single parent, and an unpaid one (camera blocked on this page)
    v.close(); v = cctx.new_page(); v.on('pageerror', lambda e: verrors.append(str(e)))
    v.add_init_script("navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('NotAllowedError'))")
    v.goto(BASE + '/checkin.html'); v.wait_for_selector('#screenScan:not([hidden])')
    check(v.locator('#screenLogin').is_hidden(), 'checkin: the phone remembers the passcode')
    v.wait_for_selector('#cameraBtn:not([hidden])')
    check('Allow camera access' in v.inner_text('#cameraMsg'), 'checkin: blocked camera explains and offers typing the ID')
    v.screenshot(path=f'{OUT}/checkin-nocamera.png')
    v.fill('#manualId', ids['solo'].replace('LH-', '').lower()); v.click('#manualForm button')
    v.wait_for_function("document.getElementById('factId').textContent === %r" % ids['solo'], timeout=8000)
    check((v.inner_text('#kidsNum'), v.inner_text('#kidsWord'), v.inner_text('#adultsNum'), v.inner_text('#adultsWord')) == ('1', 'kid', '1', 'grown-up') and 'no extra parent' in v.inner_text('#adultsNote'), 'checkin: typed ID works; 1 kid + 1 grown-up, no extra parent')
    v.click('#nextBtn'); v.fill('#manualId', ids['pending']); v.click('#manualForm button')
    v.wait_for_function("document.getElementById('factId').textContent === %r" % ids['pending'], timeout=8000)
    check('not verified' in v.inner_text('#verdictTitle') and v.locator('#checkinBtn').is_hidden() and v.get_attribute('#verdict', 'data-tone') == 'stop', 'checkin: unverified booking is a red "Payment not verified yet" with no Check in button')
    v.screenshot(path=f'{OUT}/checkin-pending.png', full_page=True)
    v.click('#nextBtn'); v.fill('#manualId', 'LH-NOPE1'); v.click('#manualForm button')
    v.wait_for_selector('#manualError:not([hidden])')
    check('No booking found' in v.inner_text('#manualError'), 'checkin: unknown ID says no booking found')

    # opened from the phone's own camera app: the link goes straight to the pass
    v.close(); v = cctx.new_page(); v.on('pageerror', lambda e: verrors.append(str(e)))
    v.goto(BASE + '/checkin.html?b=' + ids['family']); v.wait_for_selector('#screenResult:not([hidden])', timeout=10000)
    check(v.inner_text('#factId') == ids['family'] and 'b=' not in v.url, 'checkin: the QR link opens the pass directly')
    v.screenshot(path=f'{OUT}/checkin-scan-link.png')
    v.click('#checkinBtn'); v.wait_for_function("document.getElementById('verdictTitle').textContent === 'Checked in'")

    # admin sees the door link, the passcode and who has arrived
    ad = cctx.new_page(); ad.goto(BASE + '/admin.html'); ad.fill('#passcode', 'demo'); ad.click('#login button'); ad.wait_for_selector('#dash:not([hidden])')
    door = ad.inner_text('#door')
    check('/checkin' in door and 'Volunteer passcode: demo' in door and 'Arrived so far: 2' in door, 'admin: shows the check-in link, volunteer passcode and arrivals (%s)' % door.replace('\n', ' '))
    check('Checked in' in ad.inner_text('#rows'), 'admin: booking shows "Checked in"')
    check(not verrors, 'checkin: no script errors ' + str(verrors[:2]))
    cam.close()

httpd.shutdown()
print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)
