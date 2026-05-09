# Crystal Cavern — Level Design

**Date:** 2026-05-10
**Status:** Approved, ready for implementation plan
**Goal:** Add a tall, vertical, cave-themed level to *Stick Smash Party*. Climb-focused, central crystal spire as visual landmark, every tile destructible.

---

## 1. Overview

A tall vertical shaft cave (~2× the height of existing levels) lit by a central faceted-quartz spire. Players spawn around the base and across mid tiers and race toward a top sanctum at y=20. Movement reads as climbing, not arena-circling.

**Theme:** bioluminescent crystal cave. Mossy stone floor, scattered glowing mushrooms (cyan / magenta / yellow), faceted multi-color crystal accents on platforms, glowing cyan veins running up the walls, dim teal-black ambient with a cyan halo around the central spire.

**Design pillars:**
- *Verticality*: y range -5 (lava) → 20 (top sanctum). Roughly twice the height of existing levels.
- *Single landmark*: the central crystal spire is visible from anywhere on the map.
- *Total destructibility*: no bedrock; every tile (including subfloor, walls, and all spire shards) has HP and breaks. Only lava is permanent.
- *Mechanical restraint*: lava + icicles only. Verticality and destructibility provide chaos without additional hazard types.

**Vertical-spacing rule (from `definitions.js` header comment):** floors stack from y=0; the first tier above a floor must be at y ≥ 3 so a capsule (1.5m) fits beneath. Subsequent tiers also step in 3s. The tier plan in §2 follows this strictly.

---

## 2. Level definition (game coordinates)

**ID:** `crystalcave`
**Name:** `Crystal Cavern`
**bgColor:** `0x0a1a28` (deep teal-black)

### 2.1 Tile zones

| Zone | y | x range | Material | HP | Notes |
|---|---|---|---|---|---|
| Lava plane (hazard, see §3) | -5 | w=36, h=1.4 | — | — | dps 50, kill plane |
| Tough subfloor row 1 | -2 | -12..12 | metal | 200 | tough but breakable, no bedrock |
| Tough subfloor row 2 | -1 | -12..12 | metal | 200 | |
| Mossy floor | 0 | -12..12 | stone | 60 | stone tile w/ green moss top trim |
| Lower wraparound left | 3 | -11..-7 | stone | 60 | mossy |
| Lower wraparound right | 3 | 7..11 | stone | 60 | mossy |
| Lower wood left | 6 | -10..-7 | wood | 18 | breaks fast; icicles below |
| Lower wood right | 6 | 7..10 | wood | 18 | breaks fast; icicles below |
| Mid stone left | 9 | -11..-7 | stone | 60 | mossy |
| Mid wood right | 10 | 7..11 | wood | 18 | icicles below |
| Mid stone left | 13 | -10..-7 | stone | 60 | |
| Mid wood right | 14 | 7..11 | wood | 18 | icicles below |
| Upper stone left | 17 | -9..-6 | stone | 60 | |
| Chain wood right | 17 | 7..11 | wood | 18 | `chainAnchor: { x: 9, y: 24, segs: 5, hp: 30 }` — when any chain link HP=0, tile converts dynamic and falls |
| Top sanctum | 20 | -5..5 | stone | 80 | prize platform |

All vertical gaps within a single x-column (left or right stack) are ≥3 units. Sanctum at y=20 has no tile directly below it for the last 3 units; the spire (§2.3) provides the climb path up the center.

### 2.2 Wall columns (destructible)

Two vertical column lines, each rendered as 17 stacked stone tiles.

- Left wall: x=-13, y=1..17 (17 tiles), shape box w=0.6 h=1, material stone, hp 120, color `0x384450`
- Right wall: x=13, y=1..17 (17 tiles), same params

Punch-through opens new sightlines and skip routes; reduces the map's shape over the course of a match. Walls do not extend above y=17 — the top sanctum is exposed on its sides.

### 2.3 Crystal spire (centerpiece)

