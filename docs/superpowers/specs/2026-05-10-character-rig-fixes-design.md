# Character Rig — Stance & Animation Fixes

**Status:** Design approved 2026-05-10. Awaiting implementation plan.

## Goal

Fix 7 visible flaws in the procedural stickman rig that make stance, locomotion, and ragdoll read as broken or stiff. No aesthetic redesign — same geometry, same materials, same proportions. All changes are surgical.

Out of scope: shading style, hat rendering, accent color wiring, head facial features, character roster expansion.

## Picks (from brainstorm)

| Decision | Pick |
| --- | --- |
| Proportion change | None — keep current 1.5m capsule, head r=0.34, etc. |
| Material change | None — keep MeshStandardMaterial |
| Two-tone (accent color) | No |
| Front/3q view leg fix | Z-stagger (depth offset L/R, no full 3D IK) |
| Ragdoll fix path | Physics + rig (unlock rotation + splay limb targets) |
| Pre-jump anticipation | Skip (low value vs. plumbing cost) |

## Issues addressed

1. **Idle arms = chicken-wing.** Both elbows fly outward in idle/walk/run.
2. **Legs same direction in front/3q view.** All joints in single XY plane; both knees jut to same X side.
3. **Joint sphere bulges.** Spheres slightly bigger than limb radius — visible "ball" at every joint.
4. **Idle legs look bent.** Hip-foot diff 0.97m on 1.0m legs = 14° permanent knee bend.
5. **Walk = tiptoe shuffle.** Both feet plant FULL stride ahead of hip; nothing trails behind body.
6. **Jump pose static.** Single tuck/no-tuck airborne pose; arms stuck in walk pose; no takeoff/apex/fall phases.
7. **Ragdoll partial sag.** Hands/feet droop but torso stays upright; rotation unlock exists but no impulse, no limb splay.

## Architecture

All rig-side fixes live in `src/entities/StickmanRig.js`. Ragdoll fix #7 also touches `src/entities/Stickman.js` (angular impulse + linear damping).

No new modules. No API changes to rig consumer (Stickman, Bot, Net). No new params required for fixes 1–6; ragdoll fix uses existing `ragdollAmount`, `angVz` plus internal `bodyTilt`.

### Fix 1 — Arm IK bend → facing-based

In `_drawArm` ([StickmanRig.js:684](src/entities/StickmanRig.js:684)):

- Replace `bend = isRight ? 1 : -1` with `bend = this.facing >= 0 ? 1 : -1`.
- Both elbows now rotate forward-of-vertical in the +facing direction (matches leg IK convention already in use).
- Affects all arm poses that route through default IK: idle (`walk`), walk pump, run pump.
- Aim/attack/grab/hold poses already drive hand position directly via angle math; bend sign change is invisible to them.

In the idle branch of arm pose ([StickmanRig.js:530-543](src/entities/StickmanRig.js:530)):

- When `runBlend < 0.05` (truly idle, not transitioning into walk):
  - `armForward = 0` (hand directly below shoulder, no slouch lean)
  - `armUp = -0.55` (hand hangs near hip line)
- Smoothly blend back to existing run-pump targets as `runBlend` rises.

### Fix 2 — Z-stagger

Add `Z_STAGGER = 0.08` constant (rig-private).

Per side, compute z passed into draw calls:
- Left arm/leg meshes: `zL = hipZ - Z_STAGGER`
- Right arm/leg meshes: `zR = hipZ + Z_STAGGER`
- Head, torso, chestArmor: stay at `zC = hipZ`

Modify the rig `update()` block ([StickmanRig.js:650-653](src/entities/StickmanRig.js:650)):
- `_drawArm(sLX, sLY, ..., zL, ...)` for left
- `_drawArm(sRX, sRY, ..., zR, ...)` for right
- Same split for legs.

`_drawArm` and `_drawLeg` already accept `z` — just pass shifted value. All shoulder/elbow/hip/knee/hand/foot positions inside the function take `z` from arg, so the entire L side renders at `hipZ - 0.08`, R side at `hipZ + 0.08`.

Hip stance width (±0.16 in X) unchanged. Side view: limbs still appear stacked (small Z offset). 3q/front view: limbs visibly offset in depth, knees no longer collide visually.

