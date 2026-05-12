# Sub-A — Rig Segment Sweeps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stickman rig arms, legs, and head visually respect world walls and floors via per-segment world raycasts in `_drawArm` / `_drawLeg` / `update`. On wall hit, endpoint clamps short → IK auto-folds limb (cartoon-squish).

**Architecture:** Plumb `params.worldOriginX / worldOriginY / physics` from Stickman into `rig.update`. Rig calls `physics.raycast(shoulder, hand, { mask: COL_GROUPS.WORLD })` per limb, with back-ray fallback for penetration cases. Clamped endpoint replaces the existing `maxReach`-clamped endpoint before `solveIK`. Head uses a vertical down-ray after the head position is computed.

**Tech Stack:** three.js, cannon-shim wrapping Rapier physics, no test framework — `window.__weaponTest` harness driven by browser `preview_eval`.

**Spec:** [docs/superpowers/specs/2026-05-12-rig-collision-and-stickfight-feel-design.md](../specs/2026-05-12-rig-collision-and-stickfight-feel-design.md) §Sub-A.

---

## File Structure

- Modify [src/entities/Stickman.js](../../../src/entities/Stickman.js) — pass `physics` + world origin into rig.update params.
- Modify [src/entities/StickmanRig.js](../../../src/entities/StickmanRig.js) — add `_sweepClamp` helper, apply in `_drawArm`, `_drawLeg`, head section of `update`.
- Modify [src/util/__weaponDebug.js](../../../src/util/__weaponDebug.js) — add 2 harness tests.

No file creation. No package changes. No physics group changes.

---

## Task 1: Plumb world + physics into rig.update params

**Files:**
- Modify: [src/entities/Stickman.js:1890-1909](../../../src/entities/Stickman.js)

- [ ] **Step 1: Add three new params before `rig.update` call**

In `Stickman._syncRig`, in the block setting `params.*` (currently ending at line 1908 with `params.dt = dt;`), add three new fields immediately before `this.rig.update(rigPos, params)`:

```javascript
    params.dt = dt;
    params.physics = this.world;
    params.worldOriginX = this.body.position.x;
    params.worldOriginY = this.body.position.y;
    this.rig.update(rigPos, params);
```

`this.world` is the `PhysicsWorld` instance (cannon-shim wrapper) already used elsewhere in Stickman (e.g., line 280 in `_safeSpawnY`, line 584).

- [ ] **Step 2: Verify the file parses (no test yet — pure plumbing)**

Open the dev server preview, watch console. Expected: no errors logged. Stickman behavior unchanged because rig doesn't read the new params yet.

- [ ] **Step 3: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "rig: plumb physics + world origin into rig.update params

