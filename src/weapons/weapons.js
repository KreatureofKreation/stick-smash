// Weapon barrel. Individual weapon classes live in category modules
// (melee/ranged/fun/supers/pickups); this file re-exports them all and owns
// the spawn registries + selection logic. External code imports the
// registries from here exactly as before the split.
import { pickWeighted } from './spawnPick.js';
import { Sword, Bat, Longsword, Mace, WarHammer, Halberd, HulkHands } from './melee.js';
import { Pistol, Shotgun, Minigun, SMG, AssaultRifle, Revolver, Crossbow, Flamethrower, DualPistols, SniperRifle, Shurikens, SpikeThrower, ShrinkRay, VacuumGun } from './ranged.js';
import { Grenade, RPG, StickyBomb, MeteorStorm } from './throwables.js';
import { RubberChicken, Boomerang, FishSlap, Snail, SnailDeployer } from './fun.js';
import { Lightsaber, FlameSword, IceSword, Kamehameha, Nuke, LightningStaff, FlightPower, InvisibilityPower, TimeSlowPower, SuperPunchPower, GumGumFruit, ForcePushPower, ForcePullPower, ForceLightningPower, ForceChokePower } from './supers.js';
import { HealthPack, SpeedBoost, ArmorPlate, Shield } from './pickups.js';

export * from './melee.js';
export * from './ranged.js';
export * from './throwables.js';
export * from './fun.js';
export * from './supers.js';
export * from './pickups.js';


// Catalog of all weapons and weighted pool for spawns.
export const WEAPON_CLASSES = [
  Sword, Bat, Pistol, Shotgun, Minigun, SMG, AssaultRifle, Revolver, Crossbow, Flamethrower, DualPistols, Grenade, RPG, RubberChicken, Boomerang, FishSlap,
  FlameSword, IceSword, Kamehameha, Nuke, LightningStaff, Lightsaber,
  Longsword, Mace, WarHammer, Halberd,
  SniperRifle, Shurikens, StickyBomb,
  HulkHands,
];

export const PICKUP_CLASSES = [
  HealthPack, ArmorPlate, SpeedBoost, Shield,
  FlightPower, InvisibilityPower, TimeSlowPower, SuperPunchPower, GumGumFruit,
  ForcePushPower, ForcePullPower, ForceLightningPower, ForceChokePower,
];


