'use strict';
// Свои модели под сеттинг: пиломатериалы, деревообрабатывающие станки, прилавок, стеллажи, краны,
// небоскрёб, лесовоз. Строятся кодом из деталей с фасками. Цвет, поверхность (SURF из look.js) и
// затенение у земли лежат в вершинах — всё рисуется одним материалом MAT.flat и годится для InstancedMesh.
// В игре ставятся ключами 'own/…' в MODEL_OF (kmodels.js); список для витрины — OWN_GROUPS внизу.

// ───────── детали ─────────
const _ka = new THREE.Vector3(), _kb = new THREE.Vector3(), _kn = new THREE.Vector3();

// треугольник a,b,c ([x,y,z]) в список; dir — куда должна смотреть лицевая сторона
function kTri(out, a, b, c, dir) {
  _ka.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  _kb.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  _kn.crossVectors(_ka, _kb);
  if (_kn.lengthSq() < 1e-16) return;
  if (dir && _kn.x * dir[0] + _kn.y * dir[1] + _kn.z * dir[2] < 0) out.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
  else out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}
function kQuad(out, a, b, c, d, dir) { kTri(out, a, b, c, dir); kTri(out, a, c, d, dir); }

// коробка w×h×d по центру со скошенными рёбрами b
function gBox(w, h, d, b = 0) {
  const H = [w / 2, h / 2, d / 2], o = [];
  b = Math.max(0, Math.min(b, H[0] * 0.9, H[1] * 0.9, H[2] * 0.9));
  for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
    const u = (a + 1) % 3, v = (a + 2) % 3;
    const pt = (su, sv) => { const p = [0, 0, 0]; p[a] = s * H[a]; p[u] = su * (H[u] - b); p[v] = sv * (H[v] - b); return p; };
    const dir = [0, 0, 0]; dir[a] = s;
    kQuad(o, pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1), dir);
  }
  if (b > 1e-5) {
    for (let a = 0; a < 3; a++) {
      const u = (a + 1) % 3, v = (a + 2) % 3;
      for (const su of [-1, 1]) for (const sv of [-1, 1]) {
        const pt = (sa, onU) => {
          const p = [0, 0, 0]; p[a] = sa * (H[a] - b);
          if (onU) { p[u] = su * H[u]; p[v] = sv * (H[v] - b); } else { p[u] = su * (H[u] - b); p[v] = sv * H[v]; }
          return p;
        };
        const dir = [0, 0, 0]; dir[u] = su; dir[v] = sv;
        kQuad(o, pt(-1, true), pt(1, true), pt(1, false), pt(-1, false), dir);
      }
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      kTri(o, [sx * H[0], sy * (H[1] - b), sz * (H[2] - b)], [sx * (H[0] - b), sy * H[1], sz * (H[2] - b)], [sx * (H[0] - b), sy * (H[1] - b), sz * H[2]], [sx, sy, sz]);
    }
  }
  return o;
}

// тело вращения вокруг Y по профилю [[r, y], …]: тело — слева от направления обхода (внешний контур — снизу вверх)
function gLathe(prof, n = 12, phase = 0) {
  const o = [];
  for (let i = 0; i < n; i++) {
    const a0 = phase + (i / n) * Math.PI * 2, a1 = phase + ((i + 1) / n) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    for (let j = 0; j < prof.length - 1; j++) {
      const [r0, y0] = prof[j], [r1, y1] = prof[j + 1];
      const A = [r0 * c0, y0, r0 * s0], B = [r0 * c1, y0, r0 * s1], C = [r1 * c0, y1, r1 * s0], D = [r1 * c1, y1, r1 * s1];
      kTri(o, A, C, B); kTri(o, B, C, D);
    }
  }
  return o;
}

// цилиндр (или конус, если r2 ≠ r) по оси Y, по центру, с фаской b на торцах
function gCyl(r, h, n = 12, b = 0, r2 = r, phase = 0) {
  const y0 = -h / 2, y1 = h / 2;
  b = Math.min(b, r * 0.45, r2 * 0.45, h * 0.45);
  const p = [[0, y0]];
  if (b > 1e-5) p.push([r - b, y0], [r, y0 + b], [r2, y1 - b], [r2 - b, y1]); else p.push([r, y0], [r2, y1]);
  p.push([0, y1]);
  return gLathe(p, n, phase);
}

// призма: многоугольник [[x, y], …] в плоскости XY, вытянутый по Z на depth (по центру)
function gPrism(pts, depth) {
  const o = [];
  let P = pts.map(([x, y]) => new THREE.Vector2(x, y));
  if (THREE.ShapeUtils.isClockWise(P)) P = P.reverse();
  const z0 = -depth / 2, z1 = depth / 2;
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(P, [])) {
    kTri(o, [P[a].x, P[a].y, z1], [P[b].x, P[b].y, z1], [P[c].x, P[c].y, z1], [0, 0, 1]);
    kTri(o, [P[a].x, P[a].y, z0], [P[b].x, P[b].y, z0], [P[c].x, P[c].y, z0], [0, 0, -1]);
  }
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    kQuad(o, [p.x, p.y, z0], [q.x, q.y, z0], [q.x, q.y, z1], [p.x, p.y, z1], [q.y - p.y, p.x - q.x, 0]);
  }
  return o;
}

// труба от точки a до точки b радиусом r
function gTube(a, b, r, n = 8) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
  const g = gCyl(r, len, n, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1));
  const v = new THREE.Vector3();
  for (let i = 0; i < g.length; i += 3) { v.set(g[i], g[i + 1], g[i + 2]).applyMatrix4(m); g[i] = v.x; g[i + 1] = v.y; g[i + 2] = v.z; }
  return g;
}

// Набор деталей одной модели → одна геометрия (position, normal, color, surf, ring)
const _kq = new THREE.Quaternion(), _kq2 = new THREE.Quaternion(), _ke = new THREE.Euler(), _km = new THREE.Matrix4(), _kv = new THREE.Vector3();
const K_AXIS = { x: [0, 0, Math.PI / 2], z: [Math.PI / 2, 0, 0] };

class Kit {
  constructor(seed = 7) { this.P = []; this.C = []; this.S = []; this.R = []; this.rs = { s: seed }; }
  rnd() { return rngNext(this.rs); }

  // tris — позиции треугольников детали; o: at, rot [rx, ry, rz], axis 'x'|'z' (положить деталь вдоль оси),
  // scale [sx, sy, sz], surf, end (цвет торцов у дерева), grain (ось волокон детали 0/1/2), ring [a, b] (сдвиг
  // сердцевины поперёк волокон), jit (разброс яркости детали), fjit (разброс по граням)
  put(tris, color, o = {}) {
    const at = o.at || [0, 0, 0], r0 = o.rot || [0, 0, 0];
    _kq.setFromEuler(_ke.set(r0[0], r0[1], r0[2], 'YXZ'));   // сначала наклон, потом поворот вокруг вертикали
    if (o.axis) _kq.multiply(_kq2.setFromEuler(_ke.set(...K_AXIS[o.axis])));
    _km.compose(_kv.set(at[0], at[1], at[2]), _kq, new THREE.Vector3(...(o.scale || [1, 1, 1])));
    const j = o.jit ? 1 + (this.rnd() - 0.5) * 2 * o.jit : 1;
    const base = new THREE.Color(color).multiplyScalar(j);
    const endC = o.end !== undefined ? new THREE.Color(o.end).multiplyScalar(j) : null;
    let surf = o.surf || 0, ring = [0, 0], g = o.grain !== undefined ? o.grain : 1;
    if (surf === SURF.wood) {
      const la = new THREE.Vector3(g === 0 ? 1 : 0, g === 1 ? 1 : 0, g === 2 ? 1 : 0).applyQuaternion(_kq);
      const ax = Math.abs(la.x) >= Math.abs(la.y) && Math.abs(la.x) >= Math.abs(la.z) ? 0 : Math.abs(la.y) >= Math.abs(la.z) ? 1 : 2;
      surf = 1 + ax;
      const off = [0, 0, 0];
      if (o.ring) { off[(g + 1) % 3] = o.ring[0]; off[(g + 2) % 3] = o.ring[1]; }
      const c = new THREE.Vector3(...off).applyQuaternion(_kq).add(new THREE.Vector3(at[0], at[1], at[2]));
      ring = ax === 0 ? [c.y, c.z] : ax === 1 ? [c.x, c.z] : [c.x, c.y];
    }
    const fj = o.fjit ? new Map() : null;
    for (let i = 0; i < tris.length; i += 9) {
      let col = base, f = 1;
      if (endC || fj) {
        _ka.set(tris[i + 3] - tris[i], tris[i + 4] - tris[i + 1], tris[i + 5] - tris[i + 2]);
        _kb.set(tris[i + 6] - tris[i], tris[i + 7] - tris[i + 1], tris[i + 8] - tris[i + 2]);
        _kn.crossVectors(_ka, _kb).normalize();
        if (endC && Math.abs(g === 0 ? _kn.x : g === 1 ? _kn.y : _kn.z) > 0.7) col = endC;
        if (fj) {   // разброс по граням: у всех треугольников одной грани (одна нормаль) — один оттенок
          const key = Math.round(_kn.x * 20) + ',' + Math.round(_kn.y * 20) + ',' + Math.round(_kn.z * 20);
          if (!fj.has(key)) fj.set(key, 1 + (this.rnd() - 0.5) * 2 * o.fjit);
          f = fj.get(key);
        }
      }
      for (let k = 0; k < 9; k += 3) {
        _kv.set(tris[i + k], tris[i + k + 1], tris[i + k + 2]).applyMatrix4(_km);
        this.P.push(_kv.x, _kv.y, _kv.z);
        this.C.push(col.r * f, col.g * f, col.b * f);
        this.S.push(surf);
        this.R.push(ring[0], ring[1]);
      }
    }
    return this;
  }

  box(color, x, y, z, w, h, d, o = {}) {
    const b = o.b !== undefined ? o.b : Math.min(w, h, d) * 0.14;
    const grain = o.grain !== undefined ? o.grain : (w >= h && w >= d ? 0 : h >= d ? 1 : 2);
    return this.put(gBox(w, h, d, b), color, Object.assign({}, o, { at: [x, y, z], grain }));
  }
  // цилиндр по Y (axis: 'x' | 'z' — положить), r2 — радиус верха для конуса
  cyl(color, x, y, z, r, h, o = {}) {
    const b = o.b !== undefined ? o.b : Math.min(r, h) * 0.12;
    return this.put(gCyl(r, h, o.n || 12, b, o.r2 !== undefined ? o.r2 : r, o.phase || 0), color, Object.assign({ grain: 1 }, o, { at: [x, y, z] }));
  }
  lathe(color, x, y, z, prof, o = {}) { return this.put(gLathe(prof, o.n || 12, o.phase || 0), color, Object.assign({ grain: 1 }, o, { at: [x, y, z] })); }
  prism(color, x, y, z, pts, depth, o = {}) { return this.put(gPrism(pts, depth), color, Object.assign({ grain: 2 }, o, { at: [x, y, z] })); }
  tube(color, a, b, r, o = {}) { return this.put(gTube(a, b, r, o.n || 8), color, o); }
  // труба по ломаной с «коленами»
  pipe(color, pts, r, o = {}) {
    for (let i = 0; i < pts.length - 1; i++) this.tube(color, pts[i], pts[i + 1], r, o);
    for (let i = 1; i < pts.length - 1; i++) this.put(gCyl(r * 1.18, r * 2.3, o.n || 8, r * 0.3), color, Object.assign({}, o, { at: pts[i] }));
    return this;
  }

