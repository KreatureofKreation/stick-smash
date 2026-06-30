// Kill-feed verbs, keyed by the `weapon` tag passed to takeDamage(). Pure data
// + lookup so it can be unit-tested and lives next to the weapons it describes,
// instead of inline in Game's game-over logic.
export const KILL_VERBS = {
  sword: 'sliced', bat: 'launched', pistol: 'shot', shotgun: 'blasted', minigun: 'shredded', bow: 'pierced',
  grenade: 'exploded', rpg: 'rocketed', chicken: 'chickened', boomerang: 'flung', fish: 'slapped',
  fist: "KO'd", super: 'obliterated', gumgum: 'stretched', flame: 'burned', ice: 'froze',
  lightning: 'shocked', nuke: 'NUKED', corpse: 'corpse-bashed', thrown: 'pelted',
  saber: 'lightsabered', forcePush: 'force-pushed', forcePull: 'pulled', choke: 'choked',
  longsword: 'cleaved', mace: 'maced', hammer: 'crushed', halberd: 'halberded',
  explosion: 'blasted', lava: 'cooked', spike: 'spiked', saw: 'sawed', blade: 'guillotined', projectile: 'shot',
};

// Returns the kill-feed verb for a weapon tag, defaulting to "KO'd".
export function killVerb(weapon) {
  return KILL_VERBS[weapon] || "KO'd";
}
