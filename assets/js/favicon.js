/* Animated tab icon. It opens on the four coloured lines; they hop, then each one turns into its part of the
   Lil' Hoppers logo: blue → paper plane, yellow → "hoppers", white → "lil'", coral → car.
   Plays once when the page opens and ends on the logo. Browsers that don't update the tab icon from a
   script (Safari) just show the finished logo, as does anyone who prefers reduced motion. */
(function () {
  var link = document.getElementById('favicon');
  if (!link) return;
  var FINAL = link.getAttribute('href');                  // the static logo icon
  var DIR = FINAL.replace(/[^\/]*$/, '');                 // assets/img/
  var canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  var ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;

  var BG = '#8562BE';
  // Bars left to right, and where each one ends up in the logo (64 × 64 units).
  var PARTS = [
    { name: 'blue', color: '#9DC4E9', cx: 11.02, cy: 20.3 },   // paper plane
    { name: 'yellow', color: '#FED605', cx: 30.63, cy: 33.92 },  // "hoppers"
    { name: 'white', color: '#FFFFFF', cx: 29.2, cy: 22.4 },    // "lil'"
    { name: 'coral', color: '#F6897D', cx: 50.45, cy: 44.87 }    // car
  ];
  var BAR_W = 7.4, BAR_H = 29.7, GAP = 10, MID = 32;
  var END = 2.2;                                           // seconds

  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function easeOutBack(x) { var c = 1.7, y = x - 1; return 1 + (c + 1) * y * y * y + c * y * y; }
  function easeInOut(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function pill(x, y, w, h) {
    var r = Math.min(w, h) * 0.48;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  // 0 – 0.3 s: the starting frame (four lines). Then a hop, like a wave across them.
  // From 1 s: each line flies to its place in the logo, shrinking away as that part pops in.
  function morph(t, i) { return clamp((t - 1.0 - 0.12 * i) / 0.5); }

  function draw(t) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, 64, 64);
    PARTS.forEach(function (p, i) {                        // lines first, so they pass behind the logo
      var bx = MID + (i - 1.5) * GAP;
      var hop = -6 * Math.sin(Math.PI * clamp((t - 0.3 - 0.08 * i) / 0.34));
      var m = morph(t, i), mm = easeInOut(m);
      var x = bx + (p.cx - bx) * mm, y = MID + hop + (p.cy - MID) * mm;
      var w = BAR_W * (1 - 0.75 * mm), h = BAR_H * (1 - 0.92 * mm);
      var a = 1 - clamp((m - 0.4) / 0.6);
      if (a <= 0) return;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      pill(x - w / 2, y - h / 2, w, h);
    });
    PARTS.forEach(function (p, i) {
      var q = clamp((morph(t, i) - 0.35) / 0.65);
      if (q > 0 && p.img) {
        var s = 0.4 + 0.6 * easeOutBack(q);
        ctx.globalAlpha = clamp(q * 2);
        ctx.save();
        ctx.translate(p.cx, p.cy);
        ctx.scale(s, s);
        ctx.drawImage(p.img, -p.cx, -p.cy, 64, 64);
        ctx.restore();
      }
    });
    ctx.globalAlpha = 1;
    return canvas.toDataURL('image/png');
  }

  // For previews and tests.
  window.LH_FAVICON = { frame: draw, duration: END };

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var loaded = 0;
  PARTS.forEach(function (p) {
    var img = new Image();
    img.onload = function () { p.img = img; if (++loaded === PARTS.length) play(); };
    img.src = DIR + 'favicon-part-' + p.name + '.png';
  });

  function play() {
    var start = Date.now();
    (function step() {
      var t = (Date.now() - start) / 1000;
      if (t >= END) { link.setAttribute('href', FINAL); return; }
      link.setAttribute('href', draw(t));
      setTimeout(step, 40);                                // about 25 frames a second
    })();
  }
})();
