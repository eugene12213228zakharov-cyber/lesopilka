'use strict';
// Запуск: сохранение, офлайн-доход, игровой цикл.

// Тестовая сборка — по адресу (…/lesopilka-test/ или localhost): своё сохранение и админ-панель F2
const TEST_MODE = !!window.LESO_TEST;
const SAVE_KEY = TEST_MODE ? 'lesopilka_test_save_v1' : 'lesopilka_save_v1';
const STEP = 1 / 60;

function readSave() {
  try { const t = localStorage.getItem(SAVE_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; }
}
function writeSave(game) {
  if (window.__noSave) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.toSave())); } catch (e) { /* хранилище недоступно — играем без сохранения */ }
}

// заменить сохранение (загрузка из кода / начать заново) и перезапустить страницу
window.lesopilkaReplace = (data) => {
  window.__noSave = true;
  try { if (data) localStorage.setItem(SAVE_KEY, JSON.stringify(data)); else localStorage.removeItem(SAVE_KEY); } catch (e) { /* ничего */ }
  location.reload();
};

(async function boot() {
  // модели Kenney грузим до старта; если что-то не загрузилось — играем на своих моделях из models.js
  window.LIB = new ModelLib();
  window.LIB_OK = false;
  // свои модели (craft.js) строятся кодом и загрузки не требуют; ?nomodels выключает и их, и Kenney
  window.OWN_OK = !new URLSearchParams(location.search).has('nomodels');
  if (!window.OWN_OK) { /* ?nomodels — сравнить со старыми моделями */ }
  else try {
    const keys = neededModels();
    const failed = await LIB.loadAll(keys, (d, n) => { const l = $('loading'); if (l) l.textContent = `🪵 Лесопилка загружается… модели ${d} из ${n}`; });
    window.LIB_OK = failed.length === 0;
    if (failed.length) console.warn('Не загрузились модели, беру свои:', failed.join(', '));
  } catch (e) { console.warn('Модели не загрузились, беру свои:', e); }
  const save = readSave();
  const game = new Game(save);
  const sfx = new Sfx();
  const view = new View($('c'), game, $('labels'));
  const ui = new UI(game, sfx);
  ui.saveNow = () => writeSave(game);   // казино сохраняет сразу после ставки — перезагрузкой проигрыш не отменить
  view.ui = ui;   // зал казино берёт из интерфейса выбранного в гонке лесоруба
  ui.view = view;   // список рабочих подсвечивает их в мире и показывает камерой
  const input = new Input($('c'), game, view, ui, sfx);
  window.__game = game;
  window.__view = view;
  window.__ui = ui;
  window.__input = input;
  $('loading').remove();
  if (TEST_MODE) document.title = 'Лесопилка — ТЕСТ';
  // отладка: ?bot=1 — играет бот, ?speed=8 — ускорение времени
  const qs = new URLSearchParams(location.search);
  const bot = qs.get('bot') ? new Bot(game) : null;
  let speed = clamp(+qs.get('speed') || 1, 1, 50);
  if (bot || speed > 1) window.__noSave = true;

  // перемотка времени, пока игры не было на экране
  const catchUp = (sec, force) => {
    if (sec < 30) return;
    const floor0 = game.s.floor;
    const r = game.fastForward(Math.min(sec, TUNE.offlineCap));
    r.capped = sec > TUNE.offlineCap;
    r.floors = game.s.floor - floor0;
    game.events.length = 0;
    if (force || r.money >= 1 || r.floors > 0) ui.showOffline(r);
  };
  const stale = save && save.v !== SAVE_VERSION;   // сохранение прошлой версии (до начала с леса): игра начинается заново
  if (stale && !bot) ui.showReset();
  else if (save && save.savedAt) catchUp((Date.now() - save.savedAt) / 1000);
  else if (!save && !bot) ui.showWelcome();

  if (TEST_MODE) {
    window.__admin = new Admin(game, view, ui, {
      getSpeed: () => speed,
      setSpeed: (v) => { speed = clamp(v, 1, 50); },
      catchUp,
    });
  }

  let last = performance.now(), acc = 0, saveT = 0, hiddenAt = 0;
  const loop = (now) => {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    if (!bot) {
      input.update();
      if (game.pl.room && view.room) view.room.rotateInput(game.input);   // в зале «вверх» — от камеры за спиной
    }
    acc += dt * speed;
    let n = 0;
    while (acc >= STEP && n < 20 * speed) { if (bot) bot.step(STEP); game.step(STEP); acc -= STEP; n++; }
    if (n >= 20 * speed) acc = 0;
    for (const e of game.events) { view.onEvent(e); ui.onEvent(e); sfx.onEvent(e, game); }
    game.events.length = 0;
    view.frame(dt);
    ui.update(dt);
    saveT += dt;
    if (saveT > 10) { saveT = 0; writeSave(game); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); writeSave(game); }
    else if (hiddenAt) {
      const sec = (Date.now() - hiddenAt) / 1000;
      hiddenAt = 0;
      last = performance.now();
      catchUp(sec);
    }
  });
  window.addEventListener('pagehide', () => writeSave(game));
  window.addEventListener('beforeunload', () => writeSave(game));
  window.addEventListener('resize', () => view.resize());
})();
