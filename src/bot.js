'use strict';
// Бот-игрок для прогона баланса. Двигает игрока через тот же ввод, что и человек,
// и сам ничего не телепортирует: ходит, стоит на площадках, покупает улучшения.

class Bot {
  constructor(g) {
    this.g = g;
    this.task = null;
    this.path = null;
    this.pi = 0;
    this.lastPos = [0, 0];
    this.stuckT = 0;
    this.buyLog = [];
    this.rs = { s: 4242 };
  }

  step(dt) {
    this.buyUpgrades();
    if (!this.task) { this.task = this.decide(); this.path = null; }
    this.run(dt);
  }

  travel(x0, z0, x1, z1) { return dist(x0, z0, x1, z1) * 1.25 / this.g.uv('u_speed'); }

  // что нужно стройке — сами предметы и то, из чего их делают (на два шага вверх по цепочке)
  wanted() {
    const need = this.g.siteNeed(), w = new Set();
    for (const it in need) if (need[it] > 0) w.add(it);
    for (let pass = 0; pass < 2; pass++) {
      for (const id in STATIONS) for (const r of STATIONS[id].recipes) {
        if (Object.keys(r.out).some((o) => w.has(o))) for (const i in r.in) w.add(i);
      }
    }
    return w;
  }

  // площадка помогает следующему этажу: строит станок нужной цепочки или нанимает того, кто её кормит
  padHelps(p, w) {
    if (p.worker && p.worker.role === 'builder') return true;
    if (p.station) return STATIONS[p.station].recipes.some((r) => Object.keys(r.out).some((o) => w.has(o)));
    if (p.worker && p.worker.route) {
      return ROUTES[p.worker.route].to.some((id) => {
        const pl = PILES[id];
        if (!pl.station) return false;
        return STATIONS[pl.station].recipes.some((r) => Object.keys(r.out).some((o) => w.has(o)));
      });
    }
    return false;
  }

  // следующая покупка: площадки важнее улучшений (как у живого игрока — новое интереснее),
  // а то, что двигает стройку, — важнее всего
  cheapest() {
    const g = this.g, s = g.s, w = this.wanted();
    let best = null;
    for (const p of PADS) {
      if (!g.padVisible(p)) continue;
      const c = p.cost - (s.padPaid[p.id] || 0);
      const eff = c * (p.gate ? 0.05 : this.padHelps(p, w) ? 0.25 : 0.6);
      if (!best || eff < best.eff) best = { pad: p, cost: c, eff };
    }
    for (const u of UPGRADES) {
      const l = s.upg[u.id] || 0;
      if (l >= u.max || !g.open[u.zone]) continue;
      const c = u.cost(l);
      if (!best || c < best.eff) best = { upg: u, cost: c, eff: c };
    }
    return best;
  }

  gatePending() { return PADS.some((p) => p.gate && this.g.padVisible(p)); }

  buyUpgrades() {
    const g = this.g;
    for (let k = 0; k < 5; k++) {
      const b = this.cheapest();
      if (!b || !b.upg || b.cost > g.s.money) return;
      g.buyUpgrade(b.upg.id);
      this.buyLog.push([g.s.playT, b.upg.id]);
    }
  }

  itemValue(it, dst) {
    const g = this.g, p = PILES[dst];
    if (p.trash) return 0;
    if (p.site) return g.price(it) * (this.gatePending() ? 0.5 : 1.8) + 2;
    if (p.dock) return g.price(it) * TUNE.exportMul * g.uv('u_export') * 0.7;
    if (dst === 'pwh') return g.price(it) * TUNE.exportMul * g.uv('u_export') * 0.5;
    if (p.sell) return g.price(it) * (dst === 'opt' ? TUNE.optShare : 1);
    if (p.role === 'in') {
      const st = STATIONS[p.station], need = g.siteNeed();
      for (const r of st.recipes) {
        if (!r.in[it]) continue;
        let v = 0, n = 0;
        // если выход станка нужен стройке — входу та же ценность, что и доставке на стройку
        for (const o in r.out) v += (need[o] > 0 ? this.itemValue(o, 'site') : g.price(o)) * r.out[o];
        for (const i in r.in) n += r.in[i];
        return (v / n) * 0.85;
      }
    }
    return 0;
  }

  dropPiles() {
    const g = this.g;
    return g.pilesOn.filter((id) => PILES[id].mode === 'drop' && !PILES[id].trash);
  }

