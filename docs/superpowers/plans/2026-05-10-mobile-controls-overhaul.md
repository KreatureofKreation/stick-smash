# Mobile Controls Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current 6-button + AIM-toggle mobile control scheme with a 4-button drag-from-Attack + swipe-from-Grab model that mirrors PC mouse-aim semantics, plus haptics, low-opacity visuals, settings, and a first-run tutorial.

**Architecture:** Single `TouchControls` rewrite keeps the per-frame snapshot shape identical so `Input.js` and `Game.js` need only minimal changes. New `haptics.js` helper centralizes vibration gating. New `TutorialOverlay.js` is a self-contained DOM component. Settings live in existing `Menu._settings()` and persist to `localStorage`.

**Tech Stack:** Vanilla ES modules, DOM, CSS (no build step). Three.js + Cannon-es underneath but untouched.

**Spec:** [docs/superpowers/specs/2026-05-10-mobile-controls-overhaul-design.md](../specs/2026-05-10-mobile-controls-overhaul-design.md)

**Verification:** This project has no unit-test framework. Tasks verify in the browser via `preview_*` tools. Per project handoff, `preview_screenshot` times out on rAF-busy renders — use `preview_eval` + `getBoundingClientRect()` and `preview_console_logs`. Force `body.touch` in console (`document.body.classList.add('touch')`) to mimic mobile on desktop.

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/input/TouchControls.js` | Modified | 4-button cluster, drag-from-Attack aim, swipe-from-Grab throw, sticky `aimDir`, Settings-driven sensitivity. |
| `src/input/Input.js` | Modified (small) | Touch path always reports `aimActive=true` (sticky model). |
| `src/util/haptics.js` | New | Single `vibrate(ms)` helper gated by Settings + feature detection. |
| `src/entities/Stickman.js` | Modified (small) | `vibrate()` calls at the 3 ground-jump sites (skip air jumps), at `takeDamage` for both attacker-local and victim-local cases. |
| `src/Game.js` | Modified (small) | `vibrate()` call in `specialPressed` handler is in Stickman.js already; here just confirm haptics module loads. |
| `src/ui/styles.css` | Modified | Drop `.tbtn.throw`, `.tbtn.aim`. Add low-opacity baseline + bright pressed states. Add `--btn-scale` var, squash + overshoot keyframes, radial ripple, `.left-handed` mirror class, joystick opacity tweak. |
| `src/ui/Menu.js` | Modified | Add "Mobile Controls" section in `_settings()` with 5 controls, persist to `localStorage`, apply via CSS vars + `body` classes. |
| `src/ui/TutorialOverlay.js` | New | First-run mobile overlay with 5 sequential ghost-finger CSS animations + Skip button. |
| `index.html` | Modified (one line) | Import + bootstrap `TutorialOverlay` after a match starts the first time on a touch device. |

---

## Task 1: CSS — low-opacity buttons + scale var + mirror class + squash animation

**Files:**
- Modify: `src/ui/styles.css:108-124`

- [ ] **Step 1: Replace the `.joy`, `.joy .nub`, and all `.tbtn*` rules**

Open `src/ui/styles.css`. Find the block starting at line 105 (`#touch-root { display: none; }`). Replace lines 108–124 (the joystick and old button rules) with:

```css
/* Floating joystick — barely visible at rest so it doesn't fight gameplay attention. */
.joy { position: absolute; width: 140px; height: 140px; border-radius: 50%; background: rgba(255,255,255,0.06); border: 2px solid rgba(255,255,255,0.14); pointer-events: none; touch-action: none; transition: opacity 0.12s; opacity: 1; left: 0; top: 0; }
.joy.hidden { opacity: 0; }
.joy .nub { position: absolute; left: 50%; top: 50%; width: 60px; height: 60px; border-radius: 50%; background: rgba(255,255,255,0.22); transform: translate(-50%, -50%); border: 2px solid rgba(255,255,255,0.4); transition: background 0.1s; }

/* Right action cluster — 4 buttons in a thumb arc. Sized via --btn-scale. */
:root { --btn-scale: 1; }
.btn-cluster { position: absolute; right: max(12px, var(--safe-r)); bottom: max(12px, var(--safe-b)); width: calc(220px * var(--btn-scale)); height: calc(220px * var(--btn-scale)); pointer-events: none; }

/* Buttons: nearly invisible at rest (12% fill, 40% border), pop on press. */
.tbtn { position: absolute; border-radius: 50%; color: rgba(255,255,255,0.5); font-weight: 800; font-size: 14px; pointer-events: auto; touch-action: none; display: flex; align-items: center; justify-content: center; user-select: none; -webkit-user-select: none; transition: transform 0.08s ease-out, background 0.1s, border-color 0.1s, color 0.1s; will-change: transform; }
.tbtn::before { content: ''; position: absolute; inset: 0; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,0.4), transparent 60%); opacity: 0; transition: opacity 0.25s ease-out; pointer-events: none; }
.tbtn.pressed::before { opacity: 1; transition: opacity 0s; animation: tbtn-ripple 0.35s ease-out forwards; }
@keyframes tbtn-ripple { 0% { opacity: 0.7; transform: scale(0.6); } 100% { opacity: 0; transform: scale(1.3); } }

.tbtn:active, .tbtn.pressed { color: #fff; }
.tbtn.pressed { animation: tbtn-overshoot 0.15s ease-out; }
@keyframes tbtn-overshoot { 0% { transform: scale(0.92); } 60% { transform: scale(1.06); } 100% { transform: scale(1); } }

/* Layout: Attack large bottom-right corner, Jump above, Grab + Special on inner arc. */
.tbtn.attack  { right: 8px;   bottom: 8px;   width: calc(96px * var(--btn-scale)); height: calc(96px * var(--btn-scale)); background: rgba(255,77,109,0.12); border: 2px solid rgba(255,77,109,0.40); font-size: 28px; }
.tbtn.jump    { right: 8px;   bottom: calc(110px * var(--btn-scale)); width: calc(72px * var(--btn-scale)); height: calc(72px * var(--btn-scale)); background: rgba(102,226,163,0.12); border: 2px solid rgba(102,226,163,0.40); font-size: 22px; }
.tbtn.grab    { right: calc(110px * var(--btn-scale)); bottom: 30px; width: calc(68px * var(--btn-scale)); height: calc(68px * var(--btn-scale)); background: rgba(255,204,51,0.10); border: 2px solid rgba(255,204,51,0.35); font-size: 18px; }
.tbtn.special { right: calc(110px * var(--btn-scale)); bottom: calc(110px * var(--btn-scale)); width: calc(64px * var(--btn-scale)); height: calc(64px * var(--btn-scale)); background: rgba(220,140,255,0.12); border: 2px solid rgba(220,140,255,0.40); font-size: 20px; }

/* Pressed state — bright fill matches per-button hue. */
.tbtn.attack.pressed  { background: rgba(255,77,109,0.6);  border-color: #fff; }
.tbtn.jump.pressed    { background: rgba(102,226,163,0.6); border-color: #fff; }
.tbtn.grab.pressed    { background: rgba(255,204,51,0.6);  border-color: #fff; }
.tbtn.special.pressed { background: rgba(220,140,255,0.6); border-color: #fff; }

/* Left-handed mirror — swap cluster + joystick spawn region. */
body.touch.left-handed .btn-cluster { right: auto; left: max(12px, var(--safe-l)); }
body.touch.left-handed .tbtn.attack  { right: auto; left: 8px; }
body.touch.left-handed .tbtn.jump    { right: auto; left: 8px; }
body.touch.left-handed .tbtn.grab    { right: auto; left: calc(110px * var(--btn-scale)); }
body.touch.left-handed .tbtn.special { right: auto; left: calc(110px * var(--btn-scale)); }
```

