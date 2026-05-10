// On-screen joystick + 4-button thumb-arc cluster.
//
// Aim model (PC mouse parallel):
//  - aimDir is sticky — last drag-set 2D unit vector persists indefinitely.
//  - Tap Attack = fire in current aimDir. Hold + drag from Attack updates
//    aimDir per-frame as the finger moves. Release after a drag fires once
//    in the new direction (Brawl-Stars-style aim-and-fire in one motion).
//  - Drag classification: if finger moves >12px from touch-down before
//    release, it's a drag (no fire on touch-down, fire on release).
//    Otherwise it's a tap (fire on touch-up).
//
// Throw model:
//  - Grabbed players/crates: handled by Stickman code on grab-release with
//    movement input (joystick direction at release).
//  - Wielded weapons (PC `Q` parity): swipe-from-Grab. Tap = grab/drop,
//    hold-still = continuous grab, drag >20px on Grab = throw weapon in
//    swipe direction on release (suppresses the regular grab toggle for
//    that touch).
import { clamp } from '../util/math.js';

const ATTACK_DRAG_PX = 12;
const GRAB_DRAG_PX   = 20;

export class TouchControls {
  constructor() {
    this.active = false;
    this.snapshot = {
      moveX: 0, moveY: 0, jump: false, attack: false, grab: false,
      special: false, throw: false, aimX: 1, aimY: 0, aimActive: true,
    };
    // Sticky aim direction — unit vector. Default right-facing.
    this.aimDir = { x: 1, y: 0 };
    // Settings — read once at construction, refreshed on Settings change
    // via `applySettings()`.
    this.aimSensitivity = parseFloat(localStorage.getItem('mc_aimSens') || '1') || 1;
    // Teardown callbacks — populated by _doc(); drained in destroy().
    this._teardown = [];
    this._build();
    this._doc(window, 'touchstart', () => this.enable(), { once: true, passive: true });
    if (navigator.maxTouchPoints > 0 && (matchMedia('(pointer: coarse)').matches)) {
      this.enable();
    }
  }

  // Helper: addEventListener with a matching removeEventListener queued in _teardown.
  _doc(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    this._teardown.push(() => target.removeEventListener(type, handler, opts));
  }

  enable() {
    this.active = true;
    document.body.classList.add('touch');
  }

  // Called by Settings panel when sensitivity slider changes.
  applySettings({ aimSensitivity } = {}) {
    if (aimSensitivity != null) this.aimSensitivity = aimSensitivity;
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

    // Right action cluster — 4 buttons.
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
    this.btnSpecial = mkBtn('special', '★');
    root.appendChild(cluster);

    this._wireJoystick();
    this._wireSimpleButton(this.btnJump,    'jump');
    this._wireSimpleButton(this.btnSpecial, 'special');
    this._wireAttackButton();
    this._wireGrabButton();
  }

