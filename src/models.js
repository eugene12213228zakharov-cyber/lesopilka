'use strict';
// Модели из простых фигур: коробки, цилиндры, конусы, шары. Готовых 3D-моделей нет.
// Детали склеиваются в одну геометрию с цветом в вершинах — один материал на всё, быстро рисуется.

const MAT = {};
const SHAPES = {};

function initMaterials() {
  MAT.vc = new THREE.MeshLambertMaterial({ vertexColors: true });
  MAT.flat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
}

function shape(name) {
  if (!SHAPES[name]) {
    const mk = {
      box: () => new THREE.BoxGeometry(1, 1, 1),
      cyl: () => new THREE.CylinderGeometry(1, 1, 1, 12),
      cyl6: () => new THREE.CylinderGeometry(1, 1, 1, 6),
      cyl20: () => new THREE.CylinderGeometry(1, 1, 1, 20),
      cone: () => new THREE.ConeGeometry(1, 1, 8),
      cone6: () => new THREE.ConeGeometry(1, 1, 6),
      sph: () => new THREE.SphereGeometry(1, 12, 8),
      hemi: () => new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    }[name];
    SHAPES[name] = mk();
  }
  return SHAPES[name];
}

// Деталь: форма, цвет, центр, поворот, размер
function P(sh, color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) { return { sh, color, x, y, z, sx, sy, sz, rx, ry, rz }; }
// коробка по центру (x,y,z) размером w×h×d
function B(color, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0) { return P('box', color, x, y, z, w, h, d, rx, ry, rz); }
// цилиндр вдоль Y радиусом r и высотой h
function C(color, x, y, z, r, h, rx = 0, ry = 0, rz = 0, sh = 'cyl') { return P(sh, color, x, y, z, r, h, r, rx, ry, rz); }
function S(color, x, y, z, r, sh = 'sph') { return P(sh, color, x, y, z, r, r, r); }

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v3 = new THREE.Vector3(), _s3 = new THREE.Vector3();

function mergeParts(parts) {
  const list = [];
  let total = 0;
  for (const p of parts) {
    const src = shape(p.sh);
    const g = src.index ? src.toNonIndexed() : src.clone();
    _e.set(p.rx, p.ry, p.rz);
    _q.setFromEuler(_e);
    _m4.compose(_v3.set(p.x, p.y, p.z), _q, _s3.set(p.sx, p.sy, p.sz));
    g.applyMatrix4(_m4);
    total += g.attributes.position.count;
    list.push([g, new THREE.Color(p.color)]);
  }
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const [g, c] of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < n; i++) { const k = (o + i) * 3; col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; }
    o += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

