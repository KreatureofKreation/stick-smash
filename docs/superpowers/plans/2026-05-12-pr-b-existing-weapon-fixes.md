# PR-B: Existing Weapon Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the existing firearm roster's pose accuracy (1H vs 2H), wire existing aim weapons to use the wall-reorient muzzle origin from PR-A, fix the Minigun's semi-auto-feels-broken behavior with a spin-up + auto-fire state machine, anchor the Sniper's red-dot beam under the barrel where it visually belongs, and delete the now-redundant Bow class. PR-A merged as [#44](https://github.com/KreatureofKreation/stick-smash/pull/44); this PR layers on top.

**Architecture:** Six self-contained changes within `src/entities/Stickman.js` (pose driver), `src/weapons/weapons.js` (weapon classes + registry), and `src/util/__weaponDebug.js` (verification harness). No new files. The existing aim-weapon classes change only their pose flags and their `fire()` muzzle-origin reads. The Minigun gains a small per-weapon update tick (state machine for spin-up/firing/spin-down). The Sniper changes one helper method. Bow is deleted from the registry and its class block removed.

**Tech Stack:** Plain ES modules, three.js, cannon-es. No build step. Browser verification via the `__weaponDebug` harness landed in PR-A.

---

## Verification Approach (read first)

Same harness as PR-A. Each task that changes runtime behavior adds one or more `window.__test_*` functions to `src/util/__weaponDebug.js`. The user runs them via `preview_eval` after the implementer commits. Subagents do NOT run a dev server.

The pose-driver fix in Task 0 is structural — it changes how every aim weapon's left arm is posed. After Task 0, every 1H weapon (Pistol) must visibly leave its left arm relaxed; every 2H weapon must visibly support with its left hand. That's a manual visual check after the harness asserts pose-flag plumbing.

---

## File Structure

| File                                    | Change Type | Responsibility                                            |
|-----------------------------------------|-------------|-----------------------------------------------------------|
| `src/entities/Stickman.js`              | Modify      | Pose driver `armPoseL` logic — respect `poseLeft` flag    |
| `src/weapons/weapons.js`                | Modify      | Per-weapon pose flag audit; muzzle origin via `effectiveAimDir`; Minigun state machine; Sniper muzzle reposition; Bow class deletion + registry removal |
| `src/util/__weaponDebug.js`             | Modify      | Harness fns for each behavioral change                    |

No new files. No file outside this list is touched.

---

## Task 0: Fix Pose Driver

**Files:**
- Modify: `src/entities/Stickman.js`
- Modify: `src/util/__weaponDebug.js`

The current pose driver in `_syncRig` (around lines 1804–1809) sets `armPoseL = 'aim'` whenever ANY aim is active, regardless of the weapon's `poseLeft` flag. This makes every aim weapon look 2H — the `poseLeft` flag is functionally dead. Fix: left arm should be 'aim' only when the weapon explicitly opts in via `poseLeft === 'support'` (or `poseLeft === 'aim'` for the future dual-pistol case in PR-D).

