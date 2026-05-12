# PR-D: New Weapons Batch 2 (Crossbow, Flamethrower, Dual Pistols) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three remaining new firearms — Crossbow (replaces Bow), Flamethrower (cone hitscan with lingering DoT and world-fire spread), Dual Pistols (alternating L/R with both arms aiming via a new pose flag). Closes the firearms-overhaul roster.

**Architecture:** Two new weapon classes in `src/weapons/weapons.js` (Crossbow, Flamethrower, DualPistols — three actually). Crossbow reuses the existing `Projectile` pipeline with a tuned `gravityScale` and stick behavior. Flamethrower introduces a NEW small file `src/weapons/fx/FirePatch.js` for the world-fire patch lifecycle (with a global 16-cap and FIFO eviction). Dual Pistols requires a new `poseDual` flag in the Stickman pose driver so both arms aim independently at the same target.

**Tech Stack:** Same as prior PRs.

---

## Verification Approach (read first)

Same `__weaponDebug` harness. Each weapon gets one or two `__test_*` functions. Flamethrower also gets a fire-patch cap test. Dual Pistols gets a pose-driver test. The user runs them via `preview_eval` after the implementer commits.

---

## File Structure

| File                                    | Change Type | Responsibility                                            |
|-----------------------------------------|-------------|-----------------------------------------------------------|
| `src/weapons/weapons.js`                | Modify      | Append Crossbow, Flamethrower, DualPistols; register all  |
| `src/weapons/fx/FirePatch.js`           | Create      | Single ground fire patch; module-level 16-cap with FIFO   |
| `src/entities/Stickman.js`              | Modify      | Add `poseDual` branch to pose driver                       |
| `src/util/__weaponDebug.js`             | Modify      | Behavioral test fns for each weapon                       |

---

## Task 1: Crossbow

**Files:**
- Modify: `src/weapons/weapons.js`
- Modify: `src/util/__weaponDebug.js`

Per spec: 2H, single shot per click with `fireDelay = 0.9s`, bolt velocity 1.6× old arrow, gravity factor 0.5× of old arrow (flatter arc), 28 dmg / 56 head, 8 ammo, mesh = horizontal limbs (NOT vertical), bolt sticks in target/wall.

The deleted Bow used velocity ~30 with full gravity. Crossbow: velocity ~48 with `gravityScale = 0.5` for flatter trajectory.

