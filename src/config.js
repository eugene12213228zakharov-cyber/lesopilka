'use strict';
// Все цифры и раскладка карты. Баланс правится здесь.
// Координаты в метрах: X — вправо (восток), Z — вниз по экрану (юг). Север — отрицательный Z.

const MAP = { x0: -84, z0: -44, x1: 100, z1: 78, seaX: 80 };

// ───────── Предметы ─────────
// price — базовая цена продажи; h — высота в стопке на спине
const ITEMS = {
  log:       { name: 'Бревно',         price: 2,   h: 0.34 },
  board:     { name: 'Доска',          price: 4,   h: 0.1 },
  beam:      { name: 'Брус',           price: 14,  h: 0.18 },
  panel:     { name: 'Щит',            price: 16,  h: 0.11 },
  legs:      { name: 'Ножки',          price: 10,  h: 0.15 },
  sawdust:   { name: 'Опилки',         price: 0,   h: 0.34 },
  cardboard: { name: 'Картон',         price: 2,   h: 0.08 },
  box:       { name: 'Коробка',        price: 4,   h: 0.46 },
  chair:     { name: 'Стул',           price: 60,  h: 0.5 },
  table:     { name: 'Стол',           price: 110, h: 0.46 },
  wardrobe:  { name: 'Шкаф',           price: 240, h: 0.9 },
  chairB:    { name: 'Стул в коробке', price: 60,  h: 0.56, base: 'chair' },
  tableB:    { name: 'Стол в коробке', price: 110, h: 0.52, base: 'table' },
  wardrobeB: { name: 'Шкаф в коробке', price: 240, h: 0.96, base: 'wardrobe' },
};

// ───────── Зоны ─────────
// floor — после какого этажа небоскрёба открывается
const ZONES = [
  { id: 'z1', name: 'Лесопилка',         rect: { x0: -46, z0: 6,  x1: -6, z1: 38 }, floor: 0 },
  { id: 'z2', name: 'Делянка',           rect: { x0: -80, z0: 6,  x1: -50, z1: 46 }, floor: 2 },
  { id: 'z3', name: 'Столярка',          rect: { x0: 6,   z0: 6,  x1: 50, z1: 38 }, floor: 4 },
  { id: 'z4', name: 'Мебельный магазин', rect: { x0: 6,   z0: 44, x1: 50, z1: 72 }, floor: 7 },
  { id: 'z5', name: 'Бумажный цех',      rect: { x0: -46, z0: 44, x1: -6, z1: 72 }, floor: 10 },
  { id: 'z6', name: 'Порт',              rect: { x0: 56,  z0: 6,  x1: 80, z1: 50 }, floor: 13 },
];
const ZONE_BY_ID = {};
for (const z of ZONES) ZONE_BY_ID[z.id] = z;

// ───────── Кучи (площадки с предметами) и станки ─────────
// mode для игрока: pick — берёт, drop — кладёт. Рабочие ходят по своим маршрутам.
const PILES = {};
const STATIONS = {};
const PROPS = [];   // твёрдые декорации: прилавок, стеллажи, касса, основание небоскрёба…

function addPile(id, o) { PILES[id] = Object.assign({ id, w: 2.4, d: 2.4 }, o); }

// Станок: вход — слева (запад), выход — справа (восток), опилки — снизу (юг)
function machine(id, zone, type, name, x, z, recipes, o) {
  const st = {
    id, zone, type, name, x, z, w: 3.2, d: 2.4,
    recipes, speed: o.speed, pad: o.pad || null,
    in: id + '_in', out: id + '_out', by: o.dust ? id + '_dust' : null,
  };
  STATIONS[id] = st;
  addPile(st.in, { zone, x: x - 4.4, z, mode: 'drop', accepts: o.inCap, station: id, role: 'in' });
  addPile(st.out, { zone, x: x + 4.4, z, mode: 'pick', accepts: o.outCap, station: id, role: 'out' });
  if (st.by) addPile(st.by, { zone, x, z: z + 3.8, w: 2.0, d: 1.8, mode: 'pick', pickZone: 'z5', accepts: { sawdust: 30 }, station: id, role: 'dust' });
}

const SAW = [{ in: { log: 1 }, out: { board: 2 }, by: { sawdust: 1 }, t: 3.4 }];

// ── z1 Лесопилка ──
addPile('yard', { zone: 'z1', x: -40, z: 11, w: 4, d: 4, mode: 'pick', accepts: { log: 30 }, name: 'Склад брёвен' });
machine('saw1', 'z1', 'saw', 'Пилорама', -28, 12, SAW, { speed: 'u_saw', dust: true, inCap: { log: 12 }, outCap: { board: 40 } });
machine('saw2', 'z1', 'saw', 'Пилорама №2', -28, 21, SAW, { speed: 'u_saw', dust: true, pad: 'p_saw2', inCap: { log: 12 }, outCap: { board: 40 } });
machine('saw3', 'z1', 'saw', 'Пилорама №3', -28, 30, SAW, { speed: 'u_saw', dust: true, pad: 'p_saw3', inCap: { log: 12 }, outCap: { board: 40 } });
addPile('counter', { zone: 'z1', x: -15.2, z: 16, w: 2.4, d: 4, mode: 'drop', accepts: { board: 40 }, name: 'Прилавок', sell: true });
addPile('cash1', { zone: 'z1', x: -15.2, z: 21.4, w: 2.4, d: 2, money: true });
PROPS.push({ id: 'stall', type: 'stall', zone: 'z1', x: -12, z: 16, w: 1.6, d: 6 });
const C1_SPOTS = [[-10.1, 14], [-10.1, 16], [-10.1, 18]];
// покупатели досок приходят по тротуару вдоль южной дороги: здесь входят на лесопилку и отсюда уходят
const C1_ENTRY = [-4, 30];
const C1_EXIT = [-4, 34];

