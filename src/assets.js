'use strict';
// Готовые модели Kenney (kenney.nl, лицензия CC0): кандидаты для витрины и что где стоит в игре.
// Файлы лежат в assets/kenney/<набор>/<модель>.glb (копирует tools/kenney-copy.js из _raw/).

const KENNEY_DIR = 'assets/kenney/';

// Витрина: группы кандидатов. star — что стоит в игре по умолчанию.
const KENNEY_GROUPS = [
  { title: 'Люди', pack: 'mini-characters', star: ['character-male-e', 'character-male-a', 'character-male-b', 'character-male-f', 'character-female-b', 'character-female-c'],
    items: ['character-male-a', 'character-male-b', 'character-male-c', 'character-male-d', 'character-male-e', 'character-male-f',
      'character-female-a', 'character-female-b', 'character-female-c', 'character-female-d', 'character-female-e', 'character-female-f'] },
  { title: 'Деревья делянки', pack: 'nature-kit', star: ['tree_pineRoundA'],
    items: ['tree_pineDefaultA', 'tree_pineDefaultB', 'tree_pineRoundA', 'tree_pineRoundC', 'tree_pineRoundE', 'tree_pineTallA_detailed',
      'tree_pineTallB_detailed', 'tree_pineSmallA', 'tree_cone', 'tree_default', 'tree_oak', 'tree_fat'] },
  { title: 'Пни и брёвна', pack: 'nature-kit', star: ['stump_round', 'log', 'log_stackLarge'],
    items: ['stump_old', 'stump_oldTall', 'stump_round', 'stump_roundDetailed', 'stump_square', 'stump_squareDetailed', 'log', 'log_large', 'log_stack', 'log_stackLarge'] },
  { title: 'Мебель-товар и коробки', pack: 'furniture-kit', star: ['chairCushion', 'table', 'bookcaseClosedDoors', 'cardboardBoxClosed'],
    items: ['chair', 'chairCushion', 'chairRounded', 'table', 'tableCloth', 'tableCross', 'bookcaseClosedDoors', 'bookcaseClosed', 'kitchenCabinet', 'cardboardBoxClosed', 'cardboardBoxOpen'] },
  { title: 'Магазин', pack: 'furniture-kit', star: ['bookcaseOpen', 'kitchenBar', 'computerScreen', 'pottedPlant', 'trashcan'],
    items: ['bookcaseOpen', 'bookcaseOpenLow', 'kitchenBar', 'computerScreen', 'pottedPlant', 'plantSmall1', 'lampSquareFloor', 'rugRectangle', 'trashcan', 'bench'] },
  { title: 'Станки и цех', pack: 'factory-kit', star: ['machine-bed', 'machine-window', 'piston-square', 'machine-connection-hole', 'hopper-high-square', 'machine-window-bar', 'scanner-high', 'conveyor-long'],
    items: ['machine', 'machine-bed', 'machine-fortified', 'machine-window', 'machine-window-bar', 'machine-connection-hole', 'machine-connection-pipe',
      'hopper-high-square', 'hopper-square', 'piston-square', 'piston-round', 'robot-arm-a', 'robot-arm-b', 'scanner-high',
      'conveyor-long', 'conveyor-stripe', 'conveyor-bars-sides', 'crane', 'box-small', 'box-long', 'cog-a'] },
  { title: 'Машины', pack: 'car-kit', star: ['delivery-flat', 'delivery'],
    items: ['delivery-flat', 'delivery', 'truck', 'truck-flat', 'garbage-truck', 'tractor', 'van'] },
  { title: 'Порт', pack: 'watercraft-kit', star: ['ship-cargo-a', 'cargo-container-a', 'cargo-container-b'],
    items: ['ship-cargo-a', 'ship-cargo-b', 'ship-cargo-c', 'boat-tug-a', 'cargo-container-a', 'cargo-container-b', 'cargo-container-c', 'cargo-pile-a'] },
  { title: 'Здания вокруг', pack: 'city-kit-industrial', star: ['building-a', 'building-e', 'building-k', 'building-m', 'water-tower', 'chimney-large'],
    items: ['building-a', 'building-c', 'building-e', 'building-g', 'building-k', 'building-m', 'building-p', 'building-s', 'water-tower', 'windmill', 'chimney-large', 'detail-tank-large'] },
  { title: 'Навесы', pack: 'city-kit-commercial', star: ['detail-awning'], items: ['detail-awning', 'detail-awning-wide'] },
  { title: 'Заборы и мелочи', pack: 'nature-kit', star: ['fence_simple', 'rock_largeA', 'plant_bushLarge'],
    items: ['fence_simple', 'fence_planks', 'fence_gate', 'sign', 'path_wood', 'rock_largeA', 'plant_bushLarge'] },
];