- [ ] **Step 1: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_crossbow_flat_arc = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const Cb = reg.Crossbow;
  window.__weaponTest.assert(Cb, 'Crossbow class missing');
  const w = new Cb(window.game);
  w.attachTo(sm); sm.weapon = w;
  sm.aimDir = { x: 1, y: 0 };
  // Fire one bolt straight forward.
  const before = window.game.projectiles.length;
  w.tryFire(sm);
  const after = window.game.projectiles.length;
  window.__weaponTest.assert(after - before === 1, 'Crossbow should spawn one bolt per click');
  const bolt = window.game.projectiles[after - 1];
  // Bolt velocity should be ~48 (1.6× the old bow's 30) along x.
  window.__weaponTest.assert(bolt.body.velocity.x > 40, 'Crossbow bolt should be fast (got vx=' + bolt.body.velocity.x + ')');
  // Bolt should have reduced gravity scale (~0.5).
  window.__weaponTest.assertNear(bolt.gravityScale, 0.5, 0.01, 'Crossbow bolt should have gravityScale 0.5 (got ' + bolt.gravityScale + ')');
  // Bolt should be sticky.
  window.__weaponTest.assert(bolt.sticky, 'Crossbow bolt should be sticky');
  // Damage 28.
  window.__weaponTest.assert(bolt.damage === 28, 'Crossbow bolt damage should be 28 (got ' + bolt.damage + ')');
  bolt.destroy(); w.destroy(); sm.weapon = null;
};
```

- [ ] **Step 2: Run, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('crossbow_flat_arc')`)
```

Expected: fail (`Crossbow class missing`).

- [ ] **Step 3: Implement Crossbow**

Append to `src/weapons/weapons.js`:

```javascript
export class Crossbow extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Crossbow';
    this.icon = '🏹';
    this.fireDelay = 0.9;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = 'support';   // 2H — one hand on the trigger, one steadies the limbs
    this.ammo = 8;
    this.length = 0.85;
    this._stringDrawn = true;    // visual: string is drawn until fired, slack briefly after
  }
  _buildMesh() {
    const grp = new THREE.Group();
    // Stock + trigger group (horizontal along the barrel axis)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.07), new THREE.MeshLambertMaterial({ color: 0x3a2410 }));
    stock.position.x = 0.1;
    // The two limbs — horizontal, perpendicular to the stock — NOT a vertical arc.
    const limbU = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.04), new THREE.MeshLambertMaterial({ color: 0x4a2a14 }));
    limbU.position.set(0.18, 0.05, 0); limbU.rotation.z = 0.5;
    const limbD = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.04), new THREE.MeshLambertMaterial({ color: 0x4a2a14 }));
    limbD.position.set(0.18, -0.05, 0); limbD.rotation.z = -0.5;
    // String — short, between limb tips, drawn back near the trigger when ready.
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.008, 0.008), new THREE.MeshLambertMaterial({ color: 0xddd8c8 }));
    string.position.set(0.0, 0, 0);
    // Bolt-on-rail visual (only visible when ready to fire — replaced after fire).
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.02), new THREE.MeshLambertMaterial({ color: 0x202024 }));
    bolt.position.set(0.18, 0.04, 0);
    grp.add(stock, limbU, limbD, string, bolt);
    this.mesh = grp;
    this._stringMesh = string;
    this._boltMesh = bolt;
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const sp = 48;  // 1.6× the old bow's 30
    const boltMesh = (() => {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 6), new THREE.MeshLambertMaterial({ color: 0x202024 }));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 6), new THREE.MeshLambertMaterial({ color: 0x666674 }));
      tip.position.y = 0.25;
      const fletch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.005), new THREE.MeshLambertMaterial({ color: 0xddccaa }));
      fletch.position.y = -0.18;
      g.add(shaft, tip, fletch);
      return g;
    })();
    const proj = new Projectile(this.game, {
      x: player.position.x + aim.x * 0.95, y: player.position.y + 0.7 + aim.y * 0.3,
      vx: aim.x * sp, vy: aim.y * sp,
      damage: 28, owner: player, mesh: boltMesh,
      gravity: true, gravityScale: 0.5,  // flatter arc than the old bow
      life: 4, radius: 0.05,
      sticky: true, stickLife: 5,
    });
    proj._orientToVel = true;
    audio.shoot();
    this.game.fx.camera.punch(0.12);
    // Visual: string snaps slack briefly.
    if (this._stringMesh) this._stringMesh.scale.x = 0.85;
    if (this._boltMesh) this._boltMesh.visible = false;
    this._postFireTimer = 0.3;
  }
  heldTick(dt, player) {
    if (this._postFireTimer > 0) {
      this._postFireTimer -= dt;
      if (this._postFireTimer <= 0) {
        if (this._stringMesh) this._stringMesh.scale.x = 1;
        if (this._boltMesh) this._boltMesh.visible = true;
      }
    }
  }
}
```

Add `Crossbow` to `WEAPON_CLASSES` (after the PR-C entries):

```javascript
export const WEAPON_CLASSES = [
  /* ... PR-C entries ... */ Crossbow, /* more after */
```

- [ ] **Step 4: Re-run, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('crossbow_flat_arc')`)
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(weapons): add Crossbow (replaces Bow, flat arc, 8 ammo)

2H grip. fireDelay 0.9s. Bolt velocity 48 (1.6x old bow), gravityScale
0.5 for flatter trajectory. 28 dmg / 56 head via PR-A swept raycast.
Sticks in targets / walls (sticky=true, stickLife=5). Horizontal limb
mesh; string snaps slack briefly post-fire."
```

---

## Task 2: Fire Patch Module

**Files:**
- Create: `src/weapons/fx/FirePatch.js`
- Modify: `src/util/__weaponDebug.js`

The Flamethrower spawns ground fire patches that ignite players who touch them, decay after 1.2s, and have a 25%/sec chance to spread to a neighbor within 1.0m. A global module-level array enforces a hard cap of 16 patches with FIFO eviction.

This file is created BEFORE the Flamethrower class so the Flamethrower has somewhere to import from.

- [ ] **Step 1: Add the cap test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_fire_patch_cap = async function () {
  const mod = await import('../weapons/fx/FirePatch.js');
  const { spawnFirePatch, getActivePatches, clearAllPatches } = mod;
  clearAllPatches();
  // Spawn 25 patches — should top out at 16 due to FIFO eviction.
  for (let i = 0; i < 25; i++) spawnFirePatch(window.game, { x: i * 0.5, y: 0, owner: null });
  const active = getActivePatches();
  window.__weaponTest.assert(active.length === 16, 'fire patches should cap at 16 (got ' + active.length + ')');
  // Earliest-spawned patches should be evicted; latest 16 retained.
  window.__weaponTest.assert(active[0].x >= 4.5, 'oldest patches should be evicted (got x=' + active[0].x + ')');
  clearAllPatches();
};
```

