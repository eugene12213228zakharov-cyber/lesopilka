'use strict';
// Как выглядит мир: материал «с поверхностями» (дерево, металл, бетон…), свет, отражения неба,
// покрытия земли. Общий для игры и витрины.

// Поверхности. Номер лежит в вершинах (атрибут surf); у геометрии без него — 0, обычная краска.
// Дерево: 1/2/3 — волокна вдоль X/Y/Z модели (craft.js выбирает сам по повороту детали).
const SURF = { paint: 0, wood: 1, metal: 4, steel: 5, rubber: 6, concrete: 7, card: 8, glass: 9, cloth: 10, plastic: 11 };

const LOOK = {
  tone: 'agx',              // agx | aces (aces ярче и насыщеннее — ближе к «игрушечному»)
  exposure: 1.1,
  sun: 0xffe7c4, sunI: 3.8,
  sunDir: [-0.42, 0.78, 0.46], // откуда светит солнце (к нему)
  envI: 0.7,                // сила рассеянного света и отражений неба
  sky: { top: 0x6e9fd6, horizon: 0xdfe6e4, bottom: 0x6f7152 },
  fog: 0xcfd9d6,
};

function lookRenderer(r) {
  r.toneMapping = LOOK.tone === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
  r.toneMappingExposure = LOOK.exposure;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
}

// Окружение: небо-градиент с солнцем → PMREM. Даёт мягкий рассеянный свет со всех сторон
// (голубоватые тени) и отражения неба на стекле и стали.
function lookEnvironment(renderer, scene) {
  const pm = new THREE.PMREMGenerator(renderer);
  const sky = new THREE.Scene();
  const d = new THREE.Vector3(...LOOK.sunDir).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(LOOK.sky.top) }, horizon: { value: new THREE.Color(LOOK.sky.horizon) },
      bottom: { value: new THREE.Color(LOOK.sky.bottom) }, sunDir: { value: d }, sunCol: { value: new THREE.Color(LOOK.sun) },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, horizon, bottom, sunDir, sunCol; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = d.y > 0.0 ? mix(horizon, top, pow(d.y, 0.55)) : mix(horizon, bottom, pow(-d.y, 0.35));
        float s = max(dot(d, sunDir), 0.0);
        c += sunCol * (pow(s, 900.0) * 40.0 + pow(s, 10.0) * 0.35);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  sky.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat));
  const env = pm.fromScene(sky, 0.015).texture;
  pm.dispose();
  scene.environment = env;
  return env;
}

// Солнце с тенью. Сцена светится ещё и окружением (lookEnvironment), поэтому без HemisphereLight.
function lookSun(scene, mapSize = 2048, half = 38) {
  const sun = new THREE.DirectionalLight(LOOK.sun, LOOK.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mapSize, mapSize);
  const sc = sun.shadow.camera;
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);
  return sun;
}
// поставить солнце над точкой (x, z) — тень считается вокруг неё
function lookSunAt(sun, x, z) {
  const d = LOOK.sunDir;
  sun.position.set(x + d[0] * 60, d[1] * 60, z + d[2] * 60);
  sun.target.position.set(x, 0, z);
}

