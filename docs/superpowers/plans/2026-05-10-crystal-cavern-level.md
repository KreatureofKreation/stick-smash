# Crystal Cavern Level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tall vertical cave-themed level (`crystalcave`) to *Stick Smash Party* with a central faceted-quartz spire centerpiece, climb-focused tier layout, total destructibility (no bedrock), and minimal hazards (lava + platform-underside icicles).

**Architecture:** The game's level system is data-driven — a level is a single object pushed onto `LEVELS` in `src/levels/definitions.js`, consumed by the existing `Level.js` runtime. Three small additions are needed: (1) the level definition itself; (2) per-tile Z-rotation support in `Tile.build()` so the spire shards can tilt; (3) a camera y-clamp bump because this level is twice as tall as existing levels.

**Tech Stack:** Pure ES modules, Three.js (rendering), Cannon-es (physics). No build step. No unit test framework — verification is via syntax check (`node --check`) and browser preview (preview_* MCP tools).

**Spec:** [`docs/superpowers/specs/2026-05-10-crystal-cavern-level-design.md`](docs/superpowers/specs/2026-05-10-crystal-cavern-level-design.md)

---

## File Plan

| File | Type | Responsibility |
|---|---|---|
| `src/effects/Camera.js` | modify | Bump `center.y` clamp upper bound 20 → 24, bump out-of-frame filter `p.y > 26` → 30. |
| `src/levels/Level.js` | modify | Add `rotZ` Tile option so individual tiles can render rotated about Z (used by spire shards). |
| `src/levels/definitions.js` | modify | Append a new `crystalcave` level object to `LEVELS`. Built up in stages (skeleton → tiers → spire → hazards → background). |

No new files. No new dependencies. The implementation is entirely additive — existing levels are unaffected because the camera bump is a strict superset of the old clamp range and the new `rotZ` option defaults to 0.

---

## Task 1: Camera y-clamp bump

The level reaches y=20 (top sanctum) with airborne players going to ~y=22-23. Camera currently clamps `center.y` to 20 and filters players above y=26 from frame-fitting. Both need to expand or the top of the level will not frame correctly.

**Files:**
- Modify: `src/effects/Camera.js:27` (filter)
- Modify: `src/effects/Camera.js:44` (clamp)

- [ ] **Step 1.1: Open `src/effects/Camera.js` and confirm current values**

Run: read lines 19-50 of the file. Confirm line 27 reads `if (Math.abs(p.x) > 28 || p.y > 26 || p.y < -12) continue;` and line 44 reads `this.center.y = clamp(this.center.y, -6, 20);`.

- [ ] **Step 1.2: Change the player filter**

In `src/effects/Camera.js:27`, replace:

```javascript
      if (Math.abs(p.x) > 28 || p.y > 26 || p.y < -12) continue;
```

with:

```javascript
      if (Math.abs(p.x) > 28 || p.y > 30 || p.y < -12) continue;
```

- [ ] **Step 1.3: Change the camera clamp**

In `src/effects/Camera.js:44`, replace:

```javascript
    this.center.y = clamp(this.center.y, -6, 20);
```

with:

```javascript
    this.center.y = clamp(this.center.y, -6, 24);
```

- [ ] **Step 1.4: Syntax-check**

Run: `node --check src/effects/Camera.js`
Expected: exits with no output (success).

- [ ] **Step 1.5: Smoke-test against an existing level**

Start the dev server and load any existing level (e.g. Arena). Verify the camera still frames the action — existing levels top out around y=10 so the higher clamp never engages and behavior is identical.

Run: `preview_start` (or `npm start` if running outside Claude Code).
Action: open the URL, click PLAY LOCAL with default settings (Arena), drop a player.
Expected: camera follows the player smoothly, no visible change vs. before.

- [ ] **Step 1.6: Commit**

```bash
git add src/effects/Camera.js
git commit -m "feat(camera): raise y-clamp to support taller levels"
```

---

## Task 2: Add per-tile Z-rotation support to `Tile`

The crystal spire's faceted-cluster look depends on individual shards being slightly tilted (-6° to +14°). The current `Tile.build()` always renders boxes axis-aligned. Add an optional `rotZ` (radians) on the tile def, applied to both the Three mesh and the Cannon body before the static-tile matrix bake.

**Files:**
- Modify: `src/levels/Level.js:11-105` (Tile constructor + Tile.build)

- [ ] **Step 2.1: Add `rotZ` field to the Tile constructor**

