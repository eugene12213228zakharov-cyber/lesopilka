// Прогон баланса: бот проходит игру без графики и печатает время по этажам.
// node tools/balance.js [часов=12] [--lunch] [--quiet] [--buys] [--seed=N]
//   --lunch — играть по 40 минут, между сессиями офлайн по потолку TUNE.offlineCap (как в обед раз в день)
const vm = require('vm'), fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['util', 'config', 'nav', 'sim', 'bot']) {
  vm.runInThisContext(fs.readFileSync(path.join(SRC, f + '.js'), 'utf8'), { filename: f + '.js' });
}

const args = process.argv.slice(2);
const hours = parseFloat(args.find((a) => /^\d/.test(a)) || '12');
const lunch = args.includes('--lunch');
const quiet = args.includes('--quiet');
const DT = 0.1;

const g = new Game(null);
g.silent = true;
const seedArg = args.find((a) => a.startsWith('--seed='));   // другие случайные числа — чтобы сравнивать по нескольким прогонам
if (seedArg) g.s.rng.s = +seedArg.slice(7);
const bot = new Bot(g);
if (seedArg) bot.rs.s = +seedArg.slice(7) * 7 + 1;
const started = Date.now();
let lastSold = 0;
let lastFloor = 0, nextReport = 1800, lastBuys = 0, lastBuyT = 0, maxGap = 0, gapAt = 0, session = 0, offline = 0;
const gaps = [];
const floorRows = [];

// «Дорого ли»: сколько секунд текущего дохода стоит покупка (доход — за последние 2 минуты)
const incomeLog = [];
const buys = [];
const rate = () => {
  const now = g.s.playT;
  while (incomeLog.length > 1 && now - incomeLog[0][0] > 120) incomeLog.shift();
  if (!incomeLog.length) return 0;
  const [t0, s0] = incomeLog[0];
  return (g.s.stats.sold - s0) / Math.max(30, now - t0);
};
const origBuy = g.buyUpgrade.bind(g), origPad = g.completePad.bind(g);
g.buyUpgrade = (id) => {
  const u = UPG_BY_ID[id], c = u.cost(g.s.upg[id] || 0), r = rate();
  const ok = origBuy(id);
  if (ok) buys.push({ t: g.s.playT, what: id, cost: c, pay: r > 0 ? c / r : 999 });
  return ok;
};
g.completePad = (p) => {
  const r = rate();
  if (!g.s.padDone[p.id]) buys.push({ t: g.s.playT, what: p.id, cost: p.cost, pay: r > 0 ? p.cost / r : 999 });
  return origPad(p);
};
let nextIncomeSample = 0;

while (g.s.playT < hours * 3600 && g.s.floor < FLOORS.length) {
  bot.step(DT);
  g.step(DT);
  if (g.s.playT >= nextIncomeSample) { nextIncomeSample += 5; incomeLog.push([g.s.playT, g.s.stats.sold]); }
  if (g.s.stats.buys !== lastBuys) {
    const gap = g.s.playT - lastBuyT;
    gaps.push(gap);
    if (gap > maxGap) { maxGap = gap; gapAt = lastBuyT; }
    lastBuys = g.s.stats.buys; lastBuyT = g.s.playT;
  }
  if (g.s.floor !== lastFloor) {
    lastFloor = g.s.floor;
    const z = FLOORS[lastFloor - 1].unlock;
    floorRows.push([lastFloor, g.s.playT, z ? ZONE_BY_ID[z].name : '']);
    if (!quiet) console.log(`этаж ${String(lastFloor).padStart(2)}  ${fmtTime(g.s.playT).padStart(12)}   заработано ${fmtMoney(g.s.earned).padStart(8)}   покупок ${g.s.stats.buys}${z ? '   → открыта зона «' + ZONE_BY_ID[z].name + '»' : ''}`);
  }
  if (g.s.playT >= nextReport) {
    nextReport += 1800;
    const perMin = (g.s.stats.sold - lastSold) / 30;
    lastSold = g.s.stats.sold;
    if (!quiet) {
      const need = g.siteNeed();
      const needS = Object.keys(need).map((k) => ITEMS[k].name + ' ' + need[k]).join(', ');
      console.log(`   [${fmtTime(g.s.playT)}] доход ${fmtMoney(perMin)}/мин, в кармане ${fmtMoney(g.s.money)}, покупок ${g.s.stats.buys}, рабочих ${g.workers.length}; стройке нужно: ${needS}`);
    }
  }
  if (lunch) {
    session += DT;
    if (session >= 40 * 60) { session = 0; const r = g.fastForward(TUNE.offlineCap); offline += r.sec; }
  }
}