Note: this test uses `await import(...)`. Update `__weaponDebug.run` to support async test fns OR wrap the body in an IIFE that returns a promise. Easier: change `run` to await the result. Edit `src/util/__weaponDebug.js`:

```javascript
window.__weaponTest.run = async function (name) {
  const fn = window['__test_' + name];
  if (typeof fn !== 'function') throw new Error('No test named __test_' + name);
  try {
    await fn();
    window.__weaponTest.results.push({ name, ok: true });
    return 'PASS: ' + name;
  } catch (e) {
    window.__weaponTest.results.push({ name, ok: false, msg: e.message });
    throw e;
  }
};
```

This is a backwards-compatible change — existing sync tests continue to work because `await` on a non-promise resolves immediately.

- [ ] **Step 2: Run, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('fire_patch_cap')`)
```

Expected: fail (`Cannot find module ../weapons/fx/FirePatch.js`).

- [ ] **Step 3: Create the FirePatch module**

Create `src/weapons/fx/FirePatch.js`:

```javascript
import * as THREE from 'three';

// Global cap — total active fire patches across the whole game. FIFO
// eviction: spawning the 17th patch removes the oldest.
const PATCH_CAP = 16;
const SPREAD_CHANCE_PER_SEC = 0.25;
const SPREAD_RADIUS = 1.0;
const PATCH_LIFETIME = 1.2;
const PATCH_RADIUS = 0.5;     // ignites players within this distance
const PATCH_DAMAGE_PER_SEC = 8;

const patches = [];

export function spawnFirePatch(game, { x, y, owner = null }) {
  if (patches.length >= PATCH_CAP) {
    const evicted = patches.shift();
    evicted.destroy();
  }
  const p = new FirePatch(game, x, y, owner);
  patches.push(p);
  return p;
}

export function getActivePatches() {
  return patches.slice();
}

export function clearAllPatches() {
  while (patches.length) patches.pop().destroy();
}

export function tickAllFirePatches(dt) {
  // Iterate snapshot since destroy/spread can mutate the array.
  const snap = patches.slice();
  for (const p of snap) p.tick(dt);
}

class FirePatch {
  constructor(game, x, y, owner) {
    this.game = game;
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.life = PATCH_LIFETIME;
    this._dead = false;
    // Cheap visual: small flickering quad. Skipped on lowQ — flat-color disc.
    const isLow = !!window.__lowQ;
    const geo = isLow
      ? new THREE.CircleGeometry(PATCH_RADIUS, 6)
      : new THREE.PlaneGeometry(PATCH_RADIUS * 2, PATCH_RADIUS * 1.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff8833, transparent: true, opacity: 0.85 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x, y + 0.05, 0);
    if (game?.scene) game.scene.add(this.mesh);
  }
  tick(dt) {
    if (this._dead) return;
    this.life -= dt;
    if (this.life <= 0) { this._evict(); return; }
    // Spread roll.
    if (Math.random() < SPREAD_CHANCE_PER_SEC * dt) {
      const ang = Math.random() * Math.PI * 2;
      const r = SPREAD_RADIUS * (0.4 + 0.6 * Math.random());
      const nx = this.x + Math.cos(ang) * r;
      const ny = this.y;  // assume flat ground; could raycast for slope later
      // Avoid clustering on top of self.
      let near = false;
      for (const p of patches) {
        const dx = p.x - nx, dy = p.y - ny;
        if (dx * dx + dy * dy < 0.25 * 0.25) { near = true; break; }
      }
      if (!near) spawnFirePatch(this.game, { x: nx, y: ny, owner: this.owner });
    }
    // Damage players inside the patch.
    if (this.game?.players) {
      for (const player of this.game.players) {
        if (!player || !player.alive || player.invuln > 0) continue;
        const dx = player.position.x - this.x;
        const dy = player.position.y - this.y;
        if (dx * dx + dy * dy < PATCH_RADIUS * PATCH_RADIUS) {
          player.takeDamage(PATCH_DAMAGE_PER_SEC * dt, {
            attacker: this.owner,
            weapon: 'fire',
            kb: { x: 0, y: 0 },
            stun: 0,
          });
        }
      }
    }
    // Visual flicker — non-lowQ only.
    if (!window.__lowQ) {
      this.mesh.material.opacity = 0.6 + 0.3 * Math.sin(performance.now() * 0.025);
    }
  }
  destroy() {
    if (this._dead) return;
    this._dead = true;
    if (this.mesh?.parent) this.mesh.parent.remove(this.mesh);
  }
  _evict() {
    const idx = patches.indexOf(this);
    if (idx >= 0) patches.splice(idx, 1);
    this.destroy();
  }
}
```

