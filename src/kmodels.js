'use strict';
// Модели Kenney в игре. Статичные модели «запекаются» в нашу геометрию с цветом в вершинах
// (цвет берётся из материала или из текстуры-палитры набора) — так они рисуются тем же материалом,
// что и остальное, и годятся для InstancedMesh. Человечки остаются «живыми»: кости и анимации.
// Если модели не загрузились (нет сети) — везде остаются наши модели из models.js.

const MODEL_OF = {
  player: 'mini-characters/character-male-e',
  workers: ['mini-characters/character-male-a', 'mini-characters/character-male-b', 'mini-characters/character-male-f',
    'mini-characters/character-female-b', 'mini-characters/character-female-c'],
  customers: ['mini-characters/character-male-a', 'mini-characters/character-male-b', 'mini-characters/character-male-c',
    'mini-characters/character-male-d', 'mini-characters/character-male-f', 'mini-characters/character-female-a',
    'mini-characters/character-female-b', 'mini-characters/character-female-c', 'mini-characters/character-female-d',
    'mini-characters/character-female-e', 'mini-characters/character-female-f'],
  tree: 'nature-kit/tree_pineRoundA',
  stump: 'nature-kit/stump_round',
  decorTrees: ['nature-kit/tree_pineRoundA', 'nature-kit/tree_pineDefaultA', 'nature-kit/tree_pineRoundC', 'nature-kit/tree_default', 'nature-kit/tree_oak', 'nature-kit/tree_fat'],
  // 'own/…' — свои модели из craft.js (строятся кодом, скачивать не надо)
  items: {
    log: 'own/log', board: 'own/board', beam: 'own/beam', panel: 'own/panel', legs: 'own/legs', sawdust: 'own/sawdust', cardboard: 'own/cardboard', bill: 'own/bill',
    chair: 'furniture-kit/chairCushion', table: 'furniture-kit/table', wardrobe: 'furniture-kit/bookcaseClosedDoors', box: 'furniture-kit/cardboardBoxClosed',
  },
  truck: { log: 'own/logTruck', opt: 'car-kit/delivery' },
  ship: 'watercraft-kit/ship-cargo-a',
  // станки: 'own/…' — свои, 'kenney' — прежняя сборка из деталей Factory Kit (KENNEY_ST)
  st: { saw: 'own/saw', beamer: 'own/beamer', press: 'own/press', lathe: 'own/lathe', bench: 'own/bench', paper: 'own/paper', boxer: 'own/boxer', packer: 'own/packer' },
  // постройки: 'own/…' — свои; касса 'kenney' — барная стойка, монитор и цветок (cashDesk, register, plant)
  props: { stall: 'own/stall', rack: 'own/rack', tcrane: 'own/tcrane', pcrane: 'own/pcrane', compressor: 'own/compressor', trash: 'own/trash', tower: 'own/tower', desk: 'kenney' },
  tower: 'own',   // этажи, леса и крыша небоскрёба: 'own' — свои (craft.js), иначе прежние из models.js
  cashDesk: 'furniture-kit/kitchenBar', register: 'furniture-kit/computerScreen', plant: 'furniture-kit/pottedPlant',
  logStack: 'nature-kit/log_stackLarge', fence: 'nature-kit/fence_simple', rock: 'nature-kit/rock_largeA', bush: 'nature-kit/plant_bushLarge',
  containers: ['watercraft-kit/cargo-container-a', 'watercraft-kit/cargo-container-b', 'watercraft-kit/cargo-container-c'],
  buildings: ['city-kit-industrial/building-a', 'city-kit-industrial/building-e', 'city-kit-industrial/building-k',
    'city-kit-industrial/building-m', 'city-kit-industrial/building-c', 'city-kit-industrial/building-g'],
  tallDecor: ['city-kit-industrial/water-tower', 'city-kit-industrial/chimney-large'],
};
const CHAR_H = 1.65;   // рост человечка в метрах