export const SPAWN_TABLE = [
  // melee
  { cls: Sword,         w: 12,  id: 'sword',        label: 'Katana',        cat: 'melee' },
  { cls: Bat,           w: 10,  id: 'bat',          label: 'Bat',           cat: 'melee' },
  { cls: Mace,          w: 9,   id: 'mace',         label: 'Mace',          cat: 'melee' },
  { cls: WarHammer,     w: 6,   id: 'warhammer',    label: 'War Hammer',    cat: 'melee' },
  { cls: Halberd,       w: 8,   id: 'halberd',      label: 'Halberd',       cat: 'melee' },
  { cls: HulkHands,     w: 4,   id: 'hulkhands',    label: 'Hulk Hands',    cat: 'melee' },
  // ranged
  { cls: Shotgun,       w: 9,   id: 'shotgun',      label: 'Shotgun',       cat: 'ranged' },
  { cls: Minigun,       w: 5,   id: 'minigun',      label: 'Minigun',       cat: 'ranged' },
  { cls: Grenade,       w: 8,   id: 'grenade',      label: 'Grenade',       cat: 'ranged' },
  { cls: RPG,           w: 4,   id: 'rpg',          label: 'RPG',           cat: 'ranged' },
  { cls: SniperRifle,   w: 4,   id: 'sniper',       label: 'Sniper Rifle',  cat: 'ranged' },
  { cls: Shurikens,     w: 6,   id: 'shurikens',    label: 'Shurikens',     cat: 'ranged' },
  { cls: StickyBomb,    w: 4,   id: 'sticky',       label: 'Sticky Bomb',   cat: 'ranged' },
  { cls: SMG,           w: 10,  id: 'smg',          label: 'SMG',           cat: 'ranged' },
  { cls: AssaultRifle,  w: 9,   id: 'assaultrifle', label: 'Assault Rifle', cat: 'ranged' },
  { cls: Revolver,      w: 14,  id: 'revolver',     label: 'Revolver',      cat: 'ranged' },
  { cls: Crossbow,      w: 6,   id: 'crossbow',     label: 'Crossbow',      cat: 'ranged' },
  { cls: Flamethrower,  w: 5,   id: 'flamethrower', label: 'Flamethrower',  cat: 'ranged' },
  { cls: SpikeThrower,  w: 7,   id: 'spikethrower', label: 'Spike Thrower', cat: 'ranged' },
  { cls: ShrinkRay,     w: 5,   id: 'shrinkray',    label: 'Shrink Ray',    cat: 'ranged' },
  { cls: VacuumGun,     w: 5,   id: 'vacuum',       label: 'Vacuum Gun',    cat: 'ranged' },
  // joke
  { cls: RubberChicken, w: 2,   id: 'chicken',      label: 'Rubber Chicken',cat: 'joke' },
  { cls: SnailDeployer, w: 2,   id: 'snail',        label: 'Snail',         cat: 'joke' },
  { cls: Boomerang,     w: 5,   id: 'boomerang',    label: 'Boomerang',     cat: 'joke' },
  { cls: FishSlap,      w: 2,   id: 'trout',        label: 'Trout',         cat: 'joke' },
  // super
  { cls: FlameSword,    w: 4,   id: 'flamesword',   label: 'Flame Sword',   cat: 'super' },
  { cls: IceSword,      w: 4,   id: 'icesword',     label: 'Ice Sword',     cat: 'super' },
  { cls: LightningStaff,w: 3,   id: 'lightning',    label: 'Lightning',     cat: 'super' },
  { cls: Kamehameha,    w: 2,   id: 'kamehameha',   label: 'Kamehameha',    cat: 'super' },
  { cls: Nuke,          w: 1.5, id: 'nuke',         label: 'Nuke',          cat: 'super' },
  { cls: Lightsaber,    w: 5,   id: 'lightsaber',   label: 'Lightsaber',    cat: 'super' },
  { cls: MeteorStorm,   w: 3,   id: 'meteorstorm',  label: 'Meteor Storm',  cat: 'super' },
  // pickups
  { cls: HealthPack,    w: 8,   id: 'healthpack',   label: 'Health Pack',   cat: 'pickup' },
  { cls: ArmorPlate,    w: 6,   id: 'armor',        label: 'Armor',         cat: 'pickup' },
  { cls: SpeedBoost,    w: 6,   id: 'speed',        label: 'Speed Boost',   cat: 'pickup' },
  { cls: Shield,        w: 5,   id: 'shield',       label: 'Shield',        cat: 'pickup' },
  // powers — Force powers + Gum-Gum culled (freed the Special button for the
  // block/parry shield). Super Punch already off-spawn (Hulk Hands fills that
  // role). Cut classes stay exported (harmless) but no longer spawn.
  { cls: FlightPower,       w: 5, id: 'flight',     label: 'Flight',        cat: 'power' },
  { cls: InvisibilityPower, w: 5, id: 'invis',      label: 'Invisibility',  cat: 'power' },
  { cls: TimeSlowPower,     w: 4, id: 'timeslow',   label: 'Time Slow',     cat: 'power' },
];


// Module-level enabled set. `null` means "all enabled" — the default. The
// weapon-toggle settings panel writes the disabled-set to localStorage and
// calls setEnabledWeapons() on boot. pickRandomSpawn filters by this set
// before doing the weighted draw.
let _disabledIds = new Set();

export function setDisabledWeapons(ids) { _disabledIds = new Set(ids || []); }

export function getDisabledWeapons() { return new Set(_disabledIds); }


export function pickRandomSpawn() {
  // Fallback (Revolver): if the user disabled literally every spawn, still
  // hand out a weapon so the match isn't permanently empty-handed.
  return pickWeighted(SPAWN_TABLE, _disabledIds, Math.random, Revolver);
}
