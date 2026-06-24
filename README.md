# Stick Smash Party

A browser-based 2.5D party brawler. Stickman physics, ~35 melee / ranged / super / joke weapons, a directional block-and-parry shield, grab & throw, escalating dismemberment, fire & freeze status, climbable / destructible terrain, hazards, bots, and online multiplayer (via PeerJS — no server needed).

Plays on PC (keyboard + mouse, or gamepad) and mobile (landscape, touch joystick + buttons).

## Run locally

Any static file server works. The simplest:

```
# Node available?
npm start
# That's just: npx serve -l 5173 .
```

Or:

```
python -m http.server 5173
```

Open http://localhost:5173

## Share with friends (no deploy)

Three options that expose your local server to the internet via a free tunnel — anyone you send the link to can play with you over the public PeerJS broker:

```
# Option 1 — localtunnel (assigns a random *.loca.lt URL)
npm run share

# Option 2 — Cloudflare quick tunnel (random *.trycloudflare.com URL)
npm run tunnel

# Option 3 — ngrok (if you already have an account)
ngrok http 5173
```

You'll get a public HTTPS URL. Send that to friends. **PLAY ONLINE** then pick:

- **QUICK PLAY** — drop straight into the live public match. First arrival hosts; everyone else joins mid-game. No codes.
- **CREATE ROOM** — get a 4-char room code + a lobby; friends **JOIN ROOM** with the code, everyone **readies up**, and the host picks level/bots and starts. (A `?room=name` URL also drops friends straight into a private room.)

## Deploy permanently

Pure static — drop the folder on any static host:

- **GitHub Pages**: push, enable Pages on `main` / `/` (root).
- **Netlify**: drag-drop the folder.
- **Cloudflare Pages / Vercel**: connect repo, no build step needed.

No backend required. PeerJS uses its public broker for matchmaking; once peers are connected they communicate over WebRTC P2P.

## Controls

### PC
| | |
|---|---|
| Move | **A / D** or **← / →** |
| Jump | **W**, **↑**, **Space** (double-jump available) |
| Aim  | **Mouse** |
| Attack / shoot | **Left mouse**, **J**, **F** |
| Grab / climb / throw | **Right mouse**, **K**, **Shift** |
| Block / parry (hold) | **L**, **E** |
| Pause | **Esc**, **P** |

### Gamepad
Movement = left stick. Aim = right stick. A=Jump, X / RT = Attack, B / RB = Grab, **Y / LB = Block**.

### Mobile (landscape)
Left side = analog joystick. Right cluster: **✊** Attack, **⤴** Jump, **✋** Grab, **★** Block, **AIM** (hold + tilt joystick to aim).

## Mechanics

- **Grab anything**: hold the grab button next to a player, weapon, or wall. Players go limp; release without input to drop, push direction + release to throw. Grab into walls = climb up.
- **Throw players**: throwing into hazards or off the map = kill credit.
- **Block / parry**: hold Special to raise a directional energy shield. It **deflects projectiles back at the shooter** and stops frontal melee; a well-timed raise **parries** (stuns the attacker). A meter drains while it's up — you can't turtle, and it shatters if fully drained.
- **Dismemberment** (toggle in Settings, on by default): bladed weapons, the lightsaber, explosions, and headshots can **gib** on a kill — the body bursts into flying limbs + blood. A non-fatal blade hit can also **lop off a limb** (lose an arm = drop your weapon, lose a leg = hobble).
- **Status effects**: the **Fire Sword** throws an arc of flame that ignites + spreads (burn = damage over time, no more being stuck); the **Ice Sword freezes** targets solid, with bonus shatter damage on a frozen foe.
- **Destructible tiles**: every tile has HP. Bullets, swings, and explosions damage them. Wood < Stone < Metal. Bedrock is indestructible. Drop people into the void. Chain-suspended platforms hang on real chains — shoot a chain to drop the platform.
- **Hazards**: lava (DPS), spikes (instakill bounce), saws (high damage + knockback), swinging pendulums, rising lava, and more.
- **Weapons** (~35, weighted random spawns): melee (katana, bat, mace, war hammer, halberd, hulk hands), guns (revolver, SMG, assault rifle, shotgun, minigun, sniper, crossbow, flamethrower), explosives (grenade, RPG, sticky bomb), thrown (shurikens), supers (flame/ice sword, lightsaber, lightning, kamehameha, nuke, **meteor storm**), trick weapons (**spike thrower** that pins, **shrink ray**, **vacuum gun** that sucks players in and blasts them out), and joke picks (rubber chicken, boomerang, trout, and a slow invulnerable instakill **snail**).
- **Pickups & powers**: health pack, armor plate, speed boost, shield, flight, invisibility, time slow.
- **Lives**: 5 per player by default. Last one standing wins.

## Tech

- Three.js (rendering)
- Cannon-es (physics)
- PeerJS (WebRTC matchmaking via public broker)
- Pure ES modules + import maps — **no build step**

## Embedding / host hooks

Stick Smash can still run standalone through `src/main.js`. Host apps can also
import `Game` directly and use optional hooks:

```js
const game = new Game({
  onMatchOver(result) {
    // Return true to suppress the built-in game-over menu.
    host.reportResult(result);
    return true;
  },
});

game.input.registerInputProvider('host', {
  getSnapshotFor(source) {
    return host.getInputSnapshot(source.slot);
  },
});

game.startExternalMatch({
  context: { sessionId: 'abc' },
  players: [
    { name: 'P1', inputSource: { kind: 'host', slot: 0 } },
    { name: 'P2', inputSource: { kind: 'host', slot: 1 } },
  ],
  levelId: 'arena',
  minFighters: 2,
});
```

## Hacking

Drop a new weapon class in `src/weapons/weapons.js` and add it to `SPAWN_TABLE`. New levels go in `src/levels/definitions.js` (just a tile grid + hazards). New characters: append to `src/characters/roster.js`.
