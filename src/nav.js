'use strict';
// Сетка проходимости и поиск пути (A*) для рабочих и покупателей.

class NavGrid {
  constructor(bounds, cell) {
    this.cell = cell;
    this.x0 = bounds.x0; this.z0 = bounds.z0;
    this.nx = Math.ceil((bounds.x1 - bounds.x0) / cell);
    this.nz = Math.ceil((bounds.z1 - bounds.z0) / cell);
    const n = this.nx * this.nz;
    this.block = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.stamp = 0;
    this.heap = new Int32Array(n);
    this.hf = new Float32Array(n);
    this.cache = new Map();
  }

  clear() { this.block.fill(0); this.cache.clear(); }

  blockRect(r, v = 1) {
    const c = this.cell;
    const i0 = Math.max(0, Math.floor((r.x0 - this.x0) / c)), i1 = Math.min(this.nx - 1, Math.floor((r.x1 - this.x0) / c));
    const j0 = Math.max(0, Math.floor((r.z0 - this.z0) / c)), j1 = Math.min(this.nz - 1, Math.floor((r.z1 - this.z0) / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.block[j * this.nx + i] = v;
  }

  ci(x) { return clamp(Math.floor((x - this.x0) / this.cell), 0, this.nx - 1); }
  cj(z) { return clamp(Math.floor((z - this.z0) / this.cell), 0, this.nz - 1); }
  cx(i) { return this.x0 + (i + 0.5) * this.cell; }
  cz(j) { return this.z0 + (j + 0.5) * this.cell; }
  free(x, z) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return false;
    return this.block[j * this.nx + i] === 0;
  }

  // ближайшая свободная клетка (поиск кольцами)
  nearestFree(idx) {
    if (!this.block[idx]) return idx;
    const i0 = idx % this.nx, j0 = (idx / this.nx) | 0;
    for (let r = 1; r < 30; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        const k = j * this.nx + i;
        if (!this.block[k]) return k;
      }
    }
    return idx;
  }

  los(ax, az, bx, bz) {
    const d = dist(ax, az, bx, bz), steps = Math.ceil(d / (this.cell * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.free(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  // Путь от (ax,az) до (bx,bz): массив точек [x,z] без стартовой, последняя — сама цель
  findPath(ax, az, bx, bz) {
    if (this.los(ax, az, bx, bz) && this.free(ax, az)) return [[bx, bz]];
    const s = this.nearestFree(this.cj(az) * this.nx + this.ci(ax));
    const e = this.nearestFree(this.cj(bz) * this.nx + this.ci(bx));
    const key = s * 1e6 + e;
    let cells = this.cache.get(key);
    if (!cells) {
      cells = this.astar(s, e);
      if (this.cache.size > 6000) this.cache.clear();
      this.cache.set(key, cells);
    }
    if (!cells) return [[bx, bz]];
    // сглаживание: тянем нитку по видимости
    const pts = cells.map((k) => [this.cx(k % this.nx), this.cz((k / this.nx) | 0)]);
    pts.push([bx, bz]);
    const out = [];
    let cx = ax, cz = az, i = 0;
    while (i < pts.length) {
      let far = i;
      for (let k = pts.length - 1; k > i; k--) {
        if (this.los(cx, cz, pts[k][0], pts[k][1])) { far = k; break; }
      }
      out.push(pts[far]);
      cx = pts[far][0]; cz = pts[far][1];
      i = far + 1;
    }
    return out;
  }

  astar(s, e) {
    const nx = this.nx, stamp = ++this.stamp;
    const g = this.g, from = this.from, seen = this.seen, closed = this.closed, heap = this.heap, hf = this.hf;
    const ei = e % nx, ej = (e / nx) | 0;
    const h = (k) => {
      const di = Math.abs(k % nx - ei), dj = Math.abs(((k / nx) | 0) - ej);
      return (di + dj) + (1.4142 - 2) * Math.min(di, dj);
    };
    let hn = 0;
    const push = (k, f) => {
      let i = hn++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hf[p] <= f) break;
        heap[i] = heap[p]; hf[i] = hf[p]; i = p;
      }
      heap[i] = k; hf[i] = f;
    };
    const pop = () => {
      const top = heap[0];
      const lk = heap[--hn], lf = hf[hn];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hn) break;
        if (c + 1 < hn && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= lf) break;
        heap[i] = heap[c]; hf[i] = hf[c]; i = c;
      }
      heap[i] = lk; hf[i] = lf;
      return top;
    };
    g[s] = 0; seen[s] = stamp; from[s] = -1;
    push(s, h(s));
    const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    let guard = 0;
    while (hn > 0 && guard++ < 200000) {
      const k = pop();
      if (closed[k] === stamp) continue;
      closed[k] = stamp;
      if (k === e) {
        const path = [];
        for (let c = e; c !== -1; c = from[c]) path.push(c);
        path.reverse();
        return path;
      }
      const ki = k % nx, kj = (k / nx) | 0;
      for (let d = 0; d < 8; d++) {
        const i = ki + DI[d], j = kj + DJ[d];
        if (i < 0 || j < 0 || i >= nx || j >= this.nz) continue;
        const n = j * nx + i;
        if (this.block[n] || closed[n] === stamp) continue;
        if (d >= 4 && (this.block[kj * nx + i] || this.block[j * nx + ki])) continue;   // не срезаем углы
        const ng = g[k] + (d < 4 ? 1 : 1.4142);
        if (seen[n] !== stamp || ng < g[n]) {
          seen[n] = stamp; g[n] = ng; from[n] = k;
          push(n, ng + h(n));
        }
      }
    }
    return null;
  }
}