function meshOf(parts, flat = true, shadow = true) {
  const m = new THREE.Mesh(mergeParts(parts), flat ? MAT.flat : MAT.vc);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

// ───────── палитра ─────────
const COL = {
  wood: 0xe2b877, woodMid: 0xc68642, woodDark: 0x8b5a2b, woodRed: 0xa0522d,
  metal: 0x8a9199, metalDark: 0x4a5058, steel: 0xcfd4d9,
  red: 0xe0503c, orange: 0xf39c33, yellow: 0xf5c542, blue: 0x3d8bd9, green: 0x4caf50, purple: 0x9b59b6,
  concrete: 0xd6d2c8, skin: 0xf1c7a1, cardboard: 0xc8a26a, white: 0xf4f4f4, dark: 0x2a2f35,
};

// ───────── предметы ─────────
// fw, fd — размер в плане для раскладки на площадке (длинная сторона — по X)
const ITEM_VIS = {};

function boxedParts(w, h, d, stripe) {
  return [
    B(COL.cardboard, 0, h / 2, 0, w, h, d),
    B(0xe8dcc0, 0, h + 0.002, 0, 0.12, 0.004, d),
    B(stripe, 0, h * 0.55, d / 2 + 0.002, w * 0.6, h * 0.28, 0.004),
    B(stripe, 0, h * 0.55, -d / 2 - 0.002, w * 0.6, h * 0.28, 0.004),
  ];
}

function buildItemModels() {
  const def = {
    log: { fw: 1.3, fd: 0.34, parts: [
      C(0x8b5a2b, 0, 0.17, 0, 0.17, 1.3, 0, 0, Math.PI / 2),
      C(0xdcae74, 0.651, 0.17, 0, 0.15, 0.01, 0, 0, Math.PI / 2),
      C(0xdcae74, -0.651, 0.17, 0, 0.15, 0.01, 0, 0, Math.PI / 2),
    ] },
    board: { fw: 1.3, fd: 0.3, parts: [B(0xe8bf7d, 0, 0.045, 0, 1.3, 0.09, 0.3), B(0xcf9f5c, 0, 0.045, 0, 1.302, 0.05, 0.302)] },
    beam: { fw: 1.3, fd: 0.18, parts: [B(0xd19a57, 0, 0.09, 0, 1.3, 0.18, 0.18), B(0xe8c08a, 0.651, 0.09, 0, 0.004, 0.16, 0.16)] },
    panel: { fw: 1.1, fd: 0.62, parts: [
      B(0xecc890, 0, 0.055, 0, 1.1, 0.11, 0.62),
      B(0xd4a86a, 0, 0.111, -0.2, 1.1, 0.004, 0.02), B(0xd4a86a, 0, 0.111, 0.0, 1.1, 0.004, 0.02), B(0xd4a86a, 0, 0.111, 0.2, 1.1, 0.004, 0.02),
    ] },
    legs: { fw: 0.72, fd: 0.24, parts: [
      C(0xd9a86c, 0, 0.05, -0.06, 0.045, 0.7, 0, 0, Math.PI / 2), C(0xd9a86c, 0, 0.05, 0.06, 0.045, 0.7, 0, 0, Math.PI / 2),
      C(0xd9a86c, 0, 0.14, -0.06, 0.045, 0.7, 0, 0, Math.PI / 2), C(0xd9a86c, 0, 0.14, 0.06, 0.045, 0.7, 0, 0, Math.PI / 2),
      B(COL.red, 0, 0.095, 0, 0.06, 0.22, 0.24),
    ] },
    sawdust: { fw: 0.62, fd: 0.5, parts: [S(0xeadbb0, 0, 0.19, 0, 1), C(0xb08a4a, 0.3, 0.2, 0, 0.06, 0.1, 0, 0, Math.PI / 2)].map((p, i) => i === 0 ? Object.assign(p, { sx: 0.31, sy: 0.19, sz: 0.25 }) : p) },
    cardboard: { fw: 0.9, fd: 0.6, parts: [B(0xb89a6a, 0, 0.04, 0, 0.9, 0.08, 0.6), B(0xcdb286, 0, 0.081, 0, 0.86, 0.002, 0.56)] },
    box: { fw: 0.5, fd: 0.5, parts: [B(COL.cardboard, 0, 0.23, 0, 0.5, 0.46, 0.5), B(0xe8dcc0, 0, 0.461, 0, 0.1, 0.004, 0.5)] },
    chair: { fw: 0.46, fd: 0.46, parts: [
      B(COL.woodRed, 0, 0.27, 0, 0.44, 0.06, 0.44),
      B(0x7a3e1d, 0.19, 0.13, 0.19, 0.05, 0.26, 0.05), B(0x7a3e1d, -0.19, 0.13, 0.19, 0.05, 0.26, 0.05),
      B(0x7a3e1d, 0.19, 0.13, -0.19, 0.05, 0.26, 0.05), B(0x7a3e1d, -0.19, 0.13, -0.19, 0.05, 0.26, 0.05),
      B(COL.woodRed, 0, 0.5, -0.19, 0.44, 0.42, 0.05),
    ] },
    table: { fw: 0.9, fd: 0.6, parts: [
      B(COL.woodMid, 0, 0.43, 0, 0.9, 0.06, 0.6),
      B(0x8b5a2b, 0.39, 0.2, 0.24, 0.06, 0.4, 0.06), B(0x8b5a2b, -0.39, 0.2, 0.24, 0.06, 0.4, 0.06),
      B(0x8b5a2b, 0.39, 0.2, -0.24, 0.06, 0.4, 0.06), B(0x8b5a2b, -0.39, 0.2, -0.24, 0.06, 0.4, 0.06),
    ] },
    wardrobe: { fw: 0.62, fd: 0.38, parts: [
      B(0x8e5a3c, 0, 0.45, 0, 0.62, 0.9, 0.36),
      B(0x6d4128, 0, 0.45, 0.181, 0.012, 0.84, 0.004),
      B(0xe8c547, 0.05, 0.47, 0.19, 0.03, 0.06, 0.02), B(0xe8c547, -0.05, 0.47, 0.19, 0.03, 0.06, 0.02),
    ] },
    chairB: { fw: 0.56, fd: 0.5, parts: boxedParts(0.56, 0.56, 0.5, COL.red) },
    tableB: { fw: 0.95, fd: 0.66, parts: boxedParts(0.95, 0.52, 0.66, COL.blue) },
    wardrobeB: { fw: 0.68, fd: 0.44, parts: boxedParts(0.68, 0.96, 0.44, COL.purple) },
    bill: { fw: 0.4, fd: 0.2, parts: [B(0x5cb85c, 0, 0.02, 0, 0.4, 0.04, 0.2), B(0x2e7d32, 0, 0.02, 0, 0.1, 0.042, 0.202)] },
  };
  for (const id in def) {
    const d = def[id];
    ITEM_VIS[id] = { geo: mergeParts(d.parts), fw: d.fw, fd: d.fd, h: ITEMS[id] ? ITEMS[id].h : 0.045 };
  }
}

// ───────── человечки ─────────
// style: player | worker | cust. Возвращает группу и суставы для анимации шага.
function buildCharacter(style, seed = 0) {
  const shirts = [0xe67e22, 0x16a085, 0x8e44ad, 0xd35400, 0x2980b9, 0xc0392b, 0x27ae60, 0xf1c40f, 0x7f8c8d, 0xe84393];
  const pants = [0x34495e, 0x2c3e50, 0x5d4037, 0x455a64, 0x1e272e];
  const hair = [0x3b2a1e, 0x1b1b1b, 0x7a4b2a, 0xd9b36b, 0x9e9e9e];
  let shirt, pant, hat, vest = null;
  if (style === 'player') { shirt = 0x2f7fd0; pant = 0x1f4f86; hat = 0xff8c1a; }
  else if (style === 'worker') { shirt = 0x5b6e7a; pant = 0x37474f; hat = 0xffd43b; vest = 0xff9f1a; }
  else { shirt = shirts[seed % shirts.length]; pant = pants[(seed >> 3) % pants.length]; hat = null; }
  const g = new THREE.Group();
  const torso = [B(shirt, 0, 1.06, 0, 0.5, 0.62, 0.3), S(COL.skin, 0, 1.56, 0, 0.21)];
  if (vest) torso.push(B(vest, 0, 1.08, 0, 0.52, 0.5, 0.32), B(0xf4f4f4, 0, 1.08, 0.165, 0.5, 0.06, 0.004));
  if (hat) torso.push(S(hat, 0, 1.62, 0, 0.23, 'hemi'), B(hat, 0, 1.62, 0.13, 0.4, 0.035, 0.25));
  else torso.push(S(hair[(seed >> 5) % hair.length], 0, 1.64, -0.02, 0.215, 'hemi'));
  if (style === 'player') torso.push(B(0xffd43b, 0, 1.2, 0.152, 0.16, 0.12, 0.004));
  const body = meshOf(torso, false);
  g.add(body);
  const limb = (x, y, w, h, color) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = meshOf([B(color, 0, -h / 2, 0, w, h, w + 0.02)], false);
    pivot.add(m);
    g.add(pivot);
    return pivot;
  };
  const legL = limb(-0.12, 0.74, 0.17, 0.72, pant), legR = limb(0.12, 0.74, 0.17, 0.72, pant);
  const armL = limb(-0.33, 1.33, 0.13, 0.56, shirt), armR = limb(0.33, 1.33, 0.13, 0.56, shirt);
  return { g, body, legL, legR, armL, armR };
}