- [ ] **Step 1: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_pose_left_respects_flag = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  // Equip a weapon with poseLeft = null (1H) and verify left arm is NOT 'aim'.
  const fake1H = { poseRight: 'aim', poseLeft: null, aimWeapon: true,
    updateMesh: () => {}, attachTo: () => {}, detach: () => {}, mesh: { visible: false } };
  sm.weapon = fake1H;
  sm.input = { ...sm.input, aimActive: true };
  sm.aimDir = { x: sm.facing, y: 0 };
  // Drive one rig sync tick.
  sm._syncRig(1 / 60, false);
  const armPoseL = sm.rig?._lastArmPoseL ?? sm._lastArmPoseL;
  window.__weaponTest.assert(armPoseL !== 'aim', '1H weapon should NOT drive left arm to aim (got ' + armPoseL + ')');

  // Now flip to poseLeft='support' (2H) and verify left arm IS 'aim'.
  fake1H.poseLeft = 'support';
  sm._syncRig(1 / 60, false);
  const armPoseL2 = sm.rig?._lastArmPoseL ?? sm._lastArmPoseL;
  window.__weaponTest.assert(armPoseL2 === 'aim', '2H weapon (poseLeft=support) should drive left arm to aim (got ' + armPoseL2 + ')');

  sm.weapon = null;
};
```

- [ ] **Step 2: Run the test, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('pose_left_respects_flag')`)
```

Expected: fail because either `_lastArmPoseL` doesn't exist as a probe or because the current driver sets left to 'aim' for both cases.

- [ ] **Step 3: Add `_lastArmPoseL` probe + fix the driver**

Open `src/entities/Stickman.js`. Find `_syncRig` (around line 1792). The current `armPoseL` block reads:

```javascript
const armPoseL =
  aimPose ? 'aim' :
  this.weapon?.poseLeft === 'support' ? 'aim' :
  this.grabbing ? 'hold' :
  this.input.grab ? 'grab' : 'walk';
```

Replace with:

```javascript
// Left arm follows poseLeft flag explicitly. 1H weapons (Pistol etc.) leave
// left arm in its idle/walk pose; 2H weapons (Shotgun, Sniper, Minigun, RPG)
// drive it to 'aim' so both hands grip the gun. The future dual-pistol case
// (PR-D) sets poseLeft='aim' to mirror the right arm independently.
const supports2H = this.weapon?.poseLeft === 'support' || this.weapon?.poseLeft === 'aim';
const armPoseL =
  (aimPose && supports2H) ? 'aim' :
  this.grabbing ? 'hold' :
  this.input.grab ? 'grab' : 'walk';
this._lastArmPoseL = armPoseL;
this._lastArmPoseR = armPoseR;
```

The `_lastArmPoseR` line is added so the harness can also probe right-arm pose in later tasks if needed.

- [ ] **Step 4: Re-run the test, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('pose_left_respects_flag')`)
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(rig): respect weapon.poseLeft flag in arm pose driver

armPoseL was set to 'aim' whenever any aim weapon was held, making every
gun look two-handed. Now driven by the explicit poseLeft='support' (2H)
or poseLeft='aim' (dual, PR-D) flag. 1H weapons leave the left arm in
its idle/walk pose."
```

---

## Task 1: Pose Flag Audit per Weapon

**Files:**
- Modify: `src/weapons/weapons.js`

Now that the pose driver respects `poseLeft`, set the correct flag per existing aim weapon. Per the design spec:

| Weapon       | poseRight | poseLeft   | Notes                              |
|--------------|-----------|------------|------------------------------------|
| Pistol       | `'aim'`   | `null`     | 1H — already correct, verify only  |
| Shotgun      | `'aim'`   | `'support'`| 2H                                 |
| Sniper Rifle | `'aim'`   | `'support'`| 2H                                 |
| Minigun      | `'aim'`   | `'support'`| 2H, support hand on barrel housing |
| RPG          | `'aim'`   | `'support'`| 2H shoulder mount                  |
| Bow          | (deleted in Task 5)            |

- [ ] **Step 1: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_weapon_pose_flags = function () {
  const reg = window.game?.weaponRegistry || {};
  const expected = [
    ['Pistol',  'aim', null],
    ['Shotgun', 'aim', 'support'],
    ['SniperRifle', 'aim', 'support'],
    ['Minigun', 'aim', 'support'],
    ['RPG',     'aim', 'support'],
  ];
  for (const [name, right, left] of expected) {
    const W = reg[name];
    if (!W) continue;
    const inst = new W(window.game);
    window.__weaponTest.assert(inst.poseRight === right, name + '.poseRight should be ' + JSON.stringify(right) + ' (got ' + JSON.stringify(inst.poseRight) + ')');
    window.__weaponTest.assert(inst.poseLeft === left, name + '.poseLeft should be ' + JSON.stringify(left) + ' (got ' + JSON.stringify(inst.poseLeft) + ')');
    inst.destroy?.();
  }
};
```

