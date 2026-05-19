# Planet Magnetic Gravity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace realistic gravity on the space level. Players walk magnetically (state machine, no physics force). Projectiles + meteors + debris obey constant-pull halo zones. Fixes slingshot bug where moving players escape the map.

**Architecture:** Two systems split by body type. Players are scripted (mode = `walking` / `jumping` / `launched` / `returning`), no force applied to their physics body. All other dynamic bodies (projectiles, meteors, crates, ragdolls) get a per-step force = sum of constant pulls from each planet's halo they're inside.

**Tech Stack:** JS (ES modules, no build step), THREE.js, cannon-es. Browser verification only (no test framework). Existing curved-gravity scaffolding (`level.curvedGravity` flag, `_currentPlanetRef`, `_updateBodyRotation`) is reused.

**Spec:** [docs/superpowers/specs/2026-05-19-planet-magnetic-gravity-design.md](../specs/2026-05-19-planet-magnetic-gravity-design.md)

---

## File Map

| File | Action | Responsibility |
| --- | --- | --- |
| `src/levels/space/PlanetGravity.js` | Rewrite | Export `makeProjectileGravity(level, game)`. Constant-pull halo sum for non-player bodies. Drops old `makePlanetGravity` + `STICK_BONUS` + `G`. |
| `src/levels/space/Planet.js` | Modify | Add `pullStrength` field (default 15). Keep `mass` for back-compat (unused). |
| `src/levels/Level.js` | Modify | Import `makeProjectileGravity` instead of `makePlanetGravity`. Same registration site (~line 631). |
| `src/levels/definitions.js` | Modify | Add `pullStrength` to each space planet config. Anchors ~18, smaller bodies ~10. |
| `src/entities/Stickman.js` | Modify | Replace existing curved-gravity branch in `_move(dt)` (~lines 1501–1570) with magnetic state machine. Add `mode` / `launchTimer` fields. Modify `applyKnockback` to set `launched` mode on big hits. Update `_updateGroundCheck` curved branch to set `grounded=false` while in `jumping` / `launched` / `returning`. |

No new files. No file split. Stickman.js is already large but the new code replaces an equally-sized block — net size roughly unchanged.

---

## Verification Conventions

