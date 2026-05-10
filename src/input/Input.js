// Unified input. Polls keyboard, gamepad, touch joystick into a per-frame snapshot.
// Each player can be bound to a different source (local 1, local 2, gamepad N, touch, network).

import { TouchControls } from './TouchControls.js';

export class InputManager {
  constructor() {
    this.keys = new Set();
    this.keyPressed = new Set();
    this.keyReleased = new Set();
    addEventListener('keydown', (e) => this._handleKey(e, true));
    addEventListener('keyup', (e) => this._handleKey(e, false));
    addEventListener('blur', () => this.keys.clear());

    // Mouse — for aim + attack on PC
    this.mouseX = 0; this.mouseY = 0;
    this.mouseDown = false;
    this.mouseRightDown = false;
    this.mouseActive = false;
    addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX; this.mouseY = e.clientY;
      this.mouseActive = true;
    });
    addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.mouseRightDown = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.mouseRightDown = false;
    });

    this.touch = new TouchControls();
    this.gamepadIdx = null;
    addEventListener('gamepadconnected', (e) => {
      if (this.gamepadIdx == null) this.gamepadIdx = e.gamepad.index;
      console.log('Gamepad connected:', e.gamepad.id, 'index', e.gamepad.index);
    });
    addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIdx === e.gamepad.index) this.gamepadIdx = null;
      console.log('Gamepad disconnected:', e.gamepad.id);
    });

    this.game = null; // set later for mouse->world aim conversion
  }
  bindGame(game) { this.game = game; }

  _handleKey(e, down) {
    const k = e.code;
    if (down) {
      if (!this.keys.has(k)) this.keyPressed.add(k);
      this.keys.add(k);
    } else {
      this.keys.delete(k);
      this.keyReleased.add(k);
    }
    // Prevent default for game keys
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
  }

  endFrame() {
    this.keyPressed.clear();
    this.keyReleased.clear();
  }

  getKbSnapshot(scheme = 'wasd') {
    const out = { moveX: 0, moveY: 0, jump: false, attack: false, grab: false, special: false, throw: false, aimX: 1, aimY: 0, aimActive: false };
    if (scheme === 'wasd') {
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) out.moveX -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) out.moveX += 1;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) out.moveY += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) out.moveY -= 1;
      out.jump = this.keys.has('Space');
      out.attack = this.keys.has('KeyJ') || this.keys.has('KeyF') || this.mouseDown;
      out.grab = this.keys.has('KeyK') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.mouseRightDown;
      out.special = this.keys.has('KeyL') || this.keys.has('KeyE');
      out.throw = this.keys.has('KeyQ');
    }
    return out;
  }

  // Mouse NDC for the consumer to unproject.
  getMouseNDC() {
    if (!this.mouseActive) return null;
    const w = innerWidth, h = innerHeight;
    return { x: (this.mouseX / w) * 2 - 1, y: -(this.mouseY / h) * 2 + 1 };
  }

  getGamepadSnapshot(idx) {
    const out = { moveX: 0, moveY: 0, jump: false, attack: false, grab: false, special: false, throw: false, aimX: 1, aimY: 0, aimActive: false };
    const gps = navigator.getGamepads?.() || [];
    // Find ANY connected gamepad — survives reconnects, multiple controllers,
    // and the browser's habit of returning null in stale slots.
    let gp = null;
    if (idx != null && gps[idx] && gps[idx].connected) gp = gps[idx];
    if (!gp) {
      for (const candidate of gps) {
        if (candidate && candidate.connected) { gp = candidate; this.gamepadIdx = candidate.index; break; }
      }
    }
    if (!gp) return out;
    const dz = (v) => Math.abs(v) < 0.2 ? 0 : v;
    const btn = (i) => !!gp.buttons[i]?.pressed;
    const axis = (i) => gp.axes[i] ?? 0;
    const trig = (i) => Math.max(0, gp.buttons[i]?.value ?? 0);

    // === MOVEMENT ===
    // L-stick + D-pad both move. (down on stick = crouch via moveY < 0.)
    let mx = dz(axis(0));
    let my = -dz(axis(1));
    if (btn(14)) mx = -1;          // dpad left
    if (btn(15)) mx = 1;           // dpad right
    if (btn(12)) my = 1;           // dpad up
    if (btn(13)) my = -1;          // dpad down
    out.moveX = mx;
    out.moveY = my;

    // === AIM === R-stick.
    const ax = dz(axis(2)), ay = -dz(axis(3));
    if (Math.hypot(ax, ay) > 0.35) {
      out.aimX = ax; out.aimY = ay; out.aimActive = true;
    }

    // === ACTIONS ===
    // A = Jump   |   X = Grab   |   B = Throw   |   Y = Special / altfire
    // RT = Attack (analog)   |   LT = Aim assist (auto-aim flag if you want)
    // RB = Attack (alt)      |   LB = Grab (alt)
    out.jump = btn(0);
    out.attack = btn(5) || trig(7) > 0.35;       // RB or RT
    out.grab   = btn(2) || btn(4) || trig(6) > 0.35; // X or LB or LT
    out.throw  = btn(1);                              // B
    out.special = btn(3);                             // Y
    out.pause = btn(9) || btn(8);                     // Start / Back
    return out;
  }

  // Strict-by-index gamepad poll. Used by local MP where P2/P3/P4 must each
  // bind to one specific pad. Unlike getGamepadSnapshot(), this returns an
  // empty snapshot if that exact slot is null/disconnected � never bleeds
  // input from another pad into a different player.
  getGamepadSnapshotByIndex(idx) {
    const out = { moveX: 0, moveY: 0, jump: false, attack: false, grab: false, special: false, throw: false, aimX: 1, aimY: 0, aimActive: false };
    const gps = navigator.getGamepads?.() || [];
    const gp = gps[idx];
    if (!gp || !gp.connected) return out;
    const dz = (v) => Math.abs(v) < 0.2 ? 0 : v;
    const btn = (i) => !!gp.buttons[i]?.pressed;
    const axis = (i) => gp.axes[i] ?? 0;
    const trig = (i) => Math.max(0, gp.buttons[i]?.value ?? 0);

    let mx = dz(axis(0));
    let my = -dz(axis(1));
    if (btn(14)) mx = -1;
    if (btn(15)) mx = 1;
    if (btn(12)) my = 1;
    if (btn(13)) my = -1;
    out.moveX = mx;
    out.moveY = my;

    const ax = dz(axis(2)), ay = -dz(axis(3));
    if (Math.hypot(ax, ay) > 0.35) {
      out.aimX = ax; out.aimY = ay; out.aimActive = true;
    }

    out.jump = btn(0);
    out.attack = btn(5) || trig(7) > 0.35;
    out.grab   = btn(2) || btn(4) || trig(6) > 0.35;
    out.throw  = btn(1);
    out.special = btn(3);
    return out;
  }

  // Returns an input snapshot for any local source descriptor.
  // Used by the per-local-player input loop.
  //   'kb-mouse' → keyboard + mouse + touch + any-gamepad merged. For solo
  //                play where the user might be on any device.
  //   'kb-only'  → keyboard + mouse + touch ONLY, no gamepad merge. Used by
  //                P1 in local-MP so a pad bound to P2/P3 can't bleed input
  //                into P1 via getCombined's any-pad fallback.
  //   'gamepad'  → strict-by-index pad poll for P2/P3/P4.
  getSnapshotFor(source) {
    if (!source) return null;
    if (source.kind === 'kb-mouse') return this.getCombined();
    if (source.kind === 'kb-only') return this.getKbMouseTouch();
    if (source.kind === 'gamepad') return this.getGamepadSnapshotByIndex(source.gamepadIdx);
    return null;
  }

  // Combined keyboard + mouse + touch, no gamepad. P1 in local-MP uses this
  // so external pads only drive their assigned slot.
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

  // True for one frame on Start/Back press from ANY connected gamepad.
  // Local-MP: any local player's Start triggers pause.
  consumeGamepadPause() {
    const gps = navigator.getGamepads?.() || [];
    let pressed = false;
    for (const gp of gps) {
      if (!gp || !gp.connected) continue;
      if (gp.buttons[8]?.pressed || gp.buttons[9]?.pressed) { pressed = true; break; }
    }
    if (pressed && !this._pausePrev) { this._pausePrev = true; return true; }
    if (!pressed) this._pausePrev = false;
    return false;
  }

  getTouchSnapshot() {
    return this.touch.getSnapshot();
  }

  // Convenience: combine kb+gamepad+touch — useful for the local hero player.
  getCombined() {
    const a = this.getKbSnapshot();
    const g = this.getGamepadSnapshot(this.gamepadIdx);
    const t = this.touch.active ? this.getTouchSnapshot() : null;

    const o = { ...a };
    o.moveX = a.moveX || g.moveX || (t?.moveX ?? 0);
    o.moveY = a.moveY || g.moveY || (t?.moveY ?? 0);
    o.jump = a.jump || g.jump || (t?.jump ?? false);
    o.attack = a.attack || g.attack || (t?.attack ?? false);
    o.grab = a.grab || g.grab || (t?.grab ?? false);
    o.special = a.special || g.special || (t?.special ?? false);
    o.throw = a.throw || g.throw || (t?.throw ?? false);
    if (g.aimActive) { o.aimX = g.aimX; o.aimY = g.aimY; o.aimActive = true; }
    else if (t?.aimActive) { o.aimX = t.aimX; o.aimY = t.aimY; o.aimActive = true; }
    else { o.aimX = a.aimX; o.aimY = a.aimY; o.aimActive = false; }
    return o;
  }

  destroy() { this.touch.destroy(); }
}