  // AO: [высота, множитель у земли] — затемнение низа модели, будто от контакта с полом
  geo(o = {}) {
    const n = this.P.length / 3;
    const pos = new Float32Array(this.P), col = new Float32Array(this.C);
    if (o.ao) {
      const [h, lo] = o.ao;
      const y0 = o.floor !== undefined ? o.floor : 0;
      for (let i = 0; i < n; i++) {
        const t = clamp((pos[i * 3 + 1] - y0) / h, 0, 1), s = lo + (1 - lo) * t * t * (3 - 2 * t);
        col[i * 3] *= s; col[i * 3 + 1] *= s; col[i * 3 + 2] *= s;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(this.S), 1));
    g.setAttribute('ring', new THREE.BufferAttribute(new Float32Array(this.R), 2));
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
  mesh(o = {}, shadow = true) {
    const m = new THREE.Mesh(this.geo(o), MAT.flat);
    m.castShadow = shadow; m.receiveShadow = true;
    return m;
  }
}

// ───────── палитра ─────────
const CR = {
  steel: 0xc6cbcf, steelDark: 0x80888f, iron: 0x4d545a, ironDark: 0x34393e, rubber: 0x232628,
  green: 0x4f7d5f, greenDark: 0x3a5f48, orange: 0xd8742a, orangeDark: 0xa9561f, yellow: 0xe3a91d,
  blue: 0x3d6b95, blueDark: 0x2e5275, red: 0xb5332a, cream: 0xe6dcc6,
  hazY: 0xe7b11c, hazK: 0x26282a, concrete: 0xb7b2a6, glass: 0x26343f,
  wood: 0xd3a266, woodLight: 0xe2bf88, woodEnd: 0xecd0a0, woodDark: 0x8d5d36, bark: 0x6b4a2e, barkEnd: 0xdcb07a,
};

// ───────── предметы ─────────
// Длинной стороной вдоль X, дном на y=0, по центру; размеры в плане — как у прежних, раскладка на площадках та же.

function ownLog() {
  const k = new Kit(19);
  k.cyl(CR.bark, 0, 0.165, 0, 0.165, 1.3, { axis: 'x', n: 9, b: 0.022, surf: SURF.wood, end: CR.barkEnd, fjit: 0.13 });
  return k.geo();
}

function ownBoard() {
  const k = new Kit(3);
  k.box(0xd9b079, 0, 0.045, 0, 1.3, 0.09, 0.3, { surf: SURF.wood, b: 0.012, end: CR.woodEnd, ring: [-0.3, 0.06] });
  return k.geo();
}

function ownBeam() {
  const k = new Kit(4);
  k.box(0xcf9a5b, 0, 0.09, 0, 1.3, 0.18, 0.18, { surf: SURF.wood, b: 0.018, end: 0xe6c089, ring: [0.01, -0.02] });
  return k.geo();
}

// мебельный щит: склеен из ламелей разного оттенка
function ownPanel() {
  const k = new Kit(5), n = 5, d = 0.62 / n;
  for (let i = 0; i < n; i++) {
    k.box(0xe0bd86, 0, 0.055, -0.31 + d * (i + 0.5), 1.1, 0.11, d - 0.003, { surf: SURF.wood, b: 0.005, jit: 0.08, end: CR.woodEnd, ring: [-0.18, (k.rnd() - 0.5) * 0.2] });
  }
  return k.geo();
}

// связка точёных ножек, перехвачена двумя стяжками
function ownLegs() {
  const k = new Kit(9);
  const prof = [[0, -0.35], [0.028, -0.35], [0.033, -0.31], [0.027, -0.22], [0.035, -0.14], [0.029, -0.07], [0.04, -0.02], [0.04, 0.14], [0.034, 0.17], [0.044, 0.2], [0.044, 0.35], [0, 0.35]];
  for (const [y, z] of [[0.046, -0.052], [0.046, 0.052], [0.136, -0.052], [0.136, 0.052]]) {
    k.lathe(0xd6a86c, 0, y, z, prof, { axis: 'x', n: 7, surf: SURF.wood, jit: 0.06, end: CR.woodEnd });
  }
  for (const x of [-0.19, 0.19]) k.box(0x3a4047, x, 0.091, 0, 0.03, 0.2, 0.225, { b: 0.008, surf: SURF.plastic });
  return k.geo();
}

// мешок опилок: мешковина, завязанное горло
function ownSawdust() {
  const k = new Kit(11);
  const prof = [[0, -0.3], [0.1, -0.3], [0.17, -0.27], [0.2, -0.18], [0.205, 0.04], [0.188, 0.16], [0.13, 0.24], [0.06, 0.28], [0.048, 0.3], [0.066, 0.33], [0.05, 0.352], [0, 0.352]];
  k.lathe(0xcdb991, 0, 0.176, 0, prof, { axis: 'x', n: 9, surf: SURF.cloth, scale: [0.86, 1, 1] });
  k.cyl(0x7c5b34, -0.3, 0.176, 0, 0.056, 0.026, { axis: 'x', n: 9, surf: SURF.cloth });
  return k.geo();
}

// пачка гофрокартона на двух стяжках
function ownCardboard() {
  const k = new Kit(13);
  for (let i = 0; i < 4; i++) k.box(0xc09e69, (k.rnd() - 0.5) * 0.03, 0.01 + i * 0.02, (k.rnd() - 0.5) * 0.03, 0.9, 0.018, 0.6, { surf: SURF.card, b: 0.003, jit: 0.05 });
  for (const x of [-0.26, 0.26]) k.box(0x39434b, x, 0.041, 0, 0.026, 0.09, 0.62, { b: 0.005, surf: SURF.plastic });
  return k.geo();
}

// пачка купюр с бандеролью
function ownBill() {
  const k = new Kit(17);
  k.box(0x7fa86a, 0, 0.02, 0, 0.4, 0.04, 0.2, { b: 0.006 });
  k.box(0xeee3c2, 0, 0.02, 0, 0.07, 0.042, 0.203, { b: 0.003 });
  return k.geo();
}

// ───────── части станков ─────────
// фундаментная плита станка
function kBase(k, w = 3.2, d = 2.4) {
  k.box(0x8f8b83, 0, 0.04, 0, w, 0.08, d, { surf: SURF.concrete, b: 0.035 });
}
// жёлто-чёрная полоса из отрезков вдоль оси (along 'x' | 'z'), на высоте y
function kHazard(k, x, y, z, len, along = 'x', w = 0.07, t = 0.012, seg = 0.14) {
  const n = Math.max(2, Math.round(len / seg));
  for (let i = 0; i < n; i++) {
    const c = i % 2 ? CR.hazK : CR.hazY, p = -len / 2 + (i + 0.5) * (len / n);
    if (along === 'x') k.box(c, x + p, y, z, len / n, t, w, { b: 0.002, surf: SURF.metal });
    else k.box(c, x, y, z + p, w, t, len / n, { b: 0.002, surf: SURF.metal });
  }
}
// рольганг от x0 до x1 (вдоль X), верх роликов на высоте h
function kConveyor(k, x0, x1, h = 0.42, w = 0.86) {
  const cx = (x0 + x1) / 2, L = x1 - x0;
  for (const z of [-w / 2, w / 2]) k.box(CR.iron, cx, h - 0.07, z, L, 0.1, 0.06, { surf: SURF.metal, b: 0.012 });
  const n = Math.max(3, Math.round(L / 0.24));
  for (let i = 0; i < n; i++) k.cyl(CR.steel, x0 + (i + 0.5) * (L / n), h - 0.045, 0, 0.045, w - 0.04, { axis: 'z', n: 8, surf: SURF.steel, b: 0.008 });
  for (const x of [x0 + 0.08, x1 - 0.08]) for (const z of [-w / 2, w / 2]) {
    k.box(CR.ironDark, x, (h - 0.12) / 2 + 0.04, z, 0.06, h - 0.12, 0.06, { surf: SURF.metal, b: 0.01 });
  }
}
// пульт на стойке: кнопки и «грибок» аварийной остановки
function kControl(k, x, z, ry = 0, h = 1.05) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (dx, dz) => [x + dx * c + dz * s, z - dx * s + dz * c];
  let p = at(0, 0);
  k.box(CR.iron, p[0], h / 2 + 0.05, p[1], 0.07, h - 0.1, 0.07, { surf: SURF.metal, rot: [0, ry, 0] });
  k.box(0xd7d9d6, p[0], h + 0.02, p[1], 0.34, 0.2, 0.2, { surf: SURF.metal, rot: [-0.35, ry, 0], b: 0.02 });
  p = at(-0.08, 0.06); k.cyl(0x3c9a4f, p[0], h + 0.1, p[1], 0.03, 0.03, { n: 8, surf: SURF.plastic, rot: [-0.35, ry, 0] });
  p = at(0.02, 0.06); k.cyl(0x333333, p[0], h + 0.1, p[1], 0.03, 0.03, { n: 8, surf: SURF.plastic, rot: [-0.35, ry, 0] });
  p = at(0.1, 0.05); k.cyl(0xc62a22, p[0], h + 0.12, p[1], 0.045, 0.04, { n: 10, surf: SURF.plastic, rot: [-0.35, ry, 0] });
}
// электродвигатель с рёбрами охлаждения, ось вдоль axis ('x' | 'z' | 'y')
function kMotor(k, x, y, z, r, len, axis = 'x', color = CR.blueDark) {
  const o = axis === 'y' ? {} : { axis };
  k.cyl(color, x, y, z, r, len, Object.assign({ n: 14, surf: SURF.metal, b: r * 0.2 }, o));
  const st = (v) => axis === 'x' ? [x + v, y, z] : axis === 'z' ? [x, y, z + v] : [x, y + v, z];
  for (let i = 0; i < 5; i++) { const p = st(-len * 0.35 + i * len * 0.17); k.cyl(color, p[0], p[1], p[2], r * 1.08, len * 0.06, Object.assign({ n: 14, surf: SURF.metal, b: 0.003 }, o)); }
  const e = st(len / 2 + 0.03); k.cyl(CR.steel, e[0], e[1], e[2], r * 0.18, 0.08, Object.assign({ n: 8, surf: SURF.steel }, o));
  k.box(color, x, y + r * 0.95, z, 0.12, 0.08, 0.12, { surf: SURF.metal, b: 0.015 });
}
// электрошкаф
function kCabinet(k, x, z, w, h, d, ry = 0) {
  k.box(0xc9cdc9, x, h / 2 + 0.08, z, w, h, d, { surf: SURF.metal, rot: [0, ry, 0], b: 0.02 });
  const c = Math.cos(ry), s = Math.sin(ry), f = d / 2 + 0.006;
  k.box(0xbfc4c0, x + s * f, h / 2 + 0.08, z + c * f, w - 0.06, h - 0.06, 0.012, { surf: SURF.metal, rot: [0, ry, 0], b: 0.004 });
  k.box(CR.ironDark, x + s * (f + 0.01) + c * (w / 2 - 0.08), h / 2 + 0.08, z + c * (f + 0.01) - s * (w / 2 - 0.08), 0.03, 0.14, 0.02, { surf: SURF.metal, rot: [0, ry, 0] });
  k.prism(CR.hazY, x + s * (f + 0.008), h * 0.72 + 0.08, z + c * (f + 0.008), [[-0.06, -0.05], [0.06, -0.05], [0, 0.06]], 0.006, { rot: [0, ry, 0] });
}

function kParts(meshes) { const g = new THREE.Group(); for (const m of meshes) if (m) g.add(m); return g; }

// кучка опилок или стружки: невысокий холмик
function kDust(k, x, z, r, h, color = 0xe4cb96, y = 0) {
  const p = [[0, 0], [r, 0], [r * 0.82, h * 0.22], [r * 0.55, h * 0.62], [r * 0.25, h * 0.92], [0, h]];
  k.lathe(color, x, y, z, p, { n: 9, surf: SURF.cloth, jit: 0.05, phase: k.rnd() * 3 });
}
// табличка с надписью (canvas) — отдельный меш, лицом к +Z
function signMesh(text, w, h, bg = '#5b3a22', fg = '#f3e6c8', size = 0.62) {
  const cv = document.createElement('canvas'), px = 128;
  cv.width = Math.round(px * w / h); cv.height = px;
  const x = cv.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < 6; i++) { x.fillStyle = `rgba(0,0,0,${0.05 + (i % 2) * 0.04})`; x.fillRect(0, (i / 6) * px, cv.width, 2); }
  x.fillStyle = fg;
  let fs = Math.round(px * size);
  x.font = `900 ${fs}px Nunito, 'Segoe UI', sans-serif`;
  const tw = x.measureText(text).width;
  if (tw > cv.width * 0.88) { fs = Math.floor(fs * cv.width * 0.88 / tw); x.font = `900 ${fs}px Nunito, 'Segoe UI', sans-serif`; }
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, cv.width / 2, px * 0.54);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), plainMaterial({ map: t, roughness: 0.85 }));
  m.castShadow = false; m.receiveShadow = true;
  return m;
}