// ───────── станки ─────────
// Возвращает { g, anim(t, working) }
function buildStation(type) {
  const g = new THREE.Group();
  const base = [B(0x6b7178, 0, 0.08, 0, 3.2, 0.16, 2.4)];
  let anim = () => {};
  const legs4 = (w, d, h, color = COL.metalDark) => [
    B(color, w / 2 - 0.1, h / 2, d / 2 - 0.1, 0.14, h, 0.14), B(color, -w / 2 + 0.1, h / 2, d / 2 - 0.1, 0.14, h, 0.14),
    B(color, w / 2 - 0.1, h / 2, -d / 2 + 0.1, 0.14, h, 0.14), B(color, -w / 2 + 0.1, h / 2, -d / 2 + 0.1, 0.14, h, 0.14),
  ];
  // рольганги к кучам входа/выхода
  const conv = [B(0x3d4349, -2.2, 0.45, 0, 1.2, 0.1, 0.8), B(0x3d4349, 2.2, 0.45, 0, 1.2, 0.1, 0.8),
    B(COL.metal, -2.2, 0.22, 0.35, 0.08, 0.44, 0.08), B(COL.metal, -2.2, 0.22, -0.35, 0.08, 0.44, 0.08),
    B(COL.metal, 2.2, 0.22, 0.35, 0.08, 0.44, 0.08), B(COL.metal, 2.2, 0.22, -0.35, 0.08, 0.44, 0.08)];
  if (type === 'saw' || type === 'beamer') {
    const accent = type === 'saw' ? COL.red : COL.blue;
    const parts = base.concat(conv, legs4(3.0, 1.4, 0.8), [
      B(0xa9793f, 0, 0.86, 0, 3.0, 0.14, 1.4),
      B(accent, 0, 0.5, 0.85, 0.9, 0.6, 0.5),
      B(COL.yellow, 0, 1.55, 0, 1.0, 0.12, 0.55),
      B(COL.metalDark, 0.45, 1.2, 0, 0.1, 0.6, 0.1), B(COL.metalDark, -0.45, 1.2, 0, 0.1, 0.6, 0.1),
    ]);
    if (type === 'beamer') parts.push(B(accent, 0, 1.75, 0, 2.2, 0.2, 0.3), B(accent, 1.05, 1.3, 0, 0.2, 0.9, 0.3), B(accent, -1.05, 1.3, 0, 0.2, 0.9, 0.3));
    g.add(meshOf(parts));
    const blade = meshOf([C(COL.steel, 0, 0, 0, 0.55, 0.04, Math.PI / 2, 0, 0, 'cyl20'), C(COL.metalDark, 0, 0, 0, 0.1, 0.08, Math.PI / 2)]);
    blade.position.set(0, 1.0, 0);
    g.add(blade);
    anim = (t, on) => { if (on) blade.rotation.z -= 0.6; };
  } else if (type === 'press') {
    g.add(meshOf(base.concat(conv, [
      B(COL.metalDark, 1.1, 1.1, 0.75, 0.2, 2.2, 0.2), B(COL.metalDark, -1.1, 1.1, 0.75, 0.2, 2.2, 0.2),
      B(COL.metalDark, 1.1, 1.1, -0.75, 0.2, 2.2, 0.2), B(COL.metalDark, -1.1, 1.1, -0.75, 0.2, 2.2, 0.2),
      B(COL.metal, 0, 2.25, 0, 2.6, 0.25, 1.8), B(0xa9793f, 0, 0.7, 0, 2.2, 0.2, 1.4), B(COL.red, 0, 2.5, 0, 0.6, 0.3, 0.6),
    ])));
    const ram = meshOf([B(COL.yellow, 0, 0, 0, 2.0, 0.25, 1.3), B(COL.metal, 0, 0.5, 0, 0.25, 0.8, 0.25)]);
    ram.position.y = 1.7;
    g.add(ram);
    anim = (t, on) => { ram.position.y = on ? 1.35 + Math.abs(Math.sin(t * 3)) * 0.45 : 1.7; };
  } else if (type === 'lathe') {
    g.add(meshOf(base.concat(conv, legs4(2.8, 0.8, 0.6), [
      B(COL.metalDark, 0, 0.7, 0, 2.8, 0.22, 0.8),
      B(COL.blue, -1.1, 1.15, 0, 0.6, 0.7, 0.7), B(COL.blue, 1.2, 1.0, 0, 0.4, 0.4, 0.5),
    ])));
    const work = meshOf([C(COL.wood, 0, 0, 0, 0.13, 1.9, 0, 0, Math.PI / 2, 'cyl6')]);
    work.position.set(0.05, 1.05, 0);
    g.add(work);
    anim = (t, on) => { if (on) work.rotation.x += 0.5; };
  } else if (type === 'bench') {
    g.add(meshOf(base.concat(conv, legs4(3.0, 1.5, 0.85, COL.woodDark), [
      B(0xb07a45, 0, 0.92, 0, 3.0, 0.14, 1.5),
      B(COL.metalDark, 1.15, 1.08, 0.5, 0.3, 0.2, 0.3), B(COL.red, -1.1, 1.05, -0.45, 0.4, 0.12, 0.2),
      B(COL.metal, 0.3, 1.0, -0.5, 0.7, 0.03, 0.12),
    ])));
    const hammer = new THREE.Group();
    hammer.add(meshOf([B(COL.woodDark, 0, 0.25, 0, 0.06, 0.5, 0.06), B(COL.metalDark, 0, 0.5, 0, 0.26, 0.1, 0.1)]));
    hammer.position.set(-0.2, 1.0, 0.25);
    g.add(hammer);
    anim = (t, on) => { hammer.rotation.x = on ? -0.2 - Math.abs(Math.sin(t * 6)) * 1.1 : -0.2; };
  } else if (type === 'paper') {
    g.add(meshOf(base.concat(conv, [
      B(0x5d8fb0, 0, 1.0, 0, 2.8, 1.7, 2.0), B(0x4a7896, 0, 1.9, 0, 2.9, 0.1, 2.1),
      P('cone', 0xc9a86a, -0.8, 2.55, 0, 0.6, 0.9, 0.6, Math.PI, 0, 0),
    ])));
    const rolls = new THREE.Group();
    for (const x of [0.2, 0.7, 1.2]) {
      const r = meshOf([C(0xe0e0e0, 0, 0, 0, 0.18, 1.8, Math.PI / 2, 0, 0)]);
      r.position.set(x, 2.1, 0);
      rolls.add(r);
    }
    g.add(rolls);
    anim = (t, on) => { if (on) for (const r of rolls.children) r.rotation.z -= 0.25; };
  } else if (type === 'boxer') {
    g.add(meshOf(base.concat(conv, legs4(2.8, 1.4, 0.8), [
      B(0x7a8a99, 0, 0.86, 0, 2.8, 0.14, 1.4), B(COL.cardboard, 0.4, 1.15, 0, 0.5, 0.46, 0.5), B(COL.orange, -0.9, 1.4, -0.4, 0.6, 1.0, 0.5),
    ])));
    const arm = meshOf([B(COL.metal, 0, 0, 0.4, 0.12, 0.12, 0.8), B(COL.yellow, 0, -0.1, 0.8, 0.3, 0.1, 0.2)]);
    arm.position.set(0.4, 1.7, -0.3);
    g.add(arm);
    anim = (t, on) => { arm.rotation.x = on ? Math.sin(t * 5) * 0.5 : 0; };
  } else if (type === 'packer') {
    g.add(meshOf(base.concat(conv, legs4(3.0, 1.5, 0.8), [
      B(0x9aa8b5, 0, 0.86, 0, 3.0, 0.14, 1.5), B(COL.cardboard, 0.2, 1.25, 0, 0.8, 0.64, 0.7),
      B(0xe8dcc0, 0.2, 1.575, 0, 0.14, 0.006, 0.7), C(COL.yellow, -0.9, 1.1, 0.4, 0.16, 0.12, Math.PI / 2, 0, 0),
    ])));
    const arm = meshOf([B(COL.metal, 0, 0.5, 0, 0.12, 1.0, 0.12), B(COL.red, 0, 1.0, 0.2, 0.2, 0.2, 0.5)]);
    arm.position.set(0.2, 1.3, -0.7);
    g.add(arm);
    anim = (t, on) => { arm.rotation.x = on ? 0.3 + Math.sin(t * 4) * 0.4 : 0.3; };
  }
  return { g, anim };
}

