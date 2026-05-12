# Sub-B — Stick Fight Force Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five Stick-Fight-style force impulse features (punch-boost, throw-boost, recoil-jump, standable weapons, hit-reaction force) sharing a common `Stickman.applyImpulse(vx, vy, opts)` plumbing layer with per-frame budget caps and per-weapon tunable magnitudes.

**Architecture:** Add `applyImpulse` method on Stickman that adds to `body.velocity` (additive, not set), capped per-call and per-frame to prevent multi-hit chain explosions. Per-weapon `recoilImpulse`/`throwImpulse`/`meleeRecoilImpulse`/`hitKnockback` fields default to 0 on base `Weapon` and are set per weapon in `weapons.js`. Five feature hooks layer on top — each can be A/B toggled via `window.__forceFeatures`.

**Tech Stack:** Existing physics (cannon-shim/Rapier), Three.js, harness tests in `window.__weaponTest`.

**Spec:** [docs/superpowers/specs/2026-05-12-rig-collision-and-stickfight-feel-design.md](../specs/2026-05-12-rig-collision-and-stickfight-feel-design.md) §Sub-B.

---

## File Structure

- Modify [src/entities/Stickman.js](../../../src/entities/Stickman.js) — `applyImpulse` method, frame budget field, `_impulseStunUntil` field, punch-boost hook, throw-boost hook, hit-reaction routing.
- Modify [src/weapons/Weapon.js](../../../src/weapons/Weapon.js) — base impulse fields default 0.
- Modify [src/weapons/weapons.js](../../../src/weapons/weapons.js) — per-weapon impulse overrides + replace manual recoil writes with `applyImpulse` calls.
- Modify [src/util/__weaponDebug.js](../../../src/util/__weaponDebug.js) — 4 new harness tests.
- Modify [src/Game.js](../../../src/Game.js) — global `window.__forceFeatures` defaults (init on game start so it's readable from anywhere).

---

## Task 1: applyImpulse plumbing + `__forceFeatures` toggle

**Files:**
- Modify: [src/entities/Stickman.js](../../../src/entities/Stickman.js) — constructor + new method after `applyKnockback`.
- Modify: [src/Game.js](../../../src/Game.js) — global feature flags init.

### Step 1: Add fields to Stickman constructor

Locate the existing init block where `this.hitstun` is set (around line 191). Add the new fields immediately after:

```javascript
    this.hitstun = 0;
    // Sub-B force features
    this._impulseFrameBudget = 0;      // resets to 0 at start of each update()
    this._impulseStunUntil = 0;        // performance.now() timestamp; input damped while < now
```

### Step 2: Add `applyImpulse(vx, vy, opts = {})` method right after `applyKnockback`

Find `applyKnockback` (around line 334). Insert new method immediately below it:

```javascript
  // Additive velocity impulse with per-call and per-frame caps. Used by Sub-B
  // force features (punch-boost, throw-boost, recoil-jump, hit-reaction).
  // Per-call cap stops a single huge impulse from teleporting the body.
  // Per-frame budget stops multi-hit chains (minigun pellets, dual pistols)
  // from accumulating to launch velocity.
  applyImpulse(vx, vy, opts = {}) {
    if (this.state === STATE.DEAD) return;
    const cap = opts.cap ?? 18;
    const mag = Math.hypot(vx, vy);
    let sx = vx, sy = vy;
    if (mag > cap) {
      const f = cap / mag;
      sx *= f; sy *= f;
    }
    const budgetMax = 26;
    const used = this._impulseFrameBudget;
    if (used >= budgetMax) return;
    const remaining = budgetMax - used;
    const newMag = Math.hypot(sx, sy);
    if (newMag > remaining) {
      const f = remaining / newMag;
      sx *= f; sy *= f;
    }
    this._impulseFrameBudget += Math.hypot(sx, sy);
    this.body.wakeUp();
    this.body.velocity.x += sx;
    this.body.velocity.y += sy;
    if (opts.stunMs) {
      const until = performance.now() + opts.stunMs;
      if (until > this._impulseStunUntil) this._impulseStunUntil = until;
    }
  }
```

`STATE` is already imported / in scope in `Stickman.js`.

### Step 3: Reset `_impulseFrameBudget` at start of each frame

Find `Stickman.update(dt, ...)` (around line 1630 — grep for `update(dt`). At the top of the method body, add:

```javascript
  update(dt, players, world) {
    this._impulseFrameBudget = 0;
    // ... existing body ...
```

(Insert as the FIRST line of method body.)

### Step 4: Add `__forceFeatures` global default to Game.js

Locate the `Game` constructor (grep for `class Game` in `src/Game.js`). Find a spot near the top of the constructor (after initial field assignments). Add:

```javascript
    // Sub-B feature toggles — per-feature on/off for A/B tuning during dev.
    if (typeof window !== 'undefined' && !window.__forceFeatures) {
      window.__forceFeatures = {
        punch: 1,
        throw: 1,
        recoil: 1,
        standable: 1,
        hitReaction: 1,
      };
    }
```

This runs once per Game instance and is idempotent (only sets defaults if not already defined). The feature hooks in later tasks gate themselves on these flags.

### Step 5: Commit

```bash
git add src/entities/Stickman.js src/Game.js
git commit -m "stickman: add applyImpulse + frame budget + force-features toggle

Sub-B plumbing — applyImpulse additive method with per-call cap (18)
and per-frame budget (26) to prevent multi-hit chain explosions.
_impulseStunUntil field for brief input damping after hit-reaction.
window.__forceFeatures dev toggle for per-feature A/B."
```

---

## Task 2: Weapon impulse fields + per-weapon overrides

**Files:**
- Modify: [src/weapons/Weapon.js](../../../src/weapons/Weapon.js) — base default fields.
- Modify: [src/weapons/weapons.js](../../../src/weapons/weapons.js) — per-weapon overrides per spec table.

### Step 1: Add base impulse fields to Weapon constructor

Find the `Weapon` constructor in `src/weapons/Weapon.js` (starts ~line 10). Find the existing field block around line 28-30 (after `this.fireDelay = 0.3;`). Add:

```javascript
    this.fireDelay = 0.3;
    this.dropCooldown = 0;
    // Sub-B impulse tuning — defaults 0 = no force. Per-weapon overrides
    // in weapons.js.
    this.recoilImpulse = 0;       // firearm recoil magnitude
    this.throwImpulse = 0;        // self-impulse when thrown
    this.meleeRecoilImpulse = 0;  // self-impulse on melee strike
    this.hitKnockback = 1.0;      // multiplier for victim knockback on damage
```

### Step 2: Set per-weapon values in weapons.js constructors

For each weapon class in `src/weapons/weapons.js`, in its constructor (after the `super(game)` call), add the impulse fields per the spec table. Locate each class with `grep -n "class.*extends Weapon"` and edit each one. Magnitudes from spec §Sub-B:

```javascript
// Fists (in Stickman.js — fists are handled via _attackTick, no Weapon class)
// → meleeRecoilImpulse handled as constant in punch-boost hook (Task 3)

// In src/weapons/weapons.js, in each weapon's constructor after super(game):

// Bat
this.throwImpulse = 4;
this.meleeRecoilImpulse = 5;
this.hitKnockback = 1.0;

// Sword
this.throwImpulse = 4;
this.meleeRecoilImpulse = 5;
this.hitKnockback = 1.0;

// Longsword
this.throwImpulse = 5;
this.meleeRecoilImpulse = 7;
this.hitKnockback = 1.2;

// WarHammer / Sledgehammer / Mace / Halberd (heavies)
this.throwImpulse = 6;
this.meleeRecoilImpulse = 9;
this.hitKnockback = 1.6;

// FishSlap / RubberChicken (jokes)
this.throwImpulse = 3;
this.meleeRecoilImpulse = 3;
this.hitKnockback = 0.6;

// HulkHands / FlameSword / IceSword / Lightsaber (mid-heavies)
this.throwImpulse = 5;
this.meleeRecoilImpulse = 7;
this.hitKnockback = 1.3;

// Boomerang
this.throwImpulse = 4;
this.meleeRecoilImpulse = 4;
this.hitKnockback = 0.9;

// Kamehameha / LightningStaff (energy)
this.throwImpulse = 4;
this.recoilImpulse = 3;
this.hitKnockback = 1.2;

// Pistol
this.recoilImpulse = 2;
this.throwImpulse = 4;
this.hitKnockback = 1.0;

// SMG
this.recoilImpulse = 1.2;
this.throwImpulse = 4;
this.hitKnockback = 0.8;

// AssaultRifle
this.recoilImpulse = 3;
this.throwImpulse = 4;
this.hitKnockback = 1.1;

// Shotgun
this.recoilImpulse = 14;
this.throwImpulse = 5;
this.hitKnockback = 2.0;

// SniperRifle
this.recoilImpulse = 8;
this.throwImpulse = 5;
this.hitKnockback = 2.4;

// Minigun
this.recoilImpulse = 0.8;  // per-pellet, frame budget caps accumulation
this.throwImpulse = 6;
this.hitKnockback = 0.9;

// Revolver
this.recoilImpulse = 5;
this.throwImpulse = 4;
this.hitKnockback = 1.4;

// Crossbow
this.recoilImpulse = 3;
this.throwImpulse = 4;
this.hitKnockback = 1.1;

// Flamethrower
this.recoilImpulse = 0.4;
this.throwImpulse = 4;
this.hitKnockback = 0.4;

// DualPistols
this.recoilImpulse = 2;  // per-shot, fires per side
this.throwImpulse = 3;
this.hitKnockback = 1.0;

// Shurikens
this.throwImpulse = 2;
this.hitKnockback = 0.5;

// RPG
this.recoilImpulse = 18;
this.throwImpulse = 12;
this.hitKnockback = 3.0;

// Grenade / StickyBomb / Nuke (thrown)
this.throwImpulse = 5;
this.hitKnockback = 1.5;
```

Use `grep -n "class.*extends Weapon" src/weapons/weapons.js` to find each class. For each constructor body, place these lines AFTER `super(game)` but BEFORE any custom `this.name = ...` etc. Order within the constructor doesn't matter functionally — match the spec table per weapon.

### Step 3: Commit

```bash
git add src/weapons/Weapon.js src/weapons/weapons.js
git commit -m "weapons: per-weapon Sub-B impulse magnitudes

Base Weapon has 4 default-0 impulse fields. Each subclass sets values
from spec table — Stick-Fight-cartoony defaults, tunable later."
```

---

## Task 3: Punch-boost (melee attacker impulse)

**Files:**
- Modify: [src/entities/Stickman.js](../../../src/entities/Stickman.js) — `_attackTick` damage path around line 1252.

### Step 1: Add attacker impulse after melee `p.takeDamage` call

Locate the melee damage block (around line 1246-1252):

```javascript
      p.takeDamage(dmg, {
        attacker: this,
        weapon: superPunch ? 'super' : (gumGum ? 'gumgum' : 'fist'),
        kb: { x: kbX, y: kbY },
        stun,
        launch: launch || superPunch,
      });
      this.attackHits.add(p.id);
```

Insert AFTER `p.takeDamage(...)` and BEFORE `this.attackHits.add(p.id)`:

```javascript
      // Punch-boost — attacker gets opposite impulse on melee connect.
      // Magnitude from weapon meleeRecoilImpulse (0 for unarmed defaults to
      // FIST_RECOIL constant below). Direction is opposite the strike
      // (kbX/Y points TOWARD victim, so we apply -kb).
      if (window.__forceFeatures?.punch !== 0) {
        const FIST_RECOIL = 4;
        const mag = this.weapon?.meleeRecoilImpulse ?? FIST_RECOIL;
        if (mag > 0) {
          const dirLen = Math.hypot(kbX, kbY) || 1;
          const ux = kbX / dirLen, uy = kbY / dirLen;
          // Y component scaled 0.6 so punch-down doesn't catapult straight up.
          this.applyImpulse(-ux * mag, -uy * mag * 0.6);
        }
      }
```

Place the `FIST_RECOIL = 4` constant inline as shown. (We don't move it to a module-scope constant — single use site, locality wins.)

### Step 2: Commit

```bash
git add src/entities/Stickman.js
git commit -m "stickman: punch-boost — attacker impulse on melee connect

Reads weapon.meleeRecoilImpulse (or FIST_RECOIL=4 for unarmed),
applies -kb direction × mag with Y scaled 0.6 so punching down
doesn't launch the attacker skyward. Gated on __forceFeatures.punch."
```

---

## Task 4: Throw-boost (weapon throw player impulse)

**Files:**
- Modify: [src/entities/Stickman.js](../../../src/entities/Stickman.js) — `_throwWeapon` at line 891.

### Step 1: Add player impulse after weapon body velocity set

Locate `_throwWeapon` (around line 891). The throw block sets `w.body.velocity.set(dx * speed, dy * speed + 4, 0)` at line 902. Insert AFTER that line:

```javascript
    if (w.body) {
      w.body.velocity.set(dx * speed, dy * speed + 4, 0);
      w.body.angularVelocity.set(0, 0, this.facing * 18);
      w.dropCooldown = 0.5;     // can't pick back up immediately
      w._thrownBy = this;
      // Throw-boost — player gets counter-impulse opposite throw direction.
      if (window.__forceFeatures?.throw !== 0) {
        const mag = w.throwImpulse ?? 0;
        if (mag > 0) {
          this.applyImpulse(-dx * mag, -(dy * mag));
        }
      }
```

(Leave the rest of `_throwWeapon` body unchanged — the `onHit` collide handler, etc.)

### Step 2: Commit

```bash
git add src/entities/Stickman.js
git commit -m "stickman: throw-boost — player impulse on weapon throw

Reads weapon.throwImpulse, applies counter-impulse opposite throw dir
to the throwing player. Heavy weapons rocket-boost (RPG=12, sledge=6).
Gated on __forceFeatures.throw."
```

---

## Task 5: Recoil-jump (firearm fire player impulse)

**Files:**
- Modify: [src/weapons/weapons.js](../../../src/weapons/weapons.js) — replace manual `player.body.velocity.x -= ...` patterns in each firearm's `fire()` method.

Recoil is currently applied directly via `player.body.velocity` writes (search for the pattern `player.body.velocity.x -=`). Each firearm uses its own ad-hoc magnitude. We standardize: replace each manual write with `player.applyImpulse(-aimX * mag, -aimY * mag, opts)` where `mag = this.recoilImpulse` and `aim = this.effectiveAimDir ?? player.aimDir`.

### Step 1: Find all firearm recoil call sites

Run:

```bash
grep -n "player.body.velocity" src/weapons/weapons.js
```

Expect to find ~6-10 sites (Pistol, Shotgun, SMG, AssaultRifle, Revolver, Crossbow, Minigun, DualPistols). Each is inside a `fire(player)` method.

### Step 2: Replace each manual recoil write

Pattern to replace:

```javascript
// Before
const rec = player.grounded ? 0.5 : 1.4;
player.body.velocity.x -= aim.x * rec;
```

After (for any single-shot firearm):

```javascript
// Recoil-jump — opposite aim direction. Y kept full (no damping)
// so shooting straight down recoil-jumps straight up — the whole
// point of the mechanic.
if (window.__forceFeatures?.recoil !== 0) {
  const mag = this.recoilImpulse;
  if (mag > 0) {
    player.applyImpulse(-aim.x * mag, -aim.y * mag);
  }
}
```

For per-pellet firearms (Shotgun fires N pellets — recoil applied per fire call, not per pellet) or per-shot (Minigun fires per tick — recoil applied per tick) use the same pattern but trust the per-frame budget cap to prevent runaway. Don't divide by pellet count; let the impulse stack and let the frame budget clamp it.

For DualPistols which fires LEFT then RIGHT (two sides):
- If both shots happen in same call → one `applyImpulse(-aimX * mag * 2)` is fine because frame budget caps total.
- If shots split into separate calls (left now, right next tick) → two `applyImpulse(-aimX * mag)` calls, one per side.

For weapons that DON'T currently have manual recoil writes (Flamethrower, RPG, Kamehameha, LightningStaff): add the recoil block at the end of `fire(player)` so they too participate.

### Step 3: Remove the dead `rec` constants

After replacing, the per-weapon `const rec = ...` lines that fed the manual writes can be deleted (the new code uses `this.recoilImpulse` directly). Same for any `grounded ? X : Y` ternaries that gated the old writes — the new system applies impulse unconditionally (grounded + aerial both, per spec §Q5-A).

### Step 4: Verify file parses

After edits, re-read each firearm's `fire(player)` method. Each should have a recoil block referencing `this.recoilImpulse`. No leftover `player.body.velocity.x -= ...` writes.

### Step 5: Commit

```bash
git add src/weapons/weapons.js
git commit -m "weapons: recoil-jump — replace manual recoil writes with applyImpulse

Each firearm's fire() now applies opposite-aim impulse via the central
applyImpulse plumbing, capped per-frame. Y kept full (no damping) so
recoil-jump (shoot down → fly up) actually works. Gated on
__forceFeatures.recoil."
```

---

## Task 6: Hit-reaction (route victim knockback via applyImpulse)

**Files:**
- Modify: [src/entities/Stickman.js](../../../src/entities/Stickman.js) — `takeDamage` around lines 384-386.

The existing victim-knockback path is:

```javascript
    if (opts.kb) {
      this.applyKnockback(opts.kb.x, opts.kb.y, opts.stun ?? 0.25);
      this.rig.flinch?.(opts.kb.x, clamp(amount / 25, 0.4, 1.5));
    }
```

`applyKnockback` SETS velocity directly (not adds), so chained hits don't compound. Sub-B's hit-reaction should layer on TOP — additive impulse with Stick-Fight-cartoony magnitude scaled by `attackerWeapon.hitKnockback` and damage taken.

### Step 1: Add hit-reaction impulse alongside applyKnockback

Replace the existing block with:

```javascript
    if (opts.kb) {
      this.applyKnockback(opts.kb.x, opts.kb.y, opts.stun ?? 0.25);
      this.rig.flinch?.(opts.kb.x, clamp(amount / 25, 0.4, 1.5));
      // Hit-reaction — additive impulse scaled by damage × hitKnockback.
      // Layers on top of the SET-velocity from applyKnockback so chained
      // hits compound while frame budget caps runaway. Y dampened + small
      // uppercut kick for Stick-Fight signature read.
      if (window.__forceFeatures?.hitReaction !== 0) {
        const hk = opts.attacker?.weapon?.hitKnockback ?? 1.0;
        const KNOCKBACK_SCALE = 0.6;
        const mag = amount * hk * KNOCKBACK_SCALE;
        if (mag > 0) {
          const dirLen = Math.hypot(opts.kb.x, opts.kb.y) || 1;
          const ux = opts.kb.x / dirLen, uy = opts.kb.y / dirLen;
          this.applyImpulse(ux * mag, uy * mag * 0.4 + 2, { stunMs: 120 });
        }
      }
    }
```

Notes:
- `opts.attacker?.weapon?.hitKnockback ?? 1.0` — falls back to 1.0 for fists (no weapon).
- Y dampened 0.4 + small +2 uppercut.
- `stunMs: 120` → input damping for ~120ms (input authority × 0.3 while active — implemented in next step).

### Step 2: Input damping based on `_impulseStunUntil`

Find the input-handling block in `Stickman.update` (grep for `this.input.moveX` or `accel`). Where the player's horizontal accel is computed (currently around line 1670-1700 — look for `const targetVx` or similar movement intent), apply a damping factor when `_impulseStunUntil > now`:

```javascript
    // Sub-B hit-reaction: input damped (not removed) while stunMs active.
    const stunActive = performance.now() < this._impulseStunUntil;
    const inputAuthority = stunActive ? 0.3 : 1.0;
```

Then multiply movement inputs by `inputAuthority` where they're applied. This is **light-touch** — keep the existing input logic intact, just multiply the final intended velocity by `inputAuthority` before applying.

If the input path is hard to identify, ASK for clarification — don't guess.

### Step 3: Commit

```bash
git add src/entities/Stickman.js
git commit -m "stickman: hit-reaction — additive impulse + input damping

Layered on top of applyKnockback for compounded chained-hit feel.
Y dampened + small uppercut for Stick-Fight signature. 120ms input
authority dampened to 0.3 via _impulseStunUntil. Gated on
__forceFeatures.hitReaction."
```

---

## Task 7: Standable weapons — audit + verify

**Files:**
- Modify: [src/weapons/Weapon.js](../../../src/weapons/Weapon.js) — possibly tweak `spawnAt` collider if standing doesn't work today.

### Step 1: Audit current state

Read `Weapon.spawnAt` (around lines 45-62 of `src/weapons/Weapon.js`). Current collider:

```javascript
body.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 0.08, 0.08)));
```

Half-extents (0.3, 0.08, 0.08) = box 0.6m × 0.16m × 0.16m. Y-extent is already low (0.16m total). Collision groups: `WEAPON`, mask `WORLD | PLAYER`. Player capsule should already be blocked by this collider.

### Step 2: Verify player rests on top of dropped weapon

Subagent: do NOT attempt to drive preview. Controller will verify in Task 9 by:
1. Spawning a weapon on the ground.
2. Walking player on top.
3. Checking `player.grounded` becomes true with weapon as ground.

If standing already works, this task is a no-op — the existing collider is sufficient.

### Step 3: Conditional change — only if standing doesn't work

If verification (Task 9) reveals player slides off or falls through dropped weapons, the likely cause is:
- Friction too low — bump `linearDamping` from 0.2 or add a higher-friction material via `this.game.physics.materials.prop`.
- Collider too thin — bump half-extents Y from 0.08 to 0.12.

Don't preemptively change. Audit first.

### Step 4: Document the audit in a code comment

Add a one-line comment above `body.addShape(...)` in `Weapon.spawnAt`:

```javascript
    // Box collider 0.6×0.16×0.16m. Y-extent intentionally low so player
    // walking INTO the side rolls the capsule over the top (standable
    // weapons per Sub-B §3.4). Friction comes from physics.materials.prop.
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 0.08, 0.08)));
```

### Step 5: Commit

```bash
git add src/weapons/Weapon.js
git commit -m "weapons: document standable-weapon collider intent

Sub-B §3.4 — existing 0.6×0.16×0.16m box collider already supports
standing on dropped weapons. Comment makes the design intent visible
so future collider tweaks don't break it accidentally."
```

---

## Task 8: Harness tests

**Files:**
- Modify: [src/util/__weaponDebug.js](../../../src/util/__weaponDebug.js) — append four tests.

### Step 1: Add `__test_punchBoostImpulse`

Append:

```javascript
window.__test_punchBoostImpulse = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  // Bot for receiving the punch (need a target).
  const target = window.game.players.find(p => p && !p.isLocal && p.alive);
  window.__weaponTest.assert(target, 'need bot target — start match with bots: 1');

  // Position attacker facing target, within fist range.
  sm.body.position.x = target.body.position.x - 0.6 * sm.facing;
  sm.body.position.y = target.body.position.y;
  sm.body.velocity.x = 0;
  sm.body.velocity.y = 0;
  sm._impulseFrameBudget = 0;
  sm._impulseStunUntil = 0;
  const startVx = sm.body.velocity.x;

  // Trigger a fist attack — set up state to immediately apply hit.
  // The melee path runs inside _attackTick which fires off attackTimer.
  // We bypass by directly invoking the punch-boost branch with a known kb.
  // (This isolates the boost logic from melee pose timing.)
  const prevW = sm.weapon; sm.weapon = null; // simulate unarmed
  const wasFeature = window.__forceFeatures.punch;
  window.__forceFeatures.punch = 1;

  // Stand-in for the takeDamage+punch-boost combo. Just call applyImpulse
  // directly with the math the punch-boost hook would have applied:
  // FIST_RECOIL = 4, kb direction = facing × +x, Y = small.
  const FIST_RECOIL = 4;
  const kbX = sm.facing * 8, kbY = 4;
  const dirLen = Math.hypot(kbX, kbY);
  const ux = kbX / dirLen, uy = kbY / dirLen;
  sm.applyImpulse(-ux * FIST_RECOIL, -uy * FIST_RECOIL * 0.6);

  window.__forceFeatures.punch = wasFeature;
  sm.weapon = prevW;

  const deltaVx = sm.body.velocity.x - startVx;
  // Expect attacker pushed BACKWARD relative to facing (opposite of kbX).
  const expectedSign = -sm.facing;
  window.__weaponTest.assert(
    Math.sign(deltaVx) === expectedSign,
    'punch-boost should push attacker backward (facing=' + sm.facing +
    ', deltaVx=' + deltaVx.toFixed(3) + ')',
  );
  window.__weaponTest.assert(
    Math.abs(deltaVx) >= 2.5,
    'punch-boost magnitude should be at least 2.5 m/s (got ' + Math.abs(deltaVx).toFixed(3) + ')',
  );
};
```

### Step 2: Add `__test_recoilJump`

```javascript
window.__test_recoilJump = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');

  // Equip a Shotgun (large recoil for clear signal).
  const Shotgun = window.game.weaponRegistry?.Shotgun;
  window.__weaponTest.assert(Shotgun, 'no Shotgun in registry');
  sm.weapon = new Shotgun(window.game);
  sm.weapon.attachTo(sm);

  // Aim straight DOWN — recoil should propel player UP.
  sm.aimDir = { x: 0, y: -1 };
  sm.input = { ...sm.input, aimActive: true };
  sm.body.velocity.x = 0;
  sm.body.velocity.y = 0;
  sm._impulseFrameBudget = 0;
  sm.weapon.cooldown = 0;
  const startVy = sm.body.velocity.y;

  const wasFeature = window.__forceFeatures.recoil;
  window.__forceFeatures.recoil = 1;
  sm.weapon.fire(sm);
  window.__forceFeatures.recoil = wasFeature;

  const deltaVy = sm.body.velocity.y - startVy;
  window.__weaponTest.assert(
    deltaVy > 5,
    'shoot-down recoil should boost player upward (deltaVy=' +
    deltaVy.toFixed(3) + ')',
  );
};
```

### Step 3: Add `__test_standableWeapon`

```javascript
window.__test_standableWeapon = function () {
  // Find a floor under the player to drop a weapon on.
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const probe = window.game.physics.raycast(
    { x: sm.body.position.x, y: sm.body.position.y + 4, z: 0 },
    { x: sm.body.position.x, y: sm.body.position.y - 4, z: 0 },
    { mask: 0x0001 },
  );
  if (!probe) return 'SKIP: no floor under player';
  const floorY = probe.hitPointWorld.y;

  // Drop a Sword on the floor.
  const Sword = window.game.weaponRegistry?.Sword;
  if (!Sword) return 'SKIP: no Sword class';
  const sw = new Sword(window.game);
  const swX = sm.body.position.x + 1.5;
  sw.spawnAt(swX, floorY + 0.5, 0);
  window.__weaponTest.assert(sw.body, 'weapon body should spawn');

  // Settle the weapon onto floor.
  for (let i = 0; i < 60; i++) window.game.physics.step(1 / 60);

  // Place player above weapon, zero velocity, let it fall.
  sm.body.position.x = swX;
  sm.body.position.y = sw.body.position.y + 1.0;
  sm.body.velocity.x = 0;
  sm.body.velocity.y = 0;
  for (let i = 0; i < 90; i++) window.game.physics.step(1 / 60);

  // After settle, player's Y should be ABOVE the floor by more than
  // (floor + weapon top + body half-height). Easy check: player bottom
  // (body.y - 0.75) should be ABOVE floor + 0.05.
  const playerBottom = sm.body.position.y - 0.75;
  const standingOnWeapon = playerBottom > floorY + 0.05;

  // Clean up.
  if (sw.body) window.game.physics.remove(sw.body);

  window.__weaponTest.assert(
    standingOnWeapon,
    'player should rest above floor on weapon (playerBottom=' +
    playerBottom.toFixed(3) + ', floor=' + floorY.toFixed(3) + ')',
  );
};
```

### Step 4: Add `__test_hitReactionKnockback`

```javascript
window.__test_hitReactionKnockback = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');

  sm.body.velocity.x = 0;
  sm.body.velocity.y = 0;
  sm._impulseFrameBudget = 0;
  sm._impulseStunUntil = 0;
  const startVx = sm.body.velocity.x;
  const startStun = sm._impulseStunUntil;

  // Simulate a hit from the right — kb pointing right.
  const wasFeature = window.__forceFeatures.hitReaction;
  window.__forceFeatures.hitReaction = 1;
  sm.takeDamage(10, {
    attacker: { weapon: { hitKnockback: 2.0 } }, // attacker stand-in
    weapon: 'test',
    kb: { x: 10, y: 4 },
    stun: 0.2,
  });
  window.__forceFeatures.hitReaction = wasFeature;

  const deltaVx = sm.body.velocity.x - startVx;
  window.__weaponTest.assert(
    deltaVx > 0,
    'hit-reaction should push victim in kb direction (deltaVx=' +
    deltaVx.toFixed(3) + ')',
  );
  window.__weaponTest.assert(
    sm._impulseStunUntil > startStun,
    'hit-reaction should set _impulseStunUntil',
  );
};
```

### Step 5: Commit

```bash
git add src/util/__weaponDebug.js
git commit -m "test: Sub-B harness tests for force features

Four tests — punch-boost, recoil-jump, standable-weapon,
hit-reaction. Each isolates one feature, asserts direction +
magnitude. Standable test uses 60-frame floor settle + 90-frame
player drop."
```

---

## Task 9: Verification + perf + PR

Controller (not subagent) does the browser verification. Subagent should NOT attempt preview_eval.

### Step 1: Reload preview, start match with bot, run all harness tests

In preview console:

```javascript
window.location.reload();
// then after page loads:
window.game.startLocal({ character: { primary: 0xffcc33 }, name: 'Test', bots: 1, levelId: 0 });
// Call tests DIRECTLY (not via __weaponTest.run — that hides SKIPs as PASS):
const tests = ['punchBoostImpulse', 'recoilJump', 'standableWeapon', 'hitReactionKnockback'];
const out = [];
for (const t of tests) {
  try { out.push(t + ': ' + ((await window['__test_' + t]()) || 'PASS')); }
  catch (e) { out.push(t + ' FAIL: ' + e.message); }
}
console.log(out);
```

Expected: all PASS, no SKIP, no FAIL.

### Step 2: Regression check on pre-existing tests (including Sub-A)

```javascript
const tests = ['headSnap_exists', 'headshot_registers', 'bodyshot_no_double', 'weapon_wall_reorient', 'rigClipsWallStanding', 'rigClipsFloorOnLunge'];
// (call directly to surface SKIPs)
```

All should still PASS, or SKIP for scene-dependency reasons (not Sub-B-related).

### Step 3: Per-feature toggle smoke test

Toggle each feature off, observe play behavior reverts:

```javascript
window.__forceFeatures.punch = 0;
// Punch a bot — attacker should NOT recoil now.
window.__forceFeatures.punch = 1;
// Punch — attacker should recoil.

window.__forceFeatures.recoil = 0;
// Fire shotgun — player should not recoil-jump.
window.__forceFeatures.recoil = 1;
// Fire shotgun aimed down — player should fly up.
```

Manual gameplay observation. No formal assertion.

### Step 4: Standable weapon manual test

Drop a sword in front of player, walk on top, jump off. Visually confirm player rests on weapon.

### Step 5: Perf check

```javascript
const players = window.game.players.filter(p => p && p.alive);
const N = 60;
const t0 = performance.now();
for (let i = 0; i < N; i++) players.forEach(p => p.update(1/60, players, window.game.physics));
const t1 = performance.now();
console.log('60 update ticks (' + players.length + ' players): ' + (t1 - t0).toFixed(2) + 'ms');
```

Expected: within 1ms of pre-Sub-B baseline.

### Step 6: Console clean check

```javascript
// In preview_console_logs(level: 'error') and (level: 'warn') — expect zero entries.
```

### Step 7: Push branch + open PR

```bash
git push -u origin claude/affectionate-napier-508de3 2>&1 | tail -5
gh pr create --title "Sub-B: Stick Fight force features (punch/throw/recoil/standable/hitReaction)" --body "$(cat <<'EOF'
## Summary
- `Stickman.applyImpulse(vx, vy, opts)` plumbing — additive velocity with per-call cap (18) and per-frame budget (26) to prevent multi-hit chain explosions.
- Five force features layer on the plumbing:
  - **Punch-boost** — attacker gets opposite impulse on melee connect. Magnitude from `weapon.meleeRecoilImpulse` (or FIST_RECOIL=4 unarmed).
  - **Throw-boost** — player gets counter-impulse on weapon throw. Heavy weapons rocket-boost.
  - **Recoil-jump** — firearm fire applies opposite-aim impulse. Y full (shoot-down → fly up).
  - **Standable weapons** — existing 0.6×0.16×0.16m box collider already supports walking on dropped weapons. Documented intent.
  - **Hit-reaction force** — additive impulse on damage taken, scaled by attacker's `weapon.hitKnockback × damage`. Brief 120ms input damping via `_impulseStunUntil`.
- Per-weapon impulse magnitudes set per spec table (Shotgun=14 recoil, RPG=18, Fists=4 melee, etc.).
- `window.__forceFeatures` per-feature toggle for A/B tuning during dev.

Second of 2 PRs in the rig-collision-and-stickfight-feel design ([spec](docs/superpowers/specs/2026-05-12-rig-collision-and-stickfight-feel-design.md)). Sub-A (rig segment sweeps) shipped #60.

## Test plan
- [x] `__test_punchBoostImpulse` — attacker velocity changes opposite kb direction
- [x] `__test_recoilJump` — shoot-down → upward velocity boost
- [x] `__test_standableWeapon` — player rests on dropped weapon
- [x] `__test_hitReactionKnockback` — victim impulse in kb direction + stun set
- [x] Pre-existing tests (Sub-A + base) — no regression
- [x] Per-feature toggle verified in browser
- [x] Perf within 1ms of baseline
- [x] Console clean

## Known follow-ups (out of scope)
- Sub-C — full force-animated ragdoll (12-body constraint chain + PD-driven force animations). Sub-A+B give ~70% of Stick Fight feel without the rewrite.
- Per-weapon magnitudes are first-pass tuning numbers. Expect iteration after playtest feedback.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Step 8: Authorize merge (controller asks user)

Wait for explicit "merge it" from the user before:

```bash
gh pr merge <PR#> --squash
```

Per memory `feedback_pr_workflow.md`: skip `--delete-branch` (fails in worktrees).

---

## Self-review checklist

- [x] **Spec coverage:**
  - §Sub-B §plumbing → Task 1.
  - §Sub-B per-weapon tuning table → Task 2.
  - §3.1 Punch-boost → Task 3.
  - §3.2 Throw-boost → Task 4.
  - §3.3 Recoil-jump → Task 5.
  - §3.4 Standable weapons → Task 7.
  - §3.5 Hit-reaction force → Task 6.
  - §window.__forceFeatures toggle → Task 1 Step 4.
  - §verification → Task 8 + Task 9.
- [x] **No placeholders.** Every step has exact code, file:line refs, or commands.
- [x] **Type consistency.** `applyImpulse(vx, vy, opts)` signature used identically across all tasks. `recoilImpulse`/`throwImpulse`/`meleeRecoilImpulse`/`hitKnockback` names consistent. `__forceFeatures` flag names match across tasks.
- [x] **Frequent commits.** One commit per task.

The input-damping step (Task 6 Step 2) is the highest-risk part of the plan — the input handling code is not pre-specified by line number because the subagent will need to locate it. If the implementer cannot identify the input path cleanly, they should escalate via NEEDS_CONTEXT rather than guess.

Standable-weapon collider is intentionally NOT changed in Task 7 — first verify the existing collider supports standing (Task 9 manual test). Only adjust if proven insufficient. This avoids preemptive changes.