// ───────── материал с поверхностями ─────────
const SURF_GLSL = `
varying float vSurf;
varying vec3 vObj;
varying vec2 vRing;
float lkH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float lkN(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lkH(i), lkH(i + vec2(1.0, 0.0)), f.x), mix(lkH(i + vec2(0.0, 1.0)), lkH(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

function surfMaterial(flat) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: flat, roughness: 0.8, metalness: 0, envMapIntensity: LOOK.envI });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float surf;\nattribute vec2 ring;\nvarying float vSurf;\nvarying vec3 vObj;\nvarying vec2 vRing;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = surf; vObj = position; vRing = ring;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SURF_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float sR = 0.78, sM = 0.0;
      {
        float s = floor(vSurf + 0.5);
        vec3 p = vObj;
        vec3 on = normalize(cross(dFdx(vObj), dFdy(vObj)));
        vec3 an = abs(on);
        float pix = length(fwidth(vObj)) + 1e-5;            // размер пикселя в метрах — гасим мелкий рисунок вдали
        vec2 uvp = an.x > an.y && an.x > an.z ? p.yz : (an.y > an.z ? p.xz : p.xy);
        float big = lkN(uvp * 2.3), fine = lkN(uvp * 11.0);
        float fa = 1.0 - smoothstep(0.03, 0.09, pix);
        if (s < 0.5) {                                      // краска
          diffuseColor.rgb *= 0.965 + 0.07 * big;
          sR = 0.74;
        } else if (s < 3.5) {                               // дерево
          float ax = s - 1.0;
          float along = ax < 0.5 ? p.x : (ax < 1.5 ? p.y : p.z);
          vec2 acr = ax < 0.5 ? p.yz : (ax < 1.5 ? p.xz : p.xy);
          float endg = ax < 0.5 ? an.x : (ax < 1.5 ? an.y : an.z);
          if (endg > 0.72) {                                // торец: годовые кольца от сердцевины
            float r = length(acr - vRing);
            float w = lkN(acr * 9.0) * 0.012;
            float rg = sin((r + w) * 190.0);
            float ringA = (1.0 - smoothstep(0.02, 0.05, pix * 3.0));
            diffuseColor.rgb *= 1.0 - smoothstep(0.55, 1.0, rg) * 0.13 * ringA - (fine - 0.5) * 0.05 * fa;
          } else {                                          // волокна вдоль детали
            float w = lkN(vec2(along * 1.3, dot(acr, vec2(6.0, 4.0)))) * 4.0 + lkN(vec2(along * 7.0, dot(acr, vec2(21.0, 13.0)))) * 0.8;
            float g = sin(dot(acr - vRing, vec2(47.0, 29.0)) + w);
            float ga = 1.0 - smoothstep(0.02, 0.05, pix);
            diffuseColor.rgb *= 1.0 - smoothstep(0.3, 1.0, g) * 0.15 * ga + (big - 0.5) * 0.09 + (fine - 0.5) * 0.05 * fa;
          }
          sR = 0.84;
        } else if (s < 4.5) {                               // крашеный металл: неровная краска, у низа грязнее
          diffuseColor.rgb *= 0.95 + 0.1 * big - (fine - 0.5) * 0.04 * fa;
          sR = 0.5 + 0.12 * big;
        } else if (s < 5.5) {                               // сталь: шлифовка
          float br = lkN(vec2(dot(uvp, vec2(1.0, 0.3)) * 60.0, dot(uvp, vec2(-0.3, 1.0)) * 3.0));
          diffuseColor.rgb *= 0.9 + 0.12 * big + (br - 0.5) * 0.08 * fa;
          sR = 0.3 + 0.1 * big; sM = 0.9;
        } else if (s < 6.5) {                               // резина
          diffuseColor.rgb *= 0.92 + 0.12 * fine;
          sR = 0.9;
        } else if (s < 7.5) {                               // бетон: пятна и поры
          float pore = step(0.86, lkN(uvp * 31.0));
          diffuseColor.rgb *= 0.9 + 0.16 * big + (fine - 0.5) * 0.1 * fa - pore * 0.07 * fa;
          sR = 0.94;
        } else if (s < 8.5) {                               // картон: гофра на торцах
          float edge = 1.0 - an.y;
          float fl = sin(p.y * 900.0) * 0.5 + 0.5;
          diffuseColor.rgb *= 0.96 + 0.07 * big - edge * fl * 0.12 * (1.0 - smoothstep(0.004, 0.01, pix));
          sR = 0.9;
        } else if (s < 9.5) {                               // стекло: тёмное, отражает небо
          sR = 0.06; sM = 0.0;
        } else if (s < 10.5) {                              // мешковина
          diffuseColor.rgb *= 0.9 + 0.14 * big + (fine - 0.5) * 0.12 * fa;
          sR = 1.0;
        } else {                                            // пластик: гладкий, с бликом
          sR = 0.42;
        }
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = sR;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = sM;');
  };
  m.customProgramCacheKey = () => 'lesoSurf' + (flat ? 1 : 0);
  return m;
}

// обычный материал без рисунка: для человечков Kenney, касок и прочего с текстурой
function plainMaterial(o) { return new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.78, metalness: 0, envMapIntensity: LOOK.envI }, o)); }

// ───────── покрытия земли (рисуются на canvas при запуске) ─────────
const LOOK_TEX = {};

function lkNoise2(seed) {
  const r = { s: seed };
  const P = new Float32Array(256 * 256);
  for (let i = 0; i < P.length; i++) P[i] = rngNext(r);
  const at = (x, y) => P[((y & 255) << 8) | (x & 255)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// kind: grass | dirt | forest | concrete | tiles | port | gravel | asphalt | walk. Возвращает текстуру и размер плитки в метрах
function groundTexture(kind) {
  if (LOOK_TEX[kind]) return LOOK_TEX[kind];
  const cfg = {
    grass:    { px: 512, m: 9,  base: [118, 160, 78],  seed: 11 },
    dirt:     { px: 512, m: 7,  base: [184, 163, 127], seed: 12 },
    forest:   { px: 512, m: 8,  base: [92, 128, 62],   seed: 13 },
    concrete: { px: 512, m: 8,  base: [196, 191, 180], seed: 14, slab: 4 },
    tiles:    { px: 512, m: 4,  base: [219, 212, 200], seed: 15, slab: 1 },
    port:     { px: 512, m: 12, base: [178, 178, 172], seed: 16, slab: 6 },
    gravel:   { px: 512, m: 6,  base: [190, 178, 152], seed: 17 },
    asphalt:  { px: 512, m: 8,  base: [92, 96, 101],   seed: 18 },
    walk:     { px: 256, m: 2,  base: [176, 173, 166], seed: 19, slab: 0.5 },   // тротуарная плитка
  }[kind];
  const W = cfg.px, cv = document.createElement('canvas');
  cv.width = cv.height = W;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(W, W), d = img.data;
  const n1 = lkNoise2(cfg.seed), n2 = lkNoise2(cfg.seed + 100), n3 = lkNoise2(cfg.seed + 200);
  const rs = { s: cfg.seed * 7 };
  const k = 1 / W;
  // бесшовный шум: значения берутся с периодом, кратным размеру плитки
  const per = (f, x, y, s) => {
    const X = x * s, Y = y * s, S = s;
    const a = f(X, Y), b = f(X - S, Y), c = f(X, Y - S), e = f(X - S, Y - S);
    return (a * (1 - x) + b * x) * (1 - y) + (c * (1 - x) + e * x) * y;
  };
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x * k, v = y * k;
    const lo = per(n1, u, v, 4), mid = per(n2, u, v, 16), hi = per(n3, u, v, 64);
    let r = cfg.base[0], g = cfg.base[1], b = cfg.base[2];
    let t = 1;
    if (kind === 'grass' || kind === 'forest') {
      t = 0.82 + lo * 0.22 + mid * 0.12 + hi * 0.1;
      const dry = Math.max(0, lo - 0.62) * 1.6;               // выгоревшие пятна
      r += dry * 40; g += dry * 18; b += dry * 6;
      if (kind === 'forest') { const nd = Math.max(0, mid - 0.55) * 2; r += nd * 34; g -= nd * 8; b -= nd * 6; }
    } else if (kind === 'dirt' || kind === 'gravel') {
      t = 0.86 + lo * 0.14 + mid * 0.1 + hi * 0.12;
      if (kind === 'dirt') { const saw = Math.max(0, mid - 0.58) * 2.2; r += saw * 34; g += saw * 30; b += saw * 18; }
    } else if (kind === 'asphalt') {
      t = 0.9 + lo * 0.1 + mid * 0.06 + hi * 0.16;
    } else {
      t = 0.9 + lo * 0.12 + mid * 0.07 + hi * 0.06;
    }
    const o = (y * W + x) * 4;
    d[o] = clamp(r * t, 0, 255); d[o + 1] = clamp(g * t, 0, 255); d[o + 2] = clamp(b * t, 0, 255); d[o + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const R = () => rngNext(rs);
  const dots = (n, rad, col, a) => {
    for (let i = 0; i < n; i++) {
      cx.fillStyle = col(R());
      cx.globalAlpha = a * (0.5 + R() * 0.5);
      const x = R() * W, y = R() * W, s = rad * (0.5 + R());
      for (const [ox, oy] of [[0, 0], [W, 0], [-W, 0], [0, W], [0, -W]]) { cx.beginPath(); cx.arc(x + ox, y + oy, s, 0, Math.PI * 2); cx.fill(); }
    }
    cx.globalAlpha = 1;
  };
  if (kind === 'grass' || kind === 'forest') {
    // травинки: короткие штрихи темнее и светлее
    cx.lineWidth = 1.2;
    for (let i = 0; i < 5200; i++) {
      const x = R() * W, y = R() * W, a = -Math.PI / 2 + (R() - 0.5) * 1.2, l = 3 + R() * 6;
      const light = R() < 0.5;
      cx.strokeStyle = light ? `rgba(190,220,120,${0.18 + R() * 0.2})` : `rgba(40,70,25,${0.18 + R() * 0.22})`;
      cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); cx.stroke();
    }
    if (kind === 'forest') dots(900, 1.6, (q) => q < 0.5 ? '#6d5230' : '#8a6a3a', 0.5);   // хвоя и шишки
    else dots(120, 1.3, (q) => q < 0.6 ? '#f2eecb' : '#e8d36a', 0.55);                     // редкие цветы
  } else if (kind === 'dirt') {
    dots(2600, 1.1, (q) => q < 0.5 ? '#8e7a5a' : '#efe0b8', 0.5);     // камешки и опилки
    dots(40, 14, () => '#9f8a64', 0.18);                                // сырые пятна
  } else if (kind === 'gravel') {
    dots(9000, 1.3, (q) => ['#a59a86', '#d8ccb0', '#8c8474', '#bfb398'][Math.floor(q * 4)], 0.75);
  } else if (kind === 'asphalt') {
    dots(9000, 0.9, (q) => q < 0.5 ? '#3f4247' : '#7b8087', 0.6);
    dots(24, 18, () => '#3b3e42', 0.22);
    cx.strokeStyle = 'rgba(35,37,40,0.55)'; cx.lineWidth = 1.4;           // трещины
    for (let i = 0; i < 7; i++) {
      let x = R() * W, y = R() * W;
      cx.beginPath(); cx.moveTo(x, y);
      for (let s = 0; s < 8; s++) { x += (R() - 0.5) * 40; y += (R() - 0.5) * 40; cx.lineTo(x, y); }
      cx.stroke();
    }
  } else {
    // бетон, плитка, порт: пятна, швы плит
    dots(kind === 'tiles' ? 10 : 34, kind === 'tiles' ? 10 : 22, () => '#8f8a80', kind === 'tiles' ? 0.06 : 0.14);
    dots(1800, 0.8, (q) => q < 0.5 ? '#8c877d' : '#e6e1d6', 0.35);
    const slabPx = W * cfg.slab / cfg.m;
    cx.strokeStyle = kind === 'tiles' ? 'rgba(120,112,100,0.55)' : 'rgba(95,90,82,0.6)';
    cx.lineWidth = kind === 'tiles' ? 2 : 2.4;
    for (let p = 0; p <= W + 1; p += slabPx) {
      cx.beginPath(); cx.moveTo(p, 0); cx.lineTo(p, W); cx.stroke();
      cx.beginPath(); cx.moveTo(0, p); cx.lineTo(W, p); cx.stroke();
    }
    if (kind === 'port') dots(10, 9, () => '#9a6b44', 0.12);            // ржавые потёки
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  LOOK_TEX[kind] = { tex: t, m: cfg.m };
  return LOOK_TEX[kind];
}

// плоскость покрытия [x0..x1]×[z0..z1] на высоте y
function groundPatch(kind, x0, z0, x1, z1, y = 0.012, tint = 0xffffff) {
  const gt = groundTexture(kind);
  const tex = gt.tex.clone();
  tex.needsUpdate = true;
  tex.repeat.set((x1 - x0) / gt.m, (z1 - z0) / gt.m);
  tex.offset.set(x0 / gt.m, z0 / gt.m);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), plainMaterial({ map: tex, color: tint, roughness: 0.95 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  m.receiveShadow = true;
  return m;
}