// ───────── декорации и постройки ─────────
function buildProp(type) {
  const g = new THREE.Group();
  let anim = () => {};
  if (type === 'stall') {
    const parts = [
      B(COL.woodMid, 0, 0.55, 0, 1.6, 1.1, 6),
      B(COL.woodDark, 0.7, 1.3, 2.9, 0.12, 2.6, 0.12), B(COL.woodDark, -0.7, 1.3, 2.9, 0.12, 2.6, 0.12),
      B(COL.woodDark, 0.7, 1.3, -2.9, 0.12, 2.6, 0.12), B(COL.woodDark, -0.7, 1.3, -2.9, 0.12, 2.6, 0.12),
      B(COL.yellow, 0, 3.05, 0, 0.12, 0.55, 2.6),
    ];
    for (let i = 0; i < 6; i++) parts.push(B(i % 2 ? COL.white : COL.red, 0.1, 2.62, -2.5 + i, 2.1, 0.08, 1.0, 0, 0, -0.22));
    g.add(meshOf(parts));
  } else if (type === 'rack') {
    const parts = [
      B(0x6b7178, 2.1, 1.0, 0.5, 0.1, 2.0, 0.1), B(0x6b7178, -2.1, 1.0, 0.5, 0.1, 2.0, 0.1),
      B(0x6b7178, 2.1, 1.0, -0.5, 0.1, 2.0, 0.1), B(0x6b7178, -2.1, 1.0, -0.5, 0.1, 2.0, 0.1),
    ];
    for (const h of [0.3, 0.95, 1.6]) parts.push(B(COL.woodMid, 0, h, 0, 4.4, 0.07, 1.15));
    g.add(meshOf(parts));
  } else if (type === 'desk') {
    g.add(meshOf([
      B(0x8e5a3c, 0, 0.55, 0, 4, 1.1, 1.2), B(0x6d4128, 0, 1.12, 0, 4.1, 0.06, 1.3),
      B(COL.dark, 0.8, 1.3, 0, 0.5, 0.3, 0.4), B(0x9fd3ff, 0.8, 1.55, -0.1, 0.4, 0.25, 0.04, -0.3, 0, 0),
    ]));
  } else if (type === 'tcrane') {
    const mast = meshOf([B(COL.yellow, 0, 0.5, 0, 1.1, 1, 1.1)]);
    g.add(mast);
    const top = new THREE.Group();
    top.add(meshOf([B(COL.yellow, -3, 0, 0, 14, 0.5, 0.6), B(COL.metalDark, -10.5, -0.4, 0, 1.4, 1.1, 1.2), B(COL.red, 0.6, 0.6, 0, 1.2, 1.0, 1.0),
      B(COL.metalDark, 3.2, -2.5, 0, 0.05, 5, 0.05), B(COL.orange, 3.2, -5.1, 0, 0.3, 0.3, 0.3)]));
    g.add(top);
    g.userData = { mast, top };
    anim = (t) => { top.rotation.y = Math.sin(t * 0.13) * 1.2 + 0.6; };
  } else if (type === 'pcrane') {
    g.add(meshOf([
      B(COL.red, 0.9, 3, 0.9, 0.3, 6, 0.3), B(COL.red, -0.9, 3, 0.9, 0.3, 6, 0.3),
      B(COL.red, 0.9, 3, -0.9, 0.3, 6, 0.3), B(COL.red, -0.9, 3, -0.9, 0.3, 6, 0.3),
      B(COL.red, 5, 6.1, 0, 14, 0.4, 0.6), B(COL.dark, 0, 5.2, 0, 1.4, 1.2, 1.4),
    ]));
    const trolley = new THREE.Group();
    trolley.add(meshOf([B(COL.metalDark, 0, 0, 0, 0.8, 0.4, 0.8), B(COL.metalDark, 0, -1.5, 0, 0.05, 3, 0.05), B(COL.yellow, 0, -3.1, 0, 0.5, 0.2, 0.5)]));
    trolley.position.set(4, 5.7, 0);
    g.add(trolley);
    g.userData = { trolley };
    anim = (t, on) => { trolley.position.x = on ? 4 + Math.sin(t * 1.4) * 6 : 4; };
  } else if (type === 'compressor') {
    g.add(meshOf([B(COL.metal, 0, 0.6, 0, 2.2, 1.2, 1.8), B(COL.metalDark, 0, 1.25, 0, 2.3, 0.1, 1.9),
      C(COL.metalDark, 0.6, 2.4, 0.5, 0.15, 2.4), C(COL.metalDark, -0.6, 2.4, -0.5, 0.15, 2.4)]));
    const fan = meshOf([B(COL.steel, 0, 0, 0, 0.9, 0.04, 0.16), B(COL.steel, 0, 0, 0, 0.16, 0.04, 0.9)]);
    fan.position.set(0, 1.33, 0);
    g.add(fan);
    anim = (t, on) => { if (on) fan.rotation.y += 0.4; };
  } else if (type === 'trash') {
    g.add(meshOf([B(0x2e7d32, 0, 0.55, 0, 1.6, 1.1, 1.2), B(0x1b5e20, 0, 1.13, -0.05, 1.7, 0.06, 1.3, -0.15, 0, 0)]));
  } else if (type === 'tower') {
    g.add(meshOf([B(0xbdb6aa, 0, 0.3, 0, 16, 0.6, 16)], true, false));
  }
  return { g, anim };
}

