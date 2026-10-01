'use strict';
// Зал казино на 8-м этаже: игрок заходит с ковра у двери небоскрёба и ходит сам, вид от 3-го лица.
// Своя сцена (мир в это время не рисуется), свой свет и камера за спиной. У мест игр (CASINO_ROOM.spots) снизу —
// панель ставки (UI.casinoDock), а сама игра — в зале: барабаны на экране автомата, колесо на стене, карта на столе,
// гонка на большом экране. Ставки и выигрыши считает Game — здесь только вид. Оси зала — как у CASINO_ROOM в config.js

const ROOM_COL = {
  wall: 0x4a1620, wallLow: 0x2e0d14, gold: 0xd9a400, goldDark: 0x9c7410, floorEdge: 0x2a1410,
  felt: 0x1f6b3a, wood: 0x6b3a22, velvet: 0x8c1d2b, steel: 0xb8bec4, screen: 0x15181c, marble: 0xe8e2d6,
};

// холст → текстура (для экранов, колеса, карты, ковра)
function roomCanvas(w, h) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; }
function roomTex(cv, repeat) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
// колесо фортуны: CASINO.wheel.m по кругу от верха по часовой, подписи ×N; посередине — топор
function drawCasinoWheel(cv) {
  const x = cv.getContext('2d'), m = CASINO.wheel.m, n = m.length, R = cv.width / 2, st = (Math.PI * 2) / n;
  const col = { 0: '#3b4550', 0.5: '#3d6b95', 1: '#2a8c8c', 1.5: '#2f9e54', 2: '#e08a1c', 3: '#8e5bd0', 7: '#e5b400' };
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + i * st;
    x.beginPath(); x.moveTo(R, R); x.arc(R, R, R - 4, a0, a0 + st); x.closePath();
    x.fillStyle = col[m[i]] || '#555'; x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 4; x.stroke();
    x.save(); x.translate(R, R); x.rotate(a0 + st / 2);
    x.fillStyle = '#fff'; x.font = '900 30px Nunito, sans-serif'; x.textAlign = 'right'; x.textBaseline = 'middle';
    x.fillText(m[i] ? '×' + m[i] : '0', R - 22, 0);
    x.restore();
  }
  x.beginPath(); x.arc(R, R, 40, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill();
  x.font = '40px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('🪓', R, R + 2);
}
function roomPlane(w, h, map, lit) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lit ? plainMaterial({ map, roughness: 0.9 }) : new THREE.MeshBasicMaterial({ map, toneMapped: false }));
  m.receiveShadow = !!lit;
  return m;
}

