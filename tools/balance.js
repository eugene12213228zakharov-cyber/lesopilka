// Прогон баланса: бот проходит игру без графики и печатает время по этажам.
// node tools/balance.js [часов=12] [--lunch] [--quiet]
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
const bot = new Bot(g);
const started = Date.now();
let lastSold = 0;
let lastFloor = 0, nextReport = 1800, lastBuys = 0, lastBuyT = 0, maxGap = 0, gapAt = 0, session = 0, offline = 0;
const gaps = [];
const floorRows = [];

while (g.s.playT < hours * 3600 && g.s.floor < FLOORS.length) {
  bot.step(DT);
  g.step(DT);
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
  console.log('покупатели:', g.cust.map((c) => c.kind + ':' + c.state + ':' + c.x.toFixed(0) + ',' + c.z.toFixed(0)).join(' '), 'места', g.spots.map((s) => (s ? 1 : 0)).join(''));
  console.log('деньги в кассах:', JSON.stringify(g.s.cash), 'стройка', JSON.stringify(g.s.floorGot));
}