// этаж небоскрёба: деревянные стены, полосы окон, перекрытие
function towerFloorGeo() {
  const parts = [B(0xc9935a, 0, 1.5, 0, 14, 3, 14), B(0x8d6238, 0, 3.02, 0, 14.4, 0.12, 14.4)];
  for (let i = -3; i <= 3; i++) {
    const x = i * 1.9;
    parts.push(B(0x9fd3ff, x, 1.6, 7.01, 1.2, 1.7, 0.02), B(0x9fd3ff, x, 1.6, -7.01, 1.2, 1.7, 0.02));
    parts.push(B(0x9fd3ff, 7.01, 1.6, x, 0.02, 1.7, 1.2), B(0x9fd3ff, -7.01, 1.6, x, 0.02, 1.7, 1.2));
  }
  return mergeParts(parts);
}

function treeParts(k = 1) {
  return [
    C(0x8b5a2b, 0, 0.6 * k, 0, 0.18 * k, 1.2 * k),
    P('cone', 0x3f8f3a, 0, 1.7 * k, 0, 0.95 * k, 1.5 * k, 0.95 * k),
    P('cone', 0x4fa446, 0, 2.4 * k, 0, 0.72 * k, 1.25 * k, 0.72 * k),
    P('cone', 0x62b857, 0, 3.0 * k, 0, 0.46 * k, 0.95 * k, 0.46 * k),
  ];
}

