// Level definitions. Each level is a tile grid (mostly destructible),
// hazards, spawns, weapon spawns, and a static background mural built from
// box / sphere / disc primitives at varied z-depths.
//
// Vertical-spacing rule (KEY for playability — tested against 1.5m capsule):
//   Floors stack from y=0. The first tier above a floor must be at y >= 3
//   so the capsule fits beneath. Subsequent tiers also step in 3s. Anything
//   tighter and players crawl through gaps that should be doorways.
//
// New in this pass:
//   - Pendulums use real physics (chain links + tip body via PointToPoint
//     constraints in Level.js). Definition is unchanged but the sim is now
//     dynamic — the chain hangs from the anchor and the saw blade swings
//     under gravity, kept alive by a sinusoidal driver force.
//   - Some platforms set `chainAnchor: { x, y, segs?, hp? }`. Tile starts
//     static; when ANY chain link in the suspension is destroyed the tile
//     converts to dynamic and falls.
//   - Spike hazard accepts `pointDown: true` for icicles hung under
//     platforms — they knock the player toward the floor when hit.

const TILE_BASE = 1;

const row = (y, x0, x1, opts = {}) => {
  const out = [];
  for (let x = x0; x <= x1; x++) out.push({ x, y, ...opts });
  return out;
};

const col = (x, y0, y1, opts = {}) => {
  const out = [];
  for (let y = y0; y <= y1; y++) out.push({ x, y, ...opts });
  return out;
};

// Tough subfloor — destructible but hp 200 so a focused barrage is required
// to punch through. The y=-5 lava plane is the safety net below.
const tough = (y, x0, x1, opts = {}) =>
  row(y, x0, x1, { hp: 200, color: 0x2a2c34, material: 'metal', ...opts });

// Wooden crate — dynamic physics tile.
const crate = (x, y, size = 1.0, opts = {}) => ({
  x, y: y + 0.4,
  shape: 'box',
  w: size, h: size, d: 0.9,
  material: 'wood',
  hp: opts.hp ?? 28,
  dynamic: true,
  // Heavier mass formula — old `size² * 7` made crates feel like
  // helium. `size² * 14` lets a stickman pick a 1×1 crate up but
  // visibly struggles to sprint with it. Big 1.2× crates now read as
  // proper anvils.
  tileMass: opts.tileMass ?? (size * size * 14),
  color: opts.color ?? 0xa8702a,
  ...opts,
});

const crateCol = (x, yStart, n, size = 1.0, opts = {}) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(crate(x, yStart + i * (size + 0.05), size, opts));
  return out;
};

// Background prim shorthands.
const bg  = (x, y, w, h, color, z = -8, extra = {}) => ({ x, y, z, w, h, color, ...extra });
const bgGlow = (x, y, w, h, color, z = -8) => ({ x, y, z, w, h, color, emissive: color, emissiveIntensity: 1.4 });
const bgSphere = (x, y, r, color, z = -10, extra = {}) => ({ shape: 'sphere', x, y, z, radius: r, color, ...extra });
const bgDisc   = (x, y, r, color, z = -11, extra = {}) => ({ shape: 'circle', x, y, z, radius: r, color, ...extra });

const bgRow = (y, x0, x1, w, h, color, z = -8, extra = {}) => {
  const out = [];
  for (let x = x0; x <= x1; x++) out.push({ x, y, z, w, h, color, ...extra });
  return out;
};

