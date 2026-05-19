# Space Level — Magnetic Gravity Redesign

**Status:** Design approved 2026-05-19. Awaiting implementation plan.

Supersedes the realistic-gravity section of `2026-05-10-space-planet-redesign-design.md`. Everything else from that spec (planet geometry, wedges, core, camera, kill bound, background, meteors timer-gate) stands.

## Problem

The shipped planet level uses inverse-linear gravity (`a = G * mass / r`) on players. In practice players, once moving, build tangential velocity faster than gravity can recapture. They slingshot out of the system, die at the kill-bound, respawn, and slingshot again — the level is unplayable.

## Goal

Multiple planets with gravity-bent projectiles, but no physics-driven slingshots for players. Players walk on planet surfaces magnetically. Projectiles still curve through gravity zones for spectacle.

## Approach

Split into two systems with different rules:

| Body type | Gravity model |
| --- | --- |
| Players | Magnetic snap to nearest planet, scripted state machine (`walking` / `jumping` / `launched` / `returning`). No physics force. |
| Projectiles, meteors, ragdolls, crates | Constant-pull halo zones. Multiple halos sum. Real physics force. |

## Player Movement (Magnetic State Machine)

Per-player state:
- `mode`: `'walking'` | `'jumping'` | `'launched'` | `'returning'`
- `currentPlanet`: ref to nearest planet (recomputed each tick when not in `launched`)
- `launchTimer`: seconds remaining in `launched` mode

Player physics body runs with `gravity = (0,0,0)`. All movement = direct velocity writes from the level's per-tick movement code. No `force.add` calls on player bodies.

### walking

- Pick nearest planet by `dist(pos, planet.center)` (no halo gating — every player belongs to some planet).
- `up = normalize(pos - planet.center)`. `tangent = (-up.y, up.x)`.
- Hard snap radial: `pos = planet.center + up * (planet.radius + capsuleRadius)`.
- Velocity radial component killed; tangential preserved.
- Input: `velocity_tangent = lerp(current, moveX * speedMax, accel * dt)`. Apply along `tangent`.
- Body quaternion slerp to align local +y with `up` at `ROT_SLERP_RATE = 12` rad/s.
- Jump input → transition to `jumping`, `velocity += up * jumpSpeed`.

### jumping

- No radial snap.
- Each tick apply scripted "down": `velocity += -up * JUMP_DOWN_ACCEL * dt` where `up = normalize(pos - currentPlanet.center)`.
- `currentPlanet` stays sticky during a jump (no re-pick) so you don't get yanked sideways mid-arc.
- Transition back to `walking` when: radial velocity ≤ 0 AND `dist <= planet.radius + capsuleRadius + 0.2`.

### launched

- Trigger: `applyKnockback(kb)` with `|kb| > LAUNCH_MIN_KB = 6`. Set `launchTimer = clamp(|kb| * 0.04, 0.3, 1.2)`.
- Velocity unchanged from the knockback impulse.
- Each tick: `velocity *= LAUNCH_DRAG = 0.98`. No scripted down, no halo force.
- `currentPlanet` cleared.
- When timer hits 0 → transition to `returning`.

Small knockbacks (`|kb| ≤ 6`) absorb into walking — tangential bump only, no state change.

### returning

- Pick nearest planet by distance. Set as `currentPlanet`.
- Each tick: `velocity += normalize(currentPlanet.center - pos) * RETURN_ACCEL * dt`.
- Cap velocity magnitude at `RETURN_VEL_CAP = 25`.
- When `dist < currentPlanet.haloRadius` → transition to `jumping` so they fall + land naturally on the surface.

### Kill bound

Existing rule: `|x| > 50 || |y| > 35` → instant KO. Unchanged from prior spec. Big launches still respect it but rarely reach it given the return state recapture.

## Projectile Gravity (Constant-Pull Halo Sum)

Per-planet field: `pullStrength` (m/s², default `PROJECTILE_PULL_DEFAULT = 15`).

Each preStep, for every projectile body + meteor + crate + ragdoll body (any dynamic non-player body):

```
F = 0
for each planet:
  r = dist(body, planet.center)
  if r >= planet.haloRadius: continue
  // Linear taper over last 10% of halo radius.
  t = (r / planet.haloRadius)
  k = (t > 0.9) ? (1 - (t - 0.9) / 0.1) : 1.0
  F += body.mass * planet.pullStrength * k * normalize(planet.center - body.pos)
body.force += F
```

Notes:
- Flat magnitude inside the halo (with edge taper). No `1/r` spike near surface that would yank fast bullets sideways into the ground.
- Multiple halo overlap = sum of constants. Reads as "this region pulls harder."
- Debris / ragdolls use the same path with a `pullMul = 0.5` so they settle rather than orbit. Crates same.

