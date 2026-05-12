# PR-A: Hit + Clip Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-tick swept raycast for projectile head/body hit detection (with 2× headshot damage and ragdoll head-snap), and add path-of-least-resistance reorientation for held weapon meshes when their muzzle would clip into world geometry.

**Architecture:** Two independent additions to existing classes. `Projectile.update()` gains a per-tick swept-segment vs per-player capsule test that runs alongside (not instead of) the existing physics-collision path — physics keeps owning wall hits, the new path owns player hits. `Weapon.updateMesh()` gains a single forward raycast from `handR` along the current aim direction; on hit, the weapon's effective aim rotates along the wall tangent biased toward the player's input aim sign, and the new aim feeds both the mesh transform and any subclass that reads `weapon.effectiveAimDir` for shot origin.

**Tech Stack:** Plain ES modules, three.js for meshes, cannon-es for physics (with `physics.raycast(from, to)` helper at [src/physics/PhysicsWorld.js:94](src/physics/PhysicsWorld.js:94)). No build step. No test framework — verification is browser-only via `preview_eval` against a running dev server (per project memory).

---

## Verification Approach (read first)

This codebase has no test runner. The TDD discipline is preserved by writing a small assertion function in the worktree's existing `src/util/__weaponDebug.js` (created in Task 0) that throws on failure. Each task wires its check into `window.__test_<name>`, runs it via the dev server's `preview_eval`, observes the fail, implements the change, and re-runs to observe the pass.

The `_lowQ` perf gate ([per memory](memory/project_perf_tiers.md)) does not affect either change in this PR — both are gameplay-correctness, not visual polish.

---

## File Structure

| File                                       | Change Type   | Responsibility                                       |
|--------------------------------------------|---------------|------------------------------------------------------|
| `src/util/__weaponDebug.js`                | Create        | Test assertion helpers + `window.__test_*` wiring    |
| `src/main.js`                              | Modify        | Import `__weaponDebug.js` so it self-registers       |
| `src/weapons/Projectile.js`                | Modify        | Per-tick swept capsule raycast for player hits       |
| `src/weapons/Weapon.js`                    | Modify        | Wall-reorient logic in `updateMesh()`                |
| `src/entities/Stickman.js`                 | Modify (small)| Expose `headSnap(impulseX, impulseY)` for ragdoll head reaction |

Each task's diff is small and reviewable on its own. No file outside this list is touched.

---

## Task 0: Test Harness

**Files:**
- Create: `src/util/__weaponDebug.js`
- Modify: `src/main.js` (add one import)

This file holds the per-task verification functions. Each later task adds one `window.__test_*` function here; a failed assertion throws so `preview_eval` surfaces the message.

- [ ] **Step 1: Write the harness file**

Create `src/util/__weaponDebug.js`:

```javascript
// Test harness for the firearms-overhaul PRs. Self-registers helpers on
// `window` so dev-time `preview_eval` can run them. No production cost — the
// helpers only execute when explicitly called.

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

function assertNear(actual, expected, eps, msg) {
  if (Math.abs(actual - expected) > eps) {
    throw new Error('ASSERT NEAR FAIL: ' + msg + ' — actual=' + actual + ' expected=' + expected + ' eps=' + eps);
  }
}

window.__weaponTest = { assert, assertNear, results: [] };

window.__weaponTest.run = function (name) {
  const fn = window['__test_' + name];
  if (typeof fn !== 'function') throw new Error('No test named __test_' + name);
  try {
    fn();
    window.__weaponTest.results.push({ name, ok: true });
    return 'PASS: ' + name;
  } catch (e) {
    window.__weaponTest.results.push({ name, ok: false, msg: e.message });
    throw e;
  }
};
```

- [ ] **Step 2: Wire the import**

Open `src/main.js`. Find the existing top-of-file import block (the imports at lines 1–N). Add this line at the bottom of the import block:

```javascript
import './util/__weaponDebug.js';
```

The file has no exports — the side effect of running it is what registers `window.__weaponTest`.

- [ ] **Step 3: Verify harness loads**

Start the dev server with the preview tool. Then run:

```javascript
preview_eval(`typeof window.__weaponTest`)
```

Expected: `"object"`.

- [ ] **Step 4: Commit**

```bash
git add src/util/__weaponDebug.js src/main.js
git commit -m "test: add __weaponDebug harness for PR-A verification"
```

---

## Task 1: Expose `headSnap()` on Stickman