// ───────── ленточная пилорама ─────────
// Бревно лежит на станине с рельсами, пильный портал с ленточной пилой ездит вдоль бревна.
function ownSaw() {
  const k = new Kit(21);
  kBase(k);
  // станина: две балки с рельсами на поперечинах и ножках
  for (const z of [-0.48, 0.48]) {
    k.box(CR.iron, 0, 0.44, z, 3.0, 0.14, 0.1, { surf: SURF.metal, b: 0.014 });
    k.box(CR.steel, 0, 0.525, z, 3.0, 0.03, 0.05, { surf: SURF.steel, b: 0.006 });
  }
  for (const x of [-1.38, -0.46, 0.46, 1.38]) {
    k.box(CR.iron, x, 0.33, 0, 0.12, 0.09, 1.16, { surf: SURF.metal, b: 0.012 });
    for (const z of [-0.48, 0.48]) {
      k.box(CR.ironDark, x, 0.2, z, 0.1, 0.24, 0.1, { surf: SURF.metal, b: 0.012 });
      k.box(CR.steelDark, x, 0.092, z, 0.2, 0.024, 0.2, { surf: SURF.steel, b: 0.006 });
    }
    // опоры бревна и упоры
    k.box(CR.ironDark, x, 0.56, 0, 0.14, 0.05, 0.62, { surf: SURF.metal, b: 0.01 });
    k.box(CR.yellow, x, 0.66, -0.36, 0.1, 0.22, 0.07, { surf: SURF.metal, b: 0.012 });
  }
  kHazard(k, 0, 0.472, 0.545, 2.9, 'x', 0.02, 0.1);
  kConveyor(k, -2.86, -1.62);
  kConveyor(k, 1.62, 2.86);
  kControl(k, -1.25, 0.95, 0.4);
  // опилки под пилой и вдоль станины
  kDust(k, -0.1, 0.72, 0.42, 0.2, 0xe4cb96, 0.08);
  kDust(k, 0.55, 0.62, 0.3, 0.13, 0xe4cb96, 0.08);
  kDust(k, -0.75, -0.7, 0.26, 0.1, 0xdcc08a, 0.08);
  const bed = k.mesh({ ao: [0.5, 0.58] });

  // пильный портал
  const p = new Kit(22);
  for (const z of [-0.9, 0.9]) {
    p.box(CR.orange, 0, 1.15, z, 0.3, 1.1, 0.18, { surf: SURF.metal, b: 0.03 });
    p.box(CR.iron, 0, 0.64, z * 0.76, 0.5, 0.12, 0.52, { surf: SURF.metal, b: 0.02 });
    for (const x of [-0.16, 0.16]) p.cyl(CR.steelDark, x, 0.595, z * 0.533, 0.055, 0.07, { axis: 'z', n: 10, surf: SURF.steel });
  }
  p.box(CR.orange, 0, 1.64, 0, 0.36, 0.16, 2.0, { surf: SURF.metal, b: 0.03 });
  kHazard(p, 0.19, 1.64, 0, 1.6, 'z', 0.012, 0.09);
  // кожухи шкивов («уши») и сама лента
  for (const z of [-0.6, 0.6]) {
    p.cyl(CR.orange, 0, 1.12, z, 0.36, 0.26, { axis: 'x', n: 18, surf: SURF.metal, b: 0.03 });
    p.cyl(CR.orangeDark, 0.135, 1.12, z, 0.3, 0.012, { axis: 'x', n: 18, surf: SURF.metal, b: 0.002 });
    p.cyl(CR.ironDark, 0.15, 1.12, z, 0.07, 0.04, { axis: 'x', n: 10, surf: SURF.metal });
  }
  p.box(CR.orange, 0, 1.12, 0, 0.26, 0.26, 0.6, { surf: SURF.metal, b: 0.03 });
  p.box(CR.steel, 0, 0.78, 0, 0.01, 0.05, 1.5, { surf: SURF.steel, b: 0 });
  for (const z of [-0.36, 0.36]) p.box(CR.iron, 0, 0.9, z, 0.1, 0.22, 0.08, { surf: SURF.metal, b: 0.012 });
  kMotor(p, 0.02, 1.86, 0.48, 0.13, 0.4, 'x', CR.ironDark);
  p.box(0xd7d9d6, -0.26, 1.32, 0.92, 0.12, 0.24, 0.2, { surf: SURF.metal, b: 0.02 });
  p.cyl(0xc62a22, -0.33, 1.38, 0.92, 0.035, 0.04, { axis: 'x', n: 10, surf: SURF.plastic });
  const portal = p.mesh();

  const l = new Kit(23);
  l.cyl(CR.bark, 0, 0, 0, 0.24, 2.7, { axis: 'x', n: 11, b: 0.03, surf: SURF.wood, end: CR.barkEnd, fjit: 0.1 });
  const log = l.mesh();
  log.position.set(0, 0.59 + 0.24, 0);
  log.visible = false;
  const g = kParts([bed, portal, log]);
  return { g, anim: (t, on) => { log.visible = on; portal.position.x = on ? Math.sin(t * 1.1) * 1.02 : -1.02; } };
}

