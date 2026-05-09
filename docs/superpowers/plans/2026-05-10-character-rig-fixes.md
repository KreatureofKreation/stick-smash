# Character Rig Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply 7 surgical fixes to the procedural stickman rig that resolve idle stance, walk locomotion, jump phases, and ragdoll collapse — without changing geometry, materials, or proportions.

**Architecture:** All visual fixes live in `src/entities/StickmanRig.js`. Ragdoll fix also touches `src/entities/Stickman.js` (angular impulse + linear damping on death). No new modules, no API changes to consumers (Stickman, Bot, Net).

**Tech Stack:** Three.js procedural mesh rig (cylinders + spheres), cannon-es shim over Rapier physics, pure ES modules — no build step.

**Verification:** Game has no automated tests for rig (visual-only). Each task verified via the running brainstorm preview server at `http://localhost:57072/files/rig-preview.html` (live 3D rig with pose toggles), or by running `npm start` and playing in-browser. The brainstorm preview imports the rig directly from `src/entities/StickmanRig.js` so edits hot-reload on browser refresh.

---

## File map

| File | Touched by | Responsibility |
| --- | --- | --- |
| `src/entities/StickmanRig.js` | T1, T2, T3, T4, T5, T6, T8 | Procedural rig — joints, IK, pose state machine, ragdoll splay |
| `src/entities/Stickman.js` | T7 | Stickman entity — physics body, ragdoll trigger angular impulse |

Tasks ordered easiest-independent first → complex last. Each task is self-contained: ships a working state and is committed before next task starts.

---

## Spec reference

See [docs/superpowers/specs/2026-05-10-character-rig-fixes-design.md](../specs/2026-05-10-character-rig-fixes-design.md).

---

### Task 1: Joint sphere shrink (Fix 3)

**Files:**
- Modify: `src/entities/StickmanRig.js:82-89`

- [ ] **Step 1: Open file and find joint sphere block**

The constructor builds joint spheres at lines 82-89:
```js
this.shoulderL = joint(0.115);
this.shoulderR = joint(0.115);
this.elbowL = joint(0.10);
this.elbowR = joint(0.10);
this.hipL = joint(0.13);
this.hipR = joint(0.13);
this.kneeL = joint(0.12);
this.kneeR = joint(0.12);
```

- [ ] **Step 2: Replace radii to match adjoining limb radius exactly**

Replace the block above with:
```js
this.shoulderL = joint(0.10);
this.shoulderR = joint(0.10);
this.elbowL = joint(0.09);
this.elbowR = joint(0.09);
this.hipL = joint(0.13);
this.hipR = joint(0.13);
this.kneeL = joint(0.11);
this.kneeR = joint(0.11);
```

(Hip stays 0.13 — already matches `upperLeg` radius. Shoulder 0.115→0.10, elbow 0.10→0.09, knee 0.12→0.11.)

- [ ] **Step 3: Verify visually**

Reload `http://localhost:57072/files/rig-preview.html`. Pick "Idle" pose. Zoom (mouse wheel on canvas) to any joint. Cylinder ends should meet sphere flush — no visible "ball" bulge. Hand and foot end-caps unchanged (still visible silhouette anchors).

- [ ] **Step 4: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "fix(rig): shrink joint spheres flush with limb radius

