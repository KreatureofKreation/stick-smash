# Hand-to-Hand Combat Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat jab→cross→kick combo with Budokai Tenkaichi-style chain + heavy ender, add directional differentiation (5-way ground heavies, 3-way air heavies), aerial 2-hit chain, slide kick, back-counter parry, prone crouch, slide animation overhaul. Reduce triple jump to double jump.

**Architecture:** Combat state machine on `Stickman` keyed on `moveId`, driven by a static `MOVE_TABLE` of strike profiles. Rig dispatches per-move pose functions. No new files. Preserves weapons, super-punch, gum-gum, and ragdoll-on-launch hooks.

**Tech Stack:** Vanilla ES modules, Three.js for rig render, Cannon-ES shim for physics. No build step. No test framework. Verification is browser-only via `preview_eval` against the local dev server (per project memory).

**Spec:** [`docs/superpowers/specs/2026-05-11-hand-to-hand-combat-overhaul-design.md`](../specs/2026-05-11-hand-to-hand-combat-overhaul-design.md)

---

## File Structure

Files touched (no new files):

- `src/entities/Stickman.js` — combat FSM, state additions, `MOVE_TABLE`, `_strikeFSM`, `_attackTick` rewrite, `takeDamage` extensions (launch flag, back-counter parry path), `airJumps` reduction.
- `src/entities/StickmanRig.js` — `POSES` dispatcher keyed on `moveId`, 14 pose functions, slide pose overhaul, prone crouch mode, charge-tell visuals.
- `src/ai/Bot.js` — directional heavy choice, slide-kick trigger, back-counter usage.

Verification helpers (browser console / `preview_eval`):

- `window.game?.localPlayer` — exposes the local fighter for state inspection.
- `window.game?.players` — array of all fighters.

---

## Verification Notes

Per project memory: no test framework exists. Each task ends with a `preview_eval`-style verification step that inspects state, mutates inputs to force a code path, or counts particles. `preview_screenshot` times out — do **not** use it. Use `preview_snapshot` if visual structure matters.

Server start (assumed running once per session):

```
preview_start url: "http://localhost:5500/" (or the existing index.html port)
```

If no preview server is running, the executor starts one. Subsequent verification steps assume the server is up.

---

## Task 1: Reduce air jumps from 2 to 1 (triple → double)

**Files:**
- Modify: `src/entities/Stickman.js` (line ~137-138)

- [ ] **Step 1: Change `airJumps` value**

In `src/entities/Stickman.js`, locate this block (around line 137):

```js
this.airJumps = 2; // 1 ground + 2 air = up to triple jump per landing
this.airJumpsLeft = 2;
```

Change to:

```js
this.airJumps = 1; // 1 ground + 1 air = double jump
this.airJumpsLeft = 1;
```

Also check for any other `airJumps = 2` or `airJumpsLeft = 2` resets in the same file (search "airJumps" — there is one in the grounded-landing reset around line 537–540). Change those to `1` too.

- [ ] **Step 2: Verify**

Start a match (any level). In console:

```js
const p = window.game.localPlayer;
console.log('airJumps:', p.airJumps, 'left:', p.airJumpsLeft);
// Expected: airJumps: 1  left: 1
// After 1 ground jump + 1 air jump, attempting a third should not change y velocity.
```

Press Space twice mid-air, then again — third Space should do nothing.

- [ ] **Step 3: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(combat): reduce air jumps from triple to double"
```

---

## Task 2: Add new combat state fields on Stickman

**Files:**
- Modify: `src/entities/Stickman.js` (Combat block, around line 145–154)

- [ ] **Step 1: Add fields**

In `src/entities/Stickman.js`, locate the `// Combat` block (around line 145). Replace the existing combo lines with the new state shape. **Keep** `attackTimer`, `attackCooldown`, `attackHits`, `hitstun`, `invuln`, `flashAmount`, etc. **Replace** the `comboStep`/`comboTimer`/`_attackStep`/`kicking` lines with:

```js
// Combat — combo state
this.moveId = null;          // 'jab'|'cross'|'hook'|'knee'|'spinBack'
                              // |'heavyNeutral'|'heavyUp'|'heavyDown'|'heavyForward'|'heavyBack'
                              // |'airJab'|'airHook'|'airHeavyN'|'airHeavyU'|'airHeavyD'
                              // |'slideKick'  or null
this.chainStep = 0;          // 0..4 ground light chain
this.airChainStep = 0;       // 0..1 air light chain
this.chainTimer = 0;         // s remaining in chain window before reset
this.charging = false;
this.chargeStartedAt = 0;    // performance.now() ms when attack pressed
this._pressDir = { x: 0, y: 0 };  // dir cached at press
this.parryUntil = 0;         // ms — back-counter active until
this.parryRecoverUntil = 0;  // ms — back-counter whiff lockout end
this.juggled = false;        // launched-airborne flag
this.juggledUntil = 0;       // ms
this.juggleHits = 0;         // count of launched hits this window

// Back-compat aliases for legacy code paths (rig reads, weapons, etc.).
// Keep these as derived flags so renders + bot AI continue working unchanged
// during partial rollouts.
this._attackStep = 0;        // legacy — rig reads this
this.kicking = false;        // legacy — rig reads this
```

Also add to `_prev` (line 118):

```js
this._prev = { jump: false, attack: false, grab: false, special: false, throw: false };
```

becomes:

```js
this._prev = { jump: false, attack: false, grab: false, special: false, throw: false };
this._attackPressedAt = 0;   // ms — last press timestamp for hold detection
```

- [ ] **Step 2: Verify field presence**

```js
const p = window.game.localPlayer;
console.log({
  moveId: p.moveId,
  chainStep: p.chainStep,
  charging: p.charging,
  parryUntil: p.parryUntil,
  juggled: p.juggled,
});
// Expected: moveId: null, chainStep: 0, charging: false, parryUntil: 0, juggled: false
```

- [ ] **Step 3: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(combat): add state fields for FSM, parry, juggle"
```

---

## Task 3: Track attack press/release timing in tick

**Files:**
- Modify: `src/entities/Stickman.js` (around lines 1215–1224)

- [ ] **Step 1: Edge + timing detection**

Find the edge-detection block in `tick()` around line 1215:

```js
now.attackPressed = !frozen && now.attack && !this._prev.attack;
```

Replace the attack-related edge lines with:

```js
now.attackPressed = !frozen && now.attack && !this._prev.attack;
now.attackReleased = !frozen && !now.attack && this._prev.attack;
if (now.attackPressed) this._attackPressedAt = performance.now();
now.attackHeldFor = now.attack
  ? (performance.now() - this._attackPressedAt) / 1000
  : 0;
```

`this._prev.attack = now.attack;` already exists below — leave it.

- [ ] **Step 2: Verify timing reads**

```js
const p = window.game.localPlayer;
// Press and hold J on PC, then in console:
console.log('heldFor:', p.input.attackHeldFor, 'pressed:', p.input.attackPressed, 'released:', p.input.attackReleased);
// While holding: heldFor counts up. On release: released:true for one frame.
```

- [ ] **Step 3: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(combat): track attackReleased + attackHeldFor edges"
```

---

## Task 4: Define MOVE_TABLE constant

**Files:**
- Modify: `src/entities/Stickman.js` (top of file, after imports, before class)

- [ ] **Step 1: Insert MOVE_TABLE**

Locate the imports + constants block at the top of `src/entities/Stickman.js`. After the existing constants (BODY_HEIGHT, STATE, etc.), insert:

```js
// Strike profile table. Every move shares this shape.
// activeStart/activeEnd are normalized 0..1 progress through `dur`.
// heightOffset adjusts hitbox Y from body center (negative = low, positive = high).
// launch=true means the hit triggers ragdoll on the victim.
// kbX is multiplied by attacker.facing in the hitbox loop.
const MOVE_TABLE = {
  // Ground lights — chain step 0..4
  jab:          { type:'light', dur:0.14, activeStart:0.25, activeEnd:0.70, reach:0.95, radius:1.0, dmg:6,  kbX:5,  kbY:1, stun:0.15, launch:false, heightOffset:0.15, recovery:0.18 },
  cross:        { type:'light', dur:0.16, activeStart:0.30, activeEnd:0.75, reach:1.00, radius:1.0, dmg:8,  kbX:7,  kbY:1, stun:0.20, launch:false, heightOffset:0.15, recovery:0.20 },
  hook:         { type:'light', dur:0.18, activeStart:0.30, activeEnd:0.75, reach:0.90, radius:1.0, dmg:10, kbX:6,  kbY:2, stun:0.25, launch:false, heightOffset:0.15, recovery:0.22 },
  knee:         { type:'light', dur:0.18, activeStart:0.35, activeEnd:0.70, reach:0.70, radius:1.0, dmg:11, kbX:5,  kbY:4, stun:0.30, launch:false, heightOffset:0.00, recovery:0.22 },
  spinBack:     { type:'light', dur:0.24, activeStart:0.40, activeEnd:0.75, reach:1.10, radius:1.0, dmg:14, kbX:12, kbY:3, stun:0.35, launch:false, heightOffset:0.20, recovery:0.30 },
  // Ground heavies — direction at release
  heavyNeutral: { type:'heavy', dur:0.45, activeStart:0.40, activeEnd:0.75, reach:1.10, radius:1.1, dmg:22, kbX:18, kbY:4, stun:0.40, launch:true,  heightOffset:0.15, recovery:0.45 },
  heavyUp:      { type:'heavy', dur:0.45, activeStart:0.40, activeEnd:0.78, reach:0.85, radius:1.0, dmg:18, kbX:4,  kbY:14,stun:0.40, launch:true,  heightOffset:0.40, recovery:0.45 },
  heavyDown:    { type:'heavy', dur:0.50, activeStart:0.45, activeEnd:0.80, reach:0.90, radius:1.1, dmg:25, kbX:6,  kbY:-8,stun:0.45, launch:true,  heightOffset:-0.20,recovery:0.50 },
  heavyForward: { type:'heavy', dur:0.40, activeStart:0.30, activeEnd:0.70, reach:1.30, radius:1.0, dmg:20, kbX:16, kbY:5, stun:0.40, launch:true,  heightOffset:0.15, recovery:0.40 },
  heavyBack:    { type:'heavy', dur:0.55, activeStart:0.00, activeEnd:0.00, reach:0,    radius:0,   dmg:0,  kbX:0,  kbY:0, stun:0,    launch:false, heightOffset:0,    recovery:0.55 },
  // Aerials — air chain step 0..1
  airJab:       { type:'airLight', dur:0.20, activeStart:0.30, activeEnd:0.75, reach:0.85, radius:1.0, dmg:9,  kbX:8, kbY:2,  stun:0.20, launch:false, heightOffset:0.05, recovery:0.18 },
  airHook:      { type:'airLight', dur:0.22, activeStart:0.30, activeEnd:0.75, reach:0.95, radius:1.0, dmg:11, kbX:9, kbY:2,  stun:0.25, launch:false, heightOffset:0.10, recovery:0.20 },
  airHeavyN:    { type:'airHeavy', dur:0.45, activeStart:0.40, activeEnd:0.80, reach:1.05, radius:1.1, dmg:20, kbX:10,kbY:3,  stun:0.40, launch:true,  heightOffset:0.10, recovery:0.40 },
  airHeavyU:    { type:'airHeavy', dur:0.40, activeStart:0.35, activeEnd:0.75, reach:0.80, radius:1.0, dmg:16, kbX:3, kbY:15, stun:0.40, launch:true,  heightOffset:0.30, recovery:0.40 },
  airHeavyD:    { type:'airHeavy', dur:0.40, activeStart:0.35, activeEnd:0.80, reach:0.90, radius:1.0, dmg:22, kbX:8, kbY:-10,stun:0.45, launch:true,  heightOffset:-0.30,recovery:0.40 },
  // Special
  slideKick:    { type:'special', dur:0.32, activeStart:0.20, activeEnd:0.85, reach:1.25, radius:1.0, dmg:14, kbX:8, kbY:1.5,stun:0.35, launch:true,  heightOffset:-0.35, recovery:0.30 },
};

// Ground light chain order.
const GROUND_CHAIN = ['jab','cross','hook','knee','spinBack'];
```

`activeStart=0` and `activeEnd=0` on `heavyBack` is intentional — the move has no hitbox; its effect is purely the parry window set in the FSM.

- [ ] **Step 2: Verify table accessible**

```js
// Hot-reload the page, then in console:
import('./src/entities/Stickman.js').then(m => console.log(typeof m.MOVE_TABLE));
// MOVE_TABLE is module-scoped (not exported) — alternative check below.
const p = window.game.localPlayer;
// Trigger any attack and inspect the move dispatched (after Task 5):
// console.log(p.moveId);  // → null at rest
```

The table is internal to the module — verification is implicit via downstream tasks.

- [ ] **Step 3: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(combat): add MOVE_TABLE with 16 strike profiles"
```

---

## Task 5: Replace `_doAttack` with `_strikeFSM`

**Files:**
- Modify: `src/entities/Stickman.js` (around line 863–882)

- [ ] **Step 1: Delete the existing `_doAttack`**

Locate `_doAttack()` (around line 863). It currently sets `comboStep`/`_attackStep`/`kicking`/`attackTimer`. Delete the entire method body and replace with:

```js
_doAttack() {
  // Compatibility entry-point — still called from tick() on attackPressed.
  // Routes to weapon path if armed, otherwise enters the unarmed FSM.
  if (this.attackCooldown > 0) return;
  if (this.weapon) { this.weapon.tryFire(this); return; }
  // Slide-kick short-circuit — committed even mid-slide.
  if (this.sliding && this.grounded) {
    this._fireMove('slideKick');
    return;
  }
  if (performance.now() < this.parryRecoverUntil) return;
  if (this.charging || this.moveId) return;
  this.charging = true;
  this.chargeStartedAt = performance.now();
  this._pressDir = { x: this.input.moveX, y: this.input.moveY };
}

// Called per-frame from tick() to resolve a held attack on release.
_chargeTick(dt) {
  if (!this.charging) return;
  // Cancel on jump, hit, ragdoll, etc. (Those branches clear this.charging
  // elsewhere — here we only resolve on release.)
  if (!this.input.attackReleased) return;
  const heldS = (performance.now() - this.chargeStartedAt) / 1000;
  this.charging = false;
  const liveDir = { x: this.input.moveX, y: this.input.moveY };
  const dir = (heldS >= 0.20) ? liveDir : this._pressDir;
  const airborne = !this.grounded;
  let id;
  if (heldS >= 0.20) {
    id = this._heavyForDir(dir, airborne);
  } else if (airborne) {
    id = (this.airChainStep === 0) ? 'airJab' : 'airHook';
    this.airChainStep = (this.airChainStep + 1) % 2;
  } else {
    id = GROUND_CHAIN[this.chainStep];
    this.chainStep = (this.chainStep + 1) % GROUND_CHAIN.length;
    this.chainTimer = 0.45;
  }
  this._fireMove(id);
}

_heavyForDir(dir, airborne) {
  if (airborne) {
    if (dir.y < -0.4) return 'airHeavyD';
    if (dir.y >  0.4) return 'airHeavyU';
    return 'airHeavyN';
  }
  if (dir.y >  0.4) return 'heavyUp';
  if (dir.y < -0.4) return 'heavyDown';
  // Treat "back" as stick away from facing.
  const f = this.facing || 1;
  if (Math.abs(dir.x) > 0.4) {
    if (Math.sign(dir.x) === f) return 'heavyForward';
    return 'heavyBack';
  }
  return 'heavyNeutral';
}