// Прежние станки из деталей Factory Kit: грузятся, только если какой-то станок в MODEL_OF.st стоит как 'kenney'
const KENNEY_ST = {
  conveyor: 'factory-kit/conveyor-long',
  saw: 'factory-kit/machine-bed', beamer: 'factory-kit/machine-window', press: 'factory-kit/machine', piston: 'factory-kit/piston-square',
  lathe: 'factory-kit/machine-connection-hole', bench: 'furniture-kit/table', paper: 'factory-kit/hopper-high-square',
  paperBody: 'factory-kit/machine', boxer: 'factory-kit/machine-window-bar', scanner: 'factory-kit/scanner-high',
};

// какие файлы Kenney нужны игре (свои модели 'own/…' не грузятся)
function neededModels() {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { if (v.indexOf('/') > 0 && !ownKey(v)) out.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(MODEL_OF);
  if (Object.values(MODEL_OF.st).some((k) => k === 'kenney')) walk(KENNEY_ST);
  return [...out];
}

// ───────── запекание ─────────
const BAKED = {};
const TEX_PIX = new Map();

function texPixels(img) {
  let p = TEX_PIX.get(img);
  if (!p) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    p = { w: img.width, h: img.height, d: x.getImageData(0, 0, img.width, img.height).data };
    TEX_PIX.set(img, p);
  }
  return p;
}

// модель → одна геометрия (позиции в системе корня модели, цвет в вершинах)
function bakeModel(key) {
  if (BAKED[key]) return BAKED[key];
  const g = LIB.gltf[key];
  if (!g) return null;
  const root = g.scene;
  root.updateMatrixWorld(true);
  const pal = RECOLOR[key.split('/')[0]] || null;
  const pos = [], nor = [], col = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color(), nm = new THREE.Matrix3();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const geo = o.geometry;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const idx = geo.index ? geo.index.array : null;
    const P = geo.attributes.position, N = geo.attributes.normal, UV = geo.attributes.uv, VC = geo.attributes.color;
    const total = idx ? idx.length : P.count;
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: total, materialIndex: 0 }];
    nm.getNormalMatrix(o.matrixWorld);
    for (const gr of groups) {
      const mat = mats[gr.materialIndex || 0] || mats[0];
      const pix = mat && mat.map && mat.map.image ? texPixels(mat.map.image) : null;
      for (let k = gr.start; k < Math.min(total, gr.start + gr.count); k++) {
        const i = idx ? idx[k] : k;
        v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
        pos.push(v.x, v.y, v.z);
        if (N) { n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(n.x, n.y, n.z); } else nor.push(0, 1, 0);
        if (pal && mat && pal[mat.name] !== undefined) {
          c.set(pal[mat.name]);
        } else if (pix && UV) {
          const u = UV.getX(i), w = UV.getY(i);
          const px = clamp(Math.floor((u - Math.floor(u)) * pix.w), 0, pix.w - 1);
          const py = clamp(Math.floor((w - Math.floor(w)) * pix.h), 0, pix.h - 1);
          const o4 = (py * pix.w + px) * 4;
          c.setRGB(pix.d[o4] / 255, pix.d[o4 + 1] / 255, pix.d[o4 + 2] / 255, THREE.SRGBColorSpace);
          if (mat.color) c.multiply(mat.color);
        } else if (mat && mat.color) c.copy(mat.color);
        else c.setRGB(1, 1, 1);
        if (VC) { c.r *= VC.getX(i); c.g *= VC.getY(i); c.b *= VC.getZ(i); }
        col.push(c.r, c.g, c.b);
      }
    }
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingBox();
  BAKED[key] = out;
  return out;
}