Sleep: bodies with speed < 0.3 for 1s sleep via Cannon's built-in sleep. Force calc skips sleeping bodies. Keeps idle debris cheap.

## Files Touched

- `src/levels/space/PlanetGravity.js` — full rewrite.
  - Export `makeProjectileGravity(level)` — preStep callback. Applies the constant-pull halo sum above to non-player dynamic bodies.
  - Drop old `makePlanetGravity`, `STICK_BONUS`, `G` constant.
- `src/entities/Stickman.js`
  - Add `_moveCurvedMagnetic(dt)` branch, gated by `level.curvedGravity = true`.
  - Implements the `walking` / `jumping` / `launched` / `returning` state machine above.
  - Existing flat `_move` untouched for other levels.
  - `applyKnockback(kb)` checks `|kb|` and sets `mode = 'launched'` + `launchTimer` when over threshold.
- `src/levels/space/Planet.js`
  - Add `pullStrength` config field (default 15).
  - Keep `mass` field for backwards compat but mark unused.
- `src/levels/definitions.js`
  - Space level: set `pullStrength` per planet. Anchors ~18, small moons ~10.
- `src/levels/Level.js`
  - On enter: set every player body's `gravity` override to `(0,0,0)`.
  - Register `makeProjectileGravity` preStep instead of the old `makePlanetGravity`.
  - On exit: restore player body gravity.
- `src/levels/space/MeteorShower.js` — no logic change. Meteor bodies are just projectiles to the new system.

No change in `src/physics/PhysicsWorld.js`. Z-lock + angular clamps already in place.

## Tuning Constants

Defined at the top of `src/levels/space/PlanetGravity.js`:

| Name | Value | Used for |
| --- | --- | --- |
| `PROJECTILE_PULL_DEFAULT` | 15 m/s² | Per-planet halo pull when planet config omits it |
| `JUMP_DOWN_ACCEL` | 30 m/s² | Scripted "down" during a player jump |
| `RETURN_ACCEL` | 40 m/s² | Pull during `returning` mode |
| `RETURN_VEL_CAP` | 25 m/s | Speed cap during `returning` mode |
| `LAUNCH_MIN_KB` | 6 m/s | Knockback magnitude threshold to enter `launched` |
| `LAUNCH_DRAG` | 0.98 | Per-tick velocity multiplier during `launched` |
| `ROT_SLERP_RATE` | 12 rad/s | Body quaternion align rate to local up |

All exposed on `window.__planet` for in-browser tuning at runtime.

## Multiplayer

- Host runs all gravity + magnetic snap + state machine. Players send inputs.
- Snapshot already carries player position + quaternion (added in #61 / Stick Fight). No new fields needed.
- Knockback `mode` is derived from velocity magnitude clientside if needed for VFX. State machine itself is host-authoritative — clients just interpolate position.

## Acceptance Criteria

A playtester on the Space level:

1. Lands on a planet, body rotates feet-down, walks all the way around it in ~3s.
2. Jumps straight up — comes straight back down, doesn't drift.
3. Jumps off an edge — falls to the nearest neighbouring planet, lands feet-first.
4. Stands on a small moon between two big planets — does NOT get yanked off by the larger planet's pull while walking.
5. Fires a Pistol — bullet visibly arcs into the nearest planet inside its halo.
6. Fires a Kamehameha across the system — beam curves dramatically through multiple halos.
7. Takes a heavy punch — flies several meters into space, hangs briefly, gets pulled back, lands.
8. Takes a small bump — staggers tangentially on the surface, does NOT enter launched mode.
9. Plays for 60s — never slingshots off the map. Never dies from gravity alone.
10. Runs in landscape on phone — FPS within today's targets.

## Out of Scope (Deferred)

Same as prior spec: bot pathfinding on curves, Force-Push directional physics, themed planets, wormholes. Plus:

- **Air control during `launched`** — none, by design. Knockback is committed flight.
- **Re-targeting `currentPlanet` mid-jump** — sticky to start-of-jump planet, simpler and less vertigo.

## Risks

- **Snap pop on first walking tick** — radial snap could teleport a player a few cm on landing. Mitigation: only snap when radial velocity is ≤ 0 (i.e. they've arrived). Until then `jumping` rules.
- **State machine bugs** — four-state machine is more code than the old single force. Mitigation: explicit transitions only in `Stickman._moveCurvedMagnetic`, no other code mutates `mode`.
- **Projectile pull too weak for spectacle** — `pullStrength = 15` is a guess. Plan: ship with `window.__planet.PROJECTILE_PULL_DEFAULT` writable, tune live.
