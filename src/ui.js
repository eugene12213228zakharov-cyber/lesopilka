'use strict';
// Интерфейс поверх 3D: деньги, цель, панели, сообщения. Логику игры меняет только через методы Game.

const $ = (id) => document.getElementById(id);

class UI {
  constructor(game, audio) {
    this.g = game;
    this.audio = audio;
    this.panel = null;
    this.rows = null;
    this.rateLog = [];
    this.lastMoney = -1;
    this.tick = 0;
    $('bUpg').onclick = () => this.toggle('upg');
    $('bTower').onclick = () => this.toggle('tower');
    $('bWork').onclick = () => this.toggle('work');
    $('bMenu').onclick = () => this.toggle('menu');
    if (FEEDBACK.form) $('bFb').onclick = () => this.feedback();
    else $('bFb').style.display = 'none';   // форма не подключена — отзывы слать некуда, кнопку не показываем
    $('pClose').onclick = () => this.close();
    $('pBody').addEventListener('click', (e) => this.onPanelClick(e));
    // список рабочих: навёл на строку — этот рабочий подсвечен в мире (кольцо и номер над головой)
    $('pBody').addEventListener('mouseover', (e) => {
      const row = e.target.closest('.wrow');
      const w = row && this.panel === 'work' ? this.g.workers[+row.dataset.row.slice(1)] : null;
      if (!this.view) return;
      if (w) { this.view.hl = w; this.view.hlT = 1e9; this.view.hover = true; }
      else if (this.view.hover) { this.view.hover = false; this.view.hlT = 0.6; }
    });
    $('pBody').addEventListener('mouseleave', () => { if (this.view && this.view.hover) { this.view.hover = false; this.view.hlT = 0.6; } });
    $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.dataset.close !== undefined) this.hideModal(); });
  }

  // ───────── сообщения ─────────
  toast(html, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.innerHTML = html;
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3800);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  }

  onEvent(e) {
    const g = this.g;
    if (e.t === 'built') {
      const p = PAD_BY_ID[e.pad];
      if (!p.gate) this.toast('✅ Открыто: <b>' + padTitle(p) + '</b>');
      if (this.panel) this.render();
    } else if (e.t === 'zone') {
      this.toast('🎉 Новая зона: <b>' + ZONE_BY_ID[e.id].name + '</b>', 'big');
      if (e.id === 'z1') this.toast('🚚 Брёвна на лесопилку везёт лесовоз — за деньги. Сколько за рейс — «Улучшения» → «Закупка брёвен»');
      if (this.panel) this.render();
    } else if (e.t === 'casino') {   // встал на ковёр у двери небоскрёба
      if ($('modal').classList.contains('hidden')) this.casinoModal();
    } else if (e.t === 'casinoPaid') {
      this.casinoRefresh();
    } else if (e.t === 'launch' && !g.s.tips.boat) {   // первая лодка — где деньги
      g.s.tips.boat = true;
      this.toast('⛵ Первая лодка сошла на воду! Деньги за неё — в кассе верфи', 'big');
    } else if (e.t === 'fell' && e.by === 'player' && !g.s.tips.fell) {   // первое срубленное дерево — объясняем про пень
      g.s.tips.fell = true;
      this.toast('🌲 На месте дерева остался пень — встань на него, и посадишь новое', 'big');
    } else if (e.t === 'tenantOffer') {   // окно «кто въедет?» — после облёта небоскрёба (3.2 с), не поверх него
      this.tenantAsked = false; this.tenantAt = performance.now() + 3300;
    } else if (e.t === 'tenant') {
      const T = TENANTS[e.id];
      this.toast(`${T.icon} На ${e.floor}-й этаж въехал жилец «${T.name}»: ${T.text}`, 'big');
      if (this.panel === 'tower') this.render();
    } else if (e.t === 'nologs') {
      const now = performance.now();   // не чаще раза в 20 с
      if (now - (this.noLogT || 0) > 20000) { this.noLogT = now; this.toast('🚚 Не хватило денег на брёвна — лесовоз уехал', 'bad'); }
    } else if (e.t === 'floor') {
      let txt = `🏢 Построен ${e.n}-й этаж! Цены ×${FLOOR_BONUS}`;
      const z = ZONES.find((zz) => zz.floor === e.n);
      if (z) txt += `<br>Можно купить участок: <b>${z.name}</b>`;
      if (e.n === CASINO.floor) txt += '<br>🎰 Открылось казино — вход у подножия небоскрёба';
      this.toast(txt, 'big');
      if (this.panel) this.render();
    } else if (e.t === 'ship') {
      if (e.st === 'docked') this.toast('🚢 В порт зашёл корабль — смотри заказ у причала');
      if (e.st === 'done') this.toast('🚢 Заказ выполнен: +' + fmtMoney(e.v) + ' в кассе порта', 'big');
      if (e.st === 'late') this.toast('🚢 Корабль ушёл, не дождавшись всего заказа' + (e.v ? ' — заплатил ' + fmtMoney(e.v) : ''));
    } else if (e.t === 'upg') {
      if (this.panel === 'upg') this.refresh();
    } else if (e.t === 'win') {
      this.showWin();
    } else if (e.t === 'hit') {
      this.toast(e.n ? `🚚 Тебя сбила машина — рассыпалось ${e.n} ${plural(e.n, 'предмет', 'предмета', 'предметов')}. Подбери, пока не растащили!`
        : '🚚 Осторожно, машина! Переходи на зелёный', 'bad');
    } else if (e.t === 'hitW') {
      // рабочий перебегал дорогу где попало; не чаще раза в 8 с, чтобы не завалить сообщениями
      const now = performance.now();
      if (now - (this.hitWT || 0) > 8000) {
        this.hitWT = now;
        const w = e.w, nm = w.route ? ROUTES[w.route].name : ROLE_NAMES[w.role];
        this.toast(`🚚 Сбили: ${nm} перебегал дорогу не по переходу` + (e.n ? ` — рассыпалось ${e.n} ${plural(e.n, 'предмет', 'предмета', 'предметов')}, можно подобрать` : ''), 'bad');
      }
    }
  }

  // ───────── каждый кадр ─────────
  update(dt) {
    const g = this.g, s = g.s;
    this.tick += dt;
    if (Math.floor(s.money) !== this.lastMoney) {
      $('moneyV').textContent = fmtMoney(s.money);
      if (s.money > this.lastMoney && this.lastMoney >= 0) { const m = $('money'); m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump'); }
      this.lastMoney = Math.floor(s.money);
    }
    // доход за последнюю минуту
    this.rateLog.push([s.t, s.stats.sold]);
    while (this.rateLog.length > 2 && s.t - this.rateLog[0][0] > 60) this.rateLog.shift();
    if (this.tick > 0.5) {
      this.tick = 0;
      const a = this.rateLog[0], b = this.rateLog[this.rateLog.length - 1];
      const span = Math.max(10, b[0] - a[0]);
      $('rate').textContent = '+' + fmtMoney(((b[1] - a[1]) / span) * 60) + '/мин';
      const fb = g.floorBonus();
      const pend = s.tenantPending.length;   // жилец не выбран — напоминаем на чипе этажа (клик — «Небоскрёб»)
      $('floorV').innerHTML = `Этаж <b>${s.floor}</b>/${FLOORS.length}` + (pend ? ' · 🏠 выбери жильца' : s.floor ? ` · цены ×${fb.toFixed(2)}` : '');
      $('floorChip').classList.toggle('hot', pend > 0);
      // этаж достроен или вернулся с невыбранным жильцом — окно выбора, когда другие окна закрыты
      if (pend && !this.tenantAsked && $('modal').classList.contains('hidden') && performance.now() > (this.tenantAt || 0)) this.tenantModal();
      this.casinoRefresh();   // окно казино: деньги в кармане
      const inCash = g.moneyInCash();
      $('cashHint').textContent = inCash >= 1 ? 'в кассах ещё ' + fmtMoney(inCash) : '';
      // сколько улучшений по карману — значок на кнопке
      let can = 0;
      for (const u of UPGRADES) { const l = s.upg[u.id] || 0; if (g.upgOpen(u) && l < u.max && u.cost(l) <= s.money) can++; }
      $('upgBadge').textContent = can || '';
      $('upgBadge').style.display = can ? '' : 'none';
      $('bUpg').classList.toggle('hot', can > 0);
      if (this.panel) this.refresh();
      this.shipCard();
    }
    const goal = g.goal;
    const gt = goal ? goal.text : '';
    if ($('goal').textContent !== gt) { $('goal').textContent = gt; $('goal').style.display = gt ? '' : 'none'; }
    // что в руках
    const st = g.pl.stack;
    let carry = '';
    if (st.length) {
      const cnt = {};
      for (const it of st) cnt[it] = (cnt[it] || 0) + 1;
      carry = Object.keys(cnt).map((k) => `${ITEMS[k].name} ×${cnt[k]}`).join(', ') + ` · ${st.length}/${g.capOf(g.pl)}`;
    }
    if ($('carry').textContent !== carry) { $('carry').textContent = carry; $('carry').style.display = carry ? '' : 'none'; }
  }

  // Корабль — карточка слева под этажом: сколько ещё ждёт, что везти и сколько уже на складе порта
  // (отзыв: «чтобы не бегать в порт, чтобы посмотреть, что нужно принести»)
  shipCard() {
    const g = this.g, sh = g.s.ship;
    let h = '';
    if (sh && sh.state === 'docked' && sh.need) {
      h = `<div class="st${sh.left < 45 ? ' warn' : ''}">🚢 Корабль ждёт <b>${fmtTime(sh.left)}</b></div>`;
      for (const it in sh.need) {
        const got = Math.min(sh.got[it] || 0, sh.need[it]), done = got >= sh.need[it];
        const wh = !done && g.pileSet.has('pwh') ? g.count('pwh', it) : 0;
        h += `<div class="row${done ? ' done' : ''}"><span>${ITEMS[it].name}</span><span>${got}/${sh.need[it]}${wh ? ` <i>на складе ${wh}</i>` : ''}</span></div>`;
      }
      h += `<div class="rw">Награда ${fmtMoney(sh.reward)}</div>`;
    } else if (sh && sh.state === 'away') h = `<div class="st">🚢 Корабль придёт через ${fmtTime(sh.t)}</div>`;
    else if (sh && sh.state === 'in') h = '<div class="st">🚢 Корабль заходит в порт</div>';
    else if (sh && sh.state === 'out') h = `<div class="st">🚢 ${sh.result === 'ok' ? 'Заказ выполнен' : 'Корабль ушёл'}</div>`;
    if (h !== this.shipHtml) { this.shipHtml = h; $('shipCard').innerHTML = h; $('shipCard').style.display = h ? '' : 'none'; }
  }

  // ───────── панели ─────────
  toggle(name) { if (this.panel === name) this.close(); else { this.panel = name; this.render(); $('panel').classList.remove('hidden'); } this.tags(); }
  close() { this.panel = null; $('panel').classList.add('hidden'); this.tags(); }
  // пока открыт список рабочих — над головами их номера
  tags() {
    const v = this.view;
    if (!v) return;
    v.showTags = this.panel === 'work';
    if (this.panel !== 'work' && v.hover) { v.hover = false; v.hlT = 0.6; }   // закрыли список с мышью на строке — подсветку гасим
  }

  render() {
    const g = this.g, s = g.s, body = $('pBody');
    const title = { upg: '⬆ Улучшения', tower: '🏢 Небоскрёб', work: '👷 Рабочие', menu: '⚙ Меню' }[this.panel];
    $('pTitle').textContent = title;
    let h = '';
    if (this.panel === 'upg') {
      for (const z of ZONES) {
        if (!g.open[z.id]) continue;
        const ups = UPGRADES.filter((u) => u.zone === z.id && g.upgOpen(u));
        if (!ups.length) continue;
        h += `<div class="sec">${z.name}</div>`;
        // лесопилка: заказ брёвен — сколько везти за рейс (выгруженное на склад оплачивается)
        if (z.id === 'z1') {
          h += '<div class="urow order"><div class="un"><div class="nm">🚚 Закупка брёвен</div><div class="vv" id="ordInfo"></div></div>' +
            '<button class="step" data-order="-1">−</button><b id="ordN"></b><button class="step" data-order="1">+</button></div>';
        }
        for (const u of ups) {
          h += `<div class="urow" data-row="${u.id}"><div class="un"><div class="nm">${u.name}</div><div class="lv"></div><div class="vv"></div></div>` +
            `<button class="buy" data-upg="${u.id}"></button></div>`;
        }
      }
    } else if (this.panel === 'tower') {
      const f = FLOORS[s.floor];
      // жильцы, которых ещё не выбрали (этаж достроили, пока окно было закрыто или игрока не было)
      for (const p of s.tenantPending) h += `<div class="sec">Этаж ${p.floor}: кто въедет?</div>` + this.tenantCards(p);
      h += '<button class="wide" data-act="towerShot">🔭 Посмотреть на небоскрёб</button>';
      h += `<div class="note">Каждый этаж — заказ на товары. Отнеси их на стройку у подножия небоскрёба (или найми строителей). ` +
        `За каждый этаж все цены продажи растут ×${FLOOR_BONUS}; сейчас <b>×${g.floorBonus().toFixed(2)}</b>. ` +
        `На этажи без новой зоны въезжают жильцы — каждый даёт свой бонус.</div>`;
      if (f) {
        h += `<div class="sec">Сейчас строится ${s.floor + 1}-й этаж</div>`;
        for (const it in f.need) {
          const got = Math.min(s.floorGot[it] || 0, f.need[it]), k = got / f.need[it];
          h += `<div class="need"><span>${ITEMS[it].name}</span><span>${fmtNum(got)} / ${fmtNum(f.need[it])}</span><div class="bar"><i style="width:${(k * 100).toFixed(1)}%"></i></div></div>`;
        }
        h += `<div class="note small">${this.hintFor(f)}</div>`;
      } else h += '<div class="sec">Небоскрёб построен! 🎉</div>';
      h += '<div class="sec">Этажи</div><div class="floors">';
      FLOORS.forEach((fl, i) => {
        const z = fl.unlock ? ZONE_BY_ID[fl.unlock].name : '';
        const st = i < s.floor ? 'done' : i === s.floor ? 'cur' : '';
        const T = TENANTS[s.tenants[i + 1]];   // этаж i+1: въехавший жилец
        const what = z ? `<span>→ ${z}</span>` : T ? `<span title="${T.name}: ${T.text}">${T.icon} ${T.name}</span>`
          : i + 1 === CASINO.floor ? '<span>🎰 Казино</span>' : TENANT_FLOORS.indexOf(i + 1) >= 0 ? '<span>🏠 жилец</span>' : '';
        h += `<div class="fl ${st}"><b>${i + 1}</b>${what}</div>`;
      });
      h += '</div>';
    } else if (this.panel === 'work') {
      h += `<label class="chk"><input type="checkbox" data-prio ${s.sitePriority !== false ? 'checked' : ''}> Стройка в приоритете — рабочие продаж не трогают то, что нужно этажу (заберут строители)</label>`;
      if (!g.workers.length) h += '<div class="note">Пока никого. Рабочих нанимают на площадках с человечком.</div>';
      else h += '<div class="note small">Номер из списка — над головой рабочего, каска — цвета цеха. Наведи на строку — рабочий подсветится, 📍 — камера к нему.</div>';
      // по цехам, в каждом — по порядку найма; номер — сквозной, как над головой
      const groups = ZONES.map((z) => ({ id: z.id, name: z.name, list: [] })).concat([{ id: 'c', name: 'Стройка', list: [] }]);
      g.workers.forEach((w, i) => {
        const pad = PAD_BY_ID[w.pad], zid = pad ? workerZone(pad) : 'c';
        (groups.find((gr) => gr.id === zid) || groups[groups.length - 1]).list.push(i);
      });
      for (const gr of groups) {
        if (!gr.list.length) continue;
        const col = '#' + helmetColor(gr.id).toString(16).padStart(6, '0');
        h += `<div class="sec"><i class="dot" style="background:${col}"></i>${gr.name} — ${gr.list.length}</div>`;
        for (const i of gr.list) {
          const w = g.workers[i], nm = w.route ? ROUTES[w.route].name : ROLE_NAMES[w.role];
          h += `<div class="wrow" data-row="w${i}"><span class="wn" style="border-color:${col}">${i + 1}</span><div class="un"><div class="nm">${nm}</div><div class="vv"></div></div>` +
            `<button class="show" data-show="${i}" title="Показать, где он">📍</button><button class="tog" data-w="${i}"></button></div>`;
        }
      }
    } else if (this.panel === 'menu') {
      const snd = this.audio.on;
      h += `<button class="wide" data-act="sound">${snd ? '🔊 Звук включён' : '🔇 Звук выключен'}</button>`;
      if (FEEDBACK.form) h += '<button class="wide" data-act="feedback">💬 Предложить идею или сообщить о баге</button>';
      h += '<div class="sec">Управление</div><div class="note">Зажми мышь и тяни — человечек бежит в ту сторону (как джойстик на телефоне). ' +
        'Или WASD / стрелки. Колёсико — приблизить. Встал на площадку — предметы и деньги перетекают сами.<br>' +
        'U — улучшения, B — небоскрёб, R — рабочие, M — звук, Esc — закрыть.</div>';
      h += `<div class="sec">Статистика</div><div class="note">В игре: ${fmtTime(s.playT)}. Заработано всего: ${fmtMoney(s.earned)}. Покупок: ${s.stats.buys}.` +
        `<br>Сбивали машиной: тебя — ${s.stats.hitMe || 0}, рабочих — ${s.stats.hitW || 0}.` +
        (g.casinoStats().n ? `<br>Казино: сыграно ${g.casinoStats().n}, поставлено ${fmtMoney(g.casinoStats().bet)}, выиграно ${fmtMoney(g.casinoStats().won)}.` : '') + '</div>';
      h += '<div class="sec">Сохранение</div><div class="note small">Игра сохраняется сама каждые 10 секунд в браузере. Если чистишь браузер или хочешь перенести на другой комп — сохрани код.</div>';
      h += '<button class="wide" data-act="export">📋 Скопировать код сохранения</button>';
      h += '<button class="wide" data-act="import">📥 Загрузить из кода</button>';
      h += '<button class="wide danger" data-act="reset">🗑 Начать заново</button>';
    }
    body.innerHTML = h;
    this.refresh();
  }

  // подсказка, откуда брать то, чего не хватает этажу
  hintFor(f) {
    const g = this.g, miss = [];
    for (const it in f.need) if ((g.s.floorGot[it] || 0) < f.need[it]) miss.push(it);
    if (!miss.length) return '';
    const it = miss[0];
    const st = Object.values(STATIONS).find((x) => x.recipes.some((r) => r.out[it]));
    if (!st) return `${ITEMS[it].name} — со склада брёвен.`;
    const r = st.recipes.find((rr) => rr.out[it]);
    const ins = Object.keys(r.in).map((k) => ITEMS[k].name.toLowerCase()).join(' + ');
    const built = g.stationOn(st.id) || Object.values(STATIONS).some((x) => x.type === st.type && x.recipes.some((rr) => rr.out[it]) && g.stationOn(x.id));
    return `${ITEMS[it].name}: делает «${st.name}» из: ${ins}.` + (built ? '' : ' Этот станок ещё не куплен.');
  }

  refresh() {
    const g = this.g, s = g.s, body = $('pBody');
    if (this.panel === 'upg') {
      for (const row of body.querySelectorAll('[data-row]')) {
        const u = UPG_BY_ID[row.dataset.row], l = s.upg[u.id] || 0;
        const max = l >= u.max;
        row.querySelector('.lv').innerHTML = '●'.repeat(l) + '<span>' + '○'.repeat(u.max - l) + '</span>';
        row.querySelector('.vv').textContent = max ? u.fmt(u.v(l), l) + ' — максимум' : u.fmt(u.v(l), l) + ' → ' + u.fmt(u.v(l + 1), l + 1);
        const b = row.querySelector('.buy');
        if (max) { b.textContent = 'МАКС'; b.disabled = true; b.classList.remove('ok'); }
        else { const c = u.cost(l); b.textContent = fmtMoney(c); b.disabled = s.money < c; b.classList.toggle('ok', s.money >= c); }
      }
      if ($('ordN')) {
        const n = s.logOrder || 0;
        $('ordN').textContent = n;
        $('ordInfo').textContent = n ? `${n} брёвен за рейс · ${fmtMoney(n * g.logCost())} · лесовоз раз в ${g.uv('u_trFreq').toFixed(0)} с`
          : 'не возить · до ' + g.logCap() + ' брёвен за рейс';
      }
    } else if (this.panel === 'work') {
      g.workers.forEach((w, i) => {
        const row = body.querySelector(`[data-row="w${i}"]`);
        if (!row) return;
        const doing = g.workerDoing(w);
        row.querySelector('.vv').textContent = doing;
        row.classList.toggle('idle', w.on && w.still > TUNE.idleShow);
        const b = row.querySelector('.tog');
        b.textContent = w.on ? '⏸ Выключить' : '▶ Включить';
        b.classList.toggle('off', !w.on);
      });
    }
  }

  onPanelClick(e) {
    const t = e.target.closest('button, input');
    if (!t) return;
    const g = this.g;
    if (t.dataset.upg) { if (g.buyUpgrade(t.dataset.upg)) this.audio.play('upg'); this.refresh(); }
    else if (t.dataset.w !== undefined) { const w = g.workers[+t.dataset.w]; w.on = !w.on; this.refresh(); }
    else if (t.dataset.show !== undefined) { if (this.view) this.view.focusOn(g.workers[+t.dataset.show]); }
    else if (t.dataset.tenant) { const [fl, id] = t.dataset.tenant.split(':'); if (g.pickTenant(+fl, id)) this.audio.play('upg'); }
    else if (t.dataset.act === 'towerShot') { this.close(); if (this.view) this.view.towerShot(4.5); }
    else if (t.dataset.order !== undefined) {   // закупка брёвен: следующий шаг вверх или вниз, не больше, чем берёт лесовоз
      const cur = g.s.logOrder || 0, up = +t.dataset.order > 0, cap = g.logCap();
      const steps = LOG_ORDER_STEPS.filter((v) => v <= cap);
      const next = up ? steps.find((v) => v > cur) : steps.slice().reverse().find((v) => v < cur);
      if (next !== undefined) g.setLogOrder(next);
      else if (up && cur < cap) g.setLogOrder(cap);
      this.refresh();
    }
    else if (t.dataset.prio !== undefined) { g.s.sitePriority = t.checked; }
    else if (t.dataset.act === 'sound') { this.audio.toggle(); this.render(); }
    else if (t.dataset.act === 'feedback') this.feedback();
    else if (t.dataset.act === 'export') this.exportSave();
    else if (t.dataset.act === 'import') this.importSave();
    else if (t.dataset.act === 'reset') this.resetGame();
  }

  // ───────── окна ─────────
  modal(html) { $('modalBox').innerHTML = html; $('modal').classList.remove('hidden'); }
  hideModal() { $('modal').classList.add('hidden'); }

  showOffline(r) {
    const made = Object.keys(r.made).filter((k) => ITEMS[k]).sort((a, b) => r.made[b] - r.made[a]).slice(0, 5)
      .map((k) => `${ITEMS[k].name}: ${fmtNum(r.made[k])}`).join('<br>');
    this.modal(`<h2>Пока тебя не было</h2><p>Цеха работали ${fmtTime(r.sec)}${r.capped ? ' (больше часа не копится)' : ''}.</p>` +
      `<p class="big">+${fmtMoney(r.money)}</p><p class="small">Деньги лежат в кассах — собери их${this.g.workers.some((w) => w.role === 'collector') ? ' (или дождись инкассатора)' : ''}.</p>` +
      (r.floors > 0 ? `<p>🏢 Строители достроили этажей: <b>${r.floors}</b></p>` : '') +
      (made ? `<p class="small">${made}</p>` : '') + '<button data-close>Отлично</button>');
  }

  // ───────── жильцы небоскрёба ─────────
  // две карточки на выбор; data-tenant="этаж:id" — клик выбирает
  tenantCards(p) {
    return '<div class="tenants">' + p.opts.map((id) => {
      const T = TENANTS[id];
      return `<button class="tenant" data-tenant="${p.floor}:${id}"><span class="ti">${T.icon}</span><b>${T.name}</b><span>${T.text}</span></button>`;
    }).join('') + '</div>';
  }

  // этаж достроен — кто въедет? Окно можно закрыть: выбор подождёт в «Небоскрёбе» (чип этажа напомнит)
  tenantModal() {
    const p = this.g.s.tenantPending[0];
    if (!p) return;
    this.tenantAsked = true;
    this.modal(`<h2>🏢 ${p.floor}-й этаж построен!</h2><p>Кто въедет? Бонусы жильцов складываются.</p>` +
      this.tenantCards(p) + '<p class="small">Можно выбрать и позже — в «Небоскрёбе».</p><button data-close class="ghost">Позже</button>');
    $('modalBox').querySelectorAll('[data-tenant]').forEach((b) => {
      b.onclick = () => {   // выбрал — следующий невыбранный этаж, если есть (после обновления их может быть несколько)
        const [fl, id] = b.dataset.tenant.split(':');
        this.g.pickTenant(+fl, id); this.audio.play('upg');
        if (this.g.s.tenantPending.length) this.tenantModal(); else this.hideModal();
      };
    });
  }

  // ───────── казино (8-й этаж) ─────────
  // Окно с играми у входа в небоскрёб. Ставки и выигрыши считает Game (slotSpin, wheelSpin, hiloGuess, raceBet), здесь —
  // только вид и анимации: выигрыш Game зачисляет, когда анимация доиграет (CASINO.*.t). После каждой ставки — сохранение,
  // чтобы перезагрузкой страницы проигрыш не отменить
  casinoBetNow() { const g = this.g; return Math.max(0, Math.floor(Math.min(g.s.money, g.casinoMax() * (this.csK || 0.25)))); }

  casinoModal(tab) {
    const g = this.g;
    if (!g.casinoOn()) return;
    clearTimeout(this.csTimer); this.csBusy = false;
    this.csTab = tab || this.csTab || 'slot';
    this.csK = this.csK || 0.25;
    const tabs = [['slot', '🎰 Слот'], ['wheel', '🎡 Колесо'], ['hilo', '🃏 Карты'], ['race', '🪓 Гонка']];
    this.modal('<div class="casino"><h2>🎰 Казино «Золотой топор»</h2>' +
      '<div class="cs-top">В кармане <b id="csMoney"></b> · ставка <b id="csBet"></b></div>' +
      '<div class="cs-row">' + [0.1, 0.25, 0.5, 1].map((k) => `<button data-bk="${k}" class="${k === this.csK ? 'on' : ''}">${k === 1 ? 'Макс' : Math.round(k * 100) + '%'}</button>`).join('') + '</div>' +
      '<div class="small">Макс. ставка — 3 минуты твоего дохода. Играешь на заработанное; в среднем казино чуть в плюсе.</div>' +
      '<div class="cs-row tabs">' + tabs.map(([id, n]) => `<button data-ct="${id}" class="${id === this.csTab ? 'on' : ''}">${n}</button>`).join('') + '</div>' +
      '<div id="csGame"></div><div class="small" id="csStat"></div><button data-close class="ghost">Выйти</button></div>');
    const box = $('modalBox');
    box.querySelectorAll('[data-bk]').forEach((b) => {
      b.onclick = () => { this.csK = +b.dataset.bk; box.querySelectorAll('[data-bk]').forEach((x) => x.classList.toggle('on', x === b)); this.casinoRefresh(); };
    });
    box.querySelectorAll('[data-ct]').forEach((b) => { b.onclick = () => { if (!this.csBusy) this.casinoModal(b.dataset.ct); }; });
    this.casinoGame();
    this.casinoRefresh();
  }

  // деньги, ставка и статистика в окне — зовётся и из update(), пока окно открыто
  casinoRefresh() {
    const g = this.g, m = $('csMoney');
    if (!m) return;
    const bet = this.casinoBetNow(), cs = g.casinoStats();
    m.textContent = fmtMoney(g.s.money);
    $('csBet').textContent = fmtMoney(bet);
    $('csStat').textContent = cs.n ? `Сыграно ${cs.n}: поставлено ${fmtMoney(cs.bet)}, выиграно ${fmtMoney(cs.won)}` : '';
    $('modalBox').querySelectorAll('[data-bet]').forEach((b) => {
      b.disabled = this.csBusy || bet <= 0;
      const s = b.querySelector('.sum'); if (s) s.textContent = fmtMoney(bet);
    });
  }

  casinoRes(html) { const r = $('csRes'); if (r) r.innerHTML = html; }
  casinoCard(c) {   // карта 2…14: В, Д, К, Т — русские обозначения; масть — для красоты
    const r = c <= 10 ? String(c) : ['В', 'Д', 'К', 'Т'][c - 11], suit = '♠♥♦♣'[Math.floor(Math.random() * 4)];
    return `<div class="cs-card${suit === '♥' || suit === '♦' ? ' red' : ''}">${r}${suit}</div>`;
  }

  casinoGame() {
    const g = this.g, el = $('csGame'), t = this.csTab;
    if (!el) return;
    if (t === 'slot') {
      const S = CASINO.slot, row = (arr) => S.sym.map((s, i) => '<span class="nw">' + s + '×' + arr[i] + '</span>').reverse().join(' ');
      el.innerHTML = '<div class="cs-slot">' + [0, 1, 2].map((i) => `<div class="reel" id="reel${i}">${S.sym[5 - i * 2]}</div>`).join('') + '</div>' +
        '<div class="cs-res" id="csRes">&nbsp;</div><button class="cs-go" data-bet>Крутить · <span class="sum"></span></button>' +
        `<div class="small">Три одинаковых: ${row(S.three)}<br>Пара на первых двух: ${row(S.pair)}</div>`;
      el.querySelector('[data-bet]').onclick = () => this.casinoSlot();
    } else if (t === 'wheel') {
      el.innerHTML = '<div class="cs-wheel"><div class="ptr"></div><canvas id="csWheel" width="440" height="440"></canvas></div>' +
        '<div class="cs-res" id="csRes">&nbsp;</div><button class="cs-go" data-bet>Крутить колесо · <span class="sum"></span></button>';
      this.drawWheel($('csWheel'));
      $('csWheel').style.transform = `rotate(${this.csRot || 0}deg)`;
      el.querySelector('[data-bet]').onclick = () => this.casinoWheel();
    } else if (t === 'hilo') {
      const h = g.s.casino.hilo;
      if (!h) {
        el.innerHTML = '<div class="small">Сдаём карту — угадай, следующая больше или меньше. Угадал — банк растёт, можно забрать ' +
          `или рискнуть дальше (до ${CASINO.hilo.steps} раз). Равная — проигрыш.</div>` + (this.csLastCard ? this.casinoCard(this.csLastCard) : '<div class="cs-card back">🂠</div>') +
          '<div class="cs-res" id="csRes">&nbsp;</div><button class="cs-go" data-bet>Сдать карту · <span class="sum"></span></button>';
        el.querySelector('[data-bet]').onclick = () => {
          const r = g.hiloStart(this.casinoBetNow());
          this.csLastCard = 0;
          if (!r) { this.casinoRes('Не хватает денег'); return; }
          if (this.saveNow) this.saveNow();
          this.casinoGame(); this.casinoRefresh();
        };
      } else {
        const up = g.hiloMult(h.card, true), dn = g.hiloMult(h.card, false);
        el.innerHTML = this.casinoCard(h.card) + `<div class="cs-res" id="csRes">Банк: ${fmtMoney(h.pot)}${h.step ? ` · угадано ${h.step} из ${CASINO.hilo.steps}` : ''}</div>` +
          '<div class="cs-row">' + `<button data-hl="up" ${up ? '' : 'disabled'}>⬆ Больше ×${up || '—'}</button>` +
          `<button data-hl="down" ${dn ? '' : 'disabled'}>⬇ Меньше ×${dn || '—'}</button></div>` +
          (h.step ? `<button class="cs-go" data-hl="take">Забрать ${fmtMoney(h.pot)}</button>` : '');
        el.querySelectorAll('[data-hl]').forEach((b) => { b.onclick = () => this.casinoHilo(b.dataset.hl); });
      }
    } else if (t === 'race') {
      const R = g.raceNext(), names = CASINO.race.names;
      if (this.csPick === undefined || this.csPick >= names.length) this.csPick = 0;
      el.innerHTML = '<div class="small">Четверо рубят дерево наперегонки. Выбери, на кого ставишь: у каждого своя форма — свои выплаты.</div>' +
        names.map((n, i) => `<div class="cs-lane${i === this.csPick ? ' on' : ''}" data-pick="${i}"><span class="nm">${n}</span><span class="od">×${R.odds[i]}</span>` +
          `<div class="track"><span class="runner" id="run${i}">🪓</span></div><span class="tree">🌲</span></div>`).join('') +
        '<div class="cs-res" id="csRes">&nbsp;</div><button class="cs-go" data-bet>Старт · <span class="sum"></span></button>';
      el.querySelectorAll('[data-pick]').forEach((b) => {
        b.onclick = () => { if (this.csBusy) return; this.csPick = +b.dataset.pick; el.querySelectorAll('[data-pick]').forEach((x) => x.classList.toggle('on', x === b)); };
      });
      el.querySelector('[data-bet]').onclick = () => this.casinoRace();
    }
  }

  // слот: барабаны мелькают и встают по одному — на то, что уже выпало в Game
  casinoSlot() {
    const g = this.g, S = CASINO.slot, r = g.slotSpin(this.casinoBetNow());
    if (!r) { this.casinoRes('Не хватает денег'); return; }
    if (this.saveNow) this.saveNow();
    this.csBusy = true; this.casinoRefresh(); this.casinoRes('&nbsp;');
    const reels = [0, 1, 2].map((i) => $('reel' + i)), t0 = performance.now();
    const tick = () => {
      if (!document.body.contains(reels[0])) { this.csBusy = false; return; }
      const t = (performance.now() - t0) / 1000;
      reels.forEach((el, i) => {
        const spin = t < 0.6 + i * 0.45;
        el.textContent = spin ? S.sym[Math.floor(Math.random() * S.sym.length)] : S.sym[r.reels[i]];
        el.classList.toggle('spin', spin);
      });
      if (t < 1.6) { this.csTimer = setTimeout(tick, 70); return; }
      this.csBusy = false;
      this.casinoRes(r.win > 0 ? `<span class="win">+${fmtMoney(r.win)}</span> · ×${r.mult}${r.reels[0] === 5 && r.mult === S.three[5] ? ' · ДЖЕКПОТ!' : ''}` : 'Мимо');
      this.casinoRefresh();
    };
    tick();
  }

  drawWheel(cv) {
    const x = cv.getContext('2d'), m = CASINO.wheel.m, n = m.length, R = cv.width / 2, st = (Math.PI * 2) / n;
    const col = { 0: '#3b4550', 0.5: '#3d6b95', 1: '#2a8c8c', 1.5: '#2f9e54', 2: '#e08a1c', 3: '#8e5bd0', 7: '#e5b400' };
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + i * st;
      x.beginPath(); x.moveTo(R, R); x.arc(R, R, R - 4, a0, a0 + st); x.closePath();
      x.fillStyle = col[m[i]] || '#555'; x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 3; x.stroke();
      x.save(); x.translate(R, R); x.rotate(a0 + st / 2);
      x.fillStyle = '#fff'; x.font = '900 26px Nunito, sans-serif'; x.textAlign = 'right'; x.textBaseline = 'middle';
      x.fillText(m[i] ? '×' + m[i] : '0', R - 18, 0);
      x.restore();
    }
    x.beginPath(); x.arc(R, R, 34, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill();
    x.font = '900 34px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('🪓', R, R + 2);
  }

  // колесо: сектор, выпавший в Game, приезжает под стрелку (всегда крутим вперёд, 6+ оборотов)
  casinoWheel() {
    const g = this.g, r = g.wheelSpin(this.casinoBetNow()), cv = $('csWheel');
    if (!r) { this.casinoRes('Не хватает денег'); return; }
    if (this.saveNow) this.saveNow();
    const n = CASINO.wheel.m.length, step = 360 / n;
    this.csRot = (Math.floor((this.csRot || 0) / 360) + 6) * 360 + (360 - (r.sector + 0.5) * step);
    this.csBusy = true; this.casinoRefresh(); this.casinoRes('&nbsp;');
    cv.style.transform = `rotate(${this.csRot}deg)`;
    this.csTimer = setTimeout(() => {
      this.csBusy = false;
      this.casinoRes(r.win > 0 ? `<span class="win">+${fmtMoney(r.win)}</span> · ×${r.mult}` : 'Ноль — мимо');
      this.casinoRefresh();
    }, 3300);
  }

  casinoHilo(act) {
    const g = this.g;
    if (act === 'take') {
      const v = g.hiloTake();
      this.csLastCard = 0;
      if (this.saveNow) this.saveNow();
      this.casinoGame(); this.casinoRes(`<span class="win">+${fmtMoney(v)}</span> — забрал`); this.casinoRefresh();
      return;
    }
    const r = g.hiloGuess(act === 'up');
    if (!r) return;
    if (this.saveNow) this.saveNow();
    if (r.ok && !r.done) { this.casinoGame(); this.casinoRes(`Угадал! Банк: ${fmtMoney(r.pot)}`); }
    else {
      this.csLastCard = r.card;
      this.casinoGame();
      this.casinoRes(r.ok ? `<span class="win">+${fmtMoney(r.pot)}</span> — угадано ${CASINO.hilo.steps} из ${CASINO.hilo.steps}, банк твой` : 'Не угадал — банк сгорел');
    }
    this.casinoRefresh();
  }

  // гонка: победитель уже выбран в Game — он и добегает первым, остальные отстают
  casinoRace() {
    const g = this.g, pick = this.csPick || 0, r = g.raceBet(this.casinoBetNow(), pick);
    if (!r) { this.casinoRes('Не хватает денег'); return; }
    if (this.saveNow) this.saveNow();
    this.csBusy = true; this.casinoRefresh(); this.casinoRes('&nbsp;');
    const n = CASINO.race.names.length, T = CASINO.race.t - 0.4;
    const fin = [...Array(n)].map((_, i) => (i === r.winner ? T : T * (1.06 + Math.random() * 0.2)));
    const ph = [...Array(n)].map(() => Math.random() * 6);
    const runs = [...Array(n)].map((_, i) => $('run' + i)), t0 = performance.now();
    const tick = () => {
      if (!document.body.contains(runs[0])) { this.csBusy = false; return; }
      const t = (performance.now() - t0) / 1000;
      runs.forEach((el, i) => {
        const p = Math.min(1, t / fin[i] + (t < fin[i] ? 0.015 * Math.sin(t * 9 + ph[i]) : 0));
        el.style.left = `calc(${(Math.max(0, p) * 100).toFixed(1)}% - ${(Math.max(0, p) * 22).toFixed(1)}px)`;
      });
      if (t < T + 0.15) { this.csTimer = setTimeout(tick, 50); return; }
      this.csBusy = false;
      const lane = $('csGame').querySelectorAll('.cs-lane')[r.winner];
      if (lane) lane.classList.add('win');
      const name = CASINO.race.names[r.winner];
      this.casinoRes(r.win > 0 ? `🏆 ${name} первый! <span class="win">+${fmtMoney(r.win)}</span>` : `🏆 Первым дорубил ${name} — ставка сгорела`);
      const b = $('csGame').querySelector('[data-bet]');
      if (b) { b.innerHTML = 'Новая гонка'; b.disabled = false; b.removeAttribute('data-bet'); b.onclick = () => { const keep = $('csRes').innerHTML; this.casinoGame(); this.casinoRefresh(); this.casinoRes(keep); }; }
      this.casinoRefresh();
    };
    tick();
  }

  // сохранение прошлой версии игра не принимает (другое начало) — объясняем, а не молча начинаем заново
  showReset() {
    this.modal('<h2>🌲 Большое обновление</h2>' +
      '<p>Игра теперь начинается <b>в лесу</b>: сами растим и рубим деревья, пилим доски у леса и продаём их тут же. ' +
      'Лесопилка откроется позже — брёвна туда возит лесовоз, а за них надо платить.</p>' +
      '<p class="small">Прогресс прошлой версии не переносится — начинаем заново. Спасибо, что играешь!</p>' +
      '<button data-close>Начать</button>');
  }

  showWelcome() {
    this.modal('<h2>🪵 Лесопилка</h2>' +
      '<p>Цель — построить <b>деревянный небоскрёб в 20 этажей</b>. Руби лес, пили доски, делай мебель, открывай новые цеха и нанимай рабочих.</p>' +
      '<p class="small"><b>Управление:</b> зажми мышь и тяни — человечек бежит туда (или WASD / стрелки). ' +
      'Встал на площадку — предметы и деньги перетекают сами. Жёлтая площадка с ценой — покупка.</p>' +
      '<p class="small">Прогресс сохраняется сам. Пока тебя нет, цеха с рабочими работают (до часа). Звук выключен — M.</p>' +
      '<button data-close>Поехали</button>');
  }

  showWin() {
    const s = this.g.s;
    this.modal(`<h2>🏙 Небоскрёб построен!</h2><p>Все ${FLOORS.length} этажей готовы.</p>` +
      `<p>Время в игре: <b>${fmtTime(s.playT)}</b><br>Заработано: <b>${fmtMoney(s.earned)}</b><br>Покупок: <b>${s.stats.buys}</b></p>` +
      '<p class="small">Можно продолжать: цеха работают, корабли приходят.</p><button data-close>Играть дальше</button>');
  }

  // ───────── идеи и баги ─────────
  // Окно отзыва: тип, текст, имя, данные об игре. Уходит прямо из игры в Google-форму (FEEDBACK.form), без аккаунтов;
  // без формы кнопки нет. Черновик хранится в браузере, пока не отправлен.
  fbDraft(v) {
    const key = 'lesopilka_feedback';
    try {
      if (v === undefined) return Object.assign({ kind: 'bug', text: '', name: '', tech: true }, JSON.parse(localStorage.getItem(key) || '{}'));
      if (v) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key);
    } catch (e) { /* хранилище недоступно — черновик не запомнится */ }
    return { kind: 'bug', text: '', name: '', tech: true };
  }

  techInfo() {
    const g = this.g, s = g.s, errs = window.__errs || [];
    return [
      `Сборка: ${window.LESO_BUILD}${window.LESO_TEST ? ' (тест)' : ''}`,
      `Экран: ${innerWidth}×${innerHeight}, масштаб ${devicePixelRatio}`,
      `Браузер: ${navigator.userAgent}`,
      `Этаж ${s.floor}/${FLOORS.length}, в игре ${fmtTime(s.playT)}, деньги ${fmtMoney(s.money)}, покупок ${s.stats.buys}, рабочих ${g.workers.length}`,
      `Открыто: ${ZONES.filter((z) => g.open[z.id]).map((z) => z.name).join(', ')}`,
      errs.length ? 'Ошибки:\n' + errs.join('\n') : 'Ошибок в консоли нет',
    ].join('\n');
  }

  feedback() {
    const d = this.fbDraft();
    const kinds = [['bug', '🐞 Баг'], ['idea', '💡 Идея'], ['other', '💬 Другое']];
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    this.modal('<h2>Идея или баг</h2><div class="fb">' +
      '<p class="small">Всё, что заметил или хочешь в игре, — сюда. Попадёт в общий список, ничего не потеряется.</p>' +
      `<div class="fbk">${kinds.map(([k, t]) => `<button data-fbk="${k}"${d.kind === k ? ' class="on"' : ''}>${t}</button>`).join('')}</div>` +
      `<textarea id="fbText" placeholder="Что случилось или что предлагаешь? Для бага — что делал перед этим">${esc(d.text)}</textarea>` +
      `<input id="fbName" maxlength="40" placeholder="Как тебя зовут (необязательно)" value="${esc(d.name)}">` +
      `<label class="chk"><input type="checkbox" id="fbTech"${d.tech ? ' checked' : ''}> Приложить данные об игре: версия, браузер, этаж, ошибки</label>` +
      '<button id="fbSend">Отправить</button> <button id="fbCopy" class="ghost">Скопировать текст</button> <button data-close class="ghost">Закрыть</button>' +
      '</div>');
    const box = $('modalBox');
    const read = () => ({
      kind: (box.querySelector('[data-fbk].on') || {}).dataset?.fbk || 'bug',
      text: $('fbText').value, name: $('fbName').value, tech: $('fbTech').checked,
    });
    const save = () => this.fbDraft(read());
    box.querySelectorAll('[data-fbk]').forEach((b) => {
      b.onclick = () => { box.querySelectorAll('[data-fbk]').forEach((x) => x.classList.toggle('on', x === b)); save(); };
    });
    $('fbText').oninput = save; $('fbName').oninput = save; $('fbTech').onchange = save;
    const compose = () => {
      const v = read(), kind = kinds.find((k) => k[0] === v.kind)[1].slice(3);
      const text = v.text.trim(), name = v.name.trim();
      return { v, kind, text, name, plain: `[${kind}] ${text}` + (name ? `\n— ${name}` : '') + (v.tech ? `\n\n${this.techInfo()}` : '') };
    };
    const copy = (t) => {
      try { navigator.clipboard.writeText(t); } catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    };
    $('fbCopy').onclick = () => { copy(compose().plain); this.toast('📋 Текст скопирован — пришли его разработчику'); };
    $('fbSend').onclick = () => {
      const c = compose(), F = FEEDBACK.form;
      if (!c.text) { this.toast('Напиши, что случилось или что предлагаешь', 'bad'); $('fbText').focus(); return; }
      // Google-форма: отправка без аккаунта; ответ форма не показывает (no-cors) — считаем, что дошло
      const data = new URLSearchParams();
      data.append(F.kind, c.kind);
      data.append(F.text, c.text);
      if (F.name) data.append(F.name, c.name);
      if (F.tech && c.v.tech) data.append(F.tech, this.techInfo());
      fetch(F.url, { method: 'POST', mode: 'no-cors', body: data })
        .then(() => { this.fbDraft(null); this.hideModal(); this.toast('✅ Спасибо! Записали', 'big'); })
        .catch(() => this.toast('Не получилось отправить — проверь интернет или нажми «Скопировать» и пришли текст разработчику', 'bad'));
    };
    setTimeout(() => $('fbText') && $('fbText').focus(), 50);
  }

  exportSave() {
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(this.g.toSave()))));
    this.modal(`<h2>Код сохранения</h2><p class="small">Скопируй и храни где угодно. Загрузить: Меню → «Загрузить из кода».</p>` +
      `<textarea id="saveCode" readonly>${code}</textarea><button id="copyBtn">Скопировать</button> <button data-close>Закрыть</button>`);
    const ta = $('saveCode');
    ta.select();
    $('copyBtn').onclick = () => {
      ta.select();
      try { navigator.clipboard.writeText(code).then(() => this.toast('Код скопирован')); } catch (e) { document.execCommand('copy'); this.toast('Код скопирован'); }
    };
  }

  importSave() {
    this.modal('<h2>Загрузить из кода</h2><p class="small">Текущий прогресс заменится.</p><textarea id="loadCode" placeholder="Вставь код сюда"></textarea>' +
      '<button id="loadBtn">Загрузить</button> <button data-close>Отмена</button>');
    $('loadBtn').onclick = () => {
      try {
        const data = JSON.parse(decodeURIComponent(escape(atob($('loadCode').value.trim()))));
        if (!data || data.v !== SAVE_VERSION) throw new Error('версия');
        window.lesopilkaReplace(data);
      } catch (e) { this.toast('Не получилось прочитать код', 'bad'); }
    };
  }

  resetGame() {
    this.modal('<h2>Начать заново?</h2><p>Весь прогресс пропадёт. Можно сначала скопировать код сохранения.</p>' +
      '<button class="danger" id="resetYes">Да, начать заново</button> <button data-close>Отмена</button>');
    $('resetYes').onclick = () => window.lesopilkaReplace(null);
  }
}