Six destructible custom box tiles centered on x=0, base at y=0. Each rendered with cyan or magenta emissive color and slight rotation for a faceted-cluster silhouette. Stone material. Each shard's `y range` describes its untilted vertical extent; the small rotation is applied around the shard's base center.

| Shard | center x | y range | size (w × h) | rotation | hp | role |
|---|---|---|---|---|---|---|
| Back magenta | -2 | 0..5.0 | 1.0 × 5.0 | -6° | 80 | back-tilted, durable |
| Main cyan | 0 | 0..6.5 | 1.4 × 6.5 | 0° | 80 | central tallest, climbable |
| Right magenta | 2 | 0..4.0 | 0.9 × 4.0 | +8° | 80 | front-tilted, durable |
| Front cyan small | -1 | 0..2.5 | 0.7 × 2.5 | +4° | 25 | brittle |
| Tip cyan | 0 | 5.5..7.5 | 0.6 × 2.0 | 0° | 25 | brittle, breaks early |
| Yellow accent nub | 1 | 0..1.0 | 0.5 × 1.0 | 0° | 25 | brittle |

**X-coordinate constraint:** all shards use integer x positions. Reason: `Tile`'s grid-keyed `damageArea` (AOE) lookup uses integer x/y; fractional positions miss splash hits. Single-target damage (bullets, melee, throws) hits any shard via Cannon collision callbacks regardless of x. **Known limitation:** because shard `y` is always `h/2` (so the base sits on the floor at y=0), only the right magenta shard (h=4 → y=2.0) has both integer x AND integer y, so AOE only reaches it. The other 5 shards take damage from direct attacks but ignore explosion splash. Acceptable: spire reads thematically as splash-resistant crystal.

**Behavior:** static stone tiles (NOT chain-reaction). Each shard has its own HP and breaks independently. On break: spawn cyan/magenta crystal-shard particles (reuse existing particle system, new color palette). Unbroken shards are climbable cover and partially block sightlines.

**Climb path via spire:** the main cyan shard tops out at y=6.5; combined with double-jump and grab-to-climb on the magenta shard tilts, a player can reach approximately y=8 from the spire alone. The remaining ~12 units to the sanctum require the side platform climb. The spire is not a sole route to the top, but provides a center vantage and breaks line-of-sight between left/right stacks.

Per the rejected mechanic option C: shards do **not** trigger physics chain-reaction toppling. This was considered and explicitly excluded for performance and predictability.

---

## 3. Hazards

- **Lava** — `{ kind: 'lava', x: 0, y: -5, w: 36, h: 1.4, dps: 50 }`. Only kill plane in the level.
- **Icicles** — `kind: 'spike'` with `pointDown: true` and `color: 0xa8c8d8`, hanging under each wood platform's underside (~y_platform - 0.5):
  - Under y=6 wood left:  `{ kind: 'spike', x: -8.5, y: 5.5, w: 2.4, pointDown: true, color: 0xa8c8d8 }`
  - Under y=6 wood right: `{ kind: 'spike', x:  8.5, y: 5.5, w: 2.4, pointDown: true, color: 0xa8c8d8 }`
  - Under y=10 wood right: `{ kind: 'spike', x: 9, y: 9.5, w: 2.6, pointDown: true, color: 0xa8c8d8 }`
  - Under y=14 wood right: `{ kind: 'spike', x: 9, y: 13.5, w: 2.6, pointDown: true, color: 0xa8c8d8 }`
  - Under y=17 chain wood right: `{ kind: 'spike', x: 9, y: 16.5, w: 2.6, pointDown: true, color: 0xa8c8d8 }`

**Not included** (considered, rejected): pendulum, saw, falling stalactite, mid-cave free-hanging icicles. Locked decision D — verticality + destructibility provide enough chaos.

---

## 4. Spawns

7 player spawn points distributed across tiers so 4-player matches start spread, never stacked:

```
{ x: -9, y:  1 }   (lower floor left)
{ x:  9, y:  1 }   (lower floor right)
{ x: -9, y:  7 }   (lower wood left)
{ x:  9, y:  7 }   (lower wood right)
{ x: -9, y: 14 }   (mid stone left)
{ x:  9, y: 11 }   (mid wood right)
{ x:  0, y: 21 }   (top sanctum)
```