// ───────── брусовальный станок ─────────
// Закрытый «тоннель»: бревно заходит через подающие вальцы, внутри пилы, выходит брус. Сверху аспирация.
function ownBeamer() {
  const k = new Kit(41);
  kBase(k);
  k.box(CR.greenDark, 0, 0.38, 0, 2.3, 0.6, 1.25, { surf: SURF.metal, b: 0.05 });
  k.box(CR.ironDark, 0, 0.1, 0, 2.2, 0.04, 1.15, { surf: SURF.metal, b: 0.01 });
  k.box(CR.green, 0, 1.1, 0, 1.55, 0.84, 1.42, { surf: SURF.metal, b: 0.07 });
  k.box(CR.greenDark, 0, 1.54, 0, 1.6, 0.05, 1.47, { surf: SURF.metal, b: 0.015 });
  for (const s of [-1, 1]) {
    k.box(0x16191b, s * 0.78, 0.9, 0, 0.02, 0.34, 0.5, { b: 0.004 });
    for (const [dy, dz, h, d] of [[0.19, 0, 0.04, 0.58], [-0.19, 0, 0.04, 0.58], [0, 0.27, 0.34, 0.04], [0, -0.27, 0.34, 0.04]]) {
      k.box(CR.hazY, s * 0.79, 0.9 + dy, dz, 0.025, h, d, { surf: SURF.metal, b: 0.004 });
    }
  }
  k.box(CR.ironDark, -0.1, 1.18, 0.715, 0.86, 0.38, 0.02, { surf: SURF.metal, b: 0.006 });
  k.box(CR.glass, -0.1, 1.18, 0.725, 0.76, 0.28, 0.01, { surf: SURF.glass, b: 0 });
  k.box(0xd8d2c0, 0.52, 1.3, 0.715, 0.2, 0.1, 0.012, { b: 0.003 });
  k.pipe(CR.steel, [[0.35, 1.56, -0.2], [0.35, 2.25, -0.2], [0.35, 2.25, -1.15]], 0.12, { surf: SURF.steel, n: 10 });
  k.cyl(CR.steel, 0.35, 1.62, -0.2, 0.16, 0.12, { n: 10, surf: SURF.steel });
  kMotor(k, -0.45, 0.46, -0.8, 0.17, 0.5, 'x', CR.greenDark);
  kCabinet(k, -1.25, -0.95, 0.5, 1.45, 0.3);
  kControl(k, -1.3, 0.98, 0.35);
  kConveyor(k, -2.86, -1.62);
  kConveyor(k, 1.62, 2.86);
  kDust(k, 0.95, 0.72, 0.24, 0.1, 0xe4cb96, 0.08);
  const body = k.mesh({ ao: [0.5, 0.58] });
  const kb = new Kit(43);
  for (const x of [-1.05, 1.05]) for (const z of [-0.36, 0.36]) kb.box(CR.greenDark, x, 0.88, z, 0.12, 0.5, 0.06, { surf: SURF.metal, b: 0.012 });
  const brackets = kb.mesh();
  const rolls = [];
  for (const x of [-1.05, 1.05]) for (const y of [0.74, 1.02]) {
    const r = new Kit(42);
    r.cyl(CR.steelDark, 0, 0, 0, 0.1, 0.62, { axis: 'z', n: 10, surf: SURF.steel, b: 0.01 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; r.box(CR.steel, Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0, 0.035, 0.035, 0.6, { surf: SURF.steel, b: 0.006, rot: [0, 0, a] }); }
    const m = r.mesh(); m.position.set(x, y, 0); rolls.push(m);
  }
  const bk = new Kit(44);
  bk.box(0xcf9a5b, 0, 0, 0, 1.2, 0.2, 0.2, { surf: SURF.wood, b: 0.02, end: 0xe6c089 });
  const beam = bk.mesh(); beam.position.set(2.2, 0.52, 0); beam.visible = false;
  return { g: kParts([body, brackets, beam, ...rolls]), anim: (t, on) => {
    beam.visible = on;
    if (on) { for (const r of rolls) r.rotation.z -= 0.12; beam.position.x = 1.7 + ((t * 0.5) % 1); }
  } };
}

// ───────── токарный станок ─────────
function ownLathe() {
  const k = new Kit(51);
  kBase(k);
  for (const x of [-0.95, 0.95]) {
    k.box(CR.greenDark, x, 0.44, 0, 0.44, 0.72, 0.56, { surf: SURF.metal, b: 0.05 });
    k.box(CR.ironDark, x, 0.11, 0, 0.52, 0.06, 0.64, { surf: SURF.metal, b: 0.015 });
  }
  k.box(CR.greenDark, 0, 0.3, 0, 1.5, 0.05, 0.4, { surf: SURF.metal, b: 0.01 });
  k.box(CR.green, 0, 0.87, 0, 2.6, 0.16, 0.42, { surf: SURF.metal, b: 0.03 });
  for (const z of [-0.13, 0.13]) k.box(CR.steel, 0, 0.965, z, 2.6, 0.03, 0.08, { surf: SURF.steel, b: 0.006 });
  // передняя бабка, кожух ремня, мотор, шпиндель с планшайбой
  k.box(CR.green, -1.02, 1.24, 0, 0.5, 0.52, 0.5, { surf: SURF.metal, b: 0.06 });
  k.cyl(CR.green, -1.12, 1.52, -0.02, 0.2, 0.44, { axis: 'z', n: 14, surf: SURF.metal, b: 0.03 });
  kMotor(k, -1.05, 1.2, -0.55, 0.14, 0.32, 'z', CR.greenDark);
  k.cyl(CR.steel, -0.72, 1.24, 0, 0.06, 0.12, { axis: 'x', n: 10, surf: SURF.steel });
  k.cyl(CR.iron, -0.64, 1.24, 0, 0.16, 0.04, { axis: 'x', n: 14, surf: SURF.metal });
  // задняя бабка с пинолью и маховичком
  k.box(CR.green, 0.95, 1.12, 0, 0.3, 0.3, 0.34, { surf: SURF.metal, b: 0.04 });
  k.cyl(CR.steel, 0.74, 1.24, 0, 0.035, 0.16, { axis: 'x', n: 8, surf: SURF.steel });
  k.cyl(CR.steel, 1.12, 1.24, 0, 0.02, 0.06, { axis: 'x', n: 8, surf: SURF.steel });
  k.cyl(CR.ironDark, 1.16, 1.24, 0, 0.12, 0.03, { axis: 'x', n: 14, surf: SURF.metal });
  k.cyl(CR.ironDark, 1.2, 1.33, 0, 0.015, 0.1, { axis: 'x', n: 6, surf: SURF.metal });
  // подручник
  k.box(CR.iron, 0.05, 1.03, 0.16, 0.2, 0.1, 0.3, { surf: SURF.metal, b: 0.02 });
  k.cyl(CR.iron, 0.05, 1.12, 0.22, 0.03, 0.14, { n: 8, surf: SURF.metal });
  k.box(CR.steel, 0.05, 1.2, 0.22, 0.9, 0.025, 0.05, { surf: SURF.steel, b: 0.006 });
  // лампа на кронштейне
  k.pipe(CR.ironDark, [[-1.2, 1.5, -0.2], [-1.2, 1.95, -0.2], [-0.8, 2.08, 0.05]], 0.02, { n: 6, surf: SURF.metal });
  k.cyl(CR.yellow, -0.8, 1.99, 0.05, 0.13, 0.14, { r2: 0.05, n: 12, surf: SURF.metal });
  // стружка
  kDust(k, -0.2, 0.46, 0.4, 0.1, 0xecd6a4, 0.08);
  kDust(k, 0.35, 0.62, 0.22, 0.07, 0xecd6a4, 0.08);
  for (let i = 0; i < 10; i++) k.cyl(0xf0dcae, (k.rnd() - 0.5) * 1.4, 0.1, 0.35 + k.rnd() * 0.5, 0.012, 0.18, { axis: 'x', rot: [0, k.rnd() * 3, k.rnd()], n: 5, surf: SURF.wood });
  kControl(k, 1.35, 0.8, -0.3, 1.0);
  kConveyor(k, -2.86, -1.62);
  kConveyor(k, 1.62, 2.86);
  const body = k.mesh({ ao: [0.5, 0.58] });
  const w = new Kit(52);
  w.lathe(0xd8ab70, 0, 0, 0, [[0, -0.66], [0.07, -0.66], [0.075, -0.5], [0.06, -0.38], [0.08, -0.24], [0.062, -0.1], [0.085, 0.04], [0.085, 0.3], [0.07, 0.36], [0.09, 0.44], [0.09, 0.66], [0, 0.66]],
    { axis: 'x', n: 8, surf: SURF.wood, end: CR.woodEnd });
  const work = w.mesh(); work.position.set(0.04, 1.24, 0);
  return { g: kParts([body, work]), anim: (t, on) => { if (on) work.rotation.x += 0.45; } };
}

// ───────── клеильный пресс ─────────
// Три П-рамы с гидроцилиндрами, прижимная траверса, щит из ламелей на столе
function ownPress() {
  const k = new Kit(61);
  kBase(k);
  k.box(CR.blueDark, 0, 0.34, 0, 2.6, 0.52, 1.5, { surf: SURF.metal, b: 0.05 });
  k.box(CR.steel, 0, 0.62, 0, 2.5, 0.04, 1.4, { surf: SURF.steel, b: 0.01 });
  for (const x of [-0.95, 0, 0.95]) {
    for (const z of [-0.74, 0.74]) k.box(CR.blue, x, 1.3, z, 0.15, 1.36, 0.15, { surf: SURF.metal, b: 0.025 });
    k.box(CR.blue, x, 2.02, 0, 0.2, 0.22, 1.66, { surf: SURF.metal, b: 0.03 });
    k.cyl(CR.red, x, 2.28, 0, 0.1, 0.32, { n: 12, surf: SURF.metal, b: 0.02 });
    k.cyl(CR.ironDark, x, 2.46, 0, 0.06, 0.05, { n: 10, surf: SURF.metal });
    k.pipe(CR.rubber, [[0.5, 0.56, -0.98], [x, 0.9, -0.95], [x, 2.22, -0.95], [x, 2.22, -0.12]], 0.022, { surf: SURF.rubber, n: 6 });
  }
  kHazard(k, 0, 0.47, 0.755, 2.4, 'x', 0.012, 0.1);
  // гидростанция сзади
  k.box(CR.iron, 0.3, 0.32, -0.98, 1.0, 0.46, 0.34, { surf: SURF.metal, b: 0.04 });
  kMotor(k, 0.15, 0.66, -0.98, 0.12, 0.34, 'x', CR.blueDark);
  k.cyl(0xe8e4d8, 0.68, 0.42, -0.8, 0.05, 0.02, { axis: 'z', n: 12, surf: SURF.plastic });
  kControl(k, 1.3, 0.95, -0.35);
  kConveyor(k, -2.86, -1.62);
  kConveyor(k, 1.62, 2.86);
  const body = k.mesh({ ao: [0.5, 0.58] });
  const r = new Kit(62);
  r.box(CR.yellow, 0, 0, 0, 2.4, 0.12, 0.36, { surf: SURF.metal, b: 0.025 });
  for (const x of [-0.95, 0, 0.95]) {
    r.box(CR.ironDark, x, -0.2, 0, 0.24, 0.28, 0.32, { surf: SURF.metal, b: 0.02 });
    r.cyl(CR.steel, x, 0.56, 0, 0.04, 1.0, { n: 8, surf: SURF.steel });
  }
  const ram = r.mesh(); ram.position.y = 1.35;
  const s = new Kit(63);
  for (let i = 0; i < 6; i++) s.box(0xe0bd86, 0, 0.035, -0.5 + i * 0.2, 2.2, 0.07, 0.195, { surf: SURF.wood, b: 0.006, jit: 0.08, end: CR.woodEnd, ring: [-0.15, (s.rnd() - 0.5) * 0.2] });
  const shield = s.mesh(); shield.position.y = 0.64; shield.visible = false;
  return { g: kParts([body, ram, shield]), anim: (t, on) => {
    shield.visible = on;
    ram.position.y = on ? 1.1 + Math.abs(Math.sin(t * 1.6)) * 0.25 : 1.35;
  } };
}

// ───────── верстак ─────────
// Столярный верстак из бруса с тисками и инструментом; на нём — изделие, которое собирают (id станка)
function ownBench(id) {
  const k = new Kit(71);
  kBase(k);
  for (const x of [-1.25, 1.25]) for (const z of [-0.46, 0.46]) k.box(CR.woodDark, x, 0.5, z, 0.12, 0.84, 0.12, { surf: SURF.wood, b: 0.012 });
  for (const z of [-0.46, 0.46]) k.box(CR.woodDark, 0, 0.78, z, 2.4, 0.1, 0.06, { surf: SURF.wood, b: 0.01 });
  for (const x of [-1.25, 1.25]) k.box(CR.woodDark, x, 0.24, 0, 0.06, 0.08, 0.86, { surf: SURF.wood, b: 0.01 });
  k.box(0xa8784a, 0, 0.28, 0, 2.5, 0.035, 0.98, { surf: SURF.wood, b: 0.006 });
  for (let i = 0; i < 3; i++) k.box(0xd9b079, (i - 1) * 0.12, 0.32 + i * 0.045, 0.1, 1.8, 0.045, 0.2, { surf: SURF.wood, b: 0.008, jit: 0.06, rot: [0, 0.05 * (i - 1), 0], end: CR.woodEnd });
  for (let i = 0; i < 6; i++) k.box(0xd8b27c, 0, 0.945, -0.5 + i * 0.2, 2.9, 0.09, 0.198, { surf: SURF.wood, b: 0.008, jit: 0.05, end: 0xe8c898, ring: [-0.2, (k.rnd() - 0.5) * 0.3] });
  // тиски: торцевые справа и передние слева
  k.box(0xc79a62, 1.52, 0.9, 0.3, 0.14, 0.16, 0.42, { surf: SURF.wood, b: 0.015 });
  k.cyl(CR.steel, 1.64, 0.9, 0.3, 0.022, 0.16, { axis: 'x', n: 8, surf: SURF.steel });
  k.cyl(CR.steel, 1.72, 0.9, 0.3, 0.014, 0.34, { axis: 'z', n: 6, surf: SURF.steel });
  k.box(0xc79a62, -0.95, 0.9, 0.66, 0.44, 0.16, 0.1, { surf: SURF.wood, b: 0.015 });
  k.cyl(CR.steel, -0.95, 0.9, 0.76, 0.022, 0.14, { axis: 'z', n: 8, surf: SURF.steel });
  k.cyl(CR.steel, -0.95, 0.9, 0.84, 0.014, 0.34, { axis: 'x', n: 6, surf: SURF.steel });
  // инструмент на столешнице
  const T = 0.99;
  k.box(0xb5834f, -0.55, T + 0.035, -0.3, 0.3, 0.07, 0.08, { surf: SURF.wood, b: 0.012, rot: [0, 0.3, 0] });
  k.box(0x6d4a2c, -0.62, T + 0.09, -0.33, 0.08, 0.06, 0.03, { surf: SURF.wood, b: 0.008, rot: [0, 0.3, 0] });
  k.box(CR.steel, 0.95, T + 0.004, -0.4, 0.4, 0.008, 0.04, { surf: SURF.steel, b: 0 });
  k.box(CR.steel, 1.13, T + 0.004, -0.27, 0.04, 0.008, 0.3, { surf: SURF.steel, b: 0 });
  for (let i = 0; i < 3; i++) {
    k.box(CR.steel, 1.05 + i * 0.07, T + 0.008, 0.18, 0.02, 0.012, 0.14, { surf: SURF.steel, b: 0 });
    k.box(0xa4452b, 1.05 + i * 0.07, T + 0.015, 0.3, 0.03, 0.03, 0.12, { surf: SURF.wood, b: 0.008 });
  }
  k.cyl(0xf2eee4, -1.25, T + 0.07, 0.35, 0.05, 0.14, { n: 10, surf: SURF.plastic });
  k.cyl(CR.orange, -1.25, T + 0.155, 0.35, 0.03, 0.03, { n: 8, surf: SURF.plastic });
  k.box(CR.yellow, -1.08, T + 0.03, 0.1, 0.08, 0.06, 0.08, { surf: SURF.plastic, b: 0.015 });
  for (const [x, z] of [[-0.2, -0.42], [0.35, -0.45]]) {
    k.box(CR.steelDark, x, T + 0.18, z, 0.03, 0.36, 0.05, { surf: SURF.steel, b: 0.004 });
    k.box(CR.red, x + 0.06, T + 0.33, z, 0.14, 0.05, 0.06, { surf: SURF.metal, b: 0.01 });
    k.box(CR.red, x + 0.06, T + 0.06, z, 0.14, 0.05, 0.06, { surf: SURF.metal, b: 0.01 });
  }
  // перфопанель с инструментом у задней кромки
  for (const x of [-1.25, 1.25]) k.box(CR.woodDark, x, 1.55, -0.62, 0.07, 1.1, 0.07, { surf: SURF.wood, b: 0.01 });
  k.box(0xc9a877, 0, 1.55, -0.62, 2.5, 0.95, 0.025, { surf: SURF.wood, b: 0.004, grain: 0 });
  k.prism(CR.steel, -0.72, 1.62, -0.6, [[-0.3, -0.06], [0.28, -0.11], [0.28, 0.02], [-0.3, 0.05]], 0.004, { surf: SURF.steel });
  k.box(0x8a4b2a, -1.07, 1.62, -0.6, 0.13, 0.13, 0.03, { surf: SURF.wood, b: 0.012 });
  for (const [x, c] of [[-0.3, CR.iron], [-0.1, CR.steelDark]]) {
    k.box(0xb07a45, x, 1.5, -0.6, 0.035, 0.34, 0.03, { surf: SURF.wood, b: 0.006 });
    k.box(c, x, 1.69, -0.6, 0.16, 0.05, 0.05, { surf: SURF.steel, b: 0.01 });
  }
  for (let i = 0; i < 4; i++) {
    const x = 0.2 + i * 0.09;
    k.box([CR.red, CR.yellow, CR.blue, CR.red][i], x, 1.73, -0.6, 0.03, 0.1, 0.03, { surf: SURF.plastic, b: 0.006 });
    k.box(CR.steel, x, 1.61, -0.6, 0.008, 0.14, 0.008, { surf: SURF.steel, b: 0 });
  }
  k.box(CR.steel, 0.88, 1.43, -0.6, 0.35, 0.03, 0.006, { surf: SURF.steel, b: 0 });
  k.box(CR.steel, 0.72, 1.58, -0.6, 0.03, 0.3, 0.006, { surf: SURF.steel, b: 0 });
  kDust(k, 0.4, 0.75, 0.3, 0.07, 0xecd6a4, 0.08);
  const body = k.mesh({ ao: [0.45, 0.6] });
  const parts = [body];
  // изделие в работе
  const what = { benchC: 'chair', benchT: 'table', benchW: 'wardrobe' }[id];
  if (what && typeof ITEM_VIS !== 'undefined' && ITEM_VIS[what]) {
    const geo = ITEM_VIS[what].geo;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox, it = new THREE.Mesh(geo, MAT.flat);
    it.castShadow = true;
    if (what === 'table') { it.rotation.x = Math.PI; it.position.set(0.25, T + bb.max.y, 0.02); }
    else if (what === 'wardrobe') { it.rotation.x = -Math.PI / 2; it.position.set(0.25, T - bb.min.z, (bb.max.y - bb.min.y) / 2 - 0.1); }
    else it.position.set(0.25, T, 0.05);
    parts.push(it);
  }
  // киянка: стучит, пока идёт сборка
  const hk = new Kit(72);
  hk.box(0xb07a45, -0.14, 0, 0, 0.28, 0.03, 0.03, { surf: SURF.wood, b: 0.006 });
  hk.box(0x8a5a33, -0.31, 0, 0, 0.09, 0.1, 0.15, { surf: SURF.wood, b: 0.015, grain: 2 });
  const mallet = hk.mesh();
  mallet.position.set(1.0, T + 0.05, 0.2);
  parts.push(mallet);
  return { g: kParts(parts), anim: (t, on) => { mallet.rotation.z = on ? -Math.abs(Math.sin(t * 6)) * 0.9 : 0; } };
}

// ───────── картонная машина ─────────
// Бункер опилок → котёл-разбиватель → сушильные барабаны → рулон картона
function ownPaper() {
  const k = new Kit(81);
  kBase(k);
  for (const x of [-1.3, -0.62]) for (const z of [-0.36, 0.36]) k.box(CR.iron, x, 0.7, z, 0.08, 1.24, 0.08, { surf: SURF.metal, b: 0.01 });
  k.cyl(CR.blue, -0.96, 1.62, 0, 0.12, 0.62, { r2: 0.62, n: 4, phase: Math.PI / 4, surf: SURF.metal, b: 0.01 });
  k.box(CR.blue, -0.96, 2.12, 0, 0.88, 0.4, 0.88, { surf: SURF.metal, b: 0.03 });
  kHazard(k, -0.96, 2.2, 0.445, 0.84, 'x', 0.012, 0.06);
  k.tube(CR.steel, [-0.96, 1.3, 0], [-0.4, 0.95, 0], 0.09, { surf: SURF.steel, n: 10 });
  k.cyl(CR.blueDark, -0.12, 0.92, 0, 0.42, 1.1, { axis: 'z', n: 16, surf: SURF.metal, b: 0.05 });
  for (const z of [-0.4, 0.4]) k.box(CR.iron, -0.12, 0.35, z, 0.7, 0.5, 0.1, { surf: SURF.metal, b: 0.02 });
  k.cyl(CR.iron, -0.12, 1.36, 0.1, 0.12, 0.1, { n: 12, surf: SURF.metal });
  k.cyl(0xe8e4d8, 0.16, 1.05, 0.56, 0.06, 0.02, { axis: 'z', n: 12, surf: SURF.plastic });
  for (const z of [-0.62, 0.62]) k.box(CR.blue, 0.85, 0.8, z, 1.25, 0.62, 0.08, { surf: SURF.metal, b: 0.02 });
  k.box(0xc4a06a, 0.85, 1.19, 0, 1.15, 0.01, 1.0, { surf: SURF.card, b: 0 });
  for (const x of [0.25, 1.45]) for (const z of [-0.6, 0.6]) k.box(CR.iron, x, 1.4, z, 0.06, 0.8, 0.06, { surf: SURF.metal, b: 0.01 });
  k.cyl(CR.iron, 0.85, 1.94, 0, 0.92, 0.3, { r2: 0.2, n: 4, phase: Math.PI / 4, surf: SURF.metal, b: 0.01 });
  k.cyl(CR.steel, 0.85, 2.55, 0, 0.13, 0.95, { n: 10, surf: SURF.steel });
  for (const z of [-0.55, 0.55]) k.box(CR.iron, 1.42, 0.45, z, 0.1, 0.6, 0.08, { surf: SURF.metal, b: 0.01 });
  kControl(k, 1.35, 0.95, -0.4);
  kConveyor(k, -2.86, -1.62);
  kConveyor(k, 1.62, 2.86);
  const body = k.mesh({ ao: [0.5, 0.58] });
  const rolls = [];
  for (const x of [0.45, 0.85, 1.25]) {
    const r = new Kit(82);
    r.cyl(CR.steel, 0, 0, 0, 0.18, 1.14, { axis: 'z', n: 14, surf: SURF.steel, b: 0.02 });
    r.cyl(CR.ironDark, 0, 0, 0, 0.05, 1.3, { axis: 'z', n: 8, surf: SURF.metal });
    const m = r.mesh(); m.position.set(x, 1.0, 0); rolls.push(m);
  }
  const rk = new Kit(83);
  rk.cyl(0xc4a06a, 0, 0, 0, 0.3, 1.0, { axis: 'z', n: 16, surf: SURF.card, b: 0.02 });
  rk.cyl(CR.ironDark, 0, 0, 0, 0.06, 1.16, { axis: 'z', n: 8, surf: SURF.metal });
  const roll = rk.mesh(); roll.position.set(1.42, 0.8, 0);
  return { g: kParts([body, roll, ...rolls]), anim: (t, on) => { if (on) { for (const r of rolls) r.rotation.z -= 0.2; roll.rotation.z -= 0.05; } } };
}

// ───────── коробочный станок ─────────
// Вырубной пресс штампует развёртки коробок; рядом стопки картона и готовых заготовок
function ownBoxer() {
  const k = new Kit(91);
  kBase(k);
  k.box(CR.iron, 0, 0.46, 0, 2.1, 0.76, 1.3, { surf: SURF.metal, b: 0.05 });
  k.box(CR.steel, 0, 0.87, 0, 2.1, 0.04, 1.3, { surf: SURF.steel, b: 0.01 });
  kHazard(k, 0, 0.62, 0.655, 2.0, 'x', 0.012, 0.1);
  for (const x of [-0.5, 0.5]) for (const z of [-0.45, 0.45]) k.cyl(CR.steel, x, 1.4, z, 0.05, 1.04, { n: 10, surf: SURF.steel });
  k.box(CR.orange, 0, 1.98, 0, 1.25, 0.2, 1.1, { surf: SURF.metal, b: 0.04 });
  k.cyl(CR.red, 0, 2.38, 0, 0.16, 0.6, { n: 14, surf: SURF.metal, b: 0.02 });
  for (let i = 0; i < 6; i++) k.box(0xc09e69, 0.85 + (k.rnd() - 0.5) * 0.04, 0.9 + i * 0.03, -0.25 + (k.rnd() - 0.5) * 0.04, 0.34, 0.028, 0.6, { surf: SURF.card, b: 0.004, jit: 0.04 });
  for (let i = 0; i < 4; i++) k.box(0xbf9d68, -0.8, 0.9 + i * 0.022, 0.1, 0.4, 0.02, 0.62, { surf: SURF.card, b: 0.003, jit: 0.04 });
  kControl(k, -1.2, 0.95, 0.3);
  kControl(k, 1.3, 0.95, -0.3);
  kConveyor(k, -2.86, -1.62);
  kConveyor(k, 1.62, 2.86);
  const body = k.mesh({ ao: [0.5, 0.58] });
  const sk = new Kit(92);
  sk.box(0xc6a570, 0, 0, 0, 0.5, 0.012, 0.5, { surf: SURF.card, b: 0.002 });
  for (const [x, z, w, d] of [[0.37, 0, 0.24, 0.5], [-0.37, 0, 0.24, 0.5], [0, 0.37, 0.5, 0.24], [0, -0.37, 0.5, 0.24]]) sk.box(0xc6a570, x, 0, z, w - 0.01, 0.012, d - 0.01, { surf: SURF.card, b: 0.002 });
  const sheet = sk.mesh(); sheet.position.set(0, 0.896, 0);
  const dk = new Kit(93);
  dk.box(CR.ironDark, 0, 0, 0, 1.1, 0.12, 0.92, { surf: SURF.metal, b: 0.02 });
  dk.cyl(CR.steel, 0, 0.61, 0, 0.07, 1.1, { n: 10, surf: SURF.steel });
  const die = dk.mesh(); die.position.y = 1.55;
  return { g: kParts([body, sheet, die]), anim: (t, on) => { die.position.y = on ? 1.02 + Math.abs(Math.cos(t * 2.4)) * 0.5 : 1.55; } };
}

// ───────── упаковка ─────────
// Роликовый стол через станок, скотч-машина над ним, стойка стрейч-плёнки; коробка едет по столу
function ownPacker() {
  const k = new Kit(101);
  kBase(k);
  kConveyor(k, -1.5, 1.5, 0.78, 1.0);
  for (const x of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) k.box(CR.ironDark, x, 0.4, z, 0.06, 0.64, 0.06, { surf: SURF.metal, b: 0.01 });
  for (const z of [-0.62, 0.62]) {
    k.box(CR.blue, 0.25, 1.25, z, 0.16, 1.0, 0.12, { surf: SURF.metal, b: 0.02 });
    // прижимной ремень на двух роликах, кронштейн к стойке
    k.box(CR.rubber, 0.25, 1.0, z * 0.86, 0.5, 0.18, 0.04, { surf: SURF.rubber, b: 0.01 });
    for (const x of [0.0, 0.5]) k.cyl(CR.steelDark, x, 1.0, z * 0.86, 0.035, 0.22, { n: 8, surf: SURF.steel });
    k.box(CR.iron, 0.25, 1.12, z * 0.93, 0.56, 0.04, 0.06, { surf: SURF.metal, b: 0.008 });
  }
  k.box(CR.blue, 0.25, 1.8, 0, 0.3, 0.14, 1.36, { surf: SURF.metal, b: 0.03 });
  k.box(CR.iron, 0.25, 1.6, 0, 0.36, 0.22, 0.36, { surf: SURF.metal, b: 0.03 });
  k.cyl(0x9b6b34, 0.25, 1.62, 0.26, 0.12, 0.06, { axis: 'z', n: 14, surf: SURF.plastic });
  k.cyl(CR.iron, -1.1, 0.9, -0.85, 0.05, 1.64, { n: 8, surf: SURF.metal });
  k.cyl(CR.iron, -1.1, 0.11, -0.85, 0.25, 0.06, { n: 12, surf: SURF.metal });
  k.cyl(0xe9ece8, -1.1, 1.1, -0.72, 0.075, 0.5, { n: 12, surf: SURF.plastic });
  for (let i = 0; i < 5; i++) k.box(0xc09e69, 1.1, 0.12 + i * 0.03, -0.85, 0.6, 0.028, 0.4, { surf: SURF.card, b: 0.004, jit: 0.04 });
  kControl(k, 1.35, 0.95, -0.3);
  kConveyor(k, -2.86, -1.62);
  kConveyor(k, 1.62, 2.86);
  const body = k.mesh({ ao: [0.5, 0.58] });
  const bx = new Kit(102);
  bx.box(0xc6a26c, 0, 0.22, 0, 0.6, 0.44, 0.52, { surf: SURF.card, b: 0.012 });
  bx.box(0x9b6b34, 0, 0.442, 0, 0.62, 0.004, 0.1, { b: 0 });
  const box = bx.mesh(); box.position.set(-0.6, 0.78, 0);
  return { g: kParts([body, box]), anim: (t, on) => { box.position.x = on ? -1.2 + ((t * 0.45) % 1) * 2.4 : -0.6; } };
}

// ───────── прилавок досок ─────────
// Павильон: прилавок из досок, навес из профлиста на брусе, вывеска смотрит на камеру (юг)
function ownStall() {
  const k = new Kit(111);
  k.box(0xb8894f, 0, 0.5, 0, 1.3, 0.98, 5.8, { surf: SURF.wood, b: 0.02, grain: 2 });
  for (let i = 0; i < 12; i++) k.box(0xc79a62, 0.665, 0.5, -2.75 + i * 0.5, 0.03, 0.94, 0.47, { surf: SURF.wood, b: 0.008, jit: 0.07, grain: 1 });
  k.box(0xd9b27c, 0.05, 1.02, 0, 1.5, 0.06, 6.0, { surf: SURF.wood, b: 0.012, grain: 2 });
  for (const z of [-2.85, 2.85]) {
    k.box(CR.woodDark, 0.62, 1.45, z, 0.14, 2.9, 0.14, { surf: SURF.wood, b: 0.015 });
    k.box(CR.woodDark, -0.62, 1.25, z, 0.14, 2.5, 0.14, { surf: SURF.wood, b: 0.015 });
  }
  const tilt = Math.atan2(0.4, 1.24);
  for (const [x, y] of [[0.62, 2.87], [-0.62, 2.47]]) k.box(CR.woodDark, x, y, 0, 0.12, 0.14, 6.0, { surf: SURF.wood, b: 0.012 });
  k.box(0x7d3a2c, 0, 2.74, 0, 1.95, 0.04, 6.5, { rot: [0, 0, tilt], surf: SURF.metal, b: 0.01 });
  for (let i = 0; i < 13; i++) k.box(0x8e4331, 0, 2.775, -3.0 + i * 0.5, 1.95, 0.035, 0.07, { rot: [0, 0, tilt], surf: SURF.metal, b: 0.008 });
  k.box(0x5b3a22, 0, 2.3, 2.955, 1.5, 0.48, 0.05, { surf: SURF.wood, b: 0.01, grain: 0 });
  // касса, складной метр, образцы досок на прилавке
  k.box(CR.iron, 0.25, 1.11, 2.1, 0.34, 0.12, 0.3, { surf: SURF.metal, b: 0.03 });
  k.box(0xd7d9d6, 0.25, 1.2, 2.04, 0.3, 0.06, 0.14, { surf: SURF.plastic, b: 0.015, rot: [-0.4, 0, 0] });
  k.box(CR.yellow, 0.3, 1.056, -1.3, 0.5, 0.012, 0.04, { rot: [0, 0.4, 0], surf: SURF.plastic, b: 0.002 });
  for (let i = 0; i < 2; i++) k.box(0xd9b079, -0.15 + i * 0.3, 1.075, 0.3, 0.26, 0.05, 1.3, { surf: SURF.wood, b: 0.008, jit: 0.06, end: CR.woodEnd, grain: 2 });
  const sign = signMesh('ДОСКИ · БРУС', 1.4, 0.4);
  sign.position.set(0, 2.3, 2.985);
  return { g: kParts([k.mesh({ ao: [0.4, 0.62] }), sign]), anim: () => {} };
}

// ───────── стеллаж магазина ─────────
// Складской стеллаж: синие стойки, оранжевые балки, настил; полки на тех же высотах, что раскладка товара
function ownRack() {
  const k = new Kit(121);
  const post = 0x2f4f78;
  for (const x of [-2.15, 0, 2.15]) for (const z of [-0.52, 0.52]) {
    k.box(post, x, 1.05, z, 0.08, 2.1, 0.08, { surf: SURF.metal, b: 0.01 });
    k.box(CR.ironDark, x, 0.015, z, 0.14, 0.03, 0.14, { surf: SURF.metal, b: 0.005 });
  }
  for (const x of [-2.15, 2.15]) {
    for (let i = 0; i < 3; i++) k.box(post, x, 0.18 + i * 0.66, 0, 0.04, 0.04, 1.0, { surf: SURF.metal, b: 0.006 });
    for (let i = 0; i < 3; i++) k.tube(post, [x, 0.18 + i * 0.66, -0.5], [x, 0.84 + i * 0.66, 0.5], 0.015, { surf: SURF.metal, n: 4 });
  }
  for (const h of [0.335, 0.985, 1.635]) {
    for (const z of [-0.52, 0.52]) k.box(CR.orange, 0, h - 0.06, z, 4.36, 0.1, 0.05, { surf: SURF.metal, b: 0.012 });
    k.box(0xd8c29a, 0, h - 0.015, 0, 4.3, 0.03, 1.08, { surf: SURF.wood, b: 0.006 });
    for (let i = 0; i < 4; i++) k.box(0xf2d64a, -1.6 + i * 1.07, h - 0.06, 0.55, 0.12, 0.06, 0.008, { b: 0.002, surf: SURF.plastic });
  }
  return { g: kParts([k.mesh({ ao: [0.3, 0.7] })]), anim: () => {} };
}

// ───────── башенный кран ─────────
// Мачта из решётчатых секций растёт вместе с небоскрёбом (userData.setHeight), стрела-ферма ходит над стройкой
function ownTowerCrane() {
  const g = new THREE.Group();
  const fk = new Kit(131);
  fk.box(CR.concrete, 0, 0.2, 0, 2.2, 0.4, 2.2, { surf: SURF.concrete, b: 0.05 });
  const found = fk.mesh();
  const a = 0.5, SH = 2;
  const sections = (n) => {
    const k = new Kit(132);
    for (let i = 0; i < n; i++) {
      const y0 = 0.4 + i * SH;
      for (const [x, z] of [[-a, -a], [a, -a], [a, a], [-a, a]]) k.box(CR.yellow, x, y0 + SH / 2, z, 0.1, SH, 0.1, { surf: SURF.metal, b: 0.012 });
      for (const [x, z, w, d] of [[0, -a, 2 * a, 0.06], [0, a, 2 * a, 0.06], [-a, 0, 0.06, 2 * a], [a, 0, 0.06, 2 * a]]) k.box(CR.yellow, x, y0 + 0.05, z, w, 0.06, d, { surf: SURF.metal, b: 0.01 });
      k.tube(CR.yellow, [-a, y0, -a], [a, y0 + SH, -a], 0.028, { surf: SURF.metal, n: 4 });
      k.tube(CR.yellow, [a, y0, a], [-a, y0 + SH, a], 0.028, { surf: SURF.metal, n: 4 });
      k.tube(CR.yellow, [-a, y0, a], [-a, y0 + SH, -a], 0.028, { surf: SURF.metal, n: 4 });
      k.tube(CR.yellow, [a, y0, -a], [a, y0 + SH, a], 0.028, { surf: SURF.metal, n: 4 });
    }
    return k.geo();
  };
  const mast = new THREE.Mesh(new THREE.BufferGeometry(), MAT.flat);
  mast.castShadow = true; mast.receiveShadow = true;
  const top = new THREE.Group();
  const t = new Kit(133);
  t.box(CR.iron, 0, 0.15, 0, 1.4, 0.3, 1.4, { surf: SURF.metal, b: 0.04 });
  t.box(CR.yellow, 0.35, 0.85, 0.95, 1.0, 1.0, 0.8, { surf: SURF.metal, b: 0.06 });
  t.box(CR.glass, 0.86, 0.95, 0.95, 0.02, 0.6, 0.66, { surf: SURF.glass, b: 0 });
  t.box(CR.glass, 0.35, 0.95, 1.36, 0.86, 0.55, 0.02, { surf: SURF.glass, b: 0 });
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) t.tube(CR.yellow, [x, 0.3, z], [0, 4.2, 0], 0.05, { surf: SURF.metal, n: 5 });
  const L = 17;
  for (const z of [-0.4, 0.4]) t.box(CR.yellow, L / 2 + 0.5, 0.4, z, L, 0.1, 0.1, { surf: SURF.metal, b: 0.012 });
  t.box(CR.yellow, L / 2 + 0.5, 1.2, 0, L, 0.1, 0.1, { surf: SURF.metal, b: 0.012 });
  for (let x = 0.5; x < L + 0.4; x += 1) {
    for (const z of [-0.4, 0.4]) { t.tube(CR.yellow, [x, 0.4, z], [x + 0.5, 1.2, 0], 0.022, { surf: SURF.metal, n: 4 }); t.tube(CR.yellow, [x + 0.5, 1.2, 0], [x + 1, 0.4, z], 0.022, { surf: SURF.metal, n: 4 }); }
    t.box(CR.yellow, x, 0.4, 0, 0.05, 0.05, 0.8, { surf: SURF.metal, b: 0.008 });
  }
  for (const z of [-0.45, 0.45]) t.box(CR.yellow, -2.8, 0.4, z, 5.2, 0.12, 0.1, { surf: SURF.metal, b: 0.012 });
  t.box(CR.ironDark, -2.8, 0.47, 0, 5.2, 0.03, 0.9, { surf: SURF.metal, b: 0.005 });
  for (let i = 0; i < 3; i++) t.box(CR.concrete, -4.95 + i * 0.44, 1.0, 0, 0.4, 1.1, 1.0, { surf: SURF.concrete, b: 0.03 });
  t.box(CR.iron, -1.6, 0.75, 0, 0.8, 0.5, 0.7, { surf: SURF.metal, b: 0.04 });
  t.cyl(CR.steelDark, -1.6, 0.82, 0, 0.2, 0.75, { axis: 'z', n: 12, surf: SURF.steel });
  t.tube(CR.steelDark, [0, 4.2, 0], [11, 1.2, 0], 0.025, { n: 4, surf: SURF.steel });
  for (const z of [-0.45, 0.45]) t.tube(CR.steelDark, [0, 4.2, 0], [-5.2, 0.46, z], 0.025, { n: 4, surf: SURF.steel });
  t.cyl(CR.red, 0, 4.32, 0, 0.08, 0.16, { n: 8, surf: SURF.plastic });
  top.add(t.mesh());
  const trolley = new THREE.Group();
  const tk = new Kit(134);
  tk.box(CR.iron, 0, 0.3, 0, 0.7, 0.2, 0.9, { surf: SURF.metal, b: 0.03 });
  for (const z of [-0.1, 0.1]) tk.box(CR.steelDark, 0, -2.4, z, 0.02, 5.2, 0.02, { surf: SURF.steel, b: 0 });
  tk.box(CR.yellow, 0, -5.1, 0, 0.36, 0.42, 0.26, { surf: SURF.metal, b: 0.04 });
  tk.box(CR.red, 0, -5.1, 0.135, 0.3, 0.1, 0.01, { b: 0 });
  tk.cyl(CR.steelDark, 0, -5.45, 0, 0.06, 0.28, { n: 8, surf: SURF.steel });
  trolley.add(tk.mesh());
  trolley.position.x = 10;
  top.add(trolley);
  let curN = -1;
  const setHeight = (h) => {
    const n = Math.max(2, Math.ceil((h - 0.4) / SH));
    if (n === curN) return;
    curN = n;
    mast.geometry.dispose();
    mast.geometry = sections(n);
    top.position.y = 0.4 + n * SH;
  };
  setHeight(10);
  g.add(found, mast, top);
  g.userData = { mast, top, setHeight };
  return { g, anim: (tt) => { top.rotation.y = 2.75 + Math.sin(tt * 0.13) * 0.7; trolley.position.x = 10 + Math.sin(tt * 0.21) * 4; } };
}

