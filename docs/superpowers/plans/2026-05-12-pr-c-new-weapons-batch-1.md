# PR-C: New Weapons Batch 1 (SMG, Assault Rifle, Revolver) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new firearms — SMG (full-auto, low-recoil), Assault Rifle (3-round burst only, mid-range workhorse), Revolver (slow heavy 1H, signature low ammo). All three reuse the existing aim-weapon pipeline plus the foundation work in PR-A (`effectiveAimDir`, swept-capsule headshot raycast) and PR-B (`heldTick`, pose flag respect, 2H wiring). No new infrastructure.

**Architecture:** Three new weapon classes appended to `src/weapons/weapons.js`, all extending `Weapon`. SMG and AR are 2H (`poseLeft = 'support'`); Revolver is 1H (`poseLeft = null`). SMG fires per `tryFire` per click — but to feel auto, it relies on the existing per-tick `heldTick` hook from PR-B; for now, SMG's `heldTick` does the auto-fire while attack is held. AR uses a small burst-state on the weapon instance to fire 3 shots at 0.05s intervals after a single click, with a 0.4s cooldown between bursts. Revolver is single-shot per click with the standard `fireDelay = 0.5s`. All three register in `WEAPON_CLASSES`.

**Tech Stack:** Same as PR-A/B — plain ES modules, three.js for meshes, cannon-es projectile bodies.

---

## Verification Approach (read first)

Same `__weaponDebug` harness. Each weapon gets one or two `__test_*` functions verifying its core behavior (fire rate, damage, ammo decrement). The user runs them via `preview_eval` after the implementer commits.

---

## File Structure

| File                                    | Change Type | Responsibility                                            |
|-----------------------------------------|-------------|-----------------------------------------------------------|
| `src/weapons/weapons.js`                | Modify      | Append SMG, AR, Revolver classes; add to `WEAPON_CLASSES` |
| `src/util/__weaponDebug.js`             | Modify      | Three behavioral test fns                                 |

No new files. No file outside this list is touched.

---

## Task 1: SMG

**Files:**
- Modify: `src/weapons/weapons.js`
- Modify: `src/util/__weaponDebug.js`

Per spec: 2H grip, full-auto via PR-B's `heldTick`, `fireDelay = 0.06s`, damage ~6/shot, 4° hip spread cone, cam punch 0.025/shot, no velocity kick (small caliber), 60 ammo, mesh = short box receiver + stubby barrel + curved magazine below.

