// node tests/make_qr.js "<text>" out.gif : a QR image for the fake camera in tests/e2e.py
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'vendor', 'qrcode.js'), 'utf8');
const qrcode = new Function(src + ';return qrcode;')();
const q = qrcode(0, 'M'); q.addData(process.argv[2]); q.make();
require('fs').writeFileSync(process.argv[3], Buffer.from(q.createDataURL(10, 40).split(',')[1], 'base64'));