- [ ] **Step 2: Verify the file compiles in the browser**

Run: `npm run dev` (starts dev server on :5173). Use `preview_start` to open it, then `preview_console_logs` to confirm no CSS parse errors.

Expected: no errors. Old `.tbtn.throw` and `.tbtn.aim` rules are gone (deleted in Step 1's full replacement of lines 108–124).

- [ ] **Step 3: Visually verify cluster appears with new style**

In the preview console (preview_eval):

```js
document.body.classList.add('touch');
document.body.classList.add('in-game');
const root = document.getElementById('touch-root');
root.innerHTML = `<div class="btn-cluster">
  <div class="tbtn attack">✊</div>
  <div class="tbtn jump">⤴</div>
  <div class="tbtn grab">✋</div>
  <div class="tbtn special">★</div>
</div>`;
const els = ['.tbtn.attack', '.tbtn.jump', '.tbtn.grab', '.tbtn.special'].map(s => document.querySelector(s));
els.map(e => ({ cls: e.className, rect: e.getBoundingClientRect() }));
```

Expected: 4 buttons exist, sized 96/72/68/64 (Attack largest), positioned bottom-right.

- [ ] **Step 4: Verify left-handed mirror swaps to bottom-left**

In preview console:

```js
document.body.classList.add('left-handed');
document.querySelector('.tbtn.attack').getBoundingClientRect();
```

Expected: `.left` value is small (~8 + safe-area), `.right` value is large. Then remove the class:

```js
document.body.classList.remove('left-handed');
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/styles.css
git commit -m "feat(mobile): low-opacity 4-button cluster styles + scale var + mirror

- Drop .tbtn.throw and .tbtn.aim (no longer in cluster)
- Buttons at rest are nearly invisible (12% fill, 40% border)
- Pressed state: bright per-button hue + squash-overshoot animation + radial ripple
- New --btn-scale CSS var for S/M/L sizing
- New body.touch.left-handed class swaps cluster to bottom-left
- Joystick opacity dropped slightly (.06 / .22) for less attention pull"
```

---

## Task 2: TouchControls rewrite — 4 buttons, drag-from-Attack, sticky aim

**Files:**
- Modify: `src/input/TouchControls.js` (full rewrite)

- [ ] **Step 1: Replace the file with the new implementation**

Replace the entire contents of `src/input/TouchControls.js` with:

```js
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

    document.addEventListener('touchstart', onDocStart, { passive: false });
    document.addEventListener('touchmove',  onDocMove,  { passive: false });
    document.addEventListener('touchend',   onDocEnd);
    document.addEventListener('touchcancel', onDocEnd);
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
    addEventListener('mouseup',        release);
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
      const dx = (x - startX) * this.aimSensitivity;
      const dy = (y - startY) * this.aimSensitivity;
      const mag = Math.hypot(dx, dy);
      if (!dragged && mag > ATTACK_DRAG_PX) dragged = true;
      if (dragged && mag > 0) {
        // Screen Y grows down, world Y grows up — invert.
        this.aimDir.x = dx / mag;
        this.aimDir.y = -dy / mag;
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

    document.addEventListener('touchmove', (ev) => {
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
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onEnd, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: false });
    document.addEventListener('touchcancel', onEnd, { passive: false });

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
    document.addEventListener('touchmove', onMove, { passive: false });

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
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onEnd, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: false });
    document.addEventListener('touchcancel', onEnd, { passive: false });

    // Mouse: hold = grab, no swipe support (desktop only — mouse uses keyboard for throw).
    el.addEventListener('mousedown', (ev) => {
      this.snapshot.grab = true;
      el.classList.add('pressed');
      ev.preventDefault();
    });
    addEventListener('mouseup', () => {
      this.snapshot.grab = false;
      el.classList.remove('pressed');
    });
  }

  getSnapshot() { return { ...this.snapshot }; }
  destroy() { document.getElementById('touch-root').innerHTML = ''; }
}
```

- [ ] **Step 2: Verify import succeeds + no console errors on dev server**

Reload the dev server. In `preview_console_logs`, expect no errors related to `TouchControls.js`.

- [ ] **Step 3: Verify cluster builds with 4 buttons (no Throw, no AIM)**

In preview console:

```js
document.body.classList.add('touch', 'in-game');
document.querySelectorAll('#touch-root .tbtn').forEach(b => console.log(b.className));
```

Expected: 4 lines printed: `tbtn attack`, `tbtn jump`, `tbtn grab`, `tbtn special`. No `throw` or `aim` classes.

- [ ] **Step 4: Verify tap-Attack fires for one frame**

In preview console:

```js
const tc = window.__game__?.input?.touch;
if (!tc) console.log('expose game on window first or wait for match');
else {
  const before = tc.getSnapshot().attack;
  tc.btnAttack.dispatchEvent(new MouseEvent('mousedown'));
  setTimeout(() => console.log('after-mousedown:', tc.getSnapshot().attack), 0);
  setTimeout(() => console.log('after-2-rafs:', tc.getSnapshot().attack), 50);
}
```

Expected: `after-mousedown` is `true`, `after-2-rafs` is `false`.

If `window.__game__` isn't already exposed, edit `src/Game.js` to set `window.__game__ = this` at end of constructor (revert later).

- [ ] **Step 5: Verify drag-from-Attack rotates aim**

Start a solo match. In preview console (with touch enabled):

```js
const tc = window.__game__.input.touch;
const el = tc.btnAttack;
const r = el.getBoundingClientRect();
const cx = r.left + r.width/2, cy = r.top + r.height/2;
function ts(type, x, y) {
  const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
  el.dispatchEvent(new TouchEvent(type, { changedTouches: [t], targetTouches: [t], touches: [t], cancelable: true, bubbles: true }));
}
ts('touchstart', cx, cy);
ts('touchmove', cx + 50, cy - 50);
console.log('aimDir after up-right drag:', tc.aimDir);
ts('touchend', cx + 50, cy - 50);
```

Expected: `aimDir.x ≈ 0.707`, `aimDir.y ≈ 0.707` (because screen-Y is inverted).

- [ ] **Step 6: Commit**

```bash
git add src/input/TouchControls.js
git commit -m "feat(mobile): rewrite TouchControls — 4 buttons, drag-from-Attack, swipe-from-Grab

- Drop AIM toggle + Throw button. 4-button cluster: Attack, Jump, Grab, Special.
- Sticky aimDir (default {1,0}). Tap Attack = fire in aimDir.
- Hold + drag (>12px) Attack = update aimDir per-frame, release fires.
- Tap Grab = grab/drop. Hold-still = continuous grab.
- Drag (>20px) Grab = swipe-throw wielded weapon in swipe direction.
- aimSensitivity multiplier (Settings-driven, default 1.0).
- Joystick: same floating-left model, supports left-handed swap via body class."
```

---

## Task 3: Input.js — sticky aim path

**Files:**
- Modify: `src/input/Input.js:191-205, 226-243`

The new TouchControls always reports `aimActive=true` because aimDir is sticky. Existing `getCombined()` and `getKbMouseTouch()` checked `t?.aimActive` to decide whether to use touch aim. Now touch aim should always win over keyboard's empty default — but should still lose to gamepad's R-stick (gamepad is a higher-priority device when present).

- [ ] **Step 1: Update `getKbMouseTouch()` (line 191)**

Find this block:

```js
  getKbMouseTouch() {
    const a = this.getKbSnapshot();
    const t = this.touch.active ? this.getTouchSnapshot() : null;
    const o = { ...a };
    o.moveX = a.moveX || (t?.moveX ?? 0);
    o.moveY = a.moveY || (t?.moveY ?? 0);
    o.jump = a.jump || (t?.jump ?? false);
    o.attack = a.attack || (t?.attack ?? false);
    o.grab = a.grab || (t?.grab ?? false);
    o.special = a.special || (t?.special ?? false);
    o.throw = a.throw || (t?.throw ?? false);
    if (t?.aimActive) { o.aimX = t.aimX; o.aimY = t.aimY; o.aimActive = true; }
    else { o.aimX = a.aimX; o.aimY = a.aimY; o.aimActive = false; }
    return o;
  }
```

The logic is already correct — `t?.aimActive` is true now whenever touch is active (sticky). No change needed.

- [ ] **Step 2: Update `getCombined()` (line 226)**

Find this block:

```js
  getCombined() {
    const a = this.getKbSnapshot();
    const g = this.getGamepadSnapshot(this.gamepadIdx);
    const t = this.touch.active ? this.getTouchSnapshot() : null;
    ...
    if (g.aimActive) { o.aimX = g.aimX; o.aimY = g.aimY; o.aimActive = true; }
    else if (t?.aimActive) { o.aimX = t.aimX; o.aimY = t.aimY; o.aimActive = true; }
    else { o.aimX = a.aimX; o.aimY = a.aimY; o.aimActive = false; }
    return o;
  }
```

Logic is correct — gamepad R-stick still wins over sticky touch aim when present. No change needed.

- [ ] **Step 3: No code change required — confirm by reading the diff**

Run: `git diff src/input/Input.js`

Expected: empty.

- [ ] **Step 4: Skip commit — nothing to commit for this task**

---

## Task 4: Haptics helper module

**Files:**
- Create: `src/util/haptics.js`

- [ ] **Step 1: Create the file**

Write `src/util/haptics.js`:

```js
// Tiny haptic-feedback helper. Single-source-of-truth for `navigator.vibrate`
// with two gates: feature detection + a Settings-driven toggle stored in
// localStorage under 'mc_haptics'. iOS Safari and any non-touch browser
// where vibrate isn't defined will silently no-op.
//
// Usage: vibrate(15) — fire a 15ms pulse if supported and enabled.
//
// Default: enabled. The Settings panel writes '0' to disable.

let cached = null; // 1 = enabled, 0 = disabled, null = uncached

function isEnabled() {
  if (cached !== null) return cached === 1;
  const v = localStorage.getItem('mc_haptics');
  cached = (v === '0') ? 0 : 1;
  return cached === 1;
}

export function setHapticsEnabled(on) {
  cached = on ? 1 : 0;
  localStorage.setItem('mc_haptics', on ? '1' : '0');
}

export function vibrate(ms) {
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;
  if (!isEnabled()) return;
  try { navigator.vibrate(ms); } catch (_) { /* swallow — non-critical */ }
}
```

- [ ] **Step 2: Verify the module loads in the browser**

In preview console:

```js
const m = await import('/src/util/haptics.js');
m.vibrate(10);
console.log('vibrate fn:', typeof m.vibrate, 'setEnabled:', typeof m.setHapticsEnabled);
```

Expected: both log as `'function'`. No error.

- [ ] **Step 3: Commit**

```bash
git add src/util/haptics.js
git commit -m "feat(mobile): add haptics helper with Settings + feature gating

Single-source vibrate(ms) helper. Reads enabled state from
localStorage('mc_haptics'), defaults to on. No-ops silently
on iOS Safari (no navigator.vibrate). Cached after first read
so the gameplay loop doesn't hit localStorage every hit."
```

---

## Task 5: Wire haptics into game events

**Files:**
- Modify: `src/entities/Stickman.js` (3 jump sites + takeDamage + specialPressed)

- [ ] **Step 1: Add the import at the top of `src/entities/Stickman.js`**

Find the existing import block (top of file). Add this line after the other relative imports:

```js
import { vibrate } from '../util/haptics.js';
```

- [ ] **Step 2: Hook hit-landed + hit-taken in `takeDamage` (line 269)**

Find this line in `takeDamage` (around line 315):

```js
      if (this === game.localPlayer && game.hud) game.hud.damageFlash?.(amount);
```

Replace it with:

```js
      if (this === game.localPlayer && game.hud) game.hud.damageFlash?.(amount);
      // Haptics: hit-taken on local player (stronger), hit-landed when
      // the local player did the damage (weaker).
      if (this === game.localPlayer && this.isLocal) vibrate(25);
      else if (opts.attacker && opts.attacker === game.localPlayer) vibrate(15);
```

- [ ] **Step 3: Hook ground-jump haptics at the 3 jump sites**

a) Line 1021 (slide jump). Find:

```js
        audio.jump();
      }
      // Skip the standard accel/friction block.
```

Replace with:

```js
        audio.jump();
        if (this === this.game?.localPlayer) vibrate(12);
      }
      // Skip the standard accel/friction block.
```

b) Line 1082 (curved-gravity ground jump). Find:

```js
            audio.jump?.();
            this.grounded = false;
          } else if (this.airJumpsLeft > 0) {
```

Replace with:

```js
            audio.jump?.();
            if (this === this.game?.localPlayer) vibrate(12);
            this.grounded = false;
          } else if (this.airJumpsLeft > 0) {
```

c) Line 1145 (flat-gravity ground jump). Find:

```js
      this._jumpInputCooldown = tNowJump + 90;
      audio.jump();
    } else if (this.input.jumpPressed && !inJumpCD && this.airJumpsLeft > 0 && !this.grounded) {
```

Replace with:

```js
      this._jumpInputCooldown = tNowJump + 90;
      audio.jump();
      if (this === this.game?.localPlayer) vibrate(12);
    } else if (this.input.jumpPressed && !inJumpCD && this.airJumpsLeft > 0 && !this.grounded) {
```

- [ ] **Step 4: Hook special haptics**

Find the `specialPressed` block (line 1297):

```js
      // Special / weapon alt fire / force powers.
      if (now.specialPressed) {
        const tNow = performance.now();
```

