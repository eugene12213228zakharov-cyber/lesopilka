'use strict';
// Графика: сцена Three.js по состоянию игры. Логику не меняет — только рисует.

const VIEW_R = 70;          // дальше этого от игрока содержимое куч не рисуем
const _mat = new THREE.Matrix4(), _quat = new THREE.Quaternion(), _pos = new THREE.Vector3(), _scl = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);
// полупрозрачные «призраки» того, что купится на площадке (общие на все площадки)
const GHOST_MAT = {};

// ───────── HTML-подписи над объектами ─────────
class Labels {
  constructor(root, camera) {
    this.root = root; this.cam = camera;
    this.map = new Map();
    this.v = new THREE.Vector3();
    this.w = 1; this.h = 1;
  }
  begin() { for (const l of this.map.values()) l.used = false; }
  set(key, x, y, z, html, cls) {
    let l = this.map.get(key);
    if (!l) {
      const el = document.createElement('div');
      el.className = 'lbl ' + (cls || '');
      this.root.appendChild(el);
      l = { el, html: null, cls };
      this.map.set(key, l);
    }
    l.used = true;
    if (l.html !== html) { l.el.innerHTML = html; l.html = html; }
    this.v.set(x, y, z).project(this.cam);
    const vis = this.v.z < 1 && this.v.x > -1.2 && this.v.x < 1.2 && this.v.y > -1.2 && this.v.y < 1.2;
    if (!vis) { l.el.style.display = 'none'; return; }
    l.el.style.display = '';
    const sx = (this.v.x * 0.5 + 0.5) * this.w, sy = (-this.v.y * 0.5 + 0.5) * this.h;
    l.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
  }
  end() {
    for (const [k, l] of this.map) if (!l.used) { l.el.remove(); this.map.delete(k); }
  }
  float(x, y, z, text, cls) {
    this.v.set(x, y, z).project(this.cam);
    if (this.v.z >= 1) return;
    const el = document.createElement('div');
    el.className = 'float ' + (cls || '');
    el.textContent = text;
    el.style.left = ((this.v.x * 0.5 + 0.5) * this.w) + 'px';
    el.style.top = ((-this.v.y * 0.5 + 0.5) * this.h) + 'px';
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }
}

// текстура площадки: пунктирная рамка
const PAD_TEX = {};
function padTexture(w, d, color, fill, solid) {
  const key = [w, d, color, fill, solid].join('|');
  if (PAD_TEX[key]) return PAD_TEX[key];
  const k = 64, cw = Math.max(16, Math.round(w * k)), ch = Math.max(16, Math.round(d * k));
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const x = cv.getContext('2d');
  const r = Math.min(cw, ch) * 0.16, lw = Math.max(5, k * 0.11);
  const rr = (p) => {
    x.beginPath();
    x.moveTo(p + r, p); x.lineTo(cw - p - r, p); x.quadraticCurveTo(cw - p, p, cw - p, p + r);
    x.lineTo(cw - p, ch - p - r); x.quadraticCurveTo(cw - p, ch - p, cw - p - r, ch - p);
    x.lineTo(p + r, ch - p); x.quadraticCurveTo(p, ch - p, p, ch - p - r);
    x.lineTo(p, p + r); x.quadraticCurveTo(p, p, p + r, p); x.closePath();
  };
  x.fillStyle = fill; rr(lw / 2); x.fill();
  x.strokeStyle = color; x.lineWidth = lw;
  if (!solid) x.setLineDash([lw * 2.2, lw * 1.4]);
  rr(lw / 2); x.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  PAD_TEX[key] = t;
  return t;
}

