'use strict';
// Логика игры без графики: состояние, игрок, рабочие, станки, покупатели, стройка, порт.
// Её же гоняет бот в node (tools/balance.js). События для графики копятся в game.events.

const NAV_CELL = 0.5;
const TRIG_CELL = 0.5;
const SAVE_VERSION = 1;

// ───────── дороги: маршруты машин ─────────
// Путь — ломаная с накопленной длиной cum; повороты скруглены дугами, на дуге своя предельная скорость.
function roadArc(cx, cz, r, a0, a1, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180; out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  return out;
}
function roadPath(pts, arcs) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return { pts, cum, len: cum[cum.length - 1], arcs };
}
// путь от начала до точки с данным x на прямом участке вдоль X
function roadSAtX(P, x) {
  for (let i = 0; i < P.pts.length - 1; i++) {
    const a = P.pts[i], b = P.pts[i + 1];
    if (Math.abs(a[1] - b[1]) < 1e-6 && (x - a[0]) * (x - b[0]) <= 0) return P.cum[i] + Math.abs(x - a[0]);
  }
  return null;
}
// позиция и направление на пути: пишет x, z, dx, dz в o (o.seg — кэш участка)
function roadAt(P, s, o) {
  s = clamp(s, 0, P.len);
  let i = o.seg || 0;
  while (i > 0 && P.cum[i] > s) i--;
  while (i < P.pts.length - 2 && P.cum[i + 1] < s) i++;
  o.seg = i;
  const a = P.pts[i], b = P.pts[i + 1], L = P.cum[i + 1] - P.cum[i] || 1, t = (s - P.cum[i]) / L;
  o.x = a[0] + (b[0] - a[0]) * t; o.z = a[1] + (b[1] - a[1]) * t;
  o.dx = (b[0] - a[0]) / L; o.dz = (b[1] - a[1]) / L;
}
const TRUCK_PATHS = (() => {
  const L = ROAD.lane, cx = ROAD.coastX, latA = 4;   // боковое ускорение на повороте, м/с²
  const mk = (parts, arcDefs) => {
    const pts = [];
    for (const p of parts) for (const q of p) { const l = pts[pts.length - 1]; if (!l || Math.abs(l[0] - q[0]) + Math.abs(l[1] - q[1]) > 1e-6) pts.push(q); }
    const P = roadPath(pts, []);
    for (const [x0, z0, r] of arcDefs) {   // дуга начинается в точке (x0, z0)
      const i = pts.findIndex((p) => Math.abs(p[0] - x0) < 1e-6 && Math.abs(p[1] - z0) < 1e-6);
      P.arcs.push({ s0: P.cum[i], s1: P.cum[i] + (r * Math.PI) / 2, v: Math.sqrt(latA * r) });
    }
    return P;
  };
  // лесовоз: из западного тоннеля на восток по южной полосе, после разгрузки — налево, на север в северный тоннель
  // стоп-линии светофоров на пути — по порядку
  const lines = (P, key) => LIGHTS.map((l) => ({ id: l.id, s: roadSAtX(P, l[key]) })).filter((l) => l.s !== null).sort((a, b) => a.s - b.s);
  const log = mk([[[-96, L], [cx - 2.5, L]], roadArc(cx - 2.5, L - 4, 4, 90, 0), [[cx + L, -34]]], [[cx - 2.5, L, 4]]);
  log.stop = roadSAtX(log, TUNE.logTruckStopX); log.lines = lines(log, 'stopE');
  // оптовик: из северного тоннеля на юг, направо — на запад по северной полосе, после погрузки — в западный тоннель
  const opt = mk([[[cx - L, -28], [cx - L, -L - 4.5]], roadArc(cx - L - 4.5, -L - 4.5, 4.5, 0, 90), [[-104, -L]]], [[cx - L, -L - 4.5, 4.5]]);
  opt.stop = roadSAtX(opt, TUNE.optTruckStopX); opt.lines = lines(opt, 'stopW');
  return { log, opt };
})();
const TRUCK_HALF = [3.1, 1.15];   // полудлина и полуширина машины

// Проезжая часть для рабочих непроходима, кроме переходов (путь сам строится через «зебры»)
const ROAD_BLOCKS = (() => {
  const out = [], h = ROAD.half + 0.1, w = 1.5;
  const xs = CROSSINGS.filter((c) => c.across === 'z').map((c) => c.x).sort((a, b) => a - b);
  let x0 = MAP.x0;
  for (const cx of xs) { out.push({ x0, z0: -h, x1: cx - w, z1: h }); x0 = cx + w; }
  out.push({ x0, z0: -h, x1: ROAD.coastX + h, z1: h });
  const zs = CROSSINGS.filter((c) => c.across === 'x').map((c) => c.z).sort((a, b) => a - b);
  let z0 = h;
  for (const cz of zs) { out.push({ x0: -h, z0, x1: h, z1: cz - w }); z0 = cz + w; }
  out.push({ x0: -h, z0, x1: h, z1: MAP.z1 });
  out.push({ x0: ROAD.coastX - h, z0: ROAD.tunnelN.z, x1: ROAD.coastX + h, z1: -h });
  return out;
})();

class Game {
  constructor(save) {
    this.events = [];
    this.silent = false;   // не копить события (бот в node)
    this.fast = false;     // перемотка офлайна: игрок стоит, время игры не идёт
    this.input = { x: 0, z: 0 };
    this.nav = new NavGrid(MAP, NAV_CELL);       // по правилам: дорогу — только по переходам
    this.navFree = new NavGrid(MAP, NAV_CELL);   // для спешащих: напрямик через дорогу
    this.hrs = { s: 11 };                        // генератор «спешит ли рабочий» — отдельно от случайных чисел игры
    this.lights = {};
    for (const l of LIGHTS) this.lights[l.id] = { ph: 'walk', t: 99 };
    this.tnx = Math.ceil((MAP.x1 - MAP.x0) / TRIG_CELL);
    this.tnz = Math.ceil((MAP.z1 - MAP.z0) / TRIG_CELL);
    this.tgrid = new Int16Array(this.tnx * this.tnz);
    this.cust = [];
    this.queue = [];
    this.trucks = [];
    this.spots = [null, null, null];
    this.treeRes = [];
    this.logTimer = 2;
    this.optTimer = 8;
    this.c1Timer = 3;
    this.c4Timer = 2;
    this.pneuAcc = 0;
    this.craneAcc = 0;
    this.cashierHere = false;
    this.goal = null;
    this.soft = false;     // бот: машины его пропускают и не сбивают (прогон баланса меряет экономику, а не ловкость)
    this.loose = [];       // что выронил игрок, когда его сбила машина: лежит на земле, можно подобрать
    this.lrs = { s: 7 };   // свой генератор для разлёта — не сбивает случайные числа игры
    this.c1q = [];         // очередь покупателей досок у входа на тротуаре
    this.c4q = [[], []];   // очереди у двух входов в магазин
    this.load(save);
  }

  // ───────── состояние ─────────
  fresh() {
    return {
      v: SAVE_VERSION, rng: { s: 20260929 }, t: 0, playT: 0,
      money: 0, earned: 0,
      floor: 0, floorGot: {},
      padPaid: {}, padDone: {},
      upg: {},
      piles: { yard: { log: 12 } },
      cash: {},
      st: {},
      trees: PLOTS.map(() => ({ stage: 2, t: 0 })),
      ship: null,
      sitePriority: true,
      tut: 0,
      stats: { made: {}, floorsT: [], zonesT: {}, sold: 0, ships: 0, buys: 0, hitMe: 0, hitW: 0 },
      savedAt: 0,
    };
  }

  load(save) {
    const s = this.fresh();
    let pl = null, ws = [];
    if (save && save.v === SAVE_VERSION) {
      for (const k in s) if (save[k] !== undefined) s[k] = save[k];
      if (!Array.isArray(s.trees) || s.trees.length !== PLOTS.length) s.trees = PLOTS.map(() => ({ stage: 2, t: 0 }));
      s.stats = Object.assign(this.fresh().stats, s.stats || {});
      pl = save.player; ws = save.workers || [];
    }
    this.s = s;
    this.pl = this.agent('player', pl ? pl.x : -36, pl ? pl.z : 17);
    if (pl && Array.isArray(pl.stack)) this.pl.stack = pl.stack.filter((i) => ITEMS[i]);
    this.workers = [];
    for (const r of ws) if (PAD_BY_ID[r.pad] && PAD_BY_ID[r.pad].worker) this.spawnWorker(PAD_BY_ID[r.pad], r);
    this.rebuild();
  }

  toSave() {
    const s = JSON.parse(JSON.stringify(this.s));
    s.player = { x: +this.pl.x.toFixed(2), z: +this.pl.z.toFixed(2), stack: this.pl.stack.slice() };
    s.workers = this.workers.map((w) => ({ pad: w.pad, x: +w.x.toFixed(2), z: +w.z.toFixed(2), stack: w.stack.slice(), on: w.on }));
    s.savedAt = Date.now();
    return s;
  }

  agent(kind, x, z) {
    return { kind, x, z, face: 0, moving: false, stack: [], path: null, pi: 0, xacc: 0, chop: 0, plant: 0, task: null, wait: 0, on: true };
  }

  spawnWorker(pad, rec) {
    const w = this.agent('worker', rec ? rec.x : pad.x, rec ? rec.z : pad.z);
    w.pad = pad.id;
    w.role = pad.worker.role || 'route';
    w.route = pad.worker.route || null;
    w.on = rec ? rec.on !== false : true;
    if (rec && Array.isArray(rec.stack)) w.stack = rec.stack.filter((i) => ITEMS[i]);
    const k = this.workers.length;
    w.off = [(((k * 37) % 7) - 3) * 0.16, (((k * 53) % 5) - 2) * 0.2];
    w.look = k;
    w.rash = 0.08 + ((k * 29) % 7) * 0.035;   // как часто спешит и перебегает дорогу где попало: 8–29%
    this.workers.push(w);
    if (!rec) this.ev({ t: 'hire', w });
    return w;
  }

  ev(e) { if (!this.silent && !this.fast) this.events.push(e); }
  rnd() { return rngNext(this.s.rng); }
  uv(id) { const u = UPG_BY_ID[id]; return u.v(this.s.upg[id] || 0); }
  floorBonus() { return Math.pow(FLOOR_BONUS, this.s.floor); }
  capOf(a) { return a.kind === 'player' ? this.uv('u_cap') : this.uv('u_wCap'); }

  price(it) {
    const d = ITEMS[it], base = d.base || it, fb = this.floorBonus();
    if (it === 'board') return d.price * this.uv('u_bPrice') * fb;
    if (base === 'chair' || base === 'table' || base === 'wardrobe') {
      let p = ITEMS[base].price * this.uv('u_fPrice') * fb;
      if (d.base) p *= this.uv('u_boxMul');
      return p;
    }
    return d.price * fb;
  }