In `src/levels/Level.js`, find the Tile constructor (starts around line 12). Inside the constructor body, just before the line `this.body = null;` (around line 31), add:

```javascript
    // Optional Z-axis rotation (radians) for tilted decorative shards (e.g., crystal spire).
    // Applied to both the physics body and mesh before the static-tile matrix bake.
    this.rotZ = opts.rotZ ?? 0;
```

Final constructor end-section should look like:

```javascript
    this.chainAnchor = opts.chainAnchor || null;
    // Optional Z-axis rotation (radians) for tilted decorative shards (e.g., crystal spire).
    // Applied to both the physics body and mesh before the static-tile matrix bake.
    this.rotZ = opts.rotZ ?? 0;
    this.body = null;
    this.mesh = null;
    this._chainSuspension = null;  // { anchorBody, segs:[], constraints:[] }
  }
```

- [ ] **Step 2.2: Apply rotation to body in `build()`**

In `src/levels/Level.js`, find `body.position.set(x, y, 0);` (line 73). **Immediately after** that line, add:

```javascript
    if (this.rotZ) body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), this.rotZ);
```

- [ ] **Step 2.3: Apply rotation to mesh in `build()`**

In `src/levels/Level.js`, find `mesh.position.set(x, y, 0);` (line 85). **Immediately after** that line, add:

```javascript
    if (this.rotZ) mesh.rotation.z = this.rotZ;
```

(This must come before the `mesh.updateMatrix()` call at line 92 so the bake captures the rotation.)

- [ ] **Step 2.4: Syntax-check**

Run: `node --check src/levels/Level.js`
Expected: exits with no output.

- [ ] **Step 2.5: Regression-test with an existing level**

Start the preview server and load a level that uses lots of tiles (e.g. Sawmill). Verify nothing visually changed — every existing tile has `rotZ` undefined, so the new code paths are skipped via `if (this.rotZ)`.

Run: `preview_start`, then in the browser pick Saw Mill, drop a player. Take a screenshot.
Expected: tiles render exactly as before. Nothing tilted, nothing moved.

- [ ] **Step 2.6: Commit**

```bash
git add src/levels/Level.js
git commit -m "feat(level): add optional rotZ to Tile for tilted shards"
```

---

## Task 3: Add Crystal Cavern skeleton (subfloor, floor, walls, spawns)

Append a new level object to the `LEVELS` array in `src/levels/definitions.js`. This task adds *only* the bottom-level structure: lava plane, tough subfloor, mossy floor, two destructible wall columns, and the 7 player spawns. No tiered platforms yet, no spire, no icicles. After this task the level will be playable but minimal — players spawn around the floor and can move horizontally on a featureless ground tile.

This staged buildup makes each subsequent task independently verifiable in the browser.

**Files:**
- Modify: `src/levels/definitions.js` — append a new entry to the `LEVELS` export array, immediately before the closing `];` (around line 1130).

- [ ] **Step 3.1: Locate the array end**

In `src/levels/definitions.js`, find the last level entry. Currently `cratezone` (id at line 1040) is the last level. Find the closing `},` of that level's object and the closing `];` of the `LEVELS` array (around line 1130-1135).

- [ ] **Step 3.2: Append the skeleton level**

In `src/levels/definitions.js`, immediately before the `LEVELS` array's closing `];`, insert:

```javascript

  // ---------------------------------------------------------------------
  // CRYSTAL CAVERN — tall vertical cave. Bioluminescent crystal spire as
  // landmark. Every tile destructible (no bedrock); only lava is permanent.
  // Hazards: lava + icicles under wood platforms. ~2x the height of other
  // levels — requires the bumped Camera y-clamp from Task 1.
  // ---------------------------------------------------------------------
  {
    id: 'crystalcave',
    name: 'Crystal Cavern',
    bgColor: 0x0a1a28,
    tiles: [
      // Mossy floor (hp 60, sand-stone color w/ green tint).
      ...row(0, -12, 12, { material: 'stone', hp: 60, color: 0x5a6a58 }),
      // Tough subfloor — destructible but hp 200. Lava at y=-5 below.
      ...tough(-1, -12, 12, { color: 0x181820 }),
      ...tough(-2, -12, 12, { color: 0x181820 }),
      // Destructible wall columns left + right, full vertical extent.
      ...col(-13, 1, 17, { shape: 'box', w: 0.6, h: 1, material: 'stone', hp: 120, color: 0x384450 }),
      ...col( 13, 1, 17, { shape: 'box', w: 0.6, h: 1, material: 'stone', hp: 120, color: 0x384450 }),
    ],
    hazards: [
      // Kill plane.
      { kind: 'lava', x: 0, y: -5, w: 36, h: 1.4, dps: 50 },
    ],
    spawns: [
      // Tier-distributed spawns added in Task 4. For now spawn around the floor.
      { x: -9, y: 1 }, { x: 9, y: 1 },
      { x: -5, y: 1 }, { x: 5, y: 1 },
      { x: 0,  y: 1 },
    ],
    weaponSpawns: [
      { x: 0,  y: 1 },
      { x: -8, y: 1 }, { x: 8, y: 1 },
    ],
    background: [
      // Atmospheric bg added in Task 8. Flat dark fill for now.
      bg(0, 10, 50, 30, 0x0a1a28, -14),
    ],
  },
```