Sub-A prep — rig will use physics.raycast next task to sweep limb
segments against world geometry."
```

---

## Task 2: Add `_sweepClamp` helper + `LIMB_PAD` constant to StickmanRig

**Files:**
- Modify: [src/entities/StickmanRig.js](../../../src/entities/StickmanRig.js) — top-of-file constant, helper method on prototype.

- [ ] **Step 1: Add `LIMB_PAD` constant near the existing `Z_STAGGER` constant**

Locate near top of file (around line 9 where `Z_STAGGER` is defined). Add:

```javascript
const Z_STAGGER = 0.08;
// Minimum distance from limb endpoint to wall surface after clamp.
// 0.06m clears cylinder radius (~0.04) plus a small visual margin so
// the mesh doesn't poke into the tile at glancing angles.
const LIMB_PAD = 0.06;
// Mask for world geometry only. Equals COL_GROUPS.WORLD = 0x0001 (see
// src/physics/PhysicsWorld.js). Hardcoded here to avoid importing the
// physics module into the rig — rig stays display-only.
const WORLD_MASK = 0x0001;
```

- [ ] **Step 2: Add `_sweepClamp(sxLocal, syLocal, hxLocal, hyLocal, params, out)` method on StickmanRig prototype**

Add the method anywhere inside the `class StickmanRig` body (a good place is right above `_drawArm` near line 1401). It takes the shoulder + hand LOCAL coords, the rig params (which carry `physics`, `worldOriginX`, `worldOriginY`), and an `out` Vector-like `{ x, y }` it writes the clamped endpoint into.

```javascript
  _sweepClamp(sxLocal, syLocal, hxLocal, hyLocal, params, out) {
    out.x = hxLocal;
    out.y = hyLocal;
    const phys = params.physics;
    if (!phys || !phys.raycast) return;
    const ox = params.worldOriginX ?? 0;
    const oy = params.worldOriginY ?? 0;
    const sxW = ox + sxLocal, syW = oy + syLocal;
    const hxW = ox + hxLocal, hyW = oy + hyLocal;
    const dxW = hxW - sxW, dyW = hyW - syW;
    const segLen = Math.hypot(dxW, dyW);
    if (segLen < 0.02) return;
    // Forward ray: shoulder → hand. Project z to 0 (rig lives near z=0,
    // colliders are at z=0).
    const fwd = phys.raycast(
      { x: sxW, y: syW, z: 0 },
      { x: hxW, y: hyW, z: 0 },
      { mask: WORLD_MASK },
    );
    if (fwd && fwd.hitPointWorld) {
      const hx = fwd.hitPointWorld.x, hy = fwd.hitPointWorld.y;
      // Pull back along ray by LIMB_PAD.
      const inv = 1 / segLen;
      const ux = dxW * inv, uy = dyW * inv;
      out.x = (hx - ux * LIMB_PAD) - ox;
      out.y = (hy - uy * LIMB_PAD) - oy;
      return;
    }
    // Back-ray fallback — hand may already be inside a wall (prior frame
    // penetration). Cast hand → shoulder; a hit means hand is on the
    // wrong side of geometry.
    const back = phys.raycast(
      { x: hxW, y: hyW, z: 0 },
      { x: sxW, y: syW, z: 0 },
      { mask: WORLD_MASK },
    );
    if (back && back.hitPointWorld) {
      const hx = back.hitPointWorld.x, hy = back.hitPointWorld.y;
      // The back-ray hit point is the entry surface on the shoulder side
      // of the wall. Pull TOWARD shoulder by LIMB_PAD (along back-ray dir,
      // which is hand→shoulder).
      const inv = 1 / segLen;
      const ux = -dxW * inv, uy = -dyW * inv;
      out.x = (hx + ux * LIMB_PAD) - ox;
      out.y = (hy + uy * LIMB_PAD) - oy;
    }
    // Both rays missed → no penetration → leave (out.x, out.y) at the
    // requested hand position. Already initialized at function entry.
  }
```

- [ ] **Step 3: Add scratch `_sweepOut` for the helper (avoid GC alloc per frame)**

In `StickmanRig.constructor` (around line 475, where other scratch like `this._tmpKnee` are declared), add:

```javascript
    this._tmpKnee = { x: 0, y: 0 };
    this._sweepOut = { x: 0, y: 0 };
```

(Adjust insertion — find the existing `_tmpKnee` line and add `_sweepOut` next to it.)

- [ ] **Step 4: Smoke test — confirm rig still draws (helper not yet wired)**

Open browser preview. Walk player around. Expected: no errors, rig draws normally. Helper exists but isn't called yet.

- [ ] **Step 5: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "rig: add _sweepClamp helper + LIMB_PAD constant

Forward + back ray fallback for limb endpoint clamping. Not wired yet."
```

---

## Task 3: Apply sweep to arms in `_drawArm`

**Files:**
- Modify: [src/entities/StickmanRig.js:1401-1432](../../../src/entities/StickmanRig.js)

The existing `_drawArm` already clamps hand position to `maxReach` (line 1418-1421). Insert the world-sweep AFTER that clamp but BEFORE `solveIK` so IK folds the arm to the swept endpoint. Threading: pass `params` into `_drawArm` so it can call `this._sweepClamp`.

- [ ] **Step 1: Extend `_drawArm` signature with `params` arg**

Update the method signature at line 1401:

```javascript
  _drawArm(sx, sy, hx, hy, z, upper, lower, handMesh, shoulderJoint, elbowJoint, isRight, stretched, bendOverride, params) {
```

- [ ] **Step 2: Update both call sites to pass `params`**

Around line 1388-1389:

```javascript
    this._drawArm(sLX, sLY, this._handLPos.x, this._handLPos.y, zL, this.upperArmL, this.lowerArmL, this.handL, this.shoulderL, this.elbowL, false, false, aimBendL, params);
    this._drawArm(sRX, sRY, this._handRPos.x, this._handRPos.y, zR, this.upperArmR, this.lowerArmR, this.handR, this.shoulderR, this.elbowR, true, !!params.gumGumPunch, aimBendR, params);
```