- [ ] **Step 2: Run the test, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('weapon_pose_flags')`)
```

Expected: fail on the first 2H weapon — current code sets `poseRight = 'aim'` but doesn't set `poseLeft` at all (defaults to `null` from base class).

- [ ] **Step 3: Set the flags**

Open `src/weapons/weapons.js`. For each of `Shotgun`, `SniperRifle`, `Minigun`, `RPG` constructors, add `this.poseLeft = 'support';` immediately after the existing `this.poseRight = 'aim';` line. Pistol already has `poseLeft = null` from the base class default — leave alone.

For each weapon, the constructor block to look for is the field initialization block. Examples (only the relevant lines shown — leave the rest unchanged):

```javascript
// Shotgun constructor:
this.poseRight = 'aim';
this.poseLeft = 'support';   // <-- ADD

// SniperRifle constructor:
this.poseRight = 'aim';
this.poseLeft = 'support';   // <-- ADD

// Minigun constructor:
this.poseRight = 'aim';
this.poseLeft = 'support';   // <-- ADD

// RPG constructor:
this.poseRight = 'aim';
this.poseLeft = 'support';   // <-- ADD
```

If the RPG class doesn't have `poseRight = 'aim'` set, add both lines together.

- [ ] **Step 4: Re-run the test, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('weapon_pose_flags')`)
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(weapons): set poseLeft='support' on 2H weapons

Shotgun, SniperRifle, Minigun, RPG now correctly drive left arm to the
weapon. With Task 0's driver fix, this restores the 1H vs 2H visual
distinction that was muted by the prior unconditional 'aim' assignment."
```

---

## Task 2: Wire Aim Weapons to `effectiveAimDir`

**Files:**
- Modify: `src/weapons/weapons.js`
- Modify: `src/util/__weaponDebug.js`

PR-A landed `weapon.effectiveAimDir` — the wall-reorient-aware aim direction the muzzle should fire along. Existing aim weapons (`Pistol`, `Shotgun`, `Minigun`, `SniperRifle`, `RPG`) still use `player.aimDir` directly in their `fire()` methods, so even with the wall reorient active, bullets spawn pointing INTO walls. Wire each weapon's muzzle direction to read `this.effectiveAimDir ?? player.aimDir` (the `??` fallback covers the rare case where `updateMesh` hasn't run since the weapon was equipped).

- [ ] **Step 1: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_pistol_uses_effective_aim = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const Pistol = reg.Pistol;
  window.__weaponTest.assert(Pistol, 'Pistol class missing');
  const w = new Pistol(window.game);
  w.attachTo(sm);
  sm.weapon = w;
  // Force a known effectiveAimDir different from player.aimDir.
  sm.aimDir = { x: 1, y: 0 };
  w.effectiveAimDir = { x: 0, y: 1 }; // straight up — would never match aimDir if wired
  // Snapshot projectile count, fire, snapshot again.
  const before = window.game.projectiles.length;
  w.fire(sm);
  const proj = window.game.projectiles[window.game.projectiles.length - 1];
  window.__weaponTest.assert(window.game.projectiles.length === before + 1, 'pistol fire should spawn a projectile');
  // Velocity should be along effectiveAimDir (up), not player.aimDir (right).
  const vx = proj.body.velocity.x, vy = proj.body.velocity.y;
  window.__weaponTest.assert(Math.abs(vx) < 1, 'pistol projectile vx should be near 0 (got ' + vx + ')');
  window.__weaponTest.assert(vy > 10, 'pistol projectile vy should be positive and large (got ' + vy + ')');
  proj.destroy();
  w.destroy();
  sm.weapon = null;
};
```

- [ ] **Step 2: Run, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('pistol_uses_effective_aim')`)
```

Expected: fail — current `Pistol.fire()` uses `player.aimDir.x` etc. so vy will be ~0 and vx will be large.

- [ ] **Step 3: Update each aim weapon's `fire()` muzzle direction**

For each of `Pistol`, `Shotgun`, `Minigun`, `SniperRifle`, `RPG` `fire()` methods, replace the muzzle-direction reads. Pattern:

```javascript
// BEFORE:
const ax = player.aimDir.x, ay = player.aimDir.y;
// or
const muzzleX = player.position.x + player.aimDir.x * 0.9;