Replace with:

```js
      // Special / weapon alt fire / force powers.
      if (now.specialPressed) {
        if (this === this.game?.localPlayer) vibrate(40);
        const tNow = performance.now();
```

- [ ] **Step 5: Verify no syntax errors**

In preview console after dev server reload:

```js
console.log(window.__game__ ? 'game loaded' : 'no game on window — check Game.js exposure');
```

Expected: dev server reloads cleanly. No console errors mentioning Stickman or haptics.

- [ ] **Step 6: Verify haptic call fires when local player jumps**

Wrap `navigator.vibrate` temporarily for the test:

```js
const orig = navigator.vibrate?.bind(navigator);
window.__vibCalls = [];
navigator.vibrate = (ms) => { window.__vibCalls.push(ms); orig?.(ms); return true; };
```

Now play (start solo match), jump once. Then in console:

```js
console.log(window.__vibCalls);
```

Expected: array contains `12` (from the ground jump).

Restore: `navigator.vibrate = orig;`

- [ ] **Step 7: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(mobile): wire haptic feedback into damage, jump, special

Local-player events fire vibrate():
- 25ms on hit taken
- 15ms on hit landed
- 12ms on ground jump (3 sites — flat, curved, slide)
- 40ms on special activation

Air double-jumps and small DoT skipped to avoid spam.
All gated by Settings + feature detection in haptics.js."
```

---

## Task 6: Settings panel — Mobile Controls section

**Files:**
- Modify: `src/ui/Menu.js` (`_settings()` method, around line 341)

- [ ] **Step 1: Add the import at the top of Menu.js**

Find the existing imports. Add:

```js
import { setHapticsEnabled } from '../util/haptics.js';
```

- [ ] **Step 2: Add a helper near the top of the Menu class to apply settings**

After the `_stopPadPolling` method (around line 44), add:

```js
  // Apply persisted Mobile Controls settings to the live document + input layer.
  // Called from _settings() on every change, and from constructor on boot
  // so left-handed/scale survive page reloads.
  _applyMobileSettings() {
    const sens   = parseFloat(localStorage.getItem('mc_aimSens') || '1') || 1;
    const scale  = localStorage.getItem('mc_btnScale') || 'M';
    const lefty  = localStorage.getItem('mc_lefty') === '1';
    const haptic = localStorage.getItem('mc_haptics') !== '0';
    document.documentElement.style.setProperty('--btn-scale', scale === 'S' ? '0.85' : scale === 'L' ? '1.15' : '1');
    document.body.classList.toggle('left-handed', lefty);
    setHapticsEnabled(haptic);
    if (this.game?.input?.touch?.applySettings) {
      this.game.input.touch.applySettings({ aimSensitivity: sens });
    }
  }
