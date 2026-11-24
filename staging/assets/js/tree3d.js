/* 3D Christmas tree (three.js), modelled on the Lil' Hoppers tree art: soft clay-like tiers, gold star,
   gold and red bead garlands, baubles, presents on a round rug. Turns only with the visitor's hand:
   set ctrl._mx / ctrl._my in -1..1. */
(function () {
  function build3d(T) {
    const canvas = this._canvas;
    if (T.ColorManagement) T.ColorManagement.legacyMode = false;
    const renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    this._renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.VSMShadowMap; // blurred, soft-edged shadows

    const C = (hex) => new T.Color(hex);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(27, 1142 / 1378, 0.1, 100);
    camera.position.set(0, 3.15, 16.9);
    camera.lookAt(0, 2.95, 0);

    /* Soft studio environment so gold and baubles get real highlights. */
    const pmrem = new T.PMREMGenerator(renderer);
    const envScene = new T.Scene();
    const sky = new T.SphereGeometry(10, 32, 16);
    const skyCol = [];
    const sp = sky.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const y = sp.getY(i) / 10;
      const c = y > 0 ? new T.Color(0.62, 0.6, 0.66).lerp(new T.Color(1.0, 0.96, 0.9), y) : new T.Color(0.62, 0.6, 0.66).lerp(new T.Color(0.18, 0.14, 0.26), -y);
      skyCol.push(c.r, c.g, c.b);
    }
    sky.setAttribute('color', new T.Float32BufferAttribute(skyCol, 3));
    envScene.add(new T.Mesh(sky, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
    const softbox = (x, y, z, w, h, k) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(k, k, k * 0.95), side: T.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      envScene.add(m);
    };
    softbox(-5, 6, 6, 5, 3, 3.2);
    softbox(6, 3, 4, 3, 4, 1.6);
    softbox(0, 2, -8, 6, 3, 1.2);
    scene.environment = pmrem.fromScene(envScene, 0.035).texture;
    pmrem.dispose();

    scene.add(new T.HemisphereLight(0xfff6e8, 0x3b2a5c, 0.42));
    // The key light is split: part of it casts soft shadows, part only lights, so shadows stay gentle.
    const keyFill = new T.DirectionalLight(0xfff1dc, 0.42);
    keyFill.position.set(-4.5, 9, 8);
    scene.add(keyFill);
    const key = new T.DirectionalLight(0xfff1dc, 0.62);
    key.position.set(-4.5, 9, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 9;
    key.shadow.blurSamples = 16;
    key.shadow.camera.left = -4.2;
    key.shadow.camera.right = 4.2;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -2.5;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const rim = new T.DirectionalLight(0xd9c2ff, 0.55);
    rim.position.set(5, 5, -6);
    scene.add(rim);

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

    const std = (hex, rough, metal, extra) => new T.MeshStandardMaterial(Object.assign({ color: C(hex), roughness: rough, metalness: metal || 0 }, extra || {}));
    const phys = (hex, rough, metal, extra) => new T.MeshPhysicalMaterial(Object.assign({ color: C(hex), roughness: rough, metalness: metal || 0 }, extra || {}));
    const stripes = texFrom(64, 64, (u, v) => (((u + v) * 3) % 1 < 0.42 ? [214, 164, 62, 255] : [62, 140, 58, 255]), true);
    stripes.repeat.set(1.4, 1.4);
    const mats = {
      leaf: std('#55A346', 0.78, 0, { envMapIntensity: 0.5 }),
      // Tiers and leaf drops carry soft baked shading (vertex colours) instead of hard drop-on-drop shadows.
      skirt: std('#5AAA4B', 0.8, 0, { envMapIntensity: 0.5, vertexColors: true }),
      leafIn: std('#58A84A', 0.8, 0, { envMapIntensity: 0.45, vertexColors: true }),
      trunk: std('#6E3F25', 0.9),
      star: std('#F7C64A', 0.24, 0.75, { emissive: C('#8A5A00'), emissiveIntensity: 0.35 }),
      gold: std('#E2B04A', 0.28, 0.85),
      beadGold: std('#E0B653', 0.32, 0.7),
      beadRed: std('#B2402F', 0.32, 0.35),
      red: phys('#CE2A2E', 0.2, 0.05, { clearcoat: 1, clearcoatRoughness: 0.12 }),
      blue: phys('#2A69B3', 0.2, 0.05, { clearcoat: 1, clearcoatRoughness: 0.12 }),
      green: phys('#2E8F3C', 0.2, 0.05, { clearcoat: 1, clearcoatRoughness: 0.12 }),
      goldBall: std('#DDAA3E', 0.22, 0.9),
      rugRed: std('#C8302C', 0.85, 0, { envMapIntensity: 0.6 }),
      rugCream: std('#EFE8DD', 0.9, 0, { envMapIntensity: 0.7 }),
      giftGreen: std('#3F8F3D', 0.6, 0, { envMapIntensity: 0.7 }),
      giftRed: std('#CF2F2F', 0.55, 0, { envMapIntensity: 0.7 }),
      giftStripe: std('#FFFFFF', 0.55, 0, { map: stripes, envMapIntensity: 0.7 }),
      ribbon: std('#D9A845', 0.32, 0.6)
    };

    const shade = (o) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
    const world = new T.Group();
    scene.add(world);
    const spin = new T.Group();
    world.add(spin);

    const contact = new T.Mesh(new T.PlaneGeometry(7.6, 7.6), new T.MeshBasicMaterial({ map: radial(0, 1.6, 0.55), transparent: true, depthWrite: false }));
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = -0.01;
    world.add(contact);

    /* ---------- rug: cream rim with a wavy red centre ---------- */
    const rugR = 2.55;
    const rugProf = [new T.Vector2(0, 0), new T.Vector2(rugR - 0.1, 0), new T.Vector2(rugR - 0.02, 0.015), new T.Vector2(rugR, 0.05), new T.Vector2(rugR - 0.03, 0.085), new T.Vector2(rugR - 0.12, 0.1), new T.Vector2(0, 0.1)];
    const rug = new T.Mesh(new T.LatheGeometry(rugProf, 96), mats.rugCream);
    spin.add(rug);
    const redShape = new T.Shape();
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      const r = 2.24 + 0.035 * Math.sin(a * 11) + 0.02 * Math.sin(a * 5 + 1);
      if (i === 0) redShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else redShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const redRug = new T.Mesh(new T.ExtrudeGeometry(redShape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.015, bevelSegments: 2, curveSegments: 4 }), mats.rugRed);
    redRug.rotation.x = -Math.PI / 2;
    redRug.position.y = 0.095;
    spin.add(redRug);
    const floorY = 0.14;

    const trunk = new T.Mesh(new T.CylinderGeometry(0.26, 0.32, 1.2, 24), mats.trunk);
    trunk.position.y = floorY + 0.55;
    spin.add(trunk);

    /* ---------- tiers: rounded, droopy, scalloped skirts ---------- */
    // Each tier = a thin outer skirt with pointed, slightly upturned tips + a row of fat rounded drops in front.
    // edge = bottom of the drops; the skirt's pointed tips stick out above them.
    const tiers = [
      { edge: 0.74, R: 2.0, n: 9 },
      { edge: 1.38, R: 1.73, n: 8 },
      { edge: 2.01, R: 1.46, n: 8 },
      { edge: 2.63, R: 1.2, n: 7 },
      { edge: 3.24, R: 0.95, n: 6 },
      { edge: 3.83, R: 0.72, n: 5 }
    ];
    tiers.forEach((t, i) => {
      t.phase = i * 0.55;
      t.sc = 0.62 + 0.38 * (t.R / 2.0);
      t.ry = 0.35 * t.sc;
      t.rim = t.edge + t.ry * 1.25;
      t.H = (tiers[i + 1] ? tiers[i + 1].edge - t.edge : 0.5) + 0.7;
    });
    const tierMeshes = tiers.map(() => []);
    const makeSkirt = (t) => {
      const k = t.sc;
      const prof = [];
      for (let i = 0; i <= 20; i++) {
        const s = i / 20;
        prof.push(new T.Vector2(t.R * (0.04 + 0.96 * Math.pow(s, 0.85)), t.H * (1 - s) + t.H * 0.06 * Math.sin(s * Math.PI)));
      }
      [[0.03, -0.04], [0.0, -0.09], [-0.08, -0.12], [-0.2, -0.1]].forEach((p) => prof.push(new T.Vector2(t.R + p[0] * k, p[1] * k)));
      prof.push(new T.Vector2(t.R * 0.5, -0.06 * k));
      prof.push(new T.Vector2(0.03, -0.02));
      const g = new T.LatheGeometry(prof, 240, Math.PI, Math.PI * 2);
      const pos = g.attributes.position;
      const v = new T.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const th = Math.atan2(v.z, v.x);
        const rad = Math.sqrt(v.x * v.x + v.z * v.z);
        const a = t.n * th - t.phase * t.n;
        const P = Math.pow((1 - Math.cos(a)) / 2, 2.2); // 1 at the pointed tips, 0 behind the drops
        let w = (rad / t.R - 0.45) / 0.55;
        w = Math.max(0, Math.min(1, w));
        w = w * w;
        const nr = rad * (1 + 0.2 * P * w - 0.1 * (1 - P) * w);
        v.y += 0.16 * t.sc * P * w * w - 0.06 * t.sc * (1 - P) * w;
        pos.setXYZ(i, Math.cos(th) * nr, v.y, Math.sin(th) * nr);
      }
      g.computeVertexNormals();
      // Soft shading: darker up under the tier above and between the drops, lighter on the pointed tips.
      const col = [];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const r = Math.sqrt(v.x * v.x + v.z * v.z) / t.R;
        const a = t.n * Math.atan2(v.z, v.x) - t.phase * t.n;
        const tip = Math.pow((1 - Math.cos(a)) / 2, 2);
        const k = 0.62 + 0.3 * Math.min(1, Math.max(0, (r - 0.35) / 0.65)) + 0.08 * tip;
        col.push(k, k, k);
      }
      g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      return g;
    };
    const dropGeo = (() => {
      const g = new T.SphereGeometry(1, 32, 22);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const f = 1.1 - 0.32 * ((y + 1) / 2); // fuller at the bottom, like a drop
        pos.setXYZ(i, pos.getX(i) * f, y, pos.getZ(i) * f);
      }
      g.computeVertexNormals();
      // Soft, rounded shading like clay: lighter on the top and the front, darker underneath and where it
      // tucks into the tree. This replaces the hard shadows the drops used to throw on each other.
      const col = [], nrm = g.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const up = (pos.getY(i) + 1) / 2;                  // 0 bottom … 1 top
        const front = (nrm.getZ(i) + 1) / 2;               // 0 into the tree … 1 facing out
        const k = 0.66 + 0.2 * Math.pow(up, 0.8) + 0.14 * front;
        col.push(k, k, k);
      }
      g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      return g;
    })();
    tiers.forEach((t, ti) => {
      const skirt = new T.Mesh(makeSkirt(t), mats.skirt);
      skirt.position.y = t.rim;
      spin.add(skirt);
      tierMeshes[ti].push(skirt);
      const rp = t.R * 0.7;
      const half = rp * Math.sin(Math.PI / t.n);
      for (let j = 0; j < t.n; j++) {
        const th = (j * Math.PI * 2) / t.n + t.phase;
        const d = new T.Mesh(dropGeo, mats.leafIn);
        d.scale.set(half * 1.2, t.ry, 0.36 * t.sc);
        d.position.set(Math.cos(th) * rp, t.edge + t.ry * 0.95, Math.sin(th) * rp);
        d.rotation.set(-0.28, Math.PI / 2 - th, 0, 'YXZ');
        spin.add(d);
        tierMeshes[ti].push(d);
      }
    });
    const top = tiers[tiers.length - 1];
    const spikeProf = [];
    for (let i = 0; i <= 14; i++) {
      const s = i / 14;
      spikeProf.push(new T.Vector2(0.34 * Math.pow(1 - s, 1.7) + 0.012, 1.0 * s));
    }
    spikeProf.push(new T.Vector2(0, 1.0));
    const spike = new T.Mesh(new T.LatheGeometry(spikeProf, 48), mats.leaf);
    spike.position.y = top.rim + 0.2;
    spin.add(spike);
    const tipY = spike.position.y + 1.0;

    // Outside of a tier at angle th and height y (for garlands and baubles): the skirt or a drop, whichever sticks out more.
    spin.updateMatrixWorld(true);
    const dropsOf = tierMeshes.map((list) => list.slice(1).map((m) => new T.Matrix4().copy(m.matrixWorld).invert()));
    const skirtR = (t, th, y) => {
      const s = Math.max(0, Math.min(1, 1 - (y - t.rim) / t.H));
      const rad = t.R * (0.04 + 0.96 * Math.pow(s, 0.85));
      const P = Math.pow((1 - Math.cos(t.n * th - t.phase * t.n)) / 2, 2.2);
      let w = Math.max(0, Math.min(1, (rad / t.R - 0.45) / 0.55));
      w = w * w;
      return rad * (1 + 0.2 * P * w - 0.1 * (1 - P) * w);
    };
    const o = new T.Vector3(), dv = new T.Vector3();
    const surfAt = (ti, th, y, out) => {
      let r = skirtR(tiers[ti], th, y);
      if (tiers[ti + 1] && y > tiers[ti + 1].rim - 0.1) r = Math.max(r, skirtR(tiers[ti + 1], th, y));
      const cx = Math.cos(th), cz = Math.sin(th);
      [ti, ti + 1].forEach((k) => (dropsOf[k] || []).forEach((inv) => {
        o.set(cx * 6, y, cz * 6).applyMatrix4(inv);
        dv.set(-cx, 0, -cz).transformDirection(inv).multiplyScalar(1);
        // transformDirection normalises, so rescale to keep t in world units
        const len = new T.Vector3(-cx, 0, -cz).applyMatrix4(inv).sub(new T.Vector3().applyMatrix4(inv)).length();
        dv.multiplyScalar(len);
        const a = dv.dot(dv), b = 2 * o.dot(dv), c = o.dot(o) - 1.04;
        const disc = b * b - 4 * a * c;
        if (disc <= 0) return;
        const tt = (-b - Math.sqrt(disc)) / (2 * a);
        if (tt > 0) r = Math.max(r, 6 - tt);
      }));
      return new T.Vector3(cx * (r + out), y, cz * (r + out));
    };

    /* ---------- star on a gold finial ---------- */
    const finial = new T.Mesh(new T.CylinderGeometry(0.075, 0.11, 0.26, 20), mats.gold);
    finial.position.y = tipY - 0.02;
    spin.add(finial);
    // Faceted 3D star: a ridge runs from the centre to every point, front and back.
    const starPts = [];
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? 0.47 : 0.21;
      starPts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    const sv = [];
    const dz = 0.17;
    for (let i = 0; i < 10; i++) {
      const p0 = starPts[i], p1 = starPts[(i + 1) % 10];
      sv.push(0, 0, dz, p0[0], p0[1], 0, p1[0], p1[1], 0);
      sv.push(0, 0, -dz, p1[0], p1[1], 0, p0[0], p0[1], 0);
    }
    const starGeo = new T.BufferGeometry();
    starGeo.setAttribute('position', new T.Float32BufferAttribute(sv, 3));
    starGeo.computeVertexNormals();
    const star = new T.Mesh(starGeo, mats.star);
    star.position.y = tipY + 0.44;
    spin.add(star);
    const starGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: C('#FFD86B'), transparent: true, opacity: 0.32, blending: T.AdditiveBlending, depthWrite: false }));
    starGlow.position.y = star.position.y;
    starGlow.scale.setScalar(2.0);
    spin.add(starGlow);

    /* ---------- bead garlands, draped in swags ---------- */
    const beadGeo = new T.SphereGeometry(1, 6, 4);
    const garland = (ti, dy, swags, sag, mat, bead, phase) => {
      const t = tiers[ti];
      const pts = [];
      const N = 200;
      for (let i = 0; i < N; i++) {
        const th = (i / N) * Math.PI * 2 + (phase || 0);
        const dip = Math.abs(Math.sin((swags * (th - (phase || 0))) / 2));
        pts.push(surfAt(ti, th, t.edge + dy - sag * dip, bead * 0.9));
      }
      const curve = new T.CatmullRomCurve3(pts, true);
      const n = Math.floor(curve.getLength() / (bead * 2.05));
      const inst = new T.InstancedMesh(beadGeo, mat, n);
      const m4 = new T.Matrix4();
      for (let i = 0; i < n; i++) {
        const p = curve.getPointAt(i / n);
        m4.makeScale(bead, bead, bead).setPosition(p);
        inst.setMatrixAt(i, m4);
      }
      inst.castShadow = false;
      spin.add(inst);
    };
    garland(5, 0.62, 3, 0.1, mats.beadGold, 0.034, 0.3);
    garland(4, 0.5, 4, 0.13, mats.beadRed, 0.036, 1.1);
    garland(3, 0.52, 4, 0.15, mats.beadGold, 0.038, 0.2);
    garland(2, 0.52, 5, 0.17, mats.beadRed, 0.04, 0.9);
    garland(1, 0.55, 5, 0.18, mats.beadGold, 0.04, 0.5);
    garland(0, 0.55, 6, 0.2, mats.beadRed, 0.042, 0.1);

    /* ---------- baubles ---------- */
    const capGeo = new T.CylinderGeometry(0.28, 0.28, 0.24, 14);
    const bauble = (x, y, z, mat, size) => {
      const g = new T.Group();
      g.add(new T.Mesh(new T.SphereGeometry(size, 20, 14), mat));
      const cap = new T.Mesh(capGeo, mats.gold);
      cap.scale.setScalar(size);
      cap.position.y = size * 0.98;
      g.add(cap);
      g.position.set(x, y, z);
      spin.add(g);
    };
    // hanging under a pointed tip of the outer skirt
    const tipBauble = (ti, tipN, mat, size) => {
      const t = tiers[ti];
      const th = ((tipN + 0.5) * Math.PI * 2) / t.n + t.phase;
      const r = t.R * 1.12;
      bauble(Math.cos(th) * r, t.rim + 0.06 - size * 1.05, Math.sin(th) * r, mat, size);
    };
    // resting on the front of a tier
    const onBauble = (ti, dy, th, mat, size) => {
      const p = surfAt(ti, th, tiers[ti].edge + dy, size * 0.75);
      bauble(p.x, p.y, p.z, mat, size);
    };
    const P = Math.PI;
    [[0, 0, 'goldBall', 0.16], [0, 2, 'red', 0.18], [0, 4, 'blue', 0.17], [0, 6, 'goldBall', 0.16], [0, 8, 'red', 0.18],
      [1, 1, 'red', 0.17], [1, 3, 'goldBall', 0.16], [1, 5, 'blue', 0.16], [1, 7, 'red', 0.17],
      [2, 0, 'blue', 0.15], [2, 2, 'red', 0.16], [2, 4, 'goldBall', 0.15], [2, 6, 'red', 0.16],
      [3, 1, 'red', 0.14], [3, 4, 'blue', 0.14],
      [4, 0, 'goldBall', 0.12], [4, 3, 'red', 0.12]].forEach((b) => tipBauble(b[0], b[1], mats[b[2]], b[3]));
    [[0, 0.22, P * 0.5, 'blue', 0.16], [0, 0.34, P * 0.85, 'green', 0.16], [0, 0.26, P * 1.3, 'red', 0.16], [0, 0.32, P * 1.75, 'goldBall', 0.16],
      [1, 0.3, P * 0.3, 'goldBall', 0.15], [1, 0.24, P * 0.66, 'red', 0.16], [1, 0.32, P * 1.15, 'goldBall', 0.15], [1, 0.28, P * 1.6, 'red', 0.16],
      [2, 0.26, P * 0.52, 'red', 0.15], [2, 0.32, P * 0.2, 'green', 0.14], [2, 0.28, P * 1.0, 'red', 0.15], [2, 0.26, P * 1.45, 'blue', 0.14],
      [3, 0.3, P * 0.4, 'goldBall', 0.13], [3, 0.3, P * 0.72, 'goldBall', 0.13], [3, 0.3, P * 1.3, 'red', 0.13],
      [4, 0.26, P * 0.55, 'red', 0.11], [4, 0.26, P * 1.5, 'goldBall', 0.11]].forEach((b) => onBauble(b[0], b[1], b[2], mats[b[3]], b[4]));

    /* ---------- presents ---------- */
    const roundedBox = (w, h, d, r) => {
      const seg = 7;
      const g = new T.BoxGeometry(w, h, d, seg, seg, seg);
      const p = g.attributes.position;
      const nrm = g.attributes.normal;
      const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
      const v = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
        n.subVectors(v, c);
        if (n.lengthSq() < 1e-9) n.fromBufferAttribute(nrm, i);
        n.normalize();
        p.setXYZ(i, c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
        nrm.setXYZ(i, n.x, n.y, n.z);
      }
      return g;
    };
    const loopGeo = new T.TorusGeometry(0.14, 0.06, 12, 30);
    const gift = (w, h, d, x, z, ry, boxMat) => {
      const g = new T.Group();
      g.add(new T.Mesh(roundedBox(w, h, d, Math.min(0.05, w * 0.08)), boxMat));
      const band = Math.min(0.11, w * 0.16);
      g.add(new T.Mesh(new T.BoxGeometry(w + 0.012, h + 0.012, band), mats.ribbon));
      g.add(new T.Mesh(new T.BoxGeometry(band, h + 0.012, d + 0.012), mats.ribbon));
      const s = Math.min(1.25, 0.55 + w * 0.6);
      const bow = new T.Group();
      [-1, 1].forEach((sd) => {
        const lp = new T.Mesh(loopGeo, mats.ribbon);
        lp.scale.set(1, 0.85, 0.5);
        lp.position.set(sd * 0.15, 0.08, 0);
        lp.rotation.z = sd * 0.45;
        bow.add(lp);
        const tail = new T.Mesh(new T.BoxGeometry(0.07, 0.24, 0.02), mats.ribbon);
        tail.position.set(sd * 0.08, -0.02, 0.08);
        tail.rotation.set(-0.9, 0, sd * 0.7);
        bow.add(tail);
      });
      const knot = new T.Mesh(new T.SphereGeometry(0.06, 14, 10), mats.ribbon);
      knot.scale.set(1, 0.8, 0.8);
      knot.position.y = 0.04;
      bow.add(knot);
      bow.scale.setScalar(s);
      bow.position.y = h / 2;
      g.add(bow);
      g.position.set(x, floorY + h / 2, z);
      g.rotation.y = ry;
      spin.add(g);
    };
    gift(0.78, 0.46, 0.7, -1.45, 0.75, 0.12, mats.giftGreen);
    gift(0.6, 0.44, 0.56, -1.05, 0.15, -0.2, mats.giftRed);
    gift(0.44, 0.3, 0.42, -0.95, 1.6, 0.18, mats.giftGreen);
    gift(0.7, 0.48, 0.62, -0.38, 1.25, -0.06, mats.giftRed);
    gift(0.6, 0.32, 0.52, 0.14, 1.8, 0.05, mats.giftGreen);
    gift(0.82, 0.5, 0.72, 0.68, 1.15, -0.12, mats.giftStripe);
    gift(0.32, 0.28, 0.32, 1.25, 1.7, 0.3, mats.giftRed);
    gift(0.72, 0.46, 0.68, 1.5, 0.55, 0.25, mats.giftGreen);
    gift(0.7, 0.44, 0.62, 0.95, -1.35, 0.5, mats.giftRed);
    gift(0.62, 0.4, 0.58, -0.4, -1.65, -0.3, mats.giftStripe);
    gift(0.56, 0.38, 0.52, -1.55, -0.95, 0.7, mats.giftGreen);
    shade(spin);
    rug.castShadow = false;
    redRug.castShadow = false;
    // only the big shapes cast shadows; baubles, beads and the star don't need to
    spin.traverse((m) => { if (m.isMesh && m.geometry && m.geometry.boundingSphere === null) m.geometry.computeBoundingSphere(); });
    spin.traverse((m) => { if (m.isMesh && m.geometry.boundingSphere.radius * Math.max(m.scale.x, m.scale.y, m.scale.z) < 0.25) m.castShadow = false; });
    star.castShadow = false;
    // Leaf drops don't cast: each tier still shades the one below it, without blotchy drop-on-drop shadows.
    tierMeshes.forEach((list) => list.slice(1).forEach((d) => { d.castShadow = false; }));

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
    let lastY = NaN, lastX = NaN, lastDraw = -1;
    const clock = new T.Clock();
    const loop = () => {
      if (this._dead) return;
      this._loop = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (this._hidden) return;
      const t = clock.elapsedTime;
      const ease = Math.min(1, dt * 4);
      rotY += ((this._mx || 0) * 2.4 - rotY) * ease;
      rotX += ((this._my || 0) * 0.07 - rotX) * ease;
      // Redraw only while the tree is turning; otherwise a few times a second for the star's glow.
      const moving = Math.abs(rotY - lastY) > 1e-4 || Math.abs(rotX - lastX) > 1e-5 || lastY !== lastY;
      if (!moving && t - lastDraw < (still || slow ? 1e9 : 0.12)) return;
      lastY = rotY; lastX = rotX; lastDraw = t;
      spin.rotation.y = rotY;
      world.rotation.x = rotX;
      starGlow.material.opacity = still ? 0.32 : 0.28 + 0.08 * Math.sin(t * 1.2);
      const t0 = performance.now();
      renderer.render(scene, camera);
      // On a slow device, drop to standard resolution and stop idle redraws.
      // Skip the first frames (shaders compile then), then watch the steady cost.
      if (++frames > 40) cost = cost * 0.9 + (performance.now() - t0) * 0.1;
      if (frames > 100 && cost > 60 && !slow && renderer.getPixelRatio() > 1) {
        slow = true;
        renderer.setPixelRatio(1);
        resize();
      }
    };
    let cost = 0, frames = 0, slow = false;
    loop();
  }

  window.LH_TREE = { build3d: build3d };
})();
