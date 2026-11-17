/* 3D Christmas tree (three.js). Turns only with the visitor's hand: set ctrl._mx / ctrl._my in -1..1. */
(function () {
  function build3d(T) {
    const canvas = this._canvas;
    if (T.ColorManagement) T.ColorManagement.legacyMode = false;
    const renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    this._renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    const C = (hex) => new T.Color(hex);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(28, 1142 / 1378, 0.1, 100);
    camera.position.set(0, 3.1, 15.2);
    camera.lookAt(0, 2.45, 0);

    scene.add(new T.HemisphereLight(0xfff3e0, 0x4a2e80, 0.85));
    scene.add(new T.AmbientLight(0xffffff, 0.12));
    const key = new T.DirectionalLight(0xffe7c2, 1.25);
    key.position.set(-5, 9, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4.5;
    key.shadow.camera.right = 4.5;
    key.shadow.camera.top = 6.5;
    key.shadow.camera.bottom = -2;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const rim = new T.DirectionalLight(0xc9a8ff, 0.85);
    rim.position.set(5, 4, -6);
    scene.add(rim);
    const starLight = new T.PointLight(0xffd27a, 0.9, 7);
    starLight.position.set(0, 5.3, 0.8);
    scene.add(starLight);

    let seed = 31;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const texFrom = (w, h, fn, srgb) => {
      const d = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const c = fn(x / w, y / h);
          const k = (y * w + x) * 4;
          d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = c[3];
        }
      }
      const tx = new T.DataTexture(d, w, h, T.RGBAFormat);
      tx.magFilter = T.LinearFilter;
      tx.minFilter = T.LinearFilter;
      tx.wrapS = T.RepeatWrapping;
      tx.wrapT = T.RepeatWrapping;
      if (srgb) tx.encoding = T.sRGBEncoding;
      tx.needsUpdate = true;
      return tx;
    };
    const radial = (rgb, power, maxA) => texFrom(64, 64, (u, v) => {
      const dx = u * 2 - 1;
      const dy = v * 2 - 1;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      return [rgb, rgb, rgb, Math.round(Math.pow(1 - r, power) * maxA * 255)];
    }, false);
    const glowTex = radial(255, 2.2, 1);

    const mats = {
      leafA: new T.MeshPhysicalMaterial({ color: C('#3F8B39'), roughness: 0.82, sheen: 1, sheenRoughness: 0.45, sheenColor: C('#B5EBA0') }),
      leafB: new T.MeshPhysicalMaterial({ color: C('#357E31'), roughness: 0.82, sheen: 1, sheenRoughness: 0.45, sheenColor: C('#B5EBA0') }),
      snow: new T.MeshPhysicalMaterial({ color: C('#FBF8FF'), roughness: 0.92, sheen: 0.5, sheenColor: C('#FFFFFF') }),
      trunk: new T.MeshStandardMaterial({ color: C('#7B4B2A'), roughness: 0.95 }),
      red: new T.MeshPhysicalMaterial({ color: C('#D3262C'), roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12 }),
      gold: new T.MeshPhysicalMaterial({ color: C('#E9B949'), roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
      ribbon: new T.MeshStandardMaterial({ color: C('#D8312E'), roughness: 0.5 }),
      ribbonCream: new T.MeshStandardMaterial({ color: C('#F1E2C4'), roughness: 0.55 }),
      ribbonGold: new T.MeshStandardMaterial({ color: C('#E2B33C'), roughness: 0.45 }),
      cream: new T.MeshStandardMaterial({ color: C('#F3E6CC'), roughness: 0.7 }),
      green: new T.MeshStandardMaterial({ color: C('#3E8A3A'), roughness: 0.7 }),
      ginger: new T.MeshStandardMaterial({ color: C('#C67B3C'), roughness: 0.75 }),
      house: new T.MeshStandardMaterial({ color: C('#B8662E'), roughness: 0.75 }),
      white: new T.MeshStandardMaterial({ color: C('#FFFFFF'), roughness: 0.6 }),
      black: new T.MeshStandardMaterial({ color: C('#1E1A22'), roughness: 0.5 }),
      orange: new T.MeshStandardMaterial({ color: C('#F08A2E'), roughness: 0.6 }),
      wire: new T.MeshStandardMaterial({ color: C('#5A3B22'), roughness: 0.8 }),
      bulb: new T.MeshBasicMaterial({ color: C('#FFF1B8') }),
      windowGlow: new T.MeshBasicMaterial({ color: C('#FFD45C') })
    };
    const dots = texFrom(64, 64, (u, v) => {
      const dx = (u % 0.5) - 0.25;
      const dy = (v % 0.5) - 0.25;
      return Math.sqrt(dx * dx + dy * dy) < 0.08 ? [250, 240, 228, 255] : [196, 36, 40, 255];
    }, true);
    dots.repeat.set(3, 3);
    mats.dotted = new T.MeshStandardMaterial({ map: dots, roughness: 0.6 });
    const stripes = texFrom(128, 32, (u, v) => (((u * 7 + v) % 1) < 0.5 ? [214, 38, 44, 255] : [252, 248, 244, 255]), true);
    mats.cane = new T.MeshStandardMaterial({ map: stripes, roughness: 0.35 });

    const shade = (o) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
    const world = new T.Group();
    scene.add(world);
    const spin = new T.Group();
    world.add(spin);

    const catcher = new T.Mesh(new T.PlaneGeometry(14, 14), new T.ShadowMaterial({ opacity: 0.32 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = -0.02;
    catcher.receiveShadow = true;
    world.add(catcher);
    const contact = new T.Mesh(new T.PlaneGeometry(7.4, 7.4), new T.MeshBasicMaterial({ map: radial(0, 1.6, 0.5), transparent: true, depthWrite: false }));
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = -0.01;
    world.add(contact);

    const base = new T.Mesh(new T.SphereGeometry(1, 48, 24), mats.snow);
    base.scale.set(2.75, 0.24, 2.75);
    spin.add(base);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rnd() * 0.3;
      const lump = new T.Mesh(new T.SphereGeometry(1, 24, 14), mats.snow);
      const s = 0.32 + rnd() * 0.18;
      lump.scale.set(s, s * 0.45, s);
      lump.position.set(Math.cos(a) * 2.45, 0.06, Math.sin(a) * 2.45);
      spin.add(lump);
    }

    const trunk = new T.Mesh(new T.CylinderGeometry(0.36, 0.46, 1.2, 28), mats.trunk);
    trunk.position.y = 0.7;
    spin.add(trunk);

    const tiers = [
      { rim: 1.05, h: 1.45, R: 2.15, lobes: 11, droop: 0.16 },
      { rim: 1.8, h: 1.3, R: 1.8, lobes: 10, droop: 0.14 },
      { rim: 2.52, h: 1.15, R: 1.45, lobes: 9, droop: 0.12 },
      { rim: 3.2, h: 1.0, R: 1.1, lobes: 8, droop: 0.11 },
      { rim: 3.82, h: 0.85, R: 0.74, lobes: 7, droop: 0.09 },
      { rim: 4.32, h: 0.55, R: 0.38, lobes: 6, droop: 0.06 }
    ];
    const makeTier = (t) => {
      const k = 0.45 + t.R * 0.28;
      const prof = [];
      for (let i = 0; i <= 16; i++) {
        const s = i / 16;
        prof.push(new T.Vector2(t.R * (0.03 + 0.97 * Math.pow(s, 0.9)), t.h * (1 - s) + t.h * 0.05 * Math.sin(s * Math.PI)));
      }
      [[0.06, -0.07], [0.04, -0.16], [-0.06, -0.23], [-0.22, -0.25]].forEach((p) => prof.push(new T.Vector2(t.R + p[0] * k, p[1] * k)));
      prof.push(new T.Vector2(t.R * 0.55, -0.13 * k));
      prof.push(new T.Vector2(t.R * 0.2, -0.02 * k));
      const g = new T.LatheGeometry(prof, 160, Math.PI, Math.PI * 2);
      const pos = g.attributes.position;
      const v = new T.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const th = Math.atan2(v.z, v.x);
        const rad = Math.sqrt(v.x * v.x + v.z * v.z);
        let w = (t.h * 0.6 - v.y) / (t.h * 0.6 + 0.25 * k);
        w = Math.pow(Math.max(0, Math.min(1, w)), 1.5);
        const L = Math.pow((Math.cos(t.lobes * th) + 1) / 2, 0.6);
        const nr = rad * (1 + 0.1 * L * w);
        v.y += -t.droop * L * w + t.droop * 0.35 * (1 - L) * w;
        pos.setXYZ(i, Math.cos(th) * nr, v.y, Math.sin(th) * nr);
      }
      g.computeVertexNormals();
      return g;
    };
    const surf = (t, f, th, out) => {
      const r = t.R * (0.03 + 0.97 * Math.pow(1 - f, 0.9)) + (out || 0);
      return new T.Vector3(Math.cos(th) * r, t.rim + t.h * f, Math.sin(th) * r);
    };
    const face = (o, th, tilt) => { o.rotation.set(tilt || -0.32, Math.PI / 2 - th, 0, 'YXZ'); };
    tiers.forEach((t, i) => {
      const m = new T.Mesh(makeTier(t), i % 2 ? mats.leafB : mats.leafA);
      m.position.y = t.rim;
      spin.add(m);
    });

    const snowCap = (ti, lobe) => {
      const t = tiers[ti];
      const th = (lobe / t.lobes) * Math.PI * 2;
      const k = 0.45 + t.R * 0.28;
      const c = new T.Mesh(new T.SphereGeometry(1, 24, 16), mats.snow);
      c.scale.set(0.34 * k, 0.13 * k, 0.24 * k);
      c.position.set(Math.cos(th) * t.R * 0.9, t.rim + 0.06 * k, Math.sin(th) * t.R * 0.9);
      c.rotation.y = -(th + Math.PI / 2);
      spin.add(c);
    };
    [[0, 5], [0, 6], [0, 1], [1, 9], [1, 4], [2, 3], [2, 6], [3, 5], [4, 2]].forEach((p) => snowCap(p[0], p[1]));
    const topSnow = new T.Mesh(new T.SphereGeometry(1, 24, 16), mats.snow);
    topSnow.scale.set(0.3, 0.14, 0.3);
    topSnow.position.y = 4.86;
    spin.add(topSnow);

    const starShape = new T.Shape();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? 0.5 : 0.24;
      const x = Math.cos(a) * rr;
      const y = -Math.sin(a) * rr;
      if (i === 0) starShape.moveTo(x, y); else starShape.lineTo(x, y);
    }
    starShape.closePath();
    const starGeo = new T.ExtrudeGeometry(starShape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.09, bevelSegments: 6, curveSegments: 6 });
    starGeo.center();
    const star = new T.Mesh(starGeo, new T.MeshStandardMaterial({ color: C('#FFD54A'), emissive: C('#FFB300'), emissiveIntensity: 0.65, roughness: 0.35 }));
    star.position.y = 5.3;
    spin.add(star);
    const starGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: C('#FFD86B'), transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }));
    starGlow.position.y = 5.3;
    starGlow.scale.setScalar(2.4);
    spin.add(starGlow);

    const lights = [];
    const strings = [[0, 0.34, 7], [1, 0.32, 6], [2, 0.32, 6], [3, 0.34, 5]];
    strings.forEach((sdef) => {
      const t = tiers[sdef[0]];
      const pts = [];
      const N = 220;
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2;
        const sag = Math.abs(Math.sin((sdef[2] * th) / 2));
        const f = sdef[1] - (0.12 * sag) / t.h;
        pts.push(surf(t, f, th, 0.05));
      }
      const curve = new T.CatmullRomCurve3(pts, true);
      spin.add(new T.Mesh(new T.TubeGeometry(curve, 300, 0.016, 6, true), mats.wire));
      const count = Math.round(t.R * 10);
      for (let i = 0; i < count; i++) {
        const p = curve.getPointAt((i + 0.5) / count);
        const b = new T.Mesh(new T.SphereGeometry(0.055, 12, 8), mats.bulb);
        b.position.copy(p);
        spin.add(b);
        const spr = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: C('#FFD978'), transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
        spr.position.copy(p);
        spr.scale.setScalar(0.5);
        spin.add(spr);
        lights.push({ spr: spr, phase: rnd() * Math.PI * 2, speed: 0.5 + rnd() * 0.8 });
      }
    });

    const bauble = (ti, lobe, mat, size) => {
      const t = tiers[ti];
      const th = ((lobe + 0.5) / t.lobes) * Math.PI * 2;
      const g = new T.Group();
      const ball = new T.Mesh(new T.SphereGeometry(size, 28, 18), mat);
      g.add(ball);
      const cap = new T.Mesh(new T.CylinderGeometry(size * 0.28, size * 0.28, size * 0.22, 14), mats.gold);
      cap.position.y = size * 0.98;
      g.add(cap);
      g.position.set(Math.cos(th) * t.R * 0.97, t.rim - 0.1, Math.sin(th) * t.R * 0.97);
      spin.add(g);
    };
    [[0, 2, 'red', 0.2], [0, 8, 'gold', 0.18], [1, 1, 'red', 0.19], [1, 6, 'red', 0.19], [2, 0, 'gold', 0.16], [2, 5, 'red', 0.17], [3, 2, 'red', 0.15], [3, 6, 'gold', 0.14], [4, 4, 'red', 0.13], [0, 4, 'red', 0.2]].forEach((b) => bauble(b[0], b[1], mats[b[2]], b[3]));

    const caneGeo = (() => {
      const pts = [new T.Vector3(0, -0.42, 0), new T.Vector3(0, -0.1, 0), new T.Vector3(0, 0.18, 0)];
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI - (i / 8) * Math.PI * 0.95;
        pts.push(new T.Vector3(0.13 + Math.cos(a) * 0.13, 0.2 + Math.sin(a) * 0.13, 0));
      }
      pts.push(new T.Vector3(0.27, 0.12, 0));
      return new T.TubeGeometry(new T.CatmullRomCurve3(pts), 64, 0.045, 12, false);
    })();
    const cane = (ti, f, th) => {
      const g = new T.Group();
      g.add(new T.Mesh(caneGeo, mats.cane));
      g.position.copy(surf(tiers[ti], f, th, 0.08));
      face(g, th);
      spin.add(g);
    };
    cane(1, 0.45, Math.PI * 0.62);
    cane(3, 0.42, Math.PI * 0.28);
    cane(2, 0.4, Math.PI * 1.35);
    cane(0, 0.5, Math.PI * 1.9);

    const bow = (ti, f, th, mat, scale) => {
      const g = new T.Group();
      const loopGeo = new T.TorusGeometry(0.11, 0.035, 10, 28);
      [-1, 1].forEach((sd) => {
        const lp = new T.Mesh(loopGeo, mat);
        lp.scale.set(1, 0.62, 0.55);
        lp.position.set(sd * 0.11, 0.02, 0);
        lp.rotation.z = sd * 0.35;
        g.add(lp);
        const tail = new T.Mesh(new T.BoxGeometry(0.06, 0.22, 0.025), mat);
        tail.position.set(sd * 0.05, -0.12, 0);
        tail.rotation.z = sd * 0.35;
        g.add(tail);
      });
      g.add(new T.Mesh(new T.SphereGeometry(0.05, 14, 10), mat));
      g.scale.setScalar(scale || 1);
      g.position.copy(surf(tiers[ti], f, th, 0.06));
      face(g, th);
      spin.add(g);
      return g;
    };
    bow(1, 0.35, Math.PI * 0.5, mats.ribbon, 1.5);
    bow(2, 0.5, Math.PI * 0.95, mats.ribbon, 1.2);
    bow(0, 0.45, Math.PI * 1.25, mats.ribbon, 1.4);

    const gingerbread = (() => {
      const g = new T.Group();
      const add = (geo, x, y, rz, sx, sy) => { const m = new T.Mesh(geo, mats.ginger); m.position.set(x, y, 0); m.rotation.z = rz || 0; m.scale.set(sx || 1, sy || 1, 1); g.add(m); };
      add(new T.SphereGeometry(0.1, 20, 14), 0, 0.17);
      add(new T.CapsuleGeometry(0.085, 0.12, 6, 14), 0, 0);
      add(new T.CapsuleGeometry(0.04, 0.12, 6, 10), -0.12, 0.04, 1.2);
      add(new T.CapsuleGeometry(0.04, 0.12, 6, 10), 0.12, 0.04, -1.2);
      add(new T.CapsuleGeometry(0.045, 0.12, 6, 10), -0.05, -0.15, 0.3);
      add(new T.CapsuleGeometry(0.045, 0.12, 6, 10), 0.05, -0.15, -0.3);
      [[-0.035, 0.19], [0.035, 0.19], [0, 0.03], [0, -0.03]].forEach((p) => { const d = new T.Mesh(new T.SphereGeometry(0.014, 8, 6), mats.white); d.position.set(p[0], p[1], 0.075); g.add(d); });
      const tie = new T.Mesh(new T.SphereGeometry(0.025, 8, 6), mats.ribbon);
      tie.position.set(0, 0.09, 0.08);
      g.add(tie);
      g.scale.set(1.5, 1.5, 0.75);
      return g;
    })();
    gingerbread.position.copy(surf(tiers[0], 0.32, Math.PI * 0.72, 0.1));
    face(gingerbread, Math.PI * 0.72);
    spin.add(gingerbread);

    const house = (() => {
      const g = new T.Group();
      const body = new T.Mesh(new T.BoxGeometry(0.24, 0.18, 0.16), mats.house);
      g.add(body);
      const roofShape = new T.Shape();
      roofShape.moveTo(-0.17, 0);
      roofShape.lineTo(0, 0.14);
      roofShape.lineTo(0.17, 0);
      roofShape.closePath();
      const roof = new T.Mesh(new T.ExtrudeGeometry(roofShape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3 }), mats.snow);
      roof.position.set(0, 0.085, -0.1);
      g.add(roof);
      const win = new T.Mesh(new T.PlaneGeometry(0.08, 0.08), mats.windowGlow);
      win.position.set(0, -0.01, 0.081);
      g.add(win);
      const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: C('#FFC94D'), transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false }));
      glow.position.set(0, -0.01, 0.1);
      glow.scale.setScalar(0.32);
      g.add(glow);
      g.scale.setScalar(1.35);
      return g;
    })();
    house.position.copy(surf(tiers[2], 0.42, Math.PI * 0.42, 0.12));
    face(house, Math.PI * 0.42, -0.2);
    spin.add(house);

    const snowman = (() => {
      const g = new T.Group();
      const body = new T.Mesh(new T.SphereGeometry(0.13, 22, 16), mats.white);
      g.add(body);
      const head = new T.Mesh(new T.SphereGeometry(0.09, 20, 14), mats.white);
      head.position.y = 0.19;
      g.add(head);
      [[-0.03, 0.21], [0.03, 0.21]].forEach((p) => { const e = new T.Mesh(new T.SphereGeometry(0.012, 8, 6), mats.black); e.position.set(p[0], p[1], 0.083); g.add(e); });
      const nose = new T.Mesh(new T.ConeGeometry(0.018, 0.07, 10), mats.orange);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 0.185, 0.11);
      g.add(nose);
      const scarf = new T.Mesh(new T.TorusGeometry(0.075, 0.025, 10, 24), mats.ribbon);
      scarf.rotation.x = Math.PI / 2;
      scarf.position.y = 0.115;
      g.add(scarf);
      const brim = new T.Mesh(new T.CylinderGeometry(0.085, 0.085, 0.015, 20), mats.black);
      brim.position.y = 0.265;
      g.add(brim);
      const hat = new T.Mesh(new T.CylinderGeometry(0.055, 0.06, 0.08, 20), mats.black);
      hat.position.y = 0.31;
      g.add(hat);
      g.scale.setScalar(1.3);
      return g;
    })();
    snowman.position.copy(surf(tiers[1], 0.4, Math.PI * 0.18, 0.14));
    face(snowman, Math.PI * 0.18, -0.15);
    spin.add(snowman);

    const gift = (w, h, d, x, z, ry, boxMat, ribMat) => {
      const g = new T.Group();
      const box = new T.Mesh(new T.BoxGeometry(w, h, d), boxMat);
      g.add(box);
      const r1 = new T.Mesh(new T.BoxGeometry(w + 0.02, h + 0.02, Math.min(0.14, d * 0.18)), ribMat);
      g.add(r1);
      const r2 = new T.Mesh(new T.BoxGeometry(Math.min(0.14, w * 0.18), h + 0.02, d + 0.02), ribMat);
      g.add(r2);
      const loopGeo = new T.TorusGeometry(0.13 * Math.min(1, w + 0.2), 0.04, 10, 26);
      [-1, 1].forEach((sd) => {
        const lp = new T.Mesh(loopGeo, ribMat);
        lp.scale.set(1, 0.7, 0.6);
        lp.position.set(sd * 0.12 * Math.min(1, w + 0.2), h / 2 + 0.07, 0);
        lp.rotation.z = sd * 0.5;
        g.add(lp);
      });
      const knot = new T.Mesh(new T.SphereGeometry(0.055, 14, 10), ribMat);
      knot.position.y = h / 2 + 0.03;
      g.add(knot);
      g.position.set(x, 0.17 + h / 2, z);
      g.rotation.y = ry;
      spin.add(g);
      return g;
    };
    gift(1.05, 0.72, 0.85, -1.0, 0.95, 0.25, mats.dotted, mats.ribbonCream);
    gift(1.0, 0.7, 0.9, 1.15, 0.7, -0.3, mats.cream, mats.ribbon);
    gift(0.62, 0.55, 0.6, 0.2, 1.45, 0.12, mats.green, mats.ribbonGold);
    gift(0.55, 0.4, 0.5, -0.3, 1.9, -0.2, mats.cream, mats.ribbon);
    gift(0.85, 0.6, 0.75, -0.7, -1.25, 0.4, mats.red, mats.ribbonCream);
    gift(0.8, 0.55, 0.8, 1.0, -1.0, -0.5, mats.cream, mats.ribbon);
    gift(0.6, 0.5, 0.55, -1.7, -0.1, 0.9, mats.green, mats.ribbonGold);
    shade(spin);
    base.castShadow = false;

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(resize);
      this._ro.observe(canvas);
    }
    if (window.IntersectionObserver) {
      this._io = new IntersectionObserver((entries) => { this._hidden = !entries[0].isIntersecting; });
      this._io.observe(canvas);
    }

    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rotY = 0;
    let rotX = 0;
    const clock = new T.Clock();
    const loop = () => {
      if (this._dead) return;
      this._loop = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (this._hidden) return;
      const t = clock.elapsedTime;
      const ease = Math.min(1, dt * 4);
      rotY += ((this._mx || 0) * 2.4 - rotY) * ease;
      rotX += ((this._my || 0) * 0.12 - rotX) * ease;
      spin.rotation.y = rotY;
      world.rotation.x = rotX;
      lights.forEach((l) => {
        const k = still ? 1 : 0.6 + 0.4 * Math.sin(t * l.speed * 2 + l.phase);
        l.spr.material.opacity = k;
        l.spr.scale.setScalar(0.38 + k * 0.2);
      });
      starGlow.material.opacity = still ? 0.55 : 0.48 + 0.12 * Math.sin(t * 1.2);
      renderer.render(scene, camera);
    };
    loop();
  }

  window.LH_TREE = { build3d: build3d };
})();