```

Then in the constructor (around line 8), after `this.show(...)`, add a call so settings apply on first load:

Find:

```js
    this.show(params.get('room') ? 'online' : 'main');
  }
```

Replace with:

```js
    this.show(params.get('room') ? 'online' : 'main');
    this._applyMobileSettings();
  }
```

- [ ] **Step 3: Append the Mobile Controls section to `_settings()`**

Find the existing `_settings()` method. The shell HTML ends at:

```js
        </div>
        <div class="btn-row">
          <button class="btn primary" data-act="back">← BACK</button>
        </div>
      </div>
    `);
```

Replace that with:

```js
        </div>
        <hr class="sep">
        <h2>MOBILE CONTROLS</h2>
        <div class="mobile-settings">
          <label>Aim Sensitivity
            <input type="range" min="0.5" max="2" step="0.05" id="mc-sens" value="${parseFloat(localStorage.getItem('mc_aimSens') || '1')}" />
            <span id="mc-sens-val">${parseFloat(localStorage.getItem('mc_aimSens') || '1').toFixed(2)}×</span>
          </label>
          <label>Button Size
            <select id="mc-scale">
              <option value="S" ${(localStorage.getItem('mc_btnScale') || 'M') === 'S' ? 'selected' : ''}>Small</option>
              <option value="M" ${(localStorage.getItem('mc_btnScale') || 'M') === 'M' ? 'selected' : ''}>Medium</option>
              <option value="L" ${(localStorage.getItem('mc_btnScale') || 'M') === 'L' ? 'selected' : ''}>Large</option>
            </select>
          </label>
          <label><input type="checkbox" id="mc-lefty" ${localStorage.getItem('mc_lefty') === '1' ? 'checked' : ''} /> Left-handed (mirror layout)</label>
          <label><input type="checkbox" id="mc-haptics" ${localStorage.getItem('mc_haptics') !== '0' ? 'checked' : ''} /> Haptic feedback</label>
          <button class="btn small" data-act="replay-tut">SHOW TUTORIAL AGAIN</button>
        </div>
        <div class="btn-row">
          <button class="btn primary" data-act="back">← BACK</button>
        </div>
      </div>
    `);
```

- [ ] **Step 4: Wire the new controls' event handlers**

After the existing `el.querySelector('[data-act="back"]').onclick = () => this.show('main');` line, add (still inside `_settings()`):

```js
    const sens = el.querySelector('#mc-sens');
    const sensVal = el.querySelector('#mc-sens-val');
    sens.oninput = () => {
      sensVal.textContent = parseFloat(sens.value).toFixed(2) + '×';
      localStorage.setItem('mc_aimSens', sens.value);
      this._applyMobileSettings();
    };
    el.querySelector('#mc-scale').onchange = (e) => {
      localStorage.setItem('mc_btnScale', e.target.value);
      this._applyMobileSettings();
    };
    el.querySelector('#mc-lefty').onchange = (e) => {
      localStorage.setItem('mc_lefty', e.target.checked ? '1' : '0');
      this._applyMobileSettings();
    };
    el.querySelector('#mc-haptics').onchange = (e) => {
      localStorage.setItem('mc_haptics', e.target.checked ? '1' : '0');
      this._applyMobileSettings();
    };
    el.querySelector('[data-act="replay-tut"]').onclick = () => {
      localStorage.removeItem('touch_tutorial_done');
      // Trigger overlay open if tutorial module is loaded.
      if (this.game?.tutorial?.show) this.game.tutorial.show();
    };