- [ ] **Step 1: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_smg_full_auto = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const SMG = reg.SMG;
  window.__weaponTest.assert(SMG, 'SMG class missing');
  const w = new SMG(window.game);
  w.attachTo(sm); sm.weapon = w;
  sm.aimDir = { x: 1, y: 0 };
  // Press attack — should start auto-firing immediately (no spin-up).
  w.tryFire(sm);
  const before = window.game.projectiles.length;
  // 0.5s of held attack at fireDelay 0.06s = ~8 shots.
  for (let i = 0; i < 30; i++) w.heldTick(1 / 60, sm);
  const after = window.game.projectiles.length;
  window.__weaponTest.assert(after - before >= 6, 'SMG should auto-fire ~6+ shots in 0.5s held (got ' + (after - before) + ')');
  // Cleanup
  while (window.game.projectiles.length) window.game.projectiles.pop().destroy?.();
  w.destroy(); sm.weapon = null;
};
```

- [ ] **Step 2: Run, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('smg_full_auto')`)
```

Expected: fail (`SMG class missing`).

- [ ] **Step 3: Implement SMG**

Open `src/weapons/weapons.js`. After the existing `Minigun` class (around line 478) and BEFORE the (about-to-be-deleted-or-already-deleted-by-PR-B) Bow region, append:

```javascript
export class SMG extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'SMG';
    this.icon = '🔫';
    this.fireDelay = 0.06;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = 'support';
    this.ammo = 60;
    this.length = 0.55;
    this._held = false;
    this._fireAccum = 0;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const recv = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.1), new THREE.MeshLambertMaterial({ color: 0x2a2a2e }));
    recv.position.x = 0.21;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 8), new THREE.MeshLambertMaterial({ color: 0x141417 }));
    barrel.rotation.z = Math.PI / 2; barrel.position.x = 0.55;
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.08), new THREE.MeshLambertMaterial({ color: 0x1a1a1d }));
    mag.position.set(0.18, -0.18, 0); mag.rotation.z = -0.18;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.08), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    grip.position.set(0.05, -0.18, 0); grip.rotation.z = -0.15;
    grp.add(recv, barrel, mag, grip);
    this.mesh = grp;
  }
  tryFire(player) {
    // Mark "trigger held" — heldTick will keep firing each fireDelay.
    this._held = true;
    if (this.cooldown > 0) return;
    // Allow the very first shot to fire immediately on press.
    this._fireAccum = this.fireDelay;
  }
  releaseFire(player) {
    this._held = false;
    this._fireAccum = 0;
  }
  heldTick(dt, player) {
    if (!this._held) return;
    this._fireAccum += dt;
    while (this._fireAccum >= this.fireDelay && this.ammo > 0) {
      this._fireAccum -= this.fireDelay;
      this.fire(player);
      this.ammo--;
      if (this.ammo <= 0) { player.weapon = null; this.destroy(); return; }
    }
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const a = Math.atan2(aim.y, aim.x) + rand(-0.07, 0.07); // ~4° hip spread
    const sp = 40;
    new Projectile(this.game, {
      x: player.position.x + aim.x * 0.7, y: player.position.y + 0.7 + aim.y * 0.3,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      damage: 6, owner: player, gravity: false, life: 1.2, radius: 0.05,
      color: 0xffcc66, tracer: true,
    });
    audio.shoot();
    this.game.fx.camera.punch(0.025);
  }
}
```

Add `SMG` to the `WEAPON_CLASSES` array (around line 2331). Insert after `Minigun`:

```javascript
export const WEAPON_CLASSES = [
  Sword, Bat, Pistol, Shotgun, Minigun, SMG, /* ... */
```

(Bow already removed by PR-B Task 5; if your branch base hasn't merged PR-B, remove it now.)

- [ ] **Step 4: Re-run, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('smg_full_auto')`)
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(weapons): add SMG (2H full-auto, low recoil, 60 ammo)

Fires while attack held via heldTick. fireDelay 0.06s, 4° hip spread,
6 dmg/shot, cam punch 0.025/shot, no velocity kick. Stubby barrel + curved
magazine mesh. Reuses PR-A swept raycast for headshots and PR-A wall
reorient via effectiveAimDir."
```

---

## Task 2: Assault Rifle

**Files:**
- Modify: `src/weapons/weapons.js`
- Modify: `src/util/__weaponDebug.js`

Per spec: 2H, 3-round burst only. Burst interval 0.05s between shots. Burst cooldown 0.4s between bursts. Damage ~12/shot, ~36/burst. Spread ~2° tightening shot 1→3. Recoil cam punch 0.06 first shot, 0.04 + 0.04 follow-ups. 30 ammo. Mesh = rifle receiver + long barrel + stock + scope rail (cosmetic).

- [ ] **Step 1: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_ar_three_burst = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const AR = reg.AssaultRifle;
  window.__weaponTest.assert(AR, 'AssaultRifle class missing');
  const w = new AR(window.game);
  w.attachTo(sm); sm.weapon = w;
  sm.aimDir = { x: 1, y: 0 };
  // Single tap should produce 3 shots over ~0.1s.
  const before = window.game.projectiles.length;
  w.tryFire(sm);
  for (let i = 0; i < 12; i++) w.heldTick(1 / 60, sm); // 0.2s — enough for 3 burst shots @ 0.05s
  const after = window.game.projectiles.length;
  window.__weaponTest.assert(after - before === 3, 'AR single tap should fire exactly 3 shots (got ' + (after - before) + ')');
  // Holding attack should NOT auto-fire more bursts until tryFire is called again with cooldown done.
  for (let i = 0; i < 12; i++) w.heldTick(1 / 60, sm);
  const sustained = window.game.projectiles.length;
  window.__weaponTest.assert(sustained - after === 0, 'AR should not auto-burst on held attack (got ' + (sustained - after) + ' extra shots)');
  // After 0.4s cooldown, another tap fires another 3 shots.
  for (let i = 0; i < 25; i++) w.heldTick(1 / 60, sm); // 0.4s+ elapsed
  w.tryFire(sm);
  for (let i = 0; i < 12; i++) w.heldTick(1 / 60, sm);
  const second = window.game.projectiles.length;
  window.__weaponTest.assert(second - sustained === 3, 'AR second tap after cooldown should fire 3 more (got ' + (second - sustained) + ')');
  // Cleanup
  while (window.game.projectiles.length) window.game.projectiles.pop().destroy?.();
  w.destroy(); sm.weapon = null;
};
```