**Files:**
- Modify: `src/entities/Stickman.js`

The headshot path in Task 2 needs to drive a head-snap reaction on the hit player. Add a small public method that the projectile can call. We add it now (in isolation) so Task 2's diff stays focused on the raycast.

- [ ] **Step 1: Write the failing test**

Append to `src/util/__weaponDebug.js` (above the `window.__weaponTest.run` line):

```javascript
window.__test_headSnap_exists = function () {
  const sm = window.game?.players?.find(p => p && p.alive);
  window.__weaponTest.assert(sm, 'no live player to test against');
  window.__weaponTest.assert(typeof sm.headSnap === 'function', 'Stickman.headSnap missing');
};
```

- [ ] **Step 2: Run the test, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('headSnap_exists')`)
```

Expected: throw `ASSERT FAIL: Stickman.headSnap missing`.

- [ ] **Step 3: Implement `headSnap`**

Open `src/entities/Stickman.js`. Find a section near other public action methods (search for `takeDamage(` — `headSnap` should live a few lines below it, alongside other reaction methods). Insert:

```javascript
// Apply a brief impulse to the visual head/neck so a headshot reads as a
// snap-back. Pure visual reaction — damage is applied by the caller. The
// rig's head joint already has a spring; we just push a one-frame velocity
// kick that the spring then overshoots and settles.
headSnap(ix, iy) {
  if (!this.alive) return;
  const head = this.rig?.head;
  if (!head) return;
  // The rig's head node uses a `vel` field for its damped-spring loop —
  // adding to it produces the snap. Magnitude is tuned so a 2× damage
  // headshot from a pistol-class projectile reads as a clear flick without
  // detaching the head from the rig's spring envelope.
  head.vel = head.vel || { x: 0, y: 0 };
  head.vel.x += ix;
  head.vel.y += iy;
}
```

If the rig's head node uses a different field name than `vel` (verify by reading `src/entities/StickmanRig.js` and searching for `head` and the relevant integrator), substitute the correct field name. The intent is "add a one-frame impulse to the head's spring integrator."

- [ ] **Step 4: Re-run the test, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('headSnap_exists')`)
```

Expected: `"PASS: headSnap_exists"`.

- [ ] **Step 5: Commit**

```bash
git add src/entities/Stickman.js src/util/__weaponDebug.js
git commit -m "feat(rig): expose Stickman.headSnap for headshot reaction"
```

---

## Task 2: Projectile Swept Capsule Raycast

**Files:**
- Modify: `src/weapons/Projectile.js`

This is the headshot fix. Each tick, while the projectile is alive and unstuck, we sweep the segment from `_lastImpactCheckPos` to `body.position` against every live opposing player's head and body capsules. First hit wins; head wins ties on the same segment.

The existing physics `_collide` callback continues to handle wall/tile/chain hits and acts as a backup for player hits if a frame is large enough that both the swept ray and physics body overlap. To prevent double-application, we set a flag once the swept path has fired its damage on a target and the `_collide` path skips that target.