(The trailing comma is required because this is no longer the last array entry once you commit the file.)

- [ ] **Step 3.3: Syntax-check**

Run: `node --check src/levels/definitions.js`
Expected: exits with no output.

- [ ] **Step 3.4: Verify the level appears in the menu**

Start the preview server. Open the local play / online host menu and check the level dropdown.

Run: `preview_start`
Action: in the browser, click PLAY LOCAL → open the level select.
Expected: "Crystal Cavern" appears in the list.

- [ ] **Step 3.5: Visually verify load**

Select Crystal Cavern, start a match with bots. Verify the level loads without console errors, players spawn on the floor, the camera frames them, and players can walk around without falling through tiles.

Action: select Crystal Cavern, set bots=2, start match.
Expected: floor visible at y=0, walls at left and right edges, no errors in `preview_console_logs`. Take a `preview_screenshot` for the record.

- [ ] **Step 3.6: Commit**

```bash
git add src/levels/definitions.js
git commit -m "feat(level): add crystalcave skeleton (floor, walls, spawns)"
```

---

## Task 4: Add tier platforms

Add the climb route — left and right side platforms in alternating stone (durable) / wood (breakable) at y=3, 6, 9, 10, 13, 14, 17, plus the y=20 top sanctum. Tiers respect the 3-unit vertical spacing rule from `definitions.js:1-9`. Update the spawn list to distribute players across the new tiers, and update weapon spawns.

**Files:**
- Modify: `src/levels/definitions.js` — within the `crystalcave` level object: extend `tiles`, replace `spawns` and `weaponSpawns`.

- [ ] **Step 4.1: Extend the `tiles` array**

In `src/levels/definitions.js`, inside the `crystalcave` level object, find the `tiles: [` array. After the wall columns (the two `col(±13, 1, 17, ...)` lines added in Task 3), append:

```javascript
      // ---- Tier platforms (left + right, alternating stone / wood) ----
      // Lower wraparound y=3 (stone, hp 60).
      ...row(3, -11, -7, { material: 'stone', hp: 60, color: 0x5a6a58 }),
      ...row(3,   7, 11, { material: 'stone', hp: 60, color: 0x5a6a58 }),
      // Lower wood y=6 (icicles below — see Task 5).
      ...row(6, -10, -7, { material: 'wood', hp: 18, color: 0x6a4020 }),
      ...row(6,   7, 10, { material: 'wood', hp: 18, color: 0x6a4020 }),
      // Mid stone left y=9.
      ...row(9, -11, -7, { material: 'stone', hp: 60, color: 0x5a6a58 }),
      // Mid wood right y=10.
      ...row(10, 7, 11, { material: 'wood', hp: 18, color: 0x6a4020 }),
      // Mid stone left y=13.
      ...row(13, -10, -7, { material: 'stone', hp: 60, color: 0x5a6a58 }),
      // Mid wood right y=14.
      ...row(14, 7, 11, { material: 'wood', hp: 18, color: 0x6a4020 }),
      // Upper stone left y=17.
      ...row(17, -9, -6, { material: 'stone', hp: 60, color: 0x5a6a58 }),
      // Upper chain wood right y=17 (chainAnchor wired in Task 6).
      ...row(17, 7, 11, { material: 'wood', hp: 18, color: 0x6a4020 }),
      // Top sanctum y=20 (durable prize platform).
      ...row(20, -5, 5, { material: 'stone', hp: 80, color: 0x6a7a68 }),
```

- [ ] **Step 4.2: Replace the `spawns` array**