  bestDrop() {
    const g = this.g, pl = g.pl;
    let best = null, bs = 0;
    for (const id of this.dropPiles()) {
      const p = PILES[id];
      let v = 0;
      const room = {};
      for (const it of pl.stack) {
        if (room[it] === undefined) room[it] = g.space(id, it);
        if (room[it] > 0) { room[it]--; v += this.itemValue(it, id); }
      }
      if (v <= 0) continue;
      const sc = v / (this.travel(pl.x, pl.z, p.x, p.z) + 1);
      if (sc > bs) { bs = sc; best = id; }
    }
    return best;
  }

  decide() {
    const g = this.g, s = g.s, pl = g.pl;
    const b = this.cheapest();
    if (b && b.pad && b.cost <= s.money) return { k: 'pad', id: b.pad.id, x: b.pad.x, z: b.pad.z };
    if (pl.stack.length) {
      const d = this.bestDrop();
      if (d) return this.at({ k: 'drop', id: d }, d);
      if (pl.stack.length >= g.capOf(pl) * 0.5 || !this.bestWork()) {
        const tr = g.pileSet.has('trash3') && pl.x > 0 ? 'trash3' : 'trash1';
        return this.at({ k: 'drop', id: tr }, tr);
      }
    }
    return this.bestWork() || { k: 'idle', t: 1 };
  }

  at(t, id) { const p = PILES[id]; t.x = p.x; t.z = p.z; return t; }

  bestWork() {
    const g = this.g, s = g.s, pl = g.pl, cap = g.capOf(pl), free = cap - pl.stack.length;
    let best = null, bs = 0;
    const cand = (t, v, time) => { const sc = v / Math.max(0.5, time); if (sc > bs) { bs = sc; best = t; } };
    const drops = this.dropPiles();
    // перенос предметов
    for (const src of g.pilesOn) {
      const ps = PILES[src];
      if (ps.mode !== 'pick' || (ps.pickZone && !g.open[ps.pickZone])) continue;
      const c = s.piles[src];
      if (!c) continue;
      for (const it in c) {
        if (c[it] <= 0) continue;
        for (const dst of drops) {
          const sp = g.space(dst, it);
          if (sp <= 0) continue;
          const n = Math.min(c[it], sp, free);
          if (n <= 0) continue;
          const v = n * this.itemValue(it, dst);
          if (v <= 0) continue;
          const pd = PILES[dst];
          const time = this.travel(pl.x, pl.z, ps.x, ps.z) + this.travel(ps.x, ps.z, pd.x, pd.z) + n * 0.13 + 0.6;
          cand({ k: 'pick', id: src, x: ps.x, z: ps.z, dst }, v, time);
        }
      }
    }
    // деньги
    for (const id of g.moneyPiles) {
      const v = s.cash[id] || 0;
      if (v <= 0) continue;
      const p = PILES[id];
      cand({ k: 'collect', id, x: p.x, z: p.z }, v * 1.3, this.travel(pl.x, pl.z, p.x, p.z) + 0.3);
    }
    // рубка и посадка
    if (g.open.z2) {
      let grown = 0, empty = 0, ti = -1, td = 1e9, ei = -1, ed = 1e9;
      for (let i = 0; i < PLOTS.length; i++) {
        if (!g.plotOn(i)) continue;
        const st = s.trees[i].stage, d = dist(pl.x, pl.z, PLOTS[i].x, PLOTS[i].z);
        if (st === 2) { grown++; if (d < td) { td = d; ti = i; } }
        if (st === 0) { empty++; if (d < ed) { ed = d; ei = i; } }
      }
      const logV = Math.max(this.itemValue('log', 'saw1_in'), 1);
      if (ti >= 0 && free >= 2) {
        const n = Math.min(free, grown * 2);
        cand({ k: 'chop', i: ti, x: PLOTS[ti].x, z: PLOTS[ti].z }, n * logV, this.travel(pl.x, pl.z, PLOTS[ti].x, PLOTS[ti].z) + (n / 2) * (g.uv('u_chop') + 0.6) + 8);
      }
      const foresters = g.workers.some((w) => w.role === 'forester' && w.on);
      if (ei >= 0 && (!foresters || empty > 10) && grown < 6) {
        cand({ k: 'plant', i: ei, x: PLOTS[ei].x, z: PLOTS[ei].z }, 5 * logV, this.travel(pl.x, pl.z, PLOTS[ei].x, PLOTS[ei].z) + 1.5);
      }
    }
    // касса магазина
    if (g.open.z4 && g.queue.length && !g.workers.some((w) => w.role === 'cashier' && w.on)) {
      let v = 0;
      for (const c of g.queue) for (const it of c.stack) v += g.price(it);
      cand({ k: 'serve', x: CASHIER.x, z: CASHIER.z }, v, this.travel(pl.x, pl.z, CASHIER.x, CASHIER.z) + g.queue.length * g.uv('u_service'));
    }
    return best;
  }

