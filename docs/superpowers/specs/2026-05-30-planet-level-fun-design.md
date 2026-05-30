# Planet Level — Make It Fun

**Status:** Design approved 2026-05-30 (user delegated, "proceed without prompting").

## Problem

`planettest` is a grey dev sandbox. Three pieces of built machinery are mis-wired or blocked:

1. **Gravity not equal** — anchors `pullStrength: 18`, moons `10`. Design intent is equal gravity.
2. **Planets un-jumpable** — jump apex ~1m, closest surface gap ~6.9m. Core "jump planet-to-planet" loop is physically impossible.
3. **Meteor showers never fire** — `MeteorShower` is fully coded but the def has no `meteorShower` config.
4. **Lava cores unreachable** — surface sphere collider (`radius`) is solid; the core hazard sits buried at center, can never be touched.
5. **Weapon spawns janky** — 60% "sky drop" path drops from world `y=16`, meaningless in a planet ring.

## Design

### 1. Equal gravity + floaty jumps

- All planets: same `pullStrength` (16). Remove the 18/10 split.
- Jump retune (tunables on `window.__planet`):
  - `jumpSpeed` 8 → 12 (apex ~5m).
  - `JUMP_DOWN_ACCEL` 30 → 14 (floatier fall).
  - `speedMaxAir` 4 → 6, `AIR_ACCEL` 18 → 24 (steer the arc).
- `jumpSpeed` is currently a local const in `_movePlanetMagnetic` walking branch; promote to `window.__planet.JUMP_SPEED` (default 12). `speedMaxAir` likewise → `AIR_SPEED_MAX` (default 6).

### 2. Tight 6-planet jumpable ring

Replace the spread-out layout with a ring of radius 11 around origin, 6 planets at 60° steps. Neighbor surface gaps ~5m → one committed floaty jump crosses and the neighbor's well catches you.

| id | cx | cy | radius | role |
|----|----|----|--------|------|
| p1 | 0    | 11   | 3.5 | anchor (top) |
| p2 | 9.5  | 5.5  | 2.5 | moon |
| p3 | 9.5  | -5.5 | 2.5 | moon |
| p4 | 0    | -11  | 3.5 | anchor (bottom) |
| p5 | -9.5 | -5.5 | 2.5 | moon |
| p6 | -9.5 | 5.5  | 2.5 | moon |

- All `pullStrength: 16`, `haloMul: 4.5` (wells overlap → clean hand-off, projectiles curve hard).
- `mantleRadius = radius * 0.6`, `coreRadius = radius * 0.32`.
- `killBound` tighten to `{ x: 24, y: 22 }` (ring max extent ~14; gives the arena edges).
- Spawns + weaponSpawns: one per planet, placed `radius + 1.5` out along the planet's outward radial from origin.

### 3. Live meteor showers

Add to the def:
```js
meteorShower: { activateAfter: 20, interval: [6, 11], perShower: [1, 3] }
```
Already ticked by `Level.update` + destroyed by `Level.destroy`. No code change — config only.

### 4. Deadly lava cores (1-stage peel)

New mechanic in `Planet.js`:
- Track `crustAlive` (count of un-destroyed crust wedges). Decrement in the crust wedge `destroy()`.
- When `crustAlive` hits 0 → **peel**: swap the surface sphere collider radius from `radius` → `coreRadius`, set `planet.radius = coreRadius` (so the walking spring lowers players onto the new tiny surface), destroy any remaining mantle wedges, set `planet.molten = true`, and bump the core mesh emissive for a "now exposed" glow.
- Molten planets damage walkers: in the player walking branch, if `currentPlanet.molten`, apply lava DoT (`MOLTEN_DPS = 60`/s) via `takeDamage(... weapon:'lava')`. (Direct DoT instead of relying on the buried trigger sphere — reliable at any coreRadius.)
- Tuning: moons get low `crustHp` (~24) → peel in ~2-3 explosives = weaponizable death traps. Anchors get high `crustHp` (~90) → stay safe ground.
- The existing buried core trigger hazard stays for non-peeled visuals but is no longer the damage source for walkers.

### 5. Weapon spawns that matter

In `Game._spawnRandomItem`: when `this.level.curvedGravity`, force the pad path (`fromSky = false`) so weapons land on planet surfaces. The `_hasGroundBelow` raycast already validates pads sit above a planet (it does — spawns are directly radially-out above each planet center, world-y down hits the surface sphere).

## Files touched

- `src/levels/definitions.js` — rewrite the `planettest` planets/spawns/killBound, add `meteorShower`, per-planet `crustHp`.
- `src/entities/Stickman.js` — promote jump tunables to `window.__planet`, retune; molten DoT in walking branch.
- `src/levels/space/PlanetGravity.js` — add `JUMP_SPEED`, `AIR_SPEED_MAX`, `MOLTEN_DPS` to DEFAULTS; retune `JUMP_DOWN_ACCEL`, `AIR_ACCEL`.
- `src/levels/space/Planet.js` — `crustAlive` tracking, `_peel()`, `molten` flag, surface collider swap.
- `src/Game.js` — force pad-spawn on curved-gravity levels.

## Out of scope

- Themed planet visuals (user dropped it).
- Multi-stage peel (1-stage only).
- Bot pathfinding on curves.

## Acceptance

1. Land on a planet, walk around it smooth.
2. Jump toward a neighbor → floaty arc → caught by neighbor's well → land on it.
3. All planets pull equally (no anchor yank).
4. Fire across the ring → projectile curves hard through wells.
5. After ~20s, meteors streak in and curve into planets.
6. Strip a moon's crust with explosives → it goes molten → standing on it burns.
7. Anchor planets resist stripping (stay safe).
8. Weapons spawn on planet surfaces, not the void.
9. No slingshots, no console errors, mobile FPS within target.