_fireMove(id) {
  const m = MOVE_TABLE[id];
  if (!m) return;
  this.moveId = id;
  this.attackTimer = m.dur;
  this.attackCooldown = m.recovery;
  this.attackHits.clear();
  // Legacy rig flags so old rig code paths render reasonable poses until
  // the rig is rewritten in Task 11–13.
  this.kicking = (id === 'knee' || id === 'spinBack' || id === 'heavyDown' || id === 'heavyForward'
                  || id === 'airHeavyN' || id === 'airHeavyD' || id === 'slideKick');
  this._attackStep = (id === 'jab') ? 0 : (id === 'cross') ? 1 : 2;

  // Per-move startup impulses.
  if (id === 'heavyForward') {
    this.body.velocity.x += this.facing * 8;
  } else if (id === 'airHeavyD') {
    this.body.velocity.y -= 12;
    this.body.velocity.x += this.facing * 6;
  } else if (id === 'slideKick') {
    // Maintain slide momentum — no impulse change.
  }

  // Back-counter — set parry window, no hitbox.
  if (id === 'heavyBack') {
    const t = performance.now();
    this.parryUntil = t + 250;
    this.parryRecoverUntil = t + 550;
  }

  audio.swing();
}
```

- [ ] **Step 2: Wire `_chargeTick` into the tick loop**

In `tick()` find the line:

```js
if (now.attackPressed) this._doAttack();
```

Replace with:

```js
if (now.attackPressed) this._doAttack();
this._chargeTick(dt);
```

Also tick the chain window. Find `_attackTick(dt, players)` call (around line 1341) and immediately above it add:

```js
if (this.chainTimer > 0) {
  this.chainTimer -= dt;
  if (this.chainTimer <= 0) this.chainStep = 0;
}
// Reset air chain on landing.
if (this.grounded && !this.prevGrounded) {
  this.airChainStep = 0;
}
// Clear juggle on touchdown or timeout.
if (this.juggled && (this.grounded || performance.now() > this.juggledUntil)) {
  this.juggled = false;
  this.juggleHits = 0;
}
```

- [ ] **Step 3: Verify FSM dispatch**

Start match. In console:

```js
const p = window.game.localPlayer;
// Tap attack briefly: expect moveId to flash through 'jab' for 0.14s.
// Force a heavy:
p.input.moveX = 0; p.input.moveY = 1;  // up dir
p.charging = true; p.chargeStartedAt = performance.now() - 300;
p.input.attackReleased = true;
p._chargeTick(0.016);
console.log('moveId:', p.moveId);  // → 'heavyUp'
```

- [ ] **Step 4: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(combat): _strikeFSM with charge → light/heavy resolve"
```

---

## Task 6: Rewrite `_attackTick` to read MOVE_TABLE

**Files:**
- Modify: `src/entities/Stickman.js` (around line 884–972)

- [ ] **Step 1: Replace `_attackTick`**

Locate `_attackTick(dt, players)` (around line 884). Delete the entire body. Replace with:

```js
_attackTick(dt, players) {
  if (this.attackCooldown > 0) this.attackCooldown -= dt;
  if (this.attackTimer <= 0) {
    if (this.moveId) {
      this.moveId = null;
      this.kicking = false;
    }
    return;
  }
  this.attackTimer -= dt;
  if (this.attackTimer <= 0) {
    this.moveId = null;
    this.kicking = false;
    return;
  }
  // Weapons handle their own hit detection.
  if (this.weapon) return;
  const id = this.moveId;
  if (!id) return;
  const m = MOVE_TABLE[id];
  if (!m) return;
  // heavyBack is parry-only — no hitbox.
  if (m.radius <= 0 || m.dmg === 0) return;

  const phase = 1 - this.attackTimer / m.dur;
  if (phase < m.activeStart || phase > m.activeEnd) return;

  const tNow = performance.now();
  const gumGum = tNow < this.gumGumUntil;
  const superPunch = tNow < this.superPunchUntil;

  // Reach is amplified by gumGum (rubber stretch).
  const reach = gumGum ? Math.max(m.reach, 4.8) : m.reach;
  const radius = gumGum ? 0.8 : m.radius;
  const cx = this.position.x + this.facing * reach;
  const cy = this.position.y + m.heightOffset;

  // Damage / kb base from move table, overridden by super/gumGum.
  let baseDmg = m.dmg;
  let baseKbX = this.facing * m.kbX;
  let baseKbY = m.kbY;
  let baseStun = m.stun;
  if (superPunch) {
    baseDmg = 60;
    baseKbX = this.facing * 38;
    baseKbY = 17;
    baseStun = 0.5;
  } else if (gumGum) {
    baseDmg = 22;
    baseKbX = this.facing * 17;
    baseKbY = 8;
    baseStun = 0.35;
  }

  for (const p of players) {
    if (!p || p === this || !p.alive || p.invuln > 0) continue;
    if (this.attackHits.has(p.id)) continue;
    const dx = p.position.x - cx;
    const dy = p.position.y - cy;
    if (dx * dx + dy * dy >= radius * radius) continue;

    let dmg = baseDmg;
    let kbX = baseKbX;
    let kbY = baseKbY;
    let stun = baseStun;

    // Counter-hit: victim is in their own attack startup.
    if (p.attackTimer > 0 && p.moveId && MOVE_TABLE[p.moveId]) {
      const pDur = MOVE_TABLE[p.moveId].dur;
      const pPhase = 1 - p.attackTimer / pDur;
      if (pPhase < 0.5) {
        dmg *= 1.3;
        stun *= 1.3;
      }
    }

    // Juggle scaling: air-light hits onto launched victim do less.
    if (p.juggled && m.type === 'airLight') {
      dmg *= 0.6;
      kbX *= 0.5;
      kbY *= 0.5;
    }

    const launch = !!m.launch && !superPunch;  // super already mega-launches
    p.takeDamage(dmg, {
      attacker: this,
      weapon: superPunch ? 'super' : (gumGum ? 'gumgum' : 'fist'),
      kb: { x: kbX, y: kbY },
      stun,
      launch: launch || superPunch,
    });
    this.attackHits.add(p.id);

    // Upward-launcher → start juggle on victim.
    if (m.launch && (id === 'heavyUp' || id === 'airHeavyU')) {
      p.juggled = true;
      p.juggledUntil = performance.now() + 1200;
      p.juggleHits = 0;
    }
    if (p.juggled) {
      p.juggleHits++;
      if (p.juggleHits >= 4) p.juggled = false;
      else p.juggledUntil = Math.min(performance.now() + 400 + 800, p.juggledUntil + 400);
    }

    if (superPunch && this.game?.fx) {
      this.game.fx.particles.burst(p.position.x, p.position.y, 0, { count: 22, speed: 12, color: 0xffcc33 });
      this.game.fx.camera.punch(0.45);
      this.game.hitStop?.(0.1);
    }
  }

  // Projectile reflection (was in old _attackTick — preserve).
  if (this.game?.projectiles) {
    for (const pr of this.game.projectiles) {
      if (pr.dead || pr.owner === this) continue;
      if (!pr.body || pr.stuck) continue;
      const dx = pr.body.position.x - cx;
      const dy = pr.body.position.y - cy;
      if (dx * dx + dy * dy < 0.9 * 0.9) {
        pr.body.velocity.x = -pr.body.velocity.x * 1.2 + this.facing * 4;
        pr.body.velocity.y = Math.abs(pr.body.velocity.y) * 0.6 + 4;
        pr.owner = this;
        this.game.fx.particles.burst(pr.body.position.x, pr.body.position.y, 0, { count: 8, speed: 6, color: 0xffffff });
        this.game.fx.camera.punch(0.06);
      }
    }
  }

  // Chain severance (preserve).
  const chainSegs = this.game?.level?._chainSegs;
  if (chainSegs?.size) {
    for (const seg of [...chainSegs]) {
      if (!seg || seg.dead || !seg.body) continue;
      const body = seg.body;
      if (!body.velocity || !body.position) continue;
      const key = `chain_${body.id}`;
      if (this.attackHits.has(key)) continue;
      const dxs = body.position.x - cx;
      const dys = body.position.y - cy;
      if (dxs * dxs + dys * dys >= radius * radius) continue;
      this.attackHits.add(key);
      body.velocity.x += this.facing * 4;
      body.velocity.y += 2;
      seg.damage(baseDmg * 0.5, this);
    }
  }
}
```

- [ ] **Step 2: Verify hitbox dispatch**

```js
const p = window.game.localPlayer;
// Tap attack near a bot — expect dmg 6 (jab) then 8 (cross). Bots have .health.
// Check after a single jab landing:
const bots = window.game.players.filter(x => x !== p && x.alive);
const beforeHp = bots[0]?.health;
// Tap attack while adjacent...
// console.log('delta:', beforeHp - bots[0].health);  // expect ~6
```