  // ведём игрока по пути; true — дошли
  steer(dt) {
    const g = this.g, pl = g.pl, t = this.task;
    if (!this.path) { this.path = g.nav.findPath(pl.x, pl.z, t.x, t.z); this.pi = 0; this.stuckT = 0; this.lastPos = [pl.x, pl.z]; }
    while (this.pi < this.path.length) {
      const [wx, wz] = this.path[this.pi];
      const d = dist(pl.x, pl.z, wx, wz);
      const last = this.pi === this.path.length - 1;
      if (d < (last ? 0.2 : 0.45)) { this.pi++; continue; }
      const k = last && d < 1 ? Math.max(0.25, d) : 1;
      g.input.x = ((wx - pl.x) / d) * k;
      g.input.z = ((wz - pl.z) / d) * k;
      this.stuckT += dt;
      if (this.stuckT > 1) {
        if (dist(pl.x, pl.z, this.lastPos[0], this.lastPos[1]) < 0.3) {
          this.path = null;
          t.fails = (t.fails || 0) + 1;
          this.stuckCount = (this.stuckCount || 0) + 1;
          // застрял: шаг в случайную сторону и заново
          const a = rngNext(this.rs) * Math.PI * 2;
          this.task = { k: 'wiggle', t: 0.4, dx: Math.cos(a), dz: Math.sin(a), next: t.fails > 3 ? null : t };
          return false;
        }
        this.stuckT = 0; this.lastPos = [pl.x, pl.z];
      }
      return false;
    }
    g.input.x = 0; g.input.z = 0;
    return true;
  }

  run(dt) {
    const g = this.g, pl = g.pl, t = this.task;
    if (!t) { g.input.x = 0; g.input.z = 0; return; }
    t.life = (t.life || 0) + dt;
    if (t.life > 90) { this.task = null; return; }
    if (t.k === 'idle') { g.input.x = 0; g.input.z = 0; t.t -= dt; if (t.t <= 0) this.task = null; return; }
    if (t.k === 'wiggle') {
      g.input.x = t.dx; g.input.z = t.dz; t.t -= dt;
      if (t.t <= 0) { this.task = t.next; this.path = null; }
      return;
    }
    if (!t.arrived) {
      if (this.steer(dt) && this.task === t) { t.arrived = true; t.quiet = 0; t.n = pl.stack.length; t.hold = 0; }
      return;
    }
    g.input.x = 0; g.input.z = 0;
    t.hold += dt;
    if (pl.stack.length !== t.n) { t.n = pl.stack.length; t.quiet = 0; } else t.quiet += dt;
    switch (t.k) {
      case 'pad':
        if (g.s.padDone[t.id] || g.s.money <= 0.5 || t.hold > 6) this.task = null;
        break;
      case 'pick':
        if (pl.stack.length >= g.capOf(pl) || t.quiet > 0.3) {
          if (!pl.stack.length) { this.task = null; break; }
          const d = g.pileSet.has(t.dst) && pl.stack.some((it) => g.space(t.dst, it) > 0) ? t.dst : this.bestDrop();
          if (!d) { this.task = null; break; }
          this.task = this.at({ k: 'drop', id: d }, d);
          this.path = null;
        }
        break;
      case 'drop':
        if (t.quiet > 0.3 || !pl.stack.length) this.task = null;
        break;
      case 'collect':
        this.task = null;
        break;
      case 'chop': {
        const tr = g.s.trees[t.i];
        if (tr.stage !== 2 || g.capOf(pl) - pl.stack.length <= 0) {
          if (g.capOf(pl) - pl.stack.length >= 1) {
            let ni = -1, nd = 14;
            for (let i = 0; i < PLOTS.length; i++) {
              if (!g.plotOn(i) || g.s.trees[i].stage !== 2) continue;
              const d = dist(pl.x, pl.z, PLOTS[i].x, PLOTS[i].z);
              if (d < nd) { nd = d; ni = i; }
            }
            if (ni >= 0) { this.task = { k: 'chop', i: ni, x: PLOTS[ni].x, z: PLOTS[ni].z, life: t.life }; this.path = null; break; }
          }
          this.task = null;
        }
        break;
      }
      case 'plant':
        if (g.s.trees[t.i].stage !== 0 || t.hold > 3) this.task = null;
        break;
      case 'serve':
        if (!g.queue.length || t.hold > 20) this.task = null;
        break;
      default:
        this.task = null;
    }
  }
}