// ───────── портовый кран ─────────
// Портал на рельсах, стрела над кораблём, тележка с кабиной и спредером
function ownPortCrane() {
  const k = new Kit(141);
  const H = 9, Lf = 16.5, Lb = -6;
  for (const x of [-1.05, 1.05]) k.box(CR.steelDark, x, 0.04, 0, 0.12, 0.08, 9, { surf: SURF.steel, b: 0.01 });
  for (const x of [-1.0, 1.0]) for (const z of [-2.4, 2.4]) {
    k.box(CR.red, x, H / 2 + 0.5, z, 0.32, H, 0.32, { surf: SURF.metal, b: 0.04 });
    k.box(CR.iron, x, 0.32, z, 0.5, 0.42, 0.9, { surf: SURF.metal, b: 0.04 });
    for (const dz of [-0.28, 0.28]) k.cyl(CR.ironDark, x, 0.2, z + dz, 0.16, 0.12, { axis: 'x', n: 10, surf: SURF.metal });
  }
  for (const z of [-2.4, 2.4]) k.box(CR.red, 0, H + 0.4, z, 2.3, 0.4, 0.34, { surf: SURF.metal, b: 0.04 });
  for (const x of [-1.0, 1.0]) {
    k.box(CR.red, x, H + 0.4, 0, 0.34, 0.4, 5.1, { surf: SURF.metal, b: 0.04 });
    k.box(CR.red, x, 3.2, 0, 0.2, 0.2, 4.8, { surf: SURF.metal, b: 0.02 });
    k.tube(CR.red, [x, 3.2, -2.3], [x, H, 2.3], 0.08, { surf: SURF.metal, n: 6 });
    k.tube(CR.red, [x, 3.2, 2.3], [x, H, -2.3], 0.08, { surf: SURF.metal, n: 6 });
  }
  for (const z of [-0.8, 0.8]) k.box(CR.red, (Lf + Lb) / 2, H + 1.15, z, Lf - Lb, 0.5, 0.3, { surf: SURF.metal, b: 0.04 });
  for (let x = Lb + 1; x < Lf; x += 2) k.box(CR.red, x, H + 0.95, 0, 0.14, 0.14, 1.6, { surf: SURF.metal, b: 0.02 });
  k.box(CR.cream, -3.6, H + 2.25, 0, 3.0, 1.6, 2.2, { surf: SURF.metal, b: 0.08 });
  k.box(CR.red, -3.6, H + 1.85, 1.105, 3.0, 0.2, 0.01, { b: 0 });
  for (const z of [-0.8, 0.8]) k.tube(CR.red, [0.3, H + 1.4, z], [0.3, H + 5, 0], 0.1, { surf: SURF.metal, n: 6 });
  for (const z of [-0.8, 0.8]) {
    k.tube(CR.steelDark, [0.3, H + 5, 0], [Lf - 1, H + 1.4, z], 0.03, { n: 4, surf: SURF.steel });
    k.tube(CR.steelDark, [0.3, H + 5, 0], [Lb + 1, H + 1.4, z], 0.03, { n: 4, surf: SURF.steel });
  }
  k.cyl(CR.red, 0.3, H + 5.1, 0, 0.1, 0.2, { n: 8, surf: SURF.plastic });
  const body = k.mesh({ ao: [0.6, 0.6] });
  const trolley = new THREE.Group();
  const tk = new Kit(142);
  tk.box(CR.iron, 0, H + 0.75, 0, 1.4, 0.4, 1.9, { surf: SURF.metal, b: 0.04 });
  tk.box(CR.cream, 0.25, H + 0.15, 1.0, 1.0, 0.8, 0.8, { surf: SURF.metal, b: 0.06 });
  tk.box(CR.glass, 0.76, H + 0.2, 1.0, 0.02, 0.5, 0.66, { surf: SURF.glass, b: 0 });
  for (const x of [-0.45, 0.45]) for (const z of [-0.55, 0.55]) tk.box(CR.steelDark, x, (H + 0.55 + 3.3) / 2, z, 0.025, H + 0.55 - 3.3, 0.025, { surf: SURF.steel, b: 0 });
  tk.box(CR.yellow, 0, 3.15, 0, 1.2, 0.3, 2.8, { surf: SURF.metal, b: 0.05 });
  for (const z of [-1.3, 1.3]) tk.box(CR.ironDark, 0, 2.95, z, 0.3, 0.2, 0.2, { surf: SURF.metal, b: 0.03 });
  trolley.add(tk.mesh());
  trolley.position.x = 4;
  return { g: kParts([body, trolley]), anim: (tt, on) => { trolley.position.x = on ? 5 + Math.sin(tt * 0.9) * 10 : 4; } };
}