- [ ] **Step 3: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(combat): _attackTick driven by MOVE_TABLE + counter-hit + juggle"
```

---

## Task 7: Wire `launch` flag into ragdoll trigger

**Files:**
- Modify: `src/entities/Stickman.js` — `takeDamage` (around line 273+)

- [ ] **Step 1: Locate takeDamage**

Find `takeDamage(amount, opts = {})` around line 273. The method currently applies kb, stun, flash, sound. It does NOT currently force-ragdoll on light hits.

- [ ] **Step 2: Add launch-triggered ragdoll**

After the kb application block, before the `lastDamager` write, insert:

```js
// Launch flag from combat MOVE_TABLE — heavy/launcher hits ragdoll the
// victim regardless of remaining HP. Pure stagger lights leave the
// victim upright.
if (opts.launch && this.alive && !this.ragdoll) {
  // Brief ragdoll, recovers like existing knockdown path.
  // Reuse whatever ragdoll trigger already exists; on this codebase
  // there isn't a discrete ragdoll mode for living fighters yet —
  // we approximate by setting hitstun proportional to launch force
  // and letting physics carry the body.
  const launchStun = (opts.stun ?? 0.3) + 0.25;
  this.hitstun = Math.max(this.hitstun, launchStun);
  this.flashAmount = 1;
}
```

Note: this project uses a hybrid stick-figure where the visible "ragdoll" of a launched hit is the body coasting under physics while `hitstun` suppresses control. The `launch` boolean increases hitstun so the victim cannot immediately fight back — matches the design's "ragdoll-on-launch" intent without introducing a new entity state.

- [ ] **Step 3: Verify**

```js
const p = window.game.localPlayer;
const b = window.game.players.find(x => x !== p && x.alive);
b.takeDamage(20, { attacker: p, kb: { x: 10, y: 14 }, stun: 0.3, launch: true });
console.log('hitstun:', b.hitstun);  // expect ≥ 0.55
```

- [ ] **Step 4: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(combat): launch flag extends hitstun for ragdoll feel"
```

---

## Task 8: Back-counter parry deflection in takeDamage

**Files:**
- Modify: `src/entities/Stickman.js` — `takeDamage` (early in method)

- [ ] **Step 1: Add parry check**

At the very top of `takeDamage(amount, opts = {})`, after the existing `invuln`/`alive` guards but BEFORE damage is applied, insert:

```js
// Back-counter parry: if attacker is mid-melee swing and the defender
// is in their active parry window, treat as a clash (both bounce,
// both cancel) — no damage taken on either side.
const tNow = performance.now();
const parryActive = tNow < this.parryUntil;
const allowed = opts.weapon === 'fist' || opts.weapon === 'melee' || opts.weapon === 'lightProj';
if (parryActive && allowed && opts.attacker && opts.attacker !== this) {
  // Reuse the existing two-strike clash resolution.
  if (this._clash) this._clash(opts.attacker);
  this.parryUntil = 0;
  // Drop the defender out of counter-stance immediately so they can act.
  this.attackTimer = 0;
  this.moveId = null;
  this.parryRecoverUntil = 0;
  return;  // damage suppressed
}
```

- [ ] **Step 2: Verify parry suppresses damage**

```js
const p = window.game.localPlayer;
p.parryUntil = performance.now() + 1000;  // force active window
const b = window.game.players.find(x => x !== p && x.alive);
const hp = p.health;
p.takeDamage(10, { attacker: b, weapon: 'fist' });
console.log('hp delta:', hp - p.health);  // expect 0
```

- [ ] **Step 3: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(combat): back-counter parry deflects fist/melee via clash"
```

---

## Task 9: Charge tell visuals (particles + sway)

**Files:**
- Modify: `src/entities/Stickman.js` — tick or `_chargeTick`

- [ ] **Step 1: Add charge-tell emission**

At the end of `_chargeTick(dt)` (still inside the function, before the closing brace), add:

```js
// Charge tell — emit one glow particle every ~5 frames on the
// striking limb. Direction at current stick gives a hint of which
// heavy will fire on release.
if (this.charging && this.game?.fx?.particles) {
  this._chargeTellTick = (this._chargeTellTick || 0) + 1;
  if (this._chargeTellTick % 5 === 0) {
    const dir = this.input;
    const id = this._heavyForDir({ x: dir.moveX, y: dir.moveY }, !this.grounded);
    const useFoot = (id === 'heavyDown' || id === 'airHeavyD' || id === 'airHeavyN');
    const cx = this.position.x + this.facing * (useFoot ? 0.25 : 0.55);
    const cy = this.position.y + (useFoot ? -0.30 : 0.30);
    this.game.fx.particles.spark?.spawn?.({
      x: cx, y: cy, z: 0,
      vx: (Math.random() - 0.5) * 1, vy: useFoot ? -0.5 : 0.5,
      life: 0.25, size: 0.18,
      color: 0xffd866, gravity: 0, drag: 0.8, shrink: 1.5,
    });
  }
}
```

Initialize `this._chargeTellTick = 0;` in the constructor combat block.

- [ ] **Step 2: Verify particles emit during charge**

```js
const p = window.game.localPlayer;
p.charging = true; p.chargeStartedAt = performance.now();
// Hold for ~0.3s and observe glow particles around the chosen limb.
```

- [ ] **Step 3: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(combat): charge tell — limb glow particle during hold"
```

---

## Task 10: Rig pose dispatcher (replaces attack/kicking booleans)

**Files:**
- Modify: `src/entities/StickmanRig.js` — pose-resolution block (around line 204, 464, 493)

- [ ] **Step 1: Identify the rig.draw params consumer**

The rig today reads `params.attack`, `params.kicking`, `params.attackProgress`, `params.attackStep`. We will continue to set those (for backwards compatibility) but ALSO read a new `params.moveId`. If `moveId` is set, the rig uses the per-move pose; otherwise it falls back to existing behavior.

Update `Stickman.js`'s rig param emission (search around line 1428 — the `this.rig.draw({...})` call). Add `moveId: this.moveId` to the params object passed to `this.rig.draw`. Existing `attack`, `attackProgress`, `attackStep`, `kicking` stay (they remain populated as the FSM still sets `_attackStep`/`kicking`).

- [ ] **Step 2: Add POSES dispatcher in StickmanRig**

Open `src/entities/StickmanRig.js`. Near the top of the file (after imports / helper functions, before the class body), add:

```js
// Strike pose functions keyed on moveId. Each receives the rig instance
// + params and returns a partial { armR: {x,y}, armL: {x,y}, legR: {x,y},
// legL: {x,y}, tilt: rad, head: rad } pose override. The rig blends this
// into the base walk/idle pose.
const STRIKE_POSES = {
  jab:          poseJab,
  cross:        poseCross,
  hook:         poseHook,
  knee:         poseKnee,
  spinBack:     poseSpinBack,
  heavyNeutral: poseBlowAway,
  heavyUp:      poseUppercut,
  heavyDown:    poseAxe,
  heavyForward: poseCharge,
  heavyBack:    poseCounterStance,
  airJab:       poseFlyingKnee,
  airHook:      poseAirHook,
  airHeavyN:    poseSomersault,
  airHeavyU:    poseRisingKnee,
  airHeavyD:    poseDive,
  slideKick:    poseSlideKick,
};
```

Define each pose function below the class (or wherever helpers live). Each pose returns offsets keyed off `t = params.attackProgress` (0..1). Example for `poseJab`:

```js
function poseJab(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  // Three phases: windup (0..0.25), strike (0.25..0.7), recover (0.7..1)
  let armX, armY, leanZ;
  if (t < 0.25) {
    const w = t / 0.25;
    armX = lerp(0.30, -0.10, w);   // chamber back
    armY = lerp(0.15, 0.20, w);
    leanZ = lerp(0, -0.10, w);
  } else if (t < 0.70) {
    const w = (t - 0.25) / 0.45;
    const e = w * w * (3 - 2 * w);
    armX = lerp(-0.10, 0.90, e);   // straight out
    armY = lerp(0.20, 0.15, e);
    leanZ = lerp(-0.10, 0.20, e);
  } else {
    const w = (t - 0.70) / 0.30;
    armX = lerp(0.90, 0.30, w);
    armY = lerp(0.15, 0.15, w);
    leanZ = lerp(0.20, 0, w);
  }
  return { armRX: armX, armRY: armY, leanZ };
}
```