// AFTER:
const aim = this.effectiveAimDir ?? player.aimDir;
const ax = aim.x, ay = aim.y;
// or
const muzzleX = player.position.x + aim.x * 0.9;
```

Concrete edits (file: `src/weapons/weapons.js`):

**Pistol.fire** (around lines 389–403):
- Replace `player.aimDir.x` and `player.aimDir.y` (4 occurrences in this method) with `aim.x` and `aim.y`.
- Add `const aim = this.effectiveAimDir ?? player.aimDir;` as the first line of `fire(player)`.

**Shotgun.fire** (around lines 425–444):
- Replace `const ax = player.aimDir.x, ay = player.aimDir.y;` with `const aim = this.effectiveAimDir ?? player.aimDir; const ax = aim.x, ay = aim.y;`. The existing code already aliases `ax`/`ay`, so subsequent uses don't change.

**Minigun.fire** (around lines 466–477):
- Add `const aim = this.effectiveAimDir ?? player.aimDir;` as the first line.
- Replace `player.aimDir.y, player.aimDir.x` (in the `Math.atan2` call) with `aim.y, aim.x`.
- Replace remaining `player.aimDir.x` / `player.aimDir.y` in the muzzle-position and recoil lines with `aim.x` / `aim.y`.

**SniperRifle._castShot / fire** (around lines 686+):
- In `_castShot`, replace `const ax = player.aimDir.x, ay = player.aimDir.y;` with `const aim = this.effectiveAimDir ?? player.aimDir; const ax = aim.x, ay = aim.y;`.
- In `_muzzleWorld(player)`, the position uses `player.facing` not `aimDir`, so leave the X coord alone — but if any other code path inside the SniperRifle class reads `player.aimDir`, replace it with the effective aim too.

**RPG.fire**: search the RPG class for `player.aimDir` references; same pattern.

For ANY occurrence of `player.aimDir` outside `fire()` and `_castShot` methods (e.g., visual previews or hit-marker rendering), apply the same `aim` substitution UNLESS the code is rendering the player's intended aim (a HUD reticle that should not jump when the gun reorients). Use judgment; default to `effectiveAimDir` for shot direction, leave HUD aiming alone. If unsure, ask.

- [ ] **Step 4: Re-run, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('pistol_uses_effective_aim')`)
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(weapons): aim weapons fire along effectiveAimDir

