# Stick Smash — Refactor & Test Plan

A living roadmap for paying down the structural debt identified in the
codebase review. The guiding principle: **never ship an unverifiable refactor**
— each step lands behind a check that can prove it didn't break anything
(`node --check`, unit tests, the module-integrity test, or the headless smoke
test). Pure-logic extractions come first because they're the cheapest to test.

Status legend: ✅ done · 🔜 next · ⬜ planned

---

## Safety net (foundation)

The test harness that makes everything below safe to attempt.

- ✅ **`npm run check`** — `node --check` on every `src/**/*.js`. Mechanizes the
  PR-template syntax-check box.
- ✅ **`npm test`** — `node:test` unit + integrity suites, zero deps, fast.
- ✅ **`npm run test:smoke`** — headless Chromium boots the real game, starts a
  match, asserts the loop runs clean. Skips when CDNs are firewalled.
- ✅ **CI** (`.github/workflows/ci.yml`) — runs check + tests on every PR/push;
  a second job runs the smoke test with Playwright.
- ✅ **Module-integrity test** (`test/integrity/`) — imports the real weapon
  graph under stubbed Three/cannon and asserts every registry class resolves.

**Next for the net:**
- ⬜ Make the `smoke` and CI jobs **required checks** in branch protection.
- ⬜ Extend the smoke test to drive an input (attack/jump) and reach game-over,
  not just "runs clean for N seconds".

---

## Phase 1 — Pure-logic extractions ✅ (started)

Move dependency-free math out of god-objects into tested modules.

- ✅ **Spawn solver** → `src/levels/spawnSolver.js` (+ unit tests). Lifted the
  spawn-safety math out of `Game.js`; `Game.js` delegates via `_spawnWorld()`.
- ✅ **Weighted spawn pick** → `src/weapons/spawnPick.js` (+ unit tests).
- ⬜ **Kill-feed verb map** (`Game._verb`, `Game.js`) → data table next to the
  weapons; trivially testable.

---

## Phase 2 — Weapon module split ✅ (first pass)

- ✅ `weapons.js` reduced from ~3550 lines to a ~100-line **barrel**. Classes
  live in `melee/ranged/fun/supers/pickups.js`; external imports unchanged.
- 🔜 **Split `ranged.js` further** (~1490 lines): pull throwables/explosives
  (`Grenade`, `RPG`, `StickyBomb`, plus `MeteorStorm` from supers) into
  `throwables.js`. The barrel + integrity test already make this a safe move.
- ⬜ Promote per-weapon stat blocks (damage, fireDelay, throwImpulse…) into a
  data table like `Stickman`'s `MOVE_TABLE`, so balance tuning is data, not code.

---

## Phase 3 — Snapshot codec (netcode) ⬜

**Highest-value remaining refactor; also the highest-risk — touches live
netcode, so it must land with the smoke test green in CI.**

- ⬜ Extract `Game._snapshot()` / `Game.applySnapshot()` into
  `src/network/Snapshot.js` with paired `encode`/`decode` driven by a single
  field schema, so the encoder and decoder **cannot drift** (today they're 150
  lines apart and adding a field to one half silently desyncs net play).
- ⬜ Add a **round-trip test**: `decode(encode(state))` preserves the symmetric
  fields. Catches the drift bug class permanently.
- ⬜ Verify in CI via the smoke test (browser-side), since the decode path
  constructs entities and can't run under the node stubs.

---

## Phase 4 — Harden the network boundary ⬜

Public room = anyone can join. Incoming peer data is currently trusted.

- ⬜ Validate/clamp every field in `Net._handleClientMessage` /
  `_handleHostMessage` before it reaches `applySnapshot` (positions, hp, lives,
  ids, array lengths, peer-supplied `character`).
- ⬜ Replace the dedupe-by-message-string error suppression in `Game._tick`
  with a ring buffer of distinct errors, so intermittent throws surface in
  playtests instead of being swallowed.

---

## Phase 5 — Decompose `Game.js` ⬜

`Game.js` (~1130 lines) owns rendering, physics, input, net, menu, HUD, the
main loop, serialization, and game-over logic. Carve out cohesive units, each
behind the smoke test:

- ⬜ **MatchController** — `_startMatch` variants, countdown, restart, cleanup.
- ⬜ **Loop/stepper** — the `_update` step ordering (input → AI → physics →
  rig sync → pickups → respawn → spawn → game-over), with the mode branches
  (`net.role`) made explicit.
- ⬜ **Spawn manager** — item/weapon spawning (already leans on the solver).

---

## Phase 6 — Strip dev harness from prod ⬜

`util/__weaponDebug.js` (~760 lines) and the `window.__*` hooks
(`__weaponTest`, `__forceFeatures`, `__test`, `__anim`) ship in runtime paths.

- ⬜ Gate them behind a `?dev=1` dynamic import so production never loads them
  and `window.__forceFeatures` can't silently alter a real match.

---

## Sequencing rationale

1. Foundation + Phase 1/2 first — cheap, pure, high-confidence (done / next).
2. Phase 3 next: biggest correctness win (net desync), gated by the smoke test.
3. Phase 4 alongside/after 3 — same files, untrusted-input mindset.
4. Phases 5–6 are larger structural moves; do them once the net layer is stable
   and the smoke test reliably exercises a full match in CI.
