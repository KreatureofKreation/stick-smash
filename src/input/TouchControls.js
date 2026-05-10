// On-screen joystick + action buttons. Auto-enables on touch devices.
//
// Behavior notes:
//  - Joystick is FLOATING: a touchstart anywhere in the left half of the
//    screen spawns the joy at that point. Releases anywhere finalize move.
//    This is much friendlier for variable hand sizes / phone orientations
//    than the fixed-corner joy we used to have.
//  - Aim button is a TOGGLE (tap on / tap off). Holding aim used to require
//    a third finger to also press Attack — toggling lets the player use the
//    same right-thumb that runs Attack to enter/exit aim.
//  - Move tracking is bound to the document (not the joy element). Once a
//    touch starts on the joy area, it's tracked even if the finger drags
//    off the visual element — no more dead-zones at the edges.
import { clamp } from '../util/math.js';

export class TouchControls {
  constructor() {
    this.active = false;
    this.snapshot = {
      moveX: 0, moveY: 0, jump: false, attack: false, grab: false,
      special: false, throw: false, aimX: 1, aimY: 0, aimActive: false,
    };
    this.aimMode = false;
    this._build();
    addEventListener('touchstart', () => this.enable(), { once: true, passive: true });
    if (navigator.maxTouchPoints > 0 && (matchMedia('(pointer: coarse)').matches)) {
      this.enable();
    }
  }

  enable() {
    this.active = true;
    document.body.classList.add('touch');
  }