Pistol, Shotgun, Minigun, SniperRifle, RPG now read this.effectiveAimDir
(set by Weapon.updateMesh's wall reorient) instead of player.aimDir for
shot direction. Bullets no longer spawn pointing into walls when the
player is mashed against geometry. Falls back to player.aimDir if
updateMesh hasn't run yet."
```

---

## Task 3: Minigun Spin-Up + Auto-Fire

**Files:**
- Modify: `src/weapons/weapons.js`
- Modify: `src/util/__weaponDebug.js`

The Minigun currently fires one bullet per click (because `tryFire` is called per attack press). The user wants: hold attack → 0.3s spin-up while barrel rotates → continuous fire at the existing 0.05s `fireDelay` → release attack → 0.5s spin-down. Per the design spec, recoil per shot is preserved. Skip barrel rotation animation when `window.__lowQ` is set (per project memory's perf tier rule).

This requires:
1. A per-tick update method on the Minigun that runs even when the player isn't pressing attack (so spin-down can play out).
2. State variables on the Minigun instance: `_state` ('idle' | 'spinningUp' | 'firing' | 'spinningDown'), `_spinTimer`, `_spinRate`, `_barrelAngle`.
3. A hook for the player's per-tick attack-input poll to drive the state machine.
4. Override `tryFire` to be a no-op for the Minigun (or override the player's attack-handling) — and instead drive firing from the per-tick update when state is 'firing'.

The cleanest path: override `tryFire(player)` to switch into `spinningUp` if currently `idle`, do nothing if already past idle. Add `update(dt, player)` (called each frame from `Stickman` or the weapon's `worldTick`) that progresses the state machine and calls `this.fire(player)` at `fireDelay` intervals while in 'firing' state.

The Stickman already calls `this.weapon.worldTick(dt)` somewhere — verify by reading `Stickman.js`; if not, add a per-tick call from the player's update path. If the existing `worldTick` only runs for in-world weapons (as the current `Weapon.worldTick` body suggests), introduce a parallel `heldTick(dt, player)` that the player calls each tick for held weapons.

- [ ] **Step 1: Find or create the per-tick held-weapon hook**

Read `src/weapons/Weapon.js` `worldTick(dt)` and `src/entities/Stickman.js` to find where weapon updates run each tick. If `worldTick` ONLY runs for in-world (free) weapons (it does — the current `if (this.body && !this.holder)` gate confirms this), add a new no-op base method `Weapon.heldTick(dt, player)` and call it from `Stickman.update(dt)` whenever the player has a weapon.

In `Weapon.js`, near `worldTick`:

```javascript
// Per-tick update for held weapons. Base is a no-op; subclasses (Minigun)
// override to drive their own state (spin-up, auto-fire, etc.).
heldTick(dt, player) { /* override */ }
```

In `Stickman.js`, find the player's per-tick weapon path. Add (immediately after the existing `if (this.weapon) this.weapon.updateMesh(this);` or similar):

```javascript
this.weapon.heldTick(dt, this);
```

If you can't find a clean spot, ASK — don't invent. The exact location matters because `heldTick` should run after physics step but before render.

- [ ] **Step 2: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_minigun_spin_up_then_fire = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const Minigun = reg.Minigun;
  window.__weaponTest.assert(Minigun, 'Minigun class missing');
  const m = new Minigun(window.game);
  m.attachTo(sm); sm.weapon = m;
  sm.aimDir = { x: 1, y: 0 };
  // Press and hold attack: simulate by calling tryFire then heldTick repeatedly.
  m.tryFire(sm);
  // After the first heldTick before 0.3s, no projectile yet.
  for (let i = 0; i < 10; i++) m.heldTick(1 / 60, sm); // ~0.166s elapsed
  const beforeProj = window.game.projectiles.length;
  // Continue past 0.3s.
  for (let i = 0; i < 12; i++) m.heldTick(1 / 60, sm); // total ~0.366s
  const afterSpinUp = window.game.projectiles.length;
  window.__weaponTest.assert(afterSpinUp > beforeProj, 'minigun should fire after spin-up (got ' + (afterSpinUp - beforeProj) + ' new projectiles)');
  // Continue holding for 0.5s — should keep firing at fireDelay rate.
  for (let i = 0; i < 30; i++) m.heldTick(1 / 60, sm);
  const sustained = window.game.projectiles.length;
  window.__weaponTest.assert(sustained - afterSpinUp >= 6, 'minigun should sustain auto-fire (expected >=6 more shots, got ' + (sustained - afterSpinUp) + ')');
  // Release attack — call releaseFire (or heldTick with player.input.attack=false).
  m.releaseFire?.(sm);
  m._state = 'spinningDown'; // belt-and-braces in case releaseFire is structured differently
  for (let i = 0; i < 30; i++) m.heldTick(1 / 60, sm);
  const afterCool = window.game.projectiles.length;
  // Cleanup
  while (window.game.projectiles.length) window.game.projectiles.pop().destroy?.();
  m.destroy(); sm.weapon = null;
};
```

- [ ] **Step 3: Run, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('minigun_spin_up_then_fire')`)
```

Expected: fail (current Minigun has no spin-up; one click = one shot).

- [ ] **Step 4: Implement Minigun state machine**

Open `src/weapons/weapons.js` Minigun class. Add to the constructor:

```javascript
this._state = 'idle';   // 'idle' | 'spinningUp' | 'firing' | 'spinningDown'
this._stateTimer = 0;   // seconds in current state
this._fireAccum = 0;    // accumulator for fireDelay timing while firing
this._barrelAngle = 0;  // rotation of barrel mesh (visual)
this._spinUpDur = 0.3;
this._spinDownDur = 0.5;
this.length = 0.85;     // longer than the base 0.6 — barrel + receiver
```

Override `tryFire(player)`:

```javascript
tryFire(player) {
  // Press handler — start spin-up if currently idle.
  if (this._state === 'idle' || this._state === 'spinningDown') {
    this._state = 'spinningUp';
    this._stateTimer = 0;
  }
  // No immediate fire — heldTick handles it after spin-up.
}
```

Add `releaseFire(player)`:

```javascript
releaseFire(player) {
  if (this._state === 'firing' || this._state === 'spinningUp') {
    this._state = 'spinningDown';
    this._stateTimer = 0;
  }
}
```

Add `heldTick(dt, player)`:

```javascript
heldTick(dt, player) {
  this._stateTimer += dt;
  if (this._state === 'spinningUp') {
    if (this._stateTimer >= this._spinUpDur) {
      this._state = 'firing';
      this._stateTimer = 0;
      this._fireAccum = 0;
    }
  } else if (this._state === 'firing') {
    this._fireAccum += dt;
    while (this._fireAccum >= this.fireDelay && this.ammo > 0) {
      this._fireAccum -= this.fireDelay;
      this.fire(player);
      this.ammo--;
    }
    if (this.ammo <= 0) {
      this._state = 'spinningDown';
      this._stateTimer = 0;
      player.weapon = null;
      this.destroy();
      return;
    }
    // If player released attack since last tick, releaseFire was called and
    // state is now 'spinningDown'. Falls through next tick.
  } else if (this._state === 'spinningDown') {
    if (this._stateTimer >= this._spinDownDur) {
      this._state = 'idle';
      this._stateTimer = 0;
    }
  }
  // Barrel rotation visual (skipped on lowQ per project perf tiers).
  if (!window.__lowQ) {
    let rate = 0;
    if (this._state === 'spinningUp') rate = (this._stateTimer / this._spinUpDur) * 30;
    else if (this._state === 'firing') rate = 30;
    else if (this._state === 'spinningDown') rate = 30 * (1 - this._stateTimer / this._spinDownDur);
    this._barrelAngle += rate * dt;
    // Find the barrel mesh in the group and rotate it. The barrel is the
    // child built in _buildMesh as a CylinderGeometry — assume it's mesh.children[1].
    const barrel = this.mesh?.children?.[1];
    if (barrel) barrel.rotation.x = this._barrelAngle;
  }
}
```

Override the player's attack-release detection: open `Stickman.js` and find where the per-tick attack input is read. When `input.attack` transitions from true→false AND `this.weapon?.releaseFire`, call `this.weapon.releaseFire(this)`. If there's an existing `_lastAttack` flag pattern, use it; otherwise track `_lastInputAttack` on Stickman.

If you can't find a clean place to detect the attack release, STOP and report NEEDS_CONTEXT — this hookup affects every weapon and you should not invent a structure.

Also remove the existing per-shot recoil from `Minigun.fire()` — the recoil should still apply per shot (the existing `player.body.velocity.x -= ...` and `camera.punch(0.04)` lines stay) — actually keep them; the per-shot recoil is correct since `heldTick` calls `fire()` once per `fireDelay` interval.

- [ ] **Step 5: Re-run, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('minigun_spin_up_then_fire')`)
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(minigun): 0.3s spin-up + auto-fire while held + 0.5s spin-down

Replaces one-shot-per-click with a state machine driven by a new
heldTick(dt, player) hook on Weapon (no-op on the base; Minigun overrides).
Barrel mesh rotates at increasing rate during spin-up, full rate while
firing, decays during spin-down. Visual rotation skipped on __lowQ. Per-shot
recoil preserved."
```

---

## Task 4: Sniper Red-Dot Under Barrel

**Files:**
- Modify: `src/weapons/weapons.js`
- Modify: `src/util/__weaponDebug.js`

Currently `SniperRifle._muzzleWorld` returns `{ x: pos.x + facing*0.4, y: pos.y + 0.55 }` — a shoulder-height anchor. Per spec, the red-dot beam should originate from just under the barrel: `y` lowered to `pos.y + 0.45`, `x` extended to `pos.x + facing * 0.55` (barrel tip).

- [ ] **Step 1: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_sniper_muzzle_under_barrel = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const SR = reg.SniperRifle;
  window.__weaponTest.assert(SR, 'SniperRifle class missing');
  const w = new SR(window.game);
  const mz = w._muzzleWorld(sm);
  const expectedX = sm.position.x + sm.facing * 0.55;
  const expectedY = sm.position.y + 0.45;
  window.__weaponTest.assertNear(mz.x, expectedX, 0.001, 'muzzle x should be at barrel tip');
  window.__weaponTest.assertNear(mz.y, expectedY, 0.001, 'muzzle y should be just under barrel');
  w.destroy();
};
```

- [ ] **Step 2: Run, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('sniper_muzzle_under_barrel')`)
```

Expected: fail because current `_muzzleWorld` returns the old shoulder anchor.

- [ ] **Step 3: Update `_muzzleWorld`**

Open `src/weapons/weapons.js`. Find `SniperRifle._muzzleWorld(player)` (around lines 675–684). Replace its body:

```javascript
_muzzleWorld(player) {
  // Anchor the laser/raycast origin to the barrel tip (just under the
  // barrel cylinder in the rendered mesh) so the red dot visibly emits
  // from the gun rather than the shooter's shoulder. Decoupled from
  // aimDir.y so straight-down aim doesn't sink the origin into the
  // floor.
  const facing = player.facing || 1;
  const baseX = player.position.x + facing * 0.55;
  const baseY = player.position.y + 0.45;
  return { x: baseX, y: baseY };
}
```

The downstream `_castShot` and laser-line render reads from this method, so a single-spot change suffices.

- [ ] **Step 4: Re-run, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('sniper_muzzle_under_barrel')`)
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(sniper): anchor red-dot origin under the barrel

