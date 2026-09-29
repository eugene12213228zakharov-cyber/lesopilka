'use strict';
// Управление: WASD/стрелки и «джойстик» мышью или пальцем — зажал и тянешь.

class Input {
  constructor(canvas, game, view, ui, sfx) {
    this.g = game; this.view = view; this.ui = ui; this.sfx = sfx;
    this.keys = new Set();
    this.joy = null;
    const joyEl = $('joy'), knob = $('joyKnob');
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;
      this.keys.add(e.code);
      if (e.code === 'KeyU') ui.toggle('upg');
      else if (e.code === 'KeyB') ui.toggle('tower');
      else if (e.code === 'KeyR') ui.toggle('work');
      else if (e.code === 'KeyM') { sfx.toggle(); ui.toast(sfx.on ? '🔊 Звук включён' : '🔇 Звук выключен'); }
      else if (e.code === 'Escape') { ui.close(); ui.hideModal(); }
      if (e.code.startsWith('Arrow')) e.preventDefault();
      sfx.unlock();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.stopJoy(); });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      this.joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ничего */ }
      joyEl.style.left = e.clientX + 'px';
      joyEl.style.top = e.clientY + 'px';
      knob.style.transform = 'translate(-50%, -50%)';
      joyEl.classList.remove('hidden');
      sfx.unlock();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.joy || e.pointerId !== this.joy.id) return;
      this.joy.x = e.clientX; this.joy.y = e.clientY;
      let dx = this.joy.x - this.joy.x0, dy = this.joy.y - this.joy.y0;
      const d = Math.hypot(dx, dy), m = 48;
      if (d > m) { dx *= m / d; dy *= m / d; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    const up = (e) => { if (this.joy && e.pointerId === this.joy.id) this.stopJoy(); };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      view.zoom = clamp(view.zoom * (e.deltaY > 0 ? 1.08 : 0.93), 0.55, 1.9);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  stopJoy() { this.joy = null; $('joy').classList.add('hidden'); }

  update() {
    let x = 0, z = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (this.joy) {
      const dx = this.joy.x - this.joy.x0, dy = this.joy.y - this.joy.y0, d = Math.hypot(dx, dy);
      if (d > 6) { const s = Math.min(1, d / 40); x += (dx / d) * s; z += (dy / d) * s; }
    }
    const m = Math.hypot(x, z);
    if (m > 1) { x /= m; z /= m; }
    this.g.input.x = x;
    this.g.input.z = z;
  }
}