- [ ] **Step 2: Run, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('ar_three_burst')`)
```

Expected: fail.

- [ ] **Step 3: Implement Assault Rifle**

Append after SMG in `src/weapons/weapons.js`:

```javascript
export class AssaultRifle extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'AssaultRifle';
    this.icon = '🪖';
    this.fireDelay = 0.4;        // burst cooldown
    this._burstInterval = 0.05;  // between shots within a burst
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = 'support';
    this.ammo = 30;
    this.length = 0.95;
    this._burstRemaining = 0;
    this._burstAccum = 0;
    this._burstShotIndex = 0;    // 0, 1, 2 — drives spread tightening + recoil curve
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const recv = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.13, 0.1), new THREE.MeshLambertMaterial({ color: 0x33332e }));
    recv.position.x = 0.27;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 10), new THREE.MeshLambertMaterial({ color: 0x14140f }));
    barrel.rotation.z = Math.PI / 2; barrel.position.x = 0.78;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.08), new THREE.MeshLambertMaterial({ color: 0x2a201a }));
    stock.position.x = -0.08;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.05), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    rail.position.set(0.32, 0.1, 0);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.08), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
    grip.position.set(0.08, -0.18, 0); grip.rotation.z = -0.15;
    grp.add(recv, barrel, stock, rail, grip);
    this.mesh = grp;
  }
  tryFire(player) {
    if (this.cooldown > 0) return;
    if (this._burstRemaining > 0) return;  // ignore mid-burst re-press
    this.cooldown = this.fireDelay;
    this._burstRemaining = 3;
    this._burstAccum = this._burstInterval; // fire shot 0 immediately on next heldTick
    this._burstShotIndex = 0;
  }
  heldTick(dt, player) {
    if (this._burstRemaining <= 0) return;
    this._burstAccum += dt;
    while (this._burstAccum >= this._burstInterval && this._burstRemaining > 0 && this.ammo > 0) {
      this._burstAccum -= this._burstInterval;
      this.fire(player, this._burstShotIndex);
      this._burstShotIndex++;
      this._burstRemaining--;
      this.ammo--;
      if (this.ammo <= 0) { player.weapon = null; this.destroy(); return; }
    }
  }
  fire(player, shotIndex = 0) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    // Spread tightens shot 1→3 (predictable recoil pattern).
    const spread = [0.035, 0.025, 0.015][shotIndex] ?? 0.02;
    const a = Math.atan2(aim.y, aim.x) + rand(-spread, spread);
    const sp = 50;
    new Projectile(this.game, {
      x: player.position.x + aim.x * 0.95, y: player.position.y + 0.7 + aim.y * 0.3,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      damage: 12, owner: player, gravity: false, life: 1.4, radius: 0.06,
      color: 0xffeecc, tracer: true,
    });
    audio.shoot();
    const punch = shotIndex === 0 ? 0.06 : 0.04;
    this.game.fx.camera.punch(punch);
  }
}
```

Add `AssaultRifle` to `WEAPON_CLASSES`:

```javascript
export const WEAPON_CLASSES = [
  Sword, Bat, Pistol, Shotgun, Minigun, SMG, AssaultRifle, /* ... */
```

- [ ] **Step 4: Re-run, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('ar_three_burst')`)
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(weapons): add Assault Rifle (2H 3-round burst, 30 ammo)

Single tap = 3 shots @ 0.05s interval. 0.4s cooldown between bursts;
holding attack does NOT auto-fire more bursts. Spread tightens 1→3
within a burst (0.035 → 0.025 → 0.015 rad) for a predictable recoil
pattern. Cam punch 0.06 first shot, 0.04 follow-ups. Reuses PR-A
swept raycast + wall reorient."
```

---

## Task 3: Revolver

**Files:**
- Modify: `src/weapons/weapons.js`
- Modify: `src/util/__weaponDebug.js`

Per spec: 1H, single-shot per click, `fireDelay = 0.5s`. Damage 35/shot (2× = 70 head). Spread 0 (precision). Cam punch 0.18, velocity kick -0.25 grounded / -0.5 air. 6 ammo (signature low). Mesh = visible 6-chamber cylinder + exposed hammer (cosmetic anim).

- [ ] **Step 1: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_revolver_heavy_single_shot = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const Rev = reg.Revolver;
  window.__weaponTest.assert(Rev, 'Revolver class missing');
  const w = new Rev(window.game);
  w.attachTo(sm); sm.weapon = w;
  sm.aimDir = { x: 1, y: 0 };
  window.__weaponTest.assert(w.poseLeft === null, 'Revolver should be 1H (poseLeft=null)');
  window.__weaponTest.assert(w.ammo === 6, 'Revolver should start with 6 ammo');

  const before = window.game.projectiles.length;
  w.tryFire(sm);
  const after = window.game.projectiles.length;
  window.__weaponTest.assert(after - before === 1, 'Revolver should fire exactly 1 projectile per click (got ' + (after - before) + ')');
  // Damage on the just-spawned projectile should be 35.
  const proj = window.game.projectiles[after - 1];
  window.__weaponTest.assert(proj.damage === 35, 'Revolver projectile damage should be 35 (got ' + proj.damage + ')');
  // Click again immediately — cooldown should block.
  const beforeCool = window.game.projectiles.length;
  w.tryFire(sm);
  window.__weaponTest.assert(window.game.projectiles.length === beforeCool, 'Revolver should be on cooldown after firing');
  // Cleanup
  while (window.game.projectiles.length) window.game.projectiles.pop().destroy?.();
  w.destroy(); sm.weapon = null;
};
```

- [ ] **Step 2: Run, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('revolver_heavy_single_shot')`)
```

Expected: fail.

- [ ] **Step 3: Implement Revolver**

Append after AssaultRifle in `src/weapons/weapons.js`:

```javascript
export class Revolver extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Revolver';
    this.icon = '🔫';
    this.fireDelay = 0.5;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = null;          // 1H
    this.ammo = 6;
    this.length = 0.55;
    this._hammerCock = 0;          // 0..1 — visual cock progress
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.09), new THREE.MeshLambertMaterial({ color: 0x4a3018 }));
    body.position.x = 0.2;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.32, 10), new THREE.MeshLambertMaterial({ color: 0x222226 }));
    barrel.rotation.z = Math.PI / 2; barrel.position.x = 0.5;
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.1, 6), new THREE.MeshLambertMaterial({ color: 0x33332e }));
    cylinder.rotation.z = Math.PI / 2; cylinder.position.set(0.18, 0, 0);
    const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.05), new THREE.MeshLambertMaterial({ color: 0x111114 }));
    hammer.position.set(0.05, 0.1, 0);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.08), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    grip.position.set(0.02, -0.18, 0); grip.rotation.z = -0.25;
    grp.add(body, barrel, cylinder, hammer, grip);
    this.mesh = grp;
    this._hammerMesh = hammer;
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const sp = 60;
    new Projectile(this.game, {
      x: player.position.x + aim.x * 0.7, y: player.position.y + 0.7 + aim.y * 0.3,
      vx: aim.x * sp, vy: aim.y * sp,
      damage: 35, owner: player, gravity: false, life: 1.5, radius: 0.09,
      color: 0xffaa55, emissive: 0xff7733, tracer: true,
    });
    audio.shoot();
    const rec = player.grounded ? 0.25 : 0.5;
    player.body.velocity.x -= aim.x * rec;
    if (!player.grounded) player.body.velocity.y -= aim.y * 0.4;
    this.game.fx.camera.punch(0.18);
    this.game.fx.particles.burst(player.position.x + aim.x, player.position.y + 0.7, 0,
      { count: 7, speed: 5, color: 0xffaa55 });
    this._hammerCock = 1; // trigger cock-back anim
  }
  heldTick(dt, player) {
    // Cosmetic: hammer eases back to rest.
    if (this._hammerCock > 0) {
      this._hammerCock = Math.max(0, this._hammerCock - dt * 4);
      if (this._hammerMesh) this._hammerMesh.rotation.z = -0.4 * this._hammerCock;
    }
  }
}
```

Add `Revolver` to `WEAPON_CLASSES`:

```javascript
export const WEAPON_CLASSES = [
  Sword, Bat, Pistol, Shotgun, Minigun, SMG, AssaultRifle, Revolver, /* ... */
```

- [ ] **Step 4: Re-run, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('revolver_heavy_single_shot')`)
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(weapons): add Revolver (1H, 35 dmg, 6 ammo, heavy recoil)