Hook `tickAllFirePatches(dt)` into the game's per-tick update. Find `Game.update(dt)` (or equivalent) in `src/Game.js`. Add at the end of the per-frame entity update block:

```javascript
import { tickAllFirePatches } from './weapons/fx/FirePatch.js';
// ...
tickAllFirePatches(dt);
```

If unsure where, ASK — don't invent.

- [ ] **Step 4: Re-run, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('fire_patch_cap')`)
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(weapons): add FirePatch module (global 16-cap, FIFO, spread)

New file src/weapons/fx/FirePatch.js. Spawn API spawnFirePatch(game, opts);
patches live PATCH_LIFETIME (1.2s), damage players within PATCH_RADIUS
(0.5m) at PATCH_DAMAGE_PER_SEC (8). 25%/sec chance to spread to a neighbor
within SPREAD_RADIUS (1.0m). Hard cap 16 patches with FIFO eviction.
Visual = quad with flicker (lowQ = flat circle). Hooked into Game.update."
```

---

## Task 3: Flamethrower

**Files:**
- Modify: `src/weapons/weapons.js`
- Modify: `src/util/__weaponDebug.js`

Per spec: 2H, cone hitscan while attack held, 5m range, 25° arc, 30Hz tick rate, ignites enemies (3s lingering DoT @ 3 dmg/s after exit), spawns FirePatches on cone end, ~3.3s sustained burn (100 fuel @ 1/tick @ 30Hz), continuous low cam shake.

The "ignite enemy" path needs a status effect on Stickman. The simplest: add a `_burnDoT` field on Stickman (`{ remaining, dmgPerSec, attacker }`) that ticks down each frame and applies damage. If a status-effect system already exists in the codebase, use that instead.

- [ ] **Step 1: Find or create the burn status**

Read `src/entities/Stickman.js` — search for existing status effects (terms: `burn`, `dot`, `effect`, `status`, `stun`). If a status registry exists, register `burn` there. Otherwise, add a tiny per-tick handler:

In Stickman constructor: `this._burnDoT = null;`

In Stickman.update(dt) (find the per-tick update method): near the top, add:

```javascript
if (this._burnDoT && this.alive) {
  this._burnDoT.remaining -= dt;
  this.takeDamage(this._burnDoT.dmgPerSec * dt, {
    attacker: this._burnDoT.attacker,
    weapon: 'fire',
    kb: { x: 0, y: 0 },
    stun: 0,
  });
  if (this._burnDoT.remaining <= 0) this._burnDoT = null;
}
```

Add public method `Stickman.applyBurn(durSec, dmgPerSec, attacker)`:

```javascript
applyBurn(durSec, dmgPerSec, attacker) {
  // Refresh / extend burn — take the longer of current vs new duration,
  // and the higher of current vs new dmgPerSec.
  if (!this._burnDoT) {
    this._burnDoT = { remaining: durSec, dmgPerSec, attacker };
  } else {
    if (durSec > this._burnDoT.remaining) this._burnDoT.remaining = durSec;
    if (dmgPerSec > this._burnDoT.dmgPerSec) this._burnDoT.dmgPerSec = dmgPerSec;
    this._burnDoT.attacker = attacker;
  }
}
```

If you find an existing status system, use it instead and skip these additions.