Inside the `crystalcave` object, replace the entire `spawns: [...]` block (the placeholder added in Task 3) with:

```javascript
    spawns: [
      // Lower floor.
      { x: -9, y: 1 }, { x: 9, y: 1 },
      // Lower wood (y=6).
      { x: -9, y: 7 }, { x: 9, y: 7 },
      // Mid (y=13 stone left, y=10 wood right).
      { x: -9, y: 14 }, { x: 9, y: 11 },
      // Top sanctum.
      { x: 0, y: 21 },
    ],
```

- [ ] **Step 4.3: Replace the `weaponSpawns` array**

Inside the `crystalcave` object, replace the entire `weaponSpawns: [...]` block with:

```javascript
    weaponSpawns: [
      // Top sanctum prize.
      { x: 0, y: 21 },
      // Mid tier rewards.
      { x: -9, y: 14 }, { x: 9, y: 11 },
      // Contested center between lower wood pair.
      { x: 0, y: 7 },
      // Lower wraparound.
      { x: -9, y: 4 }, { x: 9, y: 4 },
    ],
```

- [ ] **Step 4.4: Syntax-check**

Run: `node --check src/levels/definitions.js`
Expected: exits with no output.

- [ ] **Step 4.5: Visually verify the climb**

Start the preview, load Crystal Cavern with 0 bots, spawn the player, climb up the right side using jumps. Verify each tier is reachable, no spawn point is over thin air, the top sanctum is reachable from the side ladder.

Action: `preview_start`, load the level, drive the player up the right side (mash space + D).
Expected: the player can hop from y=0 → y=3 → y=6 → y=10 → y=14 → y=17 → y=20. Take a `preview_screenshot` showing the full vertical layout (zoom should auto-fit).

If a tier is unreachable: check the height delta is ≤4 in-game units (jump height is ~3.5 in this engine; capsule + double-jump can clear ~5). If it exceeds that, add an intermediate ledge — but per the spec that should not happen.

- [ ] **Step 4.6: Commit**

```bash
git add src/levels/definitions.js
git commit -m "feat(level): add crystalcave tier platforms + tier-distributed spawns"
```

---

## Task 5: Add icicle hazards under wood platforms

Append five `pointDown` spike hazards to the `crystalcave` `hazards` array. Each hangs from the underside of a wood platform (y_platform − 0.5) and matches the icicle pattern already used by Spike Pit and Ice Tower.

**Files:**
- Modify: `src/levels/definitions.js` — within the `crystalcave` level: extend `hazards`.

- [ ] **Step 5.1: Extend the `hazards` array**

In `src/levels/definitions.js`, inside the `crystalcave` level object, find the `hazards: [` array. After the existing lava entry, append:

```javascript
      // Icicles (pointDown spikes) hanging under each wood platform.
      // Light-blue color to read as crystal-frosted, not torch-orange.
      { kind: 'spike', x: -8.5, y: 5.5,  w: 2.4, pointDown: true, color: 0xa8c8d8 },  // under y=6 wood left
      { kind: 'spike', x:  8.5, y: 5.5,  w: 2.4, pointDown: true, color: 0xa8c8d8 },  // under y=6 wood right
      { kind: 'spike', x:  9,   y: 9.5,  w: 2.6, pointDown: true, color: 0xa8c8d8 },  // under y=10 wood right
      { kind: 'spike', x:  9,   y: 13.5, w: 2.6, pointDown: true, color: 0xa8c8d8 },  // under y=14 wood right
      { kind: 'spike', x:  9,   y: 16.5, w: 2.6, pointDown: true, color: 0xa8c8d8 },  // under y=17 chain wood right
```

- [ ] **Step 5.2: Syntax-check**

Run: `node --check src/levels/definitions.js`
Expected: exits with no output.

- [ ] **Step 5.3: Visually verify the icicles render**

Start the preview, load Crystal Cavern, fly the camera or use a bot to climb past each wood platform. Verify icicles render as downward-pointing cones beneath every wood platform (5 total).

Action: `preview_start`, load Crystal Cavern, screenshot mid-cave at multiple y heights.
Expected: icicles visible under y=6 (both sides), y=10, y=14, y=17. No icicles in mid-air with no platform above.

- [ ] **Step 5.4: Quick lethality check**

Spawn a player at y=4 directly under one of the y=6 icicles, jump up into it. Verify the icicle damages/knocks the player downward (this is the existing `pointDown: true` behavior).

Expected: player takes damage and is punched toward the floor.

