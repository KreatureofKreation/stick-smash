# Hand-to-Hand Combat Overhaul — Design

Status: Draft (brainstorm-approved 2026-05-11)
Scope: Unarmed punching + kicking systems — combos, directional heavies, air moves,
slide kick, back-counter, prone crouch. Preserves existing weapon path, ragdoll
physics, super-punch / gum-gum hooks.

## Goals

- Replace the flat jab→cross→kick chain with a Budokai Tenkaichi-style light chain
  + heavy ender, where the heavy can be inserted at any chain step.
- Add directional differentiation: stick direction modifies the heavy variant
  (neutral / up / down / forward / back) and gates contextual moves.
- Add aerial move set with directional air heavies (somersault axe, rising knee,
  dive kick) and a 2-hit air-light chain.
- Introduce slide kick (attack during slide → low ragdoll trip).
- Introduce back-counter (back-heavy = parry stance, clash on successful read).
- Preserve the game's signature ragdoll feel — strikes stay puppeted during
  active frames; only launcher/heavy hits push the victim into ragdoll.
- Reduce triple jump to double jump (1 ground + 1 air).
- Overhaul the slide animation (currently weak) and the crouch (rework into a
  prone with ragdoll limbs and an aim-tracking arm).
- Mirror everything on mobile via existing 4-button cluster + drag stick.

## Non-Goals

- No new attack button. Single attack button + hold-release stays.
- No chase / pursuit teleport after launcher.
- No new weapons or items.
- No motion-input fighter inputs (no quarter-circles, charge motions, etc.).
- No stamina / ki gauge.

## Glossary

- **Light** — attack press released before 0.20s held. Stagger-only,
  never ragdolls.
- **Heavy** — attack press held ≥ 0.20s, fires on release or auto-fires
  on the threshold tick. Launcher; ragdolls victim. Direction at
  fire-time selects variant.
- **Chain** — sequenced lights, step 0..4. Window 0.45s between hits before
  reset. Heavy inserted anywhere → terminates chain.
- **Launch** — ragdoll-on-hit flag. Heavies and slide kick set it; lights do
  not.
- **Juggle** — flag on victim during launched-airborne window. Air-light hits
  do reduced damage to keep them airborne; air-heavy ends juggle with full
  damage.
- **Counter-hit** — landing a hit while victim is in attack startup
  (phase < 0.5). +30% damage and +30% stun.
- **Clash** — existing two-strikes-meet mechanic. Both fighters bounce,
  attack timers cancel, brief stagger. Reused for successful back-counter.

## Architecture

Combat state lives on `Stickman`. Pose math lives on `StickmanRig`. Input layer
buffers press/release timing. No new files.

```
Input snapshot (per frame)
  ├ moveX, moveY
  ├ attackPressed   (edge)
  ├ attackReleased  (edge)
  ├ attackHeldFor   (seconds since press, 0 if not held)
  └ attack          (raw held bool)
      ↓
Stickman._strikeFSM(snapshot)
  ├ on press → enter charging, snapshot pressDir
  ├ on release/threshold → resolve light vs heavy, pick moveId by dir + airborne
  ├ slide override → fire 'slideKick' immediately
  └ writes moveId, attackTimer, chainStep, chainTimer, parryUntil
      ↓
Stickman._attackTick(dt, players)
  ├ reads MOVE_TABLE[moveId] → reach, radius, dmg, kb, stun, launch, heightOffset
  ├ active phase window per move
  ├ hit detection (existing loop, now per-move profile)
  ├ counter-hit detection vs victim.attackTimer / phase
  ├ juggle scaling on victim.juggled
  └ victim.takeDamage(...) with launch flag
      ↓
StickmanRig.draw(params)
  ├ params.moveId → POSES[moveId](attackProgress, ...) (replaces attack/kicking bools)
  ├ params.prone → prone body + loose limb override
  └ params.charging → charge glow particle + body sway tell
```

Files touched:

- `src/entities/Stickman.js` — replace `_doAttack` + `_attackTick`; add charge,
  parry, juggle, counter-hit state. Reduce `airJumps` from 2 → 1.
- `src/entities/StickmanRig.js` — pose dispatcher keyed on `moveId`; prone +
  slide pose rewrite; charge tell visuals.
- `src/input/Input.js` — track `attackHeldFor`, `attackReleased`, cached
  `_pressDir`.
- `src/input/TouchControls.js` — same press/release timing exposed. No new
  buttons.