shoulder 0.115->0.10, elbow 0.10->0.09, knee 0.12->0.11. Spheres
now match adjoining cylinder radius exactly so cylinder ends sit
flush with sphere instead of producing a visible 'ball' bulge at
every joint. Hand/foot end-caps unchanged (silhouette anchors)."
```

---

### Task 2: Idle hip raise (Fix 4)

**Files:**
- Modify: `src/entities/StickmanRig.js:283`

- [ ] **Step 1: Open file and find hipY assignment**

At line 283, current hipY computation:
```js
const hipY = pos.y + 0.22 - bob - crouchDrop - landDrop + breathBob;
```

- [ ] **Step 2: Bump baseline 0.22 → 0.25**

Replace the line with:
```js
const hipY = pos.y + 0.25 - bob - crouchDrop - landDrop + breathBob;
```

The hip-foot diff at idle becomes `(pos.y + 0.25) - (pos.y - 0.75) = 1.00m`, matching leg total length. IK clamps to maxReach 0.99 — knees read essentially straight at idle. `bob`/`crouchDrop`/`landDrop` still subtract → knees flex during stride/crouch/land.

- [ ] **Step 3: Verify visually**

Reload preview. Idle pose: legs read straight (no perpetual squat). Walk/Run pose: knees still bend visibly during stride. Stand near edge of grid for ground reference — feet should touch ground line.

- [ ] **Step 4: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "fix(rig): raise idle hip 0.22 -> 0.25

Hip-foot diff at idle was 0.97m on 1.0m legs = ~14 deg permanent
knee bend. Bumping hip baseline to 0.25 makes diff 1.00m so legs
read essentially straight when standing. Knees still flex during
stride/crouch/landing because bob/crouchDrop/landDrop still subtract."
```

---

### Task 3: Arm IK bend → facing-based (Fix 1, part A)

**Files:**
- Modify: `src/entities/StickmanRig.js:684`

- [ ] **Step 1: Open `_drawArm` and locate solveIK call**

At line 684:
```js
solveIK(this._tmpKnee, sx, sy, chx, chy, upperLen, lowerLen, isRight ? 1 : -1);
```

`bend = isRight ? 1 : -1` makes both elbows fly outward (chicken wings) regardless of facing.

- [ ] **Step 2: Replace bend with facing-based**

Change the line to:
```js
solveIK(this._tmpKnee, sx, sy, chx, chy, upperLen, lowerLen, this.facing >= 0 ? 1 : -1);
```

Now both elbows rotate in the +facing direction (matches leg IK convention, [StickmanRig.js:703](src/entities/StickmanRig.js:703)). Aim/attack/grab/hold poses already drive hand position via angle math directly so the bend sign change is invisible to them.

- [ ] **Step 3: Verify visually**

Reload preview. Idle: elbows no longer jut outward — arms hang naturally with elbows pointing slightly forward. Walk/Run: arm pump reads as articulated with elbows trailing, not winging out sideways. Aim pose: visually unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "fix(rig): arm IK bend follows facing, not side

Both arms used isRight ? 1 : -1 which forced elbows outward
regardless of body facing -> chicken-wing pose at idle/walk/run.
Switch to facing-based bend (both arms rotate elbow CCW for
facing>=0, CW otherwise). Matches leg IK convention. Aim/attack
/grab/hold poses unaffected (they bypass IK bend)."
```

---

### Task 4: Idle hand position cleanup (Fix 1, part B)

**Files:**
- Modify: `src/entities/StickmanRig.js:530-543` (right arm idle branch)
- Modify: `src/entities/StickmanRig.js:561-570` (left arm idle branch)

- [ ] **Step 1: Update right arm idle branch**

Find the right arm walk-pose else branch at lines 530-543. Current:
```js
    } else {
      // Run arm — bent-elbow pump. Hand traces a forward+up arc on the
      // forward stroke (chin level) and a back+down arc on the back
      // stroke (hand drops past hip behind). Baseline blends to relaxed
      // hang at standstill so idle isn't a stiff brace.
      const armSw = Math.sin(phase + Math.PI) * stepAmp * swingDir;
      const fwdBoost = Math.max(0, armSw);
      const runBlend = clamp(stepAmp * 1.6, 0, 1);
      const baseUp = lerp(-0.45, -0.18, runBlend);
      const armForward = 0.06 + armSw * 0.34 + fwdBoost * 0.10;
      const armUp = baseUp + armSw * 0.08 + fwdBoost * 0.34;
      handRX = sRX + this.facing * armForward;
      handRY = sRY + armUp;
    }