Each task ends with a browser verify step using `preview_eval` (per user's project conventions — no test framework, no test runner). The eval block reads game state and returns a small JSON the engineer eyeballs.

Server lifecycle:
- Run `preview_start` once at the top of the implementation session if not already running.
- After each file edit, `preview_eval` with `window.location.reload()` if HMR doesn't pick the change up.
- Use `preview_console_logs` if a check fails — likely a JS error.

Set `window.__planet = { ... }` (mutable tuning constants) in PlanetGravity.js so verify steps can poke values.

---

## Task 1: Add `pullStrength` to Planet config

**Files:**
- Modify: `src/levels/space/Planet.js:8-29`

- [ ] **Step 1: Edit `Planet` constructor**

Add `pullStrength` field after `mass`:

```js
this.mass = cfg.mass ?? cfg.radius * cfg.radius * cfg.radius * 1.0;
this.pullStrength = cfg.pullStrength ?? 15;  // m/s² applied inside halo (constant-pull model)
this.haloMul = cfg.haloMul ?? 3;
```

- [ ] **Step 2: Reload preview, verify field is set**

`preview_eval`:
```js
const lvl = window.__game?.level;
const ps = lvl?.planets?.map(p => ({ id: p.id, pullStrength: p.pullStrength }));
JSON.stringify(ps);
```
Expected: array of `{id, pullStrength: 15}` (or whatever the def overrides to once Task 5 is done — for now all `15`).

- [ ] **Step 3: Commit**

```bash
git add src/levels/space/Planet.js
git commit -m "feat(planet): add pullStrength field for constant-pull gravity"
```

---

## Task 2: Rewrite `PlanetGravity.js` to constant-pull, projectile-only

**Files:**
- Modify: `src/levels/space/PlanetGravity.js` (full rewrite)

- [ ] **Step 1: Replace file contents**

```js
import * as CANNON from 'cannon-es';

// Tunables exposed on window.__planet for live in-browser tuning.
const DEFAULTS = {
  PROJECTILE_PULL_DEFAULT: 15,   // m/s² inside halo, per planet
  EDGE_TAPER_FRAC: 0.10,         // last 10% of halo radius tapers from full → 0
  DEBRIS_MUL: 0.5,               // softer pull for crates/ragdoll/debris bodies
  // Player-side magnetic-gravity tunables (read by Stickman._movePlanetMagnetic).
  JUMP_DOWN_ACCEL: 30,           // scripted "down" accel during a player jump
  ROT_SLERP_RATE: 12,            // rad/s body quaternion align to local up
  LAUNCH_MIN_KB: 6,              // m/s knockback magnitude that triggers launched
  LAUNCH_DRAG: 0.98,             // per-60Hz-frame velocity multiplier in launched
  RETURN_ACCEL: 40,              // m/s² pull during returning
  RETURN_VEL_CAP: 25,            // m/s speed cap during returning
};
if (typeof window !== 'undefined') {
  window.__planet = Object.assign({}, DEFAULTS, window.__planet || {});
}

// Constant-pull halo gravity for NON-PLAYER dynamic bodies. Players are driven
// by the magnetic state machine in Stickman._move (no physics force).
//
// Per body: sum over each planet of:
//   if r >= haloRadius:   contribution = 0
//   else:                 contribution = pullStrength * taper * unit(planet.center - body)
//   taper = 1 inside the inner 90% of halo, linearly drops to 0 over outer 10%.
// Debris-style bodies (crates, ragdoll segments) multiply pull by DEBRIS_MUL so
// they settle instead of orbiting forever.
export function makeProjectileGravity(level, game) {
  return function applyProjectileGravity() {
    const planets = level.planets;
    if (!planets.length) return;
    const T = window.__planet ?? DEFAULTS;
    const taperFrac = T.EDGE_TAPER_FRAC ?? 0.10;
    const debrisMul = T.DEBRIS_MUL ?? 0.5;

    const applyTo = (body, mul) => {
      if (!body || body.mass === 0 || body.sleepState === CANNON.Body.SLEEPING) return;
      let fx = 0, fy = 0;
      for (const p of planets) {
        const dx = p.cx - body.position.x;
        const dy = p.cy - body.position.y;
        const r = Math.hypot(dx, dy);
        if (r < 0.05) continue;
        if (r >= p.haloRadius) continue;
        const t = r / p.haloRadius;
        let k = 1;
        if (t > 1 - taperFrac) k = (1 - t) / taperFrac;
        const a = (p.pullStrength ?? T.PROJECTILE_PULL_DEFAULT) * k * mul;
        const inv = 1 / r;
        fx += dx * inv * a;
        fy += dy * inv * a;
      }
      body.force.x += body.mass * fx;
      body.force.y += body.mass * fy;
    };

    for (const b of level.physics.world.bodies) {
      if (b.type !== CANNON.Body.DYNAMIC) continue;
      const kind = b.userData?.kind;
      if (kind === 'player') continue;            // players are scripted, not forced
      if (kind === 'projectile') continue;        // handled below from game.projectiles
      // crates, ragdoll segments, meteor bodies registered as DYNAMIC fall here
      applyTo(b, debrisMul);
    }
    if (game?.projectiles) {
      for (const pr of game.projectiles) {
        if (pr.dead || !pr.body) continue;
        applyTo(pr.body, 1.0);
      }
    }
  };
}
```

- [ ] **Step 2: Reload preview, verify export resolves and no errors**

`preview_eval`:
```js
({
  hasFn: typeof window.__game?.level?._planetGravityFn === 'function',
  defaults: window.__planet,
});
```
Expected: `defaults` includes `PROJECTILE_PULL_DEFAULT: 15`, `JUMP_DOWN_ACCEL: 30`, `LAUNCH_MIN_KB: 6`, `RETURN_ACCEL: 40`, etc. `hasFn: true`.

`preview_console_logs`: no errors mentioning `PlanetGravity` or `makeProjectileGravity`.

(NB: Level.js still imports old name — Task 3 fixes it. Step 2 will likely show `hasFn: true` only because the old function is still wired; this step confirms the new file at least parses and exports work. If it fails, fix syntax now.)

- [ ] **Step 3: Commit**

```bash
git add src/levels/space/PlanetGravity.js
git commit -m "feat(planet): constant-pull projectile gravity (no player force)"
```

---

## Task 3: Switch Level.js to new export

**Files:**
- Modify: `src/levels/Level.js:7` (import)
- Modify: `src/levels/Level.js:631` (call site)

- [ ] **Step 1: Update import**

Change line 7 from:
```js
import { makePlanetGravity } from './space/PlanetGravity.js';
```
to:
```js
import { makeProjectileGravity } from './space/PlanetGravity.js';
```

- [ ] **Step 2: Update call site (line 631)**

Change:
```js
this._planetGravityFn = makePlanetGravity(this, this.game);
```
to:
```js
this._planetGravityFn = makeProjectileGravity(this, this.game);
```

- [ ] **Step 3: Reload preview, drop into space level, verify no errors**

`preview_eval`:
```js
const g = window.__game;
g.startLevel?.('space') ?? g.loadLevel?.('space');  // whatever the API is
'loaded';
```
Then:
```js
({
  level: window.__game?.level?.def?.id,
  curved: window.__game?.level?.curvedGravity,
  gravityFnRegistered: typeof window.__game?.level?._planetGravityFn === 'function',
});
```
Expected: `{ level: 'space', curved: true, gravityFnRegistered: true }`.

`preview_console_logs`: no errors.

(Player will sit still at spawn or fall through space — no scripted-down yet. That's fine; Task 4 onward handles players.)

- [ ] **Step 4: Commit**

```bash
git add src/levels/Level.js
git commit -m "feat(planet): wire projectile-only gravity preStep"
```

---

## Task 4: Stickman state machine fields + helpers

**Files:**
- Modify: `src/entities/Stickman.js` — constructor (~line 185 area) and a new helper method.

- [ ] **Step 1: Add fields to constructor**

Find the existing line:
```js
this._currentPlanetRef = null;     // populated by _updateGroundCheck on curved-gravity levels
```

Add immediately after:
```js
this._planetMode = 'walking';        // 'walking' | 'jumping' | 'launched' | 'returning'
this._launchTimer = 0;               // seconds remaining in 'launched' mode
this._modeStickPlanet = null;        // planet captured at jump start; sticky during jumping
```

- [ ] **Step 2: Add helper `_nearestPlanet()` near `_currentPlanet()` (~line 1441)**

After the existing `_currentPlanet()` method, add:
```js
// Nearest planet by Euclidean distance. Unlike _currentPlanet (which uses
// haloRadius gating), this never returns null when planets exist — used by
// 'returning' to pick a target after a knockback. Halo logic is for the
// constant-pull projectile gravity, not the magnetic player snap.
_nearestPlanet() {
  const planets = this.game?.level?.planets;
  if (!planets || !planets.length) return null;
  const px = this.body.position.x, py = this.body.position.y;
  let best = null, bestD2 = Infinity;
  for (const p of planets) {
    const dx = p.cx - px, dy = p.cy - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = p; }
  }
  return best;
}
```

- [ ] **Step 3: Reload preview, verify fields default correctly**

`preview_eval`:
```js
const p = window.__game?.localPlayer;
({ mode: p?._planetMode, t: p?._launchTimer, near: p?._nearestPlanet()?.id });
```
Expected: `{ mode: 'walking', t: 0, near: 'p1' }` (or whichever planet is nearest spawn).

- [ ] **Step 4: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(stickman): planet mode + nearest-planet helper"
```

---

## Task 5: Rewrite `_move` curved branch — walking + jumping

**Files:**
- Modify: `src/entities/Stickman.js:1501-1570` (the `if (this.game?.level?.curvedGravity)` block)

This is the biggest single edit. Replace the entire existing curved branch with a state-machine version covering `walking` and `jumping`. `launched` and `returning` come in Tasks 6+7.

- [ ] **Step 1: Replace the curved branch**

Find the block starting at line 1501:
```js
    if (this.game?.level?.curvedGravity) {
      const planet = this._currentPlanetRef;
      if (planet) {
```
…and ending at line 1570 with:
```js
      // No planet captured — leave gravity preStep to handle drift, no walk control.
      return;
    }
```

Replace the entire block (everything from `if (this.game?.level?.curvedGravity) {` through its closing `}`) with:

```js
    if (this.game?.level?.curvedGravity) {
      this._movePlanetMagnetic(dt, moveX, boosted, flying);
      return;
    }
```

Then add the new method `_movePlanetMagnetic` directly above `_move(dt)` (i.e. just before line 1455).

```js
// Magnetic-gravity movement for the space level. Replaces force-based gravity
// for the player body with a scripted state machine. Player physics body has
// world gravity = 0; all motion comes from this method writing velocity (and
// occasionally position) directly. No tangential thrust ever accumulates into
// orbital escape velocity — that bug is impossible by construction here.
_movePlanetMagnetic(dt, moveX, boosted, flying) {
  const T = window.__planet ?? {};
  const JUMP_DOWN_ACCEL = T.JUMP_DOWN_ACCEL ?? 30;
  const ROT_SLERP_RATE = T.ROT_SLERP_RATE ?? 12;  // unused here; _updateBodyRotation reads it
  const mode = this._planetMode;

  // --- WALKING ---
  if (mode === 'walking') {
    const planet = this._currentPlanetRef ?? this._nearestPlanet();
    if (!planet) return;
    this._modeStickPlanet = planet;
    const px = this.body.position.x, py = this.body.position.y;
    const dx = px - planet.cx, dy = py - planet.cy;
    const r = Math.hypot(dx, dy) || 1;
    const ux = dx / r, uy = dy / r;
    const tx = -uy, ty = ux;

    // Hard radial snap: lock to surface + capsule offset.
    const surfaceR = planet.radius + 0.95;  // 0.95 matches existing capsule offset
    this.body.position.x = planet.cx + ux * surfaceR;
    this.body.position.y = planet.cy + uy * surfaceR;

    // Velocity: kill radial, keep tangential.
    const vT = this.body.velocity.x * tx + this.body.velocity.y * ty;

    // Tangential accel toward target.
    const speedMaxC = this.crouching ? 2.0 : (boosted ? 6 : (flying ? 7 : 4.0));
    const accelC = (boosted ? 65 : 45);
    const targetT = moveX * speedMaxC;
    const dvT = targetT - vT;
    const stepT = clamp(dvT, -accelC * dt, accelC * dt);
    const newVT = vT + stepT;
    this.body.velocity.x = newVT * tx;
    this.body.velocity.y = newVT * ty;

    // Friction when idle.
    if (Math.abs(moveX) < 0.05) {
      const k = Math.pow(0.001, dt);
      this.body.velocity.x *= k;
      this.body.velocity.y *= k;
    }
    if (Math.abs(newVT) > 0.2) this.facing = Math.sign(newVT) || this.facing;

    // Jump → switch to jumping.
    const wantJump = this.input.jumpPressed && performance.now() >= (this._jumpInputCooldown || 0);
    if (wantJump) {
      if (this.charging) this._clearCombatState();
      const jumpSpeed = 8;
      // Replace radial component with jumpSpeed outward; preserve tangential.
      this.body.velocity.x = newVT * tx + jumpSpeed * ux;
      this.body.velocity.y = newVT * ty + jumpSpeed * uy;
      this._planetMode = 'jumping';
      this._modeStickPlanet = planet;
      this._jumpLockUntil = performance.now() + 80;
      this._jumpInputCooldown = performance.now() + 120;
      this.grounded = false;
      audio.jump?.();
      if (this === this.game?.localPlayer) vibrate(12);
    }
    return;
  }

  // --- JUMPING ---
  if (mode === 'jumping') {
    const planet = this._modeStickPlanet ?? this._nearestPlanet();
    if (!planet) return;
    const px = this.body.position.x, py = this.body.position.y;
    const dx = px - planet.cx, dy = py - planet.cy;
    const r = Math.hypot(dx, dy) || 1;
    const ux = dx / r, uy = dy / r;
    const tx = -uy, ty = ux;
    // Scripted down accel toward the captured planet.
    this.body.velocity.x -= ux * JUMP_DOWN_ACCEL * dt;
    this.body.velocity.y -= uy * JUMP_DOWN_ACCEL * dt;

    // Tangential mid-air control — small fraction of ground accel.
    const vT = this.body.velocity.x * tx + this.body.velocity.y * ty;
    const speedMaxAir = 4.0;
    const targetT = moveX * speedMaxAir;
    const dvT = targetT - vT;
    const stepT = clamp(dvT, -18 * dt, 18 * dt);
    const newVT = vT + stepT;
    const vR = this.body.velocity.x * ux + this.body.velocity.y * uy;
    this.body.velocity.x = newVT * tx + vR * ux;
    this.body.velocity.y = newVT * ty + vR * uy;

    // Land check: radial vel ≤ 0 AND inside the surface band.
    const surfaceR = planet.radius + 0.95;
    if (vR <= 0 && r <= surfaceR + 0.2) {
      this._planetMode = 'walking';
      this._modeStickPlanet = null;
    }
    if (Math.abs(newVT) > 0.2) this.facing = Math.sign(newVT) || this.facing;
    return;
  }

  // launched / returning handled in Tasks 6 + 7.
}
```

- [ ] **Step 2: Reload preview, drop into space level, verify walking + jumping**

`preview_eval` (after loading space level):
```js
const p = window.__game?.localPlayer;
const pos = { x: p.body.position.x.toFixed(2), y: p.body.position.y.toFixed(2) };
({ mode: p._planetMode, pos, surfaceR: 5.95 });
```
Expected: `mode: 'walking'`, position approximately on a planet surface (radius+0.95 from a planet center).

Test walk: drive `p.input.moveX = 1` for 0.5s of frames, then check pos shifted tangentially:
```js
window.__game.localPlayer.input.moveX = 1;
new Promise(r => setTimeout(r, 500)).then(() => {
  const p = window.__game.localPlayer;
  p.input.moveX = 0;
  return ({ mode: p._planetMode, x: p.body.position.x.toFixed(2), y: p.body.position.y.toFixed(2) });
});
```
Expected: x or y changed by ~1-2 units, mode still `walking`, position still on surface.

Test jump: trigger jump, watch mode flip to `jumping` then back to `walking`:
```js
const p = window.__game.localPlayer;
p.input.jumpPressed = true;
new Promise(r => setTimeout(r, 16)).then(() => {
  p.input.jumpPressed = false;
  return p._planetMode;  // expect 'jumping'
});
```
Then 1s later:
```js
window.__game.localPlayer._planetMode;  // expect 'walking' again after landing
```

`preview_console_logs`: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(stickman): magnetic walking + jumping on planets"
```

---

## Task 6: Add `launched` mode + `applyKnockback` trigger

**Files:**
- Modify: `src/entities/Stickman.js` — `applyKnockback` (~line 337) and `_movePlanetMagnetic` (added in Task 5).

- [ ] **Step 1: Modify `applyKnockback` to enter launched on big hits**

Find:
```js
applyKnockback(vx, vy, stun = 0.25) {
  this.body.wakeUp();
  this.body.velocity.x = vx;
  this.body.velocity.y = vy;
  this.hitstun = Math.max(this.hitstun, stun);
}
```

Replace with:
```js
applyKnockback(vx, vy, stun = 0.25) {
  this.body.wakeUp();
  this.body.velocity.x = vx;
  this.body.velocity.y = vy;
  this.hitstun = Math.max(this.hitstun, stun);
  // Magnetic-gravity levels: large knockbacks enter 'launched' mode so the
  // player isn't snapped back to the surface instantly. Threshold and timer
  // come from the magnetic-gravity spec.
  if (this.game?.level?.curvedGravity) {
    const T = window.__planet ?? {};
    const LAUNCH_MIN_KB = T.LAUNCH_MIN_KB ?? 6;
    const mag = Math.hypot(vx, vy);
    if (mag > LAUNCH_MIN_KB) {
      this._planetMode = 'launched';
      this._launchTimer = clamp(mag * 0.04, 0.3, 1.2);
      this._modeStickPlanet = null;
    }
  }
}
```

- [ ] **Step 2: Handle `launched` mode inside `_movePlanetMagnetic`**

Inside `_movePlanetMagnetic`, replace the trailing comment line:
```js
  // launched / returning handled in Tasks 6 + 7.
```
with:
```js
  // --- LAUNCHED ---
  if (mode === 'launched') {
    const LAUNCH_DRAG = T.LAUNCH_DRAG ?? 0.98;
    this.body.velocity.x *= Math.pow(LAUNCH_DRAG, dt * 60);
    this.body.velocity.y *= Math.pow(LAUNCH_DRAG, dt * 60);
    this._launchTimer -= dt;
    if (this._launchTimer <= 0) {
      this._planetMode = 'returning';
    }
    return;
  }

  // returning handled in Task 7.
```

(Why `Math.pow(LAUNCH_DRAG, dt * 60)`: makes drag framerate-independent — `0.98` per 60Hz frame = drag rate, scaled by dt.)

- [ ] **Step 3: Reload preview, trigger a launched state, verify**

`preview_eval`:
```js
const p = window.__game?.localPlayer;
p.applyKnockback(15, 8);
({ mode: p._planetMode, timer: p._launchTimer.toFixed(2), vx: p.body.velocity.x.toFixed(1), vy: p.body.velocity.y.toFixed(1) });
```
Expected: `mode: 'launched'`, `timer: ~0.68` (15 mag × 0.04 ≈ 0.68 clamped), velocities applied.

Small bump:
```js
const p = window.__game?.localPlayer;
p._planetMode = 'walking';
p.applyKnockback(2, 1);
p._planetMode;  // expect 'walking' — under threshold
```

After ~1s:
```js
window.__game.localPlayer._planetMode;  // expect 'returning'
```

- [ ] **Step 4: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(stickman): launched mode triggered by big knockback"
```

---

## Task 7: Add `returning` mode

**Files:**
- Modify: `src/entities/Stickman.js` — `_movePlanetMagnetic`

- [ ] **Step 1: Add returning branch**

Replace the trailing comment in `_movePlanetMagnetic`:
```js
  // returning handled in Task 7.
```
with:
```js
  // --- RETURNING ---
  if (mode === 'returning') {
    const RETURN_ACCEL = T.RETURN_ACCEL ?? 40;
    const RETURN_VEL_CAP = T.RETURN_VEL_CAP ?? 25;
    const planet = this._nearestPlanet();
    if (!planet) return;
    const px = this.body.position.x, py = this.body.position.y;
    const dx = planet.cx - px, dy = planet.cy - py;
    const r = Math.hypot(dx, dy) || 1;
    const ux = dx / r, uy = dy / r;
    this.body.velocity.x += ux * RETURN_ACCEL * dt;
    this.body.velocity.y += uy * RETURN_ACCEL * dt;
    const vMag = Math.hypot(this.body.velocity.x, this.body.velocity.y);
    if (vMag > RETURN_VEL_CAP) {
      const f = RETURN_VEL_CAP / vMag;
      this.body.velocity.x *= f;
      this.body.velocity.y *= f;
    }
    if (r < planet.haloRadius) {
      this._planetMode = 'jumping';
      this._modeStickPlanet = planet;
    }
    return;
  }
}
```

(Note the trailing `}` is for `_movePlanetMagnetic`.)

- [ ] **Step 2: Reload preview, verify launched → returning → jumping → walking chain**

`preview_eval`:
```js
const p = window.__game?.localPlayer;
p.body.position.x = 40;        // teleport into deep space
p.body.position.y = 0;
p.body.velocity.x = 0;
p.body.velocity.y = 0;
p._planetMode = 'returning';
p._modeStickPlanet = null;
'set';
```
Then over time monitor:
```js
const p = window.__game?.localPlayer;
({ mode: p._planetMode, x: p.body.position.x.toFixed(1), y: p.body.position.y.toFixed(1) });
```
Expected over ~3 seconds: mode transitions `returning` → `jumping` → `walking`. x trends toward 0 (toward planet center). Finally on a planet surface.

If the player gets stuck in `jumping` (never lands), check planet radius + the land condition. Likely fix: widen the land threshold to `+0.4` in the jumping branch. Inline-fix and re-verify before committing.

- [ ] **Step 3: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(stickman): returning mode pulls launched players back"
```

---

## Task 8: Update `_updateGroundCheck` curved branch for new modes

**Files:**
- Modify: `src/entities/Stickman.js:614-652`

The existing curved-gravity grounded check raycasts toward the planet. During `launched` and `returning` there's no current planet (or there is but the player isn't supposed to be considered grounded). Animations and air-jump counters need this right.