- [ ] **Step 2: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_flamethrower_cone_ignites = async function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  const target = window.game?.players?.find(p => p && p.alive && !p.isLocal);
  window.__weaponTest.assert(sm && target, 'need local + non-local players');
  const reg = window.game.weaponRegistry || {};
  const FT = reg.Flamethrower;
  window.__weaponTest.assert(FT, 'Flamethrower class missing');
  const w = new FT(window.game);
  w.attachTo(sm); sm.weapon = w;
  // Aim at target.
  const dx = target.position.x - sm.position.x;
  const dy = target.position.y - sm.position.y;
  const len = Math.hypot(dx, dy);
  sm.aimDir = { x: dx / len, y: dy / len };
  // If target is too far, move it within range (5m).
  if (len > 4) {
    target.body.position.x = sm.position.x + sm.aimDir.x * 3;
    target.body.position.y = sm.position.y + sm.aimDir.y * 3;
  }
  w.tryFire(sm);
  for (let i = 0; i < 10; i++) w.heldTick(1 / 60, sm); // ~0.166s of flame
  window.__weaponTest.assert(target._burnDoT, 'target should be ignited (got _burnDoT=' + target._burnDoT + ')');
  w.releaseFire?.(sm);
  w.destroy(); sm.weapon = null;
};
```

- [ ] **Step 3: Run, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('flamethrower_cone_ignites')`)
```

Expected: fail (`Flamethrower class missing`).

- [ ] **Step 4: Implement Flamethrower**

Append to `src/weapons/weapons.js`:

```javascript
import { spawnFirePatch } from './fx/FirePatch.js';

export class Flamethrower extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Flamethrower';
    this.icon = '🔥';
    this.fireDelay = 0;       // tick-driven, not click-driven
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = 'support';
    this.ammo = 100;          // fuel units, 1 per tick @ 30Hz = ~3.3s sustained
    this.length = 0.75;
    this._held = false;
    this._tickAccum = 0;
    this._tickDur = 1 / 30;
    this._range = 5;
    this._coneRad = 25 * Math.PI / 180;  // half-angle = 12.5°
    this._burnDur = 3;
    this._burnDmgPerSec = 3;
    this._coneVisual = null;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.32, 8), new THREE.MeshLambertMaterial({ color: 0x553311 }));
    tank.rotation.z = Math.PI / 2; tank.position.set(0.0, -0.05, 0);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 8), new THREE.MeshLambertMaterial({ color: 0x222226 }));
    nozzle.rotation.z = Math.PI / 2; nozzle.position.set(0.5, 0.05, 0);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.08), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    grip.position.set(0.18, -0.18, 0); grip.rotation.z = -0.15;
    grp.add(tank, nozzle, grip);
    this.mesh = grp;
  }
  tryFire(player) {
    this._held = true;
    if (!this._coneVisual) this._buildConeVisual();
    if (this._coneVisual) this._coneVisual.visible = true;
  }
  releaseFire(player) {
    this._held = false;
    if (this._coneVisual) this._coneVisual.visible = false;
  }
  _buildConeVisual() {
    // Cheap 2-layer triangular fan as the flame cone.
    const geo = new THREE.ConeGeometry(this._range * Math.tan(this._coneRad), this._range, 8, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff7733, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const cone = new THREE.Mesh(geo, mat);
    cone.visible = false;
    this.game.scene.add(cone);
    this._coneVisual = cone;
  }
  heldTick(dt, player) {
    if (!this._held) return;
    this._tickAccum += dt;
    while (this._tickAccum >= this._tickDur && this.ammo > 0) {
      this._tickAccum -= this._tickDur;
      this._fireOneCone(player);
      this.ammo--;
      if (this.ammo <= 0) {
        this._held = false;
        if (this._coneVisual) this._coneVisual.visible = false;
        player.weapon = null;
        this.destroy();
        return;
      }
    }
    // Update cone visual position + orientation.
    if (this._coneVisual && this._held) {
      const aim = this.effectiveAimDir ?? player.aimDir;
      const ang = Math.atan2(aim.y, aim.x);
      const cx = player.position.x + aim.x * (this._range / 2);
      const cy = player.position.y + 0.6 + aim.y * (this._range / 2);
      this._coneVisual.position.set(cx, cy, 0);
      // ConeGeometry's axis is +Y, so rotate to point along aim.
      this._coneVisual.rotation.set(0, 0, ang - Math.PI / 2);
    }
    // Continuous low cam shake.
    if (this._held) this.game.fx.camera.punch(0.005);
  }
  _fireOneCone(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const aimAng = Math.atan2(aim.y, aim.x);
    const halfArc = this._coneRad;
    const r2 = this._range * this._range;
    const ox = player.position.x, oy = player.position.y + 0.6;
    // Ignite players inside the cone.
    for (const p of this.game.players) {
      if (!p || !p.alive || p === player || p.invuln > 0) continue;
      const dx = p.position.x - ox, dy = p.position.y - oy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const ang = Math.atan2(dy, dx);
      let delta = ang - aimAng;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) > halfArc) continue;
      // Cone hit — apply / refresh burn.
      p.applyBurn?.(this._burnDur, this._burnDmgPerSec, player);
    }
    // Spawn world fire patches on the cone end-arc — sample 3 points.
    for (let i = 0; i < 3; i++) {
      const sampleAng = aimAng + (i - 1) * (halfArc * 0.6);
      const sx = ox + Math.cos(sampleAng) * this._range * 0.95;
      const sy = oy + Math.sin(sampleAng) * this._range * 0.95;
      // Naive ground-detect: cast a short ray downward to find a walkable
      // surface. If hit within 0.6m below sample, spawn a patch there.
      const hit = this.game.physics.raycast(
        { x: sx, y: sy + 0.3, z: 0 },
        { x: sx, y: sy - 0.6, z: 0 },
        { mask: COL_GROUPS.WORLD },
      );
      if (hit) {
        const hx = hit.hitPointWorld.x;
        const hy = hit.hitPointWorld.y + 0.02;
        spawnFirePatch(this.game, { x: hx, y: hy, owner: player });
      }
    }
  }
  destroy() {
    if (this._coneVisual?.parent) this._coneVisual.parent.remove(this._coneVisual);
    super.destroy?.();
  }
}
```

Add `Flamethrower` to `WEAPON_CLASSES`.

- [ ] **Step 5: Re-run, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('flamethrower_cone_ignites')`)
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(weapons): add Flamethrower (5m cone hitscan + lingering DoT + world fire)

