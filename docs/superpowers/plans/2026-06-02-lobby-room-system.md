# Lobby / Room System (room code + ready-up)

**Status:** Autonomous build. Drop-in/drop-out stays the DEFAULT; this ADDS a room-code lobby alongside it.

## Goal

A host creates a room → gets a short **room code** → friends enter the code to join → everyone sees a **lobby** (player list, character swatches), each client **readies up**, the host picks level/bots and **starts** the match. The existing drop-in "Quick Play" (public room, join mid-match) is untouched and remains the default online path.

## Key leverage (from the netcode map)

- `Net.connect(roomId, opts)` already: tries to connect to a peer with `id = roomId`; if unavailable → becomes HOST (registers a peer named `roomId`); else → CLIENT. **So a room code can simply BE the roomId.** No new signaling.
- `refreshLobby()` is already a stub on the Menu, already called from `Net._refreshPeers()` on connection changes — the hook exists.
- The risky coupling: `_becomeHost()` currently calls `game.startHosted()` IMMEDIATELY (no lobby). We split that: host with a lobby flag → show lobby → start on the host's button.

## Design

### Room code
- 4-char uppercase alphanumeric (avoid ambiguous chars: no O/0/I/1). Generated host-side. The actual PeerJS room id is namespaced: `roomId = 'ss-room-' + CODE` (keeps it off the public room).
- `Net.connect` gains an `opts.lobby = true` + `opts.code`. Quick Play keeps `lobby:false` + the existing `PUBLIC_ROOM`.

### Online menu split
`PLAY ONLINE` → a small chooser:
- **Quick Play** → existing drop-in flow (public room, immediate). Unchanged.
- **Create Room** → host: generate code, `connect('ss-room-'+code, {lobby:true, code, host-intent})` → on host, show lobby.
- **Join Room** → input a code → `connect('ss-room-'+code, {lobby:true, code})` → on client, wait for lobby-state → show lobby.

### Lobby state (host-authoritative)
- New game flag `game.lobbyActive` (true = in lobby, match not running).
- Host maintains a lobby roster: `[{ id, name, character, ready, isHost }]` from `net.connections` + the host itself.
- Host broadcasts `{ t:'lobby', code, levelId, bots, players:[...] }` whenever the roster changes (join/leave/ready/level-pick).
- Client message `{ t:'ready', ready:bool }` → host updates roster → re-broadcasts.
- Client receives `'lobby'` → renders the lobby screen (room code, player list with ready ticks, chosen level — read-only for clients).

### Start
- Host's **START** button (enabled always; optionally show "all ready" hint): host broadcasts the existing `{ t:'start', levelId, ... }` to all, then runs `_startMatch` as host. Clients on `'start'` call `startAsClient`. This reuses the existing match-start + snapshot path verbatim. `lobbyActive=false`.
- After start, drop-in still works (a late hello during `running` spawns live — unchanged).

### Menu lobby screen (`Menu._lobby(...)`)
- Big room code (copyable), subtitle "Share this code".
- Player list: each row = colour swatch + name + READY/■ status (host row marked HOST).
- Client: a **READY / UNREADY** toggle button (sends `'ready'`).
- Host: **level dropdown + bots** (re-broadcasts on change) + **START MATCH** button.
- **BACK** → `net.disconnect()` → main menu.
- `Menu.refreshLobby(roster, isHost, code, levelId)` updates the list in place (called from Net on roster change).

## Files

| File | Change |
| --- | --- |
| `src/network/Net.js` | `connect` lobby option; host generates/holds code; `'lobby'`/`'ready'` message types; ready tracking on connections; roster build + broadcast; call `game.enterLobby()` instead of immediate `startHosted` when `lobby`; client `'lobby'`→`game.enterLobby`, `'start'` unchanged. Keep PUBLIC_ROOM/quick-play path intact. |
| `src/Game.js` | `enterLobby({isHost, code, roster})` sets `lobbyActive`, shows `menu._lobby`; `startHostedMatch()` (host START) broadcasts start + `_startMatch`; expose roster/level setters; `lobbyActive` guards so the game loop doesn't run a match during lobby. |
| `src/ui/Menu.js` | online chooser (Quick Play / Create / Join), code input, `_lobby()` screen, `refreshLobby()` real impl, room-code generator helper. |

## Verification (what's testable here)

Multiplayer needs two peers — full 2-browser play can't run in this env. Verify what's deterministic:
- Room-code generator: format (4 chars, no ambiguous), uniqueness-ish.
- Lobby state machine: `enterLobby` sets `lobbyActive`, roster builds, `'ready'` toggles a roster entry, `'lobby'` message shape correct, host START transitions `lobbyActive→running` and broadcasts `'start'`.
- Menu `_lobby` renders (DOM nodes present: code, player rows, ready/start buttons) without errors.
- **Drop-in unbroken:** Quick Play path still calls the old immediate-host flow; a single-player `startLocal` and the public-room connect still work; no console errors.
- `node --check` all edited files.
- Simulate the message handlers directly (call `net._handleHostMessage({t:'ready',...})` / client `_handleClientMessage({t:'lobby',...})` with stubs) to assert roster + UI update.
- Flag clearly that live 2-player join/ready/start needs a real second client (user test).

## Out of scope
- Public lobby browser/list (needs a backend; user is pure-browser).
- Spectators, mid-lobby kick, chat.
- Reconnect-into-lobby (host migration during lobby) — lobby is short-lived; if host drops, clients return to menu.
