# Weapons Overhaul — Design Spec

**Date:** 2026-06-21
**Status:** Approved scope, pending spec review. Built in 5 dependency-ordered phases, each its own PR.

## Goal

Curate the bloated ~40-entry arsenal down to a tighter, higher-identity pool; repurpose the freed Special button into a Stick-Fight-style block; redo the fire system (and fix its stuck/lift bug); give the elemental swords real status effects; add an escalating dismemberment system; and add five new gap-filling weapons.

Constraints carried from the project: pure-browser, no build step, Three.js + Cannon-over-Rapier shim, P2P netcode (host-authoritative snapshots), browser-only verification (`window.game` + `preview_eval`; no screenshots). Every phase must stay finite/no-NaN and hold the perf budget (~<1.2 ms anim, full `_update` well under frame).

---

## Phase 1 — Cull & rebalance

Low-risk deck-clearing. No new mechanics.

**Remove from `SPAWN_TABLE` (weapons.js):**
- Powers: `ForcePushPower`, `ForcePullPower`, `ForceLightningPower`, `ForceChokePower`, `GumGumFruit` (5).
- Melee: `Longsword`.
- Ranged: `Pistol`, `DualPistols`.

**Keep & promote:** `Revolver` becomes the common sidearm (bump its weight to ~14, taking Pistol's slot). Remaining guns keep distinct identity: Revolver, SMG, Assault Rifle, Shotgun, Minigun, Sniper, Crossbow, Flamethrower, Grenade, RPG, Sticky, Shurikens. Powers remaining: Flight, Invisibility, Time Slow.

**Code changes:**
- Strip the Force branches from `Stickman._update` `specialPressed` handler (Stickman.js ~2053–2068) and the `_forcePush/_forcePull/_forceLightning/_forceChoke` plumbing + `force*Until` timers. (Leave `superPunchUntil` etc. untouched.)
- `pickRandomSpawn` fallback: return `Revolver` instead of `Pistol` when the pool is empty.
- Classes for cut weapons may stay exported (harmless) but are removed from the spawn table and any menu/toggle lists. Remove now-dead Force code paths.
- Retune spawn weights so the surviving pool feels balanced (no dead weight, no single dominant pick).

**Verification:** every level still spawns weapons; no console errors; `pickRandomSpawn` never returns a culled class; disabled-weapons toggle list matches the new table.

---

## Phase 2 — Block / Parry (Special button → directional shield)

Stick-Fight-style **directional deflector shield** on the freed Special button (`now.special` / `specialPressed`; keys L/E, gamepad Y, touch ★).

**Behaviour:**
- **Hold Special** = raise a shield in the aim/facing direction (a flat panel in front of the stickman, oriented to `aimX/aimY` or facing).
- **Deflects projectiles:** an incoming projectile that hits the shield arc is reflected away (bounced back along its reflection, biased back toward the shooter) instead of damaging — the signature Stick Fight moment. Melee hits against the shield are negated/greatly reduced (no knockback, no/scratch damage).
- **Can't hold long:** a shield meter drains while raised (~1.0–1.5 s of uptime) and recharges when lowered, with a short cooldown if fully drained (a brief "broken guard" window). No turtling.
- **Movement:** slowed while the shield is up; can't attack while blocking.
- Weapon **alt-fires retire** — the few weapons with `altFire` fold it into primary fire or drop it, so Special is purely the shield.

**Components:**
- `Stickman`: block state machine (`_blockUntil`/`_shieldMeter`/`_shieldBroken`), facing-based shield AABB/arc for deflection tests, knockback/damage interception in `applyKnockback`/`takeDamage`.
- `Projectile`: on contact with a blocking target's shield arc → reflect velocity + flip ownership-for-friendly-fire as appropriate, instead of applying damage.
- `StickmanRig`: shield mesh + guard pose (arm raised holding panel), driven by a `blocking`/`shieldDir` sync param.
- HUD: small shield-meter pip near the player (optional).
- Netcode: block state in the snapshot so remote players show guard + deflections resolve host-side.

**Verification:** projectile fired at a blocking player reflects (doesn't damage); melee into a block = no knockback; meter drains/recharges/breaks; can't block while attacking; remote player shows guard pose.

---

## Phase 3 — Fire redo + elemental swords (status framework)

Establishes the **status vocabulary** (burn, freeze) used by later phases.

**Fire redo (fixes the current bug):** today, players hit by fire get *stuck in place and slowly lifted up* — a stray continuous upward force / pinning in the burn path. Replace with a clean model:
- `applyBurn(dur, dps, attacker)` stays a pure DoT (no positional force, no lift, no pin). Burning never immobilizes — you keep full control, just take ticks.
- Flame **visual**: emissive flame particles on the burning body + at the fire source; ground fire patches where flames land.
- Fire **spreads**: a burning body brushing another applies a (weaker) burn; ground fire patches ignite anyone standing in them for their lifetime.

**Fire Sword:** a swing throws an **arc/fan of fire** in front (a short-range spread of flame projectiles or a cone) that ignites targets and drops ground-fire patches. Uses the redone burn.

**Flamethrower:** retuned onto the same burn + flame visuals; **the stuck/lift bug is fixed here too** (continuous stream applies burn + light steady knockback, never lifts/pins).

**Ice Sword:** hits **freeze** the target — apply `_frozenUntil` for a short window (can't act/move), frosted-blue tint + ice shards on the body, and frozen targets take **bonus damage**. Tuned so freeze is a setup, not a stunlock (short duration + per-target cooldown so you can't permafreeze).

**Verification:** burn ticks damage but the target moves freely (no lift/pin); ground patches ignite; Fire Sword arc ignites in a fan; Flamethrower no longer pins/lifts; Ice Sword freeze locks then releases, bonus damage applies, can't permafreeze.

---

## Phase 4 — Dismemberment (escalating, NO bleed)

Gated to **headshots, bladed weapons, the lightsaber, and explosions**. No bleed DoT (explicitly out — kept fun, not grindy).

**Weapon tags:** add a `bladed: true` (and reuse explosion flags) on qualifying weapons — Katana, Halberd, Lightsaber, Flame/Ice Sword, and explosion sources (Grenade, RPG, Sticky, Nuke). Hit-location: detect **headshots** by hit Y near the head region for projectiles/blade reach.

**Escalating rules:**
- **Non-fatal** blade/lightsaber hit → chance (e.g. heavy/charged or a roll) to **sever a limb**:
  - Arm → that arm's attacks disabled (drop weapon if held in it; reduced melee).
  - Leg → **hobble** (move speed cut, no run).
  - The limb mesh detaches (rig hides it + spawns a dynamic gib bit). **No bleed** — it's a capability debuff + gore, nothing ticking.
- **Fatal** qualifying hit, or **any headshot** → **full gib**: instant death with head + limbs flung as ragdoll bits + blood-particle burst.

**Components:**
- `Stickman`: `_severed` set (which limbs gone) → gate attacks/movement; head-region hit test; death path branches to gib vs normal ragdoll.
- `StickmanRig`: hide severed limb, spawn detached gib mesh (dynamic body), blood particles; full-gib explosion of all parts.
- Netcode: severed-limb state + gib events in snapshot so remote bodies match.
- A global **gore toggle** (settings) defaulting on, so it can be turned off.

**Verification:** blade hit can sever an arm (that attack disabled) / leg (hobbled), limb visibly gone, no DoT; headshot or fatal blade/explosion fully gibs + ragdoll bits finite; remote player mirrors; gore toggle disables it.

---

## Phase 5 — New weapons

Each leans on earlier phases.

- **Vacuum Gun** (ranged/trick): hold to **suck** — a cone in front pulls players, items, and live projectiles toward the muzzle (capturing them); release to **blast** captured stuff back out as damaging projectiles. Empty blast = short shove.
- **Shrink Ray** (ranged/chaos): a beam that **shrinks** the target for a few seconds — smaller hitbox/reach, weaker hits, takes more knockback (easy to launch). Wears off.
- **Snail** (deployable/chaos): deploy a snail that **crawls slowly**, is **invulnerable**, and **instakills on contact**. Slow-moving area terror that everyone must avoid; despawns after a while.
- **Spike Thrower** (ranged/skill): fires spikes that **impale and pin** — a spike that connects roots the target in place (pinned to wall/ground) for a short window. **No bleed.** Pairs with dismemberment (impale can sever on a charged hit).
- **Meteor Storm** (super): summons a **meteor shower** over the arena — reuses the existing `MeteorShower` system (used on space levels), scoped to a timed barrage the summoner triggers.

**Verification (per weapon):** vacuum pulls + captures + blasts (finite forces, no NaN); shrink applies/reverts; snail is unkillable, kills on touch, despawns; spike pins then releases; meteor storm spawns a bounded barrage and cleans up. All net-synced; perf holds with 4 players.

---

## Cross-cutting

- **Netcode:** every new status (block, freeze, severed, shrunk, pinned) rides the host-authoritative snapshot; clients render, host resolves. 2-peer live play can't be tested headless — flag for user test each phase.
- **Perf:** particle-heavy bits (fire, gibs, meteor) reuse pooled particles; watch draw calls. Re-measure `_update` per phase.
- **Settings:** weapon-toggle list updated for the new table; add a gore toggle.
- **Out of scope:** functional limb-regrowth, per-character unique specials, weapon inventory/loadouts, ammo economy rework.