- [ ] **Step 1: Insert mode gate at the top of the curved branch**

Find (line 615 area):
```js
if (this.game?.level?.curvedGravity) {
  this._currentPlanetRef = this._currentPlanet();
  const planet = this._currentPlanetRef;
  if (!planet) {
    this.grounded = false;
    this.groundNormalY = 1;
    this.coyote = Math.max(0, this.coyote - this._dt);
    return;
  }
```

Replace with:
```js
if (this.game?.level?.curvedGravity) {
  // launched / returning: never grounded, no raycast — body is free-flying.
  if (this._planetMode === 'launched' || this._planetMode === 'returning') {
    this._currentPlanetRef = null;
    this.grounded = false;
    this.groundNormalY = 1;
    this.coyote = Math.max(0, this.coyote - this._dt);
    return;
  }
  this._currentPlanetRef = this._currentPlanet();
  const planet = this._currentPlanetRef;
  if (!planet) {
    this.grounded = false;
    this.groundNormalY = 1;
    this.coyote = Math.max(0, this.coyote - this._dt);
    return;
  }
```

- [ ] **Step 2: Reload preview, verify grounded flag is correct per mode**

`preview_eval`:
```js
const p = window.__game?.localPlayer;
({ mode: p._planetMode, grounded: p.grounded });
```
Expected at spawn: `mode: 'walking', grounded: true`.