Was emitting from shoulder height (y+0.55, x+facing*0.4). Now anchored
at barrel tip (y+0.45, x+facing*0.55) so the visible laser line and the
shot raycast both originate from the gun, not the shooter's torso."
```

---

## Task 5: Delete Bow Class + Registry Entry

**Files:**
- Modify: `src/weapons/weapons.js`
- Modify: `src/util/__weaponDebug.js`

The Bow is being replaced by the Crossbow in PR-D. Delete it now so PR-C/D don't have to coexist with a backwards-rendered weapon.

- [ ] **Step 1: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_bow_removed = function () {
  const reg = window.game?.weaponRegistry || {};
  window.__weaponTest.assert(!reg.Bow, 'Bow should be removed from weapon registry');
  // WEAPON_CLASSES export is the canonical list — also check it.
  // Access via the module if exposed.
  if (window.WEAPON_CLASSES) {
    const found = window.WEAPON_CLASSES.find(c => c?.name === 'Bow');
    window.__weaponTest.assert(!found, 'Bow class should not be in WEAPON_CLASSES');
  }
};
```

- [ ] **Step 2: Run, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('bow_removed')`)
```

Expected: fail (Bow currently in registry).

- [ ] **Step 3: Delete the Bow class + registry entry**

Open `src/weapons/weapons.js`:
1. Find `export class Bow extends Weapon { ... }` (around lines 480–523). Delete the entire class block.
2. Find the `WEAPON_CLASSES` export (around line 2331). Remove `Bow` from the array.
3. If anywhere else in the file imports/references `Bow`, remove those references. Use grep first: `grep -n '\\bBow\\b' src/weapons/weapons.js`. Confirm zero matches after deletion.
4. Check the rest of the codebase for `Bow` references: `grep -rn '\\bBow\\b' src/`. Update any consumer that names it explicitly (likely none, but verify).