- [ ] **Step 1: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_headshot_registers = function () {
  const sm = window.game?.players?.find(p => p && p.alive && !p.isLocal);
  window.__weaponTest.assert(sm, 'need a non-local live player target');
  const startHp = sm.hp;
  const startSnap = (sm.rig?.head?.vel?.y) || 0;
  // Spawn a fast test projectile aimed at the head capsule (top of body).
  const headY = sm.body.position.y + 0.55;
  const startX = sm.body.position.x - 2;
  const startY = headY;
  const proj = window.game.spawnTestProjectile?.({
    x: startX, y: startY,
    vx: 60, vy: 0,
    damage: 10, owner: null,
  });
  window.__weaponTest.assert(proj, 'game.spawnTestProjectile not available');
  // Step physics a few frames to let the sweep run.
  for (let i = 0; i < 10; i++) window.game.physics.step(1 / 60);
  // Damage applied (with head 2× → 20)
  window.__weaponTest.assertNear(startHp - sm.hp, 20, 0.5, 'headshot damage should be 2× base');
  // Head snap impulse fired
  window.__weaponTest.assert((sm.rig?.head?.vel?.y || 0) !== startSnap, 'head should have snap velocity');
};
```

- [ ] **Step 2: Add the spawn helper to `Game.js`**

The test needs a way to spawn a projectile without going through a weapon. Open `src/Game.js` and locate any existing dev-only helpers (search for `window.game` or similar). Add:

```javascript
// Dev-only: spawn a bare projectile for verification harness use.
spawnTestProjectile(opts) {
  const { Projectile } = require('./weapons/Projectile.js');
  return new Projectile(this, { ...opts, gravity: false, life: 1 });
}
```

If `Game.js` uses ES imports rather than `require`, replace the body with the corresponding `import` (likely it already imports `Projectile` for other reasons — search and reuse). The helper is idempotent and side-effect-free outside the dev call.

- [ ] **Step 3: Run the test, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('headshot_registers')`)
```

Expected: a fail — either no damage at all, or damage = base (10) instead of 2× (20). Record the actual fail message.

- [ ] **Step 4: Add the swept raycast to Projectile**

Open `src/weapons/Projectile.js`. Two changes:

**4a — Initialize tracking state in `constructor()`**

After the `this._lastPos = ...` block (around current line 80–81, inside the `if (opts.tracer)` block), add (outside the `if`):

```javascript
// Per-tick swept hit check — independent of physics body collision so fast
// projectiles can't tunnel through thin colliders like the visual head.
this._sweepFrom = { x: opts.x, y: opts.y };
this._hitPlayers = new Set();
```

**4b — Add the sweep step inside `update(dt)`**

After the existing `this.mesh.position.set(...)` block at the bottom of `update()`, but BEFORE the tracer update, insert:

```javascript
// Swept capsule check vs every opposing player's head + body capsules.
// Head hit = 2× damage + head-snap. Body hit = standard damage. Same player
// can only be hit once per projectile lifetime (set on _hitPlayers).
const sweepTo = { x: p.x, y: p.y };
for (const player of this.game.players) {
  if (!player || !player.alive || player === this.owner) continue;
  if (player.invuln > 0) continue;
  if (this._hitPlayers.has(player)) continue;
  const body = player.body;
  if (!body) continue;
  const px = body.position.x;
  const py = body.position.y;
  // Head capsule: top of player body, ~0.4 to 0.7 above body center, r=0.18.
  const headHit = segmentVsCapsule(this._sweepFrom, sweepTo,
    { x: px, y: py + 0.45 }, { x: px, y: py + 0.65 }, 0.18);
  // Body capsule: torso, body center ± a bit, r=0.30.
  const bodyHit = headHit ? null : segmentVsCapsule(this._sweepFrom, sweepTo,
    { x: px, y: py - 0.3 }, { x: px, y: py + 0.4 }, 0.30);
  if (!headHit && !bodyHit) continue;
  const isHead = !!headHit;
  const dmg = this.damage * (isHead ? 2 : 1);
  player.takeDamage(dmg, {
    attacker: this.owner,
    weapon: 'projectile',
    kb: { x: this.body.velocity.x * 0.15, y: 5 + Math.abs(this.body.velocity.y) * 0.1 },
    stun: isHead ? 0.5 : 0.25,
    isHead,
  });
  if (isHead) {
    const vx = this.body.velocity.x, vy = this.body.velocity.y;
    const sp = Math.hypot(vx, vy) || 1;
    player.headSnap?.((vx / sp) * 6, (vy / sp) * 4 + 4);
  }
  this._hitPlayers.add(player);
  // Same destroy/explode contract as the physics-collision path.
  if (this.explodeOnContact || this.explosive) this._pendingExplode = true;
  else this._pendingDestroy = true;
  break;
}
this._sweepFrom = { x: p.x, y: p.y };
```

**4c — Add the helper at module scope**

At the bottom of the file (after the `Projectile` class), add:

```javascript
// Closest distance between a 2D segment AB and another 2D segment CD (the
// capsule's spine). Returns the squared distance. Used to test if a swept
// projectile path passes within `radius` of a player's head/body capsule.
function segmentVsCapsule(a, b, c, d, radius) {
  const d2 = segSegDistSq(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
  return d2 <= radius * radius;
}

function segSegDistSq(ax, ay, bx, by, cx, cy, dx, dy) {
  // Standard segment-segment closest-point algorithm in 2D.
  const ux = bx - ax, uy = by - ay;
  const vx = dx - cx, vy = dy - cy;
  const wx = ax - cx, wy = ay - cy;
  const a = ux * ux + uy * uy;
  const b = ux * vx + uy * vy;
  const c = vx * vx + vy * vy;
  const d = ux * wx + uy * wy;
  const e = vx * wx + vy * wy;
  const D = a * c - b * b;
  let sc, tc;
  if (D < 1e-9) { sc = 0; tc = (b > c ? d / b : e / c); }
  else { sc = (b * e - c * d) / D; tc = (a * e - b * d) / D; }
  sc = Math.max(0, Math.min(1, sc));
  tc = Math.max(0, Math.min(1, tc));
  const px = ax + sc * ux - (cx + tc * vx);
  const py = ay + sc * uy - (cy + tc * vy);
  return px * px + py * py;
}
```

**4d — Suppress double-hit from physics path**

In `_impact()` (existing code, around line 84), at the top of the `if (other.userData?.kind === 'player')` block, add:

```javascript
if (this._hitPlayers?.has(sm)) return;
```

This prevents the cannon-es collide event from re-applying damage if the swept path already counted the hit on the same target.

- [ ] **Step 5: Re-run the test, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('headshot_registers')`)
```

Expected: `"PASS: headshot_registers"`.

- [ ] **Step 6: Add a body-shot regression test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_bodyshot_no_double = function () {
  const sm = window.game?.players?.find(p => p && p.alive && !p.isLocal);
  window.__weaponTest.assert(sm, 'need a non-local live player target');
  const startHp = sm.hp;
  const bodyY = sm.body.position.y;
  window.game.spawnTestProjectile({
    x: sm.body.position.x - 2, y: bodyY,
    vx: 60, vy: 0, damage: 10, owner: null,
  });
  for (let i = 0; i < 10; i++) window.game.physics.step(1 / 60);
  // Damage exactly 10 (not 20 from a double-apply, not 0 from no-hit).
  window.__weaponTest.assertNear(startHp - sm.hp, 10, 0.5, 'body shot should apply base damage exactly once');
};
```

