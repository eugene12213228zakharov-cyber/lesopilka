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
    $('bFb').onclick = () => this.feedback();
    $('pClose').onclick = () => this.close();
    $('pBody').addEventListener('click', (e) => this.onPanelClick(e));
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
      if (this.panel) this.render();
    } else if (e.t === 'floor') {
      let txt = `🏢 Построен ${e.n}-й этаж! Цены ×${FLOOR_BONUS}`;
      const z = ZONES.find((zz) => zz.floor === e.n);
      if (z) txt += `<br>Можно купить участок: <b>${z.name}</b>`;
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
      $('floorV').innerHTML = `Этаж <b>${s.floor}</b>/${FLOORS.length}` + (s.floor ? ` · цены ×${fb.toFixed(2)}` : '');
      const inCash = g.moneyInCash();
      $('cashHint').textContent = inCash >= 1 ? 'в кассах ещё ' + fmtMoney(inCash) : '';
      // сколько улучшений по карману — значок на кнопке
      let can = 0;
      for (const u of UPGRADES) { const l = s.upg[u.id] || 0; if (g.open[u.zone] && l < u.max && u.cost(l) <= s.money) can++; }
      $('upgBadge').textContent = can || '';
      $('upgBadge').style.display = can ? '' : 'none';
      $('bUpg').classList.toggle('hot', can > 0);
      if (this.panel) this.refresh();
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

  // ───────── панели ─────────
  toggle(name) { if (this.panel === name) this.close(); else { this.panel = name; this.render(); $('panel').classList.remove('hidden'); } }
  close() { this.panel = null; $('panel').classList.add('hidden'); }

  render() {
    const g = this.g, s = g.s, body = $('pBody');
    const title = { upg: '⬆ Улучшения', tower: '🏢 Небоскрёб', work: '👷 Рабочие', menu: '⚙ Меню' }[this.panel];
    $('pTitle').textContent = title;
    let h = '';
    if (this.panel === 'upg') {
      for (const z of ZONES) {
        if (!g.open[z.id]) continue;
        const ups = UPGRADES.filter((u) => u.zone === z.id);
        if (!ups.length) continue;
        h += `<div class="sec">${z.name}</div>`;
        for (const u of ups) {
          h += `<div class="urow" data-row="${u.id}"><div class="un"><div class="nm">${u.name}</div><div class="lv"></div><div class="vv"></div></div>` +
            `<button class="buy" data-upg="${u.id}"></button></div>`;
        }
      }
    } else if (this.panel === 'tower') {
      const f = FLOORS[s.floor];
      h += `<div class="note">Каждый этаж — заказ на товары. Отнеси их на стройку у подножия небоскрёба (или найми строителей). ` +
        `За каждый этаж все цены продажи растут ×${FLOOR_BONUS}; сейчас <b>×${g.floorBonus().toFixed(2)}</b>.</div>`;
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
        h += `<div class="fl ${st}"><b>${i + 1}</b>${z ? `<span>→ ${z}</span>` : ''}</div>`;
      });
      h += '</div>';
    } else if (this.panel === 'work') {
      h += `<label class="chk"><input type="checkbox" data-prio ${s.sitePriority !== false ? 'checked' : ''}> Стройка в приоритете — рабочие продаж не трогают то, что нужно этажу (заберут строители)</label>`;
      if (!g.workers.length) h += '<div class="note">Пока никого. Рабочих нанимают на площадках с человечком.</div>';
      g.workers.forEach((w, i) => {
        const nm = w.route ? ROUTES[w.route].name : ROLE_NAMES[w.role];
        const where = PAD_BY_ID[w.pad] ? (ZONE_BY_ID[PAD_BY_ID[w.pad].zone] || { name: 'Стройка' }).name : '';
        h += `<div class="wrow" data-row="w${i}"><div class="un"><div class="nm">${nm}</div><div class="lv">${where}</div><div class="vv"></div></div><button class="tog" data-w="${i}"></button></div>`;
      });
    } else if (this.panel === 'menu') {
      const snd = this.audio.on;
      h += `<button class="wide" data-act="sound">${snd ? '🔊 Звук включён' : '🔇 Звук выключен'}</button>`;
      h += '<button class="wide" data-act="feedback">💬 Предложить идею или сообщить о баге</button>';
      h += '<div class="sec">Управление</div><div class="note">Зажми мышь и тяни — человечек бежит в ту сторону (как джойстик на телефоне). ' +
        'Или WASD / стрелки. Колёсико — приблизить. Встал на площадку — предметы и деньги перетекают сами.<br>' +
        'U — улучшения, B — небоскрёб, R — рабочие, M — звук, Esc — закрыть.</div>';
      h += `<div class="sec">Статистика</div><div class="note">В игре: ${fmtTime(s.playT)}. Заработано всего: ${fmtMoney(s.earned)}. Покупок: ${s.stats.buys}.` +
        `<br>Сбивали машиной: тебя — ${s.stats.hitMe || 0}, рабочих — ${s.stats.hitW || 0}.</div>`;
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
        row.querySelector('.vv').textContent = max ? u.fmt(u.v(l)) + ' — максимум' : u.fmt(u.v(l)) + ' → ' + u.fmt(u.v(l + 1));
        const b = row.querySelector('.buy');
        if (max) { b.textContent = 'МАКС'; b.disabled = true; b.classList.remove('ok'); }
        else { const c = u.cost(l); b.textContent = fmtMoney(c); b.disabled = s.money < c; b.classList.toggle('ok', s.money >= c); }
      }
    } else if (this.panel === 'work') {
      g.workers.forEach((w, i) => {
        const row = body.querySelector(`[data-row="w${i}"]`);
        if (!row) return;
        const st = !w.on ? 'выключен' : w.task === 'rest' ? 'ждёт работу' : w.task === 'post' ? 'на кассе' : 'работает';
        row.querySelector('.vv').textContent = st + (w.stack.length ? ` · в руках ${w.stack.length}` : '');
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

  showWelcome() {
    this.modal('<h2>🪵 Лесопилка</h2>' +
      '<p>Цель — построить <b>деревянный небоскрёб в 20 этажей</b>. Для этого пили брёвна, делай мебель, открывай новые цеха и нанимай рабочих.</p>' +
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
  // Окно отзыва: тип, текст, имя, данные об игре. Уходит в GitHub Issues репозитория FEEDBACK.repo (открывается
  // готовая страница — нажать «Create»), а если подключена Google-форма (FEEDBACK.form) — прямо из игры.
  // Черновик хранится в браузере, пока не отправлен.
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
      `<p class="small" id="fbNote">${FEEDBACK.form ? '' : 'Откроется страница GitHub с готовым текстом — там нажми «Create» (нужен вход в GitHub). Нет аккаунта — жми «Скопировать» и пришли текст разработчику.'}</p>` +
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
      const v = read(), kind = kinds.find((k) => k[0] === v.kind)[1];
      const text = v.text.trim();
      const title = `[${kind.slice(3)}] ${text.split('\n')[0].slice(0, 70) || 'без описания'}`;
      const body = `**Тип:** ${kind}` + (v.name.trim() ? `\n**От:** ${v.name.trim()}` : '') + `\n\n${text || '—'}` +
        (v.tech ? `\n\n<details><summary>Данные об игре</summary>\n\n\`\`\`\n${this.techInfo()}\n\`\`\`\n</details>` : '');
      return { v, title, body, plain: `${title}\n\n${text}` + (v.name.trim() ? `\n— ${v.name.trim()}` : '') + (v.tech ? `\n\n${this.techInfo()}` : '') };
    };
    const copy = (t) => {
      try { navigator.clipboard.writeText(t); } catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    };
    $('fbCopy').onclick = () => { copy(compose().plain); this.toast('📋 Текст скопирован — пришли его разработчику'); };
    $('fbSend').onclick = () => {
      const c = compose();
      if (!c.v.text.trim()) { this.toast('Напиши, что случилось или что предлагаешь', 'bad'); $('fbText').focus(); return; }
      const F = FEEDBACK.form;
      if (F) {
        // Google-форма: отправка без аккаунта; ответ форма не показывает (no-cors) — считаем, что дошло
        const data = new URLSearchParams();
        data.append(F.kind, c.v.kind === 'bug' ? 'Баг' : c.v.kind === 'idea' ? 'Идея' : 'Другое');
        data.append(F.text, c.v.text.trim());
        if (F.name) data.append(F.name, c.v.name.trim());
        if (F.tech && c.v.tech) data.append(F.tech, this.techInfo());
        fetch(F.url, { method: 'POST', mode: 'no-cors', body: data })
          .then(() => { this.fbDraft(null); this.hideModal(); this.toast('✅ Спасибо! Записали', 'big'); })
          .catch(() => this.toast('Не получилось отправить — проверь интернет или нажми «Скопировать»', 'bad'));
        return;
      }
      const url = `https://github.com/${FEEDBACK.repo}/issues/new?title=${encodeURIComponent(c.title)}&body=${encodeURIComponent(c.body)}` +
        `&labels=${c.v.kind === 'bug' ? 'bug' : c.v.kind === 'idea' ? 'enhancement' : ''}`;
      copy(c.plain);
      window.open(url, '_blank', 'noopener');
      this.fbDraft(null);
      this.hideModal();
      this.toast('Открыл GitHub — нажми там «Create». Текст на всякий случай скопирован', 'big');
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