- `src/ai/Bot.js` — bot picks heavy directions, uses slide kick and
  back-counter contextually.

## Move Table

All moves share shape: `{ id, type, dur, activeStart, activeEnd, reach, radius,
dmg, kbX, kbY, stun, launch, heightOffset }`. `activeStart` / `activeEnd` are
normalized 0..1 progress.

### Ground lights (chain step 0..4)

Released ≤ 0.20s hold. Stagger only. Chain window 0.45s. Step 4 resets chain.

| Step | Move                         | Style       | dur  | active     | reach | dmg | kbX | kbY | stun |
|------|------------------------------|-------------|------|------------|-------|-----|-----|-----|------|
| 0    | Jab (straight)               | Wing Chun   | 0.14 | 0.25–0.70  | 0.95  |  6  |  5  |  1  | 0.15 |
| 1    | Cross                        | Boxing/Kenpo| 0.16 | 0.30–0.75  | 1.00  |  8  |  7  |  1  | 0.20 |
| 2    | Hook                         | Kenpo       | 0.18 | 0.30–0.75  | 0.90  | 10  |  6  |  2  | 0.25 |
| 3    | Knee                         | Muay/Kung Fu| 0.18 | 0.35–0.70  | 0.70  | 11  |  5  |  4  | 0.30 |
| 4    | Spinning back-fist           | TKD         | 0.24 | 0.40–0.75  | 1.10  | 14  | 12  |  3  | 0.35 |

Stun escalates through chain so each landed hit re-stuns long enough for the
next to true-combo on grounded victims.

### Ground heavies (release > 0.20s, direction at release)

| Dir      | Move                         | Style       | dur  | dmg | kbX | kbY | launch | note                                  |
|----------|------------------------------|-------------|------|-----|-----|-----|--------|---------------------------------------|
| neutral  | Blow-away palm strike        | Wing Chun   | 0.45 | 22  | 18  |  4  |  yes   | Horizontal punt ragdoll               |
| up       | Rising uppercut launcher     | Kenpo       | 0.45 | 18  |  4  | 14  |  yes   | Sets victim.juggled = true            |
| down     | Overhead axe / hammer        | Kung Fu     | 0.50 | 25  |  6  | -8  |  yes   | Slams victim into ground              |
| forward  | Charging shoulder/elbow      | Kenpo       | 0.40 | 20  | 16  |  5  |  yes   | Apply body.velocity.x += facing*8 on startup |
| back     | Counter-stance (parry)       | Wing Chun   | 0.55 |  0  |  —  |  —  |   —    | Active parry 0.25s, clash on parry    |

Back-counter has no hitbox of its own. It sets `parryUntil = now + 0.25s` and
`parryRecoverUntil = now + 0.55s`. During parryUntil, incoming melee triggers
the existing `_clash(attacker)` resolution. Whiff = locked into recovery
(punishable by counter-hit bonus on opponent).

### Aerials (airborne + attack)

| Input                | Move                         | Style    | dur  | dmg | kbX | kbY | launch | note                              |
|----------------------|------------------------------|----------|------|-----|-----|-----|--------|-----------------------------------|
| air light step 0     | Flying knee                  | Muay/TKD | 0.20 |  9  |  8  |  2  |   no   | Air chain step 0                  |
| air light step 1     | Air hook                     | Kenpo    | 0.22 | 11  |  9  |  2  |   no   | Air chain step 1, then resets     |
| air heavy neutral    | Somersault axe kick          | TKD      | 0.45 | 20  | 10  |  3  |  yes   | Full body spin, leg overhead      |
| air heavy up         | Rising knee launcher         | Muay     | 0.40 | 16  |  3  | 15  |  yes   | Pop self upward, propel victim    |
| air heavy down       | Dive kick                    | TKD      | 0.40 | 22  |  8  | -10 |  yes   | Apply body.velocity.y -= 12, vx += facing*6 on startup |

### Special

| Input                          | Move        | dmg | launch | note                                       |
|--------------------------------|-------------|-----|--------|--------------------------------------------|
| sliding + tap attack           | Slide kick  | 14  | yes    | heightOffset = -0.35 (foot level), kb (facing*8, 1.5), trips → ragdoll low/sideways |

### Damage scaling rules

- Counter-hit: when the victim is themselves mid-attack (their
  `attackTimer > 0` and their own progress `phase < 0.5`, i.e. still in
  startup), multiply dmg × 1.3 and stun × 1.3. Phase here is the victim's
  own progress through their move, not the attacker's.
