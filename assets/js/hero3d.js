/* IABEX — 3D hero: an animated PCB (three.js r149, vendored in assets/vendor).
 *
 * Desktop (>960px): the board is framed on the right of the hero, behind the copy.
 * Tablet/phone:     the board is framed inside [data-hero-band] between the copy and
 *                   the stats (via camera.setViewOffset), so it never sits under text.
 * Falls back silently (adds .no-webgl to the hero) if WebGL or three.js is missing.
 * Honours prefers-reduced-motion (renders a still frame) and pauses when off-screen.
 *
 * Palette mirrors the CSS tokens: red #E31E25, amber #F2A541, copper #B86B3C.
 */
(function () {
  'use strict';

  var hero = document.querySelector('[data-hero]');
  var canvas = document.querySelector('[data-hero-canvas]');
  if (!hero || !canvas) return;

  function fail() { hero.classList.add('no-webgl'); canvas.style.display = 'none'; }
  var T = window.THREE;
  if (!T) { fail(); return; }

  // Treat hex colours as sRGB (matches the CSS palette); r149 defaults to legacy/linear.
  if (T.ColorManagement) T.ColorManagement.legacyMode = false;

  var renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { fail(); return; }

  var LOGO_SRC = 'assets/img/brand/logo-on-dark.webp';
  var COLORS = { red: 0xe31e25, amber: 0xf2a541, copper: 0xc9773f, dark: 0x1c1410 };

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  var scene = new T.Scene();
  scene.fog = new T.Fog(COLORS.dark, 13, 28);
  var camera = new T.PerspectiveCamera(30, 1, 0.1, 200);

  /* Lights — warm key, red rim, amber fill */
  scene.add(new T.HemisphereLight(0xffe7cc, COLORS.dark, 0.55));
  var key = new T.DirectionalLight(0xffd9b0, 1.5); key.position.set(4, 8, 5); scene.add(key);
  var rim = new T.PointLight(COLORS.red, 2.2, 18); rim.position.set(-5, 2.5, -3); scene.add(rim);
  var fill = new T.PointLight(COLORS.amber, 1.6, 16); fill.position.set(4, 1.5, 4); scene.add(fill);

  var root = new T.Group(); scene.add(root);
  var board = new T.Group(); root.add(board);
  board.rotation.x = -0.05;

  var W = 6.4, D = 4.2, TOP = 0.07;
  var mat = {
    sub: new T.MeshStandardMaterial({ color: 0x2b1a12, roughness: 0.6, metalness: 0.1 }),
    copper: new T.MeshStandardMaterial({ color: COLORS.copper, roughness: 0.32, metalness: 0.9, emissive: 0x3a1a08, emissiveIntensity: 0.4 }),
    gold: new T.MeshStandardMaterial({ color: 0xe0b064, roughness: 0.3, metalness: 1.0 }),
    chip: new T.MeshStandardMaterial({ color: 0x15100d, roughness: 0.45, metalness: 0.2 }),
    pin: new T.MeshStandardMaterial({ color: 0xd8cfc4, roughness: 0.25, metalness: 0.95 }),
    cap: new T.MeshStandardMaterial({ color: 0xd99a3c, roughness: 0.4, metalness: 0.35 }),
    capTop: new T.MeshStandardMaterial({ color: 0xcfc6bb, roughness: 0.3, metalness: 0.9 }),
    header: new T.MeshStandardMaterial({ color: 0x0f0b09, roughness: 0.7 })
  };

  /* Deterministic RNG so the board looks the same on every load */
  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* Substrate + copper edge */
  var sub = new T.Mesh(new T.BoxGeometry(W, 0.14, D), mat.sub); board.add(sub);
  board.add(new T.LineSegments(new T.EdgesGeometry(sub.geometry), new T.LineBasicMaterial({ color: 0xb86b3c, transparent: true, opacity: 0.7 })));

  /* Mounting holes */
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) {
    var ring = new T.Mesh(new T.RingGeometry(0.09, 0.16, 32), mat.gold);
    ring.rotation.x = -Math.PI / 2; ring.position.set(s[0] * (W / 2 - 0.3), TOP + 0.002, s[1] * (D / 2 - 0.3)); board.add(ring);
  });

  /* Traces — Manhattan routes leaving the MCU on all four sides */
  var paths = [];
  function addSeg(a, b) {
    var dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.001) return;
    var m = new T.Mesh(new T.BoxGeometry(len + 0.035, 0.012, 0.035), mat.copper);
    m.position.set((a.x + b.x) / 2, TOP + 0.006, (a.z + b.z) / 2);
    m.rotation.y = -Math.atan2(dz, dx); board.add(m);
  }
  var C = 0.65, maxX = W / 2 - 0.25, maxZ = D / 2 - 0.25;
  for (var side = 0; side < 4; side++) {
    for (var i = 0; i < 7; i++) {
      var off = -0.48 + i * 0.16, p0, dir, perp;
      if (side === 0) { p0 = { x: C, z: off }; dir = { x: 1, z: 0 }; perp = { x: 0, z: 1 }; }
      else if (side === 1) { p0 = { x: -C, z: off }; dir = { x: -1, z: 0 }; perp = { x: 0, z: 1 }; }
      else if (side === 2) { p0 = { x: off, z: C }; dir = { x: 0, z: 1 }; perp = { x: 1, z: 0 }; }
      else { p0 = { x: off, z: -C }; dir = { x: 0, z: -1 }; perp = { x: 1, z: 0 }; }
      var l1 = 0.25 + rnd() * 0.5;
      var p1 = { x: p0.x + dir.x * l1, z: p0.z + dir.z * l1 };
      var l2 = (0.2 + rnd() * 0.9) * (off >= 0 ? 1 : -1);
      var p2 = { x: clamp(p1.x + perp.x * l2, -maxX, maxX), z: clamp(p1.z + perp.z * l2, -maxZ, maxZ) };
      var l3 = 0.4 + rnd() * 1.4;
      var p3 = { x: clamp(p2.x + dir.x * l3, -maxX, maxX), z: clamp(p2.z + dir.z * l3, -maxZ, maxZ) };
      var pts = [p0, p1, p2, p3];
      for (var k = 0; k < 3; k++) addSeg(pts[k], pts[k + 1]);
      var pad = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.016, 16), mat.gold);
      pad.position.set(p3.x, TOP + 0.008, p3.z); board.add(pad);
      paths.push(pts);
    }
  }

  /* MCU with the IABEX mark */
  var mcu = new T.Mesh(new T.BoxGeometry(1.3, 0.16, 1.3), mat.chip); mcu.position.y = TOP + 0.08; board.add(mcu);
  var pinGeo = new T.BoxGeometry(0.05, 0.03, 0.16);
  for (var s = 0; s < 4; s++) for (var j = 0; j < 12; j++) {
    var o = -0.55 + j * 0.1, pin = new T.Mesh(pinGeo, mat.pin);
    if (s < 2) pin.position.set(o, TOP + 0.02, (s === 0 ? 1 : -1) * 0.72);
    else { pin.rotation.y = Math.PI / 2; pin.position.set((s === 2 ? 1 : -1) * 0.72, TOP + 0.02, o); }
    board.add(pin);
  }
  new T.TextureLoader().load(LOGO_SRC, function (tex) {
    tex.encoding = T.sRGBEncoding; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    var logo = new T.Mesh(new T.PlaneGeometry(1.0, 1.0 * 63 / 394), new T.MeshBasicMaterial({ map: tex, transparent: true }));
    logo.rotation.x = -Math.PI / 2; logo.position.set(0, TOP + 0.162, 0.05); board.add(logo);
  });
  var pin1 = new T.Mesh(new T.CircleGeometry(0.05, 20), new T.MeshBasicMaterial({ color: 0x3a2a1f }));
  pin1.rotation.x = -Math.PI / 2; pin1.position.set(-0.48, TOP + 0.162, -0.48); board.add(pin1);

  /* Secondary ICs */
  function ic(x, z, w, d, n) {
    var b = new T.Mesh(new T.BoxGeometry(w, 0.1, d), mat.chip); b.position.set(x, TOP + 0.05, z); board.add(b);
    for (var q = 0; q < n; q++) {
      var oo = -w / 2 + 0.08 + q * ((w - 0.16) / Math.max(1, n - 1));
      [1, -1].forEach(function (sg) {
        var p = new T.Mesh(new T.BoxGeometry(0.035, 0.025, 0.1), mat.pin);
        p.position.set(x + oo, TOP + 0.015, z + sg * (d / 2 + 0.04)); board.add(p);
      });
    }
  }
  ic(-2.1, -1.2, 0.7, 0.4, 6); ic(2.2, 1.1, 0.8, 0.45, 7); ic(-2.3, 1.2, 0.5, 0.35, 4); ic(1.8, -1.35, 0.55, 0.35, 4);

  /* Capacitors */
  [[-1.4, 1.5], [-1.0, 1.55], [2.6, -0.3], [2.6, 0.2]].forEach(function (c, idx) {
    var h = idx < 2 ? 0.42 : 0.32;
    var can = new T.Mesh(new T.CylinderGeometry(0.14, 0.14, h, 28), mat.cap); can.position.set(c[0], TOP + h / 2, c[1]); board.add(can);
    var top = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.01, 28), mat.capTop); top.position.set(c[0], TOP + h + 0.005, c[1]); board.add(top);
  });

  /* Inductor */
  var coil = new T.Mesh(new T.TorusGeometry(0.22, 0.075, 16, 40), mat.copper); coil.rotation.x = Math.PI / 2; coil.position.set(1.4, TOP + 0.08, 1.5); board.add(coil);
  var core = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 0.16, 20), mat.chip); core.position.set(1.4, TOP + 0.08, 1.5); board.add(core);

  /* Header connector */
  var hdr = new T.Mesh(new T.BoxGeometry(1.6, 0.18, 0.22), mat.header); hdr.position.set(-0.4, TOP + 0.09, -1.8); board.add(hdr);
  for (var h2 = 0; h2 < 10; h2++) { var hp = new T.Mesh(new T.BoxGeometry(0.04, 0.32, 0.04), mat.gold); hp.position.set(-1.12 + h2 * 0.16, TOP + 0.2, -1.8); board.add(hp); }

  /* Status LEDs */
  var leds = [];
  [COLORS.red, COLORS.amber, COLORS.amber, COLORS.red].forEach(function (col, idx) {
    var m = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.5, roughness: 0.3 });
    var l = new T.Mesh(new T.BoxGeometry(0.1, 0.06, 0.06), m); l.position.set(2.7 - idx * 0.18, TOP + 0.03, -1.8); board.add(l); leds.push(m);
  });

  /* Ghost enclosure frame (design → production) */
  var encl = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(W + 0.5, 1.2, D + 0.5)), new T.LineBasicMaterial({ color: COLORS.amber, transparent: true, opacity: 0.16 }));
  encl.position.y = 0.55; board.add(encl);

  /* Signal pulses travelling along traces */
  var pulses = [];
  var pGeo = new T.SphereGeometry(0.045, 12, 12), gGeo = new T.SphereGeometry(0.11, 12, 12);
  paths.forEach(function (pts, idx) {
    if (idx % 2) return;
    var seg = [], total = 0;
    for (var k = 0; k < pts.length - 1; k++) { var l = Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].z - pts[k].z); seg.push(l); total += l; }
    var col = idx % 4 === 0 ? 0xffb860 : 0xff4a3d;
    var dotM = new T.Mesh(pGeo, new T.MeshBasicMaterial({ color: col }));
    var glow = new T.Mesh(gGeo, new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.28, blending: T.AdditiveBlending, depthWrite: false }));
    board.add(dotM); board.add(glow);
    pulses.push({ pts: pts, seg: seg, total: total, dot: dotM, glow: glow, speed: 0.5 + rnd() * 0.6, phase: rnd() });
  });
  function placePulse(p, t) {
    var d = ((t * p.speed + p.phase) % 1) * p.total;
    for (var k = 0; k < p.seg.length; k++) {
      if (d <= p.seg[k] || k === p.seg.length - 1) {
        var f = p.seg[k] ? Math.min(1, d / p.seg[k]) : 0, a = p.pts[k], b = p.pts[k + 1];
        var x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
        p.dot.position.set(x, TOP + 0.03, z); p.glow.position.set(x, TOP + 0.03, z);
        return;
      }
      d -= p.seg[k];
    }
  }

  /* Embers */
  var N = 240, pos = new Float32Array(N * 3);
  for (var e = 0; e < N; e++) { pos[e * 3] = (rnd() - 0.5) * 16; pos[e * 3 + 1] = rnd() * 6 - 1.5; pos[e * 3 + 2] = (rnd() - 0.5) * 10; }
  var pg = new T.BufferGeometry(); pg.setAttribute('position', new T.BufferAttribute(pos, 3));
  var embers = new T.Points(pg, new T.PointsMaterial({ color: COLORS.amber, size: 0.035, transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false }));
  scene.add(embers);

  /* Floor grid for depth */
  var grid = new T.GridHelper(40, 80, 0x4a3628, 0x2e2119);
  grid.position.y = -1.4; grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid);

  /* Framing */
  var band = hero.querySelector('[data-hero-band]');
  var lastKey = '';
  function size() {
    var w = hero.clientWidth || 1, h = hero.clientHeight || 1;
    var bh = band ? band.offsetHeight : 0, bandTop = 0;
    if (bh > 0) bandTop = Math.round(band.getBoundingClientRect().top - hero.getBoundingClientRect().top);
    var key = w + 'x' + h + ':' + bh + ':' + bandTop;
    if (key === lastKey) return;
    lastKey = key;
    renderer.setSize(w, h, false);
    if (bh > 0) {
      // Narrow: frame the board inside the band
      camera.aspect = w / bh;
      camera.setViewOffset(w, bh, 0, -bandTop, w, h);
      var dist = Math.max(10, 7.8 / (2 * Math.tan(15 * Math.PI / 180) * camera.aspect));
      camera.position.set(0, dist * 0.58, dist * 0.82);
      scene.fog.near = dist * 0.9; scene.fog.far = dist * 2.4;
    } else {
      // Wide: shift the image right so the board sits beside the copy
      camera.aspect = w / h;
      camera.setViewOffset(w, h, -Math.round(w * 0.24), 0, w, h);
      var dz = w / h < 1.5 ? 13.5 : 12;
      camera.position.set(0, dz * 0.6, dz * 0.82);
      scene.fog.near = dz * 1.1; scene.fog.far = dz * 2.6;
    }
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  size();
  if ('ResizeObserver' in window) new ResizeObserver(size).observe(hero);
  window.addEventListener('resize', size);

  /* Pointer parallax */
  var mx = 0, my = 0;
  hero.addEventListener('pointermove', function (ev) {
    var r = hero.getBoundingClientRect();
    mx = ((ev.clientX - r.left) / r.width) * 2 - 1;
    my = ((ev.clientY - r.top) / r.height) * 2 - 1;
  });

  /* Pause off-screen */
  var visible = true;
  if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { visible = en[0].isIntersecting; }).observe(hero);

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clock = new T.Clock(), frame = 0;

  function render(t) {
    root.position.y = Math.sin(t * 0.8) * 0.08;
    board.rotation.y = -0.55 + Math.sin(t * 0.22) * 0.38 + mx * 0.22;
    root.rotation.x += ((my * 0.12) - root.rotation.x) * 0.05;
    root.rotation.z = Math.sin(t * 0.3) * 0.03;
    encl.material.opacity = 0.1 + (Math.sin(t * 1.1) + 1) * 0.07;
    encl.position.y = 0.55 + Math.sin(t * 0.7) * 0.06;
    for (var q = 0; q < pulses.length; q++) placePulse(pulses[q], t * 0.35);
    for (var li = 0; li < leds.length; li++) leds[li].emissiveIntensity = 0.6 + (Math.sin(t * (2 + li * 0.7) + li) + 1) * 0.9;
    var a = pg.attributes.position.array;
    for (var n = 0; n < N; n++) { a[n * 3 + 1] += 0.004; if (a[n * 3 + 1] > 4.5) a[n * 3 + 1] = -1.5; }
    pg.attributes.position.needsUpdate = true;
    embers.rotation.y = t * 0.02;
    renderer.render(scene, camera);
  }

  if (reduce) {
    render(2);
    window.addEventListener('resize', function () { render(2); });
    return;
  }
  (function loop() {
    requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    if ((++frame % 45) === 0) size(); // catch late layout shifts (web fonts etc.)
    render(clock.getElapsedTime());
  })();
})();