```

Replace with:
```js
    } else {
      // Run arm — bent-elbow pump. Hand traces a forward+up arc on the
      // forward stroke (chin level) and a back+down arc on the back
      // stroke (hand drops past hip behind). Baseline blends to relaxed
      // hang at standstill: at runBlend=0, hand drops directly below
      // shoulder with no forward push so idle reads as relaxed-at-sides
      // instead of stiff-braced-forward.
      const armSw = Math.sin(phase + Math.PI) * stepAmp * swingDir;
      const fwdBoost = Math.max(0, armSw);
      const runBlend = clamp(stepAmp * 1.6, 0, 1);
      const baseUp = lerp(-0.55, -0.18, runBlend);
      const idleForward = lerp(0, 0.06, runBlend);
      const armForward = idleForward + armSw * 0.34 + fwdBoost * 0.10;
      const armUp = baseUp + armSw * 0.08 + fwdBoost * 0.34;
      handRX = sRX + this.facing * armForward;
      handRY = sRY + armUp;
    }
```

Changes: `baseUp` lerp lower bound `-0.45` → `-0.55` (longer hang at idle). New `idleForward = lerp(0, 0.06, runBlend)` so idle (`runBlend=0`) gives forward=0; full run gives 0.06 like before.

- [ ] **Step 2: Update left arm idle branch (mirror change)**

Find left arm else branch at lines 561-570. Current:
```js
    } else {
      const armSw = Math.sin(phase) * stepAmp * swingDir;
      const fwdBoost = Math.max(0, armSw);
      const runBlend = clamp(stepAmp * 1.6, 0, 1);
      const baseUp = lerp(-0.45, -0.18, runBlend);
      const armForward = 0.06 + armSw * 0.34 + fwdBoost * 0.10;
      const armUp = baseUp + armSw * 0.08 + fwdBoost * 0.34;
      handLX = sLX + this.facing * armForward;
      handLY = sLY + armUp;
    }
```

Replace with:
```js
    } else {
      const armSw = Math.sin(phase) * stepAmp * swingDir;
      const fwdBoost = Math.max(0, armSw);
      const runBlend = clamp(stepAmp * 1.6, 0, 1);
      const baseUp = lerp(-0.55, -0.18, runBlend);
      const idleForward = lerp(0, 0.06, runBlend);
      const armForward = idleForward + armSw * 0.34 + fwdBoost * 0.10;
      const armUp = baseUp + armSw * 0.08 + fwdBoost * 0.34;
      handLX = sLX + this.facing * armForward;
      handLY = sLY + armUp;
    }
```

- [ ] **Step 3: Verify visually**

Reload preview. Idle: hands hang directly below shoulders, no forward lean. Hands sit slightly lower than before (near hip level). Transition into Walk: forward push smoothly fades in as legs start moving — no snap.

- [ ] **Step 4: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "fix(rig): relax idle arm pose to straight hang

Idle armForward was constant 0.06 even when runBlend=0, putting
hands forward of shoulder = stiff 'ready' stance instead of
relaxed-at-sides. Fix: idleForward = lerp(0, 0.06, runBlend) so
idle has zero forward push, walk/run keeps existing pump. Also
deepen baseUp at idle from -0.45 to -0.55 so hands hang at hip
line rather than mid-torso."
```

---

### Task 5: Walk stride targets — half stride alternating (Fix 5)

**Files:**
- Modify: `src/entities/StickmanRig.js:411-446` (run-cycle leg block)

- [ ] **Step 1: Find the run-cycle stride code**

Lines 411-446 contain the run cycle. Locate the `maxDrag` constant (line 413):
```js
      const maxDrag = 0.55;
```

And the stride target assignments (lines 431, 442):
```js
        const target = hipLX + this.facing * stride;
```
```js
        const target = hipRX + this.facing * stride;
```

- [ ] **Step 2: Halve stride target and proportion-clamp maxDrag**

