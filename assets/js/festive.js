/* Snow, fairy lights and their template filler — shared by every page. */
(function () {
  function generate() {
    const colors = ['#FCD419', '#FE8278', '#92C6ED', '#C4A6FF', '#FFF1C1'];
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const bulbs = [];
    for (let k = 0; k < 6; k++) {
      [1 / 6, 0.5, 5 / 6].forEach((t, j) => {
        const x = 240 * k + 240 * t;
        const y = 6 + 160 * t * (1 - t);
        bulbs.push({
          left: (x / 1440 * 100).toFixed(3) + '%',
          top: (y + 3).toFixed(1) + 'px',
          color: colors[(k * 3 + j) % colors.length],
          dur: (3.4 + rnd() * 2.6).toFixed(2) + 's',
          delay: (-rnd() * 5).toFixed(2) + 's'
        });
      });
    }
    const arcBulbs = [10, 171, 343, 514, 686, 857, 1029, 1190].map((x, i) => ({
      left: (x / 1200 * 100).toFixed(3) + '%',
      top: (73.75 + 0.000625 * (x - 600) * (x - 600) + 3).toFixed(1) + 'px',
      color: colors[(i + 1) % colors.length],
      dur: (3.6 + rnd() * 2.4).toFixed(2) + 's',
      delay: (-rnd() * 5).toFixed(2) + 's'
    }));
    const mk = (n, dMin, dMax) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const star = rnd() < 0.45;
        const size = star ? 10 + rnd() * 8 : 2 + rnd() * 4;
        const dur = dMin + rnd() * (dMax - dMin);
        out.push({
          cls: 'lh-flake' + (star ? ' lh-star' : '') + (star && rnd() < 0.5 ? ' lh-soft' : '') + (rnd() < 0.5 ? ' lh-sway-r' : ''),
          left: (rnd() * 100).toFixed(2) + '%',
          size: size.toFixed(1) + 'px',
          op: (star ? 0.4 + rnd() * 0.35 : 0.45 + rnd() * 0.5).toFixed(2),
          dur: dur.toFixed(1) + 's',
          delay: (-rnd() * dur).toFixed(1) + 's'
        });
      }
      for (let i = 0; i < Math.round(n / 4); i++) {
        const size = 16 + rnd() * 26;
        const dur = dMax * 1.6 + rnd() * dMax * 0.5;
        out.push({
          cls: 'lh-flake lh-bokeh' + (rnd() < 0.5 ? ' lh-sway-r' : ''),
          left: (rnd() * 100).toFixed(2) + '%',
          size: size.toFixed(1) + 'px',
          op: (0.1 + rnd() * 0.14).toFixed(2),
          dur: dur.toFixed(1) + 's',
          delay: (-rnd() * dur).toFixed(1) + 's'
        });
      }
      return out;
    };
    return {
      bulbs: bulbs,
      arcBulbs: arcBulbs,
      snowTall: mk(34, 75, 105),
      snowA: mk(22, 58, 82),
      snowB: mk(22, 58, 82),
      nearSnow: mk(6, 38, 54)
    };
  }
  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  /** Expands <template data-list="name" data-as="x"> using {{x.prop}} placeholders. */
  function fillTemplates(root, data) {
    root.querySelectorAll('template[data-list]').forEach(function (tpl) {
      var items = data[tpl.dataset.list] || [];
      var as = tpl.dataset.as;
      var src = tpl.innerHTML;
      var html = items.map(function (item) {
        return src.replace(new RegExp('\\{\\{' + as + '\\.(\\w+)\\}\\}', 'g'), function (_, k) { return esc(item[k] === undefined ? '' : item[k]); });
      }).join('');
      tpl.insertAdjacentHTML('beforebegin', html);
      tpl.remove();
    });
  }
  window.LH_FESTIVE = { generate: generate, fillTemplates: fillTemplates };
})();
