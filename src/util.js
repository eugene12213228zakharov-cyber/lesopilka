'use strict';
// Общие помощники. Без THREE и DOM — файл грузится и в браузере, и в node.

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }

// Прямоугольник по центру и размерам → границы
function rectOf(o, pad = 0) {
  return { x0: o.x - o.w / 2 - pad, z0: o.z - o.d / 2 - pad, x1: o.x + o.w / 2 + pad, z1: o.z + o.d / 2 + pad };
}
function inRect(x, z, r) { return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1; }

// Детерминированный генератор случайных чисел (mulberry32): состояние хранится в сохранении
function rngNext(st) {
  st.s = (st.s + 0x6D2B79F5) | 0;
  let t = st.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function fmtMoney(v) {
  v = Math.floor(v);
  if (v < 10000) return '$' + v;
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [d, s] of units) {
    if (v >= d) {
      const x = v / d;
      return '$' + (x >= 100 ? x.toFixed(0) : x.toFixed(1)).replace('.0', '') + s;
    }
  }
  return '$' + v;
}

function fmtNum(v) {
  v = Math.floor(v);
  if (v < 10000) return String(v);
  return fmtMoney(v).slice(1);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return h + ' ч ' + String(m).padStart(2, '0') + ' мин';
  if (m > 0) return m + ' мин ' + String(s).padStart(2, '0') + ' с';
  return s + ' с';
}

// Склонение: plural(5, 'бревно', 'бревна', 'брёвен')
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