Replace `const maxDrag = 0.55;` (line 413) with:
```js
      const maxDrag = stride * 0.8;
```

Replace L target line (line 431):
```js
        const target = hipLX + this.facing * stride * 0.5;
```

Replace R target line (line 442):
```js
        const target = hipRX + this.facing * stride * 0.5;
```

Each foot now oscillates between `-stride/2` (behind hip) and `+stride/2` (ahead of hip) — proper alternating walk. Cycle math unchanged: cycle still covers `2*stride` body distance.

- [ ] **Step 3: Verify visually**

Reload preview. Pick "Walk" pose. At any single frame, one foot should be visibly ahead of hip and other behind (alternating). Pick "Run" pose: same — feet stride past hip in both directions, no forward shuffle. Body still moves forward smoothly relative to feet.

- [ ] **Step 4: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "fix(rig): walk stride alternates - half stride each side

Swing target was hipLX + facing*stride (full stride forward).
Both feet always planted ahead of hip = tiptoe shuffle, no rear
foot. Halve to stride*0.5 so each foot oscillates between -s/2
(behind hip) and +s/2 (ahead). Proper alternating walk: at any
frame one foot leads, other trails. maxDrag now stride*0.8 (was
0.55 constant) so clamp stays proportional to new target range."
```

---

### Task 6: Z-stagger — depth offset L/R limbs (Fix 2)

**Files:**
- Modify: `src/entities/StickmanRig.js` (add constant, modify draw call section)

- [ ] **Step 1: Add Z_STAGGER module-level constant**

Near the top of the file (after the imports, before the helper functions — roughly line 8), add:
```js
const Z_STAGGER = 0.08;
```

Place it adjacent to the existing helpers `_v`, `_yAxis` so it's discoverable.

- [ ] **Step 2: Update the four limb draw calls**

Find the draw call block at lines 650-653:
```js
    this._drawArm(sLX, sLY, this._handLPos.x, this._handLPos.y, hipZ, this.upperArmL, this.lowerArmL, this.handL, this.shoulderL, this.elbowL, false, false);
    this._drawArm(sRX, sRY, this._handRPos.x, this._handRPos.y, hipZ, this.upperArmR, this.lowerArmR, this.handR, this.shoulderR, this.elbowR, true, !!params.gumGumPunch);
    this._drawLeg(hipLX, hipLY, this._footLPos.x, this._footLPos.y, hipZ, this.upperLegL, this.lowerLegL, this.footL, this.hipL, this.kneeL, false);
    this._drawLeg(hipRX, hipRY, this._footRPos.x, this._footRPos.y, hipZ, this.upperLegR, this.lowerLegR, this.footR, this.hipR, this.kneeR, true);
```

Replace with:
```js
    const zL = hipZ - Z_STAGGER;
    const zR = hipZ + Z_STAGGER;
    this._drawArm(sLX, sLY, this._handLPos.x, this._handLPos.y, zL, this.upperArmL, this.lowerArmL, this.handL, this.shoulderL, this.elbowL, false, false);
    this._drawArm(sRX, sRY, this._handRPos.x, this._handRPos.y, zR, this.upperArmR, this.lowerArmR, this.handR, this.shoulderR, this.elbowR, true, !!params.gumGumPunch);
    this._drawLeg(hipLX, hipLY, this._footLPos.x, this._footLPos.y, zL, this.upperLegL, this.lowerLegL, this.footL, this.hipL, this.kneeL, false);
    this._drawLeg(hipRX, hipRY, this._footRPos.x, this._footRPos.y, zR, this.upperLegR, this.lowerLegR, this.footR, this.hipR, this.kneeR, true);