- [ ] **Step 4: Re-run, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('bow_removed')`)
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(weapons): delete Bow class

Bow is replaced by Crossbow in PR-D. Removed the class definition and
its WEAPON_CLASSES registry entry. No backwards-compat shim. Crossbow
will take its niche with a flatter arc + faster bolt."
```

---

## Task 6: End-to-End Smoke Run

**Files:** none modified

- [ ] **Step 1: Run all PR-B tests in sequence**

```javascript
preview_eval(`
  ['pose_left_respects_flag', 'weapon_pose_flags', 'pistol_uses_effective_aim',
   'minigun_spin_up_then_fire', 'sniper_muzzle_under_barrel', 'bow_removed']
    .map(n => { try { return window.__weaponTest.run(n); } catch (e) { return 'FAIL: ' + n + ' — ' + e.message; } })
`)
```

Expected: 6 strings, all `"PASS:"`.

Also re-run all PR-A tests to ensure no regression:

```javascript
preview_eval(`
  ['headshot_registers', 'bodyshot_no_double',
   'weapon_wall_reorient', 'weapon_no_wall_no_adjust']
    .map(n => { try { return window.__weaponTest.run(n); } catch (e) { return 'FAIL: ' + n + ' — ' + e.message; } })
`)
```

Expected: all PASS.