// копия запечённой модели, вписанная в размер [w, h, d] (null — не ограничивать), дном на y=0, по центру.
// uniform:false — растянуть под размер по каждой оси; longX — повернуть длинной стороной вдоль X
function fittedGeo(key, o = {}) {
  const base = bakeModel(key);
  if (!base) return null;
  const geo = base.clone();
  if (o.rotY) geo.rotateY(o.rotY);
  geo.computeBoundingBox();
  let b = geo.boundingBox;
  if (o.longX && (b.max.z - b.min.z) > (b.max.x - b.min.x)) { geo.rotateY(Math.PI / 2); geo.computeBoundingBox(); b = geo.boundingBox; }
  const s = new THREE.Vector3().subVectors(b.max, b.min);
  const [w, h, d] = o.size || [null, null, null];
  if (o.uniform === false) {
    geo.scale(w ? w / s.x : 1, h ? h / s.y : 1, d ? d / s.z : 1);
  } else {
    const ks = [w ? w / s.x : Infinity, h ? h / s.y : Infinity, d ? d / s.z : Infinity];
    let k = Math.min(...ks);
    if (!isFinite(k)) k = o.scale || 1;
    geo.scale(k, k, k);
  }
  geo.computeBoundingBox();
  b = geo.boundingBox;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// склеить геометрии с цветом в вершинах (наши детали из models.js тоже такие)
function concatGeos(list) {
  const geos = list.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const hasS = geos.some((g) => g.attributes.surf);   // поверхности своих моделей (look.js) — переносим
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const srf = hasS ? new Float32Array(n) : null, rng = hasS ? new Float32Array(n * 2) : null;
  let o = 0;
  for (const g of geos) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + c) * 3);
    if (hasS && g.attributes.surf) { srf.set(g.attributes.surf.array, o); rng.set(g.attributes.ring.array, o * 2); }
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (hasS) { out.setAttribute('surf', new THREE.BufferAttribute(srf, 1)); out.setAttribute('ring', new THREE.BufferAttribute(rng, 2)); }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function kMesh(key, o, shadow = true) {
  const geo = fittedGeo(key, o);
  if (!geo) return null;
  const m = new THREE.Mesh(geo, MAT.flat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

// ───────── предметы ─────────
// меняем геометрию предметов на модели Kenney, сохраняя их размеры в плане (раскладка на площадках не меняется)
function applyKenneyItems() {
  const I = MODEL_OF.items;
  const set = (id, geo) => {
    if (!geo) return;
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    ITEM_VIS[id].geo = geo;
    ITEM_VIS[id].h = (b.max.y - b.min.y) * 0.96;
  };
  const kn = (key) => !!window.LIB_OK && !ownKey(key) && LIB.has(key);
  // свои (own/…) — всегда, если не ?nomodels; Kenney — если загрузились
  for (const id in I) { const k = ownKey(I[id]); if (k && window.OWN_OK !== false) set(id, ownItemGeo(k)); }
  if (kn(I.log)) set('log', fittedGeo(I.log, { size: [1.3, null, null], longX: true }));
  if (kn(I.chair)) set('chair', fittedGeo(I.chair, { size: [0.5, 0.78, 0.5] }));
  if (kn(I.table)) set('table', fittedGeo(I.table, { size: [0.95, 0.5, 0.65], longX: true }));
  if (kn(I.wardrobe)) set('wardrobe', fittedGeo(I.wardrobe, { size: [0.7, 1.0, 0.45], longX: true }));
  if (!kn(I.box)) return;
  set('box', fittedGeo(I.box, { size: [0.5, 0.5, 0.5], uniform: false }));
  const boxed = (w, h, d, stripe) => concatGeos([
    fittedGeo(I.box, { size: [w, h, d], uniform: false }),
    mergeParts([B(stripe, 0, h * 0.55, d / 2 + 0.004, w * 0.62, h * 0.26, 0.006), B(stripe, 0, h * 0.55, -d / 2 - 0.004, w * 0.62, h * 0.26, 0.006)]),
  ]);
  set('chairB', boxed(0.56, 0.6, 0.52, COL.red));
  set('tableB', boxed(0.98, 0.52, 0.68, COL.blue));
  set('wardrobeB', boxed(0.72, 1.0, 0.48, COL.purple));
}

// ───────── человечки ─────────
const CHAR_CLIPS = {};
const ARM_BONES = ['arm-left', 'arm-right'];

function charClips(key) {
  if (CHAR_CLIPS[key]) return CHAR_CLIPS[key];
  const all = LIB.clips(key);
  const get = (n) => all.find((c) => c.name === n);
  const part = (clip, arms, suffix) => clip ? new THREE.AnimationClip(clip.name + suffix, clip.duration,
    clip.tracks.filter((t) => ARM_BONES.some((b) => t.name.startsWith(b + '.')) === arms)) : null;
  const idle = get('idle'), walk = get('walk'), run = get('sprint'), hold = get('holding-both');
  const out = { idle, walk, run, idleL: part(idle, false, '-legs'), walkL: part(walk, false, '-legs'), runL: part(run, false, '-legs'), hold: part(hold, true, '-arms') };
  CHAR_CLIPS[key] = out;
  return out;
}

// каска на кость головы — оранжевая у игрока, жёлтая у рабочих
function addHelmet(root, color) {
  let head = null, headMesh = null;
  root.traverse((o) => { if (!head && o.name === 'head') head = o; if (!headMesh && o.name === 'head-mesh') headMesh = o; });
  if (!head) return;
  root.updateMatrixWorld(true);
  const hb = new THREE.Box3().setFromObject(headMesh || head);
  const hs = hb.getSize(new THREE.Vector3());
  const ws = head.getWorldScale(new THREE.Vector3());
  const r = (hs.x * 0.5 * 0.98) / ws.x;
  const mat = plainMaterial({ color, roughness: 0.38 });   // пластиковая каска с бликом
  const helmet = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  dome.scale.y = 0.72;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.08, r * 1.08, r * 0.07, 20), mat);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(r * 0.22, r * 0.2, r * 1.6), mat);
  ridge.position.y = r * 0.62;
  helmet.add(dome, brim, ridge);
  helmet.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const top = new THREE.Vector3((hb.min.x + hb.max.x) / 2, hb.max.y - hs.y * 0.24, (hb.min.z + hb.max.z) / 2);
  head.worldToLocal(top);
  helmet.position.copy(top);
  head.add(helmet);
}