```

Head, torso, chestArmor still rendered at `hipZ` (no change to their existing positioning code earlier in `update()`).

- [ ] **Step 3: Verify visually**

Reload preview. Pick "3/4" view button. L and R limbs should be visibly offset in depth — knees no longer collapse onto same X line. Side view: limbs still appear stacked (small Z offset doesn't change side silhouette). Front view: clearly separated L/R limbs.

- [ ] **Step 4: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "feat(rig): Z-stagger L/R limbs by 0.08m

All rig joints rendered at z=hipZ -> single 2D plane. Front/3q
view showed both knees jutting same X side (because IK bend is
facing-based, both legs rotate elbow same direction in XY). Add
Z_STAGGER constant and offset L limbs to z-0.08, R limbs to
z+0.08 in the four limb draw calls. Side view unchanged (small
depth offset invisible from broadside). Head/torso stay centered."
```

---

### Task 7: Ragdoll angular impulse + linear damping (Fix 7, physics side)

**Files:**
- Modify: `src/entities/Stickman.js:294-298` (die method ragdoll setup)

- [ ] **Step 1: Open Stickman.js die() method**

At line 294-298 the current ragdoll setup:
```js
    this.body.collisionFilterMask = COL_GROUPS.WORLD; // ragdoll only collides with world
    this.body.linearDamping = 0.05;
    this.body.angularDamping = 0.5;
    this.body.fixedRotation = false;
    this.body.updateMassProperties();
```

`linearDamping = 0.05` makes corpse skid forever. No angular impulse — body slumps but doesn't tumble.

- [ ] **Step 2: Bump linear damping and apply tumble spin**

Replace the block above with:
```js
    this.body.collisionFilterMask = COL_GROUPS.WORLD; // ragdoll only collides with world
    this.body.linearDamping = 1.2;
    this.body.angularDamping = 0.5;
    this.body.fixedRotation = false;
    this.body.updateMassProperties();
    // Tumble spin proportional to direction of last damager so the corpse
    // pinwheels away from attacker instead of slumping straight down.
    const lastDmg = this.lastDamager;
    const hitDx = lastDmg ? Math.sign(this.body.position.x - lastDmg.body.position.x) : (Math.random() < 0.5 ? -1 : 1);
    this.body.angularVelocity.z = hitDx * (8 + Math.random() * 4);
```

`hitDx` falls back to ±1 random if `lastDamager` missing (e.g., environmental death like void or hazard). Spin magnitude 8-12 rad/s = ~1-2 full rotations/sec, visible tumble that decays via angularDamping.

- [ ] **Step 3: Verify in-game (preview cannot easily simulate kill)**

Run `npm start` (separate terminal). Open `http://localhost:5173`. Start local match with bots. Punch/shoot a bot until it dies. Corpse should:
- Visibly rotate (tumble) rather than slump upright
- Settle to rest within ~1-2 seconds (not skid forever)
- Spin direction matches push-away-from-attacker

- [ ] **Step 4: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(physics): tumble corpse + settle damping on death

linearDamping was 0.05 -> corpse skids forever after death.
Bump to 1.2 so it settles within ~1.5s. Apply angular impulse
proportional to direction of last damager (8-12 rad/s away from
attacker, falls back to random if no damager attributed). Body
now visibly tumbles instead of slumping. Existing fixedRotation
=false unlock + revive reset stay unchanged."
```

---

### Task 8: Ragdoll limb splay (Fix 7, rig side)

**Files:**
- Modify: `src/entities/StickmanRig.js:574-595` (totalRag block in update)

- [ ] **Step 1: Find the existing ragdoll droop block**

Lines 574-595 contain the current ragdoll droop:
```js
    const idleLoose = (params.armPoseR === 'walk' && params.armPoseL === 'walk') ? 0.10 : 0;
    const totalRag = Math.max(idleLoose, this.ragdollAmount);
    if (totalRag > 0.02) {
      const r = totalRag;
      // Limbs whip with body angular velocity — gives the dead body's flailing
      // limbs that trail-behind-rotation feel of a real ragdoll.
      const av = (params.angVz || 0) * 0.04;
      const sag = -0.55 - Math.sin(this.t * 4) * 0.05;
      // Hands swing perpendicular to spin direction.
      handLX = lerp(handLX, sLX + av,        r);
      handLY = lerp(handLY, sLY + sag,       r);
      handRX = lerp(handRX, sRX + av,        r);
      handRY = lerp(handRY, sRY + sag,       r);
      // Feet hang and trail too — only when fully ragdoll, otherwise the
      // run plant logic still drives them. Avoid breaking idle/walk.
      if (this.ragdollAmount > 0.5) {
        const footSag = -0.65 - Math.sin(this.t * 3.5) * 0.05;
        footLX = lerp(footLX, hipLX + av * 0.7, this.ragdollAmount);
        footLY = lerp(footLY, hipLY + footSag,  this.ragdollAmount);
        footRX = lerp(footRX, hipRX + av * 0.7, this.ragdollAmount);
        footRY = lerp(footRY, hipRY + footSag,  this.ragdollAmount);
      }
    }