  // ───────── что открыто ─────────
  zoneOpenCalc(zid) {
    if (zid === 'c' || zid === 'z1') return true;
    return this.s.floor >= ZONE_BY_ID[zid].floor && !!this.s.padDone['p_gate_' + zid];
  }
  padOk(r) { return r.startsWith('z') ? !!this.open[r] : !!this.s.padDone[r]; }
  padVisible(p) {
    return !this.s.padDone[p.id] && !!this.open[p.zone] && (p.minFloor || 0) <= this.s.floor && p.req.every((r) => this.padOk(r));
  }
  stationOn(id) { const st = STATIONS[id]; return !!this.open[st.zone] && (!st.pad || !!this.s.padDone[st.pad]); }
  pileOn(id) {
    const p = PILES[id];
    if (!this.open[p.zone]) return false;
    if (p.station && !this.stationOn(p.station)) return false;
    if (p.pad && !this.s.padDone[p.pad]) return false;
    return true;
  }
  propOn(pr) { return !!this.open[pr.zone] && (!pr.pad || !!this.s.padDone[pr.pad]); }
  plotOn(i) {
    const g = PLOTS[i].g;
    if (!this.open.z2) return false;
    return g === 0 || (g === 1 && !!this.s.padDone.p_plots2) || (g === 2 && !!this.s.padDone.p_plots3);
  }

  rebuild() {
    this.open = { c: true };
    for (const z of ZONES) this.open[z.id] = this.zoneOpenCalc(z.id);
    this.pilesOn = Object.keys(PILES).filter((id) => this.pileOn(id));
    this.pileSet = new Set(this.pilesOn);
    this.stOn = Object.keys(STATIONS).filter((id) => this.stationOn(id));
    this.solids = [];
    for (const id of this.stOn) this.solids.push(rectOf(STATIONS[id]));
    for (const pr of PROPS) if (this.propOn(pr)) this.solids.push(rectOf(pr));
    this.walls = [];
    for (const z of ZONES) if (!this.open[z.id]) this.walls.push({ x0: z.rect.x0 - 0.6, z0: z.rect.z0 - 0.6, x1: z.rect.x1 + 0.6, z1: z.rect.z1 + 0.6 });
    const sea = MAP.seaX;
    this.walls.push({ x0: sea, z0: MAP.z0 - 5, x1: MAP.x1 + 5, z1: PIER.z0 });
    this.walls.push({ x0: sea, z0: PIER.z1, x1: MAP.x1 + 5, z1: MAP.z1 + 5 });
    this.walls.push({ x0: PIER.x1, z0: PIER.z0 - 1, x1: MAP.x1 + 5, z1: PIER.z1 + 1 });
    const tn = ROAD.tunnelN;   // холм северного тоннеля
    this.walls.push({ x0: tn.x0, z0: tn.z1, x1: tn.x1, z1: tn.z });
    // навигация
    // запас больше радиуса игрока: по этим путям ходит и бот-игрок, который цепляется за углы
    const inf = (r) => ({ x0: r.x0 - 0.55, z0: r.z0 - 0.55, x1: r.x1 + 0.55, z1: r.z1 + 0.55 });
    for (const nav of [this.nav, this.navFree]) {
      nav.clear();
      for (const r of this.solids) nav.blockRect(inf(r));
      for (const r of this.walls) nav.blockRect(inf(r));
    }
    for (const r of ROAD_BLOCKS) this.nav.blockRect(r);
    this.buildTriggers();
    // игрока, оказавшегося внутри нового станка, выталкиваем
    if (this.hits(this.pl.x, this.pl.z, TUNE.playerR)) this.unstick(this.pl);
    this.dustPiles = this.stOn.map((id) => STATIONS[id].by).filter((b) => b);
    this.shelvesOn = ['shelfC', 'shelfT', 'shelfW'].filter((id) => this.pileSet.has(id));
    this.moneyPiles = this.pilesOn.filter((id) => PILES[id].money);
    this.version = (this.version || 0) + 1;   // графика перестраивает сцену по этому счётчику
  }

  buildTriggers() {
    const g = this.tgrid, nx = this.tnx, c = TRIG_CELL;
    g.fill(0);
    this.trigs = [null];
    const add = (r, t) => {
      const k = this.trigs.push(t) - 1;
      const i0 = Math.max(0, Math.ceil((r.x0 - MAP.x0) / c - 0.5)), i1 = Math.min(nx - 1, Math.floor((r.x1 - MAP.x0) / c - 0.5));
      const j0 = Math.max(0, Math.ceil((r.z0 - MAP.z0) / c - 0.5)), j1 = Math.min(this.tnz - 1, Math.floor((r.z1 - MAP.z0) / c - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g[j * nx + i] = k;
    };
    for (const id of this.pilesOn) {
      const p = PILES[id];
      if (p.mode || p.money) add(rectOf(p), { k: 'pile', id });
    }
    for (const p of PADS) if (this.padVisible(p)) add(rectOf(p), { k: 'pad', id: p.id });
    for (let i = 0; i < PLOTS.length; i++) if (this.plotOn(i)) {
      const q = PLOTS[i];
      add({ x0: q.x - 1.2, z0: q.z - 1.2, x1: q.x + 1.2, z1: q.z + 1.2 }, { k: 'plot', i });
    }
    if (this.open.z4) add(rectOf(CASHIER), { k: 'cash' });
  }

  trigAt(x, z) {
    const i = Math.floor((x - MAP.x0) / TRIG_CELL), j = Math.floor((z - MAP.z0) / TRIG_CELL);
    if (i < 0 || j < 0 || i >= this.tnx || j >= this.tnz) return null;
    return this.trigs[this.tgrid[j * this.tnx + i]];
  }

  // ───────── кучи ─────────
  pc(id) { return this.s.piles[id] || (this.s.piles[id] = {}); }
  count(id, it) { const p = this.s.piles[id]; return p ? p[it] || 0 : 0; }
  total(id) { const p = this.s.piles[id]; let n = 0; if (p) for (const k in p) n += p[k]; return n; }
  firstItem(id) { const p = this.s.piles[id]; if (p) for (const k in p) if (p[k] > 0) return k; return null; }
  siteNeed() {
    const f = FLOORS[this.s.floor], out = {};
    if (!f) return out;
    for (const it in f.need) out[it] = Math.max(0, f.need[it] - (this.s.floorGot[it] || 0));
    return out;
  }
  cap(id, it) {
    const p = PILES[id];
    if (!p.accepts) return 0;
    const b = p.accepts[it] || 0;
    if (!b) return 0;
    if (id === 'yard') return this.uv('u_yard');
    if (id === 'counter') return this.uv('u_counter');
    if (p.shelf) return this.uv('u_shelf');
    if (p.role === 'out') return Math.round(b * this.uv('u_store'));
    return b;
  }
  space(id, it) {
    const p = PILES[id];
    if (p.trash) return 999;
    if (p.site) { const f = FLOORS[this.s.floor]; return f && f.need[it] ? f.need[it] - (this.s.floorGot[it] || 0) : 0; }
    if (p.dock) { const sh = this.s.ship; return sh && sh.state === 'docked' && sh.need[it] ? sh.need[it] - (sh.got[it] || 0) : 0; }
    return this.cap(id, it) - this.count(id, it);
  }
  accepted(id) {
    const p = PILES[id];
    if (p.site) { const f = FLOORS[this.s.floor]; return f ? Object.keys(f.need) : []; }
    if (p.dock) { const sh = this.s.ship; return sh && sh.need ? Object.keys(sh.need) : []; }
    if (p.trash) return Object.keys(ITEMS);
    return p.accepts ? Object.keys(p.accepts) : [];
  }
  put(id, it) {
    const p = PILES[id];
    if (p.trash) return;
    if (p.site) { this.s.floorGot[it] = (this.s.floorGot[it] || 0) + 1; this.checkFloor(); return; }
    if (p.dock) { const sh = this.s.ship; sh.got[it] = (sh.got[it] || 0) + 1; return; }
    const c = this.pc(id); c[it] = (c[it] || 0) + 1;
  }
  take(id, it, n = 1) { const c = this.pc(id); c[it] = (c[it] || 0) - n; if (c[it] <= 0) delete c[it]; }
  stat(it, n) { this.s.stats.made[it] = (this.s.stats.made[it] || 0) + n; }
  addMoney(v) { this.s.money += v; this.s.earned += v; }
  addCash(id, v, x, z) {
    this.s.cash[id] = (this.s.cash[id] || 0) + v;
    this.s.stats.sold += v;
    this.ev({ t: 'sell', v, x, z, pile: id });
  }

  pickOne(a, id, types) {
    if (a.stack.length >= this.capOf(a)) return false;
    const c = this.s.piles[id];
    if (!c) return false;
    for (const it in c) {
      if (c[it] <= 0 || (types && types.indexOf(it) < 0)) continue;
      this.take(id, it);
      a.stack.push(it);
      this.ev({ t: 'x', it, from: { p: id }, to: { a } });
      return true;
    }
    return false;
  }

  dropOne(a, id, types) {
    for (let i = a.stack.length - 1; i >= 0; i--) {
      const it = a.stack[i];
      if (types && types.indexOf(it) < 0) continue;
      if (this.space(id, it) > 0) {
        a.stack.splice(i, 1);
        this.put(id, it);
        this.ev({ t: 'x', it, from: { a, i }, to: { p: id } });
        return true;
      }
    }
    return false;
  }

  // ───────── шаг симуляции ─────────
  step(dt) {
    const s = this.s;
    s.t += dt;
    if (!this.fast) s.playT += dt;
    this.cashierHere = false;
    if (!this.fast) { this.movePlayer(dt); this.playerAct(dt); }
    if (this.loose.length) this.looseStep(dt);
    for (const w of this.workers) this.workerStep(w, dt);
    this.lightStep(dt);
    this.trucksStep(dt);
    this.c1Step(dt);
    this.c4Step(dt);
    this.treesStep(dt);
    for (const id of this.stOn) this.stationStep(id, dt);
    this.pneumoStep(dt);
    this.shipStep(dt);
    if (!this.fast) this.goalStep();
  }

  // ───────── игрок ─────────
  movePlayer(dt) {
    const pl = this.pl;
    if (pl.stun > 0) { pl.stun -= dt; pl.moving = false; return; }   // сбила машина — секунду приходит в себя
    let vx = this.input.x, vz = this.input.z;
    const m = Math.hypot(vx, vz);
    if (m > 1) { vx /= m; vz /= m; }
    pl.moving = m > 0.05;
    if (!pl.moving) return;
    pl.face = Math.atan2(vx, vz);
    const sp = this.plSpeed();
    this.moveCollide(pl, vx * sp * dt, vz * sp * dt);
  }
  // с пустыми руками бежит быстрее (отзыв игрока: «добавить бег, когда руки пустые»)
  plSpeed() { return this.uv('u_speed') * (this.pl.stack.length ? 1 : TUNE.emptyRun); }

  moveCollide(a, dx, dz) {
    const r = TUNE.playerR, n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.25));
    for (let i = 0; i < n; i++) {
      const nx = a.x + dx / n;
      if (!this.hits(nx, a.z, r)) a.x = nx;
      const nz = a.z + dz / n;
      if (!this.hits(a.x, nz, r)) a.z = nz;
    }
  }