// ── центр: небоскрёб ──
addPile('site', { zone: 'c', x: 0, z: -12, w: 6, d: 2.4, mode: 'drop', site: true, name: 'Стройка' });
PROPS.push({ id: 'tower', type: 'tower', zone: 'c', x: 0, z: -26, w: 16, d: 16 });
PROPS.push({ id: 'tcrane', type: 'tcrane', zone: 'c', x: 11.5, z: -21, w: 2, d: 2 });

// ── z2 Делянка ──
const PLOTS = [];
{
  const cols = [-78, -74, -70, -66, -62, -58];
  const groups = [[30, 34], [38, 42], [22, 26]];   // ряды по Z для групп 0,1,2
  groups.forEach((rows, g) => { for (const z of rows) for (const x of cols) PLOTS.push({ x, z, g }); });
}
addPile('flogs', { zone: 'z2', x: -54, z: 30, w: 3, d: 3, mode: 'pick', accepts: { log: 60 }, name: 'Брёвна с делянки' });
machine('saw4', 'z2', 'saw', 'Пилорама у леса', -66, 12, SAW, { speed: 'u_saw', dust: true, pad: 'p_saw4', inCap: { log: 12 }, outCap: { board: 40 } });

// ── z3 Столярка ──
machine('beamer1', 'z3', 'beamer', 'Брусовальный станок', 14, 12, [{ in: { log: 1 }, out: { beam: 1 }, by: { sawdust: 1 }, t: 3.6 }],
  { speed: 'u_join', dust: true, pad: 'p_beamer1', inCap: { log: 12 }, outCap: { beam: 30 } });
machine('press1', 'z3', 'press', 'Клеильный пресс', 14, 21, [{ in: { board: 2 }, out: { panel: 1 }, t: 3.6 }],
  { speed: 'u_join', pad: 'p_press1', inCap: { board: 20 }, outCap: { panel: 30 } });
machine('beamer2', 'z3', 'beamer', 'Брусовальный №2', 14, 30, [{ in: { log: 1 }, out: { beam: 1 }, by: { sawdust: 1 }, t: 3.6 }],
  { speed: 'u_join', dust: true, pad: 'p_beamer2', inCap: { log: 12 }, outCap: { beam: 30 } });
machine('lathe1', 'z3', 'lathe', 'Токарный станок', 27, 12, [{ in: { beam: 1 }, out: { legs: 2 }, t: 3.2 }],
  { speed: 'u_join', pad: 'p_lathe1', inCap: { beam: 12 }, outCap: { legs: 30 } });
machine('press2', 'z3', 'press', 'Клеильный пресс №2', 27, 21, [{ in: { board: 2 }, out: { panel: 1 }, t: 3.6 }],
  { speed: 'u_join', pad: 'p_press2', inCap: { board: 20 }, outCap: { panel: 30 } });
machine('lathe2', 'z3', 'lathe', 'Токарный №2', 27, 30, [{ in: { beam: 1 }, out: { legs: 2 }, t: 3.2 }],
  { speed: 'u_join', pad: 'p_lathe2', inCap: { beam: 12 }, outCap: { legs: 30 } });
machine('benchC', 'z3', 'bench', 'Верстак: стулья', 40, 12, [{ in: { board: 1, legs: 1 }, out: { chair: 1 }, t: 3.5 }],
  { speed: 'u_join', pad: 'p_benchC', inCap: { board: 10, legs: 10 }, outCap: { chair: 20 } });
machine('benchT', 'z3', 'bench', 'Верстак: столы', 40, 21, [{ in: { panel: 1, legs: 1 }, out: { table: 1 }, t: 4.5 }],
  { speed: 'u_join', pad: 'p_benchT', inCap: { panel: 10, legs: 10 }, outCap: { table: 20 } });
machine('benchW', 'z3', 'bench', 'Верстак: шкафы', 40, 30, [{ in: { panel: 2, beam: 1 }, out: { wardrobe: 1 }, t: 6 }],
  { speed: 'u_join', pad: 'p_benchW', inCap: { panel: 12, beam: 6 }, outCap: { wardrobe: 12 } });
addPile('opt', { zone: 'z3', x: 47.8, z: 8.4, mode: 'drop', pad: 'p_opt', accepts: { chair: 20, table: 20, wardrobe: 12 }, name: 'Оптовый склад', sell: true });
addPile('cash3', { zone: 'z3', x: 47.8, z: 16.4, w: 2.4, d: 2, money: true, pad: 'p_opt' });