  _build() {
    const root = document.getElementById('touch-root');
    root.innerHTML = '';

    // Joystick (hidden until touched).
    const joy = document.createElement('div');
    joy.className = 'joy hidden';
    const nub = document.createElement('div');
    nub.className = 'nub';
    joy.appendChild(nub);
    root.appendChild(joy);
    this.joy = joy; this.nub = nub;

    // Right action cluster.
    const cluster = document.createElement('div');
    cluster.className = 'btn-cluster';
    const mkBtn = (cls, label) => {
      const b = document.createElement('div');
      b.className = `tbtn ${cls}`;
      b.textContent = label;
      cluster.appendChild(b);
      return b;
    };
    this.btnAttack  = mkBtn('attack',  '✊');
    this.btnJump    = mkBtn('jump',    '⤴');
    this.btnGrab    = mkBtn('grab',    '✋');
    this.btnAim     = mkBtn('aim',     'AIM');
    this.btnThrow   = mkBtn('throw',   '🤾');
    this.btnSpecial = mkBtn('special', '★');
    root.appendChild(cluster);

    // ── Floating joystick ───────────────────────────────────────────────
    let joyId = null, joyCx = 0, joyCy = 0;

    const setNub = (ndx, ndy) => {
      nub.style.left = `calc(50% + ${ndx * 40}px)`;
      nub.style.top  = `calc(50% + ${ndy * 40}px)`;
    };

    const showJoyAt = (x, y) => {
      joy.classList.remove('hidden');
      joyCx = x; joyCy = y;
      // Position center of joy at (x, y).
      joy.style.left = `${x - 70}px`;
      joy.style.top  = `${y - 70}px`;
      joy.style.bottom = 'auto';
      setNub(0, 0);
    };
    const hideJoy = () => {
      joy.classList.add('hidden');
      setNub(0, 0);
      this.snapshot.moveX = 0;
      this.snapshot.moveY = 0;
      if (this.aimMode) this.snapshot.aimActive = false;
    };

    // touchstart on document — claim the touch if it landed in the left
    // half of the screen and isn't on a button.
    const isOverButton = (el) => {
      while (el) {
        if (el.classList?.contains?.('tbtn')) return true;
        el = el.parentElement;
      }
      return false;
    };

    // Only claim touches when a match is actually live AND no menu is open.
    // Without this gate the floating-joystick handler called preventDefault()
    // on every left-half touch — which silently swallowed every menu tap on
    // mobile, making the menu unusable.
    const isMenuActive = () => {
      const cl = document.body.classList;
      return cl.contains('menu-open') || !cl.contains('in-game');
    };

    const onDocStart = (ev) => {
      if (joyId !== null) return;
      if (isMenuActive()) return;
      const t = ev.changedTouches?.[0];
      if (!t) return;
      if (isOverButton(t.target)) return;
      if (t.clientX > innerWidth * 0.5) return; // right half is for buttons
      joyId = t.identifier;
      showJoyAt(t.clientX, t.clientY);
      ev.preventDefault();
    };

    const onDocMove = (ev) => {
      if (joyId === null) return;
      if (isMenuActive()) { joyId = null; hideJoy(); return; }
      for (const t of ev.changedTouches) {
        if (t.identifier !== joyId) continue;
        const dx = t.clientX - joyCx;
        const dy = t.clientY - joyCy;
        const r = 60;
        const mag = Math.hypot(dx, dy);
        const ndx = mag > 0 ? dx / mag : 0;
        const ndy = mag > 0 ? dy / mag : 0;
        const m = clamp(mag / r, 0, 1);
        setNub(ndx * m, ndy * m);
        const t2 = m > 0.15 ? m : 0;
        if (this.aimMode) {
          this.snapshot.aimX = ndx;
          this.snapshot.aimY = -ndy;
          this.snapshot.aimActive = m > 0.2;
          this.snapshot.moveX = 0;
          this.snapshot.moveY = 0;
        } else {
          this.snapshot.moveX = ndx * t2;
          this.snapshot.moveY = -ndy * t2;
        }
        ev.preventDefault();
      }
    };

    const onDocEnd = (ev) => {
      if (joyId === null) return;
      for (const t of ev.changedTouches) {
        if (t.identifier !== joyId) continue;
        joyId = null;
        hideJoy();
      }
    };

    document.addEventListener('touchstart', onDocStart, { passive: false });
    document.addEventListener('touchmove',  onDocMove,  { passive: false });
    document.addEventListener('touchend',   onDocEnd);
    document.addEventListener('touchcancel', onDocEnd);

    // ── Action buttons ──────────────────────────────────────────────────
    const bindBtn = (el, prop) => {
      const ids = new Set();
      const press = (ev) => {
        for (const t of (ev.changedTouches ?? [ev])) ids.add(t.identifier ?? 'mouse');
        this.snapshot[prop] = true;
        el.classList.add('pressed');
        ev.preventDefault();
        ev.stopPropagation();
      };
      const release = (ev) => {
        for (const t of (ev.changedTouches ?? [ev])) ids.delete(t.identifier ?? 'mouse');
        if (ids.size === 0) {
          this.snapshot[prop] = false;
          el.classList.remove('pressed');
        }
      };
      el.addEventListener('touchstart',  press,   { passive: false });
      el.addEventListener('touchend',    release, { passive: false });
      el.addEventListener('touchcancel', release, { passive: false });
      el.addEventListener('mousedown',   press);
      addEventListener('mouseup',        release);
    };
    bindBtn(this.btnAttack,  'attack');
    bindBtn(this.btnJump,    'jump');
    bindBtn(this.btnGrab,    'grab');
    bindBtn(this.btnThrow,   'throw');
    bindBtn(this.btnSpecial, 'special');

    // ── Aim toggle ──────────────────────────────────────────────────────
    // Tap to enter aim mode (joystick now steers aim), tap again to exit.
    // While aim is active, the player can still tap Attack with the same
    // thumb that toggled aim — that's the whole point of toggling vs hold.
    const setAim = (on) => {
      this.aimMode = on;
      this.btnAim.classList.toggle('pressed', on);
      if (!on) this.snapshot.aimActive = false;
    };
    const toggleAim = (ev) => {
      setAim(!this.aimMode);
      ev.preventDefault();
      ev.stopPropagation();
    };
    this.btnAim.addEventListener('touchstart', toggleAim, { passive: false });
    this.btnAim.addEventListener('mousedown',  toggleAim);
  }

  getSnapshot() { return { ...this.snapshot }; }
  destroy() { document.getElementById('touch-root').innerHTML = ''; }
}