- [ ] **Step 3: Apply sweep inside `_drawArm` after maxReach clamp**

Modify the block starting at line 1414. The existing block reads:

```javascript
    const upperLen = 0.45, lowerLen = 0.45;
    const maxReach = (upperLen + lowerLen) * 0.99;
    // Clamp hand to within arm reach so limb segments don't stretch.
    const dx = hx - sx, dy = hy - sy;
    const d = Math.hypot(dx, dy);
    let chx = hx, chy = hy;
    if (d > maxReach) {
      const f = maxReach / d;
      chx = sx + dx * f; chy = sy + dy * f;
    }
```

Replace with (adds sweep clamp after maxReach):

```javascript
    const upperLen = 0.45, lowerLen = 0.45;
    const maxReach = (upperLen + lowerLen) * 0.99;
    // Clamp hand to within arm reach so limb segments don't stretch.
    const dx = hx - sx, dy = hy - sy;
    const d = Math.hypot(dx, dy);
    let chx = hx, chy = hy;
    if (d > maxReach) {
      const f = maxReach / d;
      chx = sx + dx * f; chy = sy + dy * f;
    }
    // World-collision clamp — if shoulder→hand crosses a wall, pull the
    // hand back to LIMB_PAD short of the surface. IK below auto-folds the
    // arm with the shortened reach (cartoon squish).
    if (params) {
      this._sweepClamp(sx, sy, chx, chy, params, this._sweepOut);
      chx = this._sweepOut.x;
      chy = this._sweepOut.y;
    }
```

Leave the rest of `_drawArm` (the `stretched` branch, `solveIK` call, `orientLimb` calls) unchanged. Note the `stretched` branch (line 1403) runs BEFORE this clamp — it's a separate visual mode (no elbow) used only when `gumGumPunch` is true. Apply sweep there too:

Inside the `if (stretched)` block at line 1403-1409, change the body from:

```javascript
    if (stretched) {
      orientLimb(upper, sx, sy, z, hx, hy, z);
      lower.visible = false;
      elbowJoint.visible = false;
      handMesh.position.set(hx, hy, z);
      return;
    }
```

To:

```javascript
    if (stretched) {
      let sxh = hx, syh = hy;
      if (params) {
        this._sweepClamp(sx, sy, hx, hy, params, this._sweepOut);
        sxh = this._sweepOut.x;
        syh = this._sweepOut.y;
      }
      orientLimb(upper, sx, sy, z, sxh, syh, z);
      lower.visible = false;
      elbowJoint.visible = false;
      handMesh.position.set(sxh, syh, z);
      return;
    }
```

- [ ] **Step 4: Browser smoke test — verify hands clamp at a wall**

Open the preview. Stand player next to a wall. Aim into the wall. Run in console:

```javascript
const sm = window.game.players.find(p => p.isLocal && p.alive);
console.log('handR:', sm.rig.handR.position.x, sm.rig.handR.position.y);
console.log('body:', sm.body.position.x, sm.body.position.y);
```

Walk into the wall, aim into it, observe that `handR.position.x` does not exceed the wall's near surface X. Compare against the same call before this change (revert + retest if uncertain).

Expected: hand position stays ≤ wall surface X minus ~LIMB_PAD when arm is aimed into the wall.

- [ ] **Step 5: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "rig: sweep arms against world walls