Stub the remaining 15 pose functions in this task with placeholder bodies (each returns a neutral pose). Subsequent tasks fill them in:

```js
function poseCross(rig, params)        { return poseJab(rig, params); }  // stub
function poseHook(rig, params)         { return poseJab(rig, params); }  // stub
function poseKnee(rig, params)         { return poseJab(rig, params); }  // stub
function poseSpinBack(rig, params)     { return poseJab(rig, params); }  // stub
function poseBlowAway(rig, params)     { return poseJab(rig, params); }  // stub
function poseUppercut(rig, params)     { return poseJab(rig, params); }  // stub
function poseAxe(rig, params)          { return poseJab(rig, params); }  // stub
function poseCharge(rig, params)       { return poseJab(rig, params); }  // stub
function poseCounterStance(rig, params){ return null; }                  // no strike arc
function poseFlyingKnee(rig, params)   { return poseJab(rig, params); }  // stub
function poseAirHook(rig, params)      { return poseJab(rig, params); }  // stub
function poseSomersault(rig, params)   { return poseJab(rig, params); }  // stub
function poseRisingKnee(rig, params)   { return poseJab(rig, params); }  // stub
function poseDive(rig, params)         { return poseJab(rig, params); }  // stub
function poseSlideKick(rig, params)    { return poseJab(rig, params); }  // stub
```

- [ ] **Step 3: Hook dispatcher into existing rig draw path**

Inside `StickmanRig.draw(params)` (or whatever the per-frame pose function is — locate the existing arm-pose branch around line 489–516 that handles `armPoseR === 'attack'`). Above that branch, add:

```js
const moveId = params.moveId;
const strikePose = moveId ? STRIKE_POSES[moveId]?.(this, params) : null;
if (strikePose && strikePose.armRX !== undefined) {
  // Override right-arm pose with strike-specific arc.
  handRX = sRX + this.facing * strikePose.armRX;
  handRY = sRY + strikePose.armRY;
  if (strikePose.leanZ !== undefined) {
    this.bodyTiltTarget += this.facing * strikePose.leanZ;
  }
  // Bypass the original `armPoseR === 'attack'` branch by setting a flag
  // that the existing branch checks.
  params.armPoseR = 'strikePosed';
}
```

Then in the existing `else if (params.armPoseR === 'attack')` branch (line ~493), add a sibling clause that skips work when `params.armPoseR === 'strikePosed'`:

```js
} else if (params.armPoseR === 'strikePosed') {
  // already handled by STRIKE_POSES override above
}
```

- [ ] **Step 4: Verify dispatcher routes jab correctly**

```js
const p = window.game.localPlayer;
// Tap attack — first hit is jab.
// In console you can also force:
p.moveId = 'jab'; p.attackTimer = 0.10;
// Watch the arm — should extend straight, then retract over 0.14s.
```

- [ ] **Step 5: Commit**

```bash
git add src/entities/StickmanRig.js src/entities/Stickman.js
git commit -m "feat(rig): STRIKE_POSES dispatcher + jab pose; stubs for rest"
```

---

## Task 11: Implement ground light + heavy poses

**Files:**
- Modify: `src/entities/StickmanRig.js` — pose function bodies

- [ ] **Step 1: poseCross**

Replace the stub:

```js
function poseCross(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  let armX, armY, leanZ;
  if (t < 0.30) {
    const w = t / 0.30;
    armX = lerp(0.20, -0.20, w);   // deeper chamber + opposite arm
    armY = lerp(0.15, 0.25, w);
    leanZ = lerp(0, -0.15, w);
  } else if (t < 0.75) {
    const w = (t - 0.30) / 0.45;
    const e = w * w * (3 - 2 * w);
    armX = lerp(-0.20, 1.00, e);
    armY = lerp(0.25, 0.15, e);
    leanZ = lerp(-0.15, 0.30, e);   // full hip rotation
  } else {
    const w = (t - 0.75) / 0.25;
    armX = lerp(1.00, 0.30, w);
    armY = lerp(0.15, 0.15, w);
    leanZ = lerp(0.30, 0, w);
  }
  return { armRX: armX, armRY: armY, leanZ };
}
```

- [ ] **Step 2: poseHook**

```js
function poseHook(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  let armX, armY, leanZ;
  if (t < 0.30) {
    const w = t / 0.30;
    armX = lerp(0.20, 0.40, w);     // arm wide to the side
    armY = lerp(0.15, 0.30, w);
    leanZ = lerp(0, 0.10, w);
  } else if (t < 0.75) {
    const w = (t - 0.30) / 0.45;
    const e = w * w * (3 - 2 * w);
    // Hook curves from wide to centerline.
    armX = lerp(0.40, 0.85, e);
    armY = lerp(0.30, 0.10, e);
    leanZ = lerp(0.10, 0.35, e);
  } else {
    const w = (t - 0.75) / 0.25;
    armX = lerp(0.85, 0.30, w);
    armY = lerp(0.10, 0.15, w);
    leanZ = lerp(0.35, 0, w);
  }
  return { armRX: armX, armRY: armY, leanZ };
}
```

- [ ] **Step 3: poseKnee**

```js
function poseKnee(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  // Knee uses the leg, not the arm. Override legR via separate field;
  // arm just supports balance.
  let legX, legY, leanZ;
  if (t < 0.35) {
    const w = t / 0.35;
    legX = lerp(0.20, 0.05, w);    // tuck knee
    legY = lerp(0, 0.30, w);
    leanZ = lerp(0, 0.20, w);       // body folds forward
  } else if (t < 0.70) {
    const w = (t - 0.35) / 0.35;
    const e = w * w * (3 - 2 * w);
    legX = lerp(0.05, 0.60, e);
    legY = lerp(0.30, 0.45, e);    // knee drives up to chest
    leanZ = lerp(0.20, 0.15, e);
  } else {
    const w = (t - 0.70) / 0.30;
    legX = lerp(0.60, 0.20, w);
    legY = lerp(0.45, 0, w);
    leanZ = lerp(0.15, 0, w);
  }
  return { legRX: legX, legRY: legY, leanZ, armRX: 0.10, armRY: 0.25 };
}
```

- [ ] **Step 4: poseSpinBack**

```js
function poseSpinBack(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  let armX, armY, leanZ;
  if (t < 0.40) {
    const w = t / 0.40;
    armX = lerp(0.20, -0.40, w);
    armY = lerp(0.15, 0.20, w);
    leanZ = lerp(0, -0.50, w);    // wind up full 180° twist
  } else if (t < 0.75) {
    const w = (t - 0.40) / 0.35;
    const e = w * w * (3 - 2 * w);
    armX = lerp(-0.40, 1.10, e);
    armY = lerp(0.20, 0.30, e);
    leanZ = lerp(-0.50, 0.60, e);
  } else {
    const w = (t - 0.75) / 0.25;
    armX = lerp(1.10, 0.30, w);
    armY = lerp(0.30, 0.15, w);
    leanZ = lerp(0.60, 0, w);
  }
  return { armRX: armX, armRY: armY, leanZ };
}
```

- [ ] **Step 5: poseBlowAway (neutral heavy — Wing Chun palm stack)**

```js
function poseBlowAway(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  let armX, armY, leanZ, armLX, armLY;
  if (t < 0.40) {
    const w = t / 0.40;
    armX = lerp(0.20, -0.15, w);
    armY = lerp(0.15, 0.25, w);
    armLX = lerp(-0.20, -0.10, w);
    armLY = lerp(0.15, 0.25, w);
    leanZ = lerp(0, -0.20, w);
  } else if (t < 0.75) {
    const w = (t - 0.40) / 0.35;
    const e = w * w * (3 - 2 * w);
    armX = lerp(-0.15, 1.15, e);
    armY = lerp(0.25, 0.10, e);
    armLX = lerp(-0.10, 0.95, e);   // both palms forward, stacked
    armLY = lerp(0.25, 0.15, e);
    leanZ = lerp(-0.20, 0.40, e);
  } else {
    const w = (t - 0.75) / 0.25;
    armX = lerp(1.15, 0.30, w);
    armY = lerp(0.10, 0.15, w);
    armLX = lerp(0.95, -0.20, w);
    armLY = lerp(0.15, 0.15, w);
    leanZ = lerp(0.40, 0, w);
  }
  return { armRX: armX, armRY: armY, armLX, armLY, leanZ };
}
```