// style: player | worker | cust. Возвращает объект для View: g, set(moving, speed, carry, dt), stackY, stackFwd
function makeCharacterK(style, seed) {
  const list = style === 'player' ? [MODEL_OF.player] : style === 'worker' ? MODEL_OF.workers : MODEL_OF.customers;
  const key = list[Math.abs(seed | 0) % list.length];
  const root = LIB.clone(key);
  if (!root) return null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.material;
    o.material = plainMaterial({ map: src.map || null, color: src.map ? 0xffffff : src.color, roughness: 0.72 });
    o.castShadow = true;
    o.frustumCulled = false;
  });
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  root.scale.setScalar(CHAR_H / Math.max(0.01, size.y));
  if (style !== 'cust') addHelmet(root, style === 'player' ? 0xff8c1a : 0xffd43b);
  const g = new THREE.Group();
  g.add(root);
  if (style === 'player') {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 32), new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.75, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    g.add(ring);
  }
  const mixer = new THREE.AnimationMixer(root);
  const clips = charClips(key);
  const act = {};
  for (const k in clips) if (clips[k]) act[k] = mixer.clipAction(clips[k]);
  let cur = null, arms = false;
  const set = (moving, speed, carry, dt) => {
    const fast = speed > 4.2;
    let base = (moving ? (fast ? 'run' : 'walk') : 'idle') + (carry ? 'L' : '');
    if (!act[base]) base = moving ? 'walk' : 'idle';
    if (base !== cur && act[base]) {
      act[base].reset().fadeIn(0.15).play();
      if (cur && act[cur]) act[cur].fadeOut(0.15);
      cur = base;
    }
    if (act[base]) act[base].timeScale = moving ? clamp(speed / (fast ? 5.5 : 2.6), 0.6, 1.8) : 1;
    if (carry !== arms && act.hold) {
      if (carry) act.hold.reset().fadeIn(0.12).play(); else act.hold.fadeOut(0.12);
      arms = carry;
    }
    mixer.update(dt);
  };
  set(false, 0, false, Math.random() * 0.5);
  return { g, set, model: true, stackY: CHAR_H * 0.46, stackFwd: 0.46 };
}