2H grip. Tick-driven (30Hz) while attack held. Cone arc 25° (half-angle
12.5°), range 5m. Players hit by the cone get _burnDoT (3s @ 3 dmg/s,
refreshed on continued contact). Each tick samples 3 ground points on
the cone's far arc and spawns a FirePatch on each (capped at 16 globally
via FirePatch's FIFO). 100 fuel = ~3.3s sustained burn. Continuous low
cam shake. Cone visual is a single ConeGeometry mesh updated each tick;
no particles."
```

---

## Task 4: Dual Pistols

**Files:**
- Modify: `src/entities/Stickman.js`
- Modify: `src/weapons/weapons.js`
- Modify: `src/util/__weaponDebug.js`

Per spec: alternating L/R per click (Hitman: Blood Money style), `fireDelay = 0.18s`, ~12 dmg/shot, 1° aim spread, cam punch 0.07, both arms aim same crosshair via new `poseDual` flag, 24 ammo (12 per gun visually), two pistol meshes (one per hand).

The pose driver from PR-B Task 0 already supports `poseLeft = 'aim'` for the dual case (we conditioned on either `'support'` or `'aim'`). Confirm and extend if needed.

- [ ] **Step 1: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_dual_pistols_alt_fire = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const DP = reg.DualPistols;
  window.__weaponTest.assert(DP, 'DualPistols class missing');
  const w = new DP(window.game);
  w.attachTo(sm); sm.weapon = w;
  // Pose flags — both arms aim.
  window.__weaponTest.assert(w.poseRight === 'aim', 'poseRight should be aim');
  window.__weaponTest.assert(w.poseLeft === 'aim', 'poseLeft should be aim (dual)');
  // Drive pose driver and confirm both arms get 'aim' pose.
  sm.input = { ...sm.input, aimActive: true };
  sm.aimDir = { x: 1, y: 0 };
  sm._syncRig(1 / 60, false);
  window.__weaponTest.assert(sm._lastArmPoseR === 'aim', 'right arm should aim (got ' + sm._lastArmPoseR + ')');
  window.__weaponTest.assert(sm._lastArmPoseL === 'aim', 'left arm should aim (got ' + sm._lastArmPoseL + ')');
  // Fire 4 shots — should alternate hand.
  const seen = [];
  const origFire = w.fire.bind(w);
  w.fire = function (player) { seen.push(this._nextHand); origFire(player); };
  w.tryFire(sm); w.cooldown = 0;
  w.tryFire(sm); w.cooldown = 0;
  w.tryFire(sm); w.cooldown = 0;
  w.tryFire(sm);
  window.__weaponTest.assert(seen.length === 4, 'should record 4 shots (got ' + seen.length + ')');
  // Sequence should alternate (L/R or R/L — either order).
  const alt = (seen[0] !== seen[1]) && (seen[1] !== seen[2]) && (seen[2] !== seen[3]);
  window.__weaponTest.assert(alt, 'fire should alternate hand each click (got ' + seen.join(',') + ')');
  // Cleanup
  while (window.game.projectiles.length) window.game.projectiles.pop().destroy?.();
  w.destroy(); sm.weapon = null;
};
```