// Старые наборы Kenney (природа, мебель) раскрашены очень светло — под нашим солнцем выгорают.
// Перекрашиваем по имени материала в насыщенные тона (и в игре, и в витрине).
const RECOLOR = {
  'nature-kit': {
    leafsDark: 0x2f7d3a, leafsGreen: 0x4f9e3f, leafs: 0x5aae4a, grass: 0x5fae4a, plant: 0x3f9a55,
    woodBarkDark: 0x6b4428, woodBark: 0x8b5a2b, woodInner: 0xe8c690, woodDark: 0x8a5a33, wood: 0xa9743f,
    dirt: 0x8b6a4a, stone: 0x9aa3a8, stoneDark: 0x6f787d,
  },
  'furniture-kit': {
    wood: 0xd39a5c, woodDark: 0xa86b3c, carpet: 0xd9534f, metal: 0xb8c4c8, metalDark: 0x5c6b73,
    plant: 0x3f9a55, carpetBlue: 0x3d7fd0, carpetWhite: 0xf1efe8,
  },
};

// Путь к файлу модели 'набор/модель'
function kenneyUrl(key) { return KENNEY_DIR + key + '.glb?v=' + (typeof window !== 'undefined' ? window.LESO_BUILD : ''); }

// Загрузка и хранение моделей. Для клонов человечков — SkeletonUtils (у них кости и анимации).
class ModelLib {
  constructor() {
    this.gltf = {};
    this.loader = new GLTFLoader();
  }

  load(key) {
    if (this.gltf[key]) return Promise.resolve(this.gltf[key]);
    return new Promise((res, rej) => this.loader.load(kenneyUrl(key), (g) => {
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.gltf[key] = g;
      res(g);
    }, undefined, (e) => rej(new Error(key + ': ' + (e && e.message ? e.message : e)))));
  }

  // грузим список; onProgress(готово, всего). Ошибки не роняют загрузку — вернём список неудач
  async loadAll(keys, onProgress) {
    let done = 0;
    const failed = [];
    await Promise.all(keys.map((k) => this.load(k).catch(() => failed.push(k)).finally(() => { done++; if (onProgress) onProgress(done, keys.length); })));
    return failed;
  }

  has(key) { return !!this.gltf[key]; }

  clone(key) {
    const g = this.gltf[key];
    if (!g) return null;
    let skinned = false;
    g.scene.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
    return skinned ? SkeletonUtils.clone(g.scene) : g.scene.clone(true);
  }

  // клон с перекраской по RECOLOR — для витрины (в игре перекраска идёт при запекании)
  cloneRecolored(key) {
    const root = this.clone(key);
    const pal = root && RECOLOR[key.split('/')[0]];
    if (!pal) return root;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const one = !Array.isArray(o.material);
      const mats = (one ? [o.material] : o.material).map((m) => {
        if (pal[m.name] === undefined) return m;
        const n = m.clone();
        n.color.set(pal[m.name]);
        return n;
      });
      o.material = one ? mats[0] : mats;
    });
    return root;
  }

  clips(key) { return this.gltf[key] ? this.gltf[key].animations : []; }
}