- [ ] **Step 5.5: Commit**

```bash
git add src/levels/definitions.js
git commit -m "feat(level): add crystalcave icicle hazards under wood platforms"
```

---

## Task 6: Wire chain suspension on the right y=17 wood platform

Convert the right-side y=17 wood platform from a static tile into a chain-suspended tile. Cutting any of the chain link segments will drop the platform via the existing `chainAnchor` mechanic (see `Level.js:_suspendTile`, used by Gauntlet's level definition).

**Files:**
- Modify: `src/levels/definitions.js` — within `crystalcave` `tiles`: edit the y=17 right wood row.

- [ ] **Step 6.1: Edit the y=17 right wood row**

In `src/levels/definitions.js`, inside the `crystalcave` level's `tiles` array, find the line added in Task 4:

```javascript
      // Upper chain wood right y=17 (chainAnchor wired in Task 6).
      ...row(17, 7, 11, { material: 'wood', hp: 18, color: 0x6a4020 }),
```

Replace it with:

```javascript
      // Upper chain wood right y=17. Chain anchored to invisible static point
      // at (9, 24); 5 segments hang the platform. Cutting any seg → platform
      // converts dynamic and falls (drop credit anyone standing on it).
      ...row(17, 7, 11, {
        material: 'wood', hp: 18, color: 0x6a4020,
        chainAnchor: { x: 9, y: 24, segs: 5, hp: 30 },
      }),
```

- [ ] **Step 6.2: Syntax-check**

Run: `node --check src/levels/definitions.js`
Expected: exits with no output.

- [ ] **Step 6.3: Visually verify chains render**

Start the preview, load Crystal Cavern, look at the y=17 right platform. Verify the chain segments are visible going up from the platform toward y=24.

Action: `preview_start`, load level, screenshot y=17 area.
Expected: 5 chain links visible suspending the right y=17 wood tile from a point above.

- [ ] **Step 6.4: Verify chain destruction drops the platform**

Spawn a player on the y=17 chain platform. Stand a bot on it. Have the player shoot the chain (any pistol/rifle weapon spawned at lower tiers). When a chain link's hp hits 0, the platform should convert to dynamic physics and fall, dropping the bot.

Action: get the player to y=17, get a bot on the y=17 right platform, fire at the chain.
Expected: chain link breaks, platform falls + tilts under physics, the bot rides it down.

If the platform doesn't fall: confirm the chain link is being damaged. The chain segments share the same hp parameter (30 in this case). If hp seems too high, lower to 20 — but 30 is in line with Gauntlet's 22.

- [ ] **Step 6.5: Commit**

```bash
git add src/levels/definitions.js
git commit -m "feat(level): suspend crystalcave y=17 right platform on chain"
```

---

## Task 7: Build the crystal spire centerpiece

Append six tilted crystal-shard tiles to the `tiles` array forming the central spire at x≈0. Uses the new `rotZ` option from Task 2. Each shard is a stone tile with a cyan / magenta / yellow color and an emissive tint for glow. Per the spec, shards have varied HP — base shards 80, brittle tips 25.

**Files:**
- Modify: `src/levels/definitions.js` — within `crystalcave` `tiles`: append spire shards.

- [ ] **Step 7.1: Append spire shards to `tiles`**

In `src/levels/definitions.js`, inside the `crystalcave` level's `tiles` array, after the y=20 sanctum row (the last entry from Task 4), append:

```javascript
      // ---- Crystal spire centerpiece (x≈0, base y=0). Tilted shards form
      // a faceted-cluster silhouette. Each shard is its own tile w/ HP. ----
      // Tile y is the CENTER of the box; spec heights are full shard heights,
      // so y_center = h/2 (since base sits at y=0 floor).
      // Back magenta — durable, tilted -6°.
      { x: -1.4, y: 2.5, shape: 'box', w: 1.0, h: 5.0, d: 1.0,
        material: 'stone', hp: 80, rotZ: -0.105,  // -6°
        color: 0xb060d0, emissive: 0xb060d0, emissiveIntensity: 0.7 },
      // Main cyan — durable, vertical, tallest.
      { x: 0, y: 3.25, shape: 'box', w: 1.4, h: 6.5, d: 1.2,
        material: 'stone', hp: 80, rotZ: 0,
        color: 0x5ec8e8, emissive: 0x5ec8e8, emissiveIntensity: 0.8 },
      // Right magenta — durable, tilted +8°.
      { x: 1.6, y: 2.0, shape: 'box', w: 0.9, h: 4.0, d: 0.9,
        material: 'stone', hp: 80, rotZ: 0.140,  // +8°
        color: 0xb060d0, emissive: 0xb060d0, emissiveIntensity: 0.7 },
      // Front cyan small — brittle, tilted +4°.
      { x: -0.6, y: 1.25, shape: 'box', w: 0.7, h: 2.5, d: 0.7,
        material: 'stone', hp: 25, rotZ: 0.070,  // +4°
        color: 0x80c8e0, emissive: 0x80c8e0, emissiveIntensity: 0.6 },
      // Tip cyan — brittle, breaks early. Floats above main cyan top.
      { x: 0, y: 6.5, shape: 'box', w: 0.6, h: 2.0, d: 0.6,
        material: 'stone', hp: 25, rotZ: 0,
        color: 0xc8f4ff, emissive: 0xc8f4ff, emissiveIntensity: 1.0 },
      // Yellow accent nub — short, brittle, breaks for spectacle.
      { x: 1.0, y: 0.5, shape: 'box', w: 0.5, h: 1.0, d: 0.5,
        material: 'stone', hp: 25, rotZ: 0,
        color: 0xe8c440, emissive: 0xe8c440, emissiveIntensity: 0.8 },
```

Note: the existing `Tile.build()` accepts `emissive` and `emissiveIntensity` only via the `bg()` background helpers, not for tiles. Verify this — if tile rendering doesn't honor those fields, drop the emissive props (the color alone will read fine) and skip the glow until a follow-up task.

- [ ] **Step 7.2: Confirm tile renderer supports `emissive`**

Read `src/levels/Level.js` lines 79-84 (the `MeshStandardMaterial` construction in `Tile.build()`). Check whether it reads `this.emissive` and `this.emissiveIntensity`.

If the material construction is the current code:
```javascript
const mat = new THREE.MeshStandardMaterial({
  color: this.color,
  roughness: 0.85,
  metalness: this.material === 'metal' ? 0.6 : 0.05,
});
```

…then emissive is NOT honored on tiles. To support spire glow, also do steps 7.2a + 7.2b. Otherwise skip them.

- [ ] **Step 7.2a: Pass `emissive` through Tile constructor**

In `src/levels/Level.js`, in the Tile constructor, near `this.color = opts.color ?? ...` (around line 19), add:

```javascript
    this.emissive = opts.emissive ?? null;
    this.emissiveIntensity = opts.emissiveIntensity ?? 0;
```

- [ ] **Step 7.2b: Use `emissive` in Tile.build material**

In `src/levels/Level.js`, in `Tile.build()`, replace the material construction (lines 79-83) with:

```javascript
    const mat = new THREE.MeshStandardMaterial({
      color: this.color,
      roughness: 0.85,
      metalness: this.material === 'metal' ? 0.6 : 0.05,
      emissive: this.emissive ?? 0x000000,
      emissiveIntensity: this.emissiveIntensity,
    });
```

- [ ] **Step 7.3: Syntax-check both files**

Run: `node --check src/levels/definitions.js && node --check src/levels/Level.js`
Expected: exits with no output.

- [ ] **Step 7.4: Visually verify the spire**

Start the preview, load Crystal Cavern, spawn the player, look at the center of the level.

Action: `preview_start`, load level, take a screenshot framing x=0 from y=0 to y=10.
Expected:
- Six visible shards forming a cluster at center floor.
- Magenta back shard tilted left, magenta right shard tilted right.
- Main cyan shard tallest, vertical, in the middle of the cluster.
- Yellow nub at bottom-right of cluster.
- Tip cyan glowing at the very top of the spire.
- Colors read as faceted gem-cluster, not flat cubes.

- [ ] **Step 7.5: Verify spire breaks correctly**

Walk a player up to the spire and bash the front cyan small shard with melee (it has hp 25 — should break in 2-3 hits).

Expected: shard breaks, spawns standard tile-break particles, spire silhouette gaps. Other shards unaffected (each has independent HP).

- [ ] **Step 7.6: Commit**

```bash
git add src/levels/definitions.js src/levels/Level.js
git commit -m "feat(level): add crystalcave spire centerpiece w/ tilted shards"
```

---

## Task 8: Background atmosphere

Replace the placeholder flat-fill background with a layered cave atmosphere — gradient walls receding into depth, glowing cyan/magenta wall veins, scattered emissive bg mushrooms (small discs), and mist patches. Pure decorative — no collision, no gameplay impact.

**Files:**
- Modify: `src/levels/definitions.js` — within `crystalcave`: replace the `background` array.

- [ ] **Step 8.1: Replace the `background` array**

In `src/levels/definitions.js`, inside the `crystalcave` level object, replace the entire `background: [...]` block (the placeholder added in Task 3) with:

```javascript
    background: [
      // ---- Far gradient walls (z=-14): dark teal-black depth fade. ----
      bg(0, -2, 50, 8, 0x06101a, -14),
      bg(0,  6, 50, 10, 0x0a1a28, -14),
      bg(0, 14, 50, 8,  0x14283a, -14),
      bg(0, 22, 50, 8,  0x0a1a28, -14),

      // ---- Distant rock silhouette columns (z=-12). ----
      bg(-22, 8,  4, 28, 0x162028, -12),
      bg(-17, 6,  3, 22, 0x121c24, -12),
      bg(-11, 4,  2, 14, 0x0e1820, -12),
      bg( 11, 4,  2, 14, 0x0e1820, -12),
      bg( 17, 6,  3, 22, 0x121c24, -12),
      bg( 22, 8,  4, 28, 0x162028, -12),

      // ---- Wall vein glow strips (z=-10). Cyan left, magenta right. ----
      bgGlow(-12, 4,  0.4, 5, 0x5ee0ff, -10),
      bgGlow(-12, 12, 0.4, 5, 0x5ee0ff, -10),
      bgGlow(-12, 19, 0.4, 4, 0x5ee0ff, -10),
      bgGlow( 12, 4,  0.4, 5, 0xd878ff, -10),
      bgGlow( 12, 12, 0.4, 5, 0xd878ff, -10),
      bgGlow( 12, 19, 0.4, 4, 0xd878ff, -10),

      // ---- Bioluminescent mushroom dots scattered on bg (z=-9). ----
      bgDisc(-10, 2,  0.25, 0x5ee0ff, -9, { emissiveIntensity: 1.4 }),
      bgDisc(-7,  2,  0.18, 0xd878ff, -9, { emissiveIntensity: 1.2 }),
      bgDisc(-4,  2,  0.22, 0xffd070, -9, { emissiveIntensity: 1.0 }),
      bgDisc( 4,  2,  0.22, 0x5ee0ff, -9, { emissiveIntensity: 1.4 }),
      bgDisc( 7,  2,  0.18, 0xd878ff, -9, { emissiveIntensity: 1.2 }),
      bgDisc( 10, 2,  0.25, 0xffd070, -9, { emissiveIntensity: 1.0 }),
      bgDisc(-9,  9,  0.20, 0x5ee0ff, -9, { emissiveIntensity: 1.2 }),
      bgDisc( 9,  10, 0.20, 0xd878ff, -9, { emissiveIntensity: 1.2 }),
      bgDisc(-7,  16, 0.18, 0xffd070, -9, { emissiveIntensity: 1.0 }),
      bgDisc( 7,  16, 0.18, 0x5ee0ff, -9, { emissiveIntensity: 1.2 }),

      // ---- Cyan ambient halo behind the spire (z=-9.5). ----
      bgDisc(0, 4, 4.0, 0x5ee0ff, -9.5, { emissiveIntensity: 0.5 }),

      // ---- Foreground mist patches (z=-8). Low-alpha cyan ovals. ----
      bg(0, 0,  20, 0.6, 0x1a3848, -8),
      bg(0, 8,  16, 0.5, 0x1a3848, -8),
      bg(0, 15, 14, 0.4, 0x1a3848, -8),
    ],
```

- [ ] **Step 8.2: Syntax-check**

Run: `node --check src/levels/definitions.js`
Expected: exits with no output.

- [ ] **Step 8.3: Visually verify atmosphere**

Start the preview, load Crystal Cavern, take screenshots at floor (y=0), mid (y=10), and top (y=20).

Action: `preview_start`, load level, drive the player up the right side, screenshot at each tier.
Expected:
- Floor: dark walls, glowing mushrooms scattered on the cave floor backdrop, cyan halo around the spire.
- Mid: continuing dark-teal gradient, glow strips visible on left/right walls.
- Top: wall veins still visible, sanctum platform stands out against the bg.
- No mist patch obscures gameplay-relevant tiles.

- [ ] **Step 8.4: Compare to spec / mockup**

Open `docs/superpowers/specs/2026-05-10-crystal-cavern-level-design.md` §6 and compare against the screenshot. The implementation should match every layer described (gradient walls, rock silhouettes, wall veins, mushroom discs, mist).

If a layer is missing or visibly off (e.g. mist too dense, glow strips too dim), tweak the values and re-screenshot. Iterate up to 3 times before accepting.

- [ ] **Step 8.5: Commit**

```bash
git add src/levels/definitions.js
git commit -m "feat(level): layered cave atmosphere bg for crystalcave"
```

---

## Task 9: Full-level visual + gameplay verification

Final pass — load the level, bot match, validate every acceptance criterion from the spec.

**Files:** none (verification only — fix any regressions in the file you touched last).

- [ ] **Step 9.1: Run full match**

Start the preview, load Crystal Cavern, bots=3, play through one full match.

Action: `preview_start`, select Crystal Cavern + 3 bots + 3 lives, click START.
Expected: match runs to completion, last player alive wins. No crashes, no console errors via `preview_console_logs`.

- [ ] **Step 9.2: Walk the acceptance criteria**

Open the spec acceptance criteria (`docs/superpowers/specs/2026-05-10-crystal-cavern-level-design.md` §9) and check each one:

- [ ] Loads as `crystalcave` and is selectable. (Confirmed in Task 3.)
- [ ] Camera frames y=0 → y=22 when players spread vertically. Test by spawning a bot at top sanctum + a bot on floor. Camera should auto-zoom to fit both.
- [ ] Every tile is destructible. Walk to each named tile zone, hit it, confirm it takes damage and breaks given enough hits. Specifically test: subfloor tough tiles, wall column tiles, sanctum stone, every spire shard.
- [ ] 4 players spawn-spread without collision. Run a 4-bot match and verify no two bots overlap at spawn.
- [ ] Top sanctum reachable via side climb. (Confirmed in Task 4.)
- [ ] Cutting the right chain drops y=17 platform. (Confirmed in Task 6.)
- [ ] No floating decorative assets — every glow disc / mist patch / silhouette is in the background (z<0); no bg primitive at z≥0 unless attached to a tile.
- [ ] 60fps on a mid-range PC w/ 4 players + bots. Use `preview_console_logs` or browser dev tools FPS counter; capture an average over a 30s match segment.

- [ ] **Step 9.3: Final screenshot**

Take a `preview_screenshot` of a full match in progress (mid-air players, broken tiles, particle FX) and save the path.

- [ ] **Step 9.4: Commit any final tweaks**

If any of step 9.2's checks failed and required fixes, commit them as a single tightening commit:

```bash
git add src/levels/definitions.js  # or whichever file you touched
git commit -m "fix(level): crystalcave acceptance-pass tightening"
```

If everything passed without changes, no commit is needed.

---

## Self-review checklist (run after writing the plan, before handing off)

- [x] **Spec coverage:**
  - §1 Overview, design pillars → Tasks 3-8 cover layout, destructibility, hazard restraint.
  - §2.1 Tile zones → Task 3 (subfloor + floor + walls), Task 4 (tiers).
  - §2.2 Walls → Task 3.
  - §2.3 Spire → Task 7.
  - §3 Hazards → Tasks 3 (lava), 5 (icicles).
  - §4 Spawns → Task 4.
  - §5 Weapon spawns → Task 4.
  - §6 Background → Task 8.
  - §7.1 Camera bump → Task 1.
  - §7.2 Particle palette → flagged in Task 7.2 as conditional; if engine doesn't honor `emissive` on tiles, sub-steps 7.2a + 7.2b add support.
  - §7.3 No new hazards → confirmed (only `lava` + `spike pointDown` used; chainAnchor was already in the engine).
  - §9 Acceptance criteria → Task 9 walks each one.
- [x] **Placeholder scan:** No "TBD" / "implement later" / "appropriate error handling" anywhere. Each step has either an exact code block or an exact verification action.
- [x] **Type/name consistency:**
  - `rotZ` (radians) used identically in Tile constructor (Task 2.1) and spire shard defs (Task 7.1).
  - `chainAnchor: { x, y, segs, hp }` matches Gauntlet level's existing usage and `Level.js:_suspendTile` shape.
  - `emissive` / `emissiveIntensity` names match Three.js MeshStandardMaterial fields and existing `bg()` / `bgGlow()` / `bgDisc()` background usage.
  - Level id `crystalcave` consistent across all task references.
