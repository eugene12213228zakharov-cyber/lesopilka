'use strict';
// Витрина моделей: все кандидаты рядами по группам, ★ — что стоит в игре по умолчанию.

(async function showcase() {
  const canvas = document.getElementById('c');
  const labelsEl = document.getElementById('labels');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe3f2);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x88a860, 1.5));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
  sun.position.set(-30, 60, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 200 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.3, 500);

  const lib = new ModelLib();
  const keys = [];
  for (const g of KENNEY_GROUPS) for (const n of g.items) keys.push(g.pack + '/' + n);
  const status = document.getElementById('status');
  const failed = await lib.loadAll(keys, (d, n) => { status.textContent = `Загружаю модели: ${d} из ${n}`; });
  status.textContent = failed.length ? 'Не загрузились: ' + failed.join(', ') : '';

  // ── раскладка ──
  const CELL = 3.4, ROW = 5.2, FIT = 2.4;
  const labels = [];
  const mixers = [];
  const label = (x, y, z, html, cls) => {
    const el = document.createElement('div');
    el.className = 'lbl ' + cls;
    el.innerHTML = html;
    labelsEl.appendChild(el);
    labels.push({ el, v: new THREE.Vector3(x, y, z) });
  };
  const size = (obj) => new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());

  // каска на голову человечка: ищем кость head и сажаем полусферу на макушку
  const addHelmet = (root, color) => {
    let head = null;
    root.traverse((o) => { if (!head && o.name === 'head') head = o; });
    if (!head) return;
    let headMesh = null;
    root.traverse((o) => { if (!headMesh && o.name === 'head-mesh') headMesh = o; });
    root.updateMatrixWorld(true);
    const hb = new THREE.Box3().setFromObject(headMesh || head);
    const hs = hb.getSize(new THREE.Vector3());
    // каска — ребёнок кости головы и наследует её масштаб: размер задаём в единицах кости
    const ws = head.getWorldScale(new THREE.Vector3());
    const r = (hs.x * 0.5 * 0.98) / ws.x;
    const helmet = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.scale.y = 0.7;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.08, r * 1.08, r * 0.07, 20), mat);
    helmet.add(dome, brim);
    helmet.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // координаты макушки — в системе кости головы
    root.updateMatrixWorld(true);
    const top = new THREE.Vector3((hb.min.x + hb.max.x) / 2, hb.max.y - hs.y * 0.24, (hb.min.z + hb.max.z) / 2);
    head.worldToLocal(top);
    helmet.position.copy(top);
    head.add(helmet);
  };

  const playClip = (key, obj, name) => {
    const clip = lib.clips(key).find((c) => c.name === name);
    if (!clip) return;
    const m = new THREE.AnimationMixer(obj);
    m.clipAction(clip).play();
    m.update(Math.random());
    mixers.push(m);
  };

  let z = 0;
  let maxX = 0;
  for (const g of KENNEY_GROUPS) {
    // общий масштаб на группу: самая большая модель группы вписывается в FIT — пропорции внутри группы сохраняются
    const objs = g.items.map((n) => ({ n, key: g.pack + '/' + n, obj: lib.clone(g.pack + '/' + n) })).filter((o) => o.obj);
    let big = 0;
    for (const o of objs) { const s = size(o.obj); big = Math.max(big, s.x, s.z, s.y * 0.8); }
    const k = big > 0 ? FIT / big : 1;
    label(-3.2, 0.2, z, g.title, 'group');
    objs.forEach((o, i) => {
      const x = i * CELL;
      o.obj.scale.setScalar(k);
      const b = new THREE.Box3().setFromObject(o.obj);
      o.obj.position.set(x - (b.min.x + b.max.x) / 2, -b.min.y, z - (b.min.z + b.max.z) / 2);
      scene.add(o.obj);
      if (g.pack === 'mini-characters') playClip(o.key, o.obj, 'walk');
      const star = g.star.indexOf(o.n) >= 0;
      if (star) {
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1.45, 32), new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.55 }));
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(x, 0.02, z);
        scene.add(disc);
      }
      label(x, -0.05, z + 1.5, (star ? '★ ' : '') + o.n, star ? 'name star' : 'name');
      maxX = Math.max(maxX, x);
    });
    z += ROW;
  }

  // ── ряд анимаций: человечок игрока в каске ──
  const anims = [['idle', 'стоит'], ['walk', 'идёт'], ['sprint', 'бежит'], ['holding-both', 'несёт стопку'], ['pick-up', 'поднимает'], ['interact-right', 'работает']];
  label(-3.2, 0.2, z, 'Анимации (игрок в оранжевой каске, рабочий — в жёлтой)', 'group');
  const heroKey = 'mini-characters/character-male-e';
  const heroScale = (() => { const o = lib.clone(heroKey); if (!o) return 1; const s = size(o); return FIT / Math.max(s.x, s.z, s.y * 0.8); })();
  anims.forEach(([clip, ru], i) => {
    const o = lib.clone(heroKey);
    if (!o) return;
    o.scale.setScalar(heroScale);
    o.position.set(i * CELL, 0, z);
    addHelmet(o, 0xff8c1a);
    scene.add(o);
    playClip(heroKey, o, clip);
    label(i * CELL, -0.05, z + 1.5, ru + ' · ' + clip, 'name');
  });
  const wk = lib.clone('mini-characters/character-male-a');
  if (wk) {
    wk.scale.setScalar(heroScale);
    wk.position.set(anims.length * CELL, 0, z);
    addHelmet(wk, 0xffd43b);
    scene.add(wk);
    playClip('mini-characters/character-male-a', wk, 'walk');
    label(anims.length * CELL, -0.05, z + 1.5, 'рабочий в каске', 'name');
  }
  z += ROW;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(maxX + 40, z + 30), new THREE.MeshLambertMaterial({ color: 0x8fcf6b }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(maxX / 2, 0, z / 2 - 5);
  ground.receiveShadow = true;
  scene.add(ground);
  sun.target.position.set(maxX / 2, 0, z / 2);
  sun.position.set(maxX / 2 - 30, 60, z / 2 + 40);

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
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.zoom = clamp(cam.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.4, 3); }, { passive: false });
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
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const m of mixers) m.update(dt);
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
  window.__showcase = { lib, scene, cam };
})();
