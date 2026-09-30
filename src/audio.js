'use strict';
// Звуки синтезом WebAudio — без файлов. По умолчанию выключены: игра для обеда на работе.

class Sfx {
  constructor() {
    this.on = false;
    try { this.on = localStorage.getItem('lesopilka_sound') === '1'; } catch (e) { /* нет хранилища — без звука */ }
    this.ctx = null;
    this.last = {};
  }

  unlock() {
    if (!this.on) return;
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('lesopilka_sound', this.on ? '1' : '0'); } catch (e) { /* ничего */ }
    if (this.on) { this.unlock(); this.play('upg'); }
  }

  tone(freq, dur, type = 'sine', vol = 0.12, slide = 0, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  play(name, k = 0) {
    if (!this.on || !this.ctx) return;
    const now = performance.now();
    const gap = { pick: 45, drop: 45, pay: 70, cash: 120, chop: 150, horn: 1500 }[name] || 0;
    if (gap && now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    switch (name) {
      case 'pick': this.tone(420 + Math.min(k, 30) * 18, 0.07, 'triangle', 0.07); break;
      case 'drop': this.tone(300, 0.07, 'triangle', 0.07, -80); break;
      case 'cash': this.tone(880, 0.08, 'sine', 0.1); this.tone(1320, 0.14, 'sine', 0.09, 0, 0.06); break;
      case 'pay': this.tone(620, 0.05, 'square', 0.03); break;
      case 'upg': this.tone(660, 0.08, 'triangle', 0.1); this.tone(990, 0.12, 'triangle', 0.1, 0, 0.07); break;
      case 'built': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.1, 0, i * 0.07)); break;
      case 'floor': [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.11, 0, i * 0.08)); break;
      case 'chop': this.tone(180, 0.09, 'sawtooth', 0.06, -60); break;
      case 'hit': this.tone(110, 0.25, 'square', 0.12, -60); this.tone(70, 0.35, 'sawtooth', 0.1, -30, 0.03); break;
      case 'horn': this.tone(392, 0.22, 'square', 0.05); this.tone(330, 0.3, 'square', 0.05, 0, 0.26); break;
      // спуск лодки: низкий гудок и всплеск
      case 'launch': this.tone(147, 0.7, 'sawtooth', 0.045); this.tone(196, 0.7, 'sawtooth', 0.035, 0, 0.04); this.tone(120, 0.45, 'triangle', 0.08, -70, 1.9); break;
    }
  }

  onEvent(e, g) {
    if (!this.on) return;
    if (e.t === 'x') {
      if (e.to.a === g.pl) this.play('pick', g.pl.stack.length);
      else if (e.from.a === g.pl) this.play('drop');
    } else if (e.t === 'm' && e.to.a === g.pl) this.play('cash');
    else if (e.t === 'pay') this.play('pay');
    else if (e.t === 'built') this.play('built');
    else if (e.t === 'floor' || e.t === 'zone' || e.t === 'win') this.play('floor');
    else if (e.t === 'fell') this.play('chop');
    else if (e.t === 'hit') this.play('hit');
    else if (e.t === 'hitW' && dist(e.x, e.z, g.pl.x, g.pl.z) < 30) this.play('hit');
    else if (e.t === 'horn' && dist(e.x, e.z, g.pl.x, g.pl.z) < 30) this.play('horn');
    else if (e.t === 'casinoPaid') this.play('cash');   // выигрыш в казино
    else if (e.t === 'launch' && STATIONS[e.st] && dist(STATIONS[e.st].x, STATIONS[e.st].z, g.pl.x, g.pl.z) < 40) this.play('launch');
  }
}
