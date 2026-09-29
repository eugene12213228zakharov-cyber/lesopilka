// Проверка: сохранение → загрузка даёт ту же игру; офлайн-перемотка работает.
const vm = require('vm'), fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['util', 'config', 'nav', 'sim', 'bot']) vm.runInThisContext(fs.readFileSync(path.join(SRC, f + '.js'), 'utf8'), { filename: f + '.js' });

let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'ок   ' : 'ОШИБКА ') + name + (extra ? ' — ' + extra : '')); if (!ok) fails++; };

const g = new Game(null); g.silent = true;
const bot = new Bot(g);
for (let i = 0; i < 3 * 3600 * 10; i++) { bot.step(0.1); g.step(0.1); }
const save = JSON.parse(JSON.stringify(g.toSave()));
const g2 = new Game(save); g2.silent = true;
check('этаж', g2.s.floor === g.s.floor, g.s.floor);
check('деньги', Math.abs(g2.s.money - g.s.money) < 0.01, fmtMoney(g.s.money));
check('площадки', JSON.stringify(g2.s.padDone) === JSON.stringify(g.s.padDone), Object.keys(g.s.padDone).length + ' шт.');
check('улучшения', JSON.stringify(g2.s.upg) === JSON.stringify(g.s.upg));
check('рабочие', g2.workers.length === g.workers.length, g.workers.length + ' чел.');
check('в руках', g2.pl.stack.join() === g.pl.stack.join(), g.pl.stack.length + ' шт.');
check('кучи', JSON.stringify(g2.s.piles) === JSON.stringify(g.s.piles));
check('открытые зоны', JSON.stringify(g2.open) === JSON.stringify(g.open), Object.keys(g.open).filter((k) => g.open[k]).join(','));

// загруженная игра продолжает работать
const earned0 = g2.s.earned;
const bot2 = new Bot(g2);
for (let i = 0; i < 600 * 10; i++) { bot2.step(0.1); g2.step(0.1); }
check('после загрузки игра идёт', g2.s.earned > earned0, '+' + fmtMoney(g2.s.earned - earned0) + ' за 10 мин');

// офлайн: игрок стоит, цеха работают
const cash0 = g2.moneyInCash() + g2.s.money;
const r = g2.fastForward(3600);
check('офлайн час', r.money > 0 && g2.moneyInCash() + g2.s.money > cash0, '+' + fmtMoney(r.money));
check('офлайн не двигает игрока', !g2.pl.moving);

// старое/битое сохранение не роняет игру
const g3 = new Game({ v: 999, junk: true });
check('чужая версия → новая игра', g3.s.floor === 0 && g3.s.money === 0);
const g4 = new Game(Object.assign(JSON.parse(JSON.stringify(save)), { trees: [1, 2] }));
check('битые деревья → чинятся', g4.s.trees.length === PLOTS.length);

console.log(fails ? `\nОШИБОК: ${fails}` : '\nвсё ок');
process.exit(fails ? 1 : 0);