function groundText(text, size, color) {
  const cv = document.createElement('canvas');
  const fs = 96;
  const ctx = cv.getContext('2d');
  ctx.font = `900 ${fs}px Nunito, Segoe UI, sans-serif`;
  const tw = Math.ceil(ctx.measureText(text).width) + 20;
  cv.width = tw; cv.height = fs + 30;
  const c2 = cv.getContext('2d');
  c2.font = `900 ${fs}px Nunito, Segoe UI, sans-serif`;
  c2.fillStyle = color; c2.textBaseline = 'middle';
  c2.fillText(text, 10, cv.height / 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * tw / cv.height, size), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

function flatRect(x0, z0, x1, z1, color, y = 0.01) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), plainMaterial({ color, roughness: 0.95 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  m.receiveShadow = true;
  return m;
}

class View {
  constructor(canvas, game, labelsRoot) {
    this.g = game;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    lookRenderer(this.renderer);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(LOOK.fog);
    this.scene.fog = new THREE.Fog(LOOK.fog, 85, 175);
    this.fog0 = [this.scene.fog.near, this.scene.fog.far];   // облёт небоскрёба отодвигает туман и возвращает
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
    this.zoom = 1.15;
    this.labels = new Labels(labelsRoot, this.camera);
    this.t = 0;
    initMaterials();
    GHOST_MAT.st = plainMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false });
    GHOST_MAT.man = plainMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false });
    buildItemModels();
    this.K = !!window.LIB_OK;   // модели Kenney загрузились — ставим их, иначе наши из models.js
    this.O = !!window.OWN_OK;   // свои модели из craft.js (выключаются только ?nomodels)
    if (this.K || this.O) applyKenneyItems();
    this.setupLights();
    this.buildWorld();
    this.inst = {};
    this.ic = {};
    for (const id in ITEM_VIS) {
      const m = new THREE.InstancedMesh(ITEM_VIS[id].geo, MAT.flat, id === 'bill' ? 1500 : 3000);
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
      this.inst[id] = m;
    }
    this.stObjs = {}; this.propObjs = {}; this.padObjs = {}; this.pileObjs = {}; this.fenceObjs = {};
    this.launches = []; this.splashes = [];   // верфь: спущенные лодки и всплески на воде
    this.plotObjs = [];
    this.agentObjs = new Map();
    this.truckObjs = new Map();
    this.agentIds = new WeakMap(); this.nextAgentId = 1;
    this.flights = [];
    this.inflight = new Map();
    this.pops = [];
    this.falls = [];
    this.floatAcc = {};
    this.ver = -1;
    this.buildGoalMarkers();
    this.playerObj = this.charFor(game.pl);
    this.camTarget = new THREE.Vector3(game.pl.x, 0, game.pl.z);
    this.cx = game.pl.x; this.cz = game.pl.z;   // центр того, что рисуем подробно: куда смотрит камера
    // рабочие: номера над головой, пока открыт их список (UI ставит showTags); hl — подсвеченный из списка;
    // focus — камера на время показывает рабочего («📍» в списке)
    this.showTags = false; this.hl = null; this.focus = null;
    this.whyCache = new WeakMap();
    this.hlRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.86, 32), new THREE.MeshBasicMaterial({ color: 0x35d0ff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    this.hlRing.rotation.x = -Math.PI / 2;
    this.hlRing.visible = false;
    this.scene.add(this.hlRing);
    this.resize();
  }

  // показать рабочего: камера летит к нему и держит несколько секунд (или пока игрок не пошёл)
  focusOn(w) { this.focus = { a: w, t: 6 }; this.hl = w; this.hlT = 6; }
  // показать небоскрёб целиком: камера отъезжает на dur секунд и возвращается
  towerShot(dur = 3.2) { this.shot = { t: 0, dur }; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 55 : 40;
    this.camera.updateProjectionMatrix();
    this.labels.w = w; this.labels.h = h;
  }

  // солнце с тенью + отражения неба (look.js)
  setupLights() {
    lookEnvironment(this.renderer, this.scene);
    this.sun = lookSun(this.scene);
  }

  // трава вокруг: большой лоскут, пятна крупнее плитки текстуры — чтобы не было видно повторов
  grassField() {
    const W = 380, D = 340, geo = new THREE.PlaneGeometry(W, D, 95, 85);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    const n1 = lkNoise2(5), n2 = lkNoise2(6), c = new THREE.Color(), a = new THREE.Color(0xc9dca6), b = new THREE.Color(0xfff1c4);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const t = n1(x / 26 + 50, y / 26 + 50), dry = Math.max(0, n2(x / 14 + 9, y / 14 + 9) - 0.6) * 2.4;
      c.setRGB(1, 1, 1).lerp(a, 1 - t).lerp(b, dry * 0.7);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const gt = groundTexture('grass'), tex = gt.tex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(W / gt.m, D / gt.m);
    const m = new THREE.Mesh(geo, plainMaterial({ map: tex, vertexColors: true, roughness: 1 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(30, 0, 40);
    m.receiveShadow = true;
    return m;
  }

  // ───────── дороги ─────────
  // Главная (вдоль X, из западного тоннеля), береговая (на север, в северный тоннель); тротуары, аллея на юг (там была
  // южная дорога), дорожка к магазину, переходы, стоп-линии, светофор, бордюры. Раскладка — ROAD / LIGHT / CROSSINGS
  buildRoads(curb) {
    const sc = this.scene, R = ROAD, h = R.half, cx = R.coastX, tw = R.tunnelW, tn = R.tunnelN;
    const w1 = R.walk + R.walkW / 2;
    sc.add(groundPatch('asphalt', R.westX, -h, cx + h, h, 0.016));
    sc.add(groundPatch('asphalt', cx - h, tn.z1 + 4, cx + h, -h, 0.016));
    // тротуары вдоль главной с двух сторон, аллея на юг во всю бывшую дорогу, дорожка к входам магазина
    const walk = (x0, z0, x1, z1) => sc.add(groundPatch('walk', x0, z0, x1, z1, 0.03));
    walk(MAP.x0, h + 0.2, cx - h - 0.2, w1);
    walk(MAP.x0, -w1, cx - h - 0.2, -h - 0.2);
    walk(-w1, w1, w1, R.southZ);
    walk(w1, C4_ENTRY[0][1] - 1, C4_ENTRY[1][0] + 4, C4_ENTRY[0][1] + 1);
    // разметка: переходы-«зебры», стоп-линии, осевая (у светофора — сплошная)
    const paint = new Kit(41), white = 0xe9e6dc;
    const mark = (x, z, w, d) => paint.box(white, x, 0.022, z, w, 0.008, d, { b: 0 });
    for (const c of CROSSINGS) for (let k = -3; k <= 3; k++) mark(c.x, k * 0.82, 2.8, 0.44);
    for (const L of LIGHTS) {
      mark(L.stopE, h / 2, 0.3, h - 0.2);
      mark(L.stopW, -h / 2, 0.3, h - 0.2);
    }
    const crossX = CROSSINGS.map((c) => c.x);
    for (let x = tw.x + 2; x < cx - h - 2; x += 4) if (Math.abs(x) > 16 && crossX.every((c) => Math.abs(x - c) > 4)) mark(x, 0, 2, 0.14);
    for (const s of [-1, 1]) mark(s * 11.6, 0, 8.8, 0.14);
    for (let z = tn.z + 2; z < -h - 1; z += 4) mark(cx, z, 0.14, 2);
    const pm = paint.mesh({}, false);
    pm.receiveShadow = true;
    sc.add(pm);
    // бордюры по краю асфальта; на переходах и у перекрёстка — разрывы
    const cb = (x, z, w, d) => curb.box(0xd2cdc2, x, 0.07, z, w, 0.14, d, { surf: SURF.concrete, b: 0.03 });
    const gapped = (a0, a1, gaps, put) => {   // отрезки от a0 до a1 с разрывами [g0, g1]
      let a = a0;
      for (const [g0, g1] of gaps.slice().sort((p, q) => p[0] - q[0])) { if (g0 > a) put(a, Math.min(g0, a1)); a = Math.max(a, g1); }
      if (a < a1) put(a, a1);
    };
    const alongX = (z, x0, x1, gaps) => gapped(x0, x1, gaps, (a, b) => cb((a + b) / 2, z, b - a, 0.2));
    const alongZ = (x, z0, z1, gaps) => gapped(z0, z1, gaps, (a, b) => cb(x, (a + b) / 2, 0.2, b - a));
    const gx = crossX.map((c) => [c - 1.5, c + 1.5]);
    alongX(-h - 0.1, tw.x, cx - h - 0.1, gx);
    alongX(h + 0.1, tw.x, cx + h + 0.1, gx);
    alongZ(cx - h - 0.1, tn.z, -h - 0.1, []); alongZ(cx + h + 0.1, tn.z, h + 0.1, []);
    // светофоры: [x, z, светофор, машинная головка, куда смотрит, пешеходная, куда смотрит]
    const lamp = (on, map) => new THREE.MeshBasicMaterial({ color: on, map: map || null, toneMapped: false });
    const icon = [pedIconTexture(false), pedIconTexture(true)];
    const carSet = () => [lamp(0x3b1714), lamp(0x3b2c0e), lamp(0x0f3320)], pedSet = () => [lamp(0x3b1714, icon[0]), lamp(0x0f3320, icon[1])];
    this.lamps = {};
    for (const L of LIGHTS) this.lamps[L.id] = { car: carSet(), ped: pedSet() };
    const P2 = Math.PI / 2;
    const poles = [
      [-7.0, 3.8, 'c', 'car', -P2, 'ped', Math.PI], [-7.0, -3.8, 'c', null, 0, 'ped', 0],
      [7.0, -3.8, 'c', 'car', P2, 'ped', 0], [7.0, 3.8, 'c', null, 0, 'ped', Math.PI],
    ];
    for (const L of LIGHTS) if (L.id !== 'c') poles.push([L.stopE - 0.5, 3.8, L.id, 'car', -P2, 'ped', Math.PI], [L.stopW + 0.5, -3.8, L.id, 'car', P2, 'ped', 0]);
    for (const [x, z, id, car, cry, ped, pry] of poles) {
      const pole = ownLightPole(car ? 3.4 : 2.5);
      pole.position.set(x, 0, z);
      sc.add(pole);
      const head = (o, y, ry, mats) => {
        o.g.position.set(x + Math.sin(ry) * 0.2, y, z + Math.cos(ry) * 0.2);
        o.g.rotation.y = ry;
        o.lamps.forEach((m, i) => { m.material = mats[i]; });
        sc.add(o.g);
      };
      if (car) head(ownCarLightHead(), 2.95, cry, this.lamps[id][car]);
      head(ownPedLightHead(), 2.05, pry, this.lamps[id][ped]);
    }
    // знаки «Пешеходный переход» у «зебр» без светофора на главной — справа по ходу, лицом к машинам
    for (const c of CROSSINGS) {
      if (c.across !== 'z' || c.signal) continue;
      for (const [dx, z, ry] of [[-2.4, 4.1, -P2], [2.4, -4.1, P2]]) {
        const s = ownCrossSign();
        s.position.set(c.x + dx, 0, z); s.rotation.y = ry;
        sc.add(s);
      }
    }
    // тоннели: портал и холм над ним — машины въезжают и выезжают не из воздуха
    const pw = ownTunnelPortal();
    pw.position.set(tw.x, 0, 0); pw.rotation.y = Math.PI / 2;
    const hw = new THREE.Mesh(ownHillGeo(tw.z1 - tw.z0, tw.x - tw.x1, 8.5, 21), MAT.flat);
    hw.position.set(tw.x, 0, 0); hw.rotation.y = Math.PI / 2;
    const pn = ownTunnelPortal();
    pn.position.set(cx, 0, tn.z);
    const hn = new THREE.Mesh(ownHillGeo(tn.x1 - tn.x0, tn.z - tn.z1, 7, 22), MAT.flat);
    hn.position.set(cx, 0, tn.z);
    for (const m of [hw, hn]) { m.castShadow = true; m.receiveShadow = true; }
    sc.add(pw, hw, pn, hn);
  }

  // лампы светофоров по фазе (lightState в sim.js); мигающий зелёный — 3 раза в секунду
  syncLights() {
    if (!this.lamps) return;
    const blink = Math.floor(this.t * 6) % 2 === 0;
    const car = (mats, s) => {
      mats[0].color.setHex(s === 'r' ? 0xff3b2f : 0x3b1714);
      mats[1].color.setHex(s === 'y' ? 0xffb800 : 0x3b2c0e);
      mats[2].color.setHex(s === 'g' ? 0x32ff7e : 0x0f3320);
    };
    const ped = (mats, s) => {
      mats[0].color.setHex(s === 'r' ? 0xff4a3a : 0x3b1714);
      mats[1].color.setHex(s === 'g' || (s === 'gb' && blink) ? 0x3dff8a : 0x0f3320);
    };
    for (const id in this.lamps) {
      const st = this.g.lightState(id), L = this.lamps[id];
      car(L.car, st.car); ped(L.ped, st.walk);
    }
  }

  // ───────── неизменный мир ─────────
  buildWorld() {
    const sc = this.scene;
    sc.add(this.grassField());
    // покрытия зон: утоптанная земля с опилками, лесная почва, бетон цехов, плитка магазина, плиты порта
    const zoneKind = { z1: 'dirt', z2: 'forest', z3: 'concrete', z4: 'tiles', z5: 'concrete', z6: 'port', z7: 'port' };
    const curb = new Kit(31);
    for (const z of ZONES) {
      const r = z.rect;
      sc.add(groundPatch(zoneKind[z.id], r.x0, r.z0, r.x1, r.z1, 0.012));
      const txt = groundText(z.name.toUpperCase(), 2.2, 'rgba(0,0,0,0.16)');
      txt.position.set((r.x0 + r.x1) / 2, 0.02, z.labelTop ? r.z0 + 1.8 : r.z1 - 1.8);   // у бумажного цеха юг занят станками
      sc.add(txt);
      // бетонный бортик по краю зоны
      const cw = 0.22, ch = 0.1, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, w = r.x1 - r.x0, d = r.z1 - r.z0;
      curb.box(0xc2bdb2, cx, ch / 2, r.z0, w + cw, ch, cw, { surf: SURF.concrete, b: 0.03 });
      curb.box(0xc2bdb2, cx, ch / 2, r.z1, w + cw, ch, cw, { surf: SURF.concrete, b: 0.03 });
      curb.box(0xc2bdb2, r.x0, ch / 2, cz, cw, ch, d - cw, { surf: SURF.concrete, b: 0.03 });
      curb.box(0xc2bdb2, r.x1, ch / 2, cz, cw, ch, d - cw, { surf: SURF.concrete, b: 0.03 });
    }
    sc.add(groundPatch('gravel', -16, -40, 16, -8, 0.012));
    this.buildRoads(curb);
    sc.add(curb.mesh({}, false));
    // море и причал
    const sea = flatRect(MAP.seaX, -140, 260, 190, 0x2f7fb0, 0.03);
    sea.material = plainMaterial({ color: 0x2c78a8, roughness: 0.18, metalness: 0 });
    sc.add(sea);
    sc.add(flatRect(MAP.seaX - 3, -140, MAP.seaX, 190, 0xe8d7a8, 0.02));
    const pier = [B(0xa7794a, (PIER.x0 + PIER.x1) / 2, 0.2, (PIER.z0 + PIER.z1) / 2, PIER.x1 - PIER.x0, 0.2, PIER.z1 - PIER.z0)];
    for (let x = PIER.x0 + 1; x <= PIER.x1; x += 2.5) for (const z of [PIER.z0 + 0.3, PIER.z1 - 0.3]) pier.push(C(0x6d4128, x, 0.1, z, 0.18, 0.8));
    sc.add(meshOf(pier));
    // деревья вокруг карты
    const tg = mergeParts(treeParts(1.25));
    const spots = [];
    const rs = { s: 777 };
    for (let i = 0; i < 900 && spots.length < 260; i++) {
      const x = -130 + rngNext(rs) * 250, z = -80 + rngNext(rs) * 200;
      if (x > MAP.seaX - 4) continue;
      const inside = x > MAP.x0 - 3 && x < MAP.x1 && z > MAP.z0 - 3 && z < MAP.z1 + 3;
      if (inside) continue;
      if ((Math.abs(z) < 8 && x < MAP.x0) || (Math.abs(x) < 8 && z > MAP.z1)) continue;   // дороги за краем карты
      spots.push([x, z, 0.7 + rngNext(rs) * 0.7]);
    }
    if (this.K) { this.buildDecorK(spots); return; }
    // лесок вокруг карты (за её пределами — ходить не мешает)
    const trees = new THREE.InstancedMesh(tg, MAT.flat, spots.length);
    spots.forEach(([x, z, s], i) => { _mat.compose(_pos.set(x, 0, z), _quat.identity(), _scl.set(s, s, s)); trees.setMatrixAt(i, _mat); });
    trees.castShadow = true; trees.receiveShadow = true;
    sc.add(trees);
    _scl.set(1, 1, 1);
  }

  // одна модель Kenney много раз: места [x, z, поворот, масштаб]
  instK(key, fit, places, shadow = true) {
    const geo = fittedGeo(key, fit);
    if (!geo || !places.length) return null;
    const m = new THREE.InstancedMesh(geo, MAT.flat, places.length);
    places.forEach(([x, z, ry, s], i) => {
      _quat.setFromAxisAngle(_yAxis, ry || 0);
      _mat.compose(_pos.set(x, 0, z), _quat, _scl.set(s || 1, s || 1, s || 1));
      m.setMatrixAt(i, _mat);
    });
    _scl.set(1, 1, 1);
    m.castShadow = shadow; m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  // декор из моделей Kenney: деревья вокруг карты, заводские корпуса по краям, штабеля, контейнеры, камни
  buildDecorK(spots) {
    const rs = { s: 4242 };
    const r = () => rngNext(rs);
    const types = MODEL_OF.decorTrees;
    const byType = types.map(() => []);
    for (const [x, z, s] of spots) byType[Math.floor(r() * types.length)].push([x, z, r() * Math.PI * 2, s]);
    types.forEach((k, i) => this.instK(k, { size: [null, 4.6, null] }, byType[i]));
    // заводские корпуса за краями карты
    const bl = MODEL_OF.buildings;
    const south = [-66, -40, -14, 16, 44, 70].map((x, i) => [x, 92, Math.PI, 1, bl[i % bl.length]]);
    const west = [-30, 30, 58].map((z, i) => [-104, z, Math.PI / 2, 1, bl[(i + 2) % bl.length]]);
    const north = [-58, -34, 34, 58].map((x, i) => [x, -58, 0, 1, bl[(i + 4) % bl.length]]);
    for (const [x, z, ry, s, key] of south.concat(west, north)) {
      const m = kMesh(key, { size: [15, null, null], longX: true });
      if (m) { m.position.set(x, 0, z); m.rotation.y = ry; this.scene.add(m); }
    }
    const tall = MODEL_OF.tallDecor;
    const wt = kMesh(tall[0], { size: [null, 14, null] });
    if (wt) { wt.position.set(-96, 0, -36); this.scene.add(wt); }
    const ch = kMesh(tall[1], { size: [null, 16, null] });
    if (ch) { ch.position.set(84, 0, 96); this.scene.add(ch); }
    // штабеля брёвен у склада и на делянке, контейнеры в порту
    this.instK(MODEL_OF.logStack, { size: [3.2, null, null], longX: true }, [[-44.6, 6.8, Math.PI / 2], [-44.6, 15.5, Math.PI / 2], [-51.8, 44.5, 0]]);
    // контейнеры — в южной полосе порта (южнее — верфь)
    MODEL_OF.containers.forEach((k, i) => this.instK(k, { size: [6, null, null], longX: true }, [[60 + i * 7, 47, 0]]));
    // камни и кусты на траве — вне зон, дорог и площадок
    const free = (x, z) => {
      if (Math.abs(z) < 5 || (Math.abs(x) < 5 && z > 0)) return false;
      if (x > MAP.seaX - 4) return false;
      if (x > ROAD.coastX - 6 && z < 5) return false;               // береговая дорога
      if (x > ROAD.tunnelN.x0 - 3 && z < ROAD.tunnelN.z + 3) return false;   // холм северного тоннеля
      if (z > C4_ENTRY[0][1] - 2 && x > 2 && x < C4_ENTRY[1][0] + 6) return false;   // дорожка к магазину
      if (x > -18 && x < 18 && z > -42 && z < -6) return false;
      for (const zz of ZONES) { const q = zz.rect; if (x > q.x0 - 3 && x < q.x1 + 3 && z > q.z0 - 3 && z < q.z1 + 3) return false; }
      for (const p of PADS) if (p.gate && dist(x, z, p.x, p.z) < 5) return false;
      return x > MAP.x0 + 2 && x < MAP.x1 && z > MAP.z0 + 2 && z < MAP.z1 - 2;
    };
    const rocks = [], bushes = [];
    for (let i = 0; i < 700 && rocks.length + bushes.length < 70; i++) {
      const x = MAP.x0 + r() * (MAP.x1 - MAP.x0), z = MAP.z0 + r() * (MAP.z1 - MAP.z0);
      if (!free(x, z)) continue;
      (r() < 0.4 ? rocks : bushes).push([x, z, r() * Math.PI * 2, 0.6 + r() * 0.7]);
    }
    this.instK(MODEL_OF.rock, { size: [2.2, null, null] }, rocks);
    this.instK(MODEL_OF.bush, { size: [1.6, null, null] }, bushes);
  }

  // забор закрытой зоны из секций забора Kenney
  fenceK(r) {
    const seg = fittedGeo(MODEL_OF.fence, { size: [2, null, null], longX: true });
    if (!seg) return null;
    const list = [];
    const put = (x, z, ry) => { const g = seg.clone(); g.rotateY(ry); g.translate(x, 0, z); list.push(g); };
    for (let x = r.x0 + 1; x < r.x1; x += 2) { put(x, r.z0, 0); put(x, r.z1, 0); }
    for (let z = r.z0 + 1; z < r.z1; z += 2) { put(r.x0, z, Math.PI / 2); put(r.x1, z, Math.PI / 2); }
    const m = new THREE.Mesh(concatGeos(list), MAT.flat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  buildGoalMarkers() {
    const arrow = meshOf([B(0xffd43b, 0, 0.05, 0.9, 0.34, 0.06, 1.2), P('cone6', 0xffd43b, 0, 0.05, 1.8, 0.5, 0.7, 0.18, Math.PI / 2, 0, 0)], true, false);
    arrow.visible = false;
    this.scene.add(arrow);
    this.goalArrow = arrow;
    const mark = meshOf([P('cone6', 0xffd43b, 0, 0, 0, 0.45, 0.9, 0.45, Math.PI, 0, 0)], true, false);
    mark.visible = false;
    this.scene.add(mark);
    this.goalMark = mark;
  }

  agentId(a) { let id = this.agentIds.get(a); if (!id) { id = this.nextAgentId++; this.agentIds.set(a, id); } return id; }

  charFor(a) {
    let o = this.agentObjs.get(a);
    if (!o) {
      const style = a.kind === 'player' ? 'player' : a.kind === 'worker' ? 'worker' : 'cust';
      const pad = a.kind === 'worker' && PAD_BY_ID[a.pad], helmet = pad ? helmetColor(workerZone(pad)) : null;   // каска цвета зоны
      o = (this.K && makeCharacterK(style, style === 'player' ? 0 : (a.look || 0), helmet)) || buildCharacter(style, a.look || 0, helmet);
      o.phase = 0;
      o.g.position.set(a.x, 0, a.z);
      o.g.rotation.order = 'YXZ';   // наклон (сбила машина) — в своей системе, после поворота
      o.g.rotation.y = a.face || 0;
      this.scene.add(o.g);
      this.agentObjs.set(a, o);
    }
    return o;
  }

  pop(obj, delay = 0) { obj.scale.setScalar(0.01); this.pops.push({ obj, t: -delay }); }

  // ───────── пересборка сцены после покупок ─────────
  syncStatic() {
    const g = this.g;
    if (this.ver === g.version) return;
    const first = this.ver < 0;
    this.ver = g.version;
    // станки
    for (const id in STATIONS) {
      const on = g.stationOn(id);
      if (on && !this.stObjs[id]) {
        const st = STATIONS[id], o = (this.K || this.O) ? buildStationK(st.type, id) : buildStation(st.type);
        o.g.position.set(st.x, 0, st.z);
        this.scene.add(o.g);
        this.stObjs[id] = o;
        if (!first) this.pop(o.g);
      } else if (!on && this.stObjs[id]) { this.scene.remove(this.stObjs[id].g); delete this.stObjs[id]; }
    }
    // декорации
    PROPS.forEach((pr) => {
      const on = g.propOn(pr);
      if (on && !this.propObjs[pr.id]) {
        const o = (this.K || this.O) ? buildPropK(pr.type) : buildProp(pr.type);
        o.g.position.set(pr.x, 0, pr.z);
        this.scene.add(o.g);
        this.propObjs[pr.id] = o;
        if (!first && pr.type !== 'tower') this.pop(o.g);
      } else if (!on && this.propObjs[pr.id]) { this.scene.remove(this.propObjs[pr.id].g); delete this.propObjs[pr.id]; }
    });
    for (const id of ['trash1', 'trash3']) {
      if (g.pileSet.has(id) && !this.propObjs[id]) {
        const o = (this.K || this.O) ? buildPropK('trash') : buildProp('trash'), p = PILES[id];
        o.g.position.set(p.x, 0, p.z - 1.8);
        this.scene.add(o.g);
        this.propObjs[id] = o;
      }
    }
    // площадки куч
    for (const id in PILES) {
      // кучки опилок до бумажного цеха — просто мешки, без площадки (взять их пока нельзя)
      const on = g.pileSet.has(id) && (!PILES[id].pickZone || g.open[PILES[id].pickZone]);
      if (on && !this.pileObjs[id]) {
        const p = PILES[id];
        // разметка на полу: взять — зелёная, положить — синяя, касса — жёлтая
        let color = this.O ? '#46a060' : '#2fa35a', fill = this.O ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.28)';
        if (p.mode === 'drop') color = this.O ? '#4a86c4' : '#2f7fd0';
        if (p.money) { color = '#e5a91c'; fill = 'rgba(255,230,120,0.3)'; }
        if (p.site) { color = '#f08a24'; fill = 'rgba(255,200,120,0.3)'; }
        if (p.trash) color = '#7f8c8d';
        if (p.dock) color = '#16a085';
        const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), new THREE.MeshBasicMaterial({ map: padTexture(p.w, p.d, color, fill, false), transparent: true, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(p.x, 0.03 + (p.y || 0), p.z);
        this.scene.add(m);
        this.pileObjs[id] = m;
      } else if (!on && this.pileObjs[id]) { this.scene.remove(this.pileObjs[id]); delete this.pileObjs[id]; }
    }
    // площадки покупок
    for (const p of PADS) {
      const vis = g.padVisible(p);
      if (vis && !this.padObjs[p.id]) {
        const grp = new THREE.Group();
        grp.position.set(p.x, 0, p.z);
        // площадка покупки: жёлтая рамка (участок — красная) по тёмной заливке, как разметка на полу цеха
        const padFill = this.O ? 'rgba(24,26,28,0.42)' : 'rgba(255,255,255,0.8)';
        const base = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), new THREE.MeshBasicMaterial({ map: padTexture(p.w, p.d, p.gate ? '#e0503c' : '#f2b31a', padFill, true), transparent: true, depthWrite: false, toneMapped: false }));
        base.rotation.x = -Math.PI / 2; base.position.y = 0.04;
        grp.add(base);
        const fill = new THREE.Mesh(new THREE.PlaneGeometry(p.w - 0.3, p.d - 0.3), new THREE.MeshBasicMaterial({ color: this.O ? 0x49a25c : 0x4caf50, transparent: true, opacity: 0.72, depthWrite: false, toneMapped: false }));
        fill.rotation.x = -Math.PI / 2; fill.position.y = 0.05;
        grp.add(fill);
        // «призрак» того, что купится
        if (p.station) {
          const type = STATIONS[p.station].type;
          const ghost = ((this.K || this.O) ? buildStationK(type, p.station) : buildStation(type)).g;
          ghost.traverse((c) => { if (c.isMesh) { c.material = GHOST_MAT.st; c.castShadow = false; } });
          grp.add(ghost);
        } else if (p.worker) {
          const ch = ((this.K && makeCharacterK('worker', PADS.indexOf(p))) || buildCharacter('worker')).g;
          ch.traverse((c) => { if (c.isMesh) { c.material = GHOST_MAT.man; c.castShadow = false; } });
          grp.add(ch);
        }
        this.scene.add(grp);
        this.padObjs[p.id] = { grp, fill };
        if (!first) this.pop(grp, 0.15);
      } else if (!vis && this.padObjs[p.id]) { this.scene.remove(this.padObjs[p.id].grp); delete this.padObjs[p.id]; }
    }
    // заборы закрытых зон
    for (const z of ZONES) {
      const locked = !g.open[z.id];
      if (locked && !this.fenceObjs[z.id]) {
        const r = z.rect, parts = [];
        const post = (x, zz) => parts.push(B(0xf4f4f4, x, 0.6, zz, 0.16, 1.2, 0.16));
        for (let x = r.x0; x <= r.x1 + 0.01; x += 2) { post(x, r.z0); post(x, r.z1); }
        for (let zz = r.z0 + 2; zz < r.z1; zz += 2) { post(r.x0, zz); post(r.x1, zz); }
        const w = r.x1 - r.x0, d = r.z1 - r.z0;
        for (const y of [0.45, 0.95]) {
          parts.push(B(COL.red, (r.x0 + r.x1) / 2, y, r.z0, w, 0.12, 0.08), B(COL.red, (r.x0 + r.x1) / 2, y, r.z1, w, 0.12, 0.08));
          parts.push(B(COL.red, r.x0, y, (r.z0 + r.z1) / 2, 0.08, 0.12, d), B(COL.red, r.x1, y, (r.z0 + r.z1) / 2, 0.08, 0.12, d));
        }
        const grp = new THREE.Group();
        grp.add((this.K && this.fenceK(r)) || meshOf(parts, true, true));
        const shade = flatRect(r.x0, r.z0, r.x1, r.z1, 0x000000, 0.025);
        shade.material = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false });
        grp.add(shade);
        this.scene.add(grp);
        this.fenceObjs[z.id] = grp;
      } else if (!locked && this.fenceObjs[z.id]) {
        this.scene.remove(this.fenceObjs[z.id]);
        delete this.fenceObjs[z.id];
      }
    }
    // делянка
    if (!this.plotObjs.length) {
      const soil = mergeParts([C(0x6b4a2b, 0, 0.02, 0, 1.0, 0.04, 0, 0, 0, 'cyl20')]);
      const tree = (this.K && fittedGeo(MODEL_OF.tree, { size: [null, 3.9, null] })) || mergeParts(treeParts(1));
      const stump = (this.K && fittedGeo(MODEL_OF.stump, { size: [0.75, null, null] })) || mergeParts([C(0x8b5a2b, 0, 0.15, 0, 0.2, 0.3), C(0xd9a86c, 0, 0.301, 0, 0.18, 0.004)]);
      // на пне — полупрозрачный саженец: видно, что сюда надо встать и посадить новое дерево
      const sprout = mergeParts(treeParts(0.4));
      const sproutMat = new THREE.MeshBasicMaterial({ color: 0x8fe07a, transparent: true, opacity: 0.55, depthWrite: false });
      for (let i = 0; i < PLOTS.length; i++) {
        const q = PLOTS[i], grp = new THREE.Group();
        grp.position.set(q.x, 0, q.z);
        const s = new THREE.Mesh(soil, MAT.flat); s.receiveShadow = true;
        const t = new THREE.Mesh(tree, MAT.flat); t.castShadow = true;
        const st = new THREE.Mesh(stump, MAT.flat); st.castShadow = true;
        const sp = new THREE.Mesh(sprout, sproutMat); sp.position.y = 0.3;
        grp.add(s, t, st, sp);
        grp.visible = false;
        this.scene.add(grp);
        this.plotObjs.push({ grp, tree: t, stump: st, sprout: sp });
      }
    }
  }

  // ───────── раскладка предметов ─────────
  pileTypes(id) {
    const p = PILES[id], g = this.g;
    if (p.site) return Object.keys(FLOORS[g.s.floor] ? FLOORS[g.s.floor].need : {});
    if (p.dock) return g.s.ship && g.s.ship.need ? Object.keys(g.s.ship.need) : [];
    if (p.shelf) return SHELF_ITEMS[id];
    return p.accepts ? Object.keys(p.accepts) : [];
  }

  pileCounts(id) {
    const p = PILES[id], g = this.g;
    if (p.site) return g.s.floorGot;
    if (p.dock) return g.s.ship && g.s.ship.got ? g.s.ship.got : {};
    return g.s.piles[id] || {};
  }

  // позиция idx-го предмета it на куче id → записывает в out {x,y,z,ry}; false — не показываем
  pileSlot(id, it, idx, out) {
    const p = PILES[id], types = this.pileTypes(id);
    const k = Math.max(1, types.length), ti = Math.max(0, types.indexOf(it));
    const vis = ITEM_VIS[it];
    if (p.shelf) {
      const counts = this.pileCounts(id);
      let off = 0;
      for (let i = 0; i < ti; i++) off += counts[types[i]] || 0;
      const slot = off + idx, n = Math.max(1, Math.floor(4.1 / (vis.fw + 0.08)));
      const shelf = Math.floor(slot / n);
      if (shelf > 2) return false;
      out.x = p.x - 2.05 + ((slot % n) + 0.5) * (4.1 / n);
      out.y = [0.34, 0.99, 1.64][shelf];
      out.z = 54; out.ry = 0;
      return true;
    }
    const along = p.w >= p.d;
    const aw = along ? p.w / k : p.w, ad = along ? p.d : p.d / k;
    const acx = along ? p.x - p.w / 2 + aw * (ti + 0.5) : p.x;
    const acz = along ? p.z : p.z - p.d / 2 + ad * (ti + 0.5);
    let fw = vis.fw, fd = vis.fd, ry = 0;
    if (fw > aw - 0.1 && fd < fw) { const t = fw; fw = fd; fd = t; ry = Math.PI / 2; }
    const gap = 0.05;
    const nx = Math.max(1, Math.floor((aw - 0.2 + gap) / (fw + gap)));
    const nz = Math.max(1, Math.floor((ad - 0.2 + gap) / (fd + gap)));
    const per = nx * nz, maxH = clamp(Math.floor(2.2 / vis.h), 4, 18);
    const layer = Math.floor(idx / per);
    if (layer >= maxH) return false;
    const r = idx % per, ix = r % nx, iz = Math.floor(r / nx);
    out.x = acx + (ix - (nx - 1) / 2) * (fw + gap);
    out.z = acz + (iz - (nz - 1) / 2) * (fd + gap);
    out.y = 0.04 + (p.y || 0) + layer * vis.h;
    out.ry = ry;
    if (this.O) {   // живой штабель: каждый предмет чуть сдвинут и повёрнут (всегда одинаково для своего места)
      const h = Math.sin((idx + 1) * 12.9898 + ti * 78.233 + p.x * 3.17 + p.z * 1.31) * 43758.5453, j = h - Math.floor(h);
      out.x += (j - 0.5) * 0.045;
      out.z += (((j * 7.31) % 1) - 0.5) * 0.045;
      out.ry += (((j * 13.7) % 1) - 0.5) * 0.07;
    }
    return true;
  }

  // позиция idx-го предмета в руках у агента
  stackBase(a) {
    const o = this.agentObjs.get(a);
    const x = o ? o.g.position.x : a.x, z = o ? o.g.position.z : a.z, f = o ? o.g.rotation.y : a.face;
    const fwd = o && o.stackFwd ? o.stackFwd : 0.5;
    return { x: x + Math.sin(f) * fwd, z: z + Math.cos(f) * fwd, f, y: o && o.stackY ? o.stackY : 1.02 };
  }
  stackSlot(a, idx, out) {
    const b = this.stackBase(a);
    let y = b.y;
    const st = a.stack;
    for (let i = 0; i < idx && i < st.length; i++) y += ITEM_VIS[st[i]].h * 0.92;
    out.x = b.x; out.z = b.z; out.y = y; out.ry = b.f;
    return true;
  }

  addInst(it, x, y, z, ry, s = 1) {
    const m = this.inst[it];
    const n = this.ic[it] || 0;
    if (n >= m.instanceMatrix.count) return;
    _quat.setFromAxisAngle(_yAxis, ry);
    _mat.compose(_pos.set(x, y, z), _quat, _scl.set(s, s, s));
    m.setMatrixAt(n, _mat);
    this.ic[it] = n + 1;
  }

  // ───────── полёты предметов ─────────
  endpoint(ref, it, slot, out) {
    if (ref.a) return this.stackSlot(ref.a, slot, out);
    if (ref.p) {
      const p = PILES[ref.p];
      if (p.money) { out.x = p.x; out.y = 0.3; out.z = p.z; out.ry = 0; return true; }
      if (p.trash) { out.x = p.x; out.y = 0.9; out.z = p.z - 1.8; out.ry = 0; return true; }
      if (!this.pileSlot(ref.p, it, slot, out)) { out.x = p.x; out.y = 1.4; out.z = p.z; out.ry = 0; }
      return true;
    }
    if (ref.tr) { out.x = ref.tr.x - 0.7 * ref.tr.dx; out.y = 1.3; out.z = ref.tr.z - 0.7 * ref.tr.dz; out.ry = ref.tr.face || 0; return true; }
    if (ref.loose) { out.x = ref.loose.x; out.y = 0.03; out.z = ref.loose.z; out.ry = ref.loose.ry; return true; }
    if (ref.tree !== undefined) { const q = PLOTS[ref.tree]; out.x = q.x; out.y = 1.2; out.z = q.z; out.ry = 0; return true; }
    if (ref.ship) { out.x = this.shipX || SHIP_DOCK[0]; out.y = 2.4; out.z = SHIP_DOCK[1]; out.ry = 0; return true; }
    if (ref.belt !== undefined) { const o = {}; roadAt(BELT_PATH, ref.belt, o); out.x = o.x; out.y = 0.5; out.z = o.z; out.ry = 0; return true; }
    return false;
  }

  // ───────── конвейер в порт ─────────
  // Рама, лента с жёлтыми бортами, ножки — одной сеткой; поперечные планки ленты едут с её скоростью
  buildBelt() {
    const P = BELT_PATH, w = BELT.half * 2, parts = [];
    for (let i = 0; i < P.pts.length - 1; i++) {
      const a = P.pts[i], b = P.pts[i + 1], alongX = Math.abs(a[1] - b[1]) < 1e-6;
      const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2, L = P.cum[i + 1] - P.cum[i] + w;   // с запасом — углы без щелей
      const box = (color, y, h, across, off = 0) => parts.push(alongX ? B(color, cx, y, cz + off, L, h, across) : B(color, cx + off, y, cz, across, h, L));
      box(0x8d959c, 0.27, 0.3, w + 0.1);           // рама
      box(0x2a2d30, 0.43, 0.03, w - 0.1);          // лента
      box(0xf2b31a, 0.47, 0.07, 0.07, -w / 2);     // борта
      box(0xf2b31a, 0.47, 0.07, 0.07, w / 2);
      const n = Math.max(1, Math.floor(L / 2.5));
      for (let k = 0; k <= n; k++) {                // ножки
        const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        for (const s of [-1, 1]) parts.push(B(0x5d646b, x + (alongX ? 0 : s * 0.45), 0.06, z + (alongX ? s * 0.45 : 0), 0.12, 0.12, 0.12));
      }
    }
    const g = new THREE.Group();
    g.add(meshOf(parts, true, true));
    const n = Math.ceil(P.len / 1.2) + 1;
    this.beltCleats = new THREE.InstancedMesh(mergeParts([B(0xb9c0c7, 0, 0, 0, 1, 1, 1)]), MAT.flat, n);
    this.beltCleats.frustumCulled = false;
    this.beltCleats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    g.add(this.beltCleats);
    this.scene.add(g);
    this.beltObj = g;
    this.pop(g);
  }

  syncBelt(near) {
    const g = this.g;
    if (!g.s.padDone.p_belt) { if (this.beltObj) { this.scene.remove(this.beltObj); this.beltObj = null; } return; }
    if (!this.beltObj) this.buildBelt();
    const P = BELT_PATH, v = g.uv('u_belt'), step = 1.2, tmp = {};
    let k = 0;
    for (let d = (this.t * v) % step; d < P.len; d += step) {
      roadAt(P, d, tmp);
      _quat.setFromAxisAngle(_yAxis, Math.atan2(-tmp.dz, tmp.dx));
      _mat.compose(_pos.set(tmp.x, 0.455, tmp.z), _quat, _scl.set(0.12, 0.02, BELT.half * 2 - 0.2));
      this.beltCleats.setMatrixAt(k++, _mat);
    }
    _scl.set(1, 1, 1);
    this.beltCleats.count = k;
    this.beltCleats.instanceMatrix.needsUpdate = true;
    // коробки на ленте
    const o = {};
    for (const e of g.s.belt) {
      roadAt(P, e.d, o);
      if (near(o.x, o.z)) this.addInst(e.it, o.x, 0.46, o.z, Math.atan2(-o.dz, o.dx));
    }
  }

  dstKey(ref, it) {
    if (ref.a) return 'a' + this.agentId(ref.a);
    if (ref.p) return 'p' + ref.p + ':' + it;
    return null;
  }

  onEvent(e) {
    const g = this.g;
    if (e.t === 'x') {
      if (this.flights.length > 400) return;
      const near = (ref) => {
        if (ref.a) return dist(ref.a.x, ref.a.z, g.pl.x, g.pl.z) < VIEW_R;
        if (ref.p) return dist(PILES[ref.p].x, PILES[ref.p].z, g.pl.x, g.pl.z) < VIEW_R;
        return true;
      };
      if (!near(e.to) && !near(e.from)) return;
      const from = {};
      let fromSlot = 0;
      if (e.from.a) fromSlot = e.from.i !== undefined ? e.from.i : e.from.a.stack.length;
      else if (e.from.p) fromSlot = this.pileCounts(e.from.p)[e.it] || 0;
      if (!this.endpoint(e.from, e.it, fromSlot, from)) return;
      let slot = 0;
      if (e.to.a) slot = e.to.a.stack.length - 1;
      else if (e.to.p) slot = Math.max(0, (this.pileCounts(e.to.p)[e.it] || 1) - 1);
      const key = this.dstKey(e.to, e.it);
      if (key) this.inflight.set(key, (this.inflight.get(key) || 0) + 1);
      this.flights.push({ it: e.it, from, to: e.to, slot, key, t: 0, dur: e.to.a && e.to.a.kind === 'player' ? 0.2 : 0.26 });
    } else if (e.t === 'm' || e.t === 'pay') {
      const n = e.t === 'pay' ? 1 : Math.min(8, 2 + Math.floor(Math.log10(Math.max(1, e.v))));
      for (let i = 0; i < n; i++) {
        const from = {}, to = {};
        if (e.t === 'pay') {
          this.endpoint({ a: g.pl }, 'bill', 0, from); from.y = 1.4;
          const p = PAD_BY_ID[e.pad]; to.x = p.x; to.y = 0.1; to.z = p.z;
        } else {
          if (e.from.p) { const p = PILES[e.from.p]; from.x = p.x; from.y = 0.3; from.z = p.z; } else { from.x = e.from.a.x; from.y = 1.2; from.z = e.from.a.z; }
          if (e.to.p) { const p = PILES[e.to.p]; to.x = p.x; to.y = 0.3; to.z = p.z; } else { to.x = e.to.a.x; to.y = 1.4; to.z = e.to.a.z; }
          if (dist(from.x, from.z, g.pl.x, g.pl.z) > VIEW_R) return;
        }
        this.flights.push({ it: 'bill', from, toFixed: to, t: -i * 0.04, dur: 0.3 });
      }
    } else if (e.t === 'launch') {
      this.launchBoat(e.st);
    } else if (e.t === 'sell') {
      if (dist(e.x, e.z, g.pl.x, g.pl.z) > 40) return;
      const k = e.pile;
      const a = this.floatAcc[k] || (this.floatAcc[k] = { v: 0, t: 0, x: e.x, z: e.z });
      a.v += e.v; a.x = e.x; a.z = e.z;
    } else if (e.t === 'fell') {
      const o = this.plotObjs[e.i];
      if (o) {
        const clone = o.tree.clone();
        clone.position.set(PLOTS[e.i].x, 0, PLOTS[e.i].z);
        this.scene.add(clone);
        this.falls.push({ obj: clone, t: 0, dir: Math.random() * Math.PI * 2 });
      }
    } else if (e.t === 'hire') {
      const o = this.charFor(e.w);
      this.pop(o.g);
    } else if (e.t === 'floor') {
      this.towerShot(3.2);   // этаж достроен — покажем небоскрёб целиком
    } else if (e.t === 'hit') {
      this.shake = 0.45;   // сбила машина — встряхнуть камеру
    }
  }

  // ───────── кадр ─────────
  frame(dt) {
    const g = this.g, s = g.s, pl = g.pl;
    this.t += dt;
    this.syncStatic();
    for (const id in this.inst) this.ic[id] = 0;
    this.labels.begin();
    // подробно рисуем вокруг камеры: обычно она у игрока, но «показать рабочего» уводит её к нему, облёт — к небоскрёбу
    this.cx = this.camTarget.x; this.cz = this.camTarget.z;
    if (this.shot && this.shot.t > 0.35 && this.shot.t < this.shot.dur - 0.35) {
      const tw = PROPS.find((p) => p.id === 'tower');
      this.cx = tw.x; this.cz = tw.z;
    }
    const cx = this.cx, cz = this.cz;
    const near = (x, z, r = VIEW_R) => Math.abs(x - cx) < r && Math.abs(z - cz) < r;
    const tmp = {};

    // станки и декорации
    for (const id in this.stObjs) {
      const ss = s.st[id];
      this.stObjs[id].anim(this.t, !!(ss && ss.cur >= 0), ss);   // стапелю нужен и ход постройки (ss.prog)
    }
    for (const id in this.propObjs) {
      const o = this.propObjs[id];
      if (id === 'pcrane') o.anim(this.t, s.ship && s.ship.state === 'docked' && g.count('pwh', g.firstItem('pwh') || 'x') > 0);
      else if (id === 'compressor') o.anim(this.t, true);
      else o.anim(this.t, true);
    }
    this.syncTower();

    // кучи
    for (const id of g.pilesOn) {
      const p = PILES[id];
      if (!near(p.x, p.z)) continue;
      if (p.money) {
        const v = s.cash[id] || 0;
        const n = v > 0 ? Math.min(54, Math.ceil(Math.sqrt(v) / 1.6)) : 0;
        for (let i = 0; i < n; i++) {
          const col = i % 6, layer = Math.floor(i / 6);
          this.addInst('bill', p.x - 0.45 + (col % 3) * 0.45, 0.04 + layer * 0.045, p.z - 0.25 + Math.floor(col / 3) * 0.5, 0);
        }
        if (v > 0) this.labels.set('cash' + id, p.x, 0.9 + Math.min(n / 6, 9) * 0.045, p.z, fmtMoney(v), 'money');
        continue;
      }
      const counts = this.pileCounts(id);
      for (const it of this.pileTypes(id)) {
        const c = (counts[it] || 0) - (this.inflight.get('p' + id + ':' + it) || 0);
        for (let i = 0; i < c; i++) {
          if (!this.pileSlot(id, it, i, tmp)) break;
          this.addInst(it, tmp.x, tmp.y, tmp.z, tmp.ry);
        }
      }
    }
    this.pileLabels();

    // агенты
    this.syncAgent(pl, dt);
    for (const w of g.workers) this.syncAgent(w, dt);
    const seen = new Set([pl, ...g.workers]);
    for (const c of g.cust) { this.syncAgent(c, dt); seen.add(c); }
    for (const [a, o] of this.agentObjs) if (!seen.has(a)) { this.scene.remove(o.g); this.agentObjs.delete(a); }
    this.workerLabels(dt);

    // машины
    const tseen = new Set();
    for (const tr of g.trucks) {
      tseen.add(tr);
      let o = this.truckObjs.get(tr);
      if (!o) { o = (this.K || this.O) ? buildTruckK(tr.kind) : buildTruck(tr.kind); this.scene.add(o); this.truckObjs.set(tr, o); }
      o.position.set(tr.x, 0, tr.z);
      o.rotation.y = tr.face || 0;
      if (tr.kind === 'log' && near(tr.x, tr.z)) {
        // брёвна на кониках: локально −0.7 м от центра машины, рядами поперёк
        for (let i = 0; i < Math.min(tr.load, 21); i++) {
          const layer = Math.floor(i / 7), k = i % 7, lx = -0.7, lz = -0.9 + k * 0.3 - (layer % 2) * 0.1;
          this.addInst('log', tr.x + lx * tr.dx - lz * tr.dz, 1.0 + layer * 0.34, tr.z + lx * tr.dz + lz * tr.dx, tr.face || 0, 1);
        }
      }
    }
    for (const [tr, o] of this.truckObjs) if (!tseen.has(tr)) { this.scene.remove(o); this.truckObjs.delete(tr); }

    // рассыпанное: сначала летит по дуге от игрока, потом лежит; перед тем как пропасть — мигает
    for (const l of g.loose) {
      if (l.t < 0 || !near(l.x, l.z)) continue;
      const k = Math.min(1, l.t / 0.55), life = TUNE.looseLife - l.t;
      if (life < 6 && Math.floor(this.t * 5) % 2 === 0) continue;
      const x = lerp(l.x0, l.x, k), z = lerp(l.z0, l.z, k), y = lerp(l.y0, 0.03, k) + Math.sin(Math.PI * k) * 1.1 * (1 - k * 0.3);
      this.addInst(l.it, x, y, z, l.ry + (1 - k) * 5);
    }
    this.syncLights();
    this.syncBelt(near);

    this.syncShip();
    this.syncShipyard(dt);
    this.syncPlots();
    this.syncFlights(dt);
    this.syncPads();
    this.syncEffects(dt);
    this.syncGoal();

    for (const id in this.inst) { const m = this.inst[id]; m.count = this.ic[id]; m.instanceMatrix.needsUpdate = true; }

    // камера и солнце: за игроком, а на время «показать рабочего» — за ним (пошёл игрок — камера вернулась)
    if (this.focus && (pl.moving || (this.focus.t -= dt) <= 0 || g.workers.indexOf(this.focus.a) < 0)) this.focus = null;
    const fo = this.focus && this.agentObjs.get(this.focus.a);
    const po = fo ? fo.g.position : this.playerObj.g.position;
    this.camTarget.lerp(_pos.set(po.x, 0, po.z), 1 - Math.exp(-(fo ? 5 : 8) * dt));
    const ct = this.camTarget, z = this.zoom;
    this.camera.position.set(ct.x, 19 * z, ct.z + 15 * z);
    this.camera.lookAt(ct.x, 0.6, ct.z + 0.5);
    // облёт небоскрёба: игровая камера смотрит вниз с ~22 м — выше неё небоскрёб и кран не видны никогда.
    // Достроен этаж (или кнопка в «Небоскрёбе») — на пару секунд отъезжаем, чтобы он был виден целиком
    if (this.shot) {
      const sh = this.shot;
      sh.t += dt;
      const k = Math.min(1, sh.t / 0.7, (sh.dur - sh.t) / 0.7), e = k <= 0 ? 0 : k * k * (3 - 2 * k);
      this.labels.root.classList.toggle('hide', sh.t < sh.dur && e > 0.3);   // подписи у игрока — не поверх небоскрёба
      if (sh.t >= sh.dur) { this.shot = null; this.scene.fog.near = this.fog0[0]; this.scene.fog.far = this.fog0[1]; }
      else {
        // в кадре — весь небоскрёб с краном: верх крана на 12.5 м выше последнего этажа, мачта в 11.5 м сбоку.
        // Отъезд — по углу обзора камеры: по высоте и по ширине (на телефоне стоймя кадр узкий); камера чуть выше
        // середины (наклон 0.1), +8 м — ближняя к камере половина небоскрёба
        const tw = PROPS.find((p) => p.id === 'tower'), T = 0.6 + g.s.floor * 3 + 12.5, cx = tw.x + 2.5;
        const tv = Math.tan(this.camera.fov * Math.PI / 360), up = Math.tan(Math.atan(tv) - Math.atan(0.1));
        const D = Math.max((T / 2 + 2.5) / (up + 0.1), 12.5 / (tv * this.camera.aspect)) + 8;
        this.camera.position.lerp(_pos.set(cx + D * 0.3, T / 2 + D * 0.1, tw.z + D * 0.954), e);
        this.camera.lookAt(new THREE.Vector3(ct.x, 0.6, ct.z + 0.5).lerp(new THREE.Vector3(cx, T / 2, tw.z), e));
        // туман отъезжает вместе с камерой, иначе высокий небоскрёб издалека выцветает
        const push = e * Math.max(0, D - 60);
        this.scene.fog.near = this.fog0[0] + push; this.scene.fog.far = this.fog0[1] + push;
      }
    }
    if (this.shake > 0) {
      this.shake -= dt;
      const a = Math.max(0, this.shake) * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
    }
    lookSunAt(this.sun, ct.x, ct.z);
    this.labels.end();
    this.renderer.render(this.scene, this.camera);
  }

  syncAgent(a, dt) {
    const o = this.charFor(a);
    const gp = o.g.position;
    const k = 1 - Math.exp(-20 * dt);
    gp.x += (a.x - gp.x) * k; gp.z += (a.z - gp.z) * k;
    // плавный поворот
    let d = (a.face || 0) - o.g.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    o.g.rotation.y += d * (1 - Math.exp(-14 * dt));
    // сбила машина: падает на спину, лежит, встаёт
    if (a.stun > 0) {
      const T = a.stun0 || 1, el = T - a.stun;
      o.g.rotation.x = -1.35 * (el < 0.15 ? el / 0.15 : a.stun < 0.35 ? a.stun / 0.35 : 1);
    } else if (o.g.rotation.x) o.g.rotation.x = 0;
    const moving = a.moving;
    const carry = a.stack.length > 0;
    const far = Math.abs(a.x - this.cx) > VIEW_R || Math.abs(a.z - this.cz) > VIEW_R;
    o.g.visible = !far;   // далеко — всё равно в тумане: не рисуем и не анимируем
    let bob = 0;
    if (o.model) {
      // человечек Kenney: анимации «стоит / идёт / бежит» + руки «несу стопку»
      if (!far) {
        const g = this.g, sp = a.kind === 'player' ? g.plSpeed() : a.kind === 'worker' ? g.wSpeed()
          : TUNE.custSpeed * (a.state === 'far' || a.state === 'gone' ? 1.3 : 1);   // по тротуару идут бодрее
        o.set(moving, sp, carry, dt);
      }
    } else {
      o.phase += dt * (moving ? 11 : 0);
      const sw = moving ? Math.sin(o.phase) * 0.65 : 0;
      o.legL.rotation.x += (sw - o.legL.rotation.x) * 0.4;
      o.legR.rotation.x += (-sw - o.legR.rotation.x) * 0.4;
      const armT = carry ? -1.35 : -sw * 0.8;
      o.armL.rotation.x += (armT - o.armL.rotation.x) * 0.35;
      o.armR.rotation.x += ((carry ? -1.35 : sw * 0.8) - o.armR.rotation.x) * 0.35;
      o.body.position.y = moving ? Math.abs(Math.sin(o.phase)) * 0.05 : 0;
      bob = o.body.position.y;
    }
    // стопка в руках
    if (!carry || far) return;
    const hide = this.inflight.get('a' + this.agentId(a)) || 0;
    const n = Math.min(a.stack.length - hide, 42);
    const b = this.stackBase(a);
    let y = b.y + bob;
    const wob = moving ? 1 : 0.25;
    for (let i = 0; i < n; i++) {
      const it = a.stack[i];
      const sway = Math.sin(this.t * 7 + i * 0.35) * 0.012 * i * wob;
      this.addInst(it, b.x + Math.cos(b.f) * sway, y, b.z - Math.sin(b.f) * sway, b.f);
      y += ITEM_VIS[it].h * 0.92;
    }
  }

  // Над рабочими: номер из списка (пока он открыт или рабочий подсвечен) и чего ждёт, если стоит дольше TUNE.idleShow.
  // Причину считает игра (workerWhy) — не чаще раза в 0.4 с на рабочего
  workerLabels(dt) {
    const g = this.g;
    if (this.hl && (this.hlT -= dt) <= 0 && !this.hover) this.hl = null;
    let ring = null;
    g.workers.forEach((w, i) => {
      const o = this.agentObjs.get(w);
      if (!o || !o.g.visible) return;
      const p = o.g.position, hl = this.hl === w;
      if (hl) ring = p;
      if (!hl && (Math.abs(p.x - this.cx) > 34 || Math.abs(p.z - this.cz) > 28)) return;
      let why = null;
      if (!w.on || w.xwait || w.still > TUNE.idleShow) {
        let c = this.whyCache.get(w);
        if (!c || this.t - c.t > 0.4) { c = { t: this.t, why: g.workerWhy(w) }; this.whyCache.set(w, c); }
        why = c.why;
      }
      if (!why && !this.showTags && !hl) return;
      const num = this.showTags || hl ? `<b>${i + 1}</b>` : '';
      this.labels.set('w' + i, p.x, 2.3, p.z, num + (why ? `<span class="wf">${why.text}</span><span class="ws">${why.short}</span>` : ''), 'wtag' + (hl ? ' hl' : '') + (why ? ' idle' : ''));
    });
    this.hlRing.visible = !!ring;
    if (ring) { this.hlRing.position.set(ring.x, 0.05, ring.z); this.hlRing.scale.setScalar(1 + Math.sin(this.t * 6) * 0.08); }
  }

  syncFlights(dt) {
    const tmp = {};
    const keep = [];
    for (const f of this.flights) {
      f.t += dt;
      if (f.t < 0) { keep.push(f); continue; }
      const k = Math.min(1, f.t / f.dur);
      let to = f.toFixed;
      if (!to) { to = tmp; if (!this.endpoint(f.to, f.it, f.slot, tmp)) { tmp.x = f.from.x; tmp.y = f.from.y; tmp.z = f.from.z; tmp.ry = 0; } }
      const e = k * k * (3 - 2 * k);
      const x = lerp(f.from.x, to.x, e), z = lerp(f.from.z, to.z, e);
      const y = lerp(f.from.y, to.y, e) + Math.sin(Math.PI * k) * 1.1;
      this.addInst(f.it, x, y, z, lerp(f.from.ry || 0, to.ry || 0, e));
      if (k >= 1) {
        if (f.key) { const n = (this.inflight.get(f.key) || 1) - 1; if (n <= 0) this.inflight.delete(f.key); else this.inflight.set(f.key, n); }
      } else keep.push(f);
    }
    this.flights = keep;
  }

  // геометрия i-го этажа: свои этажи чередуются (каждый 5-й — технический, ламели через этаж смещены)
  floorGeo(i) {
    const own = this.O && MODEL_OF.tower === 'own';
    const v = own ? (i % 5 === 4 ? 1 : i % 2 ? 2 : 0) : 'old';
    this.towerGeos = this.towerGeos || {};
    return this.towerGeos[v] || (this.towerGeos[v] = own ? ownTowerFloorGeo(v) : towerFloorGeo());
  }

  syncTower() {
    const g = this.g, s = g.s;
    if (!this.towerFloors) {
      const own = this.O && MODEL_OF.tower === 'own';
      this.towerFloors = [];
      this.scaffold = own ? ownScaffold() : new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(14.4, 3, 14.4, 4, 1, 4)), new THREE.LineBasicMaterial({ color: 0xf39c33 }));
      this.scene.add(this.scaffold);
      this.partial = new THREE.Mesh(this.floorGeo(s.floor), MAT.flat);
      this.partial.castShadow = true;
      this.scene.add(this.partial);
      this.roof = own ? ownRoof() : meshOf([B(0x6b4a2b, 0, 0.15, 0, 14.6, 0.3, 14.6), B(COL.red, 5, 1.6, 5, 0.1, 3, 0.1), B(COL.red, 5.5, 2.8, 5, 1, 0.6, 0.04)]);
      this.scene.add(this.roof);
    }
    const n = s.floor, tw = PROPS.find((p) => p.id === 'tower');
    if (this.partial.geometry !== this.floorGeo(n)) this.partial.geometry = this.floorGeo(n);
    while (this.towerFloors.length < n) {
      const m = new THREE.Mesh(this.floorGeo(this.towerFloors.length), MAT.flat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.set(tw.x, 0.6 + this.towerFloors.length * 3, tw.z);
      this.scene.add(m);
      this.towerFloors.push(m);
      if (this.ver > 0 && this.t > 1) this.pop(m);
    }
    const top = 0.6 + n * 3;
    const f = FLOORS[n];
    let prog = 0;
    if (f) {
      let need = 0, got = 0;
      for (const it in f.need) { need += f.need[it]; got += Math.min(f.need[it], s.floorGot[it] || 0); }
      prog = need ? got / need : 0;
    }
    this.scaffold.visible = !!f;
    this.scaffold.position.set(tw.x, top + 1.5, tw.z);
    this.partial.visible = !!f && prog > 0.01;
    this.partial.scale.set(1, Math.max(0.01, prog), 1);
    this.partial.position.set(tw.x, top, tw.z);
    this.roof.position.set(tw.x, f ? top + 3 : top, tw.z);
    const cr = this.propObjs.tcrane;
    if (cr) {
      const h = top + 8;
      if (cr.g.userData.setHeight) cr.g.userData.setHeight(h);   // свой кран: мачта собирается из секций
      else {
        cr.g.userData.mast.scale.y = h;
        cr.g.userData.mast.position.y = 0;
        cr.g.userData.top.position.y = h + 0.3;
      }
    }
  }

  syncShip() {
    const s = this.g.s.ship;
    if (!s || s.state === 'away') { if (this.shipObj) this.shipObj.visible = false; this.shipX = null; return; }
    if (!this.shipObj) { this.shipObj = this.K ? buildShipK() : buildShip(); this.scene.add(this.shipObj); }
    let x = SHIP_DOCK[0];
    if (s.state === 'in') x = SHIP_DOCK[0] + (s.t / TUNE.shipSail) * 45;
    if (s.state === 'out') x = SHIP_DOCK[0] + (1 - s.t / TUNE.shipSail) * 45;
    this.shipObj.visible = true;
    this.shipObj.position.set(x, 0, SHIP_DOCK[1]);
    this.shipObj.rotation.y = 0;
    this.shipX = x;
    // груз на палубе (у корабля Kenney палуба занята своими контейнерами — не рисуем)
    let i = 0;
    if (s.got && !this.K) for (const it in s.got) for (let k = 0; k < Math.min(s.got[it], 30); k++, i++) {
      const col = i % 4, row = Math.floor(i / 4) % 10, layer = Math.floor(i / 40);
      this.addInst(it, x - 1.6 + col * 1.05, 2.1 + layer * ITEM_VIS[it].h, SHIP_DOCK[1] - 3.5 + row * 1.0, 0);
    }
  }

  // ───────── верфь ─────────
  // лодка достроена: съезжает по стапелю в воду, всплывает, выравнивается и уходит в море на восток (за туманом — убираем)
  launchBoat(stId) {
    const st = STATIONS[stId], o = this.stObjs[stId];
    if (!st) return;
    const b = ownBoat(o && o.color !== undefined ? o.color : 0).g;
    b.position.set(st.x + SLIP.bx, slipY(SLIP.bx) + SLIP.lift, st.z);
    b.rotation.z = -SLIP_A;
    this.scene.add(b);
    this.launches.push({ b, st, t: 0, splash: false });
  }

  syncShipyard(dt) {
    const SLIDE = 2.4, RUN = 14;   // по стапелю — 2.4 с на 14 м, с разгоном
    for (let i = this.launches.length - 1; i >= 0; i--) {
      const L = this.launches[i], b = L.b, st = L.st;
      L.t += dt;
      if (L.t < SLIDE) {
        const k = L.t / SLIDE, x = SLIP.bx + RUN * k * k;
        b.position.set(st.x + x, slipY(x) + SLIP.lift, st.z);
        b.rotation.z = -SLIP_A;
        if (!L.splash && x > 7.5) { L.splash = true; this.splash(st.x + x + 3, st.z); }
      } else {
        const u = L.t - SLIDE, e = Math.min(1, u / 1.2), s = e * e * (3 - 2 * e);
        // сошла со стапеля на ~11.7 м/с: 1.2 с тормозит о воду до 1.6 м/с, 2 с разгоняется своим ходом до 5.6 м/с
        let x;
        if (u < 1.2) x = 11.7 * u - 4.2 * u * u;
        else if (u < 3.2) { const w = u - 1.2; x = 7.99 + 1.6 * w + w * w; }
        else x = 15.19 + 5.6 * (u - 3.2);
        x += st.x + SLIP.bx + RUN;
        const y0 = slipY(SLIP.bx + RUN) + SLIP.lift;
        b.position.set(x, y0 + (-0.42 - y0) * s + Math.sin(L.t * 2.1) * 0.05, st.z);
        b.rotation.z = -SLIP_A * (1 - s) + Math.sin(L.t * 1.3) * 0.02;
        b.rotation.x = Math.sin(L.t * 1.7) * 0.03;
        if (x > MAP.x1 + 70 || L.t > 40) { this.scene.remove(b); this.launches.splice(i, 1); }
      }
    }
    // всплески: белое кольцо расходится по воде и тает
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const S = this.splashes[i];
      S.t += dt;
      const k = S.t / 1.4;
      S.m.scale.setScalar(1 + k * 4);
      S.m.material.opacity = 0.75 * (1 - k);
      if (k >= 1) { this.scene.remove(S.m); S.m.geometry.dispose(); S.m.material.dispose(); this.splashes.splice(i, 1); }
    }
    this.syncRaft();
  }

  splash(x, z) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.5, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.06, z);
    this.scene.add(m);
    this.splashes.push({ m, t: 0 });
  }

  // Буксир-толкач с плотом бруса: подходит к берегу к выгрузке (сим — s.raftT, раз в TUNE.raftT), стоит, уходит пустым.
  // Время — из симуляции, поэтому после перемотки и загрузки плот там, где должен быть
  syncRaft() {
    const g = this.g, on = !!g.s.padDone.p_raft && g.open.z7;
    if (!on) { if (this.raftObj) this.raftObj.g.visible = false; return; }
    if (!this.raftObj) this.raftObj = this.buildRaft();
    const R = this.raftObj, T = TUNE.raftT, t = g.s.raftT || 0, far = 42;
    // до выгрузки 8 с — подходит (гружёный); после — 3 с у берега, 8 с отходит (пустой)
    let d, loaded;
    if (t > T - 8) { const k = (T - t) / 8; d = far * k * k; loaded = true; }
    else if (t < 3) { d = 0; loaded = false; }
    else if (t < 11) { const k = (t - 3) / 8; d = far * k * k; loaded = false; }
    else { R.g.visible = false; return; }
    R.g.visible = true;
    R.g.position.set(RAFT.x + d, Math.sin(this.t * 1.6) * 0.04, RAFT.z);
    R.cargo.visible = loaded;
  }

  buildRaft() {
    const grp = new THREE.Group();
    // плот из брёвен (5.4 × 2.6 м), на нём — брус штабелем
    const k = new Kit(171);
    for (let i = 0; i < 7; i++) k.cyl(i % 2 ? CR.bark : 0x7a5535, 0, 0.02, -1.14 + i * 0.38, 0.19, 5.4, { axis: 'x', n: 8, surf: SURF.wood, end: CR.barkEnd, jit: 0.06 });
    for (const x of [-2.1, 0, 2.1]) k.box(0x6b4a2e, x, 0.22, 0, 0.14, 0.08, 2.7, { surf: SURF.wood });
    const base = k.mesh();
    const c = new Kit(172);
    for (let row = 0; row < 3; row++) for (let j = 0; j < 5; j++) c.box(CR.wood, 0, 0.36 + row * 0.19, -0.9 + j * 0.45, 4.6, 0.17, 0.4, { surf: SURF.wood, jit: 0.07, end: CR.woodEnd, grain: 0 });
    c.box(0xd8c79a, 0, 0.93, 0, 0.06, 0.02, 2.4, { surf: SURF.cloth });   // стяжка
    const cargo = c.mesh();
    grp.add(base, cargo);
    // толкач — сзади (с моря), носом к берегу
    let tug = this.K && window.LIB_OK ? kMesh(MODEL_OF.tug, { size: [null, null, 5.2] }) : null;
    if (tug) { tug.rotation.y = -Math.PI / 2; tug.position.set(5.6, -0.25, 0); }
    else {
      const t = new Kit(173);
      t.box(0xb5332a, 0, 0.2, 0, 4.4, 0.8, 2.0, { surf: SURF.paint, b: 0.2 });
      t.box(0xf1eee6, 0.4, 1.05, 0, 1.6, 0.9, 1.4, { surf: SURF.paint, b: 0.05 });
      t.box(CR.glass, -0.41, 1.25, 0, 0.02, 0.3, 1.1, { surf: SURF.glass, b: 0 });
      t.cyl(0x26282a, 0.9, 1.8, 0, 0.18, 0.7, { n: 10, surf: SURF.metal });
      tug = t.mesh(); tug.position.set(5.2, -0.1, 0);
    }
    grp.add(tug);
    grp.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.scene.add(grp);
    return { g: grp, cargo };
  }

  syncPlots() {
    const g = this.g;
    if (!g.open.z2 && !this.plotsShown) return;
    this.plotsShown = true;
    const grow = g.growT();
    let near = -1, nd = 7;   // ближайший к игроку пень — подпишем, что делать
    for (let i = 0; i < PLOTS.length; i++) {
      const o = this.plotObjs[i];
      if (!o) continue;
      const on = g.plotOn(i);
      o.grp.visible = on;
      if (!on) continue;
      const tr = g.s.trees[i];
      o.stump.visible = tr.stage === 0;
      o.sprout.visible = tr.stage === 0;
      if (tr.stage === 0) {
        o.sprout.scale.setScalar(1 + Math.sin(this.t * 4 + i) * 0.12);
        const d = dist(PLOTS[i].x, PLOTS[i].z, g.pl.x, g.pl.z);
        if (d < nd) { nd = d; near = i; }
      }
      o.tree.visible = tr.stage > 0;
      if (tr.stage === 1) o.tree.scale.setScalar(0.25 + 0.75 * Math.min(1, tr.t / grow));
      else if (tr.stage === 2) { o.tree.scale.setScalar(1); o.tree.rotation.z = Math.sin(this.t * 1.3 + i) * 0.025; }
    }
    if (near >= 0) this.labels.set('sprout', PLOTS[near].x, 1.6, PLOTS[near].z, '🌱 Встань — посадишь дерево', 'station');
  }

  syncPads() {
    const g = this.g, s = g.s;
    for (const p of PADS) {
      const o = this.padObjs[p.id];
      if (!o) continue;
      const paid = (s.padPaid[p.id] || 0) / p.cost;
      o.fill.scale.set(1, Math.max(0.001, paid), 1);
      o.fill.position.z = (p.d - 0.3) * (1 - paid) / 2;
      if (Math.abs(p.x - this.cx) < 45 && Math.abs(p.z - this.cz) < 40) {
        const rem = p.cost - (s.padPaid[p.id] || 0);
        const ok = s.money >= rem ? ' ok' : '';
        // вторая строка — что даст покупка (отзыв: «нужна подсказка, что будет на выходе»)
        const info = padInfo(p);
        this.labels.set('pad' + p.id, p.x, p.station ? 3.2 : 2.4, p.z,
          `<div class="t">${padTitle(p)}</div>${info ? `<div class="i">${info}</div>` : ''}<div class="c${ok}">${fmtMoney(rem)}</div>`, 'pad' + (p.gate ? ' gate' : '') + (dist(p.x, p.z, g.pl.x, g.pl.z) < 9 ? ' near' : ''));   // near — на телефоне «что даст» только у ближней
      }
    }
  }

  pileLabels() {
    const g = this.g, s = g.s, pl = { x: this.cx, z: this.cz };   // подписи — вокруг камеры
    // стройка: что нужно на этаж
    const site = PILES.site, f = FLOORS[s.floor];
    if (Math.abs(site.x - pl.x) < 50 && Math.abs(site.z - pl.z) < 50) {
      let html = `<div class="t">Этаж ${Math.min(s.floor + 1, FLOORS.length)} из ${FLOORS.length}</div>`;
      if (f) for (const it in f.need) {
        const got = s.floorGot[it] || 0, done = got >= f.need[it];
        html += `<div class="row${done ? ' done' : ''}">${ITEMS[it].name}: ${fmtNum(Math.min(got, f.need[it]))}/${fmtNum(f.need[it])}</div>`;
      } else html += '<div class="row done">Небоскрёб построен!</div>';
      this.labels.set('site', site.x, 6.5, site.z, html, 'info');
    }
    // корабль
    const sh = s.ship;
    if (sh && sh.state === 'docked' && sh.need && dist(PILES.dock.x, PILES.dock.z, pl.x, pl.z) < 50) {
      let html = `<div class="t">Корабль ждёт ${fmtTime(sh.left)}</div>`;
      for (const it in sh.need) html += `<div class="row${(sh.got[it] || 0) >= sh.need[it] ? ' done' : ''}">${ITEMS[it].name}: ${sh.got[it] || 0}/${sh.need[it]}</div>`;
      html += `<div class="row">Награда: ${fmtMoney(sh.reward)}</div>`;
      this.labels.set('ship', PILES.dock.x, 5, PILES.dock.z, html, 'info');
    }
    // закрытые зоны
    for (const z of ZONES) {
      if (g.open[z.id]) continue;
      const r = z.rect, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      if (Math.abs(cx - pl.x) > 60 || Math.abs(cz - pl.z) > 50) continue;
      const ready = s.floor >= z.floor;
      const txt = ready ? 'Участок продаётся у входа' : `Откроется после ${z.floor}-го этажа`;
      this.labels.set('zone' + z.id, cx, 2.5, cz, `<div class="t">🔒 ${z.name}</div><div class="row">${txt}</div>`, 'zone');
    }
    // количество на кучах рядом с игроком
    for (const id of g.pilesOn) {
      const p = PILES[id];
      if (p.money || p.site || p.dock || p.trash) continue;
      if (p.pickZone && !g.open[p.pickZone]) continue;
      if (Math.abs(p.x - pl.x) > 9 || Math.abs(p.z - pl.z) > 9) continue;
      const total = g.total(id);
      let cap = 0;
      for (const it of this.pileTypes(id)) cap += g.cap(id, it);
      if (!cap) continue;
      const full = total >= cap;
      const hy = p.shelf ? 2.3 : 1.6;
      const ord = id === 'yard' ? ` · заказ ${g.s.logOrder || 0}` : '';   // склад брёвен: сколько везёт лесовоз
      this.labels.set('cnt' + id, p.x, hy, p.z + p.d / 2, `${fmtNum(total)}/${fmtNum(cap)}${ord}`, 'cnt' + (full ? ' full' : ''));
    }
    // названия станков рядом
    for (const id of g.stOn) {
      const st = STATIONS[id];
      if (Math.abs(st.x - pl.x) > 12 || Math.abs(st.z - pl.z) > 10) continue;
      this.labels.set('st' + id, st.x, 2.9, st.z, `<div class="t">${st.name}</div><div class="row">${recipeText(st)}</div>`, 'station');
    }
  }

  syncEffects(dt) {
    const keep = [];
    for (const p of this.pops) {
      p.t += dt;
      if (p.t < 0) { keep.push(p); continue; }
      const k = Math.min(1, p.t / 0.45);
      const s = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.25 * (1 - k) + (k - 1) * 0 : 1;
      p.obj.scale.setScalar(Math.max(0.01, k < 0.6 ? k / 0.6 * 1.15 : s));
      if (k < 1) keep.push(p); else p.obj.scale.setScalar(1);
    }
    this.pops = keep;
    const fk = [];
    for (const f of this.falls) {
      f.t += dt;
      f.obj.rotation.set(Math.cos(f.dir) * Math.min(1, f.t / 0.5) * 1.5, 0, Math.sin(f.dir) * Math.min(1, f.t / 0.5) * 1.5);
      if (f.t > 0.8) { f.obj.scale.setScalar(Math.max(0.01, 1 - (f.t - 0.8) / 0.3)); }
      if (f.t < 1.1) fk.push(f); else this.scene.remove(f.obj);
    }
    this.falls = fk;
    // всплывающие суммы продаж
    for (const k in this.floatAcc) {
      const a = this.floatAcc[k];
      a.t += dt;
      if (a.t > 0.6) {
        if (a.v >= 1) this.labels.float(a.x, 2.2, a.z, '+' + fmtMoney(a.v), 'money');
        delete this.floatAcc[k];
      }
    }
  }

  // стрелка к цели и маркер над целью
  goalPos() {
    const goal = this.g.goal;
    if (!goal) return null;
    const t = goal.target;
    if (t.startsWith('pad:')) { const p = PAD_BY_ID[t.slice(4)]; return p && this.g.padVisible(p) ? [p.x, p.z] : null; }
    if (t.startsWith('plot:')) { const q = PLOTS[+t.slice(5)]; return q ? [q.x, q.z] : null; }
    const p = PILES[t];
    return p ? [p.x, p.z] : null;
  }

  syncGoal() {
    const pl = this.playerObj.g.position, gp = this.goalPos();
    if (!gp) { this.goalArrow.visible = false; this.goalMark.visible = false; return; }
    const d = dist(pl.x, pl.z, gp[0], gp[1]);
    this.goalMark.visible = true;
    this.goalMark.position.set(gp[0], 3.2 + Math.abs(Math.sin(this.t * 3)) * 0.6, gp[1]);
    this.goalMark.rotation.y += 0.03;
    this.goalArrow.visible = d > 4;
    if (d > 4) {
      const a = Math.atan2(gp[0] - pl.x, gp[1] - pl.z);
      this.goalArrow.position.set(pl.x, 0.06, pl.z);
      this.goalArrow.rotation.y = a;
    }
  }
}