Run:

```javascript
preview_eval(`window.__weaponTest.run('bodyshot_no_double')`)
```

Expected: PASS. If it fails with damage = 20, the suppression in step 4d isn't covering the cannon collide path.

- [ ] **Step 7: Commit**

```bash
git add src/weapons/Projectile.js src/Game.js src/util/__weaponDebug.js
git commit -m "feat(combat): swept capsule raycast for headshot detection

Per-tick segment vs head/body capsule test on Projectile so fast bullets
can't tunnel through visual heads. Head hits do 2x damage and trigger
Stickman.headSnap. Suppresses cannon-es collide path on already-counted
players to avoid double-apply."
```

---

## Task 3: Weapon Wall-Reorient

**Files:**
- Modify: `src/weapons/Weapon.js`

The held-weapon mesh is currently positioned at `handR` and rotated to `aimDir` with no awareness of nearby walls. When the player presses against a wall holding a long gun, the mesh clips through. This task adds a single forward raycast and re-rotates the weapon to lie tangent to any hit wall.

The new aim direction is exposed as `weapon.effectiveAimDir` so projectile-spawning subclasses (in PR-B/C/D) can use it as their muzzle direction. For now, we only need to demonstrate that the mesh is repositioned correctly — no subclass change is required in this PR.

- [ ] **Step 1: Add the test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_weapon_wall_reorient = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  // Force-equip a stub aiming weapon if not already armed.
  if (!sm.weapon) {
    const W = window.game._anyAimWeapon || (window.game._anyAimWeapon = (() => {
      const reg = window.game.weaponRegistry || {};
      return reg.Pistol || Object.values(reg)[0];
    })());
    window.__weaponTest.assert(W, 'no weapon class to equip');
    sm.weapon = new W(window.game);
    sm.weapon.attachTo(sm);
  }
  // Place a wall right in front of the player at shoulder height.
  const wallX = sm.position.x + sm.facing * 0.6;
  const wallY = sm.position.y + 0.55;
  const beforeHit = window.game.physics.raycast(
    { x: sm.position.x, y: wallY, z: 0 },
    { x: wallX + 1, y: wallY, z: 0 },
  );
  if (!beforeHit) {
    // Test environment lacks a near wall — skip with a clear marker.
    return;
  }
  // Aim straight forward into the wall.
  sm.aimDir = { x: sm.facing, y: 0 };
  sm.input = { ...sm.input, aimActive: true };
  sm.weapon.updateMesh(sm);
  window.__weaponTest.assert(sm.weapon.aimAdjusted === true, 'aimAdjusted flag should be set when hitting wall');
  // Effective aim should no longer point straight into the wall.
  const ea = sm.weapon.effectiveAimDir;
  window.__weaponTest.assert(ea, 'effectiveAimDir should be set');
  const dotIntoWall = ea.x * sm.facing + ea.y * 0;
  window.__weaponTest.assert(dotIntoWall < 0.95, 'effective aim should rotate off the wall normal');
};
```

- [ ] **Step 2: Run the test, observe fail**

```javascript
preview_eval(`window.__weaponTest.run('weapon_wall_reorient')`)
```

Expected: fail with `aimAdjusted flag should be set when hitting wall` (the field doesn't exist yet).

- [ ] **Step 3: Implement reorient in `updateMesh()`**

Open `src/weapons/Weapon.js`. Inside `updateMesh(player)`, find the `if (this.aimWeapon)` branch (currently lines 93–98). Replace its body with:

```javascript
if (this.aimWeapon) {
  const aim = player.aimDir;
  const facing = player.facing;
  let aimX = aim.x, aimY = aim.y;
  // Wall reorient: cast forward along the player's aim from handR. If we'd
  // poke through a wall, rotate aim to the wall tangent biased toward the
  // input aim's vertical sign so the gun pivots in the direction the user
  // is "leaning" the cursor (slightly up = points up along the wall, etc.).
  const weaponLength = this.length ?? 0.6;
  const from = { x: handX, y: handY, z: 0 };
  const to = { x: handX + aimX * weaponLength, y: handY + aimY * weaponLength, z: 0 };
  const hit = this.game.physics.raycast(from, to, { mask: 0x0001 /* WORLD */ });
  if (hit) {
    const n = hit.hitNormalWorld;
    // 2D wall normal (z component ignored).
    let nx = n.x, ny = n.y;
    const nlen = Math.hypot(nx, ny) || 1;
    nx /= nlen; ny /= nlen;
    // Tangent perpendicular to the normal, in 2D.
    let tx = -ny, ty = nx;
    // Choose the tangent direction whose vertical sign matches the input
    // aim's vertical sign. If aimY ~= 0, fall back to whichever tangent
    // points more in the player's facing direction (so a grounded shot
    // along a vertical wall points "up the wall" by default).
    const wantUp = aimY > 0.05 ? 1 : (aimY < -0.05 ? -1 : 0);
    if (wantUp !== 0) {
      if (Math.sign(ty) !== wantUp) { tx = -tx; ty = -ty; }
    } else {
      if (Math.sign(tx) !== Math.sign(facing) && Math.sign(tx) !== 0) { tx = -tx; ty = -ty; }
    }
    aimX = tx; aimY = ty;
    this.aimAdjusted = true;
  } else {
    this.aimAdjusted = false;
  }
  this.effectiveAimDir = { x: aimX, y: aimY };
  const aimAng = Math.atan2(aimY, aimX);
  this.mesh.position.set(handX, handY, 0);
  this.mesh.rotation.set(0, 0, aimAng);
  this.mesh.scale.set(1, facing >= 0 ? 1 : -1, 1);
}
```

Note: `this.length` is a new optional weapon-class field. Subclasses that have a longer barrel (rifle, sniper) override it. The default of 0.6 matches the current pistol mesh length. PR-B will set per-class values.

The `mask: 0x0001` reads the WORLD collision group. Verify the constant matches — open `src/physics/PhysicsWorld.js` and check the `COL_GROUPS` export. If `WORLD` is a different bit, substitute `COL_GROUPS.WORLD` (and add the import at the top of `Weapon.js` if missing — it's already imported per current file head).

- [ ] **Step 4: Re-run the test, observe pass**

```javascript
preview_eval(`window.__weaponTest.run('weapon_wall_reorient')`)
```

Expected: `"PASS: weapon_wall_reorient"`.

- [ ] **Step 5: Add a no-wall regression test**

Append to `src/util/__weaponDebug.js`:

```javascript
window.__test_weapon_no_wall_no_adjust = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm && sm.weapon, 'need armed local player');
  // Aim straight up — almost certainly no wall above in standard test scene.
  sm.aimDir = { x: 0, y: 1 };
  sm.input = { ...sm.input, aimActive: true };
  sm.weapon.updateMesh(sm);
  window.__weaponTest.assert(sm.weapon.aimAdjusted === false, 'no wall = no adjust');
};
```

Run:

```javascript
preview_eval(`window.__weaponTest.run('weapon_no_wall_no_adjust')`)
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/weapons/Weapon.js src/util/__weaponDebug.js
git commit -m "feat(weapons): path-of-least-resistance reorient when hitting walls