// ── z4 Мебельный магазин ──
const SHELVES = { shelfC: 16, shelfT: 28, shelfW: 40 };
const SHELF_ITEMS = { shelfC: ['chairB', 'chair'], shelfT: ['tableB', 'table'], shelfW: ['wardrobeB', 'wardrobe'] };
const SHELF_PAD = { shelfC: 'p_shelfC', shelfT: 'p_shelfT', shelfW: 'p_shelfW' };
for (const id in SHELVES) {
  const x = SHELVES[id], it = SHELF_ITEMS[id];
  addPile(id, { zone: 'z4', x, z: 51.2, w: 4, d: 2, mode: 'drop', pad: SHELF_PAD[id], accepts: { [it[0]]: 10, [it[1]]: 10 }, shelf: true, sell: true, name: 'Витрина' });
  PROPS.push({ id: 'rack_' + id, type: 'rack', zone: 'z4', pad: SHELF_PAD[id], x, z: 54, w: 4.4, d: 1.2 });
}
PROPS.push({ id: 'desk', type: 'desk', zone: 'z4', x: 28, z: 64, w: 4, d: 1.2 });
const CASHIER = { x: 28, z: 62, w: 2.4, d: 1.6 };
const QUEUE = [[27.4, 66], [27.4, 67.4], [27.4, 68.8], [27.4, 70.2], [29, 70.9], [30.6, 70.9], [32.2, 70.9], [33.8, 70.9]];
// входы в магазин с дорожки вдоль южного края; к дорожке покупатели идут по тротуару южной дороги
const C4_ENTRY = [[20, 77], [36, 77]];
addPile('cash4', { zone: 'z4', x: 33.4, z: 62, w: 2.4, d: 1.8, money: true });

// ── z5 Бумажный цех ──
machine('cardM', 'z5', 'paper', 'Картонная машина', -36, 52, [{ in: { sawdust: 3 }, out: { cardboard: 1 }, t: 3 }],
  { speed: 'u_paper', pad: 'p_cardM', inCap: { sawdust: 60 }, outCap: { cardboard: 30 } });
machine('boxM', 'z5', 'boxer', 'Коробочный станок', -22, 52, [{ in: { cardboard: 1 }, out: { box: 1 }, t: 2.4 }],
  { speed: 'u_paper', pad: 'p_boxM', inCap: { cardboard: 20 }, outCap: { box: 30 } });
machine('packer', 'z5', 'packer', 'Упаковка', -22, 63, [
  { in: { chair: 1, box: 1 }, out: { chairB: 1 }, t: 2.2 },
  { in: { table: 1, box: 1 }, out: { tableB: 1 }, t: 2.6 },
  { in: { wardrobe: 1, box: 1 }, out: { wardrobeB: 1 }, t: 3.2 },
], { speed: 'u_paper', pad: 'p_packer', inCap: { box: 12, chair: 8, table: 8, wardrobe: 6 }, outCap: { chairB: 12, tableB: 12, wardrobeB: 8 } });
PILES.cardM_in.name = 'Бункер опилок';
PROPS.push({ id: 'compressor', type: 'compressor', zone: 'z5', pad: 'p_pneumo', x: -41, z: 58, w: 2.4, d: 2 });

// ── z6 Порт ──
addPile('dock', { zone: 'z6', x: 84.5, z: 29, w: 3, d: 3, y: 0.3, mode: 'drop', pad: 'p_dock', dock: true, name: 'Причал' });
addPile('pwh', { zone: 'z6', x: 66, z: 22, w: 4, d: 4, mode: 'drop', pad: 'p_crane', accepts: { chairB: 50, tableB: 50, wardrobeB: 30 }, name: 'Склад порта' });
addPile('cash6', { zone: 'z6', x: 70, z: 36, w: 2.4, d: 2, money: true, pad: 'p_dock' });
PROPS.push({ id: 'pcrane', type: 'pcrane', zone: 'z6', pad: 'p_crane', x: 77, z: 22.5, w: 2.4, d: 2.4 });
const PIER = { x0: 80, z0: 26, x1: 88, z1: 32 };
const SHIP_DOCK = [93, 29];

// ── дороги, переходы, светофор ──
// Главная дорога — вдоль X (|z| ≤ 3): на западе уходит в тоннель, у моря поворачивает на север — береговая дорога
// в северный тоннель. От перекрёстка в центре — южная дорога (|x| ≤ 3). Движение правостороннее, полосы ±1.5.
const ROAD = {
  half: 3, lane: 1.5, walk: 4, walkW: 1.6,        // полуширина, середина полосы, середина и ширина тротуара
  westX: -150, coastX: 73, southZ: 190,
  tunnelW: { x: -91, x1: -121, z0: -15, z1: 15 },  // западный тоннель: портал и холм над ним
  tunnelN: { z: -17, z1: -45, x0: 62, x1: 84 },    // северный: портал и холм (холм — стена)
};
// Переходы: across 'z' — через главную (идут вдоль Z), 'x' — через южную; signal — светофор перехода, без него —
// «зебра»: пешеход пропускает подъезжающую машину, машина — пешехода на переходе.
// Рабочие переходят дорогу только здесь (дороги для них непроходимы).
const CROSSINGS = [
  { x: -26, z: 0, across: 'z' }, { x: -4.6, z: 0, across: 'z', signal: 'c' },
  { x: 4.6, z: 0, across: 'z', signal: 'c' }, { x: 28, z: 0, across: 'z' },
  { x: 0, z: 6.5, across: 'x', signal: 'c' },
  ...[15, 25, 33, 41, 50, 58, 66].map((z) => ({ x: 0, z, across: 'x' })),
];
// Светофор с датчиком машин на перекрёстке: пешеходам зелёный, пока к стоп-линии не подъедет машина; тогда — машинам,
// пока не проедут. stopE / stopW — стоп-линии для едущих на восток / запад, stopN — выезд с южной дороги
const LIGHTS = [
  { id: 'c', x: 0, stopE: -6.7, stopW: 6.7, stopN: 8.6 },
];
// у пешеходов приоритет: зелёный не короче walkMin, машинам — коротко, пока проезжают переход (машины 'out' никуда не спешат)
const LIGHT = { walkMin: 9, walkBlink: 1.5, allRed: 0.5, carMin: 2, carMax: 8, carYellow: 1.2, detect: 25 };

