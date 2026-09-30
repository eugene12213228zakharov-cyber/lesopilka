// Совместимость сохранений между версиями: бот играет N часов на старой версии (коммит),
// сохранение грузится в текущую — прогресс должен сохраниться, игра — идти дальше.
// node tools/compat.js <коммит> [часов=3]
const vm = require('vm'), fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const rev = process.argv[2];
const hours = parseFloat(process.argv[3] || '3');
if (!rev) { console.log('укажи коммит старой версии: node tools/compat.js fdb7d59'); process.exit(2); }

const FILES = ['util', 'config', 'nav', 'sim', 'bot'];
function sandbox(read) {
  const ctx = vm.createContext({ console, Math, JSON, Date, Object, Array, Set, Map, WeakMap, Number, String, Boolean, Error, Infinity, NaN, isFinite, parseFloat, parseInt, Float32Array, Int16Array, Int32Array, Uint8Array, Uint32Array });
  for (const f of FILES) {
    const src = read(f);
    if (src !== null) vm.runInContext(src + `\n;globalThis.__names = (globalThis.__names || []);`, ctx, { filename: f + '.js' });
  }
  vm.runInContext('globalThis.Game = Game; globalThis.Bot = Bot; globalThis.FLOORS = FLOORS; globalThis.PADS = PADS;', ctx);
  return ctx;
}
const oldCtx = sandbox((f) => { try { return cp.execSync(`git show ${rev}:src/${f}.js`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return null; } });
const newCtx = sandbox((f) => fs.readFileSync(path.join(ROOT, 'src', f + '.js'), 'utf8'));

let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'ок   ' : 'ОШИБКА ') + name + (extra ? ' — ' + extra : '')); if (!ok) fails++; };

// играем на старой версии
const og = new oldCtx.Game(null); og.silent = true;
const ob = new oldCtx.Bot(og);
for (let i = 0; i < hours * 3600 * 10; i++) { ob.step(0.1); og.step(0.1); }
const save = JSON.parse(JSON.stringify(og.toSave()));
console.log(`старая версия ${rev}: этаж ${og.s.floor}, денег ${Math.round(og.s.money)}, площадок ${Object.keys(og.s.padDone).length}, рабочих ${og.workers.length}, в руках ${og.pl.stack.length}`);

// грузим в новую
let ng;
try { ng = new newCtx.Game(save); ng.silent = true; } catch (e) { check('загрузка не падает', false, e.message); process.exit(1); }
check('загрузка не падает', true);
check('этаж', ng.s.floor === og.s.floor, String(og.s.floor));
check('деньги', Math.abs(ng.s.money - og.s.money) < 0.01);
check('площадки', JSON.stringify(ng.s.padDone) === JSON.stringify(og.s.padDone));
check('улучшения', JSON.stringify(ng.s.upg) === JSON.stringify(og.s.upg));
check('рабочие', ng.workers.length === og.workers.length, ng.workers.length + ' чел.');
check('в руках', ng.pl.stack.join() === og.pl.stack.join());
check('открытые зоны', JSON.stringify(Object.keys(ng.open).filter((k) => ng.open[k])) === JSON.stringify(Object.keys(og.open).filter((k) => og.open[k])));
check('игрок не в стене', !ng.hits(ng.pl.x, ng.pl.z, 0.45), `${ng.pl.x.toFixed(1)}, ${ng.pl.z.toFixed(1)}`);

// новая версия играет дальше на загруженном сохранении
const nb = new newCtx.Bot(ng);
const earned0 = ng.s.earned, floor0 = ng.s.floor;
let err = null;
try { for (let i = 0; i < 1800 * 10; i++) { nb.step(0.1); ng.step(0.1); } } catch (e) { err = e; }
check('игра идёт дальше 30 мин', !err && ng.s.earned > earned0, err ? err.message : `+${Math.round(ng.s.earned - earned0)}$, этаж ${floor0} → ${ng.s.floor}`);
// и офлайн-час
try { const r = ng.fastForward(3600); check('офлайн час', r.money >= 0, '+' + Math.round(r.money) + '$'); } catch (e) { check('офлайн час', false, e.message); }
// сохранение новой версии грузится в новую
const s2 = JSON.parse(JSON.stringify(ng.toSave()));
try { const g3 = new newCtx.Game(s2); check('пересохранение → загрузка', g3.s.floor === ng.s.floor); } catch (e) { check('пересохранение → загрузка', false, e.message); }
console.log(fails ? `\nОШИБОК: ${fails}` : '\nвсё ок');
process.exit(fails ? 1 : 0);