- Juggle: if victim.juggled is true and the move type is air-light,
  multiply dmg × 0.6 and kb × 0.5. Air-heavy ignores juggle scaling and
  clears the juggle flag.
- Juggle cap: at most 4 launched hits per juggle window. Each landed hit
  during juggle extends `juggledUntil` by 0.4s up to a hard ceiling of
  1.2s from initial launch.
- Existing super-punch / gum-gum overrides keep priority. If those flags
  are live, dmg/kb override per-move values exactly as today (heavies and
  lights both upgraded).

## Input + State Machine

### Input layer additions

`src/input/Input.js` snapshot fields:

```
attackPressed     // false→true edge this frame
attackReleased    // true→false edge this frame
attackHeldFor     // performance.now() - pressedAt, in seconds; 0 if not held
attack            // raw held bool (existing)
moveX, moveY      // existing
```

`src/input/TouchControls.js` exposes the same shape. Attack button
records `pressedAt` on touchstart and emits `attackReleased = true` on
touchend. Heavy always fires on release on both PC and mobile — there
is no auto-fire at the threshold tick. Mobile players hold past 0.20s
and lift to commit the heavy, matching PC behaviour exactly.

Press-direction caching: at the moment of `attackPressed`, snapshot
`_pressDir = { x: moveX, y: moveY }`. Used only for light moves (they fire
immediately). For heavies, direction is sampled at release time from live
moveX/moveY — so the player can hold and re-aim during charge.

### FSM (in Stickman)

State fields added:

```js
this.moveId           = null;   // 'jab'|'cross'|...|'heavyUp'|'slideKick'|null
this.chainStep        = 0;      // 0..4 ground light chain
this.airChainStep     = 0;      // 0..1 air light chain
this.chainTimer       = 0;      // s remaining in chain window
this.chargeStartedAt  = 0;      // perf.now() ms at attack press
this.charging         = false;
this._pressDir        = { x: 0, y: 0 };
this.parryUntil       = 0;      // ms
this.parryRecoverUntil= 0;      // ms
this.juggled          = false;
this.juggledUntil     = 0;      // ms
this.juggleHits       = 0;      // count this juggle window
```

Strike resolution pseudocode:

```
on attackPressed (and !frozen):
  if attackCooldown > 0: return
  if charging or moveId != null: return
  if sliding and grounded:
    fire('slideKick'); return
  if now() < parryRecoverUntil: return     // locked by whiffed parry
  charging = true
  chargeStartedAt = now()
  _pressDir = { x: moveX, y: moveY }

per-frame while charging:
  held = (now() - chargeStartedAt) / 1000
  if attackReleased:
    resolveCharge()        // released — light if < 0.20, heavy if >= 0.20
  // note: there is no auto-fire-on-threshold while still held.
  // If player keeps holding past 0.20s, the heavy fires only on release.
  // (The held-direction can still be re-aimed up to the moment of release.)

resolveCharge():
  charging = false
  held = (now() - chargeStartedAt) / 1000
  dir = (held >= 0.20) ? liveDir(moveX, moveY) : _pressDir
  if held >= 0.20:
    moveId = heavyForDir(dir, airborne)        // 'heavyNeutral'|'heavyUp'|'heavyDown'|'heavyForward'|'heavyBack'|'airHeavyN'|'airHeavyU'|'airHeavyD'
    chainStep = 0; airChainStep = 0; chainTimer = 0
    if moveId == 'heavyBack':
      parryUntil       = now() + 250
      parryRecoverUntil= now() + 550
  else:
    if airborne:
      moveId = airChainStep == 0 ? 'airJab' : 'airHook'
      airChainStep = (airChainStep + 1) % 2
    else:
      moveId = CHAIN[chainStep]                 // jab,cross,hook,knee,spinBack
      chainStep = (chainStep + 1) % 5
      chainTimer = 0.45
  m = MOVE_TABLE[moveId]
  attackTimer    = m.dur
  attackCooldown = m.recovery
  attackHits.clear()
  // startup-impulse hook: heavyForward / airHeavyD apply velocity changes here
  applyStartupImpulse(moveId)

per-frame chain decay:
  if chainTimer > 0:
    chainTimer -= dt
    if chainTimer <= 0: chainStep = 0
```

### Hitbox check per move (`_attackTick`)

Same loop structure as today, but per-move profile:

```
m = MOVE_TABLE[moveId]
phase = 1 - attackTimer / m.dur
if phase < m.activeStart or phase > m.activeEnd: return  // not active
cx = position.x + facing * m.reach
cy = position.y + m.heightOffset      // 0.15 standard, -0.20 kick, -0.35 slide-kick, +0.40 uppercut
for each player p in range:
  if p hit already: continue
  if dist(p, (cx,cy)) > m.radius: continue
  let dmg = m.dmg, kbX = facing * m.kbX, kbY = m.kbY, stun = m.stun
  // counter-hit (victim is in their own attack startup)
  p_phase = 1 - p.attackTimer / MOVE_TABLE[p.moveId].dur
  if p.attackTimer > 0 and p_phase < 0.5:
    dmg *= 1.3; stun *= 1.3
  // juggle
  if p.juggled and isAirLight(moveId): dmg *= 0.6; kbX *= 0.5; kbY *= 0.5
  // super / gum-gum overrides take priority (existing branches preserved)
  p.takeDamage(dmg, { attacker: this, weapon: 'fist', kb: { x: kbX, y: kbY }, stun, launch: m.launch })
  attackHits.add(p.id)
  if m.launch and dirIs('up', moveId):
    p.juggled = true
    p.juggledUntil = now() + 1200
    p.juggleHits = 0
  if p.juggled:
    p.juggleHits++
    if p.juggleHits >= 4: p.juggled = false
```

`p.takeDamage` already exists. New: read `opts.launch` and trigger ragdoll
when true (extend existing ragdoll path).

Projectile reflection / chain severance loops stay as-is — they read from
the same cx/cy/radius the move table now provides.

### Back-counter resolution

In `Stickman.takeDamage` (or `_isMeleeClashIncoming` adjacent), before
applying damage:

```
if now() < this.parryUntil and weapon in {'fist','melee','lightProj'} and attacker:
  this._clash(attacker)          // existing two-strike clash
  parryUntil = 0                 // single-shot per stance
  attackTimer = 0                // exit counter-stance, ready to act
  return                         // damage suppressed
```

Clash already bounces both, kills attack timers, applies the stagger
lockout. Exactly the requested "treat it like two punches connected"
outcome.

### Slide kick

`sliding` is set by existing crouch + momentum logic. New: when sliding
and `attackPressed`, FSM short-circuits charge logic and immediately fires
`slideKick`. heightOffset is -0.35 so the foot meets ankles, not torsos.
Launches victim sideways/low (kbY = 1.5, no upward pop) — distinct "trip"
profile vs heavies' upward arcs. Slide can't be entered mid-air, so no
guard needed there.

## Rig Animation

### Pose dispatch

`StickmanRig.draw(params)` reads `params.moveId`. If `moveId` is null,
existing idle/walk/run logic runs. Otherwise:

```js
const POSES = {
  jab: poseJab, cross: poseCross, hook: poseHook, knee: poseKnee,
  spinBack: poseSpinBack,
  heavyNeutral: poseBlowAway, heavyUp: poseUppercut, heavyDown: poseAxe,
  heavyForward: poseCharge, heavyBack: poseCounterStance,
  airJab: poseFlyingKnee, airHook: poseAirHook,
  airHeavyN: poseSomersault, airHeavyU: poseRisingKnee, airHeavyD: poseDive,
  slideKick: poseSlideKick,
};
POSES[params.moveId](params, ...);
```

Each pose function is three-phase (windup / strike / recover) over
`attackProgress` (0..1). Reuses existing arc style from current `attack`
arm logic. Concrete arc tunings:

- **Jab** — straight punch out from chamber; off-arm pulls back to chest.
  Lead arm only. Light body twist (~0.10 rad forward).
- **Cross** — opposite arm, full hip/shoulder rotation (~0.25 rad). Longer
  reach than jab.
- **Hook** — circular arc, hand starts wide and curves in to centerline.
  Body twists +0.30 rad on follow-through.
- **Knee** — knee drives up to chest height. Off-leg planted, body folds
  forward ~0.20 rad. Arms swing down for balance.
- **Spinning back-fist** — full 180° body twist on strike phase, trailing
  arm whips through at head height. Both feet pivot.
- **Blow-away palm** — both palms stack and thrust forward (Wing Chun
  Fak Sao stack). Heel-of-palm contact. Big follow-through (arm extends
  beyond reach).
- **Uppercut** — windup: deep knee bend, hand drops to hip. Strike: hand
  rises through chest line to overhead. Body lifts. Heavy upward kbY.