### Fix 3 — Joint sphere shrink

In `StickmanRig` constructor ([StickmanRig.js:82-89](src/entities/StickmanRig.js:82)):

| Joint | Current radius | New radius | Adjacent limb radius |
| --- | --- | --- | --- |
| shoulderL/R | 0.115 | 0.10 | upperArm 0.10 |
| elbowL/R | 0.10 | 0.09 | lowerArm 0.09 |
| hipL/R | 0.13 | 0.13 | upperLeg 0.13 — unchanged |
| kneeL/R | 0.12 | 0.11 | lowerLeg 0.11 |

Hand (0.13) and foot (0.15) end-caps unchanged — they're deliberate silhouette anchors.

Result: spheres flush with cylinder ends; cover geometric corner gap without visible bulge.

### Fix 4 — Idle hip raise

In rig `update()` ([StickmanRig.js:283](src/entities/StickmanRig.js:283)):

Change baseline hipY:
```
const hipY = pos.y + 0.25 - bob - crouchDrop - landDrop + breathBob;
```
(was `pos.y + 0.22`)

Hip-foot diff at idle: `(pos.y + 0.25) - (pos.y - 0.75) = 1.00m` — equals leg max length (clamped to 0.99 by IK maxReach). Knees read essentially straight at idle.

`bob`, `crouchDrop`, `landDrop` still subtract → knees flex correctly during stride/crouch/land. Only the resting baseline changes.

### Fix 5 — Walk stride targets

In the run-cycle leg block ([StickmanRig.js:431-446](src/entities/StickmanRig.js:431)):

Replace:
```
const target = hipLX + this.facing * stride;
```
with:
```
const target = hipLX + this.facing * stride * 0.5;
```
(same change for right foot.)

Each foot now oscillates between `-stride/2` (behind hip) and `+stride/2` (ahead of hip). Body+phase math unchanged — cycle still covers `2 * stride` per full L+R, body still moves at speed determined by `_targetStride`.

Also update max-drag clamp ([StickmanRig.js:413](src/entities/StickmanRig.js:413)):
```
const maxDrag = stride * 0.8;
```
(was `0.55` constant.) Keeps clamp proportional to new target range.

### Fix 6 — Jump phase poses

Add `'air'` arm pose handling. In rig `update()`, when `!params.grounded` AND `armPoseR/L === 'walk'`, internally promote to `'air'` for that frame.

#### Airborne foot targets

Replace existing block ([StickmanRig.js:367-375](src/entities/StickmanRig.js:367)):

Compute phase from `vy`:
- `vy > 3` (takeoff): `liftN = lerp(0, 0.4, clamp((vy - 3) / 4, 0, 1))` — legs slightly trailing under hip
- `vy in [-1, 3]` (apex): `liftN = lerp(0.4, 0.55, ...)` — strong knee tuck
- `vy < -1` (fall): `liftN = lerp(0.55, 0.18, ...)` — legs reach forward/down for landing

Foot positions:
- Takeoff/apex: feet roughly under hip — `footLX = hipX - 0.16`, `footRX = hipX + 0.16`, `footY = baseFootY + liftN`
- Fall: feet forward — `footLX = hipX + facing * 0.10 - 0.10`, `footRX = hipX + facing * 0.10 + 0.10`, `footY = baseFootY + liftN`

Smooth interpolation across vy thresholds (no step function — use clamp/lerp).

#### Airborne arm targets

In arm idle/walk branch, add early return when `!grounded`:

- Takeoff (`vy > 3`): `handY = sY + lerp(0, 0.55, ...)`, `handX = sX + facing * 0.20`
- Apex (`vy in [-1, 3]`): `handY = sY + 0.20`, `handX = sX + facing * 0.35`
- Fall (`vy < -1`): `handY = sY + lerp(0.20, -0.10, ...)`, `handX = sX + facing * lerp(0.35, 0.45, ...)`

Both arms get same target (mirrored at L vs R shoulder by their `sLX`/`sRX`). Spring chase already smooths jitter. Existing landing squash + `_landImpact` knee bend stay.

### Fix 7 — Ragdoll full collapse

#### Stickman.js — angular impulse on ragdoll entry

At the existing `_enterRagdoll` (or equivalent — line ~290) where `fixedRotation` is set false:

```js
// Spin the body proportional to the kill hit, so it tumbles instead of slumping.
const hitDx = lastHit?.dirX ?? (Math.random() - 0.5);
const hitMag = clamp(lastHit?.magnitude ?? 1, 0.5, 2.5);
this.body.angularVelocity.z = sign(hitDx) * lerp(6, 14, (hitMag - 0.5) / 2);
this.body.linearDamping = 1.2; // settle faster
```

(Where `lastHit` is the damage event that triggered ragdoll. If unavailable, fall back to a random ±10 rad/s spin so body always tumbles.)

On revive ([Stickman.js:349](src/entities/Stickman.js:349)) reset `body.linearDamping = 0.12`.

#### StickmanRig.js — limb splay when fully ragdolled

In the existing `if (this.ragdollAmount > 0.5)` foot block ([StickmanRig.js:588-594](src/entities/StickmanRig.js:588)):

Compute perpendicular to torso axis in **local rig frame** (the rig itself does not need to know about body rotation — the group quaternion is set from `body.quaternion` at [Stickman.js:1232-1233](src/entities/Stickman.js:1232), so the entire rig rotates with the physics body in world space):

```
// Local-frame perpendicular to torso direction (sin(tilt), cos(tilt)).
const perpX =  Math.cos(this.bodyTilt);
const perpY = -Math.sin(this.bodyTilt);

const av = (params.angVz || 0) * 0.08; // amplified from 0.04
const ragAmt = this.ragdollAmount;

handLX = lerp(handLX, sLX - perpX * 0.6 + av,        ragAmt);
handLY = lerp(handLY, sLY - perpY * 0.6 - 0.10,      ragAmt);
handRX = lerp(handRX, sRX + perpX * 0.6 + av,        ragAmt);
handRY = lerp(handRY, sRY + perpY * 0.6 - 0.10,      ragAmt);

footLX = lerp(footLX, hipLX - perpX * 0.7 + av * 0.7, ragAmt);
footLY = lerp(footLY, hipLY - perpY * 0.7,            ragAmt);
footRX = lerp(footRX, hipRX + perpX * 0.7 + av * 0.7, ragAmt);
footRY = lerp(footRY, hipRY - perpY * 0.7,            ragAmt);
```

Limbs throw OUT to either side of the torso axis, with angular drift trailing. When `bodyTilt ≈ 0` (still relative to body), limbs splay laterally (±X). Group quaternion rotates the whole splayed pose into world space as the physics body tumbles.

The existing partial-ragdoll branch (`totalRag > 0.02 && < 0.5`, idle droop / dazed flail) keeps the previous gentle hand sag — only the full-collapse branch is rewritten.

## Testing

No automated tests for rig — purely visual. Manual verification per fix:

| Fix | What to check |
| --- | --- |
| 1 | Idle stance: hands hang at sides, no chicken wings. Walk: arms swing in line with body, elbows trail behind hand. |
| 2 | 3q camera angle: visible separation between L and R limbs. Side view: no visible change. |
| 3 | Inspect any joint at zoom: cylinder ends meet sphere flush, no bulge. |
| 4 | Idle: legs read straight. Walk: knees still bend visibly during stride. |
| 5 | Walk: at any frozen frame, one foot ahead of hip and one behind. Body moves smoothly forward. |
| 6 | Jump up: arms swing up overhead. At apex: knees tucked. Falling: feet reach forward. Landing: existing squash. |
| 7 | Kill a player: body tumbles (rotates noticeably), limbs splay outward, settles flat instead of slumping upright. |

## Risk

- **Z-stagger (Fix 2)** could shift hand/weapon attachment points. Weapon parenting in `Weapon.js` uses `handR.position` — that already returns world position from the mesh, so 0.08m Z shift is automatic. Minor: weapon swing arc tilts ~0.08m off-plane. Acceptable; matches the slight 3D feel.
- **Ragdoll angular impulse (Fix 7)** depends on knowing hit direction. If hit metadata isn't always available, fallback random spin always applies — no NaN risk.
- **Walk stride halving (Fix 5)** changes foot-plant world positions. Spring chase on feet retargets without snap. No physics interaction (feet are visual-only). No risk to plant timing.
- All other fixes are local visual changes with no cross-system impact.
