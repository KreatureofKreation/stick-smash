# Animation + Combat Overhaul

**Status:** Autonomous build (user authorized: no review gates, full plan → execute → present).
**Branch:** `claude/anim-overhaul`.

## Goal

Overhaul the feel of walking, punching, kicking, jumping, aerial attacks, and grabbing. Make grabs **escapable**. Apply best-practice procedural-animation principles. Keep it fast (verified) and fully tunable.

## Constraints / reality

- **No visual verification available** in this environment (`preview_screenshot` times out; no Chrome for Playwright). Visual feel is judged by the user on the build. What IS verified here: no crashes/NaN across all states, correct state-machine transitions, the escapable-grab mechanic (fully testable), and **performance** (frame-time before/after).
- **Perf baseline (measured):** full `_update` ≈ 0.69 ms/frame (4 players), rig.update ≈ 0.018 ms/player. The system is already cheap. Hard requirement: the overhaul must not regress this materially (target: full update stays < 1.2 ms with 4 players).
- **Keep the proven scaffolding** (MOVE_TABLE, the phase/charge FSM, IK, springs). Rebuild the *expressive layer* (poses, weight, timing) and *add* the grab-escape system. Don't rip out working, fast code.

## Animation principles applied (the spec for "feel")

Every action follows **anticipation → contact → follow-through → settle**:

1. **Anticipation** — a counter-motion before the action (wind back before a punch, dip before a jump, chamber before a kick). Sells weight + telegraphs.
2. **Contact / snap** — ease-OUT into the impact frame (fast arrival), so the hit reads as a hit. Pose lands exactly on the move's active window.
3. **Follow-through / overshoot** — the limb passes the target then springs back; secondary parts (off-hand, torso, head) lag.
4. **Settle** — spring back to neutral, slight overshoot damped.
5. **Weight** — heavier moves get more anticipation + slower timing + bigger hip/foot weight shift; lights are snappy.
6. **Secondary motion** — torso wobble, head lag, hand jiggle (already present) tuned to support, not fight, the primary action.

All key magnitudes/timings live on `window.__anim` for live tuning.

---

## Work items

### 1. Escapable grabs (NEW MECHANIC — the marquee, fully testable)