// ── мусорные контейнеры: выкинуть лишнее из рук ──
addPile('trash1', { zone: 'z1', x: -8.8, z: 35.6, w: 2, d: 2, mode: 'drop', trash: true, name: 'Мусор' });
addPile('trash3', { zone: 'z3', x: 48.2, z: 35.6, w: 2, d: 2, mode: 'drop', trash: true, name: 'Мусор' });

// ───────── Рабочие ─────────
const SAWS_IN = ['saw1_in', 'saw2_in', 'saw3_in', 'saw4_in'];
const SAWS_OUT = ['saw1_out', 'saw2_out', 'saw3_out', 'saw4_out'];
const BENCH_OUT = ['benchC_out', 'benchT_out', 'benchW_out'];
const ROUTES = {
  logs:     { name: 'Грузчик брёвен', from: ['yard', 'flogs'], to: ['saw1_in', 'saw2_in', 'saw3_in'] },
  // excess — забирать только излишки: когда выход станка заполнен больше чем на эту долю
  boards:   { name: 'Продавец досок', from: SAWS_OUT, to: ['counter'], excess: 0.5 },
  tractor:  { name: 'Тракторист', from: ['flogs'], to: SAWS_IN },
  jlogs:    { name: 'Грузчик брёвен', from: ['yard', 'flogs'], to: ['beamer1_in', 'beamer2_in'] },
  jboards:  { name: 'Грузчик досок', from: SAWS_OUT, to: ['press1_in', 'press2_in', 'benchC_in'] },
  jbeams:   { name: 'Грузчик бруса', from: ['beamer1_out', 'beamer2_out'], to: ['lathe1_in', 'lathe2_in', 'benchW_in'] },
  jlegs:    { name: 'Грузчик ножек', from: ['lathe1_out', 'lathe2_out'], to: ['benchC_in', 'benchT_in'] },
  jpanels:  { name: 'Грузчик щитов', from: ['press1_out', 'press2_out'], to: ['benchT_in', 'benchW_in'] },
  jfurn:    { name: 'Отгрузчик мебели', from: BENCH_OUT, to: ['opt'], excess: 0.5 },
  // когда есть упаковка, мебель без коробки кладовщик берёт с верстаков только излишками — остальное идёт в коробки
  stock:    { name: 'Кладовщик', from: BENCH_OUT.concat(['packer_out']), to: ['shelfC', 'shelfT', 'shelfW'], excess: 0.5, excessSrc: BENCH_OUT, excessWhen: 'packer' },
  pcard:    { name: 'Грузчик картона', from: ['cardM_out'], to: ['boxM_in'] },
  pbox:     { name: 'Грузчик коробок', from: ['boxM_out'], to: ['packer_in'] },
  pfurn:    { name: 'Подносчик мебели', from: BENCH_OUT, to: ['packer_in'] },
  pboxed:   { name: 'Развозчик коробок', from: ['packer_out'], to: ['shelfC', 'shelfT', 'shelfW', 'pwh'] },
  port:     { name: 'Портовый грузчик', from: ['packer_out'], to: ['pwh'] },
};
const ROLE_NAMES = { lumberjack: 'Вальщик', forester: 'Лесник', cashier: 'Кассир', collector: 'Инкассатор', builder: 'Строитель' };