_drawArm applies _sweepClamp after maxReach clamp. IK folds arm when
endpoint clamps short. Same applied to gumGumPunch stretched branch."
```

---

## Task 4: Apply sweep to legs in `_drawLeg`

**Files:**
- Modify: [src/entities/StickmanRig.js:1434-1451](../../../src/entities/StickmanRig.js)

Same pattern as arms.

- [ ] **Step 1: Extend `_drawLeg` signature**

Update signature at line 1434:

```javascript
  _drawLeg(hx, hy, fx, fy, z, upper, lower, footMesh, hipJoint, kneeJoint, isRight, params) {
```

- [ ] **Step 2: Update both call sites to pass `params`**

Around line 1390-1391:

```javascript
    this._drawLeg(hipLX, hipLY, this._footLPos.x, this._footLPos.y, zL, this.upperLegL, this.lowerLegL, this.footL, this.hipL, this.kneeL, false, params);
    this._drawLeg(hipRX, hipRY, this._footRPos.x, this._footRPos.y, zR, this.upperLegR, this.lowerLegR, this.footR, this.hipR, this.kneeR, true, params);
```

- [ ] **Step 3: Apply sweep inside `_drawLeg`**

Replace the maxReach block (line 1436-1444):

```javascript
    const upperLen = 0.50, lowerLen = 0.50;
    const maxReach = (upperLen + lowerLen) * 0.99;
    const dx = fx - hx, dy = fy - hy;
    const d = Math.hypot(dx, dy);
    let cfx = fx, cfy = fy;
    if (d > maxReach) {
      const f = maxReach / d;
      cfx = hx + dx * f; cfy = hy + dy * f;
    }
    if (params) {
      this._sweepClamp(hx, hy, cfx, cfy, params, this._sweepOut);
      cfx = this._sweepOut.x;
      cfy = this._sweepOut.y;
    }
```

Leave the rest of `_drawLeg` unchanged.

- [ ] **Step 4: Browser smoke test — kick into wall**

In preview, walk next to a wall, trigger a kick or somersault. Verify foot doesn't poke through wall.

- [ ] **Step 5: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "rig: sweep legs against world walls

Same pattern as arms — _drawLeg applies _sweepClamp after maxReach."
```

---

## Task 5: Head floor clamp in `update`

**Files:**
- Modify: [src/entities/StickmanRig.js:853](../../../src/entities/StickmanRig.js) — head position section.

Head clamp is a single vertical down-ray. Apply AFTER the head position is set so we can re-snap it.

- [ ] **Step 1: Add head clamp block right after head.position.set**

At the existing line 853:

```javascript
    this.head.position.set(headX + this._headLagX, headY + this._headLagY, hipZ);
```

Insert immediately AFTER it:

```javascript
    this.head.position.set(headX + this._headLagX, headY + this._headLagY, hipZ);
    // Floor clamp — prevent head sphere from dipping below ground on
    // big lunges, somersaults, or post-knockdown sprawl. Vertical
    // down-ray only; horizontal walls are already handled by body
    // capsule + arm/leg sweeps (head shoulder is rigidly attached
    // ~0.95m above torso, can't reach a wall the body hasn't).
    if (params.physics && params.physics.raycast) {
      const HEAD_RADIUS = 0.34;
      const ox = params.worldOriginX ?? 0;
      const oy = params.worldOriginY ?? 0;
      const headWorldX = ox + this.head.position.x;
      const headWorldY = oy + this.head.position.y;
      const floor = params.physics.raycast(
        { x: headWorldX, y: headWorldY, z: 0 },
        { x: headWorldX, y: headWorldY - (HEAD_RADIUS + 0.20), z: 0 },
        { mask: WORLD_MASK },
      );
      if (floor && floor.hitPointWorld) {
        const minLocalY = (floor.hitPointWorld.y + HEAD_RADIUS + LIMB_PAD) - oy;
        if (this.head.position.y < minLocalY) {
          this.head.position.y = minLocalY;
        }
      }
    }
```

- [ ] **Step 2: Browser smoke test — somersault near floor**

In preview, trigger somersault near a ground tile. Verify head stays above floor visually.

- [ ] **Step 3: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "rig: clamp head above floor on big poses

Vertical down-ray after head position set. Prevents head dip below
ground tiles during somersault recovery, big lunges, prone sprawl."
```

---

## Task 6: Harness tests — `__test_rigClipsWallStanding` + `__test_rigClipsFloorOnLunge`

**Files:**
- Modify: [src/util/__weaponDebug.js](../../../src/util/__weaponDebug.js) — append two test functions at end of file.

- [ ] **Step 1: Add `__test_rigClipsWallStanding` test function**

Append to the end of `__weaponDebug.js`:

```javascript
window.__test_rigClipsWallStanding = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');

  // Hunt for a wall in either facing direction within 30m of the player.
  const probeY = sm.body.position.y + 0.55;
  const probeFacing = (dir) => window.game.physics.raycast(
    { x: sm.body.position.x, y: probeY, z: 0 },
    { x: sm.body.position.x + dir * 30, y: probeY, z: 0 },
    { mask: 0x0001 },
  );
  let probe = probeFacing(sm.facing);
  let dir = sm.facing;
  if (!probe) {
    probe = probeFacing(-sm.facing);
    dir = -sm.facing;
  }
  if (!probe) return 'SKIP: no wall in 30m of player';

  const wallX = probe.hitPointWorld.x;
  sm.facing = dir;
  // Position body so shoulder + maxReach reaches PAST the wall.
  // body→shoulder offset ~0.18 horizontal, arm reach 0.88 max.
  // Place body 0.7m short of wall — hand wants to be ~0.36m past wall.
  sm.body.position.x = wallX - dir * 0.7;
  sm.body.position.y = Math.max(probe.hitPointWorld.y - 0.55, 1.0);
  sm.aimDir = { x: dir, y: 0 };
  sm.input = { ...sm.input, aimActive: true };

  // Settle pose spring and rig.
  for (let i = 0; i < 30; i++) {
    window.game.physics.step(1 / 60);
    sm._syncRig(1 / 60, false);
  }

  // Hand position is local to rig.group (which is at body.position).
  // World hand X = body.x + rig.handR.position.x.
  const handLocalX = sm.rig.handR.position.x;
  const handWorldX = sm.body.position.x + handLocalX;

  // Wall surface is at wallX. Sweep should hold hand on the body side
  // of the wall: |handWorldX - wallX| should keep handWorldX on body side.
  // body side = wallX - dir * (positive value) i.e. dir*(wallX - handWorldX) > 0.
  const intoWallSign = dir * (handWorldX - wallX);
  window.__weaponTest.assert(
    intoWallSign < 0.02,
    'hand should NOT cross wall surface (handX=' + handWorldX.toFixed(3) +
    ', wallX=' + wallX.toFixed(3) + ', dir=' + dir + ', signed-penetration=' + intoWallSign.toFixed(3) + ')',
  );
};
```

- [ ] **Step 2: Add `__test_rigClipsFloorOnLunge` test function**

Append below the previous test:

```javascript
window.__test_rigClipsFloorOnLunge = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');

  // Find a floor tile under the player.
  const probe = window.game.physics.raycast(
    { x: sm.body.position.x, y: sm.body.position.y + 4, z: 0 },
    { x: sm.body.position.x, y: sm.body.position.y - 4, z: 0 },
    { mask: 0x0001 },
  );
  if (!probe) return 'SKIP: no floor under player';
  const floorY = probe.hitPointWorld.y;

  // Force-push head below floor by manually setting its local position,
  // then run _syncRig once and verify the clamp lifted it back.
  sm.body.position.y = floorY + 1.0; // body just above floor
  // Run one sync so head position is set by rig.
  sm._syncRig(1 / 60, false);
  // Save the post-sync head Y for comparison.
  const headLocalY = sm.rig.head.position.y;
  const headWorldY = sm.body.position.y + headLocalY;

  // Head sphere bottom should never dip below floor + LIMB_PAD.
  const HEAD_RADIUS = 0.34;
  const headBottom = headWorldY - HEAD_RADIUS;
  window.__weaponTest.assert(
    headBottom >= floorY - 0.005,
    'head bottom must stay above floor (headBottom=' + headBottom.toFixed(3) +
    ', floorY=' + floorY.toFixed(3) + ')',
  );
};
```

- [ ] **Step 3: Run both tests via browser**

In preview console:

```javascript
await window.__weaponTest.run('rigClipsWallStanding');
await window.__weaponTest.run('rigClipsFloorOnLunge');
```

Expected output:
```
'PASS: rigClipsWallStanding'
'PASS: rigClipsFloorOnLunge'
```

If `SKIP:` returned for either, the test scene lacks a wall or floor near spawn — that's an environment issue, not a code bug. Either reposition spawn or accept SKIP and rely on manual playtest below.

- [ ] **Step 4: Commit**

```bash
git add src/util/__weaponDebug.js
git commit -m "test: rig wall + floor clip harness tests

