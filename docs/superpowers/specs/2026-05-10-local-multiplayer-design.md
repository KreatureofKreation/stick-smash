# Local Multiplayer (up to 4 players) — Design

## Goal

Add couch-style local multiplayer to Stick Smash Party. Up to 4 human players share one screen. Match starts via the existing PLAY (BOTS) flow; extra players are auto-detected from connected gamepads at start. Existing single-player, bot, and online flows remain unchanged.

## Player slots

- **P1** — keyboard + mouse (existing input). Always present.
- **P2 / P3 / P4** — gamepad-only, by `navigator.getGamepads()` index. No second-keyboard split.
- Quick-start: at match start, query connected gamepads. Each connected pad becomes one extra local player with a random unused roster character. P1's chosen character is reserved.

## Bot replacement rule

```
extras  = min(connectedPads, 3)            // human players besides P1
bots    = max(0, requestedBots - extras)   // bots fill remaining slots
```

Locals replace bots. Existing solo flow unchanged when no pads are connected. Total roster cap: 4 humans + remaining bots from slider.

## Architecture changes

### `src/Game.js`

- New `Game.localPlayers: Stickman[]` (length 1–4). P1 always at `[0]`.
- Keep `Game.localPlayer` pointing at `localPlayers[0]` so HUD, end-game logic, and online code paths keep working unchanged.
- `_startMatch` extension: after spawning P1, call `_spawnExtraLocals(extras)` before the bot loop. Each extra Stickman gets `isLocal = true` and an `inputSource = { kind: 'gamepad', gamepadIdx: <idx> }`.
- P1's `inputSource = { kind: 'kb-mouse' }`.
- `_update`: replace the single-`localPlayer` input block with a loop over `localPlayers`. Each gets its own snapshot from `input.getSnapshotFor(p.inputSource)`. Mouse-aim raycast only runs for the player whose source is `kb-mouse`.
- `restart()` preserves the local roster and characters; same gamepads required (any disconnected pad's slot drops out).
- `endMatch` / `_cleanup` reset `localPlayers` to `[]`.

### `src/input/Input.js`

- New `getSnapshotFor(source)` method:
  - `kind: 'kb-mouse'` → existing combined kb + touch + mouse path (P1 only).
  - `kind: 'gamepad', gamepadIdx: N` → strict per-index polling (no fallback to other pads). Returns the existing gamepad snapshot shape.
- Existing `getCombined`, `getKbSnapshot`, `getGamepadSnapshot` stay; `getSnapshotFor` is a thin dispatcher built on them.
- Extend `consumeGamepadPause` to accept any pad index, so any local player's Start button pauses.

### `src/entities/Stickman.js`

- Add `inputSource` field on the constructor (default `null`). No behavior change beyond storing it; consumed by `Game._update`.

### `src/ui/HUD.js` + `src/ui/styles.css`

- HUD renders a per-local strip: HP bar + weapon icon for each `localPlayers[i]`.
- Slot positions: `P1 top-left`, `P2 top-right`, `P3 bottom-left`, `P4 bottom-right`. Slots not in use stay hidden.
- Existing single-player layout (HP bar bottom, weapon icon side) becomes the P1 slot at top-left when there are ≥2 locals; in solo it keeps the current position.
- Damage flash, buffs panel, time-slow vignette stay P1-only — they're full-screen overlays that don't make sense per-player.
- Scoreboard pills already show every player; no change.

## Win / lose

- Match ends when exactly **one** player (any kind) is alive — that's the winner. Message names the survivor.
- If all players are eliminated on the same frame (`stillIn.length === 0` after `players.filter(p => p)` ≥ 2), declare a draw ("DRAW", no winner name).
- No early "you died" screen when other local humans are still alive.
- `_checkGameOver`: drop the `localPlayer.lives <= 0` early-exit branch when `localPlayers.length > 1`. The `stillIn === 1` branch shows VICTORY for the survivor — extend its message to use the survivor's name (not always P1's).
- `restart()` rebuilds the same set of locals (P1's char preserved, P2–P4 re-randomized from current pad list) — disconnected pads' slots are dropped.

## Pause

- Esc / P / any connected gamepad Start triggers pause. Existing pause flow unchanged.

## Net interaction

- Online mode stays single-local. `startOnline` / `startHosted` / `startAsClient` paths only spawn P1 as local. Local MP is offline-only.
- Net code (`Net.js`, `applySnapshot`) untouched.

## Files touched

- `src/Game.js` — main changes (local roster, per-player input, win condition, restart).
- `src/input/Input.js` — `getSnapshotFor` dispatcher, multi-pad pause polling.
- `src/entities/Stickman.js` — `inputSource` field.
- `src/ui/HUD.js` — per-local HP + weapon icon strip.
- `src/ui/styles.css` — slot positioning for the four corners.

## Out of scope

- No pre-match lobby UI. No per-player character select for P2–P4.
- No second-keyboard split.
- No online + local-MP combo (joining a net match as a 2-player team).
- No split-screen camera. Existing dynamic-frame camera already follows all players.