- **Axe** — windup: both hands overhead, body raised. Strike: hammer-fist
  slams straight down. Stomp the lead foot on impact (existing landing
  particles).
- **Charge** — body lunges forward ~0.40 rad, shoulder leads. Lead arm
  extended elbow-strike. Startup impulse adds horizontal velocity.
- **Counter-stance** — body turns ~0.30 rad away from facing (back to
  attacker stance), lead palm raised in Wing Chun bong-sao guard. Arm
  tracks the most-likely incoming attacker direction (nearest enemy in
  range). No strike-arm arc.
- **Somersault axe (air)** — full body rotation around bodyTilt; at the
  rotation apex, lead leg snaps straight overhead (axe form).
- **Rising knee (air)** — body curls into a tuck; knee leads upward at
  apex.
- **Dive kick** — body angles 45° downward, both legs extend point-first,
  arms tucked back. Startup impulse drives downward + slightly forward.
- **Slide kick** — body horizontal (already prone-pitched from slide),
  lead leg extends forward and sweeps low.

### Slide animation overhaul

Current slide reuses run pose. New slide pose (active whenever
`params.sliding` true):

- Body pitches forward to roughly -π/3 (head leading the slide).
- Head pitches back ~+0.25 rad — looking forward despite body pitch.
- Lead leg extends 1.3 from hip along slide direction.
- Trail leg tucks under (knee to chest).
- Arms drift backward + slightly up (wind-drag look). Off-arm trails the
  most, lead arm a little less.
- This pose holds for the entire slide duration. Slide-kick = same pose,
  but lead foot snap-extends at activeStart with audio cue and the kick
  hitbox.

Coast feel: existing slide velocity decay stays. Visual feedback now
matches the low coast.

### Prone crouch overhaul

Activated by `params.prone = true` whenever the player is crouching and
not sliding.

- Body lays near-horizontal (~0.4 above ground). bodyTilt → -π/2 + small
  bob from breathing.
- Lower body + off-arm: blend weight to pose targets drops to ~0.15 so
  the spring solver lets limbs hang loose. Gravity acts more visibly.
  Concretely: pose target is still computed, but the rig's IK blend
  weight is lowered for these joints in prone mode.
- Aim-arm: stays stiff (high blend weight), tracks `aim.x/y` exactly like
  the existing aim pose. The character looks like a ragdoll on the
  ground but with a deliberate arm raised toward the cursor.
- Exit prone: any movement input magnitude ≥ 0.4, jump, attack press, or
  slide entry → blend out over 0.12s back to idle.

### Charge tell

While `params.charging` is true:

- Spawn one glow particle every ~5 frames on the striking limb (palm for
  punch-flavored heavies — neutral/forward/back/up; foot for kick-flavored
  — down/airHeavy variants).
- Subtle audio rumble loop (low frequency sine, 0.05 gain) started on
  press, killed on release.
- Body sways ±0.05 rad bodyTilt to telegraph windup.

## Edge Cases

- **Mid-charge stagger**: if hit while `charging`, charge cancels,
  no heavy fires, attack button consumed. `chainStep` preserved so
  flinch-and-resume keeps the combo readable.
- **Mid-move ragdoll/death**: full clear — `charging = false`,
  `moveId = null`, `chainStep = 0`, `airChainStep = 0`, `juggled = false`,
  `parryUntil = 0`.
- **Slide expires mid-slide-kick**: slide-kick keeps playing to end.
  Startup is committed — don't cancel because `sliding` flipped false.
- **Jump during charge**: jump prioritized; charge cancels.
- **Air charge → air heavy**: release-dir picks air variant
  (`airHeavyN`/`U`/`D`). Heavy back/forward in air = falls back to
  airHeavyN (no separate variants).
- **Juggle stacking**: each landed launched hit during the window
  extends `juggledUntil` by 0.4s, capped at 1.2s from initial launch.
  Hard cap 4 hits.
- **Multiple-victim heavies**: all victims in the hitbox get
  `launch=true` and ragdoll. Juggle flags tracked per-victim.
- **Back-counter vs explosion/super/lightning/forcePush**: parry only
  deflects `weapon ∈ {fist, melee, lightProj}`. Heavies from other
  fighters with `weapon='fist'` are deflected. Existing super/gum-gum
  hits pass through.
- **Back-counter vs thrown corpse**: throw weapon string is `'thrown'` —
  not in deflect list, ignored.
- **Slide-kick mid-air**: impossible — slide entry requires grounded.
  Guard `if (sliding && grounded)` in FSM.