- [ ] **Step 2: Manual sanity check**

Open the dev server. For each of Pistol, Shotgun, Sniper, Minigun, RPG:
- Confirm visual: 1H weapons (Pistol) leave left arm relaxed; 2H weapons grip with both hands.
- Walk into a wall while aiming straight at it. Confirm bullets emit along the wall (not into it).
- Minigun: hold attack, hear/see ~0.3s spin-up then continuous fire; release, see barrel spin down.
- Sniper: laser dot visibly emits from barrel tip, not shoulder.

Then confirm Bow no longer spawns from random pickup boxes.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin <new-branch-name>
gh pr create --title "PR-B: existing weapon fixes" --body "..."
```

PR body summarizes pose driver fix, 2H flag audit, effectiveAimDir wiring, Minigun spin-up state machine, Sniper red-dot reposition, Bow removal. Test plan = the list of `__test_*` runs above.

---

## Self-Review Checklist (filled out)

**Spec coverage:**
- §1.1 Pose audit → Tasks 0 + 1 ✓
- §1.2 Minigun auto-fire + spin-up → Task 3 ✓
- §1.3 Sniper red-dot under barrel → Task 4 ✓
- §1.6 Bow removal → Task 5 ✓
- effectiveAimDir wiring (PR-A follow-up) → Task 2 ✓
- §1.4 Headshot raycast → done in PR-A
- §1.5 Wall reorient → done in PR-A
- §2.* New weapons → PR-C and PR-D

**Placeholder scan:** No TBD/TODO. Steps with "ASK if unclear" guidance are explicit escalation points, not placeholders.

**Type consistency:**
- `heldTick(dt, player)` defined as no-op on base `Weapon` in Task 3, called from Stickman in Task 3. Subclasses override.
- `_state`, `_stateTimer`, `_fireAccum`, `_barrelAngle`, `_spinUpDur`, `_spinDownDur` all defined in Minigun constructor in Task 3, consumed in Task 3 `heldTick`. Consistent.
- `effectiveAimDir` defined in PR-A Task 3, consumed across Task 2 here. Consistent.
- `releaseFire(player)` added to Minigun in Task 3, called from Stickman attack-release detection in Task 3. Consistent.

**One known-but-deferred uncertainty:** Task 3 step 1 asks the implementer to find or create the per-tick held-weapon hook in `Stickman.js`. If the existing structure doesn't have a clean spot, escalate (don't invent). This is intentional — the hook placement affects every future weapon and warrants confirmation.