After `applyKnockback(20, 10)`:
```js
({ mode: window.__game.localPlayer._planetMode, grounded: window.__game.localPlayer.grounded });
// expect mode: 'launched', grounded: false
```

After return + land: `mode: 'walking', grounded: true`.

- [ ] **Step 3: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "fix(stickman): grounded=false during launched/returning"
```

---

## Task 9: Tune per-planet `pullStrength` in `definitions.js`

**Files:**
- Modify: `src/levels/definitions.js:738-744` (space level)
- Modify: `src/levels/definitions.js:1130-1136` (if a second curved-gravity entry exists)

- [ ] **Step 1: Edit the space level planets array**

Find the space level config (line 738 area). The current shape is:
```js
planets: [
  { id: 'p1', cx: 0, cy: 0, radius: 5.0, mantleRadius: 3.3, coreRadius: 1.6, mass: 167 },
],
```

If the level has only one planet, expand it to the full 6-planet spec from the original space-planet-redesign design. If it already has more, leave the layout but add `pullStrength` to each. Target distribution: 2 anchors (`pullStrength: 18`) + smaller bodies (`pullStrength: 10`).

If single-planet (current state):
```js
planets: [
  { id: 'p1', cx: -12, cy: 0,  radius: 5.0, mantleRadius: 3.3, coreRadius: 1.6, pullStrength: 18 },
  { id: 'p2', cx: 12,  cy: 4,  radius: 4.5, mantleRadius: 3.0, coreRadius: 1.5, pullStrength: 18 },
  { id: 'p3', cx: 0,   cy: -8, radius: 2.5, mantleRadius: 1.7, coreRadius: 0.8, pullStrength: 10 },
  { id: 'p4', cx: -22, cy: 8,  radius: 3.0, mantleRadius: 2.0, coreRadius: 1.0, pullStrength: 10 },
  { id: 'p5', cx: 22,  cy: -10,radius: 3.0, mantleRadius: 2.0, coreRadius: 1.0, pullStrength: 10 },
  { id: 'p6', cx: 0,   cy: 12, radius: 2.0, mantleRadius: 1.4, coreRadius: 0.6, pullStrength: 10 },
],
```

If already multi-planet: just add `pullStrength` per entry (18 for the two largest, 10 for the rest).

Do the same for the second space-style entry (line 1130 area) if it exists.

- [ ] **Step 2: Reload preview, drop into space, verify planets built**

`preview_eval`:
```js
const lvl = window.__game?.level;
const ps = lvl?.planets?.map(p => ({ id: p.id, r: p.radius, pull: p.pullStrength }));
JSON.stringify(ps);
```
Expected: 6 entries (or however many you defined), each with the right pullStrength.

Visually: anchors (id `p1`, `p2`) are at left/right of frame, smaller bodies dotted around. If layout looks bad, tune `cx/cy` inline and re-verify before committing.

- [ ] **Step 3: Commit**

```bash
git add src/levels/definitions.js
git commit -m "feat(planet): per-planet pullStrength + multi-planet space layout"
```

---

## Task 10: End-to-end browser verify (acceptance criteria)

**Files:** None (verification only).

- [ ] **Step 1: Manual run through acceptance criteria from the spec**

For each item below, drive the game from `preview_eval` or by clicking, then assert with another `preview_eval`. Capture pass/fail in the commit body for Task 11.

1. **Lands on a planet, body rotated feet-down.** `preview_eval`: `({ mode: window.__game.localPlayer._planetMode, va: window.__game.localPlayer._visualAngle })` after 1s on level — mode `walking`, `_visualAngle` ≠ 0.
2. **Walks all the way around in ~3s.** Hold `moveX = 1` for 3.5s on a r=5 planet, track angle change — should pass through full 2π.
3. **Jumps straight up, comes back down.** Jump in place, assert mode goes `walking → jumping → walking` within ~0.8s.
4. **Jumps off an edge, lands on neighbouring planet.** Jump tangentially from one planet, assert eventually returns to `walking` with `_currentPlanetRef.id` of a different planet.
5. **Small moon between two big planets — no slingshot.** Stand on `p3`, walk for 5s, assert still on `p3` (the magnetic snap ignores other planets' pulls — by design).
6. **Pistol bullet arcs into nearest planet.** Fire toward open space near a planet's halo; observe projectile path curves.
7. **Kamehameha curves through halos.** Fire across system; beam visibly bends.
8. **Heavy punch sends a stickman flying + back.** Spawn a bot, punch with knockback enough to trigger launched. Assert mode chain `launched → returning → jumping → walking`.
9. **Small bump doesn't launch.** Apply `applyKnockback(2, 0)` — mode stays `walking`.
10. **60s play, never escapes map.** Let bots brawl, watch `kills` field and `outOfBounds` deaths. Expectation: gravity-only deaths = 0.

- [ ] **Step 2: Take a confirmation screenshot**

`preview_screenshot` after a punch-launch + return cycle, save as proof in the commit description.

- [ ] **Step 3: Commit verification notes**

```bash
git commit --allow-empty -m "verify: planet magnetic gravity meets acceptance criteria"
```

(Or roll into the last code commit's body if nothing changed.)

---

## Out of Scope (Deferred — Not in This Plan)

- Air control during `launched` — by design none.
- Bot pathfinding on curved surfaces — separate spec.
- Force-Push directional physics rework — separate spec.
- Themed planets / per-planet hazard variants — separate spec.
- Multiplayer snapshot expansion — current snapshot already carries pos + quaternion; no change needed for v1.

---

## Risks / Likely Issues During Implementation

- **Land threshold too tight (Task 5/7):** if jumping never converges to walking, widen the band from `+0.2` to `+0.4` and re-verify.
- **Existing `_updateBodyRotation` may reference fields you didn't touch** — read it before editing if rotation breaks. The visual-angle slerp is decoupled from `_planetMode`; should be fine.
- **`_jumpInputCooldown` interaction:** existing flat-gravity `_move` shares cooldown timers with the new path. Don't reset them in the magnetic branch — they prevent jump spam across both code paths.
- **`game.projectiles` iteration:** the new `makeProjectileGravity` still walks `game.projectiles` like the old `makePlanetGravity` did. If the projectile bodies are ALSO registered in `level.physics.world.bodies` with `kind === 'projectile'`, the loop above already skips them in the world walk — verify no double-application.