function buildTruck(kind) {
  const g = new THREE.Group();
  const cab = kind === 'log' ? COL.red : COL.blue;
  const parts = [
    B(COL.dark, 0, 0.62, 0, 6, 0.3, 1.9),
    B(cab, 2.35, 1.45, 0, 1.3, 1.5, 2.0), B(0x9fd3ff, 3.02, 1.7, 0, 0.04, 0.7, 1.7), B(0x9fd3ff, 2.4, 1.75, 1.005, 0.9, 0.6, 0.02),
    B(0x9fd3ff, 2.4, 1.75, -1.005, 0.9, 0.6, 0.02),
  ];
  for (const x of [-1.9, -0.6, 2.3]) for (const z of [1.0, -1.0]) parts.push(C(0x1f1f1f, x, 0.46, z, 0.46, 0.32, Math.PI / 2, 0, 0));
  if (kind === 'log') {
    parts.push(B(COL.woodDark, -0.7, 0.85, 0, 3.8, 0.14, 2.0));
    for (const x of [-2.5, -1.3, 0, 1.1]) for (const z of [0.95, -0.95]) parts.push(B(COL.metalDark, x, 1.35, z, 0.1, 1.0, 0.1));
  } else {
    parts.push(B(COL.white, -0.8, 1.9, 0, 3.8, 2.3, 2.1), B(COL.blue, -0.8, 1.9, 1.06, 3.0, 0.5, 0.01), B(COL.blue, -0.8, 1.9, -1.06, 3.0, 0.5, 0.01));
  }
  g.add(meshOf(parts));
  return g;
}