class CasinoRoom {
  constructor(view) {
    this.view = view; this.g = view.g;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x120a0c);
    if (view.scene.environment) { this.scene.environment = view.scene.environment; }
    this.camera = new THREE.PerspectiveCamera(58, view.camera.aspect, 0.1, 60);
    this.yaw = Math.PI; this.camPos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.snap = true; this.t = 0;
    this.camT = new THREE.Vector3(); this.lookT = new THREE.Vector3();
    this.face = Math.PI;
    this.slots = []; this.bulbs = []; this.people = [];
    this.wheelRot = 0; this.wheelAnim = null; this.raceAnim = null;
    this.buildShell();
    this.buildLights();
    this.buildSlots();
    this.buildWheel();
    this.buildCards();
    this.buildRace();
    this.buildDecor();
    this.buildPeople();
    this.avatar = (view.K && makeCharacterK('player', 0)) || buildCharacter('player', 0);
    this.scene.add(this.avatar.g);
  }

  // ───────── стены, пол, потолок, окна, лифт ─────────
  buildShell() {
    const R = CASINO_ROOM, W = R.w, D = R.d, H = R.h, sc = this.scene;
    // ковёр: бордовый с золотыми ромбами
    const cv = roomCanvas(256, 256), x = cv.getContext('2d');
    x.fillStyle = '#5c1018'; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(217,164,0,0.55)'; x.lineWidth = 6;
    x.beginPath(); x.moveTo(128, 8); x.lineTo(248, 128); x.lineTo(128, 248); x.lineTo(8, 128); x.closePath(); x.stroke();
    x.fillStyle = 'rgba(217,164,0,0.45)';
    for (const [px, py] of [[128, 128], [0, 0], [256, 0], [0, 256], [256, 256]]) { x.beginPath(); x.arc(px, py, 14, 0, Math.PI * 2); x.fill(); }
    const floor = roomPlane(W, D, roomTex(cv, [W / 3, D / 3]), true);
    floor.rotation.x = -Math.PI / 2;
    sc.add(floor);
    const k = new Kit(301);
    // стены (толщина 0.3 — изнутри видны лицевые грани), золотой плинтус и карниз, панели
    const wall = (cx, cz, w, d) => k.box(ROOM_COL.wall, cx, H / 2, cz, w, H, d, { surf: SURF.paint, b: 0.02 });
    wall(0, -D / 2 - 0.15, W + 0.6, 0.3); wall(0, D / 2 + 0.15, W + 0.6, 0.3);
    wall(-W / 2 - 0.15, 0, 0.3, D); wall(W / 2 + 0.15, 0, 0.3, D);
    for (const [cx, cz, w, d] of [[0, -D / 2 + 0.03, W, 0.06], [0, D / 2 - 0.03, W, 0.06], [-W / 2 + 0.03, 0, 0.06, D], [W / 2 - 0.03, 0, 0.06, D]]) {
      k.box(ROOM_COL.wallLow, cx, 0.55, cz, w, 1.1, d, { surf: SURF.wood, b: 0.01 });
      k.box(ROOM_COL.gold, cx, 1.12, cz + (cz ? -Math.sign(cz) * 0.02 : 0), w, 0.06, d + 0.02, { surf: SURF.metal, b: 0.01 });
      k.box(ROOM_COL.gold, cx, H - 0.35, cz, w, 0.12, d + 0.04, { surf: SURF.metal, b: 0.02 });
    }
    for (let i = -4; i <= 4; i++) for (const zz of [-D / 2 + 0.05, D / 2 - 0.05]) {
      if (Math.abs(i * 2.2) < 1.6 && zz > 0) continue;   // у лифта
      k.box(ROOM_COL.goldDark, i * 2.2, 2.35, zz, 0.05, 2.3, 0.04, { surf: SURF.metal, b: 0 });
    }
    // потолок
    k.box(0x1c0d10, 0, H + 0.05, 0, W + 0.6, 0.1, D + 0.6, { surf: SURF.paint, b: 0 });
    // лифт в южной стене: золотая рамка, створки
    k.box(ROOM_COL.gold, 0, 1.35, D / 2 - 0.08, 2.5, 2.7, 0.12, { surf: SURF.metal, b: 0.03 });
    k.box(ROOM_COL.steel, -0.53, 1.25, D / 2 - 0.16, 1.02, 2.45, 0.05, { surf: SURF.steel, b: 0.01 });
    k.box(ROOM_COL.steel, 0.53, 1.25, D / 2 - 0.16, 1.02, 2.45, 0.05, { surf: SURF.steel, b: 0.01 });
    sc.add(k.mesh({ ao: [0.6, 0.75] }));
    const ex = signMesh('ВЫХОД ▼', 1.6, 0.36, '#7d1410', '#ffd84a', 0.7);
    ex.position.set(0, 3.0, D / 2 - 0.12); ex.rotation.y = Math.PI;
    sc.add(ex);
    // окна по бокам от лифта: вечерний город с 8-го этажа
    const wcv = roomCanvas(512, 256), wx = wcv.getContext('2d');
    const gr = wx.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#24345e'); gr.addColorStop(0.6, '#e08a5a'); gr.addColorStop(1, '#f2c27a');
    wx.fillStyle = gr; wx.fillRect(0, 0, 512, 256);
    const rs = { s: 91 };
    for (let i = 0; i < 26; i++) {
      const bw = 14 + rngNext(rs) * 30, bh = 40 + rngNext(rs) * 120, bx = rngNext(rs) * 512;
      wx.fillStyle = '#1b1d2e'; wx.fillRect(bx, 256 - bh, bw, bh);
      wx.fillStyle = 'rgba(255,214,120,0.85)';
      for (let y = 256 - bh + 6; y < 250; y += 12) for (let xx = bx + 3; xx < bx + bw - 4; xx += 8) if (rngNext(rs) < 0.35) wx.fillRect(xx, y, 3, 5);
    }
    for (const sx of [-5.5, 5.5]) {
      const win = roomPlane(4.4, 2.0, roomTex(wcv), false);
      win.position.set(sx, 2.15, D / 2 - 0.04); win.rotation.y = Math.PI;
      sc.add(win);
      const fr = new Kit(302 + sx);
      fr.box(ROOM_COL.gold, sx, 2.15, D / 2 - 0.05, 4.6, 2.2, 0.04, { surf: SURF.metal, b: 0 });
      const fm = fr.mesh(); fm.position.z = 0.012; sc.add(fm);
      for (const dx of [-1.1, 0, 1.1]) { const k2 = new Kit(310); k2.box(ROOM_COL.gold, sx + dx, 2.15, D / 2 - 0.07, 0.05, 2.0, 0.03, { surf: SURF.metal, b: 0 }); sc.add(k2.mesh()); }
    }
  }

  buildLights() {
    const sc = this.scene;
    sc.add(new THREE.AmbientLight(0xffe2c4, 0.55));
    const d = new THREE.DirectionalLight(0xffe7c8, 1.6);
    d.position.set(3, 10, 5); d.target.position.set(0, 0, 0);
    d.castShadow = true;
    const c = d.shadow.camera; c.left = -11; c.right = 11; c.top = 9; c.bottom = -9; c.near = 1; c.far = 25;
    d.shadow.mapSize.set(1024, 1024); d.shadow.bias = -0.0008;
    sc.add(d, d.target);
    // люстры: золотое кольцо, лампы-шарики, тёплый свет
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0, toneMapped: false });
    for (const [x, z] of [[-5, 0], [0, -1.2], [5, 0]]) {
      const k = new Kit(320);
      k.cyl(ROOM_COL.gold, x, CASINO_ROOM.h - 0.25, z, 0.04, 0.5, { n: 6, surf: SURF.metal });
      k.lathe(ROOM_COL.gold, x, CASINO_ROOM.h - 0.6, z, [[0.6, -0.02], [0.66, 0], [0.66, 0.06], [0.6, 0.08]], { n: 24, surf: SURF.metal });
      sc.add(k.mesh({}, false));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2, b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), bulbMat);
        b.position.set(x + Math.cos(a) * 0.63, CASINO_ROOM.h - 0.5, z + Math.sin(a) * 0.63);
        sc.add(b);
      }
      const p = new THREE.PointLight(0xffc98a, 9, 12, 1.6);
      p.position.set(x, CASINO_ROOM.h - 0.8, z);
      sc.add(p);
    }
  }

  // ───────── игровые автоматы ─────────
  // Экран автомата — холст с тремя барабанами; крутим перерисовкой
  drawReels(s, syms, blur) {
    const x = s.ctx, w = s.cv.width, h = s.cv.height;
    x.fillStyle = '#2b0d12'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      const rx = 10 + i * (w - 20) / 3, rw = (w - 20) / 3 - 8;
      x.fillStyle = '#fff7df'; x.fillRect(rx, 16, rw, h - 32);
      x.font = `${Math.round(h * 0.42)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      if (blur && blur[i]) { x.globalAlpha = 0.55; x.fillText(syms[i], rx + rw / 2, h / 2 - 6); x.globalAlpha = 1; }
      else x.fillText(syms[i], rx + rw / 2, h / 2 + 2);
    }
    x.fillStyle = 'rgba(224,80,60,0.9)'; x.fillRect(4, h / 2 - 2, w - 8, 4);   // линия выигрыша
    s.tex.needsUpdate = true;
  }

  buildSlots() {
    const S = CASINO.slot;
    CASINO_ROOM.slots.forEach((z, i) => {
      const grp = new THREE.Group();
      grp.position.set(-9.2, 0, z); grp.rotation.y = Math.PI / 2;   // лицом в зал (+x)
      const k = new Kit(330 + i);
      k.box(0x5a1018, 0, 0.5, 0, 1.0, 1.0, 0.95, { surf: SURF.paint, b: 0.05 });
      k.box(ROOM_COL.gold, 0, 1.02, 0.12, 1.04, 0.06, 0.72, { surf: SURF.metal, b: 0.02 });
      k.box(0x701522, 0, 1.55, -0.08, 1.0, 1.06, 0.62, { surf: SURF.paint, b: 0.05 });
      k.box(ROOM_COL.gold, 0, 1.55, 0.24, 0.92, 0.66, 0.02, { surf: SURF.metal, b: 0 });
      k.box(0x22080c, 0, 2.2, -0.08, 0.9, 0.26, 0.5, { surf: SURF.paint, b: 0.04 });
      for (const bx of [-0.25, 0, 0.25]) k.box([0xe0503c, 0x2fa35a, 0x3d8bfd][(bx * 4 + 1) | 0], bx, 1.07, 0.32, 0.14, 0.05, 0.1, { surf: SURF.plastic, b: 0.01 });
      k.cyl(ROOM_COL.steel, 0.58, 1.3, 0, 0.035, 0.7, { n: 8, surf: SURF.steel });
      grp.add(k.mesh({ ao: [0.4, 0.7] }));
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), plainMaterial({ color: 0xd23a2f, roughness: 0.3 }));
      ball.position.set(0.58, 1.68, 0); grp.add(ball);
      const cv = roomCanvas(300, 170), s = { cv, ctx: cv.getContext('2d'), tex: null, ball, spin: null };
      s.tex = roomTex(cv);
      const scr = roomPlane(0.86, 0.5, s.tex, false);
      scr.position.set(0, 1.58, 0.255); grp.add(scr);
      const sign = signMesh('ДЖЕКПОТ', 0.8, 0.2, '#22080c', '#ffd84a', 0.7);
      sign.position.set(0, 2.2, 0.175); grp.add(sign);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd84a, toneMapped: false }));
      lamp.position.set(0, 2.33, -0.08); grp.add(lamp);
      s.lamp = lamp;
      s.idle = [0, 1, 2].map(() => S.sym[Math.floor(Math.random() * S.sym.length)]);
      this.drawReels(s, s.idle);
      this.scene.add(grp);
      this.slots.push(s);
    });
  }

  // барабаны машины m мелькают и встают по одному на выпавшее (reels — номера символов из Game)
  spinSlot(m, reels, dur) {
    const s = this.slots[m];
    if (s) s.spin = { t: 0, dur, reels: reels.map((i) => CASINO.slot.sym[i]) };
  }

  // ───────── колесо фортуны ─────────
  buildWheel() {
    const grp = new THREE.Group(), zw = -CASINO_ROOM.d / 2 + 0.25;
    grp.position.set(0, 1.95, zw);   // под потолком 4 м: верх обода — 3.5, стрелка — 3.8
    const cv = roomCanvas(512, 512);
    drawCasinoWheel(cv);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.5, 64), new THREE.MeshBasicMaterial({ map: roomTex(cv), toneMapped: false }));
    disc.position.z = 0.1;
    grp.add(disc);
    this.wheel = disc;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.54, 0.08, 10, 64), plainMaterial({ color: ROOM_COL.gold, metalness: 0.7, roughness: 0.3 }));
    rim.position.z = 0.1; grp.add(rim);
    const back = new THREE.Mesh(new THREE.CircleGeometry(1.9, 48), plainMaterial({ color: 0x22080c, roughness: 0.8 }));
    back.position.z = 0.02; grp.add(back);
    // лампочки по кругу — мигают
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9b0, toneMapped: false }));
      b.position.set(Math.cos(a) * 1.73, Math.sin(a) * 1.73, 0.12);
      grp.add(b); this.bulbs.push(b);
    }
    // стрелка сверху — красный треугольник вниз
    const k = new Kit(340);
    k.prism(0xe0503c, 0, 1.66, 0.2, [[-0.15, 0.2], [0.15, 0.2], [0, -0.12]], 0.08, { surf: SURF.paint });
    k.cyl(ROOM_COL.gold, 0, 0, 0.16, 0.16, 0.12, { axis: 'z', n: 16, surf: SURF.metal });
    grp.add(k.mesh({}, false));
    this.scene.add(grp);
    // стойка под колесом
    const st = new Kit(341);
    st.box(0x5a1018, 0, 0.16, zw + 0.45, 4.4, 0.32, 1.1, { surf: SURF.paint, b: 0.05 });   // низкая ступень: колесо видно целиком
    st.box(ROOM_COL.gold, 0, 0.33, zw + 0.45, 4.5, 0.04, 1.2, { surf: SURF.metal, b: 0.02 });
    this.scene.add(st.mesh({ ao: [0.4, 0.7] }));
    const sign = signMesh('КОЛЕСО ФОРТУНЫ', 2.2, 0.26, '#7d1410', '#ffd84a', 0.72);
    sign.position.set(0, 0.17, zw + 1.01); this.scene.add(sign);
  }

  // колесо приезжает на угол deg (по часовой, как в UI.casinoWheelDeg) за dur секунд
  spinWheel(deg, dur) { this.wheelAnim = { from: this.wheelRot, to: -deg * Math.PI / 180, t: 0, dur }; }

  // ───────── стол «больше-меньше» ─────────
  drawCard(card) {
    const x = this.cardCtx, w = this.cardCv.width, h = this.cardCv.height;
    x.fillStyle = card ? '#ffffff' : '#b5332a'; x.fillRect(0, 0, w, h);
    if (!card) {
      x.strokeStyle = '#9c2a22'; x.lineWidth = 6;
      for (let i = -h; i < w + h; i += 18) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + h, h); x.stroke(); }
    } else {
      const r = card <= 10 ? String(card) : ['В', 'Д', 'К', 'Т'][card - 11], suit = '♠♥♦♣'[card % 4], red = suit === '♥' || suit === '♦';
      x.fillStyle = red ? '#d23a2f' : '#23303b';
      x.font = '900 92px Nunito, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(r, w / 2, h * 0.4);
      x.font = '900 70px sans-serif'; x.fillText(suit, w / 2, h * 0.75);
      x.strokeStyle = '#c9ced4'; x.lineWidth = 4; x.strokeRect(4, 4, w - 8, h - 8);
    }
    this.cardTex.needsUpdate = true;
  }

  buildCards() {
    const k = new Kit(350), cx = 6.6, cz = -2.4;
    k.cyl(0x2a1410, cx, 0.42, cz, 0.22, 0.84, { n: 12, surf: SURF.wood });
    k.cyl(ROOM_COL.wood, cx, 0.82, cz, 1.0, 0.09, { n: 32, surf: SURF.wood, scale: [1, 1, 1.5] });
    k.cyl(ROOM_COL.felt, cx, 0.87, cz, 0.9, 0.03, { n: 32, surf: SURF.cloth, scale: [1, 1, 1.5] });
    for (const [dx, dz, c] of [[0.35, -0.6, 0xd23a2f], [0.45, -0.35, 0x3d8bfd], [0.3, 0.55, 0x2fa35a]]) {
      for (let i = 0; i < 4; i++) k.cyl(c, cx + dx, 0.9 + i * 0.025, cz + dz, 0.07, 0.022, { n: 14, surf: SURF.plastic });
    }
    this.scene.add(k.mesh({ ao: [0.4, 0.7] }));
    this.cardCv = roomCanvas(128, 184); this.cardCtx = this.cardCv.getContext('2d'); this.cardTex = roomTex(this.cardCv);
    const holder = new THREE.Group();
    holder.position.set(cx - 0.6, 0.895, cz); holder.rotation.y = -Math.PI / 2;   // верх карты — от игрока (на восток)
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.58), plainMaterial({ map: this.cardTex, roughness: 0.6 }));
    card.rotation.x = -Math.PI / 2; card.castShadow = true;
    holder.add(card);
    this.scene.add(holder);
    this.drawCard(this.g.s.casino.hilo ? this.g.s.casino.hilo.card : 0);
    const sign = signMesh('БОЛЬШЕ · МЕНЬШЕ', 1.8, 0.32, '#0f3a20', '#ffd84a', 0.6);
    sign.position.set(9.95 - 0.2, 2.6, cz); sign.rotation.y = -Math.PI / 2;
    this.scene.add(sign);
  }
  showCard(card) { this.drawCard(card || 0); }

  // ───────── гонка лесорубов: экран на восточной стене ─────────
  drawRace(odds, pos, winner, pick) {
    const x = this.raceCtx, w = this.raceCv.width, h = this.raceCv.height, names = CASINO.race.names;
    x.fillStyle = '#10241a'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffd84a'; x.font = '900 46px Nunito, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(winner >= 0 ? '🏆 ' + names[winner] + ' первый!' : 'ГОНКА ЛЕСОРУБОВ', w / 2, 44);
    const lh = (h - 100) / names.length;
    names.forEach((n, i) => {
      const y = 92 + i * lh, mid = y + lh / 2;
      x.fillStyle = i === winner ? 'rgba(47,158,84,0.45)' : i === pick ? 'rgba(245,180,0,0.22)' : 'rgba(255,255,255,0.06)';
      x.fillRect(16, y + 4, w - 32, lh - 8);
      x.fillStyle = '#ffffff'; x.font = '800 30px Nunito, sans-serif'; x.textAlign = 'left';
      x.fillText(n, 30, mid);
      x.fillStyle = '#ffd84a'; x.fillText('×' + odds[i], 190, mid);
      const t0 = 290, t1 = w - 90, p = pos ? pos[i] : 0;
      x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(t0, mid - 3, t1 - t0, 6);
      x.font = '58px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'; x.textAlign = 'center';
      x.fillText('🪓', t0 + (t1 - t0) * p, mid);
      x.fillText('🌲', w - 50, mid);
    });
    this.raceTex.needsUpdate = true;
  }

  buildRace() {
    const k = new Kit(360), sx = CASINO_ROOM.w / 2 - 0.08, sz = 3.3;
    k.box(ROOM_COL.screen, sx, 2.35, sz, 0.12, 2.9, 5.3, { surf: SURF.metal, b: 0.03 });
    k.box(ROOM_COL.gold, sx - 0.02, 2.35, sz, 0.1, 3.0, 5.4, { surf: SURF.metal, b: 0.02 });
    // стойка букмекера
    k.box(ROOM_COL.wood, 7.9, 0.55, sz, 1.0, 1.1, 3.2, { surf: SURF.wood, b: 0.05 });
    k.box(ROOM_COL.gold, 7.9, 1.13, sz, 1.1, 0.06, 3.3, { surf: SURF.metal, b: 0.02 });
    this.scene.add(k.mesh({ ao: [0.4, 0.7] }));
    this.raceCv = roomCanvas(1024, 520); this.raceCtx = this.raceCv.getContext('2d'); this.raceTex = roomTex(this.raceCv);
    const scr = roomPlane(5.0, 2.55, this.raceTex, false);
    scr.position.set(sx - 0.08, 2.35, sz); scr.rotation.y = -Math.PI / 2;
    this.scene.add(scr);
    const sign = signMesh('СТАВКИ', 1.4, 0.34, '#7d1410', '#ffd84a', 0.72);
    sign.position.set(7.38, 0.75, sz); sign.rotation.y = -Math.PI / 2;
    this.scene.add(sign);
    this.raceIdle();
  }
  raceIdle() { if (!this.raceAnim) this.drawRace(this.g.raceNext().odds, null, -1, this.view.ui.csPick); }
  // победитель уже выбран в Game — он и добегает первым за dur секунд, остальные отстают
  race(odds, winner, pick, dur) {
    const n = odds.length;
    this.raceAnim = { odds, winner, pick, dur, t: 0,
      fin: [...Array(n)].map((_, i) => (i === winner ? dur : dur * (1.06 + Math.random() * 0.2))),
      ph: [...Array(n)].map(() => Math.random() * 6) };
  }

  // ───────── статуя, диваны, растения ─────────
  buildDecor() {
    const k = new Kit(370);
    // «Золотой топор» на постаменте посреди зала — медленно вращается
    k.cyl(ROOM_COL.marble, 0, 0.45, 0.8, 0.75, 0.9, { n: 24, surf: SURF.concrete, b: 0.03 });
    k.cyl(ROOM_COL.gold, 0, 0.92, 0.8, 0.8, 0.06, { n: 24, surf: SURF.metal });
    for (const sx of [-6.2, 6.2]) {   // диваны спинкой к южной стене
      k.box(ROOM_COL.velvet, sx, 0.25, 6.15, 2.4, 0.5, 0.9, { surf: SURF.cloth, b: 0.08 });
      k.box(ROOM_COL.velvet, sx, 0.8, 6.55, 2.4, 0.7, 0.22, { surf: SURF.cloth, b: 0.08 });
      for (const dx of [-1.15, 1.15]) k.box(ROOM_COL.velvet, sx + dx, 0.55, 6.2, 0.2, 0.6, 0.9, { surf: SURF.cloth, b: 0.06 });
      for (const dx of [-1.1, 1.1]) k.cyl(ROOM_COL.gold, sx + dx, 0.05, 6.2, 0.05, 0.1, { n: 8, surf: SURF.metal });
    }
    this.scene.add(k.mesh({ ao: [0.4, 0.7] }));
    const ax = new Kit(371);
    ax.cyl(ROOM_COL.wood, 0, 0.8, 0, 0.06, 1.6, { n: 10, surf: SURF.wood });
    ax.prism(ROOM_COL.gold, 0.22, 1.42, 0, [[-0.08, 0.2], [0.42, 0.34], [0.5, 0], [0.42, -0.34], [-0.08, -0.2]], 0.07, { surf: SURF.metal });
    this.axe = ax.mesh();
    this.axe.position.set(0, 0.95, 0.8);
    this.scene.add(this.axe);
    const pl = signMesh('ЗОЛОТОЙ ТОПОР', 1.3, 0.26, '#7d1410', '#ffd84a', 0.66);
    pl.position.set(0, 0.55, 0.8 + 0.76); this.scene.add(pl);
    // растения и торшеры Kenney (если модели не загрузились — без них)
    if (this.view.K && window.LIB_OK) {
      for (const [x, z] of [[-9.4, -6.4], [9.4, -6.4], [-9.4, 6.4], [9.4, 6.4]]) {
        const m = kMesh('furniture-kit/pottedPlant', { size: [null, 1.4, null] });
        if (m) { m.position.set(x, 0, z); this.scene.add(m); }
      }
      for (const [x, z] of [[-4.4, 6.3], [4.4, 6.3]]) {
        const m = kMesh('furniture-kit/lampSquareFloor', { size: [null, 1.9, null] });
        if (m) { m.position.set(x, 0, z); this.scene.add(m); }
      }
    }
  }

  // посетитель у четвёртого автомата, ещё один у дивана и крупье — стоят, дышат
  buildPeople() {
    const put = (seed, x, z, ry) => {
      const o = (this.view.K && makeCharacterK('cust', seed)) || buildCharacter('cust', seed);
      o.g.position.set(x, 0, z); o.g.rotation.y = ry;
      this.scene.add(o.g); this.people.push(o);
    };
    put(1, -7.6, 3, -Math.PI / 2);
    put(2, -3.4, 5.2, Math.PI);
    put(3, 8.4, -2.4, -Math.PI / 2);
  }

  // ───────── кадр ─────────
  // ввод (вверх по экрану — от камеры) → оси зала
  rotateInput(inp) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), ix = inp.x, iz = inp.z;
    inp.x = fx * -iz - fz * ix;
    inp.z = fz * -iz + fx * ix;
  }

  enter() { this.snap = true; this.yaw = this.g.pl.rface; this.face = this.g.pl.rface; }

  frame(dt) {
    const g = this.g, pl = g.pl, v = this.view, R = CASINO_ROOM;
    this.t += dt;
    // игрок
    const a = this.avatar;
    a.g.position.set(pl.rx, 0, pl.rz);
    let d = pl.rface - this.face;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.face += d * (1 - Math.exp(-14 * dt));
    a.g.rotation.y = this.face;
    if (a.model) a.set(pl.moving, R.speed, false, dt);
    for (const o of this.people) if (o.model) o.set(false, 0, false, dt);
    // камера за спиной (через правое плечо): догоняет взгляд, только когда игрок идёт вперёд (пятится — не разворачивается).
    // Встал у игры — отходит назад-вбок и смотрит на саму игру сверху: игрок не заслоняет экран, колесо, карту
    if (pl.moving) {
      let dy = pl.rface - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      if (Math.abs(dy) < Math.PI * 0.55) this.yaw += dy * (1 - Math.exp(-2.4 * dt));
    }
    const sp = pl.spot && R.spots[pl.spot], cam = this.camT, look = this.lookT;
    if (sp && sp.look && !pl.moving) {
      const dx = sp.look[0] - pl.rx, dz = sp.look[2] - pl.rz, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
      const [cb, cs, ch] = sp.cam || [3.2, 1.6, 2.9];
      cam.set(pl.rx - ux * cb - uz * cs, ch, pl.rz - uz * cb + ux * cs);
      look.set(sp.look[0], sp.look[1] - 0.55, sp.look[2]);   // цель — в верхней половине кадра: снизу панель ставки
    } else {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), sx = -fz * 0.85, sz = fx * 0.85;
      cam.set(pl.rx - fx * 4.3 + sx, 0, pl.rz - fz * 4.3 + sz);
      look.set(pl.rx + fx * 2.4 + sx * 0.5, 1.4, pl.rz + fz * 2.4 + sz * 0.5);
    }
    cam.x = clamp(cam.x, -R.w / 2 + 0.4, R.w / 2 - 0.4); cam.z = clamp(cam.z, -R.d / 2 + 0.4, R.d / 2 - 0.4);
    // упёрлась в стену — повыше, чтобы голова игрока не закрывала зал
    if (!(sp && sp.look && !pl.moving)) cam.y = Math.min(R.h - 0.35, 2.7 + Math.max(0, 4.3 - Math.hypot(cam.x - pl.rx, cam.z - pl.rz)) * 0.45);
    if (this.snap) { this.camPos.copy(cam); this.look.copy(look); this.snap = false; }
    else { const k = 1 - Math.exp(-6 * dt); this.camPos.lerp(cam, k); this.look.lerp(look, k); }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.look);
    this.animate(dt);
    // подписи мест игр
    v.labels.cam = this.camera;
    const cf = this.camera.getWorldDirection(_pos);
    for (const id in R.spots) {
      const p = R.spots[id];
      if (Math.abs(p.x - pl.rx) > 9 || Math.abs(p.z - pl.rz) > 9) continue;
      if ((p.x - this.camPos.x) * cf.x + (p.z - this.camPos.z) * cf.z < 1.5) continue;   // за спиной камеры или вплотную — не подписываем
      v.labels.set('room' + id, p.x, id === 'exit' ? 2.6 : 2.2, p.z, `<div class="t">${p.name}</div>`, 'station' + (pl.spot === id ? ' on' : ''));
    }
  }

  animate(dt) {
    const t = this.t;
    this.axe.rotation.y = t * 0.6;
    this.bulbs.forEach((b, i) => b.material.color.setHex((Math.floor(t * 3) + i) % 2 ? 0xffe9b0 : 0xffb43b));
    // автоматы: свой крутится по ставке; у посетителя — сам по себе раз в несколько секунд
    this.slots.forEach((s, i) => {
      if (!s.spin && i === 3 && Math.floor(t / 6) !== s.lastAuto) { s.lastAuto = Math.floor(t / 6); s.spin = { t: 0, dur: 1.4, reels: [0, 1, 2].map(() => CASINO.slot.sym[Math.floor(Math.random() * CASINO.slot.sym.length)]) }; }
      s.lamp.material.color.setHex(s.spin ? ((Math.floor(t * 8) % 2) ? 0xffd84a : 0xe0503c) : 0xffd84a);
      if (!s.spin) return;
      const sp = s.spin;
      sp.t += dt;
      s.ball.position.y = sp.t < 0.3 ? 1.68 - sp.t * 1.2 : 1.32 + Math.min(0.36, (sp.t - 0.3) * 1.2);   // рычаг дёрнули
      if ((sp.tick = (sp.tick || 0) + dt) < 0.07 && sp.t < sp.dur) return;
      sp.tick = 0;
      const stop = (k) => sp.t >= 0.6 + k * (sp.dur - 0.6) / 2.2;
      const syms = [0, 1, 2].map((k) => (stop(k) ? sp.reels[k] : CASINO.slot.sym[Math.floor(Math.random() * CASINO.slot.sym.length)]));
      this.drawReels(s, syms, [0, 1, 2].map((k) => !stop(k)));
      if (sp.t >= sp.dur) { s.spin = null; s.ball.position.y = 1.68; }
    });
    // колесо: плавное торможение к нужному сектору
    const w = this.wheelAnim;
    if (w) {
      w.t += dt;
      const k = Math.min(1, w.t / w.dur), e = 1 - Math.pow(1 - k, 3);
      this.wheelRot = w.from + (w.to - w.from) * e;
      if (k >= 1) this.wheelAnim = null;
    }
    this.wheel.rotation.z = this.wheelRot;
    // гонка
    const r = this.raceAnim;
    if (r) {
      r.t += dt;
      const pos = r.fin.map((f, i) => Math.max(0, Math.min(1, r.t / f + (r.t < f ? 0.015 * Math.sin(r.t * 9 + r.ph[i]) : 0))));
      const done = r.t >= r.dur + 0.1;
      this.drawRace(r.odds, pos, done ? r.winner : -1, r.pick);
      if (r.t >= r.dur + 2.2) { this.raceAnim = null; this.raceIdle(); }
    }
  }
}
