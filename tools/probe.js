// Диагностика: прогнать бота до заданного часа и показать состояние цехов.
// node tools/probe.js 5
const vm = require('vm'), fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['util', 'config', 'nav', 'sim', 'bot']) vm.runInThisContext(fs.readFileSync(path.join(SRC, f + '.js'), 'utf8'), { filename: f + '.js' });
const until = parseFloat(process.argv[2] || '5') * 3600;
const g = new Game(null); g.silent = true;
const bot = new Bot(g);
let made0 = {}, t0 = 0;
while (g.s.playT < until) {
  bot.step(0.1); g.step(0.1);
  if (!t0 && g.s.playT >= until - 600) { t0 = g.s.playT; made0 = Object.assign({}, g.s.stats.made); }
}
console.log('этаж', g.s.floor, 'стройке нужно', JSON.stringify(g.siteNeed()));
console.log('сделано за последние 10 мин:', Object.keys(g.s.stats.made).map((k) => k + ' ' + (g.s.stats.made[k] - (made0[k] || 0))).join(', '));
for (const id of g.stOn) {
  const st = STATIONS[id], ss = g.s.st[id] || {};
  console.log(id.padEnd(8), 'вход', JSON.stringify(g.s.piles[st.in] || {}), 'выход', JSON.stringify(g.s.piles[st.out] || {}), 'идёт', ss.cur >= 0 ? 'да' : 'нет');
}
for (const id of ['counter', 'opt', 'shelfC', 'shelfT', 'shelfW', 'yard', 'flogs']) if (g.pileSet.has(id)) console.log(id.padEnd(8), JSON.stringify(g.s.piles[id] || {}));
console.log('рабочие:');
for (const w of g.workers) console.log('  ', (w.route || w.role).padEnd(10), String(w.task).padEnd(7), 'src', w.src, 'dst', w.dst, 'в руках', w.stack.join(','));
console.log('улучшения:', JSON.stringify(g.s.upg));
console.log('бот застревал раз:', bot.stuckCount || 0);
const ch = bot.cheapest(); console.log('следующая покупка бота:', ch && (ch.pad ? ch.pad.id : ch.upg.id), ch && ch.cost, 'в кармане', g.s.money.toFixed(0), 'частично оплачено', JSON.stringify(g.s.padPaid));
console.log('видимые площадки:', PADS.filter((p) => g.padVisible(p)).map((p) => p.id + ' ' + p.cost).join(', '));
console.log('задача бота:', JSON.stringify(bot.task));
console.log('в кассах:', JSON.stringify(g.s.cash), 'заработано всего', g.s.earned.toFixed(0), 'продано всего', g.s.stats.sold.toFixed(0));
