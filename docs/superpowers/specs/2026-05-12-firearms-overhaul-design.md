# Firearms Overhaul + 6 New Weapons — Design

**Date:** 2026-05-12
**Branch:** `claude/strange-chaum-8086fd`
**Status:** approved, pending implementation plan

---

## Goal

Fix the existing firearm roster (pose accuracy, minigun fire mode, sniper red-dot origin, bow orientation, headshot registration, weapon-vs-wall clipping) and expand the roster with six new weapons that fill clearly distinct combat niches. All work must respect the project's high-performance, ragdoll-driven, no-build-step constraints.

## Non-Goals (YAGNI)

- Reload animations beyond what existing mesh animation supports
- Iron-sights / scope zoom (sniper red-dot stays as a red-line + dot post-fix)
- Weapon-switching UX changes
- Audio (no audio system exists in repo)
- Backward compatibility for the deleted Bow class

---

## Part 1 — Bug Fixes (Existing Weapons)

### 1.1 Pose Audit

**File:** `src/render/Stickman.js` (pose driver around lines 1788-1801)

Confirm and correct flags on every existing firearm:

| Weapon       | poseRight | poseLeft   | Notes                              |
|--------------|-----------|------------|------------------------------------|
| Pistol       | `'aim'`   | `null`     | 1H                                 |
| Revolver     | `'aim'`   | `null`     | 1H (new)                           |
| Shotgun      | `'aim'`   | `'support'`| 2H                                 |
| SMG          | `'aim'`   | `'support'`| 2H (new)                           |
| Assault Rifle| `'aim'`   | `'support'`| 2H (new)                           |
| Sniper Rifle | `'aim'`   | `'support'`| 2H                                 |
| Minigun      | `'aim'`   | `'support'`| 2H, support hand on barrel housing |
| RPG          | `'aim'`   | `'support'`| 2H shoulder mount                  |
| Crossbow     | `'aim'`   | `'support'`| 2H (new, replaces Bow)             |
| Flamethrower | `'aim'`   | `'support'`| 2H (new)                           |
| Dual Pistols | `'aim'`   | `'aim'`    | New `poseDual` branch — both arms aim same target |

Bow is removed from `WEAPON_CLASSES` and the class deleted.

### 1.2 Minigun Auto-Fire + Spin-Up

**File:** `src/weapons/weapons.js` (Minigun class, ~lines 447-477)

Replace one-shot-per-click behavior:

- On `attack` press: enter `spinningUp` state, `spinTimer` ramps 0 → 0.3s. Barrel mesh rotates at increasing rate during ramp.
- When `spinTimer >= 0.3`: enter `firing` state. Each tick at `fireDelay = 0.05s` calls `fire()` while `attack` held.
- On `attack` release: enter `spinningDown` state for 0.5s, barrel rate decays to 0. No more shots.
- Per shot: existing recoil (cam punch 0.04, velocity kick 0.15 grounded / 0.45 air) preserved.
- On `_lowQ`: skip barrel-rotation animation (state still tracked, just no visible spin).

`tryFire()` is replaced with state-machine update called from the player's per-tick weapon update.

### 1.3 Sniper Red-Dot Origin

**File:** `src/weapons/weapons.js` (`SniperRifle._muzzleWorld`, ~lines 675-684)

Current: `{ x: pos.x + facing*0.4, y: pos.y + 0.55 }` (shoulder height).

New: anchor to under-the-barrel position.
- `y` lowered to `pos.y + 0.45`.
- `x` extended to `pos.x + facing * 0.55` (barrel tip).

Both the laser line render and the raycast in `_castShot` consume this same origin so the visible dot matches the actual hit ray.

### 1.4 Projectile Head/Body Capsule Raycast

**File:** `src/weapons/Projectile.js` (~lines 84-97)

Current: physics body collision treats the player as a single sphere; shots can pass through the head silhouette without registering.

Replacement (additive, replaces sphere-only path for player hits):
- Each tick, perform a swept segment from the projectile's previous position to its current position.
- Test the segment against two capsules per nearby player:
  - **Head capsule:** `y` from 1.0 to 1.3, radius 0.18.
  - **Body capsule:** `y` from 0.4 to 1.0, radius 0.32.
- Head hit: 2× damage multiplier, set `hit.isHead = true`, trigger ragdoll head-snap (existing ragdoll system, set head joint impulse).
- Body hit: standard damage.
- If both hit on the same swept segment, head wins (closer to entry).
- Limb hits (arms/legs) deferred — out of scope.

This system supersedes the current `Projectile` collision body for player intersection. Wall/world collision continues to use the existing physics body so geometry hits behave unchanged.

### 1.5 Weapon-vs-Wall Reorientation

**File:** `src/weapons/Weapon.js` (`updateMesh()`, ~lines 86-145)

Held weapons currently clip through walls. Replace with "path of least resistance" reorientation:

- Each frame, after the pose system sets the weapon's nominal aim direction, cast one ray from the player's `handR` along the aim direction, length = weapon's mesh length.
- If the ray hits world geometry:
  - Read the wall normal at the hit.
  - Compute the tangent along the wall closest to the player's input aim sign (if user aims slightly up vs the wall, the gun pivots up and lies along the wall pointing up; slightly down, the opposite).
  - Rotate the weapon's local aim to that tangent. Weapon mesh stays full length; never hidden, never shortened.
  - Update `weapon.aimAdjusted = true` and store the new effective aim direction; shot origin is the new muzzle position.
- Bullets cannot spawn inside walls because the muzzle is always outside.
- Cost: one raycast per held weapon per frame.

### 1.6 Bow Removal

**File:** `src/weapons/weapons.js`

- Delete the `Bow` class entirely.
- Remove `Bow` from the `WEAPON_CLASSES` array.
- No backwards-compat shim. Crossbow takes its niche.

---

## Part 2 — New Weapons

All new classes live in `src/weapons/weapons.js` appended to existing pattern. All are added to `WEAPON_CLASSES`.

### 2.1 SMG

| Property      | Value                                   |
|---------------|-----------------------------------------|
| Pose          | 2H (right aim, left support on handguard)|
| Fire mode     | Full-auto                               |
| `fireDelay`   | 0.06s                                   |
| Damage        | ~6/shot                                 |
| Spread        | ~4° hip cone                            |
| Recoil        | Cam punch 0.025/shot, no velocity kick  |
| Ammo          | 60                                      |
| Mesh          | Short box receiver + stubby barrel + curved magazine below |

### 2.2 Assault Rifle

| Property      | Value                                   |
|---------------|-----------------------------------------|
| Pose          | 2H                                      |
| Fire mode     | 3-round burst only                      |
| Burst interval| 0.05s between shots in burst            |
| Burst cooldown| 0.4s between bursts                     |
| Damage        | ~12/shot, ~36/burst                     |
| Spread        | ~2°, tightens shot 1→3 within a burst   |
| Recoil        | Cam punch 0.06 first shot, 0.04 + 0.04 follow-ups |
| Ammo          | 30                                      |
| Mesh          | Rifle receiver + long barrel + stock + scope rail (cosmetic only) |

### 2.3 Revolver

| Property      | Value                                   |
|---------------|-----------------------------------------|
| Pose          | 1H                                      |
| Fire mode     | Single, `fireDelay = 0.5s`              |
| Damage        | 35 body / 70 head                       |
| Spread        | 0 (precision)                           |
| Recoil        | Cam punch 0.18, velocity kick -0.25 grounded / -0.5 air |
| Ammo          | 6 (signature low count)                 |
| Mesh          | Visible 6-chamber cylinder + exposed hammer; hammer cocks per shot anim |

### 2.4 Crossbow (replaces Bow)

| Property      | Value                                   |
|---------------|-----------------------------------------|
| Pose          | 2H                                      |
| Fire mode     | Single, `fireDelay = 0.9s`              |
| Bolt velocity | 1.6× old arrow                          |
| Gravity factor| 0.5× of old arrow (flatter arc)         |
| Damage        | 28 body / 56 head                       |
| Sticking      | Bolt sticks in ragdoll/wall on hit. Implementation: reuse the existing arrow-stick mechanism in `Projectile.js` if present; if not, the bolt freezes its physics body at impact and parents to the hit target's transform for 3s before despawn. Resolved during PR-D scoping. |
| Ammo          | 8                                       |
| Mesh          | Horizontal limbs (NOT vertical), stock, string drawn back when ready, slack when fired |
| Bolt mesh     | Short cylinder shaft + cone tip + small fletching; `_orientToVel = true` |

### 2.5 Flamethrower

| Property      | Value                                   |
|---------------|-----------------------------------------|
| Pose          | 2H                                      |
| Fire mode     | Cone hitscan while attack held          |
| Range         | 5m                                      |
| Cone          | 25° arc                                 |
| Tick          | 30Hz                                    |
| Player damage | Ignites enemy on cone-hit; lingering DoT 3s @ 3 dmg/s after exit |
| World fire    | On tick, sample 3 points across cone end-arc. If point within 0.3m of walkable surface and no patch within 0.5m exists, spawn FirePatch (1.2s lifetime, ignites players touching it). Spread: each active patch has 25% chance per second to spawn one neighbor patch within 1.0m on a walkable surface. Global 16-cap means spread is naturally bounded — old patches evict before fire grows unbounded. |
| Patch cap     | Hard cap 16 patches global; oldest evicted |
| Ammo          | 100 fuel units, 1 per tick = ~3.3s sustained |
| Recoil        | Continuous low cam shake, no velocity kick |
| Visual        | Cheap 2-layer quad-sprite cone with animated UV (NOT particles). Burning patches = tiny billboard quads with flicker. On `_lowQ`: flat-color disc instead of sprite. |

New file: `src/weapons/fx/FirePatch.js` — small class managing a single ground patch (position, lifetime, owner, tick). Module-level array enforces the 16-cap with FIFO eviction.