- [ ] **Step 2: Run, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('dual_pistols_alt_fire')`)
```

Expected: fail (`DualPistols class missing`).

- [ ] **Step 3: Confirm pose driver supports `poseLeft = 'aim'`**

Open `src/entities/Stickman.js`. The PR-B Task 0 fix sets:

```javascript
const supports2H = this.weapon?.poseLeft === 'support' || this.weapon?.poseLeft === 'aim';
```

This already covers the `'aim'` case. Confirm it's still in place. If not, restore it. No changes to Stickman if PR-B is correctly merged.

- [ ] **Step 4: Implement DualPistols**

Append to `src/weapons/weapons.js`:

```javascript
export class DualPistols extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'DualPistols';
    this.icon = '🔫🔫';
    this.fireDelay = 0.18;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = 'aim';        // NEW — drives pose driver to dual-aim mode
    this.ammo = 24;               // 12 per gun visually
    this.length = 0.55;
    this._nextHand = 'R';         // 'R' | 'L'
    this._lastFireRecoil = null;  // tracks which arm to animate kickback (visual)
  }
  _buildMesh() {
    // Two pistol-like groups, one per hand. updateMesh() will position each
    // at its respective rig hand each frame instead of the default single-hand
    // anchor — see updateMesh override below.
    const buildOne = (color = 0x333344) => {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.08), new THREE.MeshLambertMaterial({ color }));
      body.position.x = 0.2;
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.08), new THREE.MeshLambertMaterial({ color: 0x222222 }));
      grip.position.set(0.04, -0.15, 0); grip.rotation.z = -0.18;
      grp.add(body, grip);
      return grp;
    };
    this._meshR = buildOne(0x333344);
    this._meshL = buildOne(0x333344);
    // The base Weapon.mesh is the parent that gets added to the scene by
    // attachTo. Use a Group containing both — but each pistol gets positioned
    // in updateMesh from its respective hand bone, not from this group's
    // transform. So we keep the parent at origin and position children
    // absolutely each frame.
    const grp = new THREE.Group();
    grp.add(this._meshR);
    grp.add(this._meshL);
    this.mesh = grp;
  }
  updateMesh(player) {
    // Override: don't run the base wall-reorient (would conflict with two
    // independent muzzle anchors). Position each pistol at its respective
    // hand bone, rotate to aim direction.
    if (!player) return;
    const handR = player.rig?.handR?.position;
    const handL = player.rig?.handL?.position;
    const aim = player.aimDir;
    const ang = Math.atan2(aim.y, aim.x);
    const facing = player.facing;
    if (handR && this._meshR) {
      this._meshR.position.set(handR.x, handR.y, 0);
      this._meshR.rotation.set(0, 0, ang);
      this._meshR.scale.set(1, facing >= 0 ? 1 : -1, 1);
    }
    if (handL && this._meshL) {
      this._meshL.position.set(handL.x, handL.y, 0);
      this._meshL.rotation.set(0, 0, ang);
      this._meshL.scale.set(1, facing >= 0 ? 1 : -1, 1);
    }
    // For the wall-reorient muzzle contract, we set effectiveAimDir to the
    // unmodified player aim (dual pistols don't do per-hand wall reorient
    // for v1 — that would be visually busy).
    this.effectiveAimDir = { x: aim.x, y: aim.y };
    this.aimAdjusted = false;
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    // Slight aim spread (~1°).
    const a = Math.atan2(aim.y, aim.x) + rand(-0.018, 0.018);
    const sp = 38;
    // Muzzle position depends on which hand is firing this shot.
    const handBone = (this._nextHand === 'R') ? player.rig?.handR : player.rig?.handL;
    const mx = handBone?.position?.x ?? (player.position.x + aim.x * 0.7);
    const my = handBone?.position?.y ?? (player.position.y + 0.7);
    new Projectile(this.game, {
      x: mx + aim.x * 0.3, y: my + aim.y * 0.3,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      damage: 12, owner: player, gravity: false, life: 1.5, radius: 0.07,
      color: 0xffcc55, emissive: 0xffaa22, tracer: true,
    });
    audio.shoot();
    this.game.fx.camera.punch(0.07);
    this._lastFireRecoil = this._nextHand;
    this._nextHand = (this._nextHand === 'R') ? 'L' : 'R';
  }
}
```