// ───────── пневмопровод: циклон и воздуходувка ─────────
function ownCompressor() {
  const k = new Kit(151);
  k.box(0x8f8b83, 0, 0.05, 0, 2.4, 0.1, 2.0, { surf: SURF.concrete, b: 0.03 });
  const cx = -0.55;
  for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]]) k.box(CR.iron, cx + x, 1.0, z, 0.07, 1.8, 0.07, { surf: SURF.metal, b: 0.01 });
  k.cyl(CR.steel, cx, 2.3, 0, 0.5, 0.9, { n: 16, surf: SURF.steel, b: 0.02 });
  k.cyl(CR.steel, cx, 1.5, 0, 0.1, 0.7, { r2: 0.5, n: 16, surf: SURF.steel, b: 0.01 });
  k.cyl(CR.steelDark, cx, 1.08, 0, 0.1, 0.16, { n: 10, surf: SURF.steel });
  k.cyl(CR.steel, cx, 3.1, 0, 0.14, 0.7, { n: 10, surf: SURF.steel });
  k.box(CR.steel, cx + 0.45, 2.55, 0.25, 0.4, 0.3, 0.22, { surf: SURF.steel, b: 0.02 });
  kHazard(k, cx, 1.9, 0.51, 0.9, 'x', 0.012, 0.06);
  for (const [x, z] of [[cx - 0.1, 0.05], [cx + 0.22, -0.18]]) k.lathe(0xcdb991, x, 0.1, z, [[0, 0], [0.2, 0], [0.23, 0.2], [0.21, 0.42], [0.1, 0.5], [0.06, 0.55], [0, 0.56]], { n: 9, surf: SURF.cloth });
  k.cyl(CR.blue, 0.55, 0.62, 0.1, 0.42, 0.34, { axis: 'z', n: 18, surf: SURF.metal, b: 0.04 });
  k.box(CR.blue, 0.75, 1.05, 0.1, 0.34, 0.5, 0.3, { surf: SURF.metal, b: 0.03 });
  kMotor(k, 0.55, 0.62, -0.45, 0.2, 0.46, 'z', CR.blueDark);
  k.pipe(CR.steel, [[0.75, 1.3, 0.1], [0.75, 2.55, 0.1], [cx + 0.66, 2.55, 0.25]], 0.13, { surf: SURF.steel, n: 10 });
  // всас от станков: труба заходит в улитку сбоку и уходит на эстакаду за край площадки
  k.pipe(CR.steel, [[0.55, 0.62, 0.3], [0.55, 0.62, 0.72], [0.55, 2.9, 0.72], [0.55, 2.9, 1.3]], 0.11, { surf: SURF.steel, n: 10 });
  k.box(CR.iron, 0.55, 1.45, 0.92, 0.07, 2.9, 0.07, { surf: SURF.metal, b: 0.01 });
  k.box(CR.iron, 0.55, 2.78, 0.95, 0.3, 0.06, 0.12, { surf: SURF.metal, b: 0.01 });
  // кожух крыльчатки на торце мотора
  k.cyl(CR.blueDark, 0.55, 0.62, -0.72, 0.2, 0.06, { axis: 'z', n: 14, surf: SURF.metal, b: 0.01 });
  const body = k.mesh({ ao: [0.5, 0.6] });
  const fk = new Kit(152);
  fk.cyl(CR.ironDark, 0, 0, 0, 0.05, 0.05, { axis: 'z', n: 8, surf: SURF.metal });
  for (let i = 0; i < 4; i++) { const ang = (i * Math.PI) / 2; fk.box(CR.steelDark, Math.cos(ang) * 0.1, Math.sin(ang) * 0.1, 0, 0.16, 0.05, 0.012, { rot: [0, 0, ang], surf: SURF.steel, b: 0.003 }); }
  const fan = fk.mesh(); fan.position.set(0.55, 0.62, -0.77);
  return { g: kParts([body, fan]), anim: (t, on) => { if (on) fan.rotation.z += 0.5; } };
}