- [ ] **Step 6: poseUppercut**

```js
function poseUppercut(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  let armX, armY, leanZ;
  if (t < 0.40) {
    const w = t / 0.40;
    armX = lerp(0.20, 0.10, w);
    armY = lerp(0.15, -0.30, w);   // drop to hip
    leanZ = lerp(0, -0.30, w);      // deep knee bend
  } else if (t < 0.78) {
    const w = (t - 0.40) / 0.38;
    const e = w * w * (3 - 2 * w);
    armX = lerp(0.10, 0.40, e);
    armY = lerp(-0.30, 0.95, e);   // rise straight up overhead
    leanZ = lerp(-0.30, 0.10, e);
  } else {
    const w = (t - 0.78) / 0.22;
    armX = lerp(0.40, 0.30, w);
    armY = lerp(0.95, 0.15, w);
    leanZ = lerp(0.10, 0, w);
  }
  return { armRX: armX, armRY: armY, leanZ };
}
```

- [ ] **Step 7: poseAxe (down heavy)**

```js
function poseAxe(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  let armX, armY, leanZ, armLX, armLY;
  if (t < 0.45) {
    const w = t / 0.45;
    armX = lerp(0.20, 0.10, w);
    armY = lerp(0.15, 1.10, w);    // both hands raised overhead
    armLX = lerp(-0.20, -0.10, w);
    armLY = lerp(0.15, 1.10, w);
    leanZ = lerp(0, -0.10, w);
  } else if (t < 0.80) {
    const w = (t - 0.45) / 0.35;
    const e = w * w * (3 - 2 * w);
    armX = lerp(0.10, 0.30, e);
    armY = lerp(1.10, -0.30, e);   // slam straight down
    armLX = lerp(-0.10, 0.25, e);
    armLY = lerp(1.10, -0.30, e);
    leanZ = lerp(-0.10, 0.40, e);   // body folds over the hammer
  } else {
    const w = (t - 0.80) / 0.20;
    armX = lerp(0.30, 0.30, w);
    armY = lerp(-0.30, 0.15, w);
    armLX = lerp(0.25, -0.20, w);
    armLY = lerp(-0.30, 0.15, w);
    leanZ = lerp(0.40, 0, w);
  }
  return { armRX: armX, armRY: armY, armLX, armLY, leanZ };
}
```

- [ ] **Step 8: poseCharge (forward heavy)**

```js
function poseCharge(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  let armX, armY, leanZ;
  if (t < 0.30) {
    const w = t / 0.30;
    armX = lerp(0.20, -0.10, w);
    armY = lerp(0.15, 0.20, w);
    leanZ = lerp(0, 0.40, w);      // body lunges forward
  } else if (t < 0.70) {
    const w = (t - 0.30) / 0.40;
    const e = w * w * (3 - 2 * w);
    armX = lerp(-0.10, 0.95, e);
    armY = lerp(0.20, 0.15, e);
    leanZ = lerp(0.40, 0.55, e);   // shoulder/elbow leads
  } else {
    const w = (t - 0.70) / 0.30;
    armX = lerp(0.95, 0.30, w);
    armY = lerp(0.15, 0.15, w);
    leanZ = lerp(0.55, 0, w);
  }
  return { armRX: armX, armRY: armY, leanZ };
}
```

- [ ] **Step 9: poseCounterStance (back heavy)**

```js
function poseCounterStance(rig, params) {
  // Static stance through duration — slight settle on entry. No strike arc.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const settle = Math.min(1, t / 0.20);
  // Lead palm raised in bong-sao guard.
  const armX = lerp(0.20, 0.55, settle);
  const armY = lerp(0.15, 0.40, settle);
  // Body turned ~0.30 rad away from facing (back to opponent).
  const leanZ = lerp(0, -0.30, settle);
  return { armRX: armX, armRY: armY, leanZ };
}
```

- [ ] **Step 10: Verify each pose visually**

```js
const p = window.game.localPlayer;
const dummyDurations = {
  cross:0.16, hook:0.18, knee:0.18, spinBack:0.24,
  heavyNeutral:0.45, heavyUp:0.45, heavyDown:0.50,
  heavyForward:0.40, heavyBack:0.55,
};
for (const id of Object.keys(dummyDurations)) {
  p.moveId = id;
  p.attackTimer = dummyDurations[id];
  // Watch one full cycle, confirm distinct arm/leg/lean shapes per move.
  await new Promise(r => setTimeout(r, 600));
}
```

(Manual visual pass — no automated check possible without screenshots.)

- [ ] **Step 11: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "feat(rig): ground light + heavy strike poses"
```

---

## Task 12: Implement air poses + slide-kick pose

**Files:**
- Modify: `src/entities/StickmanRig.js`

- [ ] **Step 1: poseFlyingKnee (air light 0)**

```js
function poseFlyingKnee(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  let legX, legY, leanZ;
  if (t < 0.30) {
    const w = t / 0.30;
    legX = lerp(0.20, 0.10, w);
    legY = lerp(0, 0.25, w);
    leanZ = lerp(0, 0.15, w);
  } else if (t < 0.75) {
    const w = (t - 0.30) / 0.45;
    const e = w * w * (3 - 2 * w);
    legX = lerp(0.10, 0.55, e);
    legY = lerp(0.25, 0.40, e);
    leanZ = lerp(0.15, 0.10, e);
  } else {
    const w = (t - 0.75) / 0.25;
    legX = lerp(0.55, 0.20, w);
    legY = lerp(0.40, 0, w);
    leanZ = lerp(0.10, 0, w);
  }
  return { legRX: legX, legRY: legY, leanZ, armRX: 0.10, armRY: 0.20 };
}
```

- [ ] **Step 2: poseAirHook (air light 1)**

```js
function poseAirHook(rig, params) {
  // Same as poseHook but with airborne lean cue.
  const base = poseHook(rig, params);
  return { ...base, leanZ: (base.leanZ ?? 0) + 0.10 };
}
```

- [ ] **Step 3: poseSomersault (air heavy neutral — TKD axe via full rotation)**

```js
function poseSomersault(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  // Full body rotation around bodyTilt.
  const rotation = Math.PI * 2 * t;       // one full spin over duration
  let legX, legY;
  // At peak rotation (~t=0.5-0.7) leg extends overhead for axe contact.
  const peak = clamp((t - 0.40) / 0.35, 0, 1);
  const axe = Math.sin(peak * Math.PI);
  legX = 0.20 + axe * 0.30;
  legY = 0.00 + axe * 1.10;
  return { legRX: legX, legRY: legY, leanZ: rotation, armRX: 0.10, armRY: 0.10 };
}
```

- [ ] **Step 4: poseRisingKnee (air heavy up)**

```js
function poseRisingKnee(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  // Body curls into tuck on windup, knee leads up at strike.
  let legX, legY, leanZ;
  if (t < 0.35) {
    const w = t / 0.35;
    legX = lerp(0.20, 0.05, w);
    legY = lerp(0, 0.35, w);
    leanZ = lerp(0, 0.30, w);       // tuck forward
  } else if (t < 0.75) {
    const w = (t - 0.35) / 0.40;
    const e = w * w * (3 - 2 * w);
    legX = lerp(0.05, 0.10, e);
    legY = lerp(0.35, 0.70, e);    // knee high
    leanZ = lerp(0.30, -0.10, e);   // body uncurls upward
  } else {
    const w = (t - 0.75) / 0.25;
    legX = lerp(0.10, 0.20, w);
    legY = lerp(0.70, 0, w);
    leanZ = lerp(-0.10, 0, w);
  }
  return { legRX: legX, legRY: legY, leanZ, armRX: 0.05, armRY: 0.05 };
}
```

- [ ] **Step 5: poseDive (air heavy down)**

```js
function poseDive(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  // Body angles 45° downward, both legs extend point-first.
  let legX, legY, legLX, legLY, leanZ;
  if (t < 0.35) {
    const w = t / 0.35;
    legX = lerp(0.20, 0.30, w);
    legY = lerp(0, -0.10, w);
    legLX = lerp(-0.20, 0.25, w);
    legLY = lerp(0, -0.10, w);
    leanZ = lerp(0, 0.45, w);       // dive angle
  } else if (t < 0.80) {
    legX = 0.30; legY = -0.10;
    legLX = 0.25; legLY = -0.10;
    leanZ = 0.45;
  } else {
    const w = (t - 0.80) / 0.20;
    legX = lerp(0.30, 0.20, w);
    legY = lerp(-0.10, 0, w);
    legLX = lerp(0.25, -0.20, w);
    legLY = lerp(-0.10, 0, w);
    leanZ = lerp(0.45, 0, w);
  }
  return { legRX: legX, legRY: legY, legLX, legLY, leanZ, armRX: -0.10, armRY: 0.05 };
}
```

- [ ] **Step 6: poseSlideKick**

```js
function poseSlideKick(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  // Body already in horizontal slide pose; foot snap-extends mid.
  let legX, legY, leanZ;
  const arc = Math.sin(Math.PI * clamp((t - 0.10) / 0.80, 0, 1));
  legX = 0.20 + arc * 1.10;       // lead leg extends forward
  legY = -0.45 + arc * 0.10;       // stays low, foot-height
  leanZ = -Math.PI / 3 + arc * 0.15;
  return { legRX: legX, legRY: legY, leanZ, armRX: -0.30, armRY: 0.10 };
}
```

- [ ] **Step 7: Verify**

Force each air pose by setting `p.moveId = 'airHeavyU'` (etc.) while airborne. Confirm distinct silhouettes.

- [ ] **Step 8: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "feat(rig): air strike poses + slide-kick pose"
```