  hits(x, z, r) {
    if (x - r < MAP.x0 || x + r > MAP.x1 || z - r < MAP.z0 || z + r > MAP.z1) return true;
    const test = (q) => {
      const cx = clamp(x, q.x0, q.x1), cz = clamp(z, q.z0, q.z1);
      const dx = x - cx, dz = z - cz;
      return dx * dx + dz * dz < r * r;
    };
    for (const q of this.solids) if (test(q)) return true;
    for (const q of this.walls) if (test(q)) return true;
    for (const tr of this.trucks) if (this.truckTouch(tr, x, z, r)) return true;   // сквозь машину не пройти
    return false;
  }

  unstick(a) {
    for (let rad = 0.25; rad < 12; rad += 0.25) {
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2, x = a.x + Math.cos(ang) * rad, z = a.z + Math.sin(ang) * rad;
        if (!this.hits(x, z, TUNE.playerR)) { a.x = x; a.z = z; return; }
      }
    }
  }

  playerAct(dt) {
    this.playerLoose(dt);
    const pl = this.pl, t = this.trigAt(pl.x, pl.z);
    if (!t) { pl.xacc = 0; pl.chop = 0; pl.plant = 0; pl.on = null; return; }
    if (pl.on !== t) { pl.on = t; pl.xacc = 0; pl.chop = 0; pl.plant = 0; }
    if (t.k === 'pile') this.playerPile(t.id, dt);
    else if (t.k === 'pad') this.payPad(t.id, dt);
    else if (t.k === 'plot') this.plotWork(pl, t.i, dt, true, true);
    else if (t.k === 'cash') this.cashierHere = true;
  }

  playerPile(id, dt) {
    const pl = this.pl, p = PILES[id];
    if (p.money) {
      const v = this.s.cash[id] || 0;
      if (v > 0) { this.s.cash[id] = 0; this.addMoney(v); this.ev({ t: 'm', v, from: { p: id }, to: { a: pl } }); }
      return;
    }
    if (p.trash && pl.moving) { pl.xacc = 0; return; }   // мусорка забирает, только если встал — чтобы не выкинуть всё на бегу
    pl.xacc += dt;
    let guard = 60;
    while (pl.xacc >= TUNE.xferPlayer && guard-- > 0) {
      let ok = false;
      if (p.mode === 'pick') ok = (!p.pickZone || this.open[p.pickZone]) && this.pickOne(pl, id, null);
      else if (p.mode === 'drop') ok = this.dropOne(pl, id, null);
      if (!ok) { pl.xacc = 0; break; }
      pl.xacc -= TUNE.xferPlayer;
    }
  }

  payPad(id, dt) {
    const p = PAD_BY_ID[id], paid = this.s.padPaid[id] || 0, rem = p.cost - paid;
    if (rem <= 0.001) { this.completePad(p); return; }
    if (this.s.money <= 0) return;
    const v = Math.min(this.s.money, rem, Math.max(p.cost / TUNE.padFill, 40) * dt);
    this.s.money -= v;
    this.s.padPaid[id] = paid + v;
    this.pl.payAcc = (this.pl.payAcc || 0) + dt;
    if (this.pl.payAcc > 0.06) { this.pl.payAcc = 0; this.ev({ t: 'pay', pad: id }); }
    if (paid + v >= p.cost - 0.001) this.completePad(p);
  }

  completePad(p) {
    if (this.s.padDone[p.id]) return;
    this.s.padDone[p.id] = true;
    delete this.s.padPaid[p.id];
    this.s.stats.buys++;
    if (p.worker) this.spawnWorker(p, null);
    if (p.plots) PLOTS.forEach((q, i) => { if (q.g === p.plots) this.s.trees[i] = { stage: 2, t: 0 }; });
    if (p.feature === 'dock' && !this.s.ship) this.s.ship = { state: 'away', t: 3, need: null, got: {} };
    if (p.gate) this.s.stats.zonesT[p.gate] = Math.round(this.s.playT);
    this.rebuild();
    this.ev({ t: 'built', pad: p.id });
    if (p.gate) this.ev({ t: 'zone', id: p.gate });
  }

  buyUpgrade(id) {
    const u = UPG_BY_ID[id], l = this.s.upg[id] || 0;
    if (l >= u.max || !this.open[u.zone]) return false;
    const c = u.cost(l);
    if (this.s.money < c) return false;
    this.s.money -= c;
    this.s.upg[id] = l + 1;
    this.s.stats.buys++;
    this.ev({ t: 'upg', id });
    return true;
  }

  // рубка и посадка: игрок делает и то и другое, вальщик только рубит, лесник только сажает
  plotWork(a, i, dt, canChop, canPlant) {
    const tr = this.s.trees[i];
    if (tr.stage === 2 && canChop) {
      const free = this.capOf(a) - a.stack.length;
      if (free <= 0) { a.chop = 0; return false; }
      a.chop += dt;
      const need = this.uv('u_chop') * (a.kind === 'player' ? 1 : 1.25);
      if (a.chop >= need) {
        a.chop = 0;
        tr.stage = 0; tr.t = 0;
        const n = Math.min(2, free);
        for (let k = 0; k < n; k++) { a.stack.push('log'); this.ev({ t: 'x', it: 'log', from: { tree: i }, to: { a } }); }
        this.stat('log', n);
        this.ev({ t: 'fell', i });
        return true;
      }
    } else if (tr.stage === 0 && canPlant) {
      a.plant += dt;
      if (a.plant >= TUNE.plantTime * (a.kind === 'player' ? 1 : 1.5)) {
        a.plant = 0;
        tr.stage = 1; tr.t = 0;
        this.ev({ t: 'plant', i });
        return true;
      }
    }
    return false;
  }

  // ───────── движение по пути ─────────
  // Все ходят по правилам: дорогу — по переходам. Рабочий, которому надо на ту сторону, иногда спешит (w.rash):
  // идёт напрямик и не ждёт светофора — машины таких не ждут и могут сбить
  goTo(a, x, z) {
    let nav = this.nav;
    a.hurry = false;
    if (a.kind === 'worker' && this.crossesRoad(a.x, a.z, x, z) && rngNext(this.hrs) < a.rash) { nav = this.navFree; a.hurry = true; }
    a.path = nav.findPath(a.x, a.z, x, z); a.pi = 0; a.moving = true;
  }
  goPile(a, id) {
    const p = PILES[id], o = a.off || [0, 0];
    this.goTo(a, p.x + clamp(o[0], -p.w / 2 + 0.3, p.w / 2 - 0.3), p.z + clamp(o[1], -p.d / 2 + 0.3, p.d / 2 - 0.3));
  }
  follow(a, dt, sp) {
    if (!a.path) { a.moving = false; return true; }
    // у перехода со светофором — ждём зелёный (спешащий не ждёт)
    a.xwait = false;
    if (a.kind === 'worker' && !a.hurry && a.pi < a.path.length) {
      const tx = a.path[a.pi][0], tz = a.path[a.pi][1], dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
      const wait = d > 1e-4 && this.crossWait(a.x, a.z, a.x + (dx / d) * 0.35, a.z + (dz / d) * 0.35);
      if (wait) { a.xwait = wait; a.moving = false; a.face = Math.atan2(dx, dz); return false; }
    }
    let mv = sp * dt;
    while (mv > 0 && a.pi < a.path.length) {
      const tx = a.path[a.pi][0], tz = a.path[a.pi][1];
      const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
      if (d > 1e-4) a.face = Math.atan2(dx, dz);
      if (d <= mv) { a.x = tx; a.z = tz; mv -= d; a.pi++; }
      else { a.x += (dx / d) * mv; a.z += (dz / d) * mv; mv = 0; }
    }
    if (a.pi >= a.path.length) { a.path = null; a.moving = false; return true; }
    a.moving = true;
    return false;
  }
  rest(w, t) { w.task = 'rest'; w.wait = t; w.path = null; w.moving = false; }

  // ───────── рабочие ─────────
  workerStep(w, dt) {
    if (w.stun > 0) { w.stun -= dt; w.moving = false; return; }   // сбила машина — лежит, потом встаёт
    if (!w.on) {
      if (w.task !== 'off') { this.release(w); w.task = 'off'; w.path = null; w.moving = false; }
      return;
    }
    if (w.task === 'off') w.task = null;
    const sp = this.uv('u_wSpeed');
    switch (w.role) {
      case 'route': this.routeW(w, dt, sp); break;
      case 'builder': this.builderW(w, dt, sp); break;
      case 'lumberjack': this.lumberW(w, dt, sp); break;
      case 'forester': this.foresterW(w, dt, sp); break;
      case 'cashier': this.cashierW(w, dt, sp); break;
      case 'collector': this.collectorW(w, dt, sp); break;
    }
    // сколько уже стоит без дела: графика после TUNE.idleShow пишет над головой, чего он ждёт (workerWhy)
    const busy = w.moving || w.task === 'load' || w.task === 'unload' || w.task === 'chop' || w.task === 'plant' || w.task === 'post';
    w.still = busy ? 0 : (w.still || 0) + dt;
  }

  release(w) { if (w.tree !== undefined && this.treeRes[w.tree] === w) this.treeRes[w.tree] = null; w.tree = undefined; }

  // общие шаги «дойти — набрать — отнести — выгрузить»; true — шаг обработан
  carry(w, dt, sp) {
    const cap = this.capOf(w);
    switch (w.task) {
      case 'toSrc':
        if (this.follow(w, dt, sp)) { w.task = 'load'; w.xacc = 0; }
        return true;
      case 'load':
        if (!this.pileSet.has(w.src)) { w.task = null; return true; }
        w.xacc += dt;
        while (w.xacc >= TUNE.xferWorker) {
          w.xacc -= TUNE.xferWorker;
          if (w.stack.length >= Math.min(cap, w.want) || !this.pickOne(w, w.src, w.types)) {
            if (w.stack.length) { w.task = 'toDst'; this.goPile(w, w.dst); } else w.task = null;
            return true;
          }
        }
        return true;
      case 'toDst':
        if (this.follow(w, dt, sp)) { w.task = 'unload'; w.xacc = 0; }
        return true;
      case 'unload':
        if (!this.pileSet.has(w.dst)) { w.task = null; return true; }
        w.xacc += dt;
        while (w.xacc >= TUNE.xferWorker) {
          w.xacc -= TUNE.xferWorker;
          if (!w.stack.length || !this.dropOne(w, w.dst, null)) { w.task = null; return true; }
        }
        return true;
      case 'rest':
        w.wait -= dt;
        if (w.wait <= 0) w.task = null;
        return true;
    }
    return false;
  }

  routeW(w, dt, sp) {
    if (this.carry(w, dt, sp)) return;
    const R = ROUTES[w.route];
    if (w.stack.length) {
      const dst = this.bestSink(w, R.to);
      if (dst) { w.dst = dst; w.task = 'toDst'; this.goPile(w, dst); } else this.rest(w, 1.5);
      return;
    }
    const exSrc = R.excessWhen ? (this.stationOn(R.excessWhen) ? R.excessSrc : []) : null;
    const job = this.bestJob(w, R.from, R.to, R.excess || 0, exSrc);
    if (!job) { this.rest(w, 1.2); return; }
    Object.assign(w, job);
    w.task = 'toSrc';
    this.goPile(w, w.src);
  }

  pileFill(id) {
    const p = PILES[id];
    if (!p.accepts) return 0;
    let cap = 0;
    for (const it in p.accepts) cap += this.cap(id, it);
    return cap ? this.total(id) / cap : 0;
  }

  // excess — брать только излишки (выход заполнен больше этой доли); exSrc — к каким источникам это относится (null — ко всем).
  // why — если передан, сюда пишется, что помешало (для подписи «чего ждёт» над рабочим)
  bestJob(w, from, to, excess = 0, exSrc = null, why = null) {
    const cap = this.capOf(w);
    // «Стройка в приоритете»: рабочие продаж не трогают то, что сейчас нужно небоскрёбу (его заберут строители)
    const need = this.s.sitePriority !== false && this.workers.some((x) => x.role === 'builder' && x.on) ? this.siteNeed() : null;
    let best = null, bs = 0;
    for (const dst of to) {
      if (!this.pileSet.has(dst)) continue;
      const pd = PILES[dst];
      let acc = this.accepted(dst);
      if (need && (pd.sell || dst === 'pwh')) {
        if (why) for (const it of acc) if (need[it] > 0 && from.some((s) => this.pileSet.has(s) && this.count(s, it) > 0)) why.site = it;
        acc = acc.filter((it) => !(need[it] > 0));
      }
      for (const src of from) {
        if (src === dst || !this.pileSet.has(src)) continue;
        if (excess && (!exSrc || exSrc.indexOf(src) >= 0) && this.pileFill(src) <= excess) {
          if (why && acc.some((it) => this.count(src, it) > 0)) why.excess = src;
          continue;
        }
        const ps = PILES[src];
        // заполненность считаем по каждому предмету: у верстака ножки могут лежать горой, а досок ноль
        let n = 0, room = 0, capD = 0, fill = 1; const types = [];
        for (const it of acc) {
          const sp = this.space(dst, it), c = this.count(src, it);
          if (c > 0 && sp <= 0 && why && !why.full) why.full = dst;
          if (sp > 0 && c > 0) {
            n += Math.min(sp, c); room += sp; types.push(it);
            const cp = pd.accepts ? this.cap(dst, it) : 0;
            capD += cp;
            fill = Math.min(fill, cp > 0 ? this.count(dst, it) / cp : 0);
          }
        }
        if (!n) continue;
        n = Math.min(n, cap);
        // станок «голодает»: всё остальное для рецепта есть, не хватает только этого — везём туда в первую очередь
        let bonus = 1;
        if (pd.role === 'in') {
          for (const r of STATIONS[pd.station].recipes) {
            const ins = Object.keys(r.in);
            if (ins.length < 2 || !types.some((t) => r.in[t] && this.count(dst, t) < r.in[t] * 2)) continue;
            if (ins.every((o) => types.indexOf(o) >= 0 || this.count(dst, o) >= r.in[o])) bonus = 4;
          }
        }
        // партия: не идти с парой штук туда, где и так почти полно (отзыв: «может нести 12, а берёт 2, потому что там 38 из 40»).
        // Где заполнено меньше batchFill или станок голодает — везём сколько есть, иначе он встанет
        const minB = Math.max(1, Math.floor(Math.min(cap, capD || cap) * TUNE.minBatch));
        if (bonus === 1 && n < minB && fill >= TUNE.batchFill) {
          if (why && !why.batch) why.batch = { dst, room, n, minB };
          continue;
        }
        const d = dist(w.x, w.z, ps.x, ps.z) + dist(ps.x, ps.z, pd.x, pd.z);
        const sc = Math.min(n, 8) * (1.4 - fill) * bonus / (d + 6);
        if (sc > bs) { bs = sc; best = { src, dst, types, want: n }; }
      }
    }
    return best;
  }

  // ───────── чего ждёт рабочий ─────────
  // Почему стоит — одной строкой для подписи над головой и списка рабочих; null — не стоит или вот-вот пойдёт.
  // Считается по текущему состоянию (тем же bestJob), поэтому зовётся только из графики и только для стоящих.
  workerWhy(w) {
    if (!w.on) return '⏸ Выключен';
    if (w.stun > 0) return null;
    if (w.xwait) return w.xwait === 'light' ? '🚦 Ждёт зелёный' : '🚗 Пропускает машину';
    const names = (list) => list.map((it) => ITEMS[it].name.toLowerCase()).join(', ');
    if (w.role === 'route') {
      const R = ROUTES[w.route];
      if (w.stack.length) {
        const dst = R.to.find((id) => this.pileSet.has(id) && w.stack.some((it) => this.accepted(id).indexOf(it) >= 0));
        return '💤 Некуда отнести: ' + (dst ? 'полон ' + pileName(dst) : 'станок не куплен');
      }
      const why = {};
      const exSrc = R.excessWhen ? (this.stationOn(R.excessWhen) ? R.excessSrc : []) : null;
      if (this.bestJob(w, R.from, R.to, R.excess || 0, exSrc, why)) return null;
      if (!R.to.some((id) => this.pileSet.has(id))) return '💤 Некуда носить: станок не куплен';
      if (why.batch) {
        const b = why.batch;
        return b.room < b.minB ? `💤 Ждёт места: ${pileName(b.dst)} — свободно ${b.room}, нужно ${b.minB}`
          : `💤 Ждёт, пока накопится: есть ${b.n}, нужно ${b.minB}`;
      }
      if (why.full) return '💤 Некуда нести: полон ' + pileName(why.full);
      if (why.site) return '💤 Стройка в приоритете: ' + names([why.site]) + ' оставляет строителям';
      if (why.excess) return '💤 Берёт только лишнее, а тут мало: ' + pileName(why.excess);
      // нечего брать: что маршрут носит (выходы станков — «пока сделают») или какой склад пуст
      const src = R.from.filter((id) => this.pileSet.has(id));
      if (src.every((id) => PILES[id].station)) {
        const its = new Set();
        for (const id of src) for (const it in PILES[id].accepts) if (R.to.some((d) => this.pileSet.has(d) && this.accepted(d).indexOf(it) >= 0)) its.add(it);
        return '💤 Ждёт, пока сделают: ' + names([...its]);
      }
      return '💤 Пусто: ' + src.map(pileName).join(', ');
    }
    if (w.task !== 'rest') return null;
    if (w.role === 'builder') {
      const need = this.siteNeed(), miss = Object.keys(need).filter((it) => need[it] > 0);
      return miss.length ? '💤 Для этажа пока нигде нет: ' + names(miss) : '💤 Небоскрёб достроен';
    }
    if (w.role === 'lumberjack') return '💤 Ждёт, пока вырастут деревья';
    if (w.role === 'forester') return '💤 Все участки засажены';
    if (w.role === 'collector') return '💤 Кассы пустые';
    return null;
  }

  // Что делает сейчас — для списка рабочих
  workerDoing(w) {
    if (!w.on) return 'выключен';
    if (w.stun > 0) return 'сбила машина — встаёт';
    if (w.still > TUNE.idleShow) {
      const why = this.workerWhy(w);
      if (why) { const t = why.replace(/^\S+ /, ''); return t[0].toLowerCase() + t.slice(1); }
    }
    const load = () => {
      const cnt = {};
      for (const it of w.stack) cnt[it] = (cnt[it] || 0) + 1;
      return Object.keys(cnt).map((k) => ITEMS[k].name.toLowerCase() + ' ×' + cnt[k]).join(', ');
    };
    switch (w.task) {
      case 'toSrc': case 'load': return 'берёт: ' + pileName(w.src);
      case 'toDst': case 'unload': return 'несёт ' + load() + ' → ' + pileName(w.dst);
      case 'toTree': return w.role === 'forester' ? 'идёт сажать' : 'идёт рубить';
      case 'chop': return 'рубит дерево';
      case 'plant': return 'сажает дерево';
      case 'toCash': return 'идёт за деньгами: ' + pileName(w.dst);
      case 'post': return 'на кассе';
      case 'toPost': return 'идёт на кассу';
    }
    return 'ищет работу';
  }

  bestSink(w, to) {
    let best = null, bd = 1e9;
    for (const dst of to) {
      if (!this.pileSet.has(dst)) continue;
      if (!w.stack.some((it) => this.space(dst, it) > 0)) continue;
      const p = PILES[dst], d = dist(w.x, w.z, p.x, p.z);
      if (d < bd) { bd = d; best = dst; }
    }
    return best;
  }

  builderW(w, dt, sp) {
    if (this.carry(w, dt, sp)) return;
    const need = this.siteNeed();
    if (w.stack.length) {
      if (w.stack.some((it) => need[it] > 0)) { w.dst = 'site'; w.task = 'toDst'; this.goPile(w, 'site'); return; }
      const it = w.stack[w.stack.length - 1];
      let best = null, bd = 1e9;
      for (const id of this.pilesOn) {
        const p = PILES[id];
        if (p.site || p.dock || !p.accepts || this.space(id, it) <= 0) continue;
        const d = dist(w.x, w.z, p.x, p.z);
        if (d < bd) { bd = d; best = id; }
      }
      if (!best) best = w.x < 20 ? 'trash1' : 'trash3';
      w.dst = best; w.task = 'toDst'; this.goPile(w, best);
      return;
    }
    const cap = this.capOf(w), site = PILES.site;
    let best = null, bs = 0;
    for (const it in need) {
      if (need[it] <= 0) continue;
      for (const id of this.pilesOn) {
        const p = PILES[id];
        // строитель берёт и с выхода станков, и с витрин/склада — стройка важнее продажи
        const src = (p.mode === 'pick' && (!p.pickZone || this.open[p.pickZone])) || p.sell || id === 'pwh';
        if (!src || p.site || p.dock) continue;
        const c = this.count(id, it);
        if (c <= 0) continue;
        const n = Math.min(c, need[it], cap);
        const sc = n / (dist(w.x, w.z, p.x, p.z) + dist(p.x, p.z, site.x, site.z) + 6);
        if (sc > bs) { bs = sc; best = { src: id, types: [it], want: n }; }
      }
    }
    if (!best) { this.rest(w, 2); return; }
    Object.assign(w, best);
    w.dst = 'site'; w.task = 'toSrc';
    this.goPile(w, w.src);
  }

  nearestTree(w, stage) {
    let best = -1, bd = 1e9;
    for (let i = 0; i < PLOTS.length; i++) {
      if (!this.plotOn(i) || this.s.trees[i].stage !== stage) continue;
      if (this.treeRes[i] && this.treeRes[i] !== w) continue;
      const d = dist(w.x, w.z, PLOTS[i].x, PLOTS[i].z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  lumberW(w, dt, sp) {
    if (w.task === 'toTree') { if (this.follow(w, dt, sp)) { w.task = 'chop'; w.chop = 0; } return; }
    if (w.task === 'chop') {
      if (this.s.trees[w.tree].stage !== 2) { this.release(w); w.task = null; return; }
      if (this.plotWork(w, w.tree, dt, true, false) || this.capOf(w) - w.stack.length <= 0) { this.release(w); w.task = null; }
      return;
    }
    if (this.carry(w, dt, sp)) return;
    const cap = this.capOf(w);
    const i = w.stack.length < cap - 1 ? this.nearestTree(w, 2) : -1;
    if (i < 0) {
      if (w.stack.length) { w.dst = 'flogs'; w.task = 'toDst'; this.goPile(w, 'flogs'); } else this.rest(w, 1.5);
      return;
    }
    this.treeRes[i] = w; w.tree = i; w.task = 'toTree';
    this.goTo(w, PLOTS[i].x + 0.8, PLOTS[i].z + 0.4);
  }

  foresterW(w, dt, sp) {
    if (w.task === 'toTree') { if (this.follow(w, dt, sp)) { w.task = 'plant'; w.plant = 0; } return; }
    if (w.task === 'plant') {
      if (this.s.trees[w.tree].stage !== 0 || this.plotWork(w, w.tree, dt, false, true)) { this.release(w); w.task = null; }
      return;
    }
    if (w.task === 'rest') { w.wait -= dt; if (w.wait <= 0) w.task = null; return; }
    const i = this.nearestTree(w, 0);
    if (i < 0) { this.rest(w, 2); return; }
    this.treeRes[i] = w; w.tree = i; w.task = 'toTree';
    this.goTo(w, PLOTS[i].x - 0.8, PLOTS[i].z + 0.4);
  }

  cashierW(w, dt, sp) {
    if (w.task === 'post') { this.cashierHere = true; w.face = Math.PI; return; }
    if (w.task === 'toPost') { if (this.follow(w, dt, sp)) w.task = 'post'; return; }
    w.task = 'toPost';
    this.goTo(w, CASHIER.x, CASHIER.z - 0.2);
  }

  collectorW(w, dt, sp) {
    if (w.task === 'toCash') {
      if (this.follow(w, dt, sp)) {
        const v = this.s.cash[w.dst] || 0;
        if (v > 0) { this.s.cash[w.dst] = 0; this.addMoney(v); this.ev({ t: 'm', v, from: { p: w.dst }, to: { a: w } }); }
        w.task = null;
      }
      return;
    }
    if (w.task === 'rest') { w.wait -= dt; if (w.wait <= 0) w.task = null; return; }
    let best = null, bv = 0;
    for (const id of this.moneyPiles) {
      const v = (this.s.cash[id] || 0) / (dist(w.x, w.z, PILES[id].x, PILES[id].z) + 10);
      if (v > bv) { bv = v; best = id; }
    }
    if (!best) { this.rest(w, 3); return; }
    w.dst = best; w.task = 'toCash';
    this.goPile(w, best);
  }

  // ───────── светофоры с датчиком машин ─────────
  // Пешеходам зелёный, пока к стоп-линии не подъедет машина; тогда мигает, всем красный, машинам зелёный, пока
  // едут (от carMin до carMax), жёлтый, всем красный — и снова пешеходам. Состояние не сохраняется.
  // car — машины на главной, walk — пешеходы через главную: g — зелёный, gb — мигает, y — жёлтый, r — красный.
  // У перекрёстка ещё carS / walkS — выезд с южной дороги (машин там нет — всегда красный) и переход через неё.
  lightState(id = 'c') {
    const ph = this.lights[id].ph;
    return {
      car: ph === 'car' ? 'g' : ph === 'carY' ? 'y' : 'r',
      walk: ph === 'walk' ? 'g' : ph === 'walkB' ? 'gb' : 'r',
      carS: 'r', walkS: 'g',
    };
  }

  lightStep(dt) {
    const L = LIGHT;
    for (const cfg of LIGHTS) {
      const st = this.lights[cfg.id];
      st.t += dt;
      // машины, которым нужен этот светофор: стоп-линия впереди ближе detect, и ещё не проехали переход
      let req = false;
      for (const tr of this.trucks) {
        if (tr.state === 'work') continue;
        const ln = tr.P.lines.find((l) => l.id === cfg.id);
        if (!ln || (tr.state === 'in' && ln.s > tr.P.stop)) continue;
        const d = ln.s - (tr.s + TRUCK_HALF[0]);
        if (d < L.detect && d > -(3 + 2 * TRUCK_HALF[0] + 2)) { req = true; break; }
      }
      const go = (ph) => { st.ph = ph; st.t = 0; };
      if (st.ph === 'walk') { if (req && st.t >= L.walkMin) go('walkB'); }
      else if (st.ph === 'walkB') { if (st.t >= L.walkBlink) go('red1'); }
      else if (st.ph === 'red1') { if (st.t >= L.allRed) go('car'); }
      else if (st.ph === 'car') { if ((st.t >= L.carMin && !req) || st.t >= L.carMax) go('carY'); }
      else if (st.ph === 'carY') { if (st.t >= L.carYellow) go('red2'); }
      else if (st.ph === 'red2') { if (st.t >= L.allRed) go('walk'); }
    }
  }

  // Надо ли подождать, прежде чем шагнуть (ax, az) → (nx, nz) на главную дорогу: на светофоре — пока пешеходам
  // не зелёный ('light'), на «зебре» — пока подъезжает машина ('car'); false — можно идти
  crossWait(ax, az, nx, nz) {
    const h = ROAD.half + 0.15;
    if (Math.abs(az) < h || Math.abs(nz) >= h) return false;
    for (const c of CROSSINGS) {
      if (c.across !== 'z' || Math.abs(ax - c.x) >= 2.2) continue;
      if (c.signal) return this.lightState(c.signal).walk !== 'g' ? 'light' : false;
      return this.carComing(c.x) ? 'car' : false;
    }
    return false;
  }
  // едет ли к переходу у x машина по главной (доберётся за ~3 с) или ещё не проехала его
  carComing(x) {
    for (const tr of this.trucks) {
      if (tr.state === 'work' || Math.abs(tr.z) > ROAD.half) continue;
      const d = (x - tr.x) * Math.sign(tr.dx || 1);
      if (d > -(TRUCK_HALF[0] + 2) && d < Math.max(8, tr.v * 3) + TRUCK_HALF[0]) return true;
    }
    return false;
  }
  // путь пересекает главную или южную дорогу
  crossesRoad(ax, az, bx, bz) {
    const h = ROAD.half + 0.2;
    const main = az * bz < 0 && Math.abs(az) > h && Math.abs(bz) > h && Math.min(ax, bx) < ROAD.coastX;
    const south = ax * bx < 0 && Math.abs(ax) > h && Math.abs(bx) > h && Math.max(az, bz) > h;
    return main || south;
  }

  // ───────── лесовозы и оптовик ─────────
  // Едут по маршрутам TRUCK_PATHS из тоннелей: тормозят у склада, на красный, за другой машиной и перед людьми.
  // Игрока не пропускают: стоящая машина — стена, едущая сбивает, и всё из рук разлетается по земле.
  newTruck(kind, o) {
    const P = TRUCK_PATHS[kind];
    const tr = Object.assign({ kind, state: 'in', P, s: 0, v: TUNE.truckSpeed, seg: 0, acc: 0, stall: 0, dir: kind === 'log' ? 1 : -1, hornT: 0 }, o);
    roadAt(P, 0, tr);
    tr.face = Math.atan2(-tr.dz, tr.dx);
    return tr;
  }

  trucksStep(dt) {
    this.logTimer -= dt;
    if (this.logTimer <= 0 && !this.trucks.some((t) => t.kind === 'log' && t.state !== 'out')) {
      this.logTimer = this.uv('u_trFreq');
      this.trucks.push(this.newTruck('log', { load: this.uv('u_trLoad') }));
    }
    if (this.pileSet.has('opt')) {
      this.optTimer -= dt;
      if (this.optTimer <= 0 && !this.trucks.some((t) => t.kind === 'opt' && t.state !== 'out')) {
        this.optTimer = this.uv('u_optFreq');
        this.trucks.push(this.newTruck('opt', { load: 0, stack: [] }));
      }
    }
    for (const tr of this.trucks) {
      if (tr.state === 'work') { this.truckWork(tr, dt); continue; }
      this.truckDrive(tr, dt);
      if (tr.state === 'in' && tr.s >= tr.P.stop - 0.02 && tr.v < 0.5) { tr.state = 'work'; tr.acc = 0; tr.v = 0; }
    }
    this.trucks = this.trucks.filter((t) => t.s < t.P.len - 0.01);
  }

  // разгрузка лесовоза и погрузка оптовика — как было
  truckWork(tr, dt) {
    tr.acc += dt;
    const step = tr.kind === 'log' ? 0.12 : 0.1;
    while (tr.acc >= step) {
      tr.acc -= step;
      if (tr.kind === 'log') {
        if (tr.load > 0 && this.space('yard', 'log') > 0) {
          tr.load--; this.put('yard', 'log'); tr.stall = 0;
          this.ev({ t: 'x', it: 'log', from: { tr }, to: { p: 'yard' } });
        } else {
          tr.stall += step;
          if (tr.load <= 0 || tr.stall > 1.5) { tr.state = 'out'; break; }
        }
      } else {
        const it = this.firstItem('opt');
        if (it && tr.load < TUNE.optTruckLoad) {
          this.take('opt', it); tr.load++; tr.stall = 0;
          if (tr.stack.length < 12) tr.stack.push(it);
          this.addCash('cash3', this.price(it) * TUNE.optShare, TUNE.optTruckStopX, 4);
          this.ev({ t: 'x', it, from: { p: 'opt' }, to: { tr } });
        } else {
          tr.stall += step;
          if (tr.load >= TUNE.optTruckLoad || tr.stall > 1.5) { tr.state = 'out'; break; }
        }
      }
    }
  }

  truckDrive(tr, dt) {
    const B = TUNE.truckBrake, P = tr.P, H = TRUCK_HALF[0];
    let lim = tr.state === 'in' ? P.stop - tr.s : Infinity;   // сколько можно проехать до обязательной остановки
    for (const ln of P.lines) {   // ближайшая впереди стоп-линия
      const d = ln.s - (tr.s + H);
      if (d < -0.5) continue;
      const c = this.lightState(ln.id).car;
      if (c === 'r' || (c === 'y' && d > ((tr.v * tr.v) / (2 * B)) * 0.8)) lim = Math.min(lim, Math.max(0, d));
      break;
    }
    lim = Math.min(lim, this.truckGap(tr, dt));
    let vmax = TUNE.truckSpeed;
    for (const a of P.arcs) {   // перед поворотом сбрасываем скорость заранее
      if (tr.s > a.s1) continue;
      vmax = Math.min(vmax, Math.sqrt(a.v * a.v + 2 * B * 0.6 * Math.max(0, a.s0 - tr.s - 1)));
    }
    const target = Math.min(vmax, Math.sqrt(2 * B * Math.max(0, lim)));
    tr.v = tr.v < target ? Math.min(target, tr.v + TUNE.truckAcc * dt) : Math.max(target, tr.v - B * 1.6 * dt);
    let ds = tr.v * dt;
    if (ds > lim) { ds = Math.max(0, lim); if (lim < 0.01) tr.v = 0; }
    tr.s += ds;
    roadAt(P, tr.s, tr);
    tr.face = Math.atan2(-tr.dz, tr.dx);
    if (!this.fast) { this.truckVsPlayer(tr, dt); this.truckVsWorkers(tr); }
  }

  // рабочие: спешащего, выскочившего под колёса, машина сбивает; остальных — только отодвигает
  truckVsWorkers(tr) {
    for (const w of this.workers) {
      if (w.stun > 0 || !this.truckTouch(tr, w.x, w.z, 0.35)) continue;
      if (tr.v > 2.5 && w.hurry && w.moving) this.hitWorker(tr, w);
      else this.truckPush(tr, w);
    }
  }

  // свободная дорога впереди: машина на своей полосе и люди на проезжей части (игрока не ждём)
  truckGap(tr, dt) {
    const fx = tr.dx, fz = tr.dz, H = TRUCK_HALF[0];
    const look = (tr.v * tr.v) / (2 * TUNE.truckBrake) + 10;
    let gap = Infinity, ped = Infinity;
    for (const o of this.trucks) {
      if (o === tr) continue;
      const rx = o.x - tr.x, rz = o.z - tr.z, f = rx * fx + rz * fz;
      if (f <= 0 || f > look + 2 * H) continue;
      if (Math.abs(-rx * fz + rz * fx) > 1.5 || o.dx * fx + o.dz * fz < 0.3) continue;
      gap = Math.min(gap, f - 2 * H - 1.8);
    }
    // ждём только тех, кто на проезжей части перед машиной (стоящих на тротуаре у «зебры» — нет)
    const onRoad = (a) => Math.abs(a.z) < ROAD.half || Math.abs(a.x - ROAD.coastX) < ROAD.half;
    const test = (a) => {
      const rx = a.x - tr.x, rz = a.z - tr.z, f = rx * fx + rz * fz;
      if (f <= 0 || f > look + H || Math.abs(-rx * fz + rz * fx) > 1.6 || !onRoad(a)) return;
      ped = Math.min(ped, f - H - 1.1);
    };
    for (const w of this.workers) if (!(w.hurry && w.moving)) test(w);   // перебегающего где попало не ждём
    for (const c of this.cust) if (c.state !== 'far' && c.state !== 'gone') test(c);
    if (this.soft) test(this.pl);
    // человек стоит на дороге дольше 3 с — дальше едем тихо, чтобы машина не встала навсегда
    if (ped < Infinity && tr.v < 0.5) tr.pedWait = (tr.pedWait || 0) + dt;
    else if (ped === Infinity) tr.pedWait = 0;
    if (ped < Infinity) gap = Math.min(gap, (tr.pedWait || 0) < 3 ? ped : Math.max(ped, 0.02));
    return Math.max(0, gap);
  }

  // касается ли машина круга радиусом r
  truckTouch(tr, x, z, r) {
    const rx = x - tr.x, rz = z - tr.z;
    const f = rx * tr.dx + rz * tr.dz, l = -rx * tr.dz + rz * tr.dx;
    const cf = clamp(f, -TRUCK_HALF[0], TRUCK_HALF[0]), cl = clamp(l, -TRUCK_HALF[1], TRUCK_HALF[1]);
    return (f - cf) * (f - cf) + (l - cl) * (l - cl) < r * r;
  }

  truckVsPlayer(tr, dt) {
    const pl = this.pl;
    tr.hornT -= dt;
    if (!this.truckTouch(tr, pl.x, pl.z, TUNE.playerR)) {
      // игрок на полосе впереди — сигналим
      if (!this.soft && tr.v > 4 && tr.hornT <= 0) {
        const rx = pl.x - tr.x, rz = pl.z - tr.z, f = rx * tr.dx + rz * tr.dz;
        if (f > TRUCK_HALF[0] && f < 16 && Math.abs(-rx * tr.dz + rz * tr.dx) < 1.8) { tr.hornT = 3; this.ev({ t: 'horn', x: tr.x, z: tr.z }); }
      }
      return;
    }
    if (this.soft || tr.v < 2.5) this.truckPush(tr, pl);
    else this.hitPlayer(tr);
  }

  // вытолкнуть из-под машины по ближайшей стороне
  truckPush(tr, a) {
    const rx = a.x - tr.x, rz = a.z - tr.z, f = rx * tr.dx + rz * tr.dz, l = -rx * tr.dz + rz * tr.dx;
    const r = TUNE.playerR + 0.05, [hf, hl] = TRUCK_HALF;
    let nf = f, nl = l;
    if (hf + r - Math.abs(f) < hl + r - Math.abs(l)) nf = Math.sign(f || 1) * (hf + r); else nl = Math.sign(l || 1) * (hl + r);
    a.x = tr.x + tr.dx * nf - tr.dz * nl; a.z = tr.z + tr.dz * nf + tr.dx * nl;
    if (this.hits(a.x, a.z, TUNE.playerR)) this.unstick(a);
  }

  // машина сбила человека: отлетает вбок, лежит stun секунд, всё из рук разлетается по земле; сколько рассыпалось
  knock(tr, a, stun) {
    const rx = a.x - tr.x, rz = a.z - tr.z, f = rx * tr.dx + rz * tr.dz, side = -rx * tr.dz + rz * tr.dx >= 0 ? 1 : -1;
    const x0 = a.x, z0 = a.z, nx = -tr.dz * side, nz = tr.dx * side;
    a.x = tr.x + tr.dx * (f + 1.2) + nx * (TRUCK_HALF[1] + 1.9);
    a.z = tr.z + tr.dz * (f + 1.2) + nz * (TRUCK_HALF[1] + 1.9);
    if (this.hits(a.x, a.z, TUNE.playerR)) this.unstick(a);
    a.stun = stun; a.stun0 = stun;
    a.face = Math.atan2(nx, nz);
    a.moving = false;
    const n = a.stack.length;
    for (let i = 0; i < n; i++) {
      const ang = rngNext(this.lrs) * Math.PI * 2, d = 1.2 + rngNext(this.lrs) * 2.4;
      let x = a.x + Math.cos(ang) * d + nx * 0.5, z = a.z + Math.sin(ang) * d + nz * 0.5;
      if (this.hits(x, z, 0.2)) { x = a.x + (rngNext(this.lrs) - 0.5) * 0.6; z = a.z + (rngNext(this.lrs) - 0.5) * 0.6; }
      this.loose.push({ it: a.stack[i], x, z, x0, z0, y0: 1.1 + i * 0.09, t: -i * 0.012, ry: rngNext(this.lrs) * Math.PI * 2 });
    }
    a.stack = [];
    return n;
  }
  hitPlayer(tr) {
    const n = this.knock(tr, this.pl, 0.9);
    this.s.stats.hitMe++;
    this.ev({ t: 'hit', x: this.pl.x, z: this.pl.z, n });
  }
  hitWorker(tr, w) {
    this.release(w);
    const n = this.knock(tr, w, 1.6);
    w.task = null; w.path = null; w.hurry = false;
    this.s.stats.hitW++;
    this.ev({ t: 'hitW', w, n, x: w.x, z: w.z });
  }

  // рассыпанное игрок подбирает, проходя рядом (если есть место в руках), — с земли дольше, чем с кучи;
  // пока приходит в себя после удара — не может. Через минуту рассыпанное пропадает
  looseStep(dt) {
    for (const l of this.loose) l.t += dt;
    if (this.loose.some((l) => l.t > TUNE.looseLife)) this.loose = this.loose.filter((l) => l.t <= TUNE.looseLife);
  }
  playerLoose(dt) {
    const pl = this.pl, per = TUNE.xferPlayer * 2.5;
    if (!this.loose.length || pl.stun > 0) return;
    pl.lacc = (pl.lacc || 0) + dt;
    while (pl.lacc >= per) {
      pl.lacc -= per;
      if (pl.stack.length >= this.capOf(pl)) { pl.lacc = 0; return; }
      let best = -1, bd = 0.95;
      for (let i = 0; i < this.loose.length; i++) {
        const l = this.loose[i];
        if (l.t < 0.6) continue;   // ещё летит
        const d = dist(pl.x, pl.z, l.x, l.z);
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0) { pl.lacc = 0; return; }
      const l = this.loose.splice(best, 1)[0];
      pl.stack.push(l.it);
      this.ev({ t: 'x', it: l.it, from: { loose: l }, to: { a: pl } });
    }
  }

  // ───────── покупатели приходят и уходят по тротуарам ─────────
  // Видит ли игрок точку: прямоугольник вокруг него с запасом — как у самой отдалённой камеры, и на узком экране
  seen(x, z) { const p = this.pl; return Math.abs(x - p.x) < 44 && z > p.z - 58 && z < p.z + 24; }
  // с какого места тротуара (x, z ≥ z0) покупатель начинает путь ко входу: сразу за краем того, что видит игрок.
  // Игрок далеко (или перемотка) — сразу у входа, как раньше
  farZ(x, z0) {
    if (this.fast || !this.seen(x, z0)) return z0;
    return Math.min(ROAD.southZ - 10, Math.max(z0, this.pl.z + 25));
  }
  // шаг по прямой к точке; true — пришёл
  walkTo(a, x, z, dt, sp) {
    const dx = x - a.x, dz = z - a.z, d = Math.hypot(dx, dz);
    if (d < 0.02) { a.moving = false; return true; }
    const m = Math.min(d, sp * dt);
    a.x += (dx / d) * m; a.z += (dz / d) * m;
    a.face = Math.atan2(dx, dz); a.moving = true;
    return m >= d;
  }
  // ушёл с глаз — пропал; иначе идёт по точкам wp дальше
  goneStep(c, dt) {
    if (this.fast || !this.seen(c.x, c.z)) { c.dead = true; return; }
    const w = c.wp[0];
    if (!w) { c.dead = true; return; }
    if (this.walkTo(c, w[0], w[1], dt, TUNE.custSpeed * 1.3)) c.wp.shift();
  }

  // ───────── покупатели досок (прилавок) ─────────
  // Лимит c1Max — как раньше, по тем, кто на лесопилке; идущие по тротуару в него не входят
  c1Step(dt) {
    if (!this.open.z1) return;
    this.c1Timer -= dt;
    let n = 0, far = 0;
    for (const c of this.cust) if (c.kind === 'c1') { if (c.state === 'far') far++; else if (c.state !== 'gone') n++; }
    if (this.c1Timer <= 0 && n < TUNE.c1Max && n + far < TUNE.c1Max + 4) {
      this.c1Timer = this.uv('u_cust1') * (0.75 + 0.5 * this.rnd());
      const x = C1_ENTRY[0] + (this.rnd() - 0.5) * 0.8;
      const c = this.agent('c1', x, this.farZ(x, C1_ENTRY[1]));
      c.want = 1 + Math.floor(this.rnd() * 3); c.spot = -1; c.look = Math.floor(this.rnd() * 1000);
      if (c.z > C1_ENTRY[1] + 0.5) { c.state = 'far'; this.c1q.push(c); } else { c.state = 'in'; n++; }
      this.cust.push(c);
    }
    // очередь на тротуаре: первый входит, когда на лесопилке есть место, остальные стоят за ним
    this.c1q = this.c1q.filter((c) => c.state === 'far' && !c.dead);
    this.c1q.forEach((c, i) => {
      const at = this.walkTo(c, c.x, C1_ENTRY[1] + i * 1.3, dt, TUNE.custSpeed * 1.3);
      if (i === 0 && at && n < TUNE.c1Max) { c.state = 'in'; n++; }
      else if (at) c.face = Math.PI;
    });
    for (const c of this.cust) if (c.kind === 'c1') this.c1Update(c, dt);
    this.cust = this.cust.filter((c) => !c.dead);
  }

  c1Update(c, dt) {
    const sp = TUNE.custSpeed;
    switch (c.state) {
      case 'in': {
        const k = this.spots.indexOf(null);
        if (k >= 0) { c.spot = k; this.spots[k] = c; c.state = 'walk'; this.goTo(c, C1_SPOTS[k][0], C1_SPOTS[k][1]); }
        else if (!c.waitPos) { c.waitPos = true; this.goTo(c, -6 + (this.rnd() - 0.5) * 3, 21 + (this.rnd() - 0.5) * 3); }
        else this.follow(c, dt, sp);
        break;
      }
      case 'walk':
        if (this.follow(c, dt, sp)) { c.state = 'buy'; c.xacc = 0; c.wait = 0; c.face = -Math.PI / 2; }
        break;
      case 'buy':
        c.xacc += dt;
        while (c.xacc >= 0.3) {
          c.xacc -= 0.3;
          if (c.stack.length < c.want && this.count('counter', 'board') > 0) {
            this.take('counter', 'board'); c.stack.push('board'); c.wait = 0;
            this.ev({ t: 'x', it: 'board', from: { p: 'counter' }, to: { a: c } });
          } else break;
        }
        if (c.stack.length >= c.want) this.c1Leave(c, true);
        else { c.wait += dt; if (c.wait > 30) this.c1Leave(c, c.stack.length > 0); }
        break;
      case 'out':   // дошёл до тротуара — дальше уходит по нему на юг
        if (this.follow(c, dt, sp)) { c.state = 'gone'; c.wp = [[c.x, ROAD.southZ - 10]]; }
        break;
      case 'gone':
        this.goneStep(c, dt);
        break;
    }
  }

  c1Leave(c, pay) {
    if (pay) {
      const v = c.stack.length * this.price('board');
      this.addCash('cash1', v, c.x, c.z);
      this.ev({ t: 'm', v, from: { a: c }, to: { p: 'cash1' } });
    }
    if (c.spot >= 0) this.spots[c.spot] = null;
    c.spot = -1; c.state = 'out';
    this.goTo(c, C1_EXIT[0] + (this.rnd() - 0.5) * 0.8, C1_EXIT[1]);
  }

  // ───────── покупатели магазина ─────────
  cashierPresent() { return this.cashierHere; }

  // Лимит c4Max — как раньше, по тем, кто в магазине; идущие по тротуару и дорожке в него не входят
  c4Step(dt) {
    if (!this.open.z4 || !this.shelvesOn.length) return;
    this.c4Timer -= dt;
    let n = 0, far = 0;
    for (const c of this.cust) if (c.kind === 'c4') { if (c.state === 'far') far++; else if (c.state !== 'gone') n++; }
    if (this.c4Timer <= 0 && n < TUNE.c4Max && n + far < TUNE.c4Max + 4) {
      this.c4Timer = this.uv('u_cust4') * (0.75 + 0.5 * this.rnd());
      const e = this.rnd() < 0.5 ? 0 : 1, en = C4_ENTRY[e];
      const c = this.agent('c4', en[0], en[1]);
      c.want = 1 + Math.floor(this.rnd() * 3); c.tries = 0; c.look = Math.floor(this.rnd() * 1000);
      // полку и место у неё выбираем сразу — тот же порядок случайных чисел, что и раньше
      c.shelf0 = this.shelvesOn[Math.floor(this.rnd() * this.shelvesOn.length)];
      c.shelfX = SHELVES[c.shelf0] + (this.rnd() - 0.5) * 2.8;
      c.entry = e;
      if (this.seen(en[0], en[1]) && !this.fast) {
        // идёт по тротуару южной дороги, потом по дорожке к входу
        const w = ROAD.walk, fz = this.farZ(w, en[1]);
        c.x = w; c.z = fz; c.wp = [[w, en[1]]];
        c.state = 'far';
        this.c4q[e].push(c);
      } else { this.c4Enter(c); n++; }
      this.cust.push(c);
    }
    // очереди на дорожке у входов
    for (let e = 0; e < 2; e++) {
      const q = this.c4q[e] = this.c4q[e].filter((c) => c.state === 'far' && !c.dead), en = C4_ENTRY[e];
      q.forEach((c, i) => {
        if (c.wp.length) { if (this.walkTo(c, c.wp[0][0], c.wp[0][1], dt, TUNE.custSpeed * 1.3)) c.wp.shift(); return; }
        const at = this.walkTo(c, en[0] - i * 1.3, en[1], dt, TUNE.custSpeed * 1.3);
        if (i === 0 && at && n < TUNE.c4Max) { this.c4Enter(c); n++; }
        else if (at) c.face = Math.PI / 2;
      });
    }
    for (const c of this.cust) if (c.kind === 'c4') this.c4Update(c, dt);
    // касса обслуживает первого в очереди
    const f = this.queue[0];
    if (f && f.state === 'queue' && this.cashierPresent()) {
      f.serve = (f.serve || 0) + dt;
      if (f.serve >= this.uv('u_service')) {
        let v = 0;
        for (const it of f.stack) v += this.price(it);
        this.addCash('cash4', v, f.x, f.z);
        this.ev({ t: 'm', v, from: { a: f }, to: { p: 'cash4' } });
        this.queue.shift();
        this.c4Out(f);
      }
    }
    this.cust = this.cust.filter((c) => !c.dead);
  }

  // вошёл в магазин: к заранее выбранной полке (если её за это время убрали — к любой открытой)
  c4Enter(c) {
    const shelf = this.shelvesOn.indexOf(c.shelf0) >= 0 ? c.shelf0 : this.shelvesOn[0];
    this.c4ToShelf(c, shelf, shelf === c.shelf0 ? c.shelfX : SHELVES[shelf]);
  }
  // к выходу; оттуда — по дорожке и тротуару, пока не скроется из виду
  c4Out(c) {
    c.state = 'out';
    const ex = C4_ENTRY[c.look % 2];
    this.goTo(c, ex[0], ex[1]);
  }

  c4ToShelf(c, shelf, x = null) {
    c.shelf = shelf; c.state = 'toShelf'; c.wait = 0;
    this.goTo(c, x !== null ? x : SHELVES[shelf] + (this.rnd() - 0.5) * 2.8, 56);
  }

  c4Update(c, dt) {
    const sp = TUNE.custSpeed;
    switch (c.state) {
      case 'toShelf':
        if (this.follow(c, dt, sp)) { c.state = 'take'; c.xacc = 0; c.face = Math.PI; }
        break;
      case 'take': {
        c.xacc += dt;
        if (c.xacc < 0.35) break;
        c.xacc = 0;
        if (!this.pileSet.has(c.shelf)) { c.wait = 99; }
        else {
          for (const it of SHELF_ITEMS[c.shelf]) {
            if (this.count(c.shelf, it) > 0) {
              this.take(c.shelf, it); c.stack.push(it); c.wait = 0;
              this.ev({ t: 'x', it, from: { p: c.shelf }, to: { a: c } });
              break;
            }
          }
        }
        if (c.stack.length >= c.want || (c.stack.length && c.wait > 3)) { this.c4Join(c); break; }
        c.wait += 0.35;
        if (c.wait > TUNE.c4Patience) {
          const other = this.shelvesOn.filter((id) => id !== c.shelf && this.total(id) > 0);
          if (c.stack.length) this.c4Join(c);
          else if (other.length && c.tries < 2) { c.tries++; this.c4ToShelf(c, other[Math.floor(this.rnd() * other.length)]); }
          else this.c4Out(c);
        }
        break;
      }
      case 'toQueue':
      case 'queue': {
        const i = this.queue.indexOf(c);
        const slot = QUEUE[Math.min(i, QUEUE.length - 1)];
        if (c.qi !== i) { c.qi = i; c.state = 'toQueue'; c.path = [[slot[0], slot[1]]]; c.pi = 0; }
        if (c.state === 'toQueue' && this.follow(c, dt, sp)) { c.state = 'queue'; c.face = Math.PI; }
        break;
      }
      case 'out':
        if (this.follow(c, dt, sp)) { c.state = 'gone'; c.wp = [[ROAD.walk, c.z], [ROAD.walk, ROAD.southZ - 10]]; }
        break;
      case 'gone':
        this.goneStep(c, dt);
        break;
    }
  }

  c4Join(c) {
    this.queue.push(c);
    c.state = 'toQueue'; c.qi = this.queue.length - 1; c.serve = 0;
    const slot = QUEUE[Math.min(c.qi, QUEUE.length - 1)];
    this.goTo(c, slot[0], slot[1]);
  }

  // ───────── делянка ─────────
  treesStep(dt) {
    const g = this.uv('u_grow');
    for (let i = 0; i < PLOTS.length; i++) {
      const tr = this.s.trees[i];
      if (tr.stage === 1 && this.plotOn(i)) { tr.t += dt; if (tr.t >= g) { tr.stage = 2; tr.t = 0; } }
    }
  }

  // ───────── станки ─────────
  stationStep(id, dt) {
    const st = STATIONS[id];
    const ss = this.s.st[id] || (this.s.st[id] = { cur: -1, prog: 0, rr: 0 });
    const mul = st.speed ? this.uv(st.speed) : 1;
    let time = dt, guard = 30;
    while (time > 0 && guard-- > 0) {
      if (ss.cur < 0) {
        const r = this.pickRecipe(st, ss);
        if (r < 0) return;
        const rec = st.recipes[r];
        for (const it in rec.in) this.take(st.in, it, rec.in[it]);
        ss.cur = r; ss.prog = 0;
      }
      const rec = st.recipes[ss.cur], T = rec.t * mul;
      const need = (1 - ss.prog) * T;
      if (time < need) { ss.prog += time / T; return; }
      time -= need; ss.prog = 1;
      const om = st.type === 'bench' ? this.uv('u_benchOut') : 1;   // двойная сборка на верстаках
      for (const it in rec.out) if (this.space(st.out, it) < rec.out[it] * om) return;   // ждём место на выходе
      const out = this.pc(st.out);
      for (const it in rec.out) { out[it] = (out[it] || 0) + rec.out[it] * om; this.stat(it, rec.out[it] * om); }
      if (rec.by && st.by) for (const it in rec.by) {
        const sp = this.space(st.by, it);
        if (sp > 0) { const c = this.pc(st.by); c[it] = (c[it] || 0) + Math.min(sp, rec.by[it]); }
      }
      this.ev({ t: 'made', st: id });
      ss.cur = -1; ss.prog = 0;
    }
  }

  pickRecipe(st, ss) {
    const n = st.recipes.length;
    for (let k = 0; k < n; k++) {
      const r = (ss.rr + k) % n, rec = st.recipes[r];
      let ok = true;
      for (const it in rec.in) if (this.count(st.in, it) < rec.in[it]) { ok = false; break; }
      if (ok) for (const it in rec.out) if (this.space(st.out, it) < rec.out[it]) { ok = false; break; }
      if (ok) { ss.rr = (r + 1) % n; return r; }
    }
    return -1;
  }

  // пневмопровод: опилки со всех станков сами летят в бункер картонной машины (есть вторая — в тот, где свободнее)
  pneumoStep(dt) {
    if (!this.s.padDone.p_pneumo) return;
    const bunkers = DUST_BUNKERS.filter((id) => this.pileSet.has(id));
    if (!bunkers.length) return;
    this.pneuAcc += dt * this.uv('u_pneumo');
    let guard = 40;
    while (this.pneuAcc >= 1 && guard-- > 0) {
      this.pneuAcc -= 1;
      let moved = false;
      for (const id of this.dustPiles) {
        if (this.count(id, 'sawdust') <= 0) continue;
        let to = null, room = 0;
        for (const b of bunkers) { const sp = this.space(b, 'sawdust'); if (sp > room) { room = sp; to = b; } }
        if (!to) break;
        this.take(id, 'sawdust'); this.put(to, 'sawdust'); moved = true;
        this.ev({ t: 'pipe', from: id, to });
      }
      if (!moved) { this.pneuAcc = 0; break; }
    }
  }

  // ───────── порт ─────────
  canMake(it) {
    if (!this.stationOn('packer') && !this.stationOn('packer2')) return false;
    return this.stationOn({ chairB: 'benchC', tableB: 'benchT', wardrobeB: 'benchW' }[it]);
  }

  newContract() {
    const sh = this.s.ship;
    let types = ['chairB', 'tableB', 'wardrobeB'].filter((it) => this.canMake(it));
    if (!types.length) types = ['chairB'];
    const k = 1 + Math.floor(this.rnd() * Math.min(3, types.length));
    const pick = [];
    while (pick.length < k) { const it = types[Math.floor(this.rnd() * types.length)]; if (pick.indexOf(it) < 0) pick.push(it); }
    const scale = 1 + 0.3 * Math.max(0, this.s.floor - 13);
    sh.need = {}; sh.got = {}; sh.reward = 0;
    for (const it of pick) {
      const n = Math.max(4, Math.round((10 + this.rnd() * 14) * scale / (it === 'wardrobeB' ? 2 : 1)));
      sh.need[it] = n;
      sh.reward += n * this.price(it) * TUNE.exportMul * this.uv('u_export');
    }
    sh.reward = Math.round(sh.reward);
  }

  shipDone() { const sh = this.s.ship; for (const it in sh.need) if ((sh.got[it] || 0) < sh.need[it]) return false; return true; }

  shipStep(dt) {
    const sh = this.s.ship;
    if (!sh) return;
    if (sh.state === 'away') {
      sh.t -= dt;
      if (sh.t <= 0) { this.newContract(); sh.state = 'in'; sh.t = TUNE.shipSail; this.ev({ t: 'ship', st: 'in' }); }
    } else if (sh.state === 'in') {
      sh.t -= dt;
      if (sh.t <= 0) { sh.state = 'docked'; sh.left = this.uv('u_shipT'); this.ev({ t: 'ship', st: 'docked' }); }
    } else if (sh.state === 'docked') {
      sh.left -= dt;
      if (this.s.padDone.p_crane) {
        this.craneAcc += dt * this.uv('u_crane');
        let guard = 30;
        while (this.craneAcc >= 1 && guard-- > 0) {
          this.craneAcc -= 1;
          let moved = false;
          for (const it in sh.need) {
            if ((sh.got[it] || 0) < sh.need[it] && this.count('pwh', it) > 0) {
              this.take('pwh', it); sh.got[it] = (sh.got[it] || 0) + 1; moved = true;
              this.ev({ t: 'x', it, from: { p: 'pwh' }, to: { ship: 1 } });
              break;
            }
          }
          if (!moved) { this.craneAcc = 0; break; }
        }
      }
      if (this.shipDone()) {
        this.addCash('cash6', sh.reward, SHIP_DOCK[0] - 6, SHIP_DOCK[1]);
        this.s.stats.ships++;
        sh.state = 'out'; sh.t = TUNE.shipSail; sh.result = 'ok';
        this.ev({ t: 'ship', st: 'done', v: sh.reward });
      } else if (sh.left <= 0) {
        let v = 0;
        for (const it in sh.got) v += sh.got[it] * this.price(it);
        if (v > 0) this.addCash('cash6', v, SHIP_DOCK[0] - 6, SHIP_DOCK[1]);
        sh.state = 'out'; sh.t = TUNE.shipSail; sh.result = 'late';
        this.ev({ t: 'ship', st: 'late', v });
      }
    } else if (sh.state === 'out') {
      sh.t -= dt;
      if (sh.t <= 0) { sh.state = 'away'; sh.t = TUNE.shipAway; sh.need = null; sh.got = {}; }
    }
  }

  // ───────── небоскрёб ─────────
  checkFloor() {
    const f = FLOORS[this.s.floor];
    if (!f) return;
    for (const it in f.need) if ((this.s.floorGot[it] || 0) < f.need[it]) return;
    this.s.floor++;
    this.s.floorGot = {};
    this.s.stats.floorsT.push(Math.round(this.s.playT));
    const z = f.unlock ? ZONE_BY_ID[f.unlock] : null;
    this.rebuild();
    this.ev({ t: 'floor', n: this.s.floor, zone: z ? z.id : null });
    if (this.s.floor >= FLOORS.length) this.ev({ t: 'win' });
  }

  // ───────── подсказки ─────────
  goalStep() {
    const s = this.s, pl = this.pl;
    const has = (it) => pl.stack.indexOf(it) >= 0;
    let g = null;
    if (s.tut === 0) { if (has('log')) s.tut = 1; else g = ['Подойди к брёвнам — возьмёшь их', 'yard']; }
    if (s.tut === 1) { if (this.count('saw1_in', 'log') > 0 || (s.st.saw1 && s.st.saw1.cur >= 0)) s.tut = 2; else g = ['Отнеси брёвна к пилораме', 'saw1_in']; }
    if (s.tut === 2) { if (has('board')) s.tut = 3; else g = ['Забери доски с пилорамы', 'saw1_out']; }
    if (s.tut === 3) { if (this.count('counter', 'board') > 0 || (s.cash.cash1 || 0) > 0 || s.earned > 0) s.tut = 4; else g = ['Положи доски на прилавок — их купят', 'counter']; }
    if (s.tut === 4) { if (s.earned > 0) s.tut = 5; else g = ['Собери деньги у прилавка', 'cash1']; }
    if (s.tut === 5) { if (s.stats.buys > 0) s.tut = 6; else g = ['Накопи ' + fmtMoney(PAD_BY_ID.p_wlog1.cost) + ' и встань на площадку «Грузчик брёвен»', 'pad:p_wlog1']; }
    if (s.tut === 6) { if (s.floor >= 1) s.tut = 7; else g = ['Отнеси доски на стройку небоскрёба', 'site']; }
    if (!g) g = this.freeGoal();
    this.goal = g ? { text: g[0], target: g[1] } : null;
  }

  freeGoal() {
    const s = this.s;
    let best = null;
    for (const p of PADS) {
      if (!this.padVisible(p)) continue;
      const rem = p.cost - (s.padPaid[p.id] || 0);
      if (rem <= s.money && (!best || rem < best.rem)) best = { p, rem };
    }
    if (best) return ['Хватает денег: ' + padTitle(best.p) + ' — ' + fmtMoney(best.rem), 'pad:' + best.p.id];
    if (s.floor < FLOORS.length) {
      const need = this.siteNeed();
      const carry = this.pl.stack.some((it) => need[it] > 0);
      if (carry) return ['Отнеси на стройку этажа ' + (s.floor + 1), 'site'];
    }
    // купить пока нечего — подскажем, на что копить (участок важнее)
    let next = null;
    for (const p of PADS) {
      if (!this.padVisible(p)) continue;
      const rem = p.cost - (s.padPaid[p.id] || 0), eff = p.gate ? rem * 0.2 : rem;
      if (!next || eff < next.eff) next = { p, rem, eff };
    }
    if (next) return ['Копим на «' + padTitle(next.p) + '»: ещё ' + fmtMoney(next.rem - s.money), 'pad:' + next.p.id];
    return null;
  }

  // ───────── перемотка офлайна ─────────
  // Игрок стоит, работают только автоматизированные цеха. Возвращает, сколько денег накопилось в кассах.
  fastForward(sec, dt = 0.25) {
    const before = this.moneyInCash() + this.s.money;
    const made0 = Object.assign({}, this.s.stats.made);
    this.fast = true;
    const n = Math.ceil(sec / dt);
    for (let i = 0; i < n; i++) this.step(dt);
    this.fast = false;
    this.pl.moving = false;
    const made = {};
    for (const it in this.s.stats.made) { const d = this.s.stats.made[it] - (made0[it] || 0); if (d > 0) made[it] = d; }
    return { sec, money: this.moneyInCash() + this.s.money - before, made };
  }
  moneyInCash() { let v = 0; for (const k in this.s.cash) v += this.s.cash[k]; return v; }
}