// ───────── мусорный контейнер ─────────
function ownTrash() {
  const k = new Kit(161);
  // стенки открытого скипа: дно, наклонные торцы, борта, кант по верху
  k.prism(0x3d6b4b, 0, 0, 0, [[-0.62, 0.1], [0.62, 0.1], [0.82, 1.04], [-0.82, 1.04]], 1.2, { surf: SURF.metal });
  for (const z of [-0.6, 0.6]) k.box(0x2f5a3c, 0, 1.06, z, 1.72, 0.06, 0.07, { surf: SURF.metal, b: 0.012 });
  for (const x of [-0.83, 0.83]) k.box(0x2f5a3c, x, 1.06, 0, 0.07, 0.06, 1.26, { surf: SURF.metal, b: 0.012 });
  // внутри: тёмная глубина и мусор — обрезки досок и опилки, чуть ниже края
  k.box(0x26241f, 0, 1.045, 0, 1.58, 0.01, 1.12, { b: 0 });
  for (let i = 0; i < 8; i++) k.box(0xc99a5e, (k.rnd() - 0.5) * 1.0, 1.06 + k.rnd() * 0.05, (k.rnd() - 0.5) * 0.7, 0.3 + k.rnd() * 0.3, 0.045, 0.1, { rot: [(k.rnd() - 0.5) * 0.3, k.rnd() * 3, (k.rnd() - 0.5) * 0.3], surf: SURF.wood, jit: 0.12, end: CR.woodEnd });
  kDust(k, 0.3, 0.15, 0.34, 0.09, 0xdcc08a, 1.03);
  kDust(k, -0.35, -0.2, 0.26, 0.07, 0xcfb27c, 1.03);
  for (const s of [-1, 1]) k.box(CR.yellow, s * 0.74, 0.8, 0, 0.08, 0.18, 0.5, { surf: SURF.metal, b: 0.015 });
  for (const z of [-0.45, 0.45]) k.box(CR.ironDark, 0, 0.05, z, 1.3, 0.1, 0.1, { surf: SURF.metal, b: 0.015 });
  return { g: kParts([k.mesh({ ao: [0.3, 0.65] })]), anim: () => {} };
}

// ───────── небоскрёб из клеёного бруса ─────────
function ownTowerBase() {
  const k = new Kit(171);
  k.box(0xc9c3b6, 0, 0.02, 0, 16.6, 0.04, 16.6, { surf: SURF.concrete, b: 0.01 });
  k.box(0x55524c, 0, 0.07, 0, 15.3, 0.12, 15.3, { surf: SURF.concrete, b: 0.02 });
  k.box(0xb9b3a7, 0, 0.36, 0, 15.2, 0.48, 15.2, { surf: SURF.concrete, b: 0.06 });
  for (let i = 0; i < 3; i++) k.box(0xc2bcb0, 0, 0.1 + i * 0.2, 8.45 - i * 0.3, 4.2, 0.2, 0.3, { surf: SURF.concrete, b: 0.02 });
  return { g: kParts([k.mesh()]), anim: () => {} };
}

// этаж: угловые колонны из клеёного бруса, пролёты с остеклением и импостами, деревянные ламели.
// variant 1 — технический этаж (деревянная обшивка вместо стекла)
function ownTowerFloorGeo(variant = 0) {
  const k = new Kit(181 + variant);
  const S = 7, top = 3.0, y0 = 0.28, hh = top - y0;
  k.box(0xd6ae78, 0, 0.13, 0, 14.3, 0.26, 14.3, { surf: SURF.wood, b: 0.02, grain: 0, end: 0xe8c898 });
  k.box(0x474c52, 0, 0.275, 0, 14.34, 0.03, 14.34, { surf: SURF.metal, b: 0.005 });
  for (const x of [-S + 0.28, S - 0.28]) for (const z of [-S + 0.28, S - 0.28]) k.box(0xc99a60, x, y0 + hh / 2, z, 0.56, hh, 0.56, { surf: SURF.wood, b: 0.03, grain: 1 });
  const cols = [-3.86, -1.29, 1.29, 3.86], bays = [-5.15, -2.575, 0, 2.575, 5.15], bw = 2.27;
  // сторона: u — вдоль фасада, n — наружу; bx(цвет, u, y, n, ширина, высота, толщина)
  const sides = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  sides.forEach(([sx, sz], si) => {
    const bx = (c, u, y, n, w, h, d, o = {}) => {
      if (sz) k.box(c, u * sz, y, n * sz, w, h, d, o);
      else k.box(c, n * sx, y, -u * sx, d, h, w, Object.assign({}, o, o.grain === 0 ? { grain: 2 } : {}));
    };
    for (const u of cols) bx(0xc99a60, u, y0 + hh / 2, S - 0.16, 0.3, hh, 0.3, { surf: SURF.wood, b: 0.02, grain: 1 });
    bays.forEach((u, bi) => {
      const tech = variant === 1;
      if (tech) {
        for (let r = 0; r < 9; r++) bx(0xb88a55, u, y0 + 0.16 + r * 0.29, S - 0.1, bw, 0.27, 0.04, { surf: SURF.wood, b: 0.01, jit: 0.07, grain: 0 });
        return;
      }
      bx(CR.glass, u, y0 + hh / 2, S - 0.14, bw, hh - 0.08, 0.02, { surf: SURF.glass, b: 0 });
      for (const yy of [y0 + 0.05, top - 0.05, y0 + 0.95]) bx(0x3a3f45, u, yy, S - 0.11, bw, 0.06, 0.05, { surf: SURF.metal, b: 0 });
      bx(0x3a3f45, u, y0 + hh / 2, S - 0.11, 0.05, hh, 0.05, { surf: SURF.metal, b: 0 });
      const lam = (bi + si + variant) % 3 === 1;
      if (lam) for (let j = 0; j < 7; j++) bx(0xd2a468, u - bw / 2 + 0.16 + j * ((bw - 0.32) / 6), y0 + hh / 2, S + 0.02, 0.06, hh - 0.1, 0.14, { surf: SURF.wood, b: 0.01, jit: 0.05, grain: 1 });
    });
  });
  return k.geo();
}

// строительные леса вокруг строящегося этажа (по центру по высоте, 3 м)
function ownScaffold() {
  const g = new THREE.Group();
  const k = new Kit(191);
  const S = 7.9, w = 0.62, H = 3, n = 9;
  const sides = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [sx, sz] of sides) {
    const P = (u, y, off) => (sz ? [u * sz, y, (S - off) * sz] : [(S - off) * sx, y, -u * sx]);
    for (let i = 0; i < n; i++) {
      const u = -S + (i * 2 * S) / (n - 1);
      for (const off of [0, w]) k.tube(CR.steelDark, P(u, -H / 2, off), P(u, H / 2, off), 0.03, { n: 5, surf: SURF.steel });
      if (i < n - 1) { const u2 = -S + ((i + 1) * 2 * S) / (n - 1); k.tube(CR.steelDark, P(u, -H / 2, 0), P(u2, H / 2, 0), 0.022, { n: 4, surf: SURF.steel }); }
    }
    for (const y of [-H / 2 + 0.05, 0, H / 2 - 0.05]) for (const off of [0, w]) k.tube(CR.steelDark, P(-S, y, off), P(S, y, off), 0.025, { n: 4, surf: SURF.steel });
    const c = P(0, 0.02, w / 2);
    if (sz) k.box(0xc49a62, c[0], c[1], c[2], 2 * S, 0.04, w - 0.04, { surf: SURF.wood, b: 0.008, grain: 0 });
    else k.box(0xc49a62, c[0], c[1], c[2], w - 0.04, 0.04, 2 * S, { surf: SURF.wood, b: 0.008, grain: 2 });
  }
  g.add(k.mesh({}, true));
  const netMat = plainMaterial({ color: 0x3e8f5a, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  for (const [sx, sz] of [[0, 1], [1, 0]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * S, H - 0.2), netMat);
    if (sz) m.position.set(0, 0, S + 0.04); else { m.position.set(S + 0.04, 0, 0); m.rotation.y = Math.PI / 2; }
    g.add(m);
  }
  return g;
}

