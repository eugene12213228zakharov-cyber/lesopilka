// Номера полей Google-формы для кнопки «💬» — печатает готовую строку FEEDBACK для src/config.js.
// node tools/formfields.js <ссылка на форму: https://forms.gle/… или …/forms/d/e/…/viewform>
// Поля ищутся по названию: «Тип», «Текст», «Имя», «Данные» (последние два — необязательные).
const link = process.argv[2];
if (!link) { console.log('Нужна ссылка на форму: node tools/formfields.js https://forms.gle/…'); process.exit(1); }

(async () => {
  const r = await fetch(link, { redirect: 'follow' });
  if (/accounts\.google\.com/.test(r.url)) {
    console.log('Форма требует вход в Google — в её настройках выключи сбор адресов почты и «Ограничить одним ответом».');
    process.exit(1);
  }
  const html = await r.text();
  const m = html.match(/FB_PUBLIC_LOAD_DATA_ = ([\s\S]*?);\s*<\/script>/);
  if (!m) { console.log('Не нашёл в странице описание формы. Ссылка точно на заполнение формы и форма принимает ответы?'); process.exit(1); }
  const data = JSON.parse(m[1]);
  // вопрос: [id, название, описание, тип, [[номер поля, …]], …]
  const qs = ((data[1] && data[1][1]) || []).filter((q) => q[4] && q[4][0]).map((q) => ({ title: String(q[1] || '').trim(), entry: 'entry.' + q[4][0][0] }));
  const pick = (re) => (qs.find((q) => re.test(q.title.toLowerCase())) || {}).entry;
  const f = { url: r.url.replace(/\/viewform.*$/, '/formResponse'), kind: pick(/^тип/), text: pick(/^текст/), name: pick(/^имя/), tech: pick(/^данн/) };
  console.log(`Форма «${data[3] || ''}», вопросов ${qs.length}: ${qs.map((q) => `${q.title} = ${q.entry}`).join(', ')}`);
  if (!f.kind || !f.text) { console.log('Нет поля «Тип» или «Текст» — назови вопросы так, как написано выше.'); process.exit(1); }
  if (!f.name) delete f.name;
  if (!f.tech) delete f.tech;
  console.log('\nВ src/config.js:\nconst FEEDBACK = { form: ' + JSON.stringify(f).replace(/"(\w+)":/g, '$1: ').replace(/"/g, "'").replace(/,/g, ', ') + ' };');
})().catch((e) => { console.log('Не открылась форма: ' + e.message); process.exit(1); });