// ───────── Площадки открытия ─────────
// station — строит станок; worker — нанимает; feature — включает механику; plots — расширяет делянку
// req — какие площадки должны быть открыты раньше
const PADS = [
  // участки: зона открывается этажом небоскрёба И покупкой участка у входа
  { id: 'p_gate_z2', zone: 'c', x: -48, z: 24,   cost: 2000,  gate: 'z2', minFloor: 2 },
  { id: 'p_gate_z3', zone: 'c', x: 3.8, z: 21,   cost: 6000,  gate: 'z3', minFloor: 4 },
  { id: 'p_gate_z4', zone: 'c', x: 28,  z: 41.6, cost: 25000, gate: 'z4', minFloor: 7 },
  { id: 'p_gate_z5', zone: 'c', x: -26, z: 41.6, cost: 100000, gate: 'z5', minFloor: 10 },
  { id: 'p_gate_z6', zone: 'c', x: 53,  z: 28,   cost: 1.2e6, gate: 'z6', minFloor: 13 },
  // z1
  { id: 'p_wlog1',  zone: 'z1', x: -40, z: 19,  cost: 120,    worker: { route: 'logs' } },
  { id: 'p_saw2',   zone: 'z1', station: 'saw2', cost: 280 },
  { id: 'p_wbrd1',  zone: 'z1', x: -17, z: 29,  cost: 450,    worker: { route: 'boards' }, req: ['p_wlog1'] },
  { id: 'p_saw3',   zone: 'z1', station: 'saw3', cost: 1400,  req: ['p_saw2'] },
  { id: 'p_wlog2',  zone: 'z1', x: -40, z: 25,  cost: 2400,   worker: { route: 'logs' }, req: ['p_saw3', 'p_wlog1'] },
  { id: 'p_wbrd2',  zone: 'z1', x: -17, z: 34,  cost: 3600,   worker: { route: 'boards' }, req: ['p_saw3', 'p_wbrd1'] },
  // центр
  { id: 'p_build1', zone: 'c', x: -9, z: -12,   cost: 9000,   worker: { role: 'builder' }, req: ['z3'] },
  { id: 'p_build2', zone: 'c', x: 9,  z: -12,   cost: 60000,  worker: { role: 'builder' }, req: ['p_build1', 'z4'] },
  { id: 'p_build3', zone: 'c', x: -13, z: -16,  cost: 400000, worker: { role: 'builder' }, req: ['p_build2', 'z5'] },
  { id: 'p_build4', zone: 'c', x: 13, z: -16,   cost: 2.5e6,  worker: { role: 'builder' }, req: ['p_build3', 'z6'] },
  // z2
  { id: 'p_lumber1',   zone: 'z2', x: -54, z: 36, cost: 1500,  worker: { role: 'lumberjack' } },
  { id: 'p_forester1', zone: 'z2', x: -54, z: 24, cost: 1800,  worker: { role: 'forester' } },
  { id: 'p_tractor1',  zone: 'z2', x: -58, z: 8,  cost: 2600,  worker: { route: 'tractor' }, req: ['p_lumber1'] },
  { id: 'p_saw4',      zone: 'z2', station: 'saw4', cost: 4200, req: ['p_lumber1'] },
  { id: 'p_plots2',    zone: 'z2', x: -68, z: 40, cost: 5000,  plots: 1, req: ['p_forester1'] },
  { id: 'p_lumber2',   zone: 'z2', x: -54, z: 41, cost: 8000,  worker: { role: 'lumberjack' }, req: ['p_plots2'] },
  { id: 'p_forester2', zone: 'z2', x: -54, z: 19, cost: 8000,  worker: { role: 'forester' }, req: ['p_plots2'] },
  { id: 'p_plots3',    zone: 'z2', x: -68, z: 24, cost: 16000, plots: 2, req: ['p_lumber2'] },
  { id: 'p_tractor2',  zone: 'z2', x: -54, z: 8,  cost: 20000, worker: { route: 'tractor' }, req: ['p_tractor1', 'p_plots3'] },
  { id: 'p_lumber3',   zone: 'z2', x: -54, z: 14, cost: 30000, worker: { role: 'lumberjack' }, req: ['p_plots3'] },
  // z3
  { id: 'p_beamer1', zone: 'z3', station: 'beamer1', cost: 2000 },
  { id: 'p_opt',     zone: 'z3', x: 47.8, z: 12.4, cost: 1000, feature: 'opt', w: 2.4, d: 10.4 },
  { id: 'p_lathe1',  zone: 'z3', station: 'lathe1', cost: 3000, req: ['p_beamer1'] },
  { id: 'p_benchC',  zone: 'z3', station: 'benchC', cost: 4000, req: ['p_lathe1'] },
  { id: 'p_press1',  zone: 'z3', station: 'press1', cost: 5000, req: ['p_beamer1'] },
  { id: 'p_benchT',  zone: 'z3', station: 'benchT', cost: 8000, req: ['p_press1', 'p_benchC'] },
  { id: 'p_wj_jlogs',   zone: 'z3', x: 9,  z: 36.4, cost: 6000,  worker: { route: 'jlogs' }, req: ['p_beamer1'] },
  { id: 'p_wj_jboards', zone: 'z3', x: 15, z: 36.4, cost: 7000,  worker: { route: 'jboards' }, req: ['p_press1'] },
  { id: 'p_wj_jbeams',  zone: 'z3', x: 21, z: 36.4, cost: 9000,  worker: { route: 'jbeams' }, req: ['p_lathe1'] },
  { id: 'p_wj_jlegs',   zone: 'z3', x: 27, z: 36.4, cost: 10000, worker: { route: 'jlegs' }, req: ['p_benchC'] },
  { id: 'p_wj_jpanels', zone: 'z3', x: 33, z: 36.4, cost: 14000, worker: { route: 'jpanels' }, req: ['p_benchT'] },
  { id: 'p_wj_jfurn',   zone: 'z3', x: 39, z: 36.4, cost: 16000, worker: { route: 'jfurn' }, req: ['p_benchC', 'p_opt'] },
  { id: 'p_beamer2', zone: 'z3', station: 'beamer2', cost: 30000, req: ['p_wj_jlogs'] },
  { id: 'p_wj_jlogs2',   zone: 'z1', x: -40, z: 31, cost: 120000, worker: { route: 'jlogs' }, req: ['z5', 'p_wj_jlogs'] },
  { id: 'p_wj_jlogs3',   zone: 'z1', x: -40, z: 36, cost: 2e6,    worker: { route: 'jlogs' }, req: ['z6', 'p_wj_jlogs2'] },
  { id: 'p_wj_jboards3', zone: 'z1', x: -17, z: 24, cost: 2.5e6,  worker: { route: 'jboards' }, req: ['z6', 'p_wj_jboards2'] },
  { id: 'p_wj_jboards2', zone: 'z3', x: 47.8, z: 12.5, cost: 150000, worker: { route: 'jboards' }, req: ['z5', 'p_wj_jboards'] },
  { id: 'p_wj_jbeams2',  zone: 'z3', x: 47.8, z: 22.5, cost: 170000, worker: { route: 'jbeams' }, req: ['z5', 'p_wj_jbeams'] },
  { id: 'p_wj_jlegs2',   zone: 'z3', x: 47.8, z: 26.5, cost: 190000, worker: { route: 'jlegs' }, req: ['z5', 'p_wj_jlegs'] },
  { id: 'p_wj_jpanels2', zone: 'z3', x: 47.8, z: 30.5, cost: 210000, worker: { route: 'jpanels' }, req: ['z5', 'p_wj_jpanels'] },
  { id: 'p_lathe2',  zone: 'z3', station: 'lathe2', cost: 36000, req: ['p_beamer2'] },
  { id: 'p_press2',  zone: 'z3', station: 'press2', cost: 40000, req: ['p_benchT'] },
  { id: 'p_benchW',  zone: 'z3', station: 'benchW', cost: 20000, req: ['p_benchT'] },
  // z4
  { id: 'p_shelfC',    zone: 'z4', x: 16, z: 52.6, w: 4.4, d: 4.8, cost: 25000, feature: 'shelf' },
  { id: 'p_shelfT',    zone: 'z4', x: 28, z: 52.6, w: 4.4, d: 4.8, cost: 35000, feature: 'shelf', req: ['p_shelfC'] },
  { id: 'p_shelfW',    zone: 'z4', x: 40, z: 52.6, w: 4.4, d: 4.8, cost: 50000, feature: 'shelf', req: ['p_shelfT'] },
  { id: 'p_cashier',   zone: 'z4', x: 22, z: 62, cost: 30000,  worker: { role: 'cashier' }, req: ['p_shelfC'] },
  { id: 'p_stock1',    zone: 'z4', x: 10, z: 60, cost: 40000,  worker: { route: 'stock' }, req: ['p_shelfC'] },
  { id: 'p_stock2',    zone: 'z4', x: 10, z: 66, cost: 120000, worker: { route: 'stock' }, req: ['p_stock1', 'p_shelfW'] },
  { id: 'p_collector', zone: 'z4', x: 44, z: 66, cost: 150000, worker: { role: 'collector' }, req: ['p_cashier'] },
  // z5
  { id: 'p_pneumo',  zone: 'z5', x: -41, z: 58, cost: 40000, feature: 'pneumo', req: ['p_cardM'] },
  { id: 'p_cardM',   zone: 'z5', station: 'cardM', cost: 50000 },
  { id: 'p_boxM',    zone: 'z5', station: 'boxM', cost: 60000, req: ['p_cardM'] },
  { id: 'p_packer',  zone: 'z5', station: 'packer', cost: 80000, req: ['p_boxM'] },
  { id: 'p_wp_pcard',  zone: 'z5', x: -10, z: 48, cost: 60000, worker: { route: 'pcard' }, req: ['p_boxM'] },
  { id: 'p_wp_pbox',   zone: 'z5', x: -10, z: 53, cost: 70000, worker: { route: 'pbox' }, req: ['p_packer'] },
  { id: 'p_wp_pfurn',  zone: 'z5', x: -10, z: 58, cost: 90000, worker: { route: 'pfurn' }, req: ['p_packer'] },
  { id: 'p_wp_pboxed', zone: 'z5', x: -10, z: 63, cost: 120000, worker: { route: 'pboxed' }, req: ['p_packer'] },
  { id: 'p_wp_pfurn2', zone: 'z5', x: -10, z: 68, cost: 400000, worker: { route: 'pfurn' }, req: ['p_wp_pfurn', 'p_wp_pboxed'] },
  // z6
  { id: 'p_dock',   zone: 'z6', x: 76, z: 29, cost: 600000, feature: 'dock' },
  { id: 'p_crane',  zone: 'z6', x: 71, z: 22, w: 14, d: 5, cost: 1.2e6, feature: 'crane', req: ['p_dock'] },
  { id: 'p_wport1', zone: 'z6', x: 62, z: 42, cost: 1.5e6, worker: { route: 'port' }, req: ['p_crane'] },
  { id: 'p_wport2', zone: 'z6', x: 68, z: 42, cost: 3e6,   worker: { route: 'port' }, req: ['p_wport1'] },
  { id: 'p_wport3', zone: 'z6', x: 74, z: 42, cost: 6e6,   worker: { route: 'port' }, req: ['p_wport2'] },
];
const PAD_BY_ID = {};
for (const p of PADS) {
  PAD_BY_ID[p.id] = p;
  if (p.station) {
    const st = STATIONS[p.station];
    p.x = st.x; p.z = st.z; p.w = st.w + 0.4; p.d = st.d + 0.4;
  }
  p.w = p.w || 2.4; p.d = p.d || 2.4;
  p.req = p.req || [];
}