- **Light press during heavy charge**: ignored. Charging blocks all new
  attack inputs until resolved.
- **Counter-hit on parry whiff recovery**: intended punish — whiff
  recovery is a victim windup window, so opponent's hit lands with the
  +30% bonus.
- **Weapon swap mid-charge**: charge cancels (weapon path takes over via
  `weapon.tryFire(this)` on next press).

## AI updates (Bot.js)

- **Spacing-based heavy choice**:
  - opponent grounded + stunned + close → up-heavy launcher (start juggle).
  - mid-range + opponent grounded + neutral → forward-heavy charge.
  - opponent airborne above → wait to dive on landing, or jump + airHeavyU.
  - opponent airborne below → diveKick.
  - opponent prone/grounded low → axe (down-heavy).
- **Light chain**: at close range + facing, mash lights with 0.16s gaps.
  Stops chain at step 3 sometimes to bait into back-counter.
- **Back-counter**: ~15% baseline chance to enter counter-stance when
  detected incoming swing within 0.4s reach. Scales with difficulty.
- **Slide-kick**: if running + opponent within slide reach + opponent
  not airborne → crouch + tap attack.
- **Charge timing**: bot holds charge for variable 0.25–0.45s before
  releasing to avoid predictability.

## Performance + Risk

- Combat code runs once per Stickman per frame. Move table lookup is O(1).
- Charge particles spawn every 5 frames per charging fighter — already
  throttled by frame count.
- Expected per-frame cost delta: ≤ 0.1ms per active fighter. Negligible
  against existing physics tick.
- Memory: `MOVE_TABLE` is a small static object (~15 entries).
- **Rollback risk**: isolated to combat path. Weapons untouched
  (still call `weapon.tryFire(this)` from heavy/light dispatch when a
  weapon is equipped — heavy/light only matter to unarmed). Existing
  super-punch / gum-gum hooks preserved by passing through their
  damage/kb overrides.

## Verification Plan

Per project memory: browser-only verification, no test framework. Run via
`preview_start` + `preview_eval` against the local dev server.

1. **Move dispatch coverage**: force player into each `moveId` via debug
   console; confirm rig anim renders and hitbox lands expected dmg.
2. **Light chain timing**: mash attack → exactly 5 hits land at chain
   progression (jab→cross→hook→knee→spinBack). 6th press = jab.
3. **Heavy threshold**: tap (< 0.20s) = light; hold (> 0.20s) = heavy on
   release. Console log `moveId` after each.
4. **Heavy direction sample**: hold attack, sweep stick through up/down/
   forward/back, release → fired moveId matches release direction.
5. **Up-heavy launcher → juggle**: land heavyUp on bot, follow with air
   heavy → confirm bot ragdolls upward, juggle flag set, second hit ends
   juggle with full damage.
6. **Slide kick**: sprint + crouch + tap attack → slide-kick fires; bot
   trips low/sideways (kbY ≈ 1.5, no upward pop).
7. **Back-counter clash**: charge back-heavy while bot swings → existing
   `_clash` triggers, both bounce, no damage either side.
8. **Back-counter whiff recovery**: charge back-heavy, no incoming →
   `parryRecoverUntil` blocks new attacks for ~0.40s.
9. **Counter-hit bonus**: land a light on bot during its windup → dmg
   instrumented to be exactly 1.3× base, stun 1.3× base.
10. **Double-jump cap**: confirm `airJumps = 1` (1 ground + 1 air).
11. **Prone crouch**: crouch idle → body horizontal, off-arm/legs swing
    loose under gravity, aim arm tracks cursor.
12. **Slide animation**: enter slide → body pitches forward, head looks
    forward, arms trail. Distinct from run pose.
13. **Mobile parity**: `preview_resize` to 390×844, repeat 1–6 with touch
    (drag-stick direction + tap/hold attack button).
14. **Weapons unaffected**: pick up gun, fire — weapon path executes,
    combat FSM does not interfere.
15. **Super-punch / gum-gum**: activate either power, throw heavy →
    damage/kb override still applied on top of move table base.

## Open Items (deferred to plan)

- Exact glow particle color per heavy variant (cosmetic — pick during
  implementation).
- Prone-mode IK blend weight implementation depends on inspecting the
  existing rig solver — confirmed only at implementation time.
- Charge audio rumble — extend `audio.beep` to a sustained tone, or
  reuse existing `audio.engine`-style loop. Pick at implementation.