---

## Task 13: Slide animation overhaul

**Files:**
- Modify: `src/entities/StickmanRig.js`

- [ ] **Step 1: Add slide-pose override**

Locate the rig's main draw / pose function. Find the existing slide handling (the rig uses run pose during slide currently — search for `params.sliding`). Above the standard pose computation, add:

```js
// Slide pose — body pitches forward, head looks forward, arms trail.
// Activates whenever params.sliding is true and not in a strike-pose
// that already drives the body (slideKick uses its own leg arc on top
// of this).
if (params.sliding) {
  // Apply pitch to bodyTilt and head.
  this.bodyTiltTarget = this.facing * (-Math.PI / 3);
  // Lead leg extends forward (1.3 reach from hip).
  const lead = 1.30 * this.facing;
  // Trail leg tucks under (knee toward chest).
  const trail = -0.20 * this.facing;
  // Arms drift back + slightly up (override walk targets later).
  this._slideArmDrift = true;
  this._slideLeadX = lead;
  this._slideTrailX = trail;
}
```

Then where the foot positions are written (search `footRX = ` / `footLX = `), add at the end of the foot block:

```js
if (params.sliding && !params.moveId) {
  // Plain slide — lock foot poses to slide stance.
  footRX = hipX + this._slideLeadX;
  footRY = baseFootY - 0.15;
  footLX = hipX + this._slideTrailX;
  footLY = baseFootY - 0.10;
}
```

And where arm targets are written, add:

```js
if (params.sliding && this._slideArmDrift && !params.moveId) {
  handRX = sRX - this.facing * 0.50;   // arm trails behind
  handRY = sRY + 0.20;                  // slightly up (wind drag)
  // Mirror for left arm (defined later in the same function):
  // ensure handLX/handLY get a similar trailing offset.
}
```

Add equivalent override for the left hand in its branch (mirror facing).

Head pitch — find where head rotation is applied. If the rig has `headPitch` or similar, set:

```js
if (params.sliding) this.headPitchTarget = 0.25;   // looking forward despite body pitch
```

If no such field exists yet, add a `this.headPitch` and `this.headPitchTarget` in the rig constructor and apply to the head mesh's rotation.x in the per-frame render.

- [ ] **Step 2: Verify**

Sprint + crouch → slide. Confirm body horizontal, lead leg extended, arms trail back, head looks forward.

- [ ] **Step 3: Commit**

```bash
git add src/entities/StickmanRig.js
git commit -m "feat(rig): slide animation overhaul — pitched body, trailing arms"
```

---

## Task 14: Prone crouch overhaul

**Files:**
- Modify: `src/entities/Stickman.js` (rig param emission) + `src/entities/StickmanRig.js`

- [ ] **Step 1: Pass `prone` to rig**

In `Stickman.js` where it builds the rig.draw params object (around line 1430), add:

```js
prone: this.crouching && !this.sliding,
```

- [ ] **Step 2: Handle prone in rig**

In `StickmanRig.js`, above the base pose computation, add:

```js
if (params.prone) {
  // Body lays near-horizontal. Tilt to -pi/2 with breathing bob.
  const bob = Math.sin(performance.now() * 0.003) * 0.04;
  this.bodyTiltTarget = this.facing * (-Math.PI / 2) + bob;
  // Loose limbs — drop pose blend weight for off-arm + both legs.
  // Implementation: reduce the targets' magnitudes so the rig spring
  // settles closer to rest. The aim arm stays stiff.
  this._proneLooseLimbs = true;
}
```

Then in the limb pose writes, gate the spring stiffness:

```js
// Apply prone looseness to off-arm + legs (not the aim/strike arm).
if (this._proneLooseLimbs && !params.aim && params.armPoseR !== 'strikePosed') {
  // Slacken targets toward neutral hanging position.
  handLX = lerp(handLX, sLX, 0.85);
  handLY = lerp(handLY, sLY - 0.20, 0.85);
  // Legs hang where they fall — push targets toward ground.
  footRY = baseFootY - 0.05;
  footLY = baseFootY - 0.05;
}
// Aim-arm tracks aim vector even in prone.
if (params.prone && params.aim) {
  const aimAng = Math.atan2(params.aim.y, params.aim.x);
  handRX = sRX + Math.cos(aimAng) * 0.7;
  handRY = sRY + Math.sin(aimAng) * 0.7;
}
```

After the frame, clear:

```js
this._proneLooseLimbs = false;
```

- [ ] **Step 3: Verify**

```js
const p = window.game.localPlayer;
// Crouch (hold S/Down without slide) — body lays horizontal.
// Move mouse around — aim arm tracks cursor while legs/other arm hang loose.
```

- [ ] **Step 4: Commit**

```bash
git add src/entities/Stickman.js src/entities/StickmanRig.js
git commit -m "feat(rig): prone crouch — horizontal body, loose limbs, aim-arm tracks"
```

---

## Task 15: Bot AI updates

**Files:**
- Modify: `src/ai/Bot.js`

- [ ] **Step 1: Read existing bot attack triggers**

Locate where the bot fires attacks today (search `_doAttack` or `input.attack = true`). Note the spacing logic and any aim/dir writes.

- [ ] **Step 2: Add heavy-direction picks**

Add a helper method near the existing attack-trigger block:

```js
_pickHeavyDir(target) {
  if (!target) return { x: 0, y: 0 };
  const me = this.stickman;
  const dx = target.position.x - me.position.x;
  const dy = target.position.y - me.position.y;
  const sameFacing = Math.sign(dx) === me.facing;
  // Target airborne above me → up heavy / rising knee.
  if (dy > 1.2) return { x: 0, y: 1 };
  // Target airborne below me → down heavy / dive.
  if (dy < -1.0) return { x: 0, y: -1 };
  // Far + facing → forward charge.
  if (Math.abs(dx) > 2.5 && sameFacing) return { x: Math.sign(dx), y: 0 };
  // Otherwise neutral blow-away.
  return { x: 0, y: 0 };
}
```

- [ ] **Step 3: Use heavy holds in attack logic**

Wherever the bot currently does `this.stickman.input.attack = true; this.stickman.input.attackPressed = true;`, add a hold + release timeline driven by `this._chargeHoldUntil`:

```js
// Decide whether to commit to a heavy this beat.
const wantHeavy = (Math.random() < this._heavyChance(target));
if (wantHeavy) {
  if (!this._chargeHoldUntil) {
    // Start a charge — press and hold for 0.25–0.45s.
    this._chargeHoldUntil = performance.now() + (250 + Math.random() * 200);
    const dir = this._pickHeavyDir(target);
    this.stickman.input.moveX = dir.x;
    this.stickman.input.moveY = dir.y;
  }
  // Hold attack until threshold.
  this.stickman.input.attack = performance.now() < this._chargeHoldUntil;
  if (performance.now() >= this._chargeHoldUntil) {
    this._chargeHoldUntil = 0;   // release happens naturally next frame
  }
} else {
  // Light tap — single-frame attack pulse.
  this.stickman.input.attack = false;
  if (this._lastLightAt + 200 < performance.now()) {
    this.stickman.input.attack = true;
    this._lastLightAt = performance.now();
  }
}
```

Add `this._chargeHoldUntil = 0;` and `this._lastLightAt = 0;` to the bot constructor.

- [ ] **Step 4: Heavy chance heuristic**

```js
_heavyChance(target) {
  if (!target) return 0;
  // More likely to throw heavy if target stunned or in range.
  if (target.hitstun > 0.1) return 0.7;
  const dx = Math.abs(target.position.x - this.stickman.position.x);
  if (dx < 1.5) return 0.25;
  return 0.10;
}
```

- [ ] **Step 5: Back-counter usage**

In the bot's defensive decision block (or a new one), add:

```js
// React to incoming swing — ~15% chance to back-counter.
const swinger = this._nearestSwingingEnemy?.(target);
if (swinger && Math.random() < 0.15 && this.stickman.attackCooldown <= 0) {
  // Set back direction and trigger charge.
  this.stickman.input.moveX = -this.stickman.facing;
  this.stickman.input.moveY = 0;
  this._chargeHoldUntil = performance.now() + 280;
  this.stickman.input.attack = true;
}
```

Add helper:

```js
_nearestSwingingEnemy() {
  const me = this.stickman;
  const players = me.game?.players || [];
  let best = null, bestD2 = 2.5 * 2.5;
  for (const p of players) {
    if (!p || p === me || !p.alive) continue;
    if (p.attackTimer <= 0 || !p.moveId) continue;
    // Only react to early-windup swings (phase < 0.4).
    // MOVE_TABLE is module-scoped — fall back to attackTimer ratio assumption.
    const dx = p.position.x - me.position.x;
    const dy = p.position.y - me.position.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > bestD2) continue;
    // Opponent must be facing me (i.e. their facing toward us).
    if (Math.sign(-dx) !== p.facing) continue;
    bestD2 = d2;
    best = p;
  }
  return best;
}
```

- [ ] **Step 6: Slide-kick usage**

```js
// If running fast at low-altitude opponent, attempt slide-kick.
const speedAbs = Math.abs(this.stickman.body.velocity.x);
const opLow = target && target.position.y - this.stickman.position.y < 0.6;
if (speedAbs > 5 && opLow && Math.abs(target.position.x - this.stickman.position.x) < 3) {
  this.stickman.input.moveY = -1;   // request crouch — triggers slide via existing logic
  setTimeout(() => { this.stickman.input.attack = true; }, 80);
}
```

- [ ] **Step 7: Verify**

Spawn 1v1 against a bot. Observe across ~30s: bot uses lights, occasional heavies (you should see noticeable charge windups), occasional back-counter parries, occasional slide-kicks when running.

- [ ] **Step 8: Commit**

```bash
git add src/ai/Bot.js
git commit -m "feat(ai): bot uses heavies, back-counter, slide-kick contextually"
```

---

## Task 16: End-to-end verification

**Files:** none — verification only

- [ ] **Step 1: Run all scenarios from spec verification plan**

For each scenario in the design doc's "Verification Plan" section, run via `preview_eval`:

1. **Move dispatch coverage** — force each `moveId`, confirm `attackTimer > 0` and rig pose change.
2. **Light chain timing** — 5-mash → exactly 5 distinct moves in order, 6th press = jab.
3. **Heavy threshold** — tap < 0.20s = light, hold ≥ 0.20s = heavy.
4. **Heavy direction sample** — release with up stick → heavyUp; down → heavyDown; forward → heavyForward; back → heavyBack; neutral → heavyNeutral.
5. **Launcher → juggle** — heavyUp on bot, then airHeavyN → bot ragdolls upward then slams.
6. **Slide kick** — sprint + crouch + tap attack → slideKick fires, bot trips.
7. **Back-counter clash** — charge back-heavy as bot swings → both bounce, no damage.
8. **Whiff recovery** — charge back-heavy with no incoming → `parryRecoverUntil` blocks next attack ~0.40s.
9. **Counter-hit bonus** — land light during bot windup → dmg × 1.3 confirmed.
10. **Double-jump cap** — only 1 air jump available.
11. **Prone crouch** — body horizontal, off-limbs loose, aim arm tracks.
12. **Slide animation** — body pitched forward, head forward, arms trail.
13. **Mobile parity** — `preview_resize` to 390×844, repeat 1–6 with touch.
14. **Weapons unaffected** — pick up gun, fire normally.
15. **Super-punch / gum-gum** — heavy + super → dmg/kb override correct.

- [ ] **Step 2: Note any regressions; fix inline**

If any scenario fails, diagnose and patch in the relevant task's file. Re-run that scenario.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(combat): hand-to-hand overhaul — verification fixes" --allow-empty
```

(`--allow-empty` only if no changes were needed.)

---

## Task 17: PR + merge

**Files:** none

- [ ] **Step 1: Push branch and open PR**

```bash
git push -u origin claude/dreamy-fermi-6369dd
gh pr create --title "feat(combat): hand-to-hand overhaul — combos, heavies, air moves, slide kick" --body "$(cat <<'EOF'
## Summary

- Replaced flat jab→cross→kick combo with BT-style 5-hit light chain + heavy ender (hold attack > 0.20s).
- Added 5-way directional heavies: neutral blow-away, up launcher, down axe, forward charge, back counter-stance.
- Added 2-hit air chain + 3 directional air heavies (somersault axe / rising knee / dive kick).
- Added slide kick (tap attack during slide → low trip ragdoll) + slide animation overhaul.
- Added prone crouch — horizontal body, loose limbs, aim arm tracks cursor.
- Added back-counter parry — back-heavy is a 0.25s parry window, clashes incoming melee.
- Added counter-hit (+30% dmg/stun on victim windup) and juggle scaling (air-light on juggled victim = 60% dmg, air-heavy ends juggle).
- Reduced triple jump → double jump.
- Bot AI uses heavies, back-counters, slide-kicks contextually.

## Spec

[`docs/superpowers/specs/2026-05-11-hand-to-hand-combat-overhaul-design.md`](docs/superpowers/specs/2026-05-11-hand-to-hand-combat-overhaul-design.md)

## Test plan

- [ ] Light chain mashes 5 hits in order, 6th press resets
- [ ] Heavy threshold ≥ 0.20s held; direction at release picks variant
- [ ] Up-heavy starts juggle window on victim
- [ ] Slide + tap attack fires slide-kick (low ragdoll trip)
- [ ] Back-heavy parry clashes vs bot swing, no damage either side
- [ ] Double-jump cap (1 air jump)
- [ ] Prone crouch — horizontal body, aim arm tracks
- [ ] Mobile parity (390×844 touch repeats above)
- [ ] Weapons + super-punch + gum-gum unaffected
EOF
)"
```

- [ ] **Step 2: Auto-merge if user authorizes**

If the user says "merge", run:

```bash
gh pr merge --squash --delete-branch
```

Note from memory: `--delete-branch` flag may fail in worktrees — if so, delete the branch separately after merge.

---

## Self-review checklist

After implementation, before declaring done:

- [ ] Every spec section has at least one task implementing it.
- [ ] No `comboStep` / `_attackStep` / `kicking` references remain as load-bearing logic (only legacy fallback fields populated for rig compat).
- [ ] All 16 entries in MOVE_TABLE are referenced by at least one pose function and one FSM path.
- [ ] `airJumps = 1` confirmed in both init and landing-reset code paths.
- [ ] Weapons + super-punch + gum-gum paths still execute on heavy hits.
- [ ] No `preview_screenshot` calls in any verification step (times out per memory).
- [ ] Counter-hit bonus uses victim's own move duration, not attacker's.
- [ ] Juggle clears on grounded transition AND on timeout.
- [ ] Back-counter window length is 0.25s; whiff recovery is 0.55s − 0.25s = 0.30s residual lockout from press time.