// Название площадки для подписи
function padTitle(p) {
  if (p.station) return STATIONS[p.station].name;
  if (p.worker) return p.worker.route ? ROUTES[p.worker.route].name : ROLE_NAMES[p.worker.role];
  if (p.plots) return 'Расширить делянку';
  if (p.gate) return 'Участок: ' + ZONE_BY_ID[p.gate].name;
  return {
    opt: 'Оптовый склад', shelf: 'Витрина', pneumo: 'Пневмопровод для опилок',
    dock: 'Причал', crane: 'Кран и склад порта',
  }[p.feature] || p.id;
}

// ───────── Улучшения ─────────
// v(lvl) — значение параметра; cost(lvl) — цена перехода на lvl+1
function geo(base, k) { return (l) => Math.round(base * Math.pow(k, l)); }
const UPGRADES = [
  { id: 'u_cap',    zone: 'z1', name: 'Руки: вместимость',   max: 12, cost: geo(30, 1.62),   v: (l) => 6 + 2 * l, fmt: (v) => v + ' шт.' },
  { id: 'u_speed',  zone: 'z1', name: 'Бег: скорость',        max: 8,  cost: geo(45, 1.8),    v: (l) => 5 + 0.4 * l, fmt: (v) => v.toFixed(1) + ' м/с' },
  { id: 'u_saw',    zone: 'z1', name: 'Пилорамы: скорость',   max: 10, cost: geo(60, 1.62),   v: (l) => Math.pow(0.87, l), fmt: (v) => (3.4 * v).toFixed(1) + ' с' },
  { id: 'u_trFreq', zone: 'z1', name: 'Лесовозы: чаще',       max: 8,  cost: geo(70, 1.7),    v: (l) => 15 * Math.pow(0.86, l), fmt: (v) => 'раз в ' + v.toFixed(1) + ' с' },
  { id: 'u_trLoad', zone: 'z1', name: 'Лесовозы: больше брёвен', max: 8, cost: geo(90, 1.7), v: (l) => 6 + 2 * l, fmt: (v) => v + ' шт.' },
  { id: 'u_yard',   zone: 'z1', name: 'Склад брёвен: больше', max: 5,  cost: geo(150, 1.9),   v: (l) => 30 + 15 * l, fmt: (v) => v + ' шт.' },
  { id: 'u_bPrice', zone: 'z1', name: 'Доски: цена',          max: 8,  cost: geo(120, 1.85),  v: (l) => Math.pow(1.2, l), fmt: (v) => '×' + v.toFixed(1) },
  { id: 'u_cust1',  zone: 'z1', name: 'Покупатели досок: чаще', max: 8, cost: geo(80, 1.7),   v: (l) => 3.2 * Math.pow(0.85, l), fmt: (v) => 'раз в ' + v.toFixed(1) + ' с' },
  { id: 'u_wSpeed', zone: 'z1', name: 'Рабочие: скорость',    max: 10, cost: geo(400, 1.75),  v: (l) => 3 * (1 + 0.1 * l), fmt: (v) => v.toFixed(1) + ' м/с' },
  { id: 'u_wCap',   zone: 'z1', name: 'Рабочие: вместимость', max: 10, cost: geo(400, 1.75),  v: (l) => 4 + 2 * l, fmt: (v) => v + ' шт.' },
  { id: 'u_grow',   zone: 'z2', name: 'Лес: растёт быстрее',  max: 8,  cost: geo(1200, 1.7),  v: (l) => 40 * Math.pow(0.85, l), fmt: (v) => v.toFixed(0) + ' с' },
  { id: 'u_chop',   zone: 'z2', name: 'Рубка: быстрее',       max: 6,  cost: geo(1500, 1.8),  v: (l) => 1.6 * Math.pow(0.85, l), fmt: (v) => v.toFixed(1) + ' с' },
  { id: 'u_join',   zone: 'z3', name: 'Станки столярки: скорость', max: 12, cost: geo(3000, 1.6), v: (l) => Math.pow(0.87, l), fmt: (v) => '×' + (1 / v).toFixed(1) },
  { id: 'u_fPrice', zone: 'z3', name: 'Мебель: цена',         max: 12, cost: geo(5000, 1.75), v: (l) => Math.pow(1.2, l), fmt: (v) => '×' + v.toFixed(1) },
  { id: 'u_optFreq', zone: 'z3', name: 'Оптовик: чаще',       max: 6,  cost: geo(5000, 1.8),  v: (l) => 30 * Math.pow(0.85, l), fmt: (v) => 'раз в ' + v.toFixed(0) + ' с' },
  { id: 'u_cust4',  zone: 'z4', name: 'Покупатели магазина: чаще', max: 10, cost: geo(30000, 1.6), v: (l) => 4 * Math.pow(0.85, l), fmt: (v) => 'раз в ' + v.toFixed(1) + ' с' },
  { id: 'u_service', zone: 'z4', name: 'Касса: быстрее',      max: 5,  cost: geo(60000, 1.8), v: (l) => 1.2 * Math.pow(0.8, l), fmt: (v) => v.toFixed(2) + ' с' },
  { id: 'u_shelf',  zone: 'z4', name: 'Витрины: больше',      max: 5,  cost: geo(70000, 1.8), v: (l) => 10 + 6 * l, fmt: (v) => v + ' шт.' },
  { id: 'u_paper',  zone: 'z5', name: 'Бумажные станки: скорость', max: 8, cost: geo(50000, 1.6), v: (l) => Math.pow(0.86, l), fmt: (v) => '×' + (1 / v).toFixed(1) },
  { id: 'u_benchOut', zone: 'z5', name: 'Верстаки: двойная сборка', max: 2, cost: geo(200000, 6), v: (l) => 1 + l, fmt: (v) => '×' + v + ' за раз' },
  { id: 'u_boxMul', zone: 'z5', name: 'Упаковка: наценка',    max: 5,  cost: geo(80000, 1.8), v: (l) => 2 + 0.25 * l, fmt: (v) => '×' + v.toFixed(2) },
  { id: 'u_pneumo', zone: 'z5', name: 'Пневмопровод: мощнее', max: 5,  cost: geo(50000, 1.8), v: (l) => 1.5 * (1 + 0.5 * l), fmt: (v) => v.toFixed(1) + ' меш/с' },
  { id: 'u_wSpeed2', zone: 'z6', name: 'Рабочие: электрокары', max: 5, cost: geo(3e6, 2.2), v: (l) => 1 + 0.15 * l, fmt: (v) => '×' + v.toFixed(2) + ' к скорости' },
  { id: 'u_wCap2',  zone: 'z6', name: 'Рабочие: тележки больше', max: 5, cost: geo(3e6, 2.2), v: (l) => 4 * l, fmt: (v) => '+' + v + ' шт.' },
  { id: 'u_export', zone: 'z6', name: 'Экспорт: награда',     max: 10, cost: geo(1.5e6, 1.7), v: (l) => Math.pow(1.25, l), fmt: (v) => '×' + v.toFixed(1) },
  { id: 'u_crane',  zone: 'z6', name: 'Кран: быстрее',        max: 6,  cost: geo(1e6, 1.8),   v: (l) => 1.5 * (1 + 0.4 * l), fmt: (v) => v.toFixed(1) + ' шт/с' },
  { id: 'u_shipT',  zone: 'z6', name: 'Корабль ждёт дольше',  max: 4,  cost: geo(1.2e6, 2),   v: (l) => 240 + 60 * l, fmt: (v) => fmtTime(v) },
];
const UPG_BY_ID = {};
for (const u of UPGRADES) UPG_BY_ID[u.id] = u;