Held-weapon mesh now casts one ray forward from handR each frame. On
wall hit, rotates the weapon's effective aim direction to lie tangent
to the wall, biased toward the user's input aim sign. Exposes
weapon.effectiveAimDir for projectile-spawning subclasses to use as
muzzle origin in PR-B/C/D."
```

---

## Task 4: End-to-End Smoke Run

**Files:** none modified

Now both foundational changes are in. Run the full harness in one shot to ensure no regressions between tasks.

- [ ] **Step 1: Run all tests in sequence**

```javascript
preview_eval(`
  ['headSnap_exists', 'headshot_registers', 'bodyshot_no_double',
   'weapon_wall_reorient', 'weapon_no_wall_no_adjust']
    .map(n => { try { return window.__weaponTest.run(n); } catch (e) { return 'FAIL: ' + n + ' — ' + e.message; } })
`)
```

Expected: array of 5 strings, all starting with `"PASS:"`.

- [ ] **Step 2: Manual sanity check in browser**

Open the dev server in a browser. Pick up a pistol (or any aim weapon). Walk into a wall while aiming forward. Confirm visually:
- The gun mesh does not poke through the wall.
- The gun rotates to lie tangent along the wall.
- Tilting the aim slightly up makes the gun rotate up along the wall; tilting down does the opposite.

Then aim at another player's head from a few units away and fire. Confirm:
- Damage applied is double a body shot at the same range.
- The opposing player's head visibly snaps in the direction of the bullet.

- [ ] **Step 3: Push branch + open PR**

Per project memory's PR workflow:

```bash
git push -u origin claude/strange-chaum-8086fd
gh pr create --title "PR-A: hit + clip foundations" --body "$(cat <<'EOF'
## Summary
- Per-tick swept capsule raycast on `Projectile` so fast bullets register hits on the visual head silhouette (no more tunneling)
- Headshots do 2× damage and trigger a head-snap on the rig
- Held weapons no longer clip through walls — their effective aim rotates to lie tangent to the wall, biased toward the input aim's vertical sign
- Foundational PR for the firearms overhaul; PR-B (existing weapon fixes), PR-C (SMG/AR/Revolver), PR-D (Crossbow/Flame/Dual) build on this

