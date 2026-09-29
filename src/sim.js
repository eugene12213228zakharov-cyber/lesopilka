'use strict';
// Логика игры без графики: состояние, игрок, рабочие, станки, покупатели, стройка, порт.
// Её же гоняет бот в node (tools/balance.js). События для графики копятся в game.events.

const NAV_CELL = 0.5;
const TRIG_CELL = 0.5;
const SAVE_VERSION = 1;

class Game {
  constructor(save) {
    this.events = [];
    this.silent = false;   // не копить события (бот в node)
    this.fast = false;     // перемотка офлайна: игрок стоит, время игры не идёт
    this.input = { x: 0, z: 0 };
    this.nav = new NavGrid(MAP, NAV_CELL);
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
      stats: { made: {}, floorsT: [], zonesT: {}, sold: 0, ships: 0, buys: 0 },
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
    // навигация
    const nav = this.nav;
    nav.clear();
    // запас больше радиуса игрока: по этим путям ходит и бот-игрок, который цепляется за углы
    const inf = (r) => ({ x0: r.x0 - 0.55, z0: r.z0 - 0.55, x1: r.x1 + 0.55, z1: r.z1 + 0.55 });
    for (const r of this.solids) nav.blockRect(inf(r));
    for (const r of this.walls) nav.blockRect(inf(r));
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
    if (p.shelf) return this.uv('u_shelf');
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
    for (const w of this.workers) this.workerStep(w, dt);
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
    let vx = this.input.x, vz = this.input.z;
    const m = Math.hypot(vx, vz);
    if (m > 1) { vx /= m; vz /= m; }
    pl.moving = m > 0.05;
    if (!pl.moving) return;
    pl.face = Math.atan2(vx, vz);
    const sp = this.uv('u_speed');
    this.moveCollide(pl, vx * sp * dt, vz * sp * dt);
  }

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
  goTo(a, x, z) { a.path = this.nav.findPath(a.x, a.z, x, z); a.pi = 0; a.moving = true; }
  goPile(a, id) {
    const p = PILES[id], o = a.off || [0, 0];
    this.goTo(a, p.x + clamp(o[0], -p.w / 2 + 0.3, p.w / 2 - 0.3), p.z + clamp(o[1], -p.d / 2 + 0.3, p.d / 2 - 0.3));
  }
  follow(a, dt, sp) {
    if (!a.path) { a.moving = false; return true; }
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

  // excess — брать только излишки (выход заполнен больше этой доли); exSrc — к каким источникам это относится (null — ко всем)
  bestJob(w, from, to, excess = 0, exSrc = null) {
    const cap = this.capOf(w);
    // «Стройка в приоритете»: рабочие продаж не трогают то, что сейчас нужно небоскрёбу (его заберут строители)
    const need = this.s.sitePriority !== false && this.workers.some((x) => x.role === 'builder' && x.on) ? this.siteNeed() : null;
    let best = null, bs = 0;
    for (const dst of to) {
      if (!this.pileSet.has(dst)) continue;
      const pd = PILES[dst];
      let acc = this.accepted(dst);
      if (need && (pd.sell || dst === 'pwh')) acc = acc.filter((it) => !(need[it] > 0));
      for (const src of from) {
        if (src === dst || !this.pileSet.has(src)) continue;
        if (excess && (!exSrc || exSrc.indexOf(src) >= 0) && this.pileFill(src) <= excess) continue;
        const ps = PILES[src];
        // заполненность считаем по каждому предмету: у верстака ножки могут лежать горой, а досок ноль
        let n = 0, fill = 1; const types = [];
        for (const it of acc) {
          const sp = this.space(dst, it), c = this.count(src, it);
          if (sp > 0 && c > 0) {
            n += Math.min(sp, c); types.push(it);
            const cp = pd.accepts ? this.cap(dst, it) : 0;
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
        const d = dist(w.x, w.z, ps.x, ps.z) + dist(ps.x, ps.z, pd.x, pd.z);
        const sc = Math.min(n, 8) * (1.4 - fill) * bonus / (d + 6);
        if (sc > bs) { bs = sc; best = { src, dst, types, want: n }; }
      }
    }
    return best;
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

  // ───────── лесовозы и оптовик ─────────
  trucksStep(dt) {
    this.logTimer -= dt;
    if (this.logTimer <= 0 && !this.trucks.some((t) => t.kind === 'log' && t.state !== 'out')) {
      this.logTimer = this.uv('u_trFreq');
      this.trucks.push({ kind: 'log', x: MAP.x0 - 12, z: TUNE.logTruckLane, dir: 1, state: 'in', load: this.uv('u_trLoad'), acc: 0, stall: 0 });
    }
    if (this.pileSet.has('opt')) {
      this.optTimer -= dt;
      if (this.optTimer <= 0 && !this.trucks.some((t) => t.kind === 'opt' && t.state !== 'out')) {
        this.optTimer = this.uv('u_optFreq');
        this.trucks.push({ kind: 'opt', x: MAP.x1 + 12, z: TUNE.optTruckLane, dir: -1, state: 'in', load: 0, acc: 0, stall: 0, stack: [] });
      }
    }
    for (const tr of this.trucks) {
      const mv = TUNE.truckSpeed * dt;
      if (tr.state === 'in') {
        const stop = tr.kind === 'log' ? TUNE.logTruckStopX : TUNE.optTruckStopX;
        if ((stop - tr.x) * tr.dir <= mv) { tr.x = stop; tr.state = 'work'; tr.acc = 0; } else tr.x += mv * tr.dir;
      } else if (tr.state === 'work') {
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
      } else tr.x += mv * tr.dir;
    }
    this.trucks = this.trucks.filter((t) => t.x > MAP.x0 - 20 && t.x < MAP.x1 + 20);
  }

  // ───────── покупатели досок (прилавок) ─────────
  c1Step(dt) {
    if (!this.open.z1) return;
    this.c1Timer -= dt;
    let n = 0;
    for (const c of this.cust) if (c.kind === 'c1') n++;
    if (this.c1Timer <= 0 && n < TUNE.c1Max) {
      this.c1Timer = this.uv('u_cust1') * (0.75 + 0.5 * this.rnd());
      const c = this.agent('c1', C1_SPAWN[0] + (this.rnd() - 0.5) * 2, C1_SPAWN[1]);
      c.want = 1 + Math.floor(this.rnd() * 3); c.state = 'in'; c.spot = -1; c.look = Math.floor(this.rnd() * 1000);
      this.cust.push(c);
    }
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
      case 'out':
        if (this.follow(c, dt, sp)) c.dead = true;
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
    this.goTo(c, C1_SPAWN[0] + (this.rnd() - 0.5) * 2, C1_SPAWN[1] + 4);
  }

  // ───────── покупатели магазина ─────────
  cashierPresent() { return this.cashierHere; }

  c4Step(dt) {
    if (!this.open.z4 || !this.shelvesOn.length) return;
    this.c4Timer -= dt;
    let n = 0;
    for (const c of this.cust) if (c.kind === 'c4') n++;
    if (this.c4Timer <= 0 && n < TUNE.c4Max) {
      this.c4Timer = this.uv('u_cust4') * (0.75 + 0.5 * this.rnd());
      const sp = C4_SPAWN[this.rnd() < 0.5 ? 0 : 1];
      const c = this.agent('c4', sp[0], sp[1]);
      c.want = 1 + Math.floor(this.rnd() * 3); c.tries = 0; c.look = Math.floor(this.rnd() * 1000);
      this.c4ToShelf(c, this.shelvesOn[Math.floor(this.rnd() * this.shelvesOn.length)]);
      this.cust.push(c);
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
        f.state = 'out';
        const ex = C4_SPAWN[f.look % 2];
        this.goTo(f, ex[0], ex[1]);
      }
    }
    this.cust = this.cust.filter((c) => !c.dead);
  }

  c4ToShelf(c, shelf) {
    c.shelf = shelf; c.state = 'toShelf'; c.wait = 0;
    this.goTo(c, SHELVES[shelf] + (this.rnd() - 0.5) * 2.8, 56);
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
          else { c.state = 'out'; const ex = C4_SPAWN[c.look % 2]; this.goTo(c, ex[0], ex[1]); }
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
        if (this.follow(c, dt, sp)) c.dead = true;
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

  // пневмопровод: опилки со всех станков сами летят в бункер картонной машины
  pneumoStep(dt) {
    if (!this.s.padDone.p_pneumo || !this.pileSet.has('cardM_in')) return;
    this.pneuAcc += dt * this.uv('u_pneumo');
    let guard = 40;
    while (this.pneuAcc >= 1 && guard-- > 0) {
      this.pneuAcc -= 1;
      let moved = false;
      for (const id of this.dustPiles) {
        if (this.count(id, 'sawdust') > 0 && this.space('cardM_in', 'sawdust') > 0) {
          this.take(id, 'sawdust'); this.put('cardM_in', 'sawdust'); moved = true;
          this.ev({ t: 'pipe', from: id });
        }
      }
      if (!moved) { this.pneuAcc = 0; break; }
    }
  }

  // ───────── порт ─────────
  canMake(it) {
    if (!this.stationOn('packer')) return false;
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