  // ── Floating joystick ─────────────────────────────────────────────────
  _wireJoystick() {
    let joyId = null, joyCx = 0, joyCy = 0;

    const setNub = (ndx, ndy) => {
      this.nub.style.left = `calc(50% + ${ndx * 40}px)`;
      this.nub.style.top  = `calc(50% + ${ndy * 40}px)`;
    };

    const showJoyAt = (x, y) => {
      this.joy.classList.remove('hidden');
      joyCx = x; joyCy = y;
      this.joy.style.left = `${x - 70}px`;
      this.joy.style.top  = `${y - 70}px`;
      this.joy.style.bottom = 'auto';
      setNub(0, 0);
    };
    const hideJoy = () => {
      this.joy.classList.add('hidden');
      setNub(0, 0);
      this.snapshot.moveX = 0;
      this.snapshot.moveY = 0;
    };

    const isOverButton = (el) => {
      while (el) {
        if (el.classList?.contains?.('tbtn')) return true;
        el = el.parentElement;
      }
      return false;
    };

    const isMenuActive = () => {
      const cl = document.body.classList;
      return cl.contains('menu-open') || !cl.contains('in-game');
    };

    // Joystick lives on the LEFT half by default; on the RIGHT half when
    // left-handed mirror is on. Keep the cluster opposite.
    const joyOnLeft = () => !document.body.classList.contains('left-handed');

    const onDocStart = (ev) => {
      if (joyId !== null) return;
      if (isMenuActive()) return;
      const t = ev.changedTouches?.[0];
      if (!t) return;
      if (isOverButton(t.target)) return;
      const wantLeft = joyOnLeft();
      if (wantLeft && t.clientX > innerWidth * 0.5) return;
      if (!wantLeft && t.clientX < innerWidth * 0.5) return;
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
        this.snapshot.moveX = ndx * t2;
        this.snapshot.moveY = -ndy * t2;
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

    this._doc(document, 'touchstart',  onDocStart, { passive: false });
    this._doc(document, 'touchmove',   onDocMove,  { passive: false });
    this._doc(document, 'touchend',    onDocEnd);
    this._doc(document, 'touchcancel', onDocEnd);
  }

  // ── Simple press-and-hold button (Jump, Special) ──────────────────────
  _wireSimpleButton(el, prop) {
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
    this._doc(window, 'mouseup', release);
  }

  // ── Attack button: tap = fire, hold + drag = update aimDir + fire on release.
  _wireAttackButton() {
    const el = this.btnAttack;
    let touchId = null;
    let startX = 0, startY = 0;
    let dragged = false;

    const startPress = (id, x, y) => {
      touchId = id;
      startX = x; startY = y;
      dragged = false;
      el.classList.add('pressed');
    };
    const updateDrag = (x, y) => {
      const rawDx = x - startX;
      const rawDy = y - startY;
      const rawMag = Math.hypot(rawDx, rawDy);
      if (!dragged && rawMag > ATTACK_DRAG_PX) dragged = true;
      if (dragged && rawMag > 0) {
        // aimDir is a normalized unit vector — direction only, no magnitude.
        // Sensitivity does not affect a unit vector after normalization, so it is
        // not applied here. (The spec keeps `aimSensitivity` for a future use case
        // where partial-drag committing or snapping is added; it remains read by
        // applySettings() so the slider value is preserved.)
        this.aimDir.x = rawDx / rawMag;
        this.aimDir.y = -rawDy / rawMag;
        this.snapshot.aimX = this.aimDir.x;
        this.snapshot.aimY = this.aimDir.y;
        this.snapshot.aimActive = true;
      }
    };
    const endPress = () => {
      // Fire one frame regardless of whether it was tap or drag.
      this.snapshot.attack = true;
      // Clear on next animation frame so Stickman's edge-detector sees the press.
      requestAnimationFrame(() => requestAnimationFrame(() => { this.snapshot.attack = false; }));
      el.classList.remove('pressed');
      // Re-trigger animation by toggling the class.
      el.classList.add('pressed');
      requestAnimationFrame(() => el.classList.remove('pressed'));
      touchId = null; dragged = false;
    };

    el.addEventListener('touchstart', (ev) => {
      const t = ev.changedTouches[0];
      if (!t || touchId !== null) return;
      startPress(t.identifier, t.clientX, t.clientY);
      ev.preventDefault(); ev.stopPropagation();
    }, { passive: false });

    el.addEventListener('touchmove', (ev) => {
      if (touchId === null) return;
      for (const t of ev.changedTouches) {
        if (t.identifier !== touchId) continue;
        updateDrag(t.clientX, t.clientY);
        ev.preventDefault();
      }
    }, { passive: false });

    this._doc(document, 'touchmove', (ev) => {
      if (touchId === null) return;
      for (const t of ev.changedTouches) {
        if (t.identifier !== touchId) continue;
        updateDrag(t.clientX, t.clientY);
      }
    }, { passive: false });

    const onEnd = (ev) => {
      if (touchId === null) return;
      for (const t of ev.changedTouches) {
        if (t.identifier !== touchId) continue;
        endPress();
      }
    };
    const onCancel = (ev) => {
      if (touchId === null) return;
      for (const t of ev.changedTouches) {
        if (t.identifier !== touchId) continue;
        el.classList.remove('pressed');
        touchId = null;
        dragged = false;
      }
    };
    el.addEventListener('touchend',    onEnd,     { passive: false });
    el.addEventListener('touchcancel', onCancel,  { passive: false });
    this._doc(document, 'touchend',    onEnd,     { passive: false });
    this._doc(document, 'touchcancel', onCancel,  { passive: false });

    // Mouse for desktop testing (no drag-aim, just click-to-fire).
    el.addEventListener('mousedown', (ev) => {
      this.snapshot.attack = true;
      el.classList.add('pressed');
      requestAnimationFrame(() => requestAnimationFrame(() => { this.snapshot.attack = false; }));
      requestAnimationFrame(() => el.classList.remove('pressed'));
      ev.preventDefault();
    });
  }

  // ── Grab button: tap = grab/drop (held = continuous grab), drag = throw weapon.
  _wireGrabButton() {
    const el = this.btnGrab;
    let touchId = null;
    let startX = 0, startY = 0;
    let dragged = false;

    el.addEventListener('touchstart', (ev) => {
      const t = ev.changedTouches[0];
      if (!t || touchId !== null) return;
      touchId = t.identifier;
      startX = t.clientX; startY = t.clientY;
      dragged = false;
      this.snapshot.grab = true;
      el.classList.add('pressed');
      ev.preventDefault(); ev.stopPropagation();
    }, { passive: false });

    const onMove = (ev) => {
      if (touchId === null) return;
      for (const t of ev.changedTouches) {
        if (t.identifier !== touchId) continue;
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (!dragged && Math.hypot(dx, dy) > GRAB_DRAG_PX) {
          dragged = true;
          // Releasing grab while dragged would drop the held thing — that's
          // wrong for "swipe to throw weapon". Suppress grab so swipe-only
          // is treated as a separate gesture: drop grab immediately.
          this.snapshot.grab = false;
          el.classList.remove('pressed');
        }
      }
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    this._doc(document, 'touchmove', onMove, { passive: false });

    const onEnd = (ev) => {
      if (touchId === null) return;
      for (const t of ev.changedTouches) {
        if (t.identifier !== touchId) continue;
        if (dragged) {
          // Swipe — fire one-frame throw flag in the swipe direction. The
          // swipe vector overrides aimDir for this throw only by setting
          // aim to the swipe direction one frame before throw.
          const dx = t.clientX - startX;
          const dy = t.clientY - startY;
          const mag = Math.hypot(dx, dy);
          if (mag > 0) {
            this.aimDir.x = dx / mag;
            this.aimDir.y = -dy / mag;
            this.snapshot.aimX = this.aimDir.x;
            this.snapshot.aimY = this.aimDir.y;
            this.snapshot.aimActive = true;
          }
          this.snapshot.throw = true;
          requestAnimationFrame(() => requestAnimationFrame(() => { this.snapshot.throw = false; }));
        } else {
          // Tap — release grab cleanly.
          this.snapshot.grab = false;
          el.classList.remove('pressed');
        }
        touchId = null; dragged = false;
      }
    };
    const onCancel = (ev) => {
      if (touchId === null) return;
      for (const t of ev.changedTouches) {
        if (t.identifier !== touchId) continue;
        this.snapshot.grab = false;
        el.classList.remove('pressed');
        touchId = null;
        dragged = false;
      }
    };
    el.addEventListener('touchend',    onEnd,    { passive: false });
    el.addEventListener('touchcancel', onCancel, { passive: false });
    this._doc(document, 'touchend',    onEnd,    { passive: false });
    this._doc(document, 'touchcancel', onCancel, { passive: false });

    // Mouse: hold = grab, no swipe support (desktop only — mouse uses keyboard for throw).
    el.addEventListener('mousedown', (ev) => {
      this.snapshot.grab = true;
      el.classList.add('pressed');
      ev.preventDefault();
    });
    this._doc(window, 'mouseup', () => {
      this.snapshot.grab = false;
      el.classList.remove('pressed');
    });
  }

  getSnapshot() { return { ...this.snapshot }; }

  destroy() {
    for (const fn of this._teardown) { try { fn(); } catch (_) {} }
    this._teardown = [];
    document.getElementById('touch-root').innerHTML = '';
  }
}