// ───────── Небоскрёб ─────────
// need — что сдать на стройку; unlock — какая зона открывается
const FLOORS = [
  { need: { board: 20 } },
  { need: { board: 50 }, unlock: 'z2' },
  { need: { board: 100 } },
  { need: { board: 160 }, unlock: 'z3' },
  { need: { board: 150, beam: 40 } },
  { need: { beam: 90, panel: 50 } },
  { need: { beam: 120, panel: 90, chair: 25 }, unlock: 'z4' },
  { need: { panel: 150, chair: 50, table: 20 } },
  { need: { beam: 220, table: 50, chair: 70 } },
  { need: { panel: 260, table: 80, wardrobe: 20 }, unlock: 'z5' },
  { need: { chairB: 40, beam: 250, panel: 180 } },
  { need: { tableB: 45, wardrobe: 30, chairB: 55 } },
  { need: { wardrobeB: 25, tableB: 60, beam: 300 }, unlock: 'z6' },
  { need: { chairB: 100, tableB: 70, panel: 300 } },
  { need: { wardrobeB: 40, beam: 400, chairB: 120 } },
  { need: { tableB: 140, wardrobeB: 60, panel: 450 } },
  { need: { chairB: 150, tableB: 100, wardrobeB: 50 } },
  { need: { beam: 450, panel: 400, wardrobeB: 70 } },
  { need: { chairB: 200, tableB: 140, wardrobeB: 90 } },
  { need: { beam: 600, panel: 500, chairB: 220, tableB: 160, wardrobeB: 110 } },
];
const FLOOR_BONUS = 1.1;    // ×1.1 к ценам продажи за каждый построенный этаж