const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
console.log('\n══════ итог ══════');
console.log(`этажей ${g.s.floor}/${FLOORS.length}, активной игры ${fmtTime(g.s.playT)}${lunch ? ', офлайна ' + fmtTime(offline) : ''}`);
console.log(`покупок ${g.s.stats.buys}; пауза между покупками: медиана ${fmtTime(med(gaps))}, самая длинная ${fmtTime(maxGap)} (с ${fmtTime(gapAt)})`);
console.log('зоны: ' + ZONES.slice(1).map((z) => z.name + ' ' + (g.s.stats.zonesT[z.id] !== undefined ? fmtTime(g.s.stats.zonesT[z.id]) : '—')).join(' | '));
// цена покупки в секундах дохода по отрезкам игры: медиана и доля «дорогих» (дольше 3 минут)
const phases = [[0, 1800, '0–30 мин'], [1800, 3600, '30–60 мин'], [3600, 7200, '1–2 ч'], [7200, 14400, '2–4 ч'], [14400, 1e9, '4 ч+']];
console.log('цена покупки в секундах дохода: ' + phases.map(([a, b, name]) => {
  const ps = buys.filter((x) => x.t >= a && x.t < b).map((x) => x.pay);
  if (!ps.length) return name + ' —';
  const exp = ps.filter((p) => p > 180).length / ps.length;
  return `${name}: медиана ${Math.round(med(ps))} с, дорогих ${Math.round(exp * 100)}%`;
}).join(' | '));
if (args.includes('--buys')) for (const x of buys) console.log(`  ${fmtTime(x.t).padStart(12)}  ${x.what.padEnd(14)} ${fmtMoney(x.cost).padStart(8)}  = ${Math.round(x.pay)} с дохода`);
const notMax = UPGRADES.filter((u) => g.open[u.zone] && (g.s.upg[u.id] || 0) < u.max).map((u) => u.id + ' ' + (g.s.upg[u.id] || 0) + '/' + u.max);
console.log('не докачано: ' + (notMax.join(', ') || 'всё'));
const padsLeft = PADS.filter((p) => g.open[p.zone] && !g.s.padDone[p.id]).map((p) => p.id);
console.log('не открыто площадок: ' + (padsLeft.join(', ') || 'нет'));
console.log('сделано: ' + Object.keys(g.s.stats.made).map((k) => ITEMS[k].name + ' ' + fmtNum(g.s.stats.made[k])).join(', '));
console.log(`прогон занял ${((Date.now() - started) / 1000).toFixed(1)} с`);
if (g.s.floor < FLOORS.length) {
  console.log('\nЗАСТРЯЛ. Кучи:', JSON.stringify(g.s.piles));
  console.log('рабочие:', g.workers.map((w) => (w.route || w.role) + ':' + w.task + ':' + w.stack.length).join(' '));
  console.log('бот:', JSON.stringify(bot.task), 'игрок', g.pl.x.toFixed(1), g.pl.z.toFixed(1), 'в руках', g.pl.stack.join(','));
  console.log('покупатели:', g.cust.map((c) => c.kind + ':' + c.state + ':' + c.x.toFixed(0) + ',' + c.z.toFixed(0)).join(' '), 'места', g.stalls.map((st) => st.spots.map((x) => (x ? 1 : 0)).join('')).join(' | '));
  console.log('деньги в кассах:', JSON.stringify(g.s.cash), 'стройка', JSON.stringify(g.s.floorGot));
}