// крыша: плита, парапет, надстройка, солнечные панели, флагшток
function ownRoof() {
  const g = new THREE.Group();
  const k = new Kit(201);
  k.box(0xd6ae78, 0, 0.13, 0, 14.3, 0.26, 14.3, { surf: SURF.wood, b: 0.02, grain: 0, end: 0xe8c898 });
  k.box(0x5b605f, 0, 0.28, 0, 13.9, 0.04, 13.9, { surf: SURF.concrete, b: 0.01 });
  for (const [x, z, w, d] of [[0, 7.05, 14.3, 0.2], [0, -7.05, 14.3, 0.2], [7.05, 0, 0.2, 13.9], [-7.05, 0, 0.2, 13.9]]) k.box(0xc99a60, x, 0.5, z, w, 0.5, d, { surf: SURF.wood, b: 0.02 });
  k.box(0xb8894f, -3.2, 1.1, -3.2, 3.2, 1.6, 3.0, { surf: SURF.wood, b: 0.04, grain: 1 });
  k.box(0x4a4f55, -3.2, 1.94, -3.2, 3.4, 0.08, 3.2, { surf: SURF.metal, b: 0.02 });
  k.box(0x3a3f45, -3.2, 0.95, -1.69, 0.8, 1.3, 0.02, { surf: SURF.metal, b: 0 });
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const x = 0.8 + i * 1.9, z = -2.4 + j * 1.6;
    k.box(0x9aa2a8, x, 0.45, z, 1.7, 0.04, 1.1, { rot: [-0.35, 0, 0], surf: SURF.steel, b: 0.01 });
    k.box(0x1f2d3f, x, 0.475, z, 1.62, 0.02, 1.02, { rot: [-0.35, 0, 0], surf: SURF.glass, b: 0 });
  }
  for (const [x, z] of [[-4.5, 4.2], [-2.6, 4.8], [4.6, 4.8]]) kDust(k, x, z, 0.6, 0.55, 0x4f8a3f, 0.3);
  k.cyl(CR.steel, 5.8, 1.9, 5.8, 0.04, 3.2, { n: 8, surf: SURF.steel });
  k.box(CR.red, 6.3, 3.1, 5.8, 1.0, 0.6, 0.02, { b: 0, surf: SURF.cloth });
  g.add(k.mesh());
  return g;
}

// ───────── лесовоз (сортиментовоз) ─────────
// Кабина к +X, коники под пачку брёвен (их рисует render.js), гидроманипулятор за кабиной
function ownLogTruck() {
  const k = new Kit(211);
  const cab = 0x9e2f28;
  for (const z of [-0.42, 0.42]) k.box(CR.ironDark, -0.3, 0.78, z, 5.6, 0.2, 0.14, { surf: SURF.metal, b: 0.02 });
  for (const x of [2.15, -1.25, -2.25]) for (const z of [-1.0, 1.0]) {
    k.cyl(CR.rubber, x, 0.48, z, 0.48, 0.34, { axis: 'z', n: 14, surf: SURF.rubber, b: 0.06 });
    k.cyl(CR.steelDark, x, 0.48, z * 1.01, 0.26, 0.36, { axis: 'z', n: 10, surf: SURF.steel, b: 0.02 });
    k.cyl(CR.ironDark, x, 0.48, z * 1.02, 0.08, 0.38, { axis: 'z', n: 8, surf: SURF.metal });
  }
  for (const z of [-1.0, 1.0]) {
    k.box(cab, 2.15, 1.0, z, 1.1, 0.06, 0.42, { surf: SURF.metal, b: 0.02 });
    k.box(CR.ironDark, -1.75, 1.02, z, 2.2, 0.05, 0.44, { surf: SURF.metal, b: 0.015 });
  }
  k.box(cab, 2.5, 1.95, 0, 1.25, 1.8, 2.3, { surf: SURF.metal, b: 0.12 });
  k.box(CR.glass, 3.13, 2.3, 0, 0.03, 0.75, 2.0, { surf: SURF.glass, b: 0 });
  for (const z of [-1, 1]) k.box(CR.glass, 2.62, 2.35, z * 1.155, 0.8, 0.6, 0.02, { surf: SURF.glass, b: 0 });
  k.box(CR.ironDark, 3.14, 1.45, 0, 0.04, 0.5, 1.6, { surf: SURF.metal, b: 0.01 });
  for (let i = 0; i < 5; i++) k.box(CR.iron, 3.165, 1.25 + i * 0.1, 0, 0.02, 0.03, 1.5, { surf: SURF.metal, b: 0 });
  for (const z of [-0.85, 0.85]) k.box(0xf4efd9, 3.15, 1.2, z, 0.04, 0.16, 0.3, { surf: SURF.plastic, b: 0.01 });
  k.box(CR.iron, 3.2, 0.85, 0, 0.14, 0.26, 2.3, { surf: SURF.metal, b: 0.03 });
  k.box(cab, 2.95, 2.92, 0, 0.45, 0.08, 2.2, { surf: SURF.metal, b: 0.02 });
  for (const z of [-1, 1]) {
    k.tube(CR.ironDark, [3.1, 2.1, z * 1.15], [3.25, 2.1, z * 1.35], 0.02, { n: 4, surf: SURF.metal });
    k.box(CR.ironDark, 3.25, 2.2, z * 1.38, 0.06, 0.32, 0.14, { surf: SURF.metal, b: 0.015 });
    k.box(CR.ironDark, 2.5, 0.64, z * 1.12, 0.5, 0.05, 0.14, { surf: SURF.metal, b: 0.01 });
  }
  k.cyl(CR.steel, 1.8, 2.3, 0.95, 0.07, 1.4, { n: 8, surf: SURF.steel });
  k.cyl(CR.steel, 0.9, 0.72, -0.95, 0.22, 0.8, { axis: 'x', n: 12, surf: SURF.steel, b: 0.03 });
  k.box(CR.ironDark, 0.9, 0.72, 0.95, 0.6, 0.4, 0.3, { surf: SURF.metal, b: 0.03 });
  // гидроманипулятор (сложен над грузом)
  k.box(CR.iron, 1.45, 0.92, 0, 0.5, 0.24, 1.9, { surf: SURF.metal, b: 0.03 });
  k.cyl(CR.orange, 1.45, 1.55, 0, 0.18, 1.3, { n: 12, surf: SURF.metal, b: 0.03 });
  k.box(CR.orange, 0.35, 2.32, 0, 2.3, 0.22, 0.22, { rot: [0, 0, -0.06], surf: SURF.metal, b: 0.03 });
  k.box(CR.orange, -0.85, 2.02, 0, 0.2, 0.72, 0.18, { rot: [0, 0, 0.45], surf: SURF.metal, b: 0.03 });
  k.tube(CR.steel, [1.45, 1.9, 0.16], [0.8, 2.3, 0.16], 0.05, { n: 8, surf: SURF.steel });
  k.box(CR.ironDark, -1.1, 1.66, 0, 0.2, 0.2, 0.22, { surf: SURF.metal, b: 0.03 });
  for (const s of [-1, 1]) k.prism(CR.ironDark, -1.1, 1.5, s * 0.08, [[-0.2, 0.1], [0.2, 0.1], [0.12, -0.2], [0, -0.28], [-0.12, -0.2]], 0.05, { surf: SURF.metal });
  // коники под пачку брёвен
  for (const x of [-1.5, 0.1]) {
    k.box(CR.ironDark, x, 0.95, 0, 0.14, 0.14, 2.3, { surf: SURF.metal, b: 0.02 });
    for (const z of [-1.15, 1.15]) k.box(CR.iron, x, 1.6, z, 0.1, 1.3, 0.1, { surf: SURF.metal, b: 0.015 });
  }
  const g = new THREE.Group();
  g.add(k.mesh());
  return g;
}

// ───────── список своих моделей ─────────
// items — предметы (геометрия для InstancedMesh), st — станки, props — постройки ({ g, anim })
const OWN = {
  items: { log: ownLog, board: ownBoard, beam: ownBeam, panel: ownPanel, legs: ownLegs, sawdust: ownSawdust, cardboard: ownCardboard, bill: ownBill },
  st: { saw: ownSaw, beamer: ownBeamer, lathe: ownLathe, press: ownPress, bench: ownBench, paper: ownPaper, boxer: ownBoxer, packer: ownPacker },
  props: { stall: ownStall, rack: ownRack, tcrane: ownTowerCrane, pcrane: ownPortCrane, compressor: ownCompressor, trash: ownTrash, tower: ownTowerBase },
  trucks: { logTruck: ownLogTruck },
};
const OWN_GEO = {};
function ownItemGeo(id) { return OWN_GEO[id] || (OWN.items[id] ? (OWN_GEO[id] = OWN.items[id]()) : null); }
function ownKey(key) { return typeof key === 'string' && key.startsWith('own/') ? key.slice(4) : null; }

// ───────── для витрины ─────────
// fit — во сколько метров вписать самую большую модель ряда, cell — шаг между моделями
const OWN_GROUPS = [
  { title: 'Свои: пиломатериалы', fit: 2.4, cell: 3.4, items: ['own/log', 'own/board', 'own/beam', 'own/panel', 'own/legs', 'own/sawdust', 'own/cardboard', 'own/bill'] },
  { title: 'Свои: станки (в работе)', fit: 4.6, cell: 5.6, items: ['own/saw', 'own/beamer', 'own/lathe', 'own/press', 'own/bench', 'own/paper', 'own/boxer', 'own/packer'] },
  { title: 'Свои: постройки и лесовоз', fit: 4.6, cell: 5.6, items: ['own/stall', 'own/rack', 'own/compressor', 'own/trash', 'own/logTruck'] },
  { title: 'Свои: небоскрёб и краны', fit: 9, cell: 10.5, items: ['own/towerFloor', 'own/scaffold', 'own/tower', 'own/tcrane', 'own/pcrane'] },
];
const OWN_NAMES = {
  log: 'бревно', board: 'доска', beam: 'брус', panel: 'мебельный щит', legs: 'ножки', sawdust: 'мешок опилок', cardboard: 'картон', bill: 'деньги',
  saw: 'ленточная пилорама', beamer: 'брусовальный', lathe: 'токарный', press: 'клеильный пресс', bench: 'верстак', paper: 'картонная машина',
  boxer: 'коробочный', packer: 'упаковка', stall: 'прилавок досок', rack: 'стеллаж магазина', compressor: 'пневмопровод', trash: 'мусорный контейнер',
  logTruck: 'лесовоз', towerFloor: 'этажи и крыша', scaffold: 'леса', tower: 'цоколь',
  tcrane: 'башенный кран', pcrane: 'портовый кран',
};
// своя модель как объект сцены: { obj, anim }
function ownShowcase(key) {
  const k = ownKey(key);
  if (OWN.items[k]) { const m = new THREE.Mesh(ownItemGeo(k), MAT.flat); m.castShadow = true; return { obj: m }; }
  if (OWN.st[k]) { const o = OWN.st[k](k === 'bench' ? 'benchC' : k); return { obj: o.g, anim: o.anim }; }
  if (OWN.props[k]) { const o = OWN.props[k](); if (o.g.userData.setHeight) o.g.userData.setHeight(13); return { obj: o.g, anim: o.anim }; }
  if (OWN.trucks[k]) return { obj: OWN.trucks[k]() };
  const mesh = (geo) => { const m = new THREE.Mesh(geo, MAT.flat); m.castShadow = true; return m; };
  if (k === 'towerFloor') {   // четыре этажа (обычные, со смещёнными ламелями, технический) и крыша
    const g = new THREE.Group();
    [0, 2, 1, 0].forEach((v, i) => { const m = mesh(ownTowerFloorGeo(v)); m.position.y = i * 3; g.add(m); });
    const r = ownRoof(); r.position.y = 12; g.add(r);
    return { obj: g };
  }
  if (k === 'scaffold') return { obj: ownScaffold() };
  return null;
}
// какие свои модели сейчас стоят в игре (для ★ в витрине)
function ownUsed() {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { if (ownKey(v)) out.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(MODEL_OF);
  if (MODEL_OF.tower === 'own') for (const k of ['own/towerFloor', 'own/scaffold']) out.add(k);
  return out;
}
