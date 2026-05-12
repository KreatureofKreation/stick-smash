# Rig collision + Stick Fight feel — design

**Date:** 2026-05-12
**Status:** Approved (pending file review)
**Scope:** Two PRs, ship in order. Sub-A first (rig segment sweeps), then Sub-B (force features).
**Future:** Sub-C (full force-animated ragdoll with constraint joints) deferred. Not in this spec.

## Problem

1. Rig parts (hands, feet, head, elbows, knees, limb segments) clip through walls and floors today. Only the body capsule (`BODY_RADIUS = 0.32`, `BODY_HEIGHT = 1.5`) collides with world geometry. Rig meshes are visual-only, positioned each frame via pose math in `_drawArm` / `_drawLeg` / `_syncRig` in [src/entities/StickmanRig.js](../../../src/entities/StickmanRig.js). Extended aim arm (0.85m reach), big lunges, and somersault poses regularly poke limbs through tiles.
2. Combat lacks the chaotic, recoil-driven movement feel of Stick Fight: The Game. Punches don't shove. Throws don't rocket. Firearm recoil doesn't reposition the shooter. Weapons drop as inert visual props, not walkable surfaces. Knockback from damage is minimal or absent.

Full ragdoll architecture (replace single capsule with multi-body constraint chain + PD-driven force animations) is the long-term answer but takes months. This spec ships a layered approximation in two PRs.

## Goals

- Sub-A: rig limbs and head visually respect walls and floors. No more pokes through tiles.
- Sub-B: combat reads as kinetic. Recoil, throw, punch, hit-knockback, and standable weapons all functional and tunable per weapon.
- Both ship without rewriting the rig or physics body architecture. Sub-C remains a clean future option.

## Non-goals

- Multi-body rigid-body rig with constraint joints. Deferred.
- Force animations (target joint angles driven by torques). Deferred.
- Standing on other players. Requires per-body colliders. Deferred.
- Replacing existing pose driver / IK system. Deferred.

## Sub-A — Rig segment sweeps

### Approach (decided: cartoon-squish, full segment sweep)

For each rig limb draw call, sweep the segment against world geometry. On hit, clamp the endpoint short of the wall. Existing IK solver auto-folds the limb (elbow/knee pops out to fit the shorter reach).

### Mechanism

Per limb per frame:

1. Compute shoulder → clamped-hand segment (existing `maxReach` clamp runs first as today).
2. Raycast `physics.raycast(shoulder, hand, { mask: COL_GROUPS.WORLD })`.
3. On hit at distance `t`, set endpoint to hit point pulled back along the ray by `LIMB_PAD = 0.06m` (so the cylinder limb mesh doesn't visually poke into the wall).
4. Re-solve IK with the clamped endpoint. Elbow auto-bends tighter.

Legs use the same pattern (hip → foot).

Head uses a separate downward raycast (head position → head position − 0.3m, mask=WORLD). On floor hit, snap head Y to hit + head radius + pad.

### Back-ray fallback

If forward ray (shoulder → hand) misses but the hand is already inside a wall (penetration from prior frame), run a back-ray (hand → shoulder). If that hits, the hand was inside; use the hit point + LIMB_PAD as the clamped endpoint. If both miss and depth-test still shows penetration, clamp endpoint to body-capsule edge as last resort.

### 2.5D Z handling

Rig draws at z ∈ {−0.08, +0.08} (Z_STAGGER for left/right body parts). World colliders sit at z = 0. Query raycasts at z = 0 (project shoulder.z and hand.z to 0 for the query). Keep the original z for rendering after the clamp is applied.

### Performance

5 rays per stickman per frame (4 limbs + head). 4 stickmen = 20 rays/frame. Rapier handles thousands. No expected cost.

### Files touched

- [src/entities/StickmanRig.js](../../../src/entities/StickmanRig.js) — `_drawArm`, `_drawLeg`, `_syncRig` (head segment).
- [src/util/__weaponDebug.js](../../../src/util/__weaponDebug.js) — new harness tests.

### Tests (Sub-A)

- `__test_rigClipsWallStanding` — place stickman next to wall, force aim arm extended into wall, assert clamped hand X stays on near side of wall.
- `__test_rigClipsFloorOnLunge` — trigger big lunge pose (somersault recovery), assert clamped head Y stays above floor.

Manual: live preview, walk into wall and swing each weapon in `SPAWN_TABLE`. Visual check no clipping.

## Sub-B — Shared impulse plumbing

Five features (§3.x) share one helper. Build the helper first, then layer features.

### New method on Stickman

`Stickman.applyImpulse(vx, vy, opts = {})`

- Writes `body.velocity.x += vx; body.velocity.y += vy` (cannon-shim allows velocity writes).
- `opts.cap = 18` — clamps `Math.hypot(vx, vy)` before applying. Prevents single-call explosion.
- `opts.respectAirborne = false` — default false. Always applies regardless of grounded state (per Stick-Fight-style movement tech, Q5-A).
- `opts.stunMs = 0` — sets `this._impulseStunUntil = now + stunMs`. While active, player input authority is multiplied by 0.3 (input damped, not removed).

### Per-frame impulse budget

To prevent multi-hit chains (minigun, dual pistols, multi-pellet shotgun) from teleporting the shooter:

- `Stickman._impulseFrameBudget` resets to 0 at start of each `update()` tick.
- Each `applyImpulse` call increments budget by `Math.hypot(vx, vy)`.
- If budget > `IMPULSE_FRAME_CAP = 26`, scale (vx, vy) so the remaining budget exactly hits the cap, then ignore further calls this frame.

### Per-weapon tuning fields

Default 0 on `Weapon` base class. Overrides set per weapon in [src/weapons/weapons.js](../../../src/weapons/weapons.js) constructors.

- `recoilImpulse` — magnitude on firearm fire (opposite aim).
- `throwImpulse` — magnitude on weapon throw (opposite throw dir).
- `meleeRecoilImpulse` — magnitude on melee attack release (opposite strike dir).
- `hitKnockback = 1.0` — multiplier on damage→impulse for the victim.

Starting magnitudes (Stick-Fight cartoony, tunable later):

| Weapon class    | recoil | throw | melee | knockback |
|-----------------|--------|-------|-------|-----------|
| Fists           | —      | —     | 4     | 0.8       |
| Light melee     | —      | 4     | 5     | 1.0       |
| Heavy melee     | —      | 6     | 9     | 1.6       |
| Pistol          | 2      | 4     | —     | 1.0       |
| SMG             | 1.2    | 4     | —     | 0.8       |
| Assault Rifle   | 3      | 4     | —     | 1.1       |
| Shotgun         | 14     | 5     | —     | 2.0       |
| Sniper          | 8      | 5     | —     | 2.4       |
| Minigun         | 0.8/pellet | 6 | —    | 0.9       |
| Revolver        | 5      | 4     | —     | 1.4       |
| Crossbow        | 3      | 4     | —     | 1.1       |
| Flamethrower    | 0.4    | 4     | —     | 0.4       |
| Dual Pistols    | 2/shot | 3     | —     | 1.0       |
| Shurikens (throw) | —    | 2     | —     | 0.5       |
| RPG             | 18     | 12    | —     | 3.0       |

Numbers are intentionally cartoony for first pass. Per-feature `window.__forceFeatures` toggle gates each feature class so we can A/B during tuning.

## Sub-B — Five features

### 3.1 Punch-boost

- Hook in `Stickman` melee attack-release path (where existing melee damage applies).
- On release, read `weapon.meleeRecoilImpulse`.
- Direction: `-aimDir` (opposite strike).
- Call `applyImpulse(-dirX * mag, -dirY * mag * 0.6)`. Y scaled 0.6 so down-punch doesn't catapult straight up.

### 3.2 Throw-boost

- Hook in weapon-throw release path (where thrown weapon is spawned into world via `dropAt` for thrown state).
- On throw, read `weapon.throwImpulse`.
- Direction: opposite throw direction.
- Call `applyImpulse(-throwDirX * mag, -throwDirY * mag)`.

### 3.3 Recoil-jump

- Hook in firearm fire path (after `Projectile` spawn; specific location: `Weapon.fire` or per-weapon override that already calls projectile spawn).
- On fire, read `weapon.recoilImpulse`.
- Direction: opposite `effectiveAimDir` (use wall-reoriented dir so recoil matches actual fire direction).
- Call `applyImpulse(-aimDirX * mag, -aimDirY * mag)`. No Y damping (full Y; recoil-jump straight down → straight up is the point).
- Per-pellet weapons (shotgun, minigun) apply per-pellet recoil; frame budget protects against runaway accumulation.

### 3.4 Standable weapons

- Dropped weapon physics bodies already exist (per `dropAt` / `spawnAt`).
- Audit current weapon collider shape: ensure flat-top box collider sized to weapon mesh, with Y-extent ≤ 0.08m so player walking INTO weapon side rolls capsule over it instead of stalling.
- Add `COL_GROUPS.PROP` to player capsule's collision mask (verify it's already present; add if not).
- Confirm projectiles still ignore PROP (bullets shouldn't be blocked by dropped weapons).

### 3.5 Hit-reaction force

- Hook in `Stickman.takeDamage(amount, hitDir, attacker)` (or the existing damage entry point; confirm exact name at implementation time).
- Read attacker weapon's `hitKnockback`.
- Compute `mag = damage * hitKnockback * KNOCKBACK_SCALE` where `KNOCKBACK_SCALE = 0.6`.
- Direction: `hitDir` (away from attacker).
- Call `victim.applyImpulse(hitDirX * mag, hitDirY * mag * 0.4 + 2, { stunMs: 120 })`. Y component dampened + small upward kick (Stick Fight uppercut signature).
- 120ms input damping (not lockout) — player can still influence trajectory but feels the hit.
- Check for double-stun with any existing hitstun. If existing hitstun overlaps, the longer one wins (no stacking).

## Verification

Per-memory: browser-only (no test framework). Use `window.__weaponTest` harness + manual preview.

Harness tests added in [src/util/__weaponDebug.js](../../../src/util/__weaponDebug.js):

- `__test_rigClipsWallStanding`
- `__test_rigClipsFloorOnLunge`
- `__test_punchBoostImpulse`
- `__test_recoilJump`
- `__test_standableWeapon`
- `__test_hitReactionKnockback`

Manual playtest after each PR:

- Sub-A: walk into walls with every weapon, swing, verify no clipping. Trigger somersault, dive, rising knee — verify head stays above floor.
- Sub-B: per-feature toggle off → verify base behavior unchanged. Toggle on → verify each effect.

Performance: instrument via `window.__perf` per memory `feedback_perf_workflow.md` before declaring done. Watch for frame-time regression with 4 stickmen + minigun spam + multiple dropped weapons.

## Risks

1. **Back-ray fallback insufficient.** Hand spawned inside wall, both rays miss. Mitigation: clamp endpoint to body-capsule edge as last resort.
2. **Impulse chains.** Multi-shot weapons. Mitigation: per-call cap (`opts.cap = 18`) + per-frame budget (`IMPULSE_FRAME_CAP = 26`).
3. **Standable weapons blocking horizontal movement.** Mitigation: low Y-extent collider, capsule rolls over.
4. **Double-stun with existing hitstun.** Need to audit existing damage path at implementation time. If overlap exists, longer wins.
5. **Performance.** Cheap individually, chain caps in §plumbing. Verify via `window.__perf`.

## File-touch summary

**Sub-A PR:**
- `src/entities/StickmanRig.js`
- `src/util/__weaponDebug.js`

**Sub-B PR:**
- `src/entities/Stickman.js` (applyImpulse + stun field + frame budget)
- `src/weapons/Weapon.js` (default impulse fields)
- `src/weapons/weapons.js` (per-weapon overrides + standable collider)
- `src/util/__weaponDebug.js` (4 new tests)
- `src/weapons/Projectile.js` (possibly: recoil hook timing)

## Out of scope (Sub-C, future)

- Multi-body rigid-body rig (head, torso, 4 upper segments, 4 lower segments, 2 hands, 2 feet ≈ 12 bodies per stickman).
- Constraint joints (revolute/spherical) between adjacent bodies.
- PD-controllers applying torques to drive target joint angles (force animation).
- Standing on other players (requires per-body PLAYER colliders).
- Hitboxes attached to individual rig bodies instead of single capsule.

Sub-C remains the eventual goal. Sub-A + Sub-B buy time and ship visible improvement now without the rewrite risk.