```

The `totalRag > 0.02` outer block handles partial droop (idle dazed flail). The inner `ragdollAmount > 0.5` block handles full collapse. We rewrite ONLY the inner full-collapse block; partial droop stays.

- [ ] **Step 2: Replace inner full-collapse block with splay logic**

Replace the entire block above with:
```js
    const idleLoose = (params.armPoseR === 'walk' && params.armPoseL === 'walk') ? 0.10 : 0;
    const totalRag = Math.max(idleLoose, this.ragdollAmount);
    if (totalRag > 0.02) {
      if (this.ragdollAmount > 0.5) {
        // Full collapse: throw limbs OUT perpendicular to torso axis (in
        // local rig frame). The rig.group quaternion already follows the
        // physics body's rotation when ragdolling (Stickman.js:1232-1233),
        // so local-frame splay rotates with the tumbling body in world.
        const ragAmt = this.ragdollAmount;
        // Local-frame perpendicular to torso direction (sin(tilt), cos(tilt)).
        const perpX =  Math.cos(this.bodyTilt);
        const perpY = -Math.sin(this.bodyTilt);
        const avSplay = (params.angVz || 0) * 0.08; // amplified from 0.04
        handLX = lerp(handLX, sLX - perpX * 0.6 + avSplay,        ragAmt);
        handLY = lerp(handLY, sLY - perpY * 0.6 - 0.10,           ragAmt);
        handRX = lerp(handRX, sRX + perpX * 0.6 + avSplay,        ragAmt);
        handRY = lerp(handRY, sRY + perpY * 0.6 - 0.10,           ragAmt);
        footLX = lerp(footLX, hipLX - perpX * 0.7 + avSplay * 0.7, ragAmt);
        footLY = lerp(footLY, hipLY - perpY * 0.7,                 ragAmt);
        footRX = lerp(footRX, hipRX + perpX * 0.7 + avSplay * 0.7, ragAmt);
        footRY = lerp(footRY, hipRY - perpY * 0.7,                 ragAmt);
      } else {
        // Partial droop — idle dazed flail (totalRag in (0.02, 0.5]).
        // Limbs whip with body angular velocity for trail-behind-rotation feel.
        const r = totalRag;
        const av = (params.angVz || 0) * 0.04;
        const sag = -0.55 - Math.sin(this.t * 4) * 0.05;
        handLX = lerp(handLX, sLX + av,  r);
        handLY = lerp(handLY, sLY + sag, r);
        handRX = lerp(handRX, sRX + av,  r);
        handRY = lerp(handRY, sRY + sag, r);
      }
    }