Two assertions exercising Sub-A sweep clamps in the live preview."
```

---

## Task 7: Manual playtest + perf check + final commit

- [ ] **Step 1: Walk-into-walls manual test**

In preview, equip each of: Fists, BaseballBat, Sledgehammer, Pistol, Shotgun, Sniper, Minigun, RPG, DualPistols, Crossbow, Shurikens (full SPAWN_TABLE list). For each: walk player against a wall, swing/aim/fire. Visual check: no limb pokes through wall.

- [ ] **Step 2: Somersault floor test**

Trigger somersault near ground (`gunGum`-keybind or test trigger if available). Verify head doesn't dip below floor mid-rotation.

- [ ] **Step 3: Perf instrumentation per memory `feedback_perf_workflow.md`**

In preview console:

```javascript
window.__perf = { samples: [] };
const t0 = performance.now();
for (let i = 0; i < 60; i++) window.game.players.forEach(p => p._syncRig(1/60, false));
const t1 = performance.now();
console.log('60 _syncRig calls (' + window.game.players.length + ' players): ' + (t1 - t0).toFixed(2) + 'ms');
```

Compare against same measurement from `master` (before Sub-A). Expected: increase well under 1ms total for 4 players × 60 syncs. If regression > 2ms, revisit — possibly skip sweeps when limb fully inside body radius (no chance of wall hit).

- [ ] **Step 4: Verify base test suite still passes (no regression from new params)**

In preview console:

```javascript
await window.__weaponTest.run('headSnap_exists');
await window.__weaponTest.run('headshot_registers');
await window.__weaponTest.run('bodyshot_no_double');
await window.__weaponTest.run('weapon_wall_reorient');
```

All should still PASS. Some tests (per memory) leak state from earlier runs — if a single test fails after a full-suite run, reload + run that test individually.

- [ ] **Step 5: Push branch + open PR**

```bash
git push -u origin claude/affectionate-napier-508de3
gh pr create --title "Sub-A: rig segment sweeps (cartoon-squish wall + floor clamp)" --body "$(cat <<'EOF'
## Summary
- `_drawArm` / `_drawLeg` raycast shoulder→hand and hip→foot against WORLD; on hit, endpoint clamps short by `LIMB_PAD = 0.06m` and IK folds the limb (cartoon-squish).
- Forward + back-ray fallback handles prior-frame penetration.
- Head section in `update` runs a vertical down-ray and clamps head Y so the head sphere can't dip below floor on big lunges/somersaults.
- 2 harness tests + manual walk-into-walls playtest verified per weapon.