Add `DualPistols` to `WEAPON_CLASSES`.

- [ ] **Step 5: Re-run, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('dual_pistols_alt_fire')`)
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(weapons): add DualPistols (alt-fire L/R, both arms aim, 24 ammo)

New poseLeft='aim' flag — pose driver from PR-B already supports this
(both arms drive to 'aim' pose). Custom updateMesh() positions one
pistol mesh at each hand bone per frame; bypasses base wall-reorient
for v1. fire() alternates _nextHand R→L→R→L per click. Spread 1°
(0.018 rad). Cam punch 0.07/shot. Fall back to player aim direction
since dual doesn't do per-hand wall reorient yet."
```

---

## Task 5: End-to-End Smoke Run

- [ ] **Step 1: Run all PR-D tests**

```javascript
preview_eval(`(async () => Promise.all(
  ['crossbow_flat_arc', 'fire_patch_cap', 'flamethrower_cone_ignites', 'dual_pistols_alt_fire']
    .map(async n => { try { return await window.__weaponTest.run(n); } catch (e) { return 'FAIL: ' + n + ' — ' + e.message; } })
))()`)
```

Expected: 4 PASS.

Re-run all PR-A, PR-B, PR-C tests too. Expected: all PASS.

- [ ] **Step 2: Manual sanity check**

For each new weapon:
- Crossbow: bolt has visibly flatter arc than the deleted Bow at long range. Bolt sticks in walls + ragdolls.
- Flamethrower: hold attack, cone of flame visible 5m forward, target catches fire and continues burning briefly after exiting cone. World fire patches appear at cone end on flat ground; max 16 visible at once.
- Dual Pistols: both arms aim independently at crosshair. Click alternates which gun fires; visible recoil only on the firing arm.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin <branch>
gh pr create --title "PR-D: new weapons batch 2 (Crossbow, Flamethrower, Dual Pistols)" --body "..."
```

PR body summarizes the three new weapons + the FirePatch module + the burn DoT addition.

---

## Self-Review Checklist (filled out)

**Spec coverage:**
- §2.4 Crossbow → Task 1 ✓
- §2.5 Flamethrower → Tasks 2 (FirePatch) + 3 (Flamethrower) ✓
- §2.6 Dual Pistols → Task 4 ✓
- Pose driver `poseDual='aim'` → already covered by PR-B Task 0 (`supports2H` checks both `'support'` and `'aim'`); Task 4 confirms.

**Placeholder scan:** Two explicit "ASK if unsure" escalation points: (1) where to insert `tickAllFirePatches(dt)` in `Game.update`, (2) finding/creating the burn-DoT integration point in `Stickman.update`. These are integration questions where guessing is wrong.

**Type consistency:**
- `spawnFirePatch`, `getActivePatches`, `clearAllPatches`, `tickAllFirePatches` — all defined in Task 2, consumed in Task 3 (`spawnFirePatch`) and the harness (`getActivePatches`, `clearAllPatches`).
- `Stickman.applyBurn(durSec, dmgPerSec, attacker)` — defined in Task 3 step 1, consumed in Task 3 `_fireOneCone` and the FirePatch tick. Same signature.
- `_burnDoT` field — initialized in Stickman constructor in Task 3 step 1, consumed in Stickman.update in Task 3 step 1, mutated by `applyBurn`. Consistent.
- `DualPistols.poseLeft = 'aim'` — pose driver from PR-B handles this case via `supports2H = poseLeft === 'support' || poseLeft === 'aim'`.
- `_nextHand` toggle in DualPistols — defined in constructor, mutated in `fire()`, asserted in test.
- All three weapons read `this.effectiveAimDir ?? player.aimDir` for muzzle direction.
- Async test pattern (`__test_fire_patch_cap`) requires `__weaponTest.run` to be async — Task 2 step 1 explicitly updates `run` to await its callee. Backwards compatible (sync tests still work).

**Known deferred concerns:**
- DualPistols disables wall-reorient (commented in updateMesh). v2 could reorient each pistol independently per its own hand-vs-wall ray. Not in scope.
- FirePatch ground-detect uses a downward raycast from the cone sample point; if the level has no walkable surface within 0.6m below the sample, no patch spawns. Acceptable — cone fired into open air shouldn't spawn ground fire.