// ───────── Идеи и баги (кнопка «💬») ─────────
// form — Google-форма владельца: отзывы уходят прямо из игры, без всяких аккаунтов; пока null — кнопки нет.
// Строку для неё печатает node tools/formfields.js <ссылка на форму>:
//   { url: 'https://docs.google.com/forms/d/e/<id>/formResponse', kind: 'entry.…', text: 'entry.…', name: 'entry.…', tech: 'entry.…' }
const FEEDBACK = {
  form: {
    url: 'https://docs.google.com/forms/d/e/1FAIpQLScsmbrLQfP5fg0rVasMgWZO5-b-ZywDIuRKFoYvmmtHoKGYQQ/formResponse',
    kind: 'entry.650160950', text: 'entry.956544550', name: 'entry.1454339526', tech: 'entry.1837383089',
  },
};

// ───────── Прочие константы ─────────
const TUNE = {
  playerR: 0.45,
  xferPlayer: 0.06,     // секунд на один предмет
  xferWorker: 0.11,
  padFill: 1.3,         // за сколько секунд заливаются деньги в площадку
  chopRadius: 1.3,
  plantTime: 0.5,
  truckSpeed: 14,
  truckAcc: 5,          // разгон и торможение машин, м/с²; маршруты — TRUCK_PATHS в sim.js
  truckBrake: 10,
  logTruckStopX: -40,
  optTruckStopX: 47.8,
  looseLife: 60,        // сколько лежит на земле то, что выронил игрок, когда его сбила машина
  optTruckLoad: 40,
  optShare: 0.7,        // оптовик платит 70% розничной цены
  c1Max: 10,
  c4Max: 14,
  c4Patience: 18,
  shipAway: 25,
  shipSail: 7,
  exportMul: 3,
  offlineCap: 3600,      // офлайн-доход — не больше часа работы цехов
  custSpeed: 2.6,
};