```

The two branches are now exclusive: partial-droop runs only when `ragdollAmount <= 0.5` (so dazed flail keeps gentle hand sag), full-collapse runs only when `ragdollAmount > 0.5` (limbs splay outward, no double-blending). Feet are only manipulated in the full-collapse branch — partial droop leaves run/walk plant logic to drive feet, same as before.

- [ ] **Step 3: Verify in-game**

If `npm start` is still running from Task 7, just refresh the browser. Otherwise relaunch. Kill a bot. Corpse limbs should splay outward (arms/legs spread away from torso) and trail with rotation. Combined with Task 7's tumble spin, the body should look fully crumpled — splayed, rotating, settling — not like a still-upright character that fell down.

- [ ] **Step 4: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "feat(rig): full ragdoll splay - limbs throw out perpendicular

Full-collapse branch (ragdollAmount > 0.5) only sagged hands and
feet downward in local frame. Body looked half-dead, not flopped.
Replace inner block with perpendicular-to-torso splay: hands and
feet throw OUT to either side of the spine axis, drift with
angular velocity (av amplified 0.04 -> 0.08). Group quaternion
already follows physics rotation, so local splay rotates with
the tumbling body in world space. Partial droop branch (totalRag
> 0.02 && ragdollAmount <= 0.5) untouched."
```

---

### Task 9: Jump phase poses (Fix 6)

**Files:**
- Modify: `src/entities/StickmanRig.js:367-375` (airborne foot block)
- Modify: `src/entities/StickmanRig.js:530-543, 561-570` (arm idle branches — add airborne early-exit)

- [ ] **Step 1: Replace airborne foot block**

Lines 367-375 currently:
```js
    if (!params.grounded) {
      // Airborne: tuck on rise, reach on fall. Slight L/R offset reads as legs.
      const rising = vy > 0;
      const tuck = rising ? 0.30 : -0.02;
      footLX = hipX - 0.16 + this.facing * (rising ? 0.05 : -0.10);
      footRX = hipX + 0.16 + this.facing * (rising ? 0.10 : -0.05);
      footLY = baseFootY + 0.18 + tuck;
      footRY = baseFootY + 0.18 + tuck * 0.5;
    } else if ((this._realSpeed ?? 0) < 0.5) {
```

Replace the `if (!params.grounded)` block with phase-based airborne pose:
```js
    if (!params.grounded) {
      // Three phases driven by vy:
      //   takeoff vy > 3      : legs trail under hip (extending push)
      //   apex    vy in [-1,3]: knees tucked up
      //   fall    vy < -1     : legs reach forward to brace landing
      let liftN, footFwd;
      if (vy > 3) {
        const t = clamp((vy - 3) / 4, 0, 1);
        liftN = lerp(0.40, 0.05, t);     // less lift as vy increases (push extending)
        footFwd = 0;
      } else if (vy >= -1) {
        const t = clamp((vy + 1) / 4, 0, 1); // 0 at vy=-1, 1 at vy=3
        liftN = lerp(0.40, 0.55, t);     // peak tuck near apex
        footFwd = 0;
      } else {
        const t = clamp((-vy - 1) / 6, 0, 1);
        liftN = lerp(0.55, 0.18, t);     // legs drop forward to land
        footFwd = lerp(0, 0.10, t);
      }
      footLX = hipX - 0.16 + this.facing * footFwd;
      footRX = hipX + 0.16 + this.facing * footFwd;
      footLY = baseFootY + liftN;
      footRY = baseFootY + liftN;
    } else if ((this._realSpeed ?? 0) < 0.5) {
```

- [ ] **Step 2: Add airborne arm override — right arm**

Find the right arm pose if/else chain at lines 477-543. Insert a new branch BEFORE the `else if (this.crouchAmount > 0.5 ...)` branch (line 527). Add this clause:

```js
    } else if (!params.grounded) {
      // Airborne arms — phase by vy.
      let armUpAir, armFwdAir;
      if (vy > 3) {
        const t = clamp((vy - 3) / 4, 0, 1);
        armUpAir = lerp(0.20, 0.55, t);
        armFwdAir = 0.20;
      } else if (vy >= -1) {
        const t = clamp((vy + 1) / 4, 0, 1);
        armUpAir = lerp(0.10, 0.20, t);
        armFwdAir = 0.35;
      } else {
        const t = clamp((-vy - 1) / 6, 0, 1);
        armUpAir = lerp(0.20, -0.10, t);
        armFwdAir = lerp(0.35, 0.45, t);
      }
      handRX = sRX + this.facing * armFwdAir;
      handRY = sRY + armUpAir;
    } else if (this.crouchAmount > 0.5 && params.armPoseR !== 'aim') {
```

The structure becomes: `if hold ... else if grab ... else if aim ... else if attack ... else if !grounded ... else if crouch ... else { walk-pump }`. Place the new airborne branch immediately before the crouch branch so crouch and walk are still selected when grounded.

- [ ] **Step 3: Add airborne arm override — left arm**

Same insertion in the left arm chain at lines 546-570. Before the `else if (this.crouchAmount > 0.5 ...)` (line 558) insert:

```js
    } else if (!params.grounded) {
      let armUpAir, armFwdAir;
      if (vy > 3) {
        const t = clamp((vy - 3) / 4, 0, 1);
        armUpAir = lerp(0.20, 0.55, t);
        armFwdAir = 0.20;
      } else if (vy >= -1) {
        const t = clamp((vy + 1) / 4, 0, 1);
        armUpAir = lerp(0.10, 0.20, t);
        armFwdAir = 0.35;
      } else {
        const t = clamp((-vy - 1) / 6, 0, 1);
        armUpAir = lerp(0.20, -0.10, t);
        armFwdAir = lerp(0.35, 0.45, t);
      }
      handLX = sLX + this.facing * armFwdAir;
      handLY = sLY + armUpAir;
    } else if (this.crouchAmount > 0.5 && params.armPoseL !== 'aim') {
```

(Both arms get the same Y offset and forward push relative to their own shoulder X. Spring chase smooths jitter.)

- [ ] **Step 4: Verify visually**

Reload preview. Pick "Jump" pose — synthetic params cycle vy from +6 (takeoff) → 0 (apex) → -6 (fall) → 0 (land). Watch:
- Takeoff (rising fast): arms swing UP overhead, legs trail under
- Apex (slow vertical): knees tucked, arms forward+high
- Fall (descending): feet reach forward+down, arms drop forward to brace
- Landing: existing squash + knee bend kicks in (no change here)

- [ ] **Step 5: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "feat(rig): jump phase poses - takeoff/apex/fall

Airborne pose was static (single tuck/no-tuck) and arms stayed
in walk pump. Replace with vy-driven phases:
  vy>3       takeoff: legs extending, arms swing up overhead
  vy in -1..3 apex:    knees tucked, arms forward+high
  vy<-1      fall:    legs reach forward to brace, arms drop
                      forward absorber pose
Smooth lerp across thresholds. Both L and R arms get matching
override branch ahead of crouch/walk in the pose if/else chain.
Existing landing squash + _landImpact untouched."
```

---

## Final verification

After all 9 tasks:

- [ ] **Run preview check**: All poses (idle / walk / run / aim / jump / ragdoll) read naturally in `http://localhost:57072/files/rig-preview.html`
- [ ] **Run game check**: `npm start`, play a bot match, verify
  - Idle stance reads relaxed (Task 3, 4)
  - Walk has alternating stride (Task 5)
  - Jump has takeoff/apex/fall arm+leg phases (Task 9)
  - Kill produces tumbling corpse with splayed limbs that settles in ~1.5s (Task 7, 8)
  - 3/4 camera tilt: L and R limbs visibly separate (Task 6)
  - No visible joint sphere bulges (Task 1)
  - Idle legs read straight, walk legs still bend during stride (Task 2)
- [ ] **Confirm no regressions**: Aim pose, attack swing, grab/hold, crouch, slide all still work — they bypass IK bend / arm idle branch / airborne branch via earlier branches in the if/else chain.