### 2.6 Dual Pistols

| Property      | Value                                   |
|---------------|-----------------------------------------|
| Pose          | New `poseDual='aim'` flag — both arms drive to aim direction (left mirrored) |
| Fire mode     | Alternating L/R per click; state `_nextHand` toggles |
| `fireDelay`   | 0.18s (faster than single pistol because two guns) |
| Damage        | ~12/shot                                |
| Spread        | 1° aim, 3° hip                          |
| Recoil        | Cam punch 0.07; firing arm animates recoil kick up + settle |
| Ammo          | 24 (12 per gun visually)                |
| Mesh          | Two pistol meshes, one per hand; both render always |

Pose system change: `Stickman.js` pose branch detects `weapon.poseDual` and drives `handL` IK target to the mirrored aim direction (same target world-point, but left arm reaches with shoulder offset). `StickmanRig.js` left-hand IK chain is already present; this wiring extends it from "support grip" mode to "independent aim" mode.

---

## Part 3 — Architecture Decisions

### File Layout

| File                                    | Change                                    |
|-----------------------------------------|-------------------------------------------|
| `src/weapons/weapons.js`                | Append 6 new classes, update `WEAPON_CLASSES`, delete Bow |
| `src/weapons/Weapon.js`                 | Wall-reorient logic in `updateMesh()`     |
| `src/weapons/Projectile.js`             | Per-tick capsule raycast for player hits  |
| `src/render/Stickman.js`                | `poseDual` branch in pose system          |
| `src/render/StickmanRig.js`             | Wire left-hand IK target for dual-aim mode|
| `src/weapons/fx/FirePatch.js`           | NEW — ground fire patch with global cap   |

### Boundaries

- `Weapon.js` owns held-weapon mesh placement (including new wall-reorient).
- `Projectile.js` owns hit detection (including new capsule raycast).
- `Stickman.js` owns pose flag interpretation.
- `weapons.js` defines weapon classes — stat sheets, fire logic, projectile spawning, mesh construction.
- `FirePatch.js` owns the world-fire lifecycle and the 16-cap.

This keeps each new weapon's diff confined to its own class block in `weapons.js` plus the shared infrastructure files.

### Performance Budget (per `_lowQ` tier)

| Cost                              | Per frame                     |
|-----------------------------------|-------------------------------|
| Wall raycast (held weapons)       | 1 ray × held-weapon count     |
| Projectile capsule test           | 2 capsules × active projectile|
| Flame cone test                   | 1 point-in-arc per player while flame held |
| Fire patches                      | ≤16, sprites only on `!_lowQ` |
| Minigun barrel rotation           | scalar update; mesh anim skipped on `_lowQ` |

Within current frame budget. No new render passes.

---

## Part 4 — Verification

Per project memory: browser-only verification, `preview_eval` + `getBoundingClientRect`, no `preview_screenshot` (it times out).

Verification toggle: `window.__weaponDebug = true` enables per-frame console logs from weapon code paths.

| Check                                                    | Method                                                      |
|----------------------------------------------------------|-------------------------------------------------------------|
| Pose flags correct per weapon                            | Spawn each, `preview_eval` reads `player.weapon.poseRight/Left/Dual` |
| Minigun spins up before firing                           | Force-press attack, log `spinTimer` ramp + first-shot delay |
| Sniper red-dot origin matches barrel                     | Log `_muzzleWorld()` output, compare to mesh barrel-tip pos |
| Headshot registers + 2× damage                           | Spawn dummy, fire, assert hit log `head=true` and `dmg=baseDmg*2` |
| Wall reorient prevents clip                              | Walk player into wall holding rifle, log `weapon.aimAdjusted` + assert muzzle pos not inside wall AABB |
| Flame ignites + DoT lingers                              | Cone-hit dummy, log burn ticks for 3s after exit            |
| Fire-patch cap holds                                     | Sustain flame on flat surface, assert patch count ≤ 16      |
| Dual pistols alternate L/R                               | Fire 6 shots, log `_nextHand` sequence                      |
| Crossbow flat arc                                        | Fire at distance, log bolt y-drop vs old arrow              |

---

## Part 5 — Implementation Order (Ship in 4 PRs)

1. **PR-A — Hit + Clip Foundations:** Projectile capsule raycast + Weapon wall-reorient. Blocking for everything else; ship and verify ragdoll head-snap and wall slide before adding new weapons.
2. **PR-B — Existing Weapon Fixes:** Pose audit, Minigun spin-up + auto-fire, Sniper red-dot reposition, Bow deletion.
3. **PR-C — New Weapons Batch 1:** SMG, Assault Rifle, Revolver. All reuse existing 1H/2H pose + standard projectile pipeline. Lowest-risk.
4. **PR-D — New Weapons Batch 2:** Crossbow (flat-arc projectile), Flamethrower (cone hitscan + FirePatch + 16-cap), Dual Pistols (`poseDual` rig flag).

Each PR follows the project's standard push + PR + squash-merge flow per memory.