All spawn points are 1 unit above their host tile (collision/standing margin) and over solid ground (verified against §2.1 tile zones).

---

## 5. Weapon spawns

6 spots — top sanctum is the prize, mid tier rewards the climb, lower tiers contested:

```
{ x:  0, y: 21 }   (top sanctum prize)
{ x: -9, y: 14 }   (mid stone left tier)
{ x:  9, y: 11 }   (mid wood right tier)
{ x:  0, y: 7  }   (between lower wood pair, contested center)
{ x: -9, y:  4 }   (lower wraparound left)
{ x:  9, y:  4 }   (lower wraparound right)
```

---

## 6. Background

Layered primitives at varying z (matches existing level conventions in `definitions.js`):

- **z=-14**: deep gradient back wall — large `bg` rects in a vertical stack from `0x0a1418` (top/bottom) to `0x1a3848` (center) for ambient depth.
- **z=-12**: distant rock silhouette columns receding into depth, ~6 columns at varying x and varying height, color `0x162028`.
- **z=-10**: glowing cyan vein strips on left wall (bgGlow color `0x5ee0ff`, emissiveIntensity 1.4), magenta strips on right wall (color `0xd878ff`).
- **z=-9**: scattered bioluminescent mushroom clusters as small `bgDisc` primitives, cyan/magenta/yellow emissive, dotted across the back wall and on mossy platform tops.
- **z=-8**: mist patches — low-alpha cyan ellipses at y=0, y=8, y=15.
- Crystal accent shards on platform tops (decorative) — small foreground `bg` primitives matching spire palette, no collision.

---

## 7. Required code changes

### 7.1 Camera y-clamp bump

`src/effects/Camera.js:44` currently clamps `this.center.y` to `[-6, 20]`. Top sanctum at y=20 + airborne players at ~y=22-23 would not frame properly with current clamp.

- Change clamp to `clamp(this.center.y, -6, 24)`.
- Line 27 filter `p.y > 26` → `p.y > 30` so airborne players above the sanctum aren't filtered out of frame logic.

This is a level-specific need but applied globally; existing levels top out around y=10–12 and are unaffected (auto-fit zoom keeps them framed exactly as before).

### 7.2 Crystal-shard particle palette (optional polish)

If the existing tile-break particle system uses a single material color, add a per-tile override so spire shards emit cyan/magenta crystal shards on break. If the system already supports per-tile color, no code change needed — confirm during implementation.

### 7.3 No new hazard types

All hazards reuse existing systems: lava, spike (with `pointDown`), and chainAnchor (for the right-side y=17 chain platform). No new hazard kinds, no new physics primitives.

---

## 8. Out of scope

- New weapon types tied to crystals.
- Scripted in-level events (cave-ins, timed lava rises, etc.).
- Audio cues specific to this level beyond generic tile-break sounds.
- A second-pass crystal pendulum or saw (rejected in mechanics question 2).
- Physics chain-reaction spire toppling (rejected in mechanics question 1).
- Underwater / flooded sections (not in scope for v1).

---

## 9. Acceptance criteria

- Level loads as `crystalcave` and is selectable in the level rotation alongside existing levels.
- Camera frames the full height (y=0 floor → y=22 above sanctum) when players spread vertically.
- Every tile is destructible — including subfloor, walls, and all spire shards. Lava remains the only indestructible element.
- 4 players can spawn-spread without collision; no spawn point is over thin air or inside a tile.
- Top sanctum platform (y=20) is reachable from the floor via either the left or right side-platform climb. The spire alone does not reach the sanctum.
- Cutting the right-side chain (any chain-link HP reaches 0) drops the y=17 wood platform into dynamic physics and it falls.
- No floating decorative assets (every crystal accent and stalactite is anchored to a tile or ceiling).
- Plays at 60fps on a mid-range PC with 4 players + bots active.