Single shot per click, 0.5s cooldown, 0 spread. Cam punch 0.18 + velocity
kick -0.25 grounded / -0.5 air. Visible 6-chamber cylinder + cosmetic
hammer cock-back anim per shot. 1H pose (poseLeft=null) — left arm relaxed."
```

---

## Task 4: End-to-End Smoke Run

- [ ] **Step 1: Run all PR-C tests**

```javascript
preview_eval(`
  ['smg_full_auto', 'ar_three_burst', 'revolver_heavy_single_shot']
    .map(n => { try { return window.__weaponTest.run(n); } catch (e) { return 'FAIL: ' + n + ' — ' + e.message; } })
`)
```

Expected: 3 PASS.

Re-run PR-A and PR-B suites. Expected: all PASS.

- [ ] **Step 2: Manual sanity check**

Spawn each new weapon. Confirm visually:
- SMG: 2H grip, fires while attack held, low recoil pattern.
- AR: 2H grip, 3 shots per click in tight burst, predictable recoil ladder.
- Revolver: 1H grip (left arm relaxed), one big shot per click, visible hammer cocks.

Walk into walls with each — bullets emit along wall (PR-A wall reorient via `effectiveAimDir`).

Headshot a dummy with each — 2× damage and head-snap fires (PR-A swept raycast).

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin <branch>
gh pr create --title "PR-C: new weapons batch 1 (SMG, AR, Revolver)" --body "..."
```

PR body: stat sheets, the three test names, and "reuses PR-A foundations + PR-B `heldTick` hook."

---

## Self-Review Checklist (filled out)

**Spec coverage:**
- §2.1 SMG → Task 1 ✓
- §2.2 Assault Rifle → Task 2 ✓
- §2.3 Revolver → Task 3 ✓
- §2.4 Crossbow, §2.5 Flamethrower, §2.6 Dual Pistols → PR-D

**Placeholder scan:** No TBD. Recoil, spread, ammo, damage all numerically specified per spec.

**Type consistency:**
- All three weapons inherit from `Weapon`, set `aimWeapon = true`, `poseRight = 'aim'`, set `length` for the wall-reorient ray.
- SMG and AR override `heldTick(dt, player)` introduced in PR-B Task 3. Revolver overrides `heldTick` only for the cosmetic hammer anim.
- All three call `audio.shoot()`, `this.game.fx.camera.punch(...)`, `Projectile` constructor with the established options bag. Consistent.
- All three read `this.effectiveAimDir ?? player.aimDir` for muzzle direction (PR-A contract).