```

- [ ] **Step 5: Add CSS for the new section**

Append to `src/ui/styles.css` (end of file):

```css
/* Mobile Controls settings — vertical stack of labeled inputs. */
.mobile-settings { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
.mobile-settings label { display: flex; align-items: center; gap: 10px; opacity: 0.9; font-size: 13px; }
.mobile-settings input[type="range"] { flex: 1; max-width: 220px; accent-color: var(--accent); }
.mobile-settings #mc-sens-val { font-variant-numeric: tabular-nums; opacity: 0.7; min-width: 56px; text-align: right; }
.mobile-settings input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--accent); }
.mobile-settings select { background: rgba(0,0,0,0.4); border: 1px solid var(--panel-border); color: var(--fg); padding: 6px 10px; border-radius: 8px; font: inherit; }
```

- [ ] **Step 6: Verify the panel renders**

Reload, open Settings (from main menu). Scroll down. Expected: "MOBILE CONTROLS" header below weapons, with Aim Sensitivity slider, Button Size dropdown, two checkboxes, and a "Show Tutorial Again" button.

In preview console:

```js
const inputs = document.querySelectorAll('.mobile-settings input, .mobile-settings select, .mobile-settings button');
inputs.forEach(i => console.log(i.id || i.dataset.act || i.tagName, i.type || '', i.value ?? i.checked));
```

Expected: 5 controls listed.

- [ ] **Step 7: Verify settings persist + apply**

In preview console:

```js
document.querySelector('#mc-lefty').click();
console.log('left-handed class:', document.body.classList.contains('left-handed'));
console.log('persisted:', localStorage.getItem('mc_lefty'));
```

Expected: `true` and `'1'`. Reload page, check `body` still has `left-handed` class.

Reset: `document.querySelector('#mc-lefty').click();`

- [ ] **Step 8: Commit**

```bash
git add src/ui/Menu.js src/ui/styles.css
git commit -m "feat(mobile): Settings panel — Mobile Controls section

5 controls under existing Settings panel:
- Aim Sensitivity slider (0.5×-2.0×)
- Button Size dropdown (S/M/L → CSS --btn-scale)
- Left-handed mirror toggle (body.left-handed class)
- Haptic feedback toggle (haptics.js gate)
- Show Tutorial Again button (clears localStorage flag)

Persisted to localStorage and re-applied on page load via
_applyMobileSettings() called from constructor."
```

---

## Task 7: Tutorial overlay — first-run mobile guide

**Files:**
- Create: `src/ui/TutorialOverlay.js`
- Modify: `src/Game.js` (instantiate + show on first mobile match)
- Modify: `src/ui/styles.css` (overlay styles)

- [ ] **Step 1: Create `src/ui/TutorialOverlay.js`**

```js
// First-run mobile tutorial — shows ghost-finger animations over the game
// canvas to teach the 5 core gestures. Triggered once per browser; gated
// by localStorage('touch_tutorial_done'). Replayable via Settings.
//
// Steps (each ~3s):
//   1. Left thumb traces joystick arc        — "drag to move"
//   2. Right thumb taps Attack twice         — "tap to attack"
//   3. Right thumb holds Attack + drags      — "hold + drag to aim"
//   4. Grab held + joy push + grab release   — "release grab + push = throw"
//   5. Grab + diagonal swipe                 — "swipe grab to throw weapon"
//
// Auto-advances. Skip button bottom-right dismisses immediately.

const STORAGE_KEY = 'touch_tutorial_done';
const STEP_MS = 3200;

const STEPS = [
  { caption: 'drag to move',                  side: 'left',  anim: 'tut-arc' },
  { caption: 'tap to attack',                 side: 'right', anim: 'tut-tap', target: '.tbtn.attack' },
  { caption: 'hold + drag to aim',            side: 'right', anim: 'tut-drag', target: '.tbtn.attack' },
  { caption: 'release grab + push = throw',   side: 'split', anim: 'tut-grab-throw' },
  { caption: 'swipe grab to throw weapon',    side: 'right', anim: 'tut-swipe', target: '.tbtn.grab' },
];

export class TutorialOverlay {
  constructor() {
    this.root = null;
    this.timer = null;
    this.idx = 0;
  }

  static isDone() { return localStorage.getItem(STORAGE_KEY) === '1'; }
  static markDone() { localStorage.setItem(STORAGE_KEY, '1'); }
  static reset() { localStorage.removeItem(STORAGE_KEY); }

  show() {
    if (this.root) this.dismiss();
    document.body.classList.add('tutorial-active');
    const el = document.createElement('div');
    el.className = 'tut-root';
    el.innerHTML = `
      <div class="tut-dim"></div>
      <div class="tut-caption" id="tut-caption"></div>
      <div class="tut-finger" id="tut-finger-left"></div>
      <div class="tut-finger" id="tut-finger-right"></div>
      <button class="tut-skip" id="tut-skip">SKIP</button>
    `;
    document.body.appendChild(el);
    this.root = el;
    el.querySelector('#tut-skip').onclick = () => this.dismiss();
    this.idx = 0;
    this._showStep(0);
  }

  _showStep(i) {
    if (i >= STEPS.length) { this.dismiss(); return; }
    const step = STEPS[i];
    const cap = this.root.querySelector('#tut-caption');
    const fL  = this.root.querySelector('#tut-finger-left');
    const fR  = this.root.querySelector('#tut-finger-right');
    cap.textContent = step.caption;
    fL.className = 'tut-finger';
    fR.className = 'tut-finger';
    // Resolve absolute positions of any target buttons so the ghost finger
    // animates over the real cluster.
    const place = (el, sideKey, targetSel) => {
      if (targetSel) {
        const t = document.querySelector(targetSel);
        if (t) {
          const r = t.getBoundingClientRect();
          el.style.left = (r.left + r.width / 2) + 'px';
          el.style.top  = (r.top + r.height / 2) + 'px';
        }
      } else if (sideKey === 'left') {
        el.style.left = (innerWidth * 0.25) + 'px';
        el.style.top  = (innerHeight * 0.65) + 'px';
      } else {
        el.style.left = (innerWidth * 0.75) + 'px';
        el.style.top  = (innerHeight * 0.65) + 'px';
      }
    };
    if (step.side === 'left') {
      place(fL, 'left');
      fL.classList.add('show', step.anim);
    } else if (step.side === 'right') {
      place(fR, 'right', step.target);
      fR.classList.add('show', step.anim);
    } else { // split
      place(fL, 'left');
      place(fR, 'right', '.tbtn.grab');
      fL.classList.add('show', 'tut-arc');
      fR.classList.add('show', 'tut-tap');
    }
    this.timer = setTimeout(() => {
      this.idx++;
      this._showStep(this.idx);
    }, STEP_MS);
  }