State on the grabbed player:
- `_grabEscape` (0..1) — struggle progress.
- Filled by mashing: any fresh input edge (moveX direction change, jumpPressed, attackPressed, grabPressed) adds `GRAB_MASH_GAIN` (default 0.12). Passive decay `GRAB_ESCAPE_DECAY` (default 0.25/s) so you must actively mash.
- Reaches 1.0 → **break free**: remove constraint, shove grabber + grabbed apart (`GRAB_BREAK_KB` default 7), brief mutual stun (0.3s), short re-grab immunity on the escapee (`GRAB_IMMUNE` default 0.6s so you aren't instantly re-grabbed).

Auto-break conditions:
- **Timeout** — held longer than `GRAB_MAX_HOLD` (default 2.5s) → auto-break (same shove, lighter).
- **External hit** — if the *grabber* takes a knockback (`applyKnockback` with mag > 6) while holding, the grab breaks (drop, no shove).
- Grabber dies / ragdolls (already releases).

Throw still works: the grabber can throw before the escapee fills the meter — it's a race (mash vs. throw windup). This is the core interaction.

Implementation:
- Grabbed branch (`state === GRABBED`, Stickman.js ~1675) currently early-returns. Add: read input edges → accumulate `_grabEscape`; decay; check break; drive a `struggle` rig param (wobble amplitude = `_grabEscape`).
- `applyKnockback`: if `this.grabbing` and mag > threshold → release the grab (external interrupt).
- `_grabBody`: stamp `_grabStartT`. Grabber's per-frame carry checks timeout.
- Rig: a `struggle` param adds a quick shake to the grabbed body's torso/arms (amplitude scales with `_grabEscape`), reading as fighting to get free.
- Expose: `GRAB_MASH_GAIN, GRAB_ESCAPE_DECAY, GRAB_MAX_HOLD, GRAB_BREAK_KB, GRAB_IMMUNE` on `window.__anim`.

**Tests:** simulate mashing → breaks within ~1s; no-mash → held until timeout 2.5s → auto-break; hit the grabber → immediate break; throw before meter fills → victim thrown (race works); re-grab blocked during immunity.

### 2. Strike-pose overhaul (StickmanRig.js — punch/kick/aerial)

Rebuild the pose functions on a shared helper so all strikes share consistent anticipation/contact/follow-through/settle, parameterised by move weight:
- A `strikeCurve(phase, weight)` helper returning `{ anticip, strike, settle }` blend factors with ease-out contact + overshoot. Heavier `weight` → longer anticipation, bigger overshoot.
- Rebuild: `jab, cross, hook, knee, spinBack` (ground lights), `heavyNeutral/Up/Down/Forward/Back`, `airJab, airHook, airHeavyN(somersault), airHeavyU(rising knee), airHeavyD(dive)`, `slideKick`.
- Each: a clear chamber/wind-back, a snapped extension on the active frames, an overshoot, then settle. Off-hand guards/counterbalances. Hip/foot weight-shift via `footShift` + `leanZ`.
- Aerials (`airHeavyD` dive, `airHeavyU` rising knee, `airHook`) get real body rotation + limb arcs (memory: these were "still flat").
- Tunables: `STRIKE_ANTICIP, STRIKE_OVERSHOOT, STRIKE_SETTLE_K, LIGHT_SNAP, HEAVY_SNAP` on `window.__anim`.

### 3. Jump + land (Stickman.js jump + StickmanRig.js)

- **Anticipation crouch:** a short pre-jump dip. On jump press while grounded, set a `_jumpAnticip` timer (~60ms) that the rig reads to compress the legs *before* the launch impulse fires. (Buffer the actual velocity by the anticipation window OR fire immediately but show the compress as the takeoff pop — pick the one that doesn't add input latency: keep launch immediate, show a strong takeoff stretch + a 1-frame pre-compress via the existing `_takeoffPop`, enlarged.)
- **Apex tuck / fall reach** already exist (vy-driven leg phases) — tune for clearer read.
- **Land squash** already exists (`_landImpact`) — make it weightier + add a quick arm-down catch on hard landings.
- Tunables already partly present (`TAKEOFF_POP`, `LAND_WEIGHT`).

### 4. Walk refinement (StickmanRig.js)

- Keep the stance/swing foot-plant cycle (it's good). Add: clearer weight shift (hip sway side-to-side scaled by speed), stronger arm counter-swing, a subtle head bob lead. Tunables: `WALK_HIP_SWAY, WALK_ARM_SWING`.

### 5. Tunables consolidation

Extend the existing `window.__anim` block (StickmanRig.js top) with all new constants. Document each. Keep current defaults where they already feel right (per prior tuning PRs).

---

## File map

| File | Changes |
| --- | --- |
| `src/entities/Stickman.js` | Escapable-grab state machine (grabbed branch, `_grabEscape`, break conditions), `applyKnockback` grab-interrupt, `_grabBody` timestamp, jump anticipation hook, struggle param into `_syncRig`. |
| `src/entities/StickmanRig.js` | `strikeCurve` helper, rebuilt STRIKE_POSES, struggle wobble, walk hip-sway + arm-swing, jump/land enhancements, new `window.__anim` tunables. |

## Execution order (avoid StickmanRig.js conflicts — sequential)

1. **Grab-escape system** (Stickman.js-heavy + a small rig struggle hook).
2. **Strike-pose overhaul** (StickmanRig.js).
3. **Jump/land + walk refinement** (StickmanRig.js + Stickman jump).
Each step: implement → verify (no NaN across states, transitions correct, perf re-measured) → commit.

## Verification (per step + final)

- `node --check` on edited files.
- Browser: run a 4-bot match, drive players through idle/walk/run/jump/all attacks/grab; assert no console errors, no NaN in any rig joint or body velocity, all state transitions reachable.
- **Grab-escape mechanic tests** (deterministic): mash-break timing, timeout, hit-break, throw-race, re-grab immunity.
- **Perf:** re-measure full `_update` ms with 4 players brawling; must stay < 1.2 ms (baseline 0.69). Report before/after.
- Final: full sweep + perf table in the PR.

## Out of scope

- Weapon swing animations (separate system).
- Bot AI changes.
- Netcode for the new grab-escape state (host-authoritative position sync already covers it; `_grabEscape` is derived locally).