export const LEVELS = [
  // ---------------------------------------------------------------------
  // ARENA — Roman colosseum. Sand floor pit, tiered stands, banners, sun.
  // ---------------------------------------------------------------------
  {
    id: 'arena',
    name: 'Arena',
    bgColor: 0x2a1810,
    tiles: [
      // Sand floor.
      ...row(0, -15, 15, { material: 'stone', hp: 60, color: 0xc0966a }),
      ...row(-1, -14, 14, { material: 'stone', hp: 90, color: 0x8a6a44 }),
      ...tough(-2, -13, 13, { color: 0x4a3020 }),
      // Side ramps up to mid balconies (y=3 — proper headroom from floor).
      ...row(3, -14, -10, { material: 'wood', hp: 24, color: 0x9a6028 }),
      ...row(3, 10, 14, { material: 'wood', hp: 24, color: 0x9a6028 }),
      // Mid balconies (y=6).
      ...row(6, -12, -8, { material: 'stone', hp: 60, color: 0xa07050 }),
      ...row(6, 8, 12, { material: 'stone', hp: 60, color: 0xa07050 }),
      // Pit cover pillars (short — projectile cover, walk-around obstacles).
      { x: -6, y: 1, shape: 'box', w: 0.8, h: 2.0, material: 'stone', hp: 80, color: 0xb89878 },
      { x:  6, y: 1, shape: 'box', w: 0.8, h: 2.0, material: 'stone', hp: 80, color: 0xb89878 },
      // Center sphere prop (mid-altitude cover, also a stepping stone).
      { x: 0, y: 4, shape: 'sphere', radius: 0.9, material: 'stone', hp: 80, color: 0xa08868 },
      // Top platform (y=9, prize).
      ...row(9, -3, 3, { material: 'wood', hp: 18, color: 0x8a5028 }),
      // Wall pillars frame the arena.
      ...col(-15, 1, 5, { shape: 'box', w: 0.6, h: 1, material: 'stone', hp: 120, color: 0x9a7858 }),
      ...col(15,  1, 5, { shape: 'box', w: 0.6, h: 1, material: 'stone', hp: 120, color: 0x9a7858 }),
    ],
    hazards: [
      { kind: 'lava', x: 0, y: -5, w: 50, h: 1.4, dps: 50 },
      // Pendulums hung from outside the play box — tips swing across the balconies.
      { kind: 'pendulum', x: -10, y: 13, length: 5, amplitude: Math.PI / 2.5, speed: 1.1 },
      { kind: 'pendulum', x:  10, y: 13, length: 5, amplitude: Math.PI / 2.5, speed: 1.3, phase: Math.PI },
    ],
    spawns: [
      // Mid balconies (tiles span x:-12..-8 and 8..12 at y=6 — spawn ON the
      // tile, not over thin air at x=-13/13 which used to drop players
      // onto the ramp during countdown freeze).
      { x: -10, y: 7 }, { x: 10, y: 7 },
      // Ramps (tiles span x:-14..-10 and 10..14 at y=3).
      { x: -12, y: 4 }, { x: 12, y: 4 },
      // Pit floor edges.
      { x: -8, y: 1 }, { x: 8, y: 1 },
      // Top platform.
      { x: 0, y: 10 },
    ],
    weaponSpawns: [
      { x: 0, y: 10 },
      { x: -11, y: 7 }, { x: 11, y: 7 },
      { x: 0, y: 5 },                         // mid sphere top
      { x: 0, y: 1 },
    ],
    background: [
      bg(0, 24, 60, 6, 0x4a2818, -14),
      bg(0, 18, 60, 6, 0x80422a, -14),
      bg(0, 13, 60, 4, 0xc06840, -14),
      bgDisc(-12, 17, 2.4, 0xffd070, -13, { emissive: 0xffd070, emissiveIntensity: 1.6 }),
      ...(() => {
        const arches = [];
        for (let i = -7; i <= 7; i++) {
          arches.push(bg(i * 2.2, 9, 1.4, 4.5, 0x1a1006, -10));
          arches.push(bg(i * 2.2, 12, 1.4, 1.2, 0x100804, -10));
        }
        return arches;
      })(),
      bg(0, 7, 22, 0.6, 0x2a1810, -9),
      bg(0, 6, 24, 0.6, 0x1a0e08, -9),
      bg(0, 5, 26, 0.6, 0x100604, -9),
      bg(-9, 10, 0.9, 3.5, 0xa01818, -9.5),
      bg(-3, 10, 0.9, 3.5, 0xc09028, -9.5),
      bg(3,  10, 0.9, 3.5, 0xa01818, -9.5),
      bg(9,  10, 0.9, 3.5, 0xc09028, -9.5),
      bg(-22, 5, 12, 8, 0x1a0e08, -13),
      bg(22,  6, 14, 9, 0x1a0e08, -13),
    ],
  },

  // ---------------------------------------------------------------------
  // SPIKE PIT — torchlit dungeon with floor + ceiling spike rows.
  // ---------------------------------------------------------------------
  {
    id: 'spikes',
    name: 'Spike Pit',
    bgColor: 0x180810,
    tiles: [
      // Two floor sections separated by a spike gap.
      ...row(0, -12, -4, { material: 'stone', hp: 50, color: 0x4a3a3a }),
      ...row(0,  4, 12, { material: 'stone', hp: 50, color: 0x4a3a3a }),
      // Center stone ledge — can be jumped on, divides the pit.
      ...row(1, -1, 1,  { material: 'stone', hp: 80, color: 0x6a4a4a }),
      // Mid platforms (wood — break easily into hazards below).
      ...row(4, -8, -5, { material: 'wood', hp: 18, color: 0x6a3818 }),
      ...row(4,  5,  8, { material: 'wood', hp: 18, color: 0x6a3818 }),
      // Top center sanctum.
      ...row(7, -2, 2, { material: 'stone', hp: 60, color: 0x8a6a6a }),
      // Side wall pillars.
      ...col(-12, 1, 5, { shape: 'box', w: 0.6, h: 1, material: 'stone', hp: 120, color: 0x6a4a4a }),
      ...col(12,  1, 5, { shape: 'box', w: 0.6, h: 1, material: 'stone', hp: 120, color: 0x6a4a4a }),
      ...tough(-2, -12, -4, { color: 0x2a1818 }),
      ...tough(-2,  4, 12, { color: 0x2a1818 }),
    ],
    hazards: [
      // Floor spikes (point-up) in the central gap.
      { kind: 'spike', x: -2.5, y: 1, w: 2.4 },
      { kind: 'spike', x:  2.5, y: 1, w: 2.4 },
      // Ceiling icicles hanging beneath the wood platforms — punish lazy
      // mid-air dashes from below.
      { kind: 'spike', x: -6.5, y: 3.5, w: 2.6, pointDown: true, color: 0xeebbaa },
      { kind: 'spike', x:  6.5, y: 3.5, w: 2.6, pointDown: true, color: 0xeebbaa },
      // Lava plane below.
      { kind: 'lava', x: 0, y: -5, w: 36, h: 1.4, dps: 50 },
      // Slow pendulum sweeping the top sanctum.
      { kind: 'pendulum', x: 0, y: 12, length: 4, amplitude: Math.PI / 3, speed: 1.0 },
    ],
    spawns: [
      { x: -10, y: 2 }, { x: 10, y: 2 },
      { x: -7, y: 5 }, { x: 7, y: 5 },
      { x: 0, y: 9 },
    ],
    weaponSpawns: [
      { x: 0, y: 9 },
      { x: -7, y: 5 }, { x: 7, y: 5 },
      { x: 0, y: 2 },
      { x: -10, y: 1 }, { x: 10, y: 1 },
    ],
    background: [
      bg(0, 2,  32, 1.2, 0x2a1818, -7),
      bg(0, 4,  32, 1.2, 0x1a1010, -7),
      bg(0, 6,  32, 1.2, 0x2a1818, -7),
      bg(0, 8,  32, 1.2, 0x1a1010, -7),
      bg(0, 10, 32, 1.2, 0x2a1818, -7),
      bg(-9, 6, 0.15, 9.5, 0x080404, -6.95),
      bg(-3, 6, 0.15, 9.5, 0x080404, -6.95),
      bg(3,  6, 0.15, 9.5, 0x080404, -6.95),
      bg(9,  6, 0.15, 9.5, 0x080404, -6.95),
      bg(0, -2, 30, 1.5, 0x080404, -6.5),
      bgGlow(-9, 5, 0.3, 0.6, 0xff8a30, -6.8),
      bgGlow(-3, 5, 0.3, 0.6, 0xff8a30, -6.8),
      bgGlow(3,  5, 0.3, 0.6, 0xff8a30, -6.8),
      bgGlow(9,  5, 0.3, 0.6, 0xff8a30, -6.8),
      bgDisc(-9, 5, 1.4, 0xff7020, -6.7, { emissiveIntensity: 0.8 }),
      bgDisc(-3, 5, 1.4, 0xff7020, -6.7, { emissiveIntensity: 0.8 }),
      bgDisc(3,  5, 1.4, 0xff7020, -6.7, { emissiveIntensity: 0.8 }),
      bgDisc(9,  5, 1.4, 0xff7020, -6.7, { emissiveIntensity: 0.8 }),
      { type: 'chain', x: -6, y: 13, length: 5, z: -6 },
      { type: 'chain', x: 6,  y: 13, length: 5, z: -6 },
      bg(-13, 3, 2.5, 8, 0x080404, -8),
      bg(13,  3, 2.5, 8, 0x080404, -8),
    ],
  },

  // ---------------------------------------------------------------------
  // SAW MILL — lumber yard exterior. Conveyor-style steel platforms,
  // log-stack cover, water wheel + mill in BG.
  // ---------------------------------------------------------------------
  {
    id: 'sawmill',
    name: 'Saw Mill',
    bgColor: 0x0c1a18,
    tiles: [
      ...row(0, -14, 14, { material: 'wood', hp: 35, color: 0x8a5a30 }),
      ...row(-1, -12, 12, { material: 'stone', hp: 60, color: 0x4a4a52 }),
      ...tough(-2, -10, 10),
      // Conveyor belts (y=3).
      ...row(3, -13, -7, { material: 'metal', hp: 50, color: 0x6a7080 }),
      ...row(3,  7, 13, { material: 'metal', hp: 50, color: 0x6a7080 }),
      // Conveyor support pillars.
      { x: -13, y: 1.5, shape: 'box', w: 0.5, h: 2.5, material: 'metal', hp: 100, color: 0x4a505c },
      { x: -7,  y: 1.5, shape: 'box', w: 0.5, h: 2.5, material: 'metal', hp: 100, color: 0x4a505c },
      { x:  7,  y: 1.5, shape: 'box', w: 0.5, h: 2.5, material: 'metal', hp: 100, color: 0x4a505c },
      { x:  13, y: 1.5, shape: 'box', w: 0.5, h: 2.5, material: 'metal', hp: 100, color: 0x4a505c },
      // Log stacks (cover).
      { x: -4, y: 0.6, shape: 'cylinder', w: 1, h: 1, radius: 0.5, material: 'wood', hp: 25, color: 0x8a5828 },
      { x: -4, y: 1.6, shape: 'cylinder', w: 1, h: 1, radius: 0.5, material: 'wood', hp: 25, color: 0xa86838 },
      { x: -3, y: 1.1, shape: 'cylinder', w: 1, h: 1, radius: 0.5, material: 'wood', hp: 25, color: 0x9a6030 },
      { x: 4, y: 0.6, shape: 'cylinder', w: 1, h: 1, radius: 0.5, material: 'wood', hp: 25, color: 0x8a5828 },
      { x: 4, y: 1.6, shape: 'cylinder', w: 1, h: 1, radius: 0.5, material: 'wood', hp: 25, color: 0xa86838 },
      { x: 3, y: 1.1, shape: 'cylinder', w: 1, h: 1, radius: 0.5, material: 'wood', hp: 25, color: 0x9a6030 },
      // Catwalk overlooking the saws.
      ...row(7, -2, 2, { material: 'metal', hp: 60, color: 0x808890 }),
      // Crane support pillars.
      { x: -10, y: 6, shape: 'box', w: 0.6, h: 4, material: 'metal', hp: 120, color: 0x505860 },
      { x:  10, y: 6, shape: 'box', w: 0.6, h: 4, material: 'metal', hp: 120, color: 0x505860 },
      // Top crossbeam — used as pendulum anchor.
      { x: 0, y: 10, shape: 'box', w: 22, h: 0.5, material: 'metal', hp: 200, color: 0x404850 },
    ],
    hazards: [
      // Patrolling saws on the conveyors.
      { kind: 'saw', x: -10, y: 3.8, w: 5 },
      { kind: 'saw', x:  10, y: 3.8, w: 5 },
      // Two crane-blade pendulums hung from the crossbeam.
      { kind: 'pendulum', x: -3, y: 9.7, length: 3.5, amplitude: Math.PI / 3.5, speed: 1.6, phase: 0.3 },
      { kind: 'pendulum', x:  3, y: 9.7, length: 3.5, amplitude: Math.PI / 3.5, speed: 1.6, phase: 2.0 },
      { kind: 'lava', x: 0, y: -5, w: 40, h: 1.4, dps: 55 },
    ],
    spawns: [
      { x: -12, y: 1 }, { x: 12, y: 1 },
      { x: -10, y: 4 }, { x: 10, y: 4 },
      { x: 0, y: 8 },
    ],
    weaponSpawns: [
      { x: 0, y: 8 },
      { x: -12, y: 4 }, { x: 12, y: 4 },
      { x: -4, y: 2.5 }, { x: 4, y: 2.5 },
      { x: 0, y: 1 },
    ],
    background: [
      bg(0, 22, 60, 8, 0x18302e, -14),
      bg(0, 14, 60, 6, 0x2a4845, -14),
      bg(-16, 6, 5, 14, 0x3a2818, -10),
      bg(-16, 14, 4, 2, 0x4a3020, -9.8),
      bg(-16, 16, 3, 1.5, 0x1a1008, -9.8),
      bg(-15, 18.5, 2.2, 3, 0x2a1810, -9.5),
      bg(-14, 21, 3.5, 3, 0x1a0e08, -9.4),
      bg(13, 5, 8, 12, 0x4a3020, -10),
      bg(13, 11.5, 8.5, 1.0, 0x6a4a30, -9.9),
      bgGlow(11, 6, 0.5, 0.8, 0xffaa44, -9.5),
      bgGlow(11, 8, 0.5, 0.8, 0xffaa44, -9.5),
      bgGlow(15, 6, 0.5, 0.8, 0xffaa44, -9.5),
      bgGlow(15, 8, 0.5, 0.8, 0xffaa44, -9.5),
      bgSphere(-9, 4, 2.5, 0x2a1810, -9.5),
      bgDisc(-9, 4, 2.6, 0x6a3818, -9.4, { emissiveIntensity: 0.2 }),
      bg(-9, 4, 0.3, 5,   0x4a2818, -9.3),
      bg(-9, 4, 5,   0.3, 0x4a2818, -9.3),
      bg(-3, 3, 4, 1.2, 0x6a4828, -8.5),
      bg(-3, 4.1, 4, 1.2, 0x6a4828, -8.5),
      bg(3,  3, 4, 1.2, 0x6a4828, -8.5),
      ...(() => {
        const trees = [];
        for (let i = -10; i <= 10; i++) {
          const tx = i * 2.4;
          if (Math.abs(tx) < 5 || Math.abs(tx) > 20) continue;
          trees.push(bg(tx, 3.5, 1, 4 + (i % 3) * 0.6, 0x0a1a14, -11));
        }
        return trees;
      })(),
    ],
  },

  // ---------------------------------------------------------------------
  // ICE TOWER — vertical climb with icicle hazards under each tier.
  // ---------------------------------------------------------------------
  {
    id: 'ice',
    name: 'Ice Tower',
    bgColor: 0x081628,
    tiles: [
      ...row(0, -10, 10, { material: 'ice', hp: 30, color: 0xa8d4f0 }),
      ...tough(-1, -9, 9, { color: 0x1a2a4a }),
      // Tier 1.
      ...row(3, -8, -4, { material: 'ice', hp: 22, color: 0xbce8ff }),
      ...row(3,  4, 8, { material: 'ice', hp: 22, color: 0xbce8ff }),
      // Tier 2 — center bridge.
      ...row(6, -3, 3, { material: 'ice', hp: 18, color: 0xcceffe }),
      // Tier 3 — staggered side spires.
      ...row(9, -6, -4, { material: 'ice', hp: 14, color: 0xddf6ff }),
      ...row(9,  4,  6, { material: 'ice', hp: 14, color: 0xddf6ff }),
      // Summit.
      ...row(12, -1, 1, { material: 'ice', hp: 10, color: 0xeefcff }),
      // Frozen base pillars.
      { x: -8, y: 1, shape: 'box', w: 0.6, h: 2, material: 'ice', hp: 50, color: 0x88c0e8 },
      { x:  8, y: 1, shape: 'box', w: 0.6, h: 2, material: 'ice', hp: 50, color: 0x88c0e8 },
      // Mid-tier crystal cover (sphere).
      { x: -1, y: 7.5, shape: 'sphere', radius: 0.5, material: 'ice', hp: 30, color: 0x88e0ff },
      { x:  1, y: 7.5, shape: 'sphere', radius: 0.5, material: 'ice', hp: 30, color: 0x88e0ff },
    ],
    hazards: [
      { kind: 'lava', x: 0, y: -5, w: 36, h: 1.4, dps: 60 },
      // ICICLES — hanging beneath the tier-1 platforms (y=3 → bottom y=2.5).
      // pointDown: true rotates the cones to face the floor and the hit
      // knocks the player down toward the lava.
      { kind: 'spike', x: -6, y: 2.5, w: 2.0, pointDown: true, color: 0xddeeff },
      { kind: 'spike', x:  6, y: 2.5, w: 2.0, pointDown: true, color: 0xddeeff },
      // Icicles under the center bridge (y=6 → bottom y=5.5).
      { kind: 'spike', x: 0, y: 5.5, w: 1.6, pointDown: true, color: 0xddeeff },
      // Summit pendulum — wind-blown bell.
      { kind: 'pendulum', x: 0, y: 16, length: 4, amplitude: Math.PI / 2.5, speed: 0.9 },
    ],
    spawns: [
      { x: -8, y: 1 }, { x: 8, y: 1 },
      { x: -6, y: 4 }, { x: 6, y: 4 },
      { x: 0, y: 13 },
    ],
    weaponSpawns: [
      { x: 0, y: 13 },
      { x: 0, y: 7 },
      { x: -6, y: 4 }, { x: 6, y: 4 },
      { x: -5, y: 10 }, { x: 5, y: 10 },
    ],
    background: [
      bgGlow(-2, 26, 30, 1.0, 0x44ff88, -12),
      bgGlow(2,  24, 32, 0.8, 0x66aaff, -12),
      bgGlow(0,  22, 28, 0.6, 0x88ccff, -12),
      ...(() => {
        const peaks = [];
        peaks.push(bg(-15, 4, 14, 1.4, 0x162840, -13));
        peaks.push(bg(-14, 6, 12, 1.4, 0x1a3050, -13));
        peaks.push(bg(-13, 8, 10, 1.4, 0x223860, -13));
        peaks.push(bg(-12, 10, 8, 1.4, 0x2c4470, -13));
        peaks.push(bg(-12, 11.5, 4, 0.8, 0xddeeff, -12.9));
        peaks.push(bg(0, 5, 10, 1.4, 0x162840, -12.5));
        peaks.push(bg(0, 7, 8, 1.4, 0x1a3050, -12.5));
        peaks.push(bg(0, 9, 5, 1.4, 0x2c4470, -12.5));
        peaks.push(bg(0, 10.4, 2.5, 0.7, 0xddeeff, -12.4));
        peaks.push(bg(15, 4, 14, 1.4, 0x162840, -13));
        peaks.push(bg(14, 6, 12, 1.4, 0x1a3050, -13));
        peaks.push(bg(13, 8, 10, 1.4, 0x223860, -13));
        peaks.push(bg(12, 10, 8, 1.4, 0x2c4470, -13));
        peaks.push(bg(12, 11.5, 4, 0.8, 0xddeeff, -12.9));
        return peaks;
      })(),
      bgGlow(-12, 22, 0.18, 0.18, 0xffffff, -14),
      bgGlow(-7,  25, 0.18, 0.18, 0xffffff, -14),
      bgGlow(-3,  21, 0.15, 0.15, 0xeeeeff, -14),
      bgGlow(2,   24, 0.18, 0.18, 0xffffff, -14),
      bgGlow(7,   22, 0.15, 0.15, 0xeeeeff, -14),
      bgGlow(11,  26, 0.18, 0.18, 0xffffff, -14),
      bgGlow(14,  20, 0.18, 0.18, 0xeeeeff, -14),
      bg(-19, 8, 2, 16, 0x0a1a30, -11),
      bg(19,  8, 2, 16, 0x0a1a30, -11),
      bgDisc(-10, 24, 1.6, 0xeeeeff, -13, { emissiveIntensity: 1.2 }),
    ],
  },

  // ---------------------------------------------------------------------
  // GAUNTLET — dark forge. Side safe-spawn alcoves; the middle is a
  // gauntlet of physics pendulums + chain-suspended platforms that can
  // be shot down to deny the high lane.
  // ---------------------------------------------------------------------
  {
    id: 'gauntlet',
    name: 'Gauntlet',
    bgColor: 0x0c0810,
    tiles: [
      // Alcove floors.
      ...row(0, -16, -10, { material: 'stone', hp: 70, color: 0x4a3a3a }),
      ...row(0,  10, 16, { material: 'stone', hp: 70, color: 0x4a3a3a }),
      ...tough(-2, -16, -10, { color: 0x1a1010 }),
      ...tough(-2, 10, 16, { color: 0x1a1010 }),
      // Lower chain platforms — suspended from the y=12 crossbar.
      // Shooting the chain (CHAIN segs) drops them.
      ...row(3, -7, -4, {
        material: 'metal', hp: 60, color: 0x6a6878,
        chainAnchor: { x: -5.5, y: 12, segs: 5, hp: 22 },
      }),
      ...row(3,  4,  7, {
        material: 'metal', hp: 60, color: 0x6a6878,
        chainAnchor: { x: 5.5, y: 12, segs: 5, hp: 22 },
      }),
      // Center mid platform (also chain-suspended).
      ...row(6, -2, 2, {
        material: 'metal', hp: 60, color: 0x6a6878,
        chainAnchor: { x: 0, y: 12, segs: 4, hp: 22 },
      }),
      // Upper side platforms.
      ...row(9, -8, -5, { material: 'metal', hp: 60, color: 0x6a6878 }),
      ...row(9,  5,  8, { material: 'metal', hp: 60, color: 0x6a6878 }),
      // Top crossbeam (anchor for everything chained below).
      { x: 0, y: 12, shape: 'box', w: 22, h: 0.5, material: 'metal', hp: 200, color: 0x808898 },
      // Wall pillars frame the alcoves.
      ...col(-16, 1, 5, { shape: 'box', w: 0.6, h: 1, material: 'stone', hp: 150, color: 0x6a4a4a }),
      ...col(16,  1, 5, { shape: 'box', w: 0.6, h: 1, material: 'stone', hp: 150, color: 0x6a4a4a }),
    ],
    hazards: [
      { kind: 'lava', x: 0, y: -5, w: 44, h: 1.4, dps: 55 },
      // Big main pendulum swinging across the central crossbar — wide arc.
      { kind: 'pendulum', x: 0, y: 16, length: 7, amplitude: Math.PI / 2, speed: 0.8 },
      // Side pendulums sweeping over the y=9 upper platforms.
      { kind: 'pendulum', x: -8, y: 14, length: 4.5, amplitude: Math.PI / 3, speed: 1.4, phase: 0.5 },
      { kind: 'pendulum', x:  8, y: 14, length: 4.5, amplitude: Math.PI / 3, speed: 1.4, phase: 2.5 },
      // Floor spikes punishing missed jumps onto the alcove edges.
      { kind: 'spike', x: -10, y: 1, w: 1.4 },
      { kind: 'spike', x:  10, y: 1, w: 1.4 },
    ],
    spawns: [
      { x: -14, y: 1 }, { x: 14, y: 1 },
      { x: -6, y: 4 }, { x: 6, y: 4 },
      { x: 0, y: 7 },
    ],
    weaponSpawns: [
      { x: 0, y: 13 },                        // top crossbar prize
      { x: 0, y: 7 },
      { x: -6, y: 4 }, { x: 6, y: 4 },
      { x: -14, y: 1 }, { x: 14, y: 1 },
    ],
    background: [
      bg(0, 18, 40, 6, 0x100808, -10),
      bgGlow(-12, 5, 1.6, 1.4, 0xff5018, -8.5),
      bgGlow(-4,  5, 1.6, 1.4, 0xff6020, -8.5),
      bgGlow(4,   5, 1.6, 1.4, 0xff5018, -8.5),
      bgGlow(12,  5, 1.6, 1.4, 0xff6020, -8.5),
      bgDisc(-12, 5, 3.0, 0xff3818, -8.4, { emissiveIntensity: 0.6 }),
      bgDisc(-4,  5, 3.0, 0xff3818, -8.4, { emissiveIntensity: 0.6 }),
      bgDisc(4,   5, 3.0, 0xff3818, -8.4, { emissiveIntensity: 0.6 }),
      bgDisc(12,  5, 3.0, 0xff3818, -8.4, { emissiveIntensity: 0.6 }),
      bg(0, 19, 36, 2, 0x080404, -7.5),
      bg(-16, 10, 0.4, 12, 0x1a1010, -8.5),
      bg(16,  10, 0.4, 12, 0x1a1010, -8.5),
    ],
  },

  // ---------------------------------------------------------------------
  // SKYSCRAPER — rooftop combat. Side towers (safe spawns), glass
  // walkways and steel beams in the middle, antenna spire on top.
  // Falling into the gap = void death.
  // ---------------------------------------------------------------------
  {
    id: 'skyscraper',
    name: 'Skyscraper',
    bgColor: 0x080c1a,
    tiles: [
      // Side tower roofs.
      ...row(0, -16, -10, { material: 'metal', hp: 80, color: 0x6a7080 }),
      ...row(0, 10, 16,   { material: 'metal', hp: 80, color: 0x6a7080 }),
      ...row(-1, -16, -10, { material: 'metal', hp: 100, color: 0x4a5060 }),
      ...row(-1, 10, 16,   { material: 'metal', hp: 100, color: 0x4a5060 }),
      ...tough(-2, -16, -10, { color: 0x202830 }),
      ...tough(-2, 10, 16,   { color: 0x202830 }),
      // Glass walkway tier 1 (y=3).
      ...row(3, -8, -3, { material: 'ice', hp: 14, color: 0x80c0e0 }),
      ...row(3,  3,  8, { material: 'ice', hp: 14, color: 0x80c0e0 }),
      // Mid bridge (y=6) — chain-suspended from the antenna mast above.
      ...row(6, -2, 2,  {
        material: 'ice', hp: 14, color: 0x90d0f0,
        chainAnchor: { x: 0, y: 14, segs: 6, hp: 22 },
      }),
      // Glass walkway tier 2 (y=9).
      ...row(9, -7, -3, { material: 'ice', hp: 12, color: 0xa0e0ff }),
      ...row(9,  3,  7, { material: 'ice', hp: 12, color: 0xa0e0ff }),
      // Glass walkway tier 3 (y=12).
      ...row(12, -3, 3, { material: 'ice', hp: 10, color: 0xb0f0ff }),
      // Steel I-beams (corner posts).
      { x: -10, y: 4, shape: 'box', w: 0.5, h: 1, material: 'metal', hp: 150, color: 0x9a8060 },
      { x:  10, y: 4, shape: 'box', w: 0.5, h: 1, material: 'metal', hp: 150, color: 0x9a8060 },
      { x: -10, y: 10, shape: 'box', w: 0.5, h: 1, material: 'metal', hp: 150, color: 0x9a8060 },
      { x:  10, y: 10, shape: 'box', w: 0.5, h: 1, material: 'metal', hp: 150, color: 0x9a8060 },
      // Antenna mast at top center (cylinder).
      { x: 0, y: 14.5, shape: 'cylinder', w: 0.6, h: 2.5, radius: 0.3, material: 'metal', hp: 80, color: 0x808898 },
    ],
    hazards: [
      // Void death plane below.
      { kind: 'lava', x: 0, y: -6, w: 50, h: 1.4, dps: 999 },
      // Window-cleaner pendulum at top — hits the y=12 walkway.
      { kind: 'pendulum', x: 0, y: 18, length: 5, amplitude: Math.PI / 2.5, speed: 1.2 },
      // Broken-glass spikes on the inner edges of the side roofs.
      { kind: 'spike', x: -9, y: 1, w: 1.6 },
      { kind: 'spike', x:  9, y: 1, w: 1.6 },
      // Mid-tier glass shard hazard (point-down — falling shards from above).
      { kind: 'spike', x: 0, y: 8.5, w: 2.0, pointDown: true, color: 0xc0e0f0 },
    ],
    spawns: [
      { x: -13, y: 1 }, { x: 13, y: 1 },
      { x: -5, y: 4 }, { x: 5, y: 4 },
      { x: 0, y: 13 },
    ],
    weaponSpawns: [
      { x: 0, y: 13 },                        // antenna platform prize
      { x: 0, y: 7 },
      { x: -5, y: 10 }, { x: 5, y: 10 },
      { x: -13, y: 1 }, { x: 13, y: 1 },
    ],
    background: [
      ...(() => {
        const buildings = [];
        const heights = [10, 14, 18, 12, 16, 20, 11, 15, 13, 17, 9, 14, 19, 12, 16];
        const start = -22;
        for (let i = 0; i < heights.length; i++) {
          const h = heights[i];
          const x = start + i * 3;
          buildings.push(bg(x, h / 2 - 2, 2.6, h, 0x101830, -12));
          buildings.push(bgGlow(x - 0.6, h / 2 - 2, 0.4, h * 0.7, 0xaa8a44, -11.85));
          buildings.push(bgGlow(x + 0.6, h / 2 - 2, 0.4, h * 0.7, 0x8a6a30, -11.85));
        }
        return buildings;
      })(),
      bg(-22, 10, 6, 30, 0x182040, -8),
      bg(22, 10, 6, 30, 0x182040, -8),
      bgGlow(-23, 10, 0.35, 24, 0xffdd88, -7.8),
      bgGlow(-22, 10, 0.35, 24, 0xffaa66, -7.8),
      bgGlow(-21, 10, 0.35, 24, 0xffdd88, -7.8),
      bgGlow(21,  10, 0.35, 24, 0xffdd88, -7.8),
      bgGlow(22,  10, 0.35, 24, 0xffaa66, -7.8),
      bgGlow(23,  10, 0.35, 24, 0xffdd88, -7.8),
      bgDisc(-8, 22, 1.8, 0xddddff, -13, { emissiveIntensity: 1.2 }),
      bg(8, 24, 4, 1.2, 0x6a6a78, -12),
      bgDisc(8, 24, 0.8, 0xffaa44, -11.9, { emissiveIntensity: 0.8 }),
      bg(0, 1, 60, 2, 0x0a1020, -13),
    ],
  },

  // ---------------------------------------------------------------------
  // VOLCANO — flank ledges around an open magma pit. Tiers spaced
  // properly, hazard density reduced from previous draft.
  // ---------------------------------------------------------------------
  {
    id: 'volcano',
    name: 'Volcano',
    bgColor: 0x2a0814,
    tiles: [
      // Flank floor pads (left & right, with center pit open to lava below).
      ...row(0, -14, -7, { material: 'stone', hp: 70, color: 0x3a2018 }),
      ...row(0,  7, 14, { material: 'stone', hp: 70, color: 0x3a2018 }),
      ...tough(-1, -14, -7, { color: 0x1a0e08 }),
      ...tough(-1,  7, 14, { color: 0x1a0e08 }),
      // Lower flank platforms (y=3).
      ...row(3, -11, -8, { material: 'stone', hp: 50, color: 0x2a1810 }),
      ...row(3,  8, 11, { material: 'stone', hp: 50, color: 0x2a1810 }),
      // Mid-altitude bridge platforms (y=6) — span out toward the pit.
      ...row(6, -7, -5, { material: 'stone', hp: 40, color: 0x2a1810 }),
      ...row(6,  5,  7, { material: 'stone', hp: 40, color: 0x2a1810 }),
      // Crater rim (y=9) and summit (y=11).
      { x: -3, y: 9, material: 'stone', hp: 50, color: 0x1a0e08 },
      { x:  3, y: 9, material: 'stone', hp: 50, color: 0x1a0e08 },
      { x:  0, y: 11, material: 'stone', hp: 70, color: 0x1a0e08 },
      // Glowing molten rocks — brittle.
      { x: -9, y: 4, shape: 'sphere', radius: 0.45, material: 'stone', hp: 20, color: 0xff4422 },
      { x:  9, y: 4, shape: 'sphere', radius: 0.45, material: 'stone', hp: 20, color: 0xff4422 },
    ],
    hazards: [
      // Open central magma pit (and bottom kill plane).
      { kind: 'lava', x: 0, y: -2, w: 14, h: 3.0, dps: 60 },
      { kind: 'lava', x: 0, y: -7, w: 50, h: 2.0, dps: 100 },
      // Slope-guard lava streams (between lower and mid flanks).
      { kind: 'lava', x: -7, y: 1.4, w: 1.2, h: 0.8, dps: 45 },
      { kind: 'lava', x:  7, y: 1.4, w: 1.2, h: 0.8, dps: 45 },
      // Falling magma pendulums from the crater (two, opposite phase).
      { kind: 'pendulum', x: -1, y: 14, length: 5, amplitude: Math.PI / 3.5, speed: 1.2 },
      { kind: 'pendulum', x:  1, y: 14, length: 5, amplitude: Math.PI / 3.5, speed: 1.2, phase: Math.PI },
      // Crater-rim spike rocks.
      { kind: 'spike', x: -5, y: 7.5, w: 1.4 },
      { kind: 'spike', x:  5, y: 7.5, w: 1.4 },
    ],
    spawns: [
      { x: -12, y: 1 }, { x: 12, y: 1 },
      { x: -10, y: 4 }, { x: 10, y: 4 },
      { x: -6, y: 7 }, { x: 6, y: 7 },
      { x: 0, y: 12 },
    ],
    weaponSpawns: [
      { x: 0, y: 12 },                        // crater prize
      { x: -6, y: 7 }, { x: 6, y: 7 },
      { x: -10, y: 4 }, { x: 10, y: 4 },
      { x: -12, y: 1 }, { x: 12, y: 1 },
    ],
    background: [
      bg(0, 24, 60, 6, 0x4a0a18, -14),
      bg(0, 18, 60, 6, 0x802818, -14),
      bg(0, 13, 60, 4, 0xc04018, -14),
      bg(0, 9,  60, 3, 0xd86028, -14),
      bg(0, 14, 18, 1.5, 0x180a08, -10),
      bg(0, 12, 22, 1.5, 0x180a08, -10),
      bg(0, 10, 26, 1.5, 0x180a08, -10),
      bg(0, 8,  30, 1.5, 0x180a08, -10),
      bg(0, 6,  34, 1.5, 0x180a08, -10),
      bg(0, 4,  38, 1.5, 0x180a08, -10),
      bgGlow(0, 16, 4,   1.2, 0xffaa22, -9.5),
      bgGlow(0, 17, 2.5, 0.8, 0xffdd44, -9.5),
      bg(-1, 22, 4, 4, 0x1a0a08, -9),
      bg(1,  26, 5, 4, 0x100604, -9),
      bg(-2, 29, 7, 3, 0x080404, -9),
      bgGlow(-5, 7, 1.0, 6, 0xff5520, -9.5),
      bgGlow(5,  7, 1.0, 6, 0xff5520, -9.5),
      bgGlow(0, -1, 60, 3, 0xc02810, -11),
      bgGlow(-9, 16, 0.15, 0.15, 0xffaa44, -10.5),
      bgGlow(-3, 19, 0.15, 0.15, 0xffaa44, -10.5),
      bgGlow(4,  17, 0.15, 0.15, 0xffaa44, -10.5),
      bgGlow(9,  20, 0.15, 0.15, 0xffaa44, -10.5),
    ],
  },

  // ---------------------------------------------------------------------
  // SPACE STATION — orbital ring with low gravity. Asteroids serve as
  // platforms; planet/nebula in deep BG.
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // SPACE — 6-planet gravity system. Walk-around surfaces, projectile arcs,
  // meteor showers gated to 30s. See docs/superpowers/specs/2026-05-10-space-planet-redesign-design.md
  // ---------------------------------------------------------------------
  {
    id: 'space',
    name: 'Space',
    bgColor: 0x000008,
    gravity: 0,                  // world gravity off — planets supply their own
    curvedGravity: true,         // Stickman + Camera switch to planet-aware mode
    cameraClamp: { x: [-50, 50], y: [-35, 35], zoom: [14, 50] },
    meteorShower: { activateAfter: 30, interval: [8, 14], perShower: [1, 3] },
    killBound: { x: 50, y: 35 }, // |x|>50 or |y|>35 → instant KO
    planets: [
      { id: 'p1', cx: -14, cy:  4, radius: 6.0, mantleRadius: 4.0, coreRadius: 2.0, mass: 240 },
      { id: 'p2', cx:  12, cy: -4, radius: 5.0, mantleRadius: 3.3, coreRadius: 1.6, mass: 180 },
      { id: 'p3', cx:  -2, cy: -7, radius: 2.4, mantleRadius: 1.6, coreRadius: 0.8, mass:  60 },
      { id: 'p4', cx:   1, cy:  6, radius: 2.8, mantleRadius: 1.9, coreRadius: 1.0, mass:  80 },
      { id: 'p5', cx:  19, cy:  7, radius: 2.4, mantleRadius: 1.6, coreRadius: 0.8, mass:  60 },
      { id: 'p6', cx: -22, cy: -7, radius: 2.0, mantleRadius: 1.4, coreRadius: 0.7, mass:  50 },
    ],
    tiles: [],                   // no integer-grid tiles on this level
    hazards: [],                 // no flat hazards either — planets carry their own
    spawns: [
      { x: -14, y: -2.5 },       // top of planet 1
      { x:  12, y:  1   },       // top of planet 2
      { x:  -2, y: -4.5 },       // top of planet 3
      { x:   1, y:  9   },       // top of planet 4
      { x:  19, y:  9.5 },       // top of planet 5
      { x: -22, y: -5   },       // top of planet 6
    ],
    weaponSpawns: [
      { x: -14, y: -2.5 }, { x: 12, y: 1 }, { x: -2, y: -4.5 },
      { x: 1, y: 9 }, { x: 19, y: 9.5 }, { x: -22, y: -5 },
    ],
    background: [],              // background art added in Task 11
  },

  // ---------------------------------------------------------------------
  // CRATE STACK — warehouse interior. Two stacks + center tower.
  // ---------------------------------------------------------------------
  {
    id: 'crates',
    name: 'Crate Stack',
    bgColor: 0x140e08,
    tiles: [
      ...tough(-2, -16, 16, { color: 0x2a1810 }),
      ...row(-1, -16, -10, { material: 'metal', hp: 100, color: 0x404048 }),
      ...row(-1, 10, 16,   { material: 'metal', hp: 100, color: 0x404048 }),
      ...row(0, -16, -12, { material: 'wood', hp: 60, color: 0x6a4828 }),
      ...row(0, 12, 16,   { material: 'wood', hp: 60, color: 0x6a4828 }),
      ...row(-1, -6, 6, { material: 'stone', hp: 80, color: 0x4a4a52 }),

      // Left + right pyramids.
      ...crateCol(-7.5, 0, 3, 1.0),
      ...crateCol(-6.5, 0, 2, 1.0),
      ...crateCol(-5.5, 0, 1, 1.0),
      ...crateCol(7.5,  0, 3, 1.0),
      ...crateCol(6.5,  0, 2, 1.0),
      ...crateCol(5.5,  0, 1, 1.0),

      // Center small-crate tower.
      crate(0, 0,    0.85, { color: 0x9a6028 }),
      crate(0, 0.85, 0.85, { color: 0xa8702a }),
      crate(0, 1.70, 0.85, { color: 0x9a6028 }),
      crate(0, 2.55, 0.85, { color: 0xa8702a }),

      crate(-3, 0,   0.7, { color: 0xb87a32, hp: 16, tileMass: 3 }),
      crate( 3, 0,   0.7, { color: 0xb87a32, hp: 16, tileMass: 3 }),
      crate(-6.5, 4, 1.2, { color: 0x7a4a18, hp: 50, tileMass: 28 }),
      crate( 6.5, 4, 1.2, { color: 0x7a4a18, hp: 50, tileMass: 28 }),

      // Catwalk.
      ...row(7, -3, 3, { material: 'metal', hp: 90, color: 0x60606a }),
    ],
    hazards: [
      { kind: 'lava', x: 0, y: -5, w: 40, h: 1.4, dps: 50 },
      { kind: 'pendulum', x: 0, y: 11, length: 3.5, amplitude: Math.PI / 3, speed: 1.4 },
    ],
    spawns: [
      { x: -14, y: 2 }, { x: 14, y: 2 },
      { x: -4, y: 1 }, { x: 4, y: 1 },
      { x: 0, y: 8 },
    ],
    weaponSpawns: [
      { x: 0, y: 8 },
      { x: -12, y: 2 }, { x: 12, y: 2 },
      { x: -4, y: 1 }, { x: 4, y: 1 },
      { x: 0, y: 4 },
    ],
    background: [
      bg(0, 8, 34, 16, 0x2a1810, -10),
      bg(-10, 8, 0.2, 16, 0x140804, -9.95),
      bg(-4,  8, 0.2, 16, 0x140804, -9.95),
      bg(4,   8, 0.2, 16, 0x140804, -9.95),
      bg(10,  8, 0.2, 16, 0x140804, -9.95),
      bg(0, 16, 36, 1.2, 0x404048, -9),
      bg(0, 14.3, 36, 0.4, 0x202028, -8.9),
      bgGlow(-12, 13.2, 0.6, 0.6, 0xffeeaa, -8.5),
      bgGlow(-6,  13.2, 0.6, 0.6, 0xffeeaa, -8.5),
      bgGlow(0,   13.2, 0.6, 0.6, 0xffeeaa, -8.5),
      bgGlow(6,   13.2, 0.6, 0.6, 0xffeeaa, -8.5),
      bgGlow(12,  13.2, 0.6, 0.6, 0xffeeaa, -8.5),
      bgDisc(-12, 12, 1.6, 0xffd070, -8.4, { emissiveIntensity: 0.35 }),
      bgDisc(-6,  12, 1.6, 0xffd070, -8.4, { emissiveIntensity: 0.35 }),
      bgDisc(0,   12, 1.6, 0xffd070, -8.4, { emissiveIntensity: 0.35 }),
      bgDisc(6,   12, 1.6, 0xffd070, -8.4, { emissiveIntensity: 0.35 }),
      bgDisc(12,  12, 1.6, 0xffd070, -8.4, { emissiveIntensity: 0.35 }),
      bg(-15, 5, 0.6, 10, 0x4a3020, -8.5),
      bg(-15, 5, 6, 0.4, 0x4a3020, -8.5),
      bg(-15, 9, 6, 0.4, 0x4a3020, -8.5),
      bg(15,  5, 0.6, 10, 0x4a3020, -8.5),
      bg(15,  5, 6, 0.4, 0x4a3020, -8.5),
      bg(15,  9, 6, 0.4, 0x4a3020, -8.5),
      bg(-10, 4, 1.4, 1.4, 0x6a4020, -9.5),
      bg(-9,  5.5, 1.4, 1.4, 0x6a4020, -9.5),
      bg(10,  4, 1.4, 1.4, 0x6a4020, -9.5),
      bg(9,   5.5, 1.4, 1.4, 0x6a4020, -9.5),
      bg(17, 4, 4, 8, 0x404048, -8),
    ],
  },

  // ---------------------------------------------------------------------
  // CATHEDRAL — gothic interior. Pillars, capitals, bell pendulum, big
  // stained-glass rose window in BG.
  // ---------------------------------------------------------------------
  {
    id: 'cathedral',
    name: 'Cathedral',
    bgColor: 0x0c1028,
    tiles: [
      ...row(0, -14, 14, { material: 'stone', hp: 70, color: 0x7878a0 }),
      ...tough(-2, -12, 12, { color: 0x303048 }),
      // Pews — low cover.
      { x: -8, y: 1, shape: 'box', w: 2, h: 0.5, material: 'wood', hp: 20, color: 0x6a3818 },
      { x:  8, y: 1, shape: 'box', w: 2, h: 0.5, material: 'wood', hp: 20, color: 0x6a3818 },
      { x: -3, y: 1, shape: 'box', w: 2, h: 0.5, material: 'wood', hp: 20, color: 0x6a3818 },
      { x:  3, y: 1, shape: 'box', w: 2, h: 0.5, material: 'wood', hp: 20, color: 0x6a3818 },
      // Pillars.
      { x: -10, y: 3, shape: 'box', w: 0.7, h: 5, material: 'stone', hp: 100, color: 0x9090a0 },
      { x:  10, y: 3, shape: 'box', w: 0.7, h: 5, material: 'stone', hp: 100, color: 0x9090a0 },
      { x:  -5, y: 3, shape: 'box', w: 0.7, h: 5, material: 'stone', hp: 100, color: 0x9090a0 },
      { x:   5, y: 3, shape: 'box', w: 0.7, h: 5, material: 'stone', hp: 100, color: 0x9090a0 },
      // Pillar capitals (sphere caps — climbable platforms).
      { x: -10, y: 6.2, shape: 'sphere', radius: 0.7, material: 'stone', hp: 70, color: 0xa0a0b0 },
      { x:  10, y: 6.2, shape: 'sphere', radius: 0.7, material: 'stone', hp: 70, color: 0xa0a0b0 },
      { x:  -5, y: 6.2, shape: 'sphere', radius: 0.7, material: 'stone', hp: 70, color: 0xa0a0b0 },
      { x:   5, y: 6.2, shape: 'sphere', radius: 0.7, material: 'stone', hp: 70, color: 0xa0a0b0 },
      // Chandelier — chain-suspended platform from the roof. Players who
      // want the prize can shoot the chains to drop the chandelier on
      // anyone underneath.
      { x: 0, y: 9, shape: 'box', w: 3, h: 0.5, material: 'metal', hp: 90, color: 0xa88040,
        chainAnchor: { x: 0, y: 14, segs: 5, hp: 24 } },
      // Vault ribs (now y=11 — was 9, room for chandelier at y=9 below).
      { x: -3, y: 11, shape: 'box', w: 2, h: 0.4, material: 'stone', hp: 60, color: 0x808898 },
      { x:  3, y: 11, shape: 'box', w: 2, h: 0.4, material: 'stone', hp: 60, color: 0x808898 },
      // Roof slab — bell hangs below.
      { x: 0, y: 13, shape: 'box', w: 18, h: 0.5, material: 'metal', hp: 180, color: 0x6a7080 },
    ],
    hazards: [
      { kind: 'lava', x: 0, y: -5, w: 40, h: 1.4, dps: 50 },
      // Bell pendulum — anchor above the roof.
      { kind: 'pendulum', x: 0, y: 16, length: 4, amplitude: Math.PI / 2.8, speed: 1.0 },
    ],
    spawns: [
      { x: -12, y: 1 }, { x: 12, y: 1 },
      { x: -7, y: 2 }, { x: 7, y: 2 },
      { x: -10, y: 7 }, { x: 10, y: 7 },     // capital tops
    ],
    weaponSpawns: [
      { x: 0, y: 10 },                        // chandelier top — big risk, big prize
      { x: -10, y: 7 }, { x: 10, y: 7 },
      { x: -5, y: 7 }, { x: 5, y: 7 },
      { x: 0, y: 1 },
    ],
    background: [
      // Stained-glass rose window — sphere + petals.
      bgSphere(0, 16, 2.4, 0xffaa44, -8.5, { emissive: 0xff8830, emissiveIntensity: 1.5 }),
      bgGlow(-2.4, 16, 0.9, 0.9, 0xff4488, -8.4),
      bgGlow(2.4, 16, 0.9, 0.9, 0xff4488, -8.4),
      bgGlow(0, 18.4, 0.9, 0.9, 0x44aaff, -8.4),
      bgGlow(0, 13.6, 0.9, 0.9, 0x44aaff, -8.4),
      bgGlow(-1.7, 17.7, 0.7, 0.7, 0x88ff44, -8.4),
      bgGlow(1.7, 17.7, 0.7, 0.7, 0x88ff44, -8.4),
      bgGlow(-1.7, 14.3, 0.7, 0.7, 0xaa44ff, -8.4),
      bgGlow(1.7, 14.3, 0.7, 0.7, 0xaa44ff, -8.4),
      bgDisc(0, 16, 3.2, 0x101830, -8.6, { emissiveIntensity: 0 }),
      // Side stained-glass arches.
      bgGlow(-12, 13, 1.0, 3.0, 0x6a30aa, -8.5),
      bgGlow(12,  13, 1.0, 3.0, 0x6a30aa, -8.5),
      bgGlow(-12, 13, 0.4, 2.4, 0xaa50ff, -8.4),
      bgGlow(12,  13, 0.4, 2.4, 0xaa50ff, -8.4),
      // Distant pillar silhouettes.
      bg(-15, 7, 1.0, 12, 0x101830, -10),
      bg(15,  7, 1.0, 12, 0x101830, -10),
      bg(-13, 8, 1.0, 14, 0x161a3a, -10.5),
      bg(13,  8, 1.0, 14, 0x161a3a, -10.5),
      // Vault ceiling silhouette.
      bg(0, 18.5, 22, 1.0, 0x0a1020, -9.5),
      bg(0, 19.5, 18, 1.0, 0x080818, -9.5),
      bg(0, 20.5, 14, 1.0, 0x060614, -9.5),
      // Candelabra glow.
      bgGlow(-3, 9.5, 0.2, 0.4, 0xffcc44, -8),
      bgGlow(3,  9.5, 0.2, 0.4, 0xffcc44, -8),
      bgDisc(-3, 9.7, 0.7, 0xffaa44, -7.95, { emissiveIntensity: 0.6 }),
      bgDisc(3,  9.7, 0.7, 0xffaa44, -7.95, { emissiveIntensity: 0.6 }),
    ],
  },

  // ---------------------------------------------------------------------
  // FALLING TOWER — Jenga. Central dynamic block stack the players
  // knock loose; stable side towers as safe spawn pads.
  // ---------------------------------------------------------------------
  {
    id: 'falling',
    name: 'Falling Tower',
    bgColor: 0x080a14,
    tiles: [
      ...tough(-2, -14, 14, { color: 0x141828 }),
      ...row(0, -16, 16, { material: 'metal', hp: 110, color: 0x4a505a }),
      // Side stable towers.
      { x: -10, y: 2.5, shape: 'cylinder', w: 1.6, h: 5, radius: 0.8, material: 'metal', hp: 150, color: 0x6a7080 },
      { x:  10, y: 2.5, shape: 'cylinder', w: 1.6, h: 5, radius: 0.8, material: 'metal', hp: 150, color: 0x6a7080 },
      // Side platforms on top of cylinders.
      { x: -10, y: 5.5, shape: 'box', w: 3, h: 0.4, material: 'metal', hp: 120, color: 0x808890 },
      { x:  10, y: 5.5, shape: 'box', w: 3, h: 0.4, material: 'metal', hp: 120, color: 0x808890 },
      // Central dynamic block tower — Jenga.
      ...row(1, -2, 2, { material: 'metal', hp: 50, dynamic: true, tileMass: 12, color: 0x5a606e }),
      ...row(2, -2, 2, { material: 'metal', hp: 50, dynamic: true, tileMass: 12, color: 0x5a606e }),
      ...row(3, -1, 1, { material: 'metal', hp: 45, dynamic: true, tileMass: 10, color: 0x6a707e }),
      ...row(4, -1, 1, { material: 'metal', hp: 45, dynamic: true, tileMass: 10, color: 0x6a707e }),
      // Mid-air bridges — chain-suspended (shootable).
      { x: -7, y: 5, shape: 'box', w: 3, h: 0.4, material: 'metal', hp: 70, color: 0x707888,
        chainAnchor: { x: -7, y: 11, segs: 5, hp: 22 } },
      { x:  7, y: 5, shape: 'box', w: 3, h: 0.4, material: 'metal', hp: 70, color: 0x707888,
        chainAnchor: { x: 7, y: 11, segs: 5, hp: 22 } },
      // Top prize platform.
      { x: 0, y: 9, shape: 'box', w: 6, h: 0.5, material: 'metal', hp: 100, color: 0x6a7080 },
    ],
    hazards: [
      { kind: 'lava', x: 0, y: -5, w: 44, h: 1.4, dps: 55 },
      { kind: 'spike', x: -3, y: 1, w: 2 },
      { kind: 'spike', x:  3, y: 1, w: 2 },
      // Wrecking-ball pendulum from above.
      { kind: 'pendulum', x: 0, y: 14, length: 4.5, amplitude: Math.PI / 3, speed: 1.3 },
    ],
    spawns: [
      { x: -13, y: 1 }, { x: 13, y: 1 },
      { x: -10, y: 6.5 }, { x: 10, y: 6.5 },
      { x: 0, y: 10 },
    ],
    weaponSpawns: [
      { x: 0, y: 10 },
      { x: -10, y: 6.5 }, { x: 10, y: 6.5 },
      { x: -7, y: 6 }, { x: 7, y: 6 },
      { x: 0, y: 1 },
    ],
    background: [
      bg(-22, 7, 4, 14, 0x0a1020, -11),
      bg(-22, 14, 3.5, 1, 0x111835, -10.9),
      bg(-17, 6, 5, 12, 0x12182a, -11),
      bg(-12, 8, 3, 16, 0x0a1020, -11),
      bg(-7, 5, 4, 10, 0x12182a, -11),
      bg(7, 7, 4, 14, 0x0a1020, -11),
      bg(12, 5, 3, 10, 0x12182a, -11),
      bg(17, 8, 5, 16, 0x0a1020, -11),
      bg(22, 6, 4, 12, 0x12182a, -11),
      bgGlow(-22, 9, 0.3, 0.3, 0xffaa44, -10.8),
      bgGlow(-17, 11, 0.3, 0.3, 0xffaa44, -10.8),
      bgGlow(-12, 10, 0.3, 0.3, 0xff8844, -10.8),
      bgGlow(7, 12, 0.3, 0.3, 0xffaa44, -10.8),
      bgGlow(12, 6, 0.3, 0.3, 0xff8844, -10.8),
      bgGlow(22, 14, 0.3, 0.3, 0xffaa44, -10.8),
      bg(0, 1, 60, 2, 0x141828, -13),
      bgDisc(-2, 22, 1.4, 0xeeeeff, -13, { emissiveIntensity: 1.0 }),
    ],
  },

  // ---------------------------------------------------------------------
  // BOUNCE HOUSE — carnival party stage. Trampolines, balloons,
  // spotlights. Friendly chaos.
  // ---------------------------------------------------------------------
  {
    id: 'bounce',
    name: 'Bounce House',
    bgColor: 0x180830,
    tiles: [
      ...row(0, -10, 10, { material: 'bouncy', hp: 35, color: 0x88e8b8 }),
      ...tough(-2, -8, 8, { color: 0x301050 }),
      ...col(-10, 1, 4, { shape: 'box', w: 0.6, h: 1, material: 'bouncy', hp: 40, color: 0xffaaee }),
      ...col(10,  1, 4, { shape: 'box', w: 0.6, h: 1, material: 'bouncy', hp: 40, color: 0xffaaee }),
      // Tier 1 (y=3).
      ...row(3, -7, -4, { material: 'bouncy', hp: 25, color: 0xffe488 }),
      ...row(3,  4,  7, { material: 'bouncy', hp: 25, color: 0xffe488 }),
      // Mid trampoline (y=6).
      ...row(6, -2, 2,  { material: 'bouncy', hp: 25, color: 0xff88aa }),
      // Tier 2 (y=9).
      ...row(9, -3, -1, { material: 'bouncy', hp: 20, color: 0x88aaff }),
      ...row(9,  1,  3, { material: 'bouncy', hp: 20, color: 0x88aaff }),
      // Bell platform (y=11).
      { x: 0, y: 11, shape: 'sphere', radius: 0.7, material: 'bouncy', hp: 30, color: 0xffffff },
    ],
    hazards: [
      { kind: 'lava', x: 0, y: -5, w: 36, h: 1.4, dps: 50 },
      { kind: 'pendulum', x: 0, y: 15, length: 3.5, amplitude: Math.PI / 3.5, speed: 1.5 },
    ],
    spawns: [
      { x: -8, y: 1 }, { x: 8, y: 1 },
      { x: -5, y: 4 }, { x: 5, y: 4 },
      { x: 0, y: 7 },
      { x: 0, y: 13 },
    ],
    weaponSpawns: [
      { x: 0, y: 13 },                        // bell prize
      { x: 0, y: 7 },
      { x: -5, y: 4 }, { x: 5, y: 4 },
      { x: -7, y: 1 }, { x: 7, y: 1 },
    ],
    background: [
      bgGlow(0, 21, 50, 2, 0xff4488, -10),
      bgGlow(0, 18, 50, 2, 0xff8844, -10),
      bgGlow(0, 15, 50, 2, 0xffee44, -10),
      bgGlow(0, 12, 50, 2, 0x88ff44, -10),
      bgGlow(0, 9,  50, 2, 0x44aaff, -10),
      bgGlow(0, 6,  50, 2, 0xaa44ff, -10),
      bgGlow(-12, 16, 1.2, 18, 0xffeeaa, -8.5),
      bgGlow(12,  16, 1.2, 18, 0xffeeaa, -8.5),
      bgGlow(0,   18, 1.0, 16, 0xffffff, -8.5),
      bgSphere(-12, 19, 0.5, 0xff4488, -7.5, { emissive: 0xff4488, emissiveIntensity: 0.6 }),
      bgSphere(-10, 20, 0.5, 0xffee44, -7.5, { emissive: 0xffee44, emissiveIntensity: 0.6 }),
      bgSphere(-8,  18.5, 0.5, 0x44aaff, -7.5, { emissive: 0x44aaff, emissiveIntensity: 0.6 }),
      bgSphere(8,   19, 0.5, 0x88ff44, -7.5, { emissive: 0x88ff44, emissiveIntensity: 0.6 }),
      bgSphere(10,  20, 0.5, 0xff4488, -7.5, { emissive: 0xff4488, emissiveIntensity: 0.6 }),
      bgSphere(12,  18.5, 0.5, 0xaa44ff, -7.5, { emissive: 0xaa44ff, emissiveIntensity: 0.6 }),
      bgSphere(0,   23, 0.6, 0xffffff, -7.5, { emissive: 0xffffff, emissiveIntensity: 0.7 }),
      bg(-12, 17, 0.06, 3, 0xeeeeee, -7.4),
      bg(-10, 18, 0.06, 3, 0xeeeeee, -7.4),
      bg(-8,  16.5, 0.06, 3, 0xeeeeee, -7.4),
      bg(8,   17, 0.06, 3, 0xeeeeee, -7.4),
      bg(10,  18, 0.06, 3, 0xeeeeee, -7.4),
      bg(12,  16.5, 0.06, 3, 0xeeeeee, -7.4),
      bgGlow(-6, 13, 0.18, 0.18, 0xff8844, -6.5),
      bgGlow(-2, 16, 0.18, 0.18, 0x88ff44, -6.5),
      bgGlow(2,  14, 0.18, 0.18, 0xff4488, -6.5),
      bgGlow(6,  17, 0.18, 0.18, 0xffee44, -6.5),
      bgGlow(-4, 11, 0.18, 0.18, 0x44aaff, -6.5),
      bgGlow(4,  10, 0.18, 0.18, 0xaa44ff, -6.5),
    ],
  },

  // ---------------------------------------------------------------------
  // CRATE ZONE — pure crate physics. No static floor inside the kill
  // arena; three wooden pallet bases (the "outside the killbox" supports)
  // are the only static surfaces — everything else is dynamic crates that
  // stack, lean, and topple. A wrecking-ball pendulum from the gantry
  // overhead exists solely to knock the piles into the lava sea.
  // ---------------------------------------------------------------------
  {
    id: 'cratezone',
    name: 'Crate Zone',
    bgColor: 0x14100a,
    tiles: [
      // Wooden pallet bases — three small supports outside the open lava
      // area, each just wide enough to hold a pile.
      { x: -11, y: 0, shape: 'box', w: 4, h: 0.5, material: 'wood', hp: 250, color: 0x4a3018 },
      { x:   0, y: 0, shape: 'box', w: 4, h: 0.5, material: 'wood', hp: 250, color: 0x4a3018 },
      { x:  11, y: 0, shape: 'box', w: 4, h: 0.5, material: 'wood', hp: 250, color: 0x4a3018 },

      // ── LEFT PILE (x=-11) — 3-column pyramid, 6 tall in the middle ──
      ...crateCol(-12, 0.5, 4, 1.0, { color: 0x9a6028 }),
      ...crateCol(-11, 0.5, 6, 1.0, { color: 0xa8702a }),
      ...crateCol(-10, 0.5, 4, 1.0, { color: 0x9a6028 }),
      // Capstone — small loose crate on top.
      crate(-11, 6.5, 0.85, { color: 0xb87a32 }),

      // ── CENTER PILE (x=0) — 3-2-1 pyramid, 5 tall ──
      ...crateCol(-1, 0.5, 3, 1.0, { color: 0x9a6028 }),
      ...crateCol(0,  0.5, 5, 1.0, { color: 0xa8702a }),
      ...crateCol(1,  0.5, 3, 1.0, { color: 0x9a6028 }),
      crate(0, 5.5, 0.85, { color: 0xb87a32 }),

      // ── RIGHT PILE (x=11) — mirror of left ──
      ...crateCol(10, 0.5, 4, 1.0, { color: 0x9a6028 }),
      ...crateCol(11, 0.5, 6, 1.0, { color: 0xa8702a }),
      ...crateCol(12, 0.5, 4, 1.0, { color: 0x9a6028 }),
      crate(11, 6.5, 0.85, { color: 0xb87a32 }),

      // Loose ammo crates perched precariously on the side piles —
      // shootable / kickable into combat.
      crate(-12, 5,  0.6, { color: 0xc88842, hp: 12, tileMass: 2 }),
      crate( 12, 5,  0.6, { color: 0xc88842, hp: 12, tileMass: 2 }),
      // Heavy precarious crate on each side — big roll candidates.
      crate(-9.5, 4, 1.2, { color: 0x7a4a18, hp: 50, tileMass: 28 }),
      crate( 9.5, 4, 1.2, { color: 0x7a4a18, hp: 50, tileMass: 28 }),
    ],
    hazards: [
      // Lava sea fills every gap between the piles — the only floor is the
      // crates themselves.
      { kind: 'lava', x: 0, y: -2, w: 50, h: 1.4, dps: 60 },
      // Wrecking-ball pendulum from the gantry — designed specifically to
      // knock piles over and make the level evolve mid-match.
      { kind: 'pendulum', x: 0, y: 14, length: 5.5, amplitude: Math.PI / 2.2, speed: 0.9 },
    ],
    spawns: [
      { x: -11, y: 8 }, { x: 11, y: 8 },     // top of side piles
      { x: 0, y: 7 },                         // top of center pile
      { x: -11, y: 1.5 }, { x: 11, y: 1.5 }, // pallet bases
    ],
    weaponSpawns: [
      { x: 0, y: 8 },                         // top center prize
      { x: -11, y: 8 }, { x: 11, y: 8 },
      { x: -11, y: 1.5 }, { x: 11, y: 1.5 },
    ],
    background: [
      // Industrial warehouse rear wall.
      bg(0, 8, 40, 22, 0x2a1810, -10),
      bg(-12, 8, 0.2, 22, 0x140804, -9.95),
      bg(-6,  8, 0.2, 22, 0x140804, -9.95),
      bg(6,   8, 0.2, 22, 0x140804, -9.95),
      bg(12,  8, 0.2, 22, 0x140804, -9.95),
      // High ceiling with gantry crane I-beam.
      bg(0, 18, 36, 1.4, 0x404048, -9),
      bg(0, 16.5, 36, 0.4, 0x202028, -8.9),
      // Gantry support legs.
      bg(-15, 13, 0.6, 11, 0x4a4a52, -8.5),
      bg(15,  13, 0.6, 11, 0x4a4a52, -8.5),
      // Cage lights along the ceiling beam.
      bgGlow(-12, 15.5, 0.6, 0.6, 0xffeeaa, -8.5),
      bgGlow(-6,  15.5, 0.6, 0.6, 0xffeeaa, -8.5),
      bgGlow(0,   15.5, 0.6, 0.6, 0xffeeaa, -8.5),
      bgGlow(6,   15.5, 0.6, 0.6, 0xffeeaa, -8.5),
      bgGlow(12,  15.5, 0.6, 0.6, 0xffeeaa, -8.5),
      bgDisc(-12, 14.4, 1.6, 0xffd070, -8.4, { emissiveIntensity: 0.35 }),
      bgDisc(-6,  14.4, 1.6, 0xffd070, -8.4, { emissiveIntensity: 0.35 }),
      bgDisc(0,   14.4, 1.6, 0xffd070, -8.4, { emissiveIntensity: 0.35 }),
      bgDisc(6,   14.4, 1.6, 0xffd070, -8.4, { emissiveIntensity: 0.35 }),
      bgDisc(12,  14.4, 1.6, 0xffd070, -8.4, { emissiveIntensity: 0.35 }),
      // Distant cargo silhouettes for set dressing.
      bg(-17, 5, 4, 7, 0x6a4020, -9.5),
      bg(17,  5, 4, 7, 0x6a4020, -9.5),
      bg(-17, 9, 4, 1.8, 0x4a2818, -9.5),
      bg(17,  9, 4, 1.8, 0x4a2818, -9.5),
      // Lava-warning glow stripe along the kill plane.
      bgGlow(0, -1.5, 50, 0.4, 0xff6020, -9.5),
      // Hazard chevron stripes painted on the rear wall above the lava.
      bg(-8, -0.8, 1.2, 0.4, 0xffaa22, -9.7),
      bg(-4, -0.8, 1.2, 0.4, 0x141008, -9.7),
      bg(0,  -0.8, 1.2, 0.4, 0xffaa22, -9.7),
      bg(4,  -0.8, 1.2, 0.4, 0x141008, -9.7),
      bg(8,  -0.8, 1.2, 0.4, 0xffaa22, -9.7),
    ],
  },
];

export function getLevel(id) { return LEVELS.find(l => l.id === id) ?? LEVELS[0]; }