  dismiss() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
    document.body.classList.remove('tutorial-active');
    TutorialOverlay.markDone();
  }
}
```

- [ ] **Step 2: Add overlay CSS at the end of `src/ui/styles.css`**

```css
/* First-run mobile tutorial overlay. */
.tut-root { position: fixed; inset: 0; z-index: 1500; pointer-events: none; }
.tut-dim { position: absolute; inset: 0; background: rgba(0,0,0,0.55); }
.tut-caption { position: absolute; top: 14%; left: 50%; transform: translateX(-50%); font-size: clamp(18px, 4vw, 28px); font-weight: 800; letter-spacing: 2px; color: var(--accent); text-shadow: 0 2px 12px rgba(0,0,0,0.85); text-align: center; }
.tut-finger { position: absolute; width: 56px; height: 56px; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,0.9), rgba(255,255,255,0.2) 70%); border: 3px solid #fff; transform: translate(-50%, -50%); opacity: 0; }
.tut-finger.show { opacity: 1; }
.tut-finger.tut-arc      { animation: tut-arc 1.4s ease-in-out infinite; }
.tut-finger.tut-tap      { animation: tut-tap 1.0s ease-in-out infinite; }
.tut-finger.tut-drag     { animation: tut-drag 1.6s ease-in-out infinite; }
.tut-finger.tut-swipe    { animation: tut-swipe 1.4s ease-out infinite; }
@keyframes tut-arc {
  0%   { transform: translate(-50%, -50%) translate(-40px, 0); }
  25%  { transform: translate(-50%, -50%) translate(0, -40px); }
  50%  { transform: translate(-50%, -50%) translate(40px, 0); }
  75%  { transform: translate(-50%, -50%) translate(0, 40px); }
  100% { transform: translate(-50%, -50%) translate(-40px, 0); }
}
@keyframes tut-tap {
  0%, 70%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  35%           { transform: translate(-50%, -50%) scale(0.7); opacity: 0.7; }
}
@keyframes tut-drag {
  0%   { transform: translate(-50%, -50%) translate(0, 0) scale(0.95); }
  60%  { transform: translate(-50%, -50%) translate(70px, -50px) scale(1.1); }
  100% { transform: translate(-50%, -50%) translate(0, 0) scale(0.95); }
}
@keyframes tut-swipe {
  0%   { transform: translate(-50%, -50%) translate(0, 0); opacity: 0.4; }
  20%  { opacity: 1; }
  100% { transform: translate(-50%, -50%) translate(120px, -120px); opacity: 0; }
}
.tut-skip { position: absolute; top: max(16px, var(--safe-t)); right: max(16px, var(--safe-r)); pointer-events: auto; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: #fff; padding: 8px 16px; font: inherit; font-weight: 700; letter-spacing: 1.5px; border-radius: 8px; cursor: pointer; }
.tut-skip:hover { background: rgba(255,204,51,0.2); border-color: var(--accent); }

/* Suppress all touch input while tutorial is showing. */
body.tutorial-active #touch-root { pointer-events: none !important; }
```

- [ ] **Step 3: Wire into `src/Game.js`**

Find the existing imports at the top of `src/Game.js`. Add:

```js
import { TutorialOverlay } from './ui/TutorialOverlay.js';
```

Find the constructor, after `this.menu = ...` is set (look for the line `this.menu = new Menu(this);` or similar). Add:

```js
    this.tutorial = new TutorialOverlay();
```

Find `_startMatch` (line 176). At the end of that method (before its closing `}`), add:

```js
    // First-run mobile tutorial — only on touch devices, only once per browser.
    if (this.input?.touch?.active && !TutorialOverlay.isDone()) {
      // Defer one frame so the cluster is in the DOM before placing fingers.
      requestAnimationFrame(() => this.tutorial.show());
    }
```

If the exact line of `_startMatch`'s closing brace is hard to find, look for the next method definition (e.g. `_cleanup` or similar) and place the snippet just before it.

- [ ] **Step 4: Verify tutorial appears on first mobile match**

In preview console:

```js
localStorage.removeItem('touch_tutorial_done');
document.body.classList.add('touch');
// Then start a solo match via the menu.
```

Expected: After the match starts, the overlay appears with caption "drag to move" and a ghost finger circling on the left. After ~3.2s it advances to "tap to attack".

- [ ] **Step 5: Verify Skip button + persists dismissal**

Click SKIP. The overlay disappears. Then:

```js
console.log('flag:', localStorage.getItem('touch_tutorial_done'));
```

Expected: `'1'`.

- [ ] **Step 6: Verify "Show Tutorial Again" button works**

Open Settings → click "SHOW TUTORIAL AGAIN". Expected: overlay reopens with step 1.

- [ ] **Step 7: Commit**

```bash
git add src/ui/TutorialOverlay.js src/ui/styles.css src/Game.js
git commit -m "feat(mobile): first-run tutorial overlay with ghost-finger animations

5-step sequence with auto-advance every 3.2s:
1. drag to move (joystick)
2. tap to attack
3. hold + drag to aim
4. release grab + push = throw
5. swipe grab to throw weapon

