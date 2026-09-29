// Копирует нужные модели Kenney из _raw/kenney/<набор>/Models/... в assets/kenney/<набор>/<модель>.glb
// (и общую текстуру набора, если она есть). node tools/kenney-copy.js
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src', 'assets.js'), 'utf8'), { filename: 'assets.js' });

const RAW = path.join(ROOT, '_raw', 'kenney');
const OUT = path.join(ROOT, 'assets', 'kenney');

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findFile(p, name); if (r) return r; } else if (e.name === name) return p;
  }
  return null;
}

let copied = 0, bytes = 0;
const missing = [];
const packs = new Set();
for (const g of KENNEY_GROUPS) {
  for (const name of g.items) {
    const src = findFile(path.join(RAW, g.pack, 'Models'), name + '.glb');
    if (!src) { missing.push(g.pack + '/' + name); continue; }
    const dst = path.join(OUT, g.pack, name + '.glb');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied++; bytes += fs.statSync(dst).size;
    packs.add(g.pack + '|' + path.dirname(src));
  }
}
for (const p of packs) {
  const [pack, dir] = p.split('|');
  const tex = path.join(dir, 'Textures', 'colormap.png');
  if (fs.existsSync(tex)) {
    const dst = path.join(OUT, pack, 'Textures', 'colormap.png');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(tex, dst);
    bytes += fs.statSync(dst).size;
  }
}
console.log(`скопировано моделей: ${copied}, всего ${(bytes / 1024 / 1024).toFixed(1)} МБ`);
if (missing.length) console.log('не найдено: ' + missing.join(', '));
