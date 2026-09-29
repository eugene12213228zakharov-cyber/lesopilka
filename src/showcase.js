'use strict';
// Витрина моделей: свои модели (craft.js) и кандидаты Kenney рядами по группам.
// ★ и жёлтый круг — что стоит в игре сейчас: берётся из MODEL_OF (kmodels.js), руками не отмечается.

(async function showcase() {
  const canvas = document.getElementById('c');
  const labelsEl = document.getElementById('labels');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  lookRenderer(renderer);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LOOK.fog);
  lookEnvironment(renderer, scene);
  const sun = lookSun(scene, 4096, 90);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.3, 600);

  // модели Kenney: грузим всех кандидатов
  const lib = new ModelLib();
  window.LIB = lib;
  const keys = [];
  for (const g of KENNEY_GROUPS) for (const n of g.items) keys.push(g.pack + '/' + n);
  const status = document.getElementById('status');
  const failed = await lib.loadAll(keys, (d, n) => { status.textContent = `Загружаю модели: ${d} из ${n}`; });
  status.textContent = failed.length ? 'Не загрузились: ' + failed.join(', ') : '';
  window.LIB_OK = failed.length === 0;
  window.OWN_OK = true;
  initMaterials();
  buildItemModels();
  applyKenneyItems();   // верстак в витрине показывает стул в сборке — нужна мебель из игры

  const usedK = new Set(neededModels()), usedO = ownUsed();

  // ── раскладка ──
  const labels = [];
  const mixers = [];
  const anims = [];
  const label = (x, y, z, html, cls) => {
    const el = document.createElement('div');
    el.className = 'lbl ' + cls;
    el.innerHTML = html;
    labelsEl.appendChild(el);
    labels.push({ el, v: new THREE.Vector3(x, y, z) });
  };
  const size = (obj) => new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  const playClip = (key, obj, name) => {
    const clip = lib.clips(key).find((c) => c.name === name);
    if (!clip) return;
    const m = new THREE.AnimationMixer(obj);
    m.clipAction(clip).play();
    m.update(Math.random());
    mixers.push(m);
  };
  // ряд моделей: list — [{ name, obj, star, anim }], общий масштаб: самая большая вписывается в fit
  let z = 0, maxX = 0;
  const row = (title, list, fit = 2.4, cell = 3.4, gap = 5.2) => {
    let big = 0;
    for (const o of list) { const s = size(o.obj); big = Math.max(big, s.x, s.z, s.y * 0.8); }
    const k = big > 0 ? fit / big : 1;
    z += Math.max(0, (fit - 2.4) * 0.55);
    label(-3.2, 0.2, z, title, 'group');
    list.forEach((o, i) => {
      const x = i * cell;
      o.obj.scale.multiplyScalar(k);
      o.obj.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(o.obj);
      o.obj.position.set(x - (b.min.x + b.max.x) / 2, -b.min.y, z - (b.min.z + b.max.z) / 2);
      scene.add(o.obj);
      if (o.anim) anims.push(o.anim);
      if (o.star) {
        const disc = new THREE.Mesh(new THREE.CircleGeometry(cell * 0.43, 40), new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.5, toneMapped: false }));
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(x, 0.02, z);
        scene.add(disc);
      }
      label(x, -0.05, z + cell * 0.45, (o.star ? '★ ' : '') + o.name, o.star ? 'name star' : 'name');
      maxX = Math.max(maxX, x);
    });
    z += gap + Math.max(0, (fit - 2.4) * 0.55);
  };

  // свои модели
  for (const g of OWN_GROUPS) {
    const list = g.items.map((key) => {
      const o = ownShowcase(key);
      return o && { name: OWN_NAMES[ownKey(key)] || key, obj: o.obj, anim: o.anim, star: usedO.has(key) };
    }).filter(Boolean);
    row(g.title, list, g.fit, g.cell, 5.2);
  }
  // кандидаты Kenney
  for (const g of KENNEY_GROUPS) {
    const list = g.items.map((n) => {
      const key = g.pack + '/' + n, obj = lib.cloneRecolored(key);
      if (!obj) return null;
      if (g.pack === 'mini-characters') {
        obj.traverse((o) => { if (o.isMesh) { const s = o.material; o.material = plainMaterial({ map: s.map || null, color: s.map ? 0xffffff : s.color, roughness: 0.72 }); } });
        playClip(key, obj, 'walk');
      }
      return { name: n, obj, star: usedK.has(key) };
    }).filter(Boolean);
    row(g.title + ' · Kenney', list);
  }

  // ── ряд анимаций: человечек игрока в каске ──
  const clipsRow = [['idle', 'стоит'], ['walk', 'идёт'], ['sprint', 'бежит'], ['holding-both', 'несёт стопку'], ['pick-up', 'поднимает'], ['interact-right', 'работает']];
  label(-3.2, 0.2, z, 'Анимации (игрок в оранжевой каске, рабочий — в жёлтой)', 'group');
  const heroKey = MODEL_OF.player;
  const heroScale = (() => { const o = lib.clone(heroKey); if (!o) return 1; const s = size(o); return 2.4 / Math.max(s.x, s.z, s.y * 0.8); })();
  const man = (key, clip, x, helmet) => {
    const o = lib.clone(key);
    if (!o) return;
    o.traverse((m) => { if (m.isMesh) { const s = m.material; m.material = plainMaterial({ map: s.map || null, color: s.map ? 0xffffff : s.color, roughness: 0.72 }); } });
    o.scale.setScalar(heroScale);
    o.position.set(x, 0, z);
    addHelmet(o, helmet);
    scene.add(o);
    playClip(key, o, clip);
  };
  clipsRow.forEach(([clip, ru], i) => { man(heroKey, clip, i * 3.4, 0xff8c1a); label(i * 3.4, -0.05, z + 1.5, ru + ' · ' + clip, 'name'); });
  man(MODEL_OF.workers[0], 'walk', clipsRow.length * 3.4, 0xffd43b);
  label(clipsRow.length * 3.4, -0.05, z + 1.5, 'рабочий в каске', 'name');
  z += 5.2;

  const gt = groundTexture('concrete'), tex = gt.tex.clone();
  tex.needsUpdate = true;
  tex.repeat.set((maxX + 60) / gt.m, (z + 40) / gt.m);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(maxX + 60, z + 40), plainMaterial({ map: tex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(maxX / 2, 0, z / 2 - 5);
  ground.receiveShadow = true;
  scene.add(ground);
  lookSunAt(sun, maxX / 2, z / 2);

  // ── камера: тянуть мышью — двигать, колёсико — приблизить ──
  const cam = { x: 12, z: 2, zoom: 1 };
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cz: cam.z }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = 0.035 * cam.zoom;
    cam.x = drag.cx - (e.clientX - drag.x) * k;
    cam.z = drag.cz - (e.clientY - drag.y) * k;
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.zoom = clamp(cam.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.4, 4); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    const s = 2 * cam.zoom;
    if (e.code === 'KeyW' || e.code === 'ArrowUp') cam.z -= s;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') cam.z += s;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') cam.x -= s;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') cam.x += s;
  });

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  const v = new THREE.Vector3();
  let last = performance.now(), t = 0;
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now; t += dt;
    for (const m of mixers) m.update(dt);
    for (const a of anims) a(t, true);
    camera.position.set(cam.x, 16 * cam.zoom, cam.z + 13 * cam.zoom);
    camera.lookAt(cam.x, 0, cam.z);
    renderer.render(scene, camera);
    for (const l of labels) {
      v.copy(l.v).project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      l.el.style.display = vis ? '' : 'none';
      if (vis) l.el.style.transform = `translate(${((v.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * innerHeight).toFixed(1)}px) translate(-50%, 0)`;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__showcase = { lib, scene, cam, renderer, camera };
})();