Gated by localStorage('touch_tutorial_done'). Skip button
top-right. Replayable from Settings → Show Tutorial Again.
Suppresses #touch-root pointer events while active so demo
fingers don't trigger real input."
```

---

## Task 8: End-to-end verification + cleanup

- [ ] **Step 1: Verify all 5 gestures work in a real solo match**

Force touch mode on desktop:

```js
document.body.classList.add('touch');
```

Start a solo match. Verify each gesture by inspecting the snapshot:

```js
// Tap Attack — fires for one frame:
const tc = window.__game__.input.touch;
const before = tc.getSnapshot().attack;
tc.btnAttack.dispatchEvent(new MouseEvent('mousedown'));
console.log('attack after tap:', tc.getSnapshot().attack); // true
```

Repeat for Jump and Special (mousedown on each btn).

For Grab tap (mouse): mousedown + mouseup — verify `snapshot.grab` toggles true then false.

- [ ] **Step 2: Check that PC controls still work end-to-end**

Type letters and use the mouse during a desktop match. Confirm: WASD moves, Space jumps, J/F/LMB attack, K/Shift/RMB grab, Q throws weapon, mouse aims. None of the touch changes should have broken any keyboard/mouse path.

- [ ] **Step 3: Drop dev-only `window.__game__` exposure if added**

If you added `window.__game__ = this;` in Game.js for testing in earlier tasks, remove it now. Run `git diff src/Game.js` to spot it.

- [ ] **Step 4: Run a quick sanity check — confirm no stale CSS classes referenced**

Run: `grep -rn 'tbtn.throw\|tbtn.aim\b\|btnThrow\|btnAim\|aimMode' src/`

Expected: empty output. If anything is still referenced, fix it (most likely in `TouchControls.js` if a leftover slipped through Task 2).

- [ ] **Step 5: Final commit (only if step 3 or step 4 needed cleanup)**

```bash
git add -A
git commit -m "chore(mobile): drop dev exposure + stale references

Final cleanup pass after mobile-controls overhaul rollout."
```

If nothing changed, skip.

- [ ] **Step 6: Open PR**

```bash
git push -u origin claude/goofy-napier-48bb8b
gh pr create --title "feat(mobile): controls overhaul — 4-button cluster, drag-aim, swipe-throw, juice" --body "$(cat <<'EOF'
## Summary
- Replaces 6-button + AIM-toggle mobile control scheme with a 4-button thumb-arc cluster.
- Aim is sticky and mouse-parallel: tap Attack fires in current `aimDir`, hold + drag updates aim per-frame.
- Throwing wielded weapons (PC `Q` parity) is a swipe-from-Grab gesture; grabbed players still throw via grab-release with movement input (unchanged).
- Adds haptics, low-opacity visuals, Settings (sensitivity / scale / left-handed / haptics), and a first-run tutorial overlay.

Spec: `docs/superpowers/specs/2026-05-10-mobile-controls-overhaul-design.md`
Plan: `docs/superpowers/plans/2026-05-10-mobile-controls-overhaul.md`

## Test plan
- [ ] Desktop with `body.touch`: tap each button, verify snapshot fires for one frame
- [ ] Desktop with `body.touch`: hold + drag Attack — verify `aimDir` rotates and character body follows
- [ ] Desktop with `body.touch`: tap Grab — `snapshot.grab` toggles; swipe Grab — `snapshot.throw` fires once
- [ ] Mobile (real device): aim a ranged weapon at a bot via drag, fire, confirm projectile lands in aim direction
- [ ] Mobile: grab a bot, push joystick, release → confirm throw direction matches joystick
- [ ] Mobile: pick up a katana, swipe Grab diagonally → confirm katana flies in swipe direction
- [ ] Settings: change Aim Sensitivity, Button Size, Left-handed, Haptics — each persists across reload
- [ ] First-run on a fresh browser: tutorial appears once, all 5 steps cycle, Skip dismisses, Show Tutorial Again replays
- [ ] PC keyboard + mouse: full regression — WASD, Space, J/F/LMB, K/Shift/RMB, Q, mouse aim still all work

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

After writing the plan, I checked it against the spec:

**Spec coverage:**
- Aim model (sticky, drag-from-Attack, no auto-aim, melee aimed) → Task 2 (TouchControls rewrite)
- Throw split (grabbed vs wielded) → Task 2 (swipe-from-Grab + existing grab-release-with-joy)
- 4-button thumb arc layout → Tasks 1 + 2
- Low-opacity visuals → Task 1
- Drag-then-release fires-on-release → Task 2 step 1's `_wireAttackButton` always sets `attack=true` on `endPress`
- Haptics (5 events) → Tasks 4 + 5
- Settings (5 controls) → Task 6
- Tutorial overlay (5 steps) → Task 7
- Files-touched table → matches spec §Files Touched
- Left-handed mirror → Task 1 (CSS) + Task 2 (joy spawn-half) + Task 6 (toggle)

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / "appropriate handling" / "similar to Task N". Every code step shows the actual code.

**Type consistency:**
- `vibrate(ms)` signature consistent across haptics.js + Stickman.js call sites
- `setHapticsEnabled(on)` matches Menu.js usage
- `applySettings({ aimSensitivity })` matches between TouchControls + Menu
- `aimDir = { x, y }` matches between TouchControls construction + drag handler + Grab swipe handler
- `localStorage` keys consistent: `mc_aimSens`, `mc_btnScale`, `mc_lefty`, `mc_haptics`, `touch_tutorial_done`
- CSS classes consistent: `.tbtn.attack/jump/grab/special`, `.btn-cluster`, `.left-handed`, `.tut-root`/`.tut-finger`/`.tut-skip`
