'use strict';
// Админ-панель тестовой версии (F2): деньги, этажи, зоны, скорость, телепорт.
// Включается только в тестовой сборке (адрес …/lesopilka-test/ или localhost), в общей версии её нет.

class Admin {
  constructor(game, view, ui, hooks) {
    this.g = game; this.view = view; this.ui = ui; this.h = hooks;
    this.el = document.createElement('div');
    this.el.id = 'admin';
    this.el.className = 'hidden';
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) this.act(b.dataset.a, b.dataset.v);
    });
    const btn = document.createElement('button');
    btn.id = 'adminBtn';
    btn.textContent = '🛠 ТЕСТ · F2';
    btn.onclick = () => this.toggle();
    document.getElementById('hud').appendChild(btn);
    this.fps = document.createElement('div');
    this.fps.id = 'fps';
    this.fps.style.display = 'none';
    document.body.appendChild(this.fps);
    window.addEventListener('keydown', (e) => { if (e.code === 'F2') { e.preventDefault(); this.toggle(); } });
    this.frames = 0;
    this.fpsT = performance.now();
    const tick = () => {
      this.frames++;
      const now = performance.now();
      if (now - this.fpsT >= 1000) {
        this.fps.textContent = `${this.frames} кадров/с · ×${this.h.getSpeed()}`;
        this.frames = 0; this.fpsT = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this.render();
  }

  toggle() { this.el.classList.toggle('hidden'); if (!this.el.classList.contains('hidden')) this.render(); }

  render() {
    const g = this.g, sp = this.h.getSpeed();
    const zones = ZONES.map((z) => `<button data-a="zone" data-v="${z.id}"${g.open[z.id] ? ' class="on"' : ''}>${z.name}</button>`).join('');
    const tps = [['c', 'Стройка']].concat(ZONES.map((z) => [z.id, z.name]))
      .map(([id, n]) => `<button data-a="tp" data-v="${id}">${n}</button>`).join('');
    this.el.innerHTML = `
      <div class="ah"><b>🛠 Админка теста</b><button data-a="close">✕</button></div>
      <div class="as">Деньги</div>
      <div class="ag"><button data-a="money" data-v="1000">+$1K</button><button data-a="money" data-v="100000">+$100K</button>
        <button data-a="money" data-v="10000000">+$10M</button><button data-a="money" data-v="1000000000">+$1B</button></div>
      <div class="as">Небоскрёб — сейчас ${g.s.floor}/${FLOORS.length}</div>
      <div class="ag"><button data-a="floor">Достроить этаж</button><button data-a="toFloor" data-v="${Math.min(FLOORS.length, g.s.floor + 5)}">+5 этажей</button>
        <button data-a="toFloor" data-v="${FLOORS.length}">Все этажи</button></div>
      <div class="as">Открыть зону (со всеми этажами до неё)</div>
      <div class="ag">${zones}</div>
      <div class="as">Покупки</div>
      <div class="ag"><button data-a="buyAll">Купить все площадки</button><button data-a="maxUpg">Улучшения на максимум</button></div>
      <div class="as">Время — сейчас ×${sp}</div>
      <div class="ag">${[1, 3, 10, 30].map((v) => `<button data-a="speed" data-v="${v}"${sp === v ? ' class="on"' : ''}>×${v}</button>`).join('')}
        <button data-a="offline">Отсутствие 1 ч</button></div>
      <div class="as">Телепорт</div>
      <div class="ag">${tps}</div>
      <div class="as">Прочее</div>
      <div class="ag"><button data-a="fps">Кадры/с</button><button data-a="reset" class="bad">Сбросить тест</button></div>
      <div class="an">Сохранение теста отдельное — общую игру не трогает.</div>`;
  }

  completeFloor() {
    const g = this.g, f = FLOORS[g.s.floor];
    if (!f) return false;
    for (const it in f.need) g.s.floorGot[it] = f.need[it];
    g.checkFloor();
    return true;
  }

  openZone(zid) {
    const g = this.g, z = ZONE_BY_ID[zid];
    while (g.s.floor < z.floor && this.completeFloor());
    for (const zz of ZONES) {
      if (zz.id === 'z1' || zz.floor > z.floor) continue;
      const gate = PAD_BY_ID['p_gate_' + zz.id];
      if (gate && !g.s.padDone[gate.id]) g.completePad(gate);
    }
  }

  teleport(id) {
    const g = this.g;
    let x = 0, z = -6;
    if (id !== 'c') {
      const r = ZONE_BY_ID[id].rect;
      if (!g.open[id]) this.openZone(id);
      x = (r.x0 + r.x1) / 2; z = (r.z0 + r.z1) / 2;
    }
    g.pl.x = x; g.pl.z = z;
    if (g.hits(x, z, TUNE.playerR)) g.unstick(g.pl);
    const o = this.view.agentObjs.get(g.pl);
    if (o) o.g.position.set(g.pl.x, 0, g.pl.z);
    this.view.camTarget.set(g.pl.x, 0, g.pl.z);
  }

  act(a, v) {
    const g = this.g;
    switch (a) {
      case 'close': this.toggle(); return;
      case 'money': g.addMoney(+v); break;
      case 'floor': this.completeFloor(); break;
      case 'toFloor': while (g.s.floor < +v && this.completeFloor()); break;
      case 'zone': this.openZone(v); break;
      case 'buyAll': {
        let guard = 0, any = true;
        while (any && guard++ < 60) {
          any = false;
          for (const p of PADS) if (!p.gate && g.padVisible(p)) { g.completePad(p); any = true; }
        }
        break;
      }
      case 'maxUpg': for (const u of UPGRADES) if (g.open[u.zone]) g.s.upg[u.id] = u.max; break;
      case 'speed': this.h.setSpeed(+v); break;
      case 'offline': this.h.catchUp(3600, true); break;
      case 'tp': this.teleport(v); break;
      case 'fps': this.fps.style.display = this.fps.style.display === 'none' ? '' : 'none'; break;
      case 'reset': window.lesopilkaReplace(null); return;
    }
    this.ui.toast('🛠 Готово');
    this.render();
  }
}