// ───────── станки и постройки ─────────
// id — какой именно станок (верстаки показывают, что на них собирают)
function buildStationK(type, id) {
  const key = MODEL_OF.st[type], own = ownKey(key);
  if (own && OWN.st[own] && window.OWN_OK !== false) return OWN.st[own](id);
  if (key !== 'kenney' || !window.LIB_OK) return buildStation(type);
  const S = KENNEY_ST;
  const g = new THREE.Group();
  const add = (key, o, x = 0, y = 0, z = 0) => { const m = kMesh(key, o); if (m) { m.position.set(x, y, z); g.add(m); } return m; };
  // основание и рольганги к кучам входа и выхода
  g.add(meshOf([B(0x6b7178, 0, 0.06, 0, 3.2, 0.12, 2.4)]));
  add(S.conveyor, { size: [1.25, 0.42, 0.85], uniform: false }, -2.25, 0, 0);
  add(S.conveyor, { size: [1.25, 0.42, 0.85], uniform: false }, 2.25, 0, 0);
  let anim = () => {};
  const blade = (color) => {
    const m = meshOf([C(COL.steel, 0, 0, 0, 0.55, 0.04, Math.PI / 2, 0, 0, 'cyl20'), C(color, 0, 0, 0, 0.12, 0.08, Math.PI / 2)]);
    return m;
  };
  if (type === 'saw' || type === 'beamer') {
    add(type === 'saw' ? S.saw : S.beamer, { size: [2.3, 1.45, 2.1], uniform: false }, 0, 0.12, 0);
    const b = blade(type === 'saw' ? COL.red : COL.blue);
    b.position.set(0, 1.6, 0);
    g.add(b);
    anim = (t, on) => { if (on) b.rotation.z -= 0.6; };
  } else if (type === 'press') {
    add(S.press, { size: [2.3, 0.9, 1.9], uniform: false }, 0, 0.12, 0);
    const p = kMesh(S.piston, { size: [1.5, 1.2, 1.5], uniform: false });
    if (p) { p.position.set(0, 1.02, 0); g.add(p); }
    anim = (t, on) => { if (p) p.position.y = on ? 1.02 + Math.abs(Math.sin(t * 3)) * 0.35 : 1.02; };
  } else if (type === 'lathe') {
    add(S.lathe, { size: [2.3, 1.3, 1.9], uniform: false }, 0, 0.12, 0);
    const work = meshOf([C(COL.wood, 0, 0, 0, 0.14, 2.1, 0, 0, Math.PI / 2, 'cyl6')]);
    work.position.set(0, 1.62, 0);
    g.add(work);
    anim = (t, on) => { if (on) work.rotation.x += 0.5; };
  } else if (type === 'bench') {
    add(S.bench, { size: [2.9, 0.95, 1.5], uniform: false }, 0, 0.12, 0);
    g.add(meshOf([B(COL.metalDark, 1.15, 1.13, 0.5, 0.3, 0.2, 0.3), B(COL.red, -1.1, 1.1, -0.45, 0.4, 0.12, 0.2), B(COL.metal, 0.3, 1.08, -0.5, 0.7, 0.03, 0.12)]));
    const hammer = new THREE.Group();
    hammer.add(meshOf([B(COL.woodDark, 0, 0.25, 0, 0.06, 0.5, 0.06), B(COL.metalDark, 0, 0.5, 0, 0.26, 0.1, 0.1)]));
    hammer.position.set(-0.2, 1.1, 0.25);
    g.add(hammer);
    anim = (t, on) => { hammer.rotation.x = on ? -0.2 - Math.abs(Math.sin(t * 6)) * 1.1 : -0.2; };
  } else if (type === 'paper') {
    add(S.paperBody, { size: [1.8, 1.3, 1.9], uniform: false }, 0.6, 0.12, 0);
    add(S.paper, { size: [1.3, 2.3, 1.3], uniform: false }, -0.85, 0.12, 0);
    const rolls = new THREE.Group();
    for (const x of [0.2, 0.6, 1.0]) {
      const r = meshOf([C(0xe0e0e0, 0, 0, 0, 0.14, 1.6, Math.PI / 2, 0, 0)]);
      r.position.set(x, 1.58, 0);
      rolls.add(r);
    }
    g.add(rolls);
    anim = (t, on) => { if (on) for (const r of rolls.children) r.rotation.z -= 0.25; };
  } else if (type === 'boxer') {
    add(S.boxer, { size: [2.3, 1.45, 1.9], uniform: false }, 0, 0.12, 0);
    const arm = meshOf([B(COL.metal, 0, 0, 0.4, 0.12, 0.12, 0.8), B(COL.yellow, 0, -0.1, 0.8, 0.3, 0.1, 0.2)]);
    arm.position.set(0.4, 1.9, -0.3);
    g.add(arm);
    anim = (t, on) => { arm.rotation.x = on ? Math.sin(t * 5) * 0.5 : 0; };
  } else if (type === 'packer') {
    add(S.bench, { size: [2.8, 0.85, 1.4], uniform: false }, 0, 0.12, 0);
    add(S.scanner, { size: [0.7, 2.1, 1.7], uniform: false }, 0.5, 0.12, 0);
    const box = kMesh(MODEL_OF.items.box, { size: [0.7, 0.62, 0.7], uniform: false });
    if (box) { box.position.set(-0.4, 0.98, 0); g.add(box); }
    anim = (t, on) => { if (box) box.rotation.y = on ? Math.sin(t * 3) * 0.25 : 0; };
  } else {
    return buildStation(type);
  }
  return { g, anim };
}

