# Contributing to Stick Smash

Small two-person project, no ceremony. This doc just keeps our work from clashing.

## No build step

Pure ES modules + import maps. There is **nothing to compile** — you edit a file, refresh the browser. Dependencies (three, cannon-es, peerjs) load from a CDN via the import map in `index.html`.

## Run it

```bash
npm start            # npx serve -l 5173 .
# or
npm run dev          # npx serve -p 5173 .
# or
python -m http.server 5173
```

Open http://localhost:5173. For testing online play with a friend, expose your local server with `npm run share` (localtunnel) or `npm run tunnel` (Cloudflare).

## Workflow (so we don't step on each other)

1. **Always start from the latest master.** Someone else may have pushed:
   ```bash
   git fetch origin master
   git switch -c my-feature origin/master
   ```
2. Work on a branch — **never commit straight to `master`**.
3. Open a PR and **squash-merge** it. Keep PRs focused on one thing.
4. If `master` moved while you were working, **rebase onto it** and resolve conflicts before merging — don't merge stale.
5. **Never force-push a shared branch** or rewrite shared history.
6. The repo is **public** — don't commit secrets, keys, or tokens.

## Verifying changes

There's no test framework. Before opening a PR:

- `node --check path/to/file.js` on every file you touched (catches syntax errors fast).
- Run the game and exercise the change in the browser. The live game is on `window.game` in the console — handy for poking state (e.g. `window.game.startLocal({ character: 0, bots: 3, levelId: 'arena' })`).
- Check the browser console is clean (ignore the harmless PeerJS "public broker" noise).
- Match the surrounding code style. No new dependencies without discussion (it would mean touching the import map).

## Where things live

| Area | File |
| --- | --- |
| Weapons (+ `SPAWN_TABLE`) | `src/weapons/weapons.js` |
| Projectiles / shared weapon base | `src/weapons/Projectile.js`, `src/weapons/Weapon.js` |
| Levels (tile grid + hazards) | `src/levels/definitions.js`, `src/levels/Level.js` |
| Characters | `src/characters/roster.js` |
| Player entity / combat | `src/entities/Stickman.js` |
| Visual rig | `src/entities/StickmanRig.js` |
| Netcode (PeerJS) | `src/network/Net.js` |
| Game loop / match flow / embedding hooks | `src/Game.js` |
| UI (menu, HUD, lobby) | `src/ui/` |

Adding content is usually a one-file change: a new weapon class + a `SPAWN_TABLE` entry, a new level object in `definitions.js`, or a new character in `roster.js`.
