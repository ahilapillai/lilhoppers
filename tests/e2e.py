"""Browser tests for the site in demo mode (no backend). Run: python3 tests/e2e.py
Needs: pip install playwright opencv-python-headless && a Chrome/Chromium."""
import http.server, socketserver, threading, os, sys, re, functools
import cv2, numpy as np
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get('E2E_SHOTS', '/tmp/lh-shots')
os.makedirs(OUT, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Quiet, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(('127.0.0.1', 0), handler)
PORT = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{PORT}'

failures = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: failures.append(msg)

def decode_qr(png_bytes):
    img = cv2.imdecode(np.frombuffer(png_bytes, np.uint8), cv2.IMREAD_COLOR)
    img = cv2.copyMakeBorder(img, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    data, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    return data

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])

    # ---------- landing ----------
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE + '/index.html')
    page.wait_for_timeout(2500)
    check(not errors, 'landing: no script errors ' + str(errors[:2]))
    check(page.locator('.lh-bulb').count() == 18 + 18 + 7, 'landing: fairy lights rendered (%d)' % page.locator('.lh-bulb').count())
    check(page.locator('.lh-flake').count() > 150, 'landing: snowflakes rendered')
    check(page.locator('template').count() == 0, 'landing: all templates expanded')
    body = page.inner_text('body')
    check('₹899' in body and '₹799' not in body, 'landing: shows ₹899, no old ₹799')
    check('Christmas Carnival' in body, 'landing: says Christmas Carnival')
    check('2:00 – 3:30 PM' in body and '6:00 – 7:30 PM' in body, 'landing: lists the slot times')
    check(page.locator('a[href="book.html"]').count() >= 3, 'landing: Book tickets buttons go to book.html')
    canvas_ok = page.evaluate("() => { const c = document.getElementById('tree3d'); return !c.hidden && c.width > 0; }")
    fallback = page.evaluate("() => !document.getElementById('treeFallback').hidden")
    check(canvas_ok or fallback, 'landing: 3D tree drawn (or image fallback shown)')
    page.screenshot(path=f'{OUT}/landing-hero.png')
    page.mouse.move(1200, 400); page.wait_for_timeout(1200)
    page.screenshot(path=f'{OUT}/landing-hero-turned.png')
    page.screenshot(path=f'{OUT}/landing-full.png', full_page=True)
    m = browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    m.goto(BASE + '/index.html'); m.wait_for_timeout(2000)
    m.screenshot(path=f'{OUT}/landing-mobile.png')
    check(m.evaluate('document.documentElement.scrollWidth') <= 391, 'landing mobile: no sideways scrolling')
    m.close(); page.close()

    # ---------- booking ----------
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE + '/book.html')
    page.wait_for_selector('.bk-slot')
    check(page.locator('#demoBanner').is_visible(), 'book: demo banner shown when no API_URL')
    total = lambda: page.inner_text('#chooseTotal')
    check(total() == '₹1,198', 'book: default 1 child + Santa gift = ₹1,198 (got %s)' % total())
    check(page.is_checked('#giftOn') and not page.is_checked('#extraParent'), 'book: gift checked, extra parent unchecked by default')
    check('optional' in page.inner_text('.bk-addon-gift').lower(), 'book: Santa gift labelled Optional')
    check(page.locator('.bk-addon .bk-price').count() == 2, 'book: price shown beside each add-on')
    page.uncheck('#giftOn')
    check(total() == '₹899', 'book: 1 child no add-ons = ₹899 (got %s)' % total())
    page.check('#giftOn'); page.check('#extraParent')
    check(total() == '₹1,397', 'book: 1 child + gift + extra parent = ₹1,397 (got %s)' % total())
    check(not page.locator('#giftQtyRow').is_visible(), 'book: gift quantity hidden for one child')
    page.click('#kidsPlus'); page.click('#kidsPlus')
    check(page.locator('#giftQtyRow').is_visible(), 'book: gift quantity appears for 3 children')
    check(page.locator('#giftQty option').count() == 3 and page.input_value('#giftQty') == '3', 'book: gift quantity goes up to 3, defaults to 3')
    check(total() == '₹3,793', 'book: 3 kids + 3 gifts + extra parent = ₹3,793 (got %s)' % total())
    page.select_option('#giftQty', '1')
    check(total() == '₹3,195', 'book: 3 kids + 1 gift + extra parent = ₹3,195 (got %s)' % total())
    page.screenshot(path=f'{OUT}/book-choose.png', full_page=True)
    page.click('#toPay')
    check('Pick a time first' in page.inner_text('#chooseError'), 'book: needs a slot before continuing')
    page.click('.bk-slot >> nth=1')
    page.click('#toPay')
    page.wait_for_selector('#step-pay:not([hidden])')
    check('₹3,195' in page.inner_text('#payTitle'), 'book: pay step shows the final total')
    href = page.get_attribute('#upiLink', 'href')
    check(href.startswith('upi://pay?pa=ahilapil.26-1@okicici&pn=Lil%20Hoppers&am=3195.00&cu=INR&tn=LH-'), 'book: UPI link uses the final total and UPI ID')
    qr = decode_qr(page.locator('#qr').screenshot())
    check(qr == href, 'book: QR code decodes to the same UPI payment link (%s)' % qr[:60])
    check(re.match(r'^\d{1,2}:\d\d$', page.inner_text('#countdown')) is not None, 'book: hold countdown running')
    page.screenshot(path=f'{OUT}/book-pay.png', full_page=True)
    page.reload(); page.wait_for_selector('#step-pay:not([hidden])')
    check('₹3,195' in page.inner_text('#payTitle'), 'book: payment step survives a reload')
    page.click('#paid')
    page.wait_for_selector('#step-details:not([hidden])')
    check(page.locator('#childFields input').count() == 3, 'book: one name field per child')
    page.click('#submitDetails')
    check("parent's name" in page.inner_text('#detailsError'), 'book: validates the form')
    page.fill('#parentName', 'Meera Iyer'); page.fill('#email', 'meera@example.com'); page.fill('#phone', '98450 12345')
    for i in range(3): page.fill(f'#child{i}', ['Aarav', 'Diya', 'Kabir'][i])
    page.click('#submitDetails')
    check('transaction ID or upload' in page.inner_text('#detailsError'), 'book: proof (UTR or screenshot) required')
    page.set_input_files('#shot', files=[{'name': 'pay.png', 'mimeType': 'image/png', 'buffer': cv2.imencode('.png', np.full((40, 40, 3), 200, np.uint8))[1].tobytes()}])
    page.wait_for_selector('#shotPreview:not([hidden])')
    page.fill('#utr', '412345678901')
    page.screenshot(path=f'{OUT}/book-details.png', full_page=True)
    page.click('#submitDetails')
    page.wait_for_selector('#step-done:not([hidden])')
    done = page.inner_text('#step-done')
    check('Payment being checked' in done and 'LH-DEMO' in done and 'Aarav, Diya, Kabir' in done and '₹3,195' in done, 'book: ticket shows ID, pending status, names and total')
    check('3 kids + 4 parents' in done, 'book: ticket admits 3 kids + 4 parents')
    page.screenshot(path=f'{OUT}/book-done.png', full_page=True)
    check(not errors, 'book: no script errors ' + str(errors[:2]))

    mob = ctx.new_page(); mob.set_viewport_size({'width': 390, 'height': 844})
    mob.goto(BASE + '/book.html'); mob.click('text=Book another') if mob.locator('#step-done:not([hidden])').count() else None
    mob.wait_for_selector('.bk-slot'); mob.screenshot(path=f'{OUT}/book-mobile.png', full_page=True)
    check(mob.evaluate('document.documentElement.scrollWidth') <= 391, 'book mobile: no sideways scrolling')
    mob.close()

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
    for frag in ['₹2,697', '₹199', '₹299', '₹3,195', 'Santa gift × 1', 'Meera Iyer', '412345678901', 'Pending Verification']:
        check(frag in row, 'admin: row shows ' + frag)
    adm.screenshot(path=f'{OUT}/admin.png', full_page=True)
    adm.click('#rows button[data-act=verify]')
    check(adm.input_value('#verifyAmount') == '3195', 'admin: verify defaults to the expected amount')
    adm.fill('#verifyAmount', '3000')
    check(adm.locator('#verifyWarn').is_visible(), 'admin: warns when amount differs')
    adm.fill('#verifyAmount', '3195'); adm.fill('#verifyNote', 'Matched in GPay')
    adm.click('#verifyGo')
    adm.wait_for_function("() => document.querySelector('#rows').innerText.includes('Verified')")
    row = adm.locator('#rows tr >> nth=0').inner_text()
    check('Verified' in row and row.count('₹3,195') >= 2, 'admin: booking verified with the verified amount')
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

httpd.shutdown()
print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)
