/* Landing page: snow + lights, and the 3D tree that turns with the visitor's hand. */
(function () {
  LH_FESTIVE.fillTemplates(document, LH_FESTIVE.generate());

  var canvas = document.getElementById('tree3d');
  var fallback = document.getElementById('treeFallback');
  var hero = document.getElementById('hero');
  var ctrl = { _canvas: canvas, _mx: 0, _my: 0 };

  function showFallback() {
    if (canvas) canvas.hidden = true;
    if (fallback) fallback.hidden = false;
  }
  function boot(tries) {
    if (!canvas) return;
    if (window.THREE && window.LH_TREE) {
      try { LH_TREE.build3d.call(ctrl, window.THREE); } catch (err) { showFallback(); }
    } else if (tries < 40) {
      setTimeout(function () { boot(tries + 1); }, 150);
    } else {
      showFallback();
    }
  }
  boot(0);

  var clamp = function (v) { return Math.max(-1, Math.min(1, v)); };
  var lastPointer = 0;
  if (hero) {
    hero.addEventListener('pointermove', function (e) {
      var box = hero.getBoundingClientRect();
      ctrl._mx = clamp(((e.clientX - box.left) / box.width) * 2 - 1);
      ctrl._my = clamp(((e.clientY - box.top) / box.height) * 2 - 1);
      lastPointer = Date.now();
    });
    hero.addEventListener('pointerleave', function () { ctrl._mx = 0; ctrl._my = 0; });
  }
  window.addEventListener('deviceorientation', function (e) {
    if (e.gamma == null || e.beta == null || Date.now() - lastPointer < 1500) return;
    ctrl._mx = clamp(e.gamma / 25);
    ctrl._my = clamp((e.beta - 40) / 25);
  });
})();