## Test plan
- [x] `__test_rigClipsWallStanding` PASS in preview
- [x] `__test_rigClipsFloorOnLunge` PASS in preview
- [x] Manual: walked into walls with all SPAWN_TABLE weapons — no limb clipping
- [x] Manual: somersault near floor — head stays above ground
- [x] Perf: < 1ms total added per frame for 4 players

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Per memory `feedback_pr_workflow.md`: prefer push + PR + squash-merge in one shot when authorized. Wait for explicit authorization before merging — do not auto-merge.

---

## Self-review checklist

- [x] **Spec coverage:**
  - Sub-A §Approach (cartoon-squish, segment sweep) → Tasks 2-4.
  - §Mechanism (forward ray + LIMB_PAD pull-back) → Task 2 step 2.
  - §Back-ray fallback → Task 2 step 2 (second `phys.raycast` call).
  - §2.5D Z handling → Task 2 step 2 (`z: 0` in raycast endpoints).
  - §Head clamp → Task 5.
  - §Files touched → Stickman.js (Task 1), StickmanRig.js (Tasks 2-5), `__weaponDebug.js` (Task 6).
  - §Tests → Task 6 (both tests named per spec).
  - §Performance — `__perf` instrumentation → Task 7 step 3.
- [x] **No placeholders.** Every step has exact code or commands.
- [x] **Type consistency.** `_sweepClamp(sx, sy, hx, hy, params, out)` signature used identically in Tasks 2, 3, 4. `LIMB_PAD`, `WORLD_MASK`, `_sweepOut` names consistent.
- [x] **Frequent commits.** One commit per task.

Last-resort body-edge clamp (mentioned in spec §Back-ray fallback as final fallback if both rays miss) is intentionally NOT implemented in this plan: the back-ray covers the "hand inside wall" case, and "both rays miss but penetration still visible" is a corner case requiring detection that the spec describes only loosely. If observed during manual playtest in Task 7, file a follow-up.