function buildPropK(type) {
  const own = ownKey(MODEL_OF.props[type]);
  if (own && OWN.props[own] && window.OWN_OK !== false) return OWN.props[own]();
  if (type === 'desk' && window.LIB_OK) {
    const g = new THREE.Group();
    const bar = kMesh(MODEL_OF.cashDesk, { size: [4, 1.15, 1.2], uniform: false, longX: true });
    if (!bar) return buildProp(type);
    g.add(bar);
    const reg = kMesh(MODEL_OF.register, { size: [0.8, null, null], longX: true });
    if (reg) { reg.position.set(0.8, 1.15, 0); g.add(reg); }
    const plant = kMesh(MODEL_OF.plant, { size: [null, 0.9, null] });
    if (plant) { plant.position.set(-1.6, 1.15, 0); g.add(plant); }
    return { g, anim: () => {} };
  }
  return buildProp(type);
}

function buildTruckK(kind) {
  const own = ownKey(MODEL_OF.truck[kind]);
  if (own && OWN.trucks[own] && window.OWN_OK !== false) return OWN.trucks[own]();
  if (!window.LIB_OK) return buildTruck(kind);
  const g = new THREE.Group();
  // у машин Kenney длинная сторона — вдоль Z, кабина — к +Z; разворачиваем кабиной к +X
  const m = kMesh(MODEL_OF.truck[kind], { size: [6.2, null, null], rotY: Math.PI / 2, longX: true });
  if (!m) return buildTruck(kind);
  g.add(m);
  return g;
}

function buildShipK() {
  if (!window.LIB_OK) return buildShip();
  const g = new THREE.Group();
  const m = kMesh(MODEL_OF.ship, { size: [null, null, 18] });
  if (!m) return buildShip();
  g.add(m);
  return g;
}