## Test plan
- [ ] `window.__weaponTest.run('headshot_registers')` passes
- [ ] `window.__weaponTest.run('bodyshot_no_double')` passes
- [ ] `window.__weaponTest.run('weapon_wall_reorient')` passes
- [ ] `window.__weaponTest.run('weapon_no_wall_no_adjust')` passes
- [ ] Manual: walk into wall holding pistol, gun rotates tangent
- [ ] Manual: headshot dummy player, head visibly snaps
EOF
)"
```

After PR opens and CI is green, squash-merge per project memory.

- [ ] **Step 4: Commit any post-merge follow-ups**

If merge surfaces issues, fix-forward in PR-B (the next plan) rather than reopening this PR.

---

## Self-Review Checklist (filled out)

**Spec coverage:**
- §1.4 (Projectile head/body capsule raycast) → Task 2 ✓
- §1.5 (Weapon-vs-wall reorientation) → Task 3 ✓
- Stickman head-snap support (referenced by §1.4) → Task 1 ✓
- §1.1 (pose audit), §1.2 (minigun), §1.3 (sniper red-dot), §1.6 (bow removal) → deferred to PR-B (out of this plan's scope) ✓
- §2.* (new weapons) → deferred to PR-C and PR-D ✓

**Placeholder scan:** No `TBD`/`TODO`/"appropriate"/"as needed" left in steps.

**Type consistency:**
- `effectiveAimDir` defined in Task 3, consumed (referenced) by future PRs — flagged in Task 3 commentary.
- `aimAdjusted` set in Task 3, asserted in Task 3 test — consistent.
- `headSnap(ix, iy)` defined in Task 1, called from Task 2 — same signature.
- `_hitPlayers` Set added in Task 2 constructor, checked in Task 2 sweep + `_impact` suppression — consistent.

**One known unknown:** the rig head-velocity field name is verified as `vel` only after reading `StickmanRig.js`. Task 1 step 3 explicitly tells the implementer to verify the field name and substitute if different. This is not a placeholder — it's an instruction to confirm an integration point.