function buildShip() {
  const g = new THREE.Group();
  g.add(meshOf([
    B(0x2c3e50, 0, 1.0, 0, 5.6, 2.0, 17),
    B(0x2c3e50, 0, 1.0, 9.2, 3.9, 2.0, 2.4, 0, Math.PI / 4, 0),
    B(COL.red, 0, 0.15, 0, 5.62, 0.3, 17.02),
    B(0xd6d2c8, 0, 2.05, 0, 5.2, 0.1, 16.6),
    B(COL.white, 0, 3.4, -6.2, 4.4, 2.6, 3.6), B(0x9fd3ff, 0, 4.0, -4.39, 3.6, 0.7, 0.04),
    C(COL.red, 0, 5.4, -6.8, 0.45, 1.6),
  ], true, true));
  return g;
}

// бункер/домик для зон: просто навесы, чтобы зоны не выглядели пустыми
function buildShed(w, d, h, color) {
  const g = new THREE.Group();
  g.add(meshOf([
    B(COL.woodDark, w / 2 - 0.15, h / 2, d / 2 - 0.15, 0.2, h, 0.2), B(COL.woodDark, -w / 2 + 0.15, h / 2, d / 2 - 0.15, 0.2, h, 0.2),
    B(COL.woodDark, w / 2 - 0.15, h / 2, -d / 2 + 0.15, 0.2, h, 0.2), B(COL.woodDark, -w / 2 + 0.15, h / 2, -d / 2 + 0.15, 0.2, h, 0.2),
    B(color, 0, h + 0.1, 0, w + 0.6, 0.2, d + 0.6),
  ], true, true));
  return g;
}
