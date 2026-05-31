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
  // SAW MILL — "The Mill". Chaos-hazard arena dominated by ONE giant
  // sweeping saw blade that owns the entire floor. Players hop to side
  // ledges / a center perch to survive, drop back for weapons.
  // ZERO pendulums. Dynamic logs get flung as chaos objects.
  //
  // Layout tiers (y coords):
  //   y=0   Solid floor      x:-15..15  (destructible wood + metal subfloor)
  //   y=4   Side safe ledges x:-15..-12 left, 12..15 right (OUTSIDE saw reach)
  //   y=4   Mid steps        x:-7..-4 left, 4..7 right (ABOVE saw kill top 3.1)
  //   y=7   Center perch     x:-2..2   (prize — saw passes underneath)
  //
  // Giant saw envelope: center x:0, y:0.9, radius:2.2, patrol ±9
  //   Kill sphere top = 0.9+2.2 = 3.1 → nothing standable below y≈3.5
  //   Kill sphere x-reach at extremes = ±9 ± 2.2 = ±11.2
  //   Safe floor x: |x|>=12 (side ledges); safe above y=3.5 anywhere
  // ---------------------------------------------------------------------
  {
    id: 'sawmill',
    name: 'Saw Mill',
    bgColor: 0x0c1a18,
    killBound: { x: 18, y: 14 },
    tiles: [
      // ── Solid floor ──
      ...row(0, -15, 15, { material: 'wood', hp: 35, color: 0x8a5a30 }),
      ...tough(-1, -15, 15, { color: 0x4a4a52 }),

      // ── Safe SIDE LEDGES (y=4) — outside saw reach (|x|>11.2) ──
      ...row(4, -15, -12, { material: 'metal', hp: 60, color: 0x6a7080 }),
      ...row(4,  12,  15, { material: 'metal', hp: 60, color: 0x6a7080 }),
      // Support pillars under side ledges.
      { x: -15, y: 2.0, shape: 'box', w: 0.5, h: 3.5, material: 'metal', hp: 90, color: 0x4a505c },
      { x: -12, y: 2.0, shape: 'box', w: 0.5, h: 3.5, material: 'metal', hp: 90, color: 0x4a505c },
      { x:  12, y: 2.0, shape: 'box', w: 0.5, h: 3.5, material: 'metal', hp: 90, color: 0x4a505c },
      { x:  15, y: 2.0, shape: 'box', w: 0.5, h: 3.5, material: 'metal', hp: 90, color: 0x4a505c },

      // ── MID STEPS (y=4, nearer center — above saw kill top 3.1) ──
      // Tile surface = 4.5 > 3.1 — players standing here are above the saw.
      ...row(4, -7, -4, { material: 'wood', hp: 30, color: 0x9a6030 }),
      ...row(4,  4,  7, { material: 'wood', hp: 30, color: 0x9a6030 }),
      // Struts under mid steps.
      { x: -7, y: 2.0, shape: 'box', w: 0.4, h: 3.5, material: 'metal', hp: 70, color: 0x4a505c },
      { x: -4, y: 2.0, shape: 'box', w: 0.4, h: 3.5, material: 'metal', hp: 70, color: 0x4a505c },
      { x:  4, y: 2.0, shape: 'box', w: 0.4, h: 3.5, material: 'metal', hp: 70, color: 0x4a505c },
      { x:  7, y: 2.0, shape: 'box', w: 0.4, h: 3.5, material: 'metal', hp: 70, color: 0x4a505c },

      // ── CENTER PRIZE PERCH (y=7) — saw passes far below ──
      ...row(7, -2, 2, { material: 'metal', hp: 70, color: 0x808890 }),
      // Perch support pillar.
      { x: 0, y: 5.5, shape: 'box', w: 0.5, h: 2.5, material: 'metal', hp: 100, color: 0x505860 },

      // ── DYNAMIC LOGS — rolling chaos on the floor ──
      // Placed outside saw center but in the sweep path — they get flung.
      { x: -6,  y: 0.55, shape: 'cylinder', radius: 0.45, w: 1, h: 0.9,
        material: 'wood', hp: 25, color: 0x9a6030, dynamic: true, tileMass: 6 },
      { x:  6,  y: 0.55, shape: 'cylinder', radius: 0.45, w: 1, h: 0.9,
        material: 'wood', hp: 25, color: 0x9a6030, dynamic: true, tileMass: 6 },
      { x: -9,  y: 0.55, shape: 'cylinder', radius: 0.45, w: 1, h: 0.9,
        material: 'wood', hp: 25, color: 0x8a5828, dynamic: true, tileMass: 6 },
      { x:  9,  y: 0.55, shape: 'cylinder', radius: 0.45, w: 1, h: 0.9,
        material: 'wood', hp: 25, color: 0x8a5828, dynamic: true, tileMass: 6 },

      // ── Static log-pile cover on the side ledges ──
      { x: -14, y: 4.6, shape: 'cylinder', radius: 0.4, w: 0.9, h: 0.8,
        material: 'wood', hp: 22, color: 0xa06030 },
      { x:  14, y: 4.6, shape: 'cylinder', radius: 0.4, w: 0.9, h: 0.8,
        material: 'wood', hp: 22, color: 0xa06030 },
    ],
    hazards: [
      // ── THE CENTERPIECE: giant saw blade sweeping the entire floor ──
      // Patrol span w:18 → sweeps x∈[-9,9] at y=0.9.
      // Kill sphere r2.2 → top=3.1, so nothing standable/spawnable below y=3.5
      // that is within |x|<11.2.
      { kind: 'saw', x: 0, y: 0.9, w: 18, radius: 2.2 },
      // Kill plane far below.
      { kind: 'lava', x: 0, y: -5, w: 44, h: 1.4, dps: 60 },
    ],
    // ── Spawns — ALL clear of saw envelope ──
    //   Side ledges y=4 (surface 4.5): |x|=12..15 → |x|>11.2 ✓ above saw top 3.1 ✓
    //   Mid steps y=4 (surface 4.5): surface 4.5>3.1 ✓ (safe above saw)
    //   Center perch y=7 (surface 7.5): far above saw ✓
    //   Floor corners |x|=13, y=1: |x|=13>11.2 ✓ (outside saw x-reach)
    spawns: [
      { x: -14, y: 5 },   // left side ledge (tile x:-15..-12, y=4)
      { x:  13, y: 5 },   // right side ledge (tile x:12..15, y=4)
      { x:  -6, y: 5 },   // left mid step (tile x:-7..-4, y=4)
      { x:   5, y: 5 },   // right mid step (tile x:4..7, y=4)
      { x:   0, y: 8 },   // center perch (tile x:-2..2, y=7)
      { x: -13, y: 1 },   // far floor left (|x|=13>11.2, outside saw sweep)
      { x:  13, y: 1 },   // far floor right
    ],
    weaponSpawns: [
      { x:   0, y: 8 },   // PRIZE — center perch
      { x: -14, y: 5 },   // left side ledge
      { x:  14, y: 5 },   // right side ledge
      { x:  -5, y: 5 },   // left mid step
      { x:   5, y: 5 },   // right mid step
      { x: -13, y: 1 },   // floor corner (risky — near saw)
      { x:  13, y: 1 },   // floor corner (risky — near saw)
    ],
    background: [
      // Dark mill interior sky gradient.
      bg(0, 22, 60, 8, 0x18302e, -14),
      bg(0, 14, 60, 6, 0x2a4845, -14),
      // Left wall — tall timber frame.
      bg(-16, 6, 5, 16, 0x3a2818, -10),
      bg(-16, 14, 4, 2.5, 0x4a3020, -9.8),
      bg(-16, 16.5, 3, 2, 0x1a1008, -9.8),
      bg(-15, 19, 2.2, 3.5, 0x2a1810, -9.5),
      // Right wall — sawmill machinery block.
      bg(14, 5, 8, 13, 0x4a3020, -10),
      bg(14, 12, 8.5, 1.2, 0x6a4a30, -9.9),
      // Mill window glow (right side).
      bgGlow(12, 6, 0.5, 0.9, 0xffaa44, -9.5),
      bgGlow(12, 8, 0.5, 0.9, 0xffaa44, -9.5),
      bgGlow(16, 6, 0.5, 0.9, 0xffaa44, -9.5),
      bgGlow(16, 9, 0.5, 0.9, 0xffaa44, -9.5),
      // Water wheel silhouette (left BG).
      bgSphere(-11, 5, 2.8, 0x2a1810, -9.5),
      bgDisc(-11, 5, 2.9, 0x5a3018, -9.4, { emissiveIntensity: 0.15 }),
      bg(-11, 5, 0.3, 6,   0x3a2010, -9.3),
      bg(-11, 5, 6,   0.3, 0x3a2010, -9.3),
      // Saw-pit darkness / glow at the floor gap.
      bgGlow(0, -1, 3.5, 0.4, 0xff4400, -7.0),
      bgDisc(0, -2, 1.8, 0xff2200, -6.9, { emissiveIntensity: 0.9 }),
      // Horizontal log racks on back wall.
      bg(-4, 3.5, 5, 0.8, 0x6a4828, -8.5),
      bg(-4, 4.5, 5, 0.8, 0x5a3820, -8.5),
      bg( 5, 3.5, 4, 0.8, 0x6a4828, -8.5),
      // Background trees framing the exterior visible through gaps.
      ...(() => {
        const trees = [];
        for (let i = -9; i <= 9; i++) {
          const tx = i * 2.6;
          if (Math.abs(tx) < 6 || Math.abs(tx) > 22) continue;
          trees.push(bg(tx, 4, 1, 5 + (Math.abs(i) % 3) * 0.7, 0x0a1a14, -11));
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
      { x: -1, y: 13 }, { x: 1, y: 13 },   // two summit spawns (row(12,-1,1) surface=12.5)
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
  // VOLCANO — "Caldera". Chaos-hazard arena dominated by a RISING LAVA
  // pool that floods the arena on a cycle — the dominant clock. Players
  // scramble up as lava rises, drop back as it recedes. Physics boulders
  // tumble as extra chaos. ZERO pendulums.
  //
  // Rising-lava math (flood line):
  //   Pool center y=-3, h=3  →  base top = -3+1.5 = -1.5
  //   rise.height=7, period=11  →  flood crest = -1.5+7 = 5.5
  //   All spawns on surfaces > 5.8 (upper ledges y=8 surf=8.5, summit y=11 surf=11.5).
  //   Low pads (y=0) and mid ledges (y=4) FLOOD — risky weapon spots, no spawns.
  // ---------------------------------------------------------------------
  {
    id: 'volcano',
    name: 'Volcano',
    bgColor: 0x1e0608,
    killBound: { x: 18, y: 16 },
    tiles: [
      // ── LOW pads (y=0) — flood every cycle, risky weapon spots ──
      ...row(0, -15, -10, { material: 'stone', hp: 60, color: 0x3a1a10 }),
      ...row(0,  10,  15, { material: 'stone', hp: 60, color: 0x3a1a10 }),

      // ── MID ledges (y=4) — flood at peak, risky ──
      ...row(4, -12, -8, { material: 'stone', hp: 50, color: 0x2e1610 }),
      ...row(4,   8, 12, { material: 'stone', hp: 50, color: 0x2e1610 }),

      // ── UPPER ledges (y=8) — SAFE above flood crest 5.5 ──
      // Tile surface = 8.5 > 5.8 ✓ — first safe tier.
      ...row(8, -7, -4, { material: 'stone', hp: 50, color: 0x281410 }),
      ...row(8,  4,  7, { material: 'stone', hp: 50, color: 0x281410 }),

      // ── SUMMIT (y=11) — prize, most exposed ──
      ...row(11, -3, 3, { material: 'stone', hp: 80, color: 0x1a0c08 }),

      // ── DYNAMIC BOULDERS on upper rim — roll/tumble as chaos objects ──
      { x: -6, y: 8.6, shape: 'sphere', radius: 0.5,
        material: 'stone', hp: 30, color: 0x5a3a2a, dynamic: true, tileMass: 8 },
      { x:  6, y: 8.6, shape: 'sphere', radius: 0.5,
        material: 'stone', hp: 30, color: 0x5a3a2a, dynamic: true, tileMass: 8 },
      { x: -5, y: 8.6, shape: 'sphere', radius: 0.5,
        material: 'stone', hp: 30, color: 0x4a2a1a, dynamic: true, tileMass: 8 },
      { x:  5, y: 8.6, shape: 'sphere', radius: 0.5,
        material: 'stone', hp: 30, color: 0x4a2a1a, dynamic: true, tileMass: 8 },

      // ── Brittle glowing molten rocks — static cover on mid ledges ──
      { x: -9,  y: 5.0, shape: 'sphere', radius: 0.42, material: 'stone', hp: 18, color: 0xff4422 },
      { x:  9,  y: 5.0, shape: 'sphere', radius: 0.42, material: 'stone', hp: 18, color: 0xff4422 },
    ],
    hazards: [
      // ── THE CENTERPIECE: central rising-lava pool — the eruption clock ──
      // Base top at y=-1.5; flood crest at y=5.5 (drowns low+mid tiers).
      // Period 11 s: dwell ~2.5 s bottom, surge, dwell ~2.5 s top, recede.
      { kind: 'lava', x: 0, y: -3, w: 22, h: 3, dps: 70,
        rise: { height: 7, period: 11 } },

      // ── Kill plane far below ──
      { kind: 'lava', x: 0, y: -10, w: 50, h: 2.0, dps: 999 },

      // ── Summit rim spikes ──
      { kind: 'spike', x: -4, y: 12.5, w: 1.6 },
      { kind: 'spike', x:  4, y: 12.5, w: 1.6 },
    ],
    // ── Spawns — ALL on surfaces > 5.8 (above flood crest 5.5) ──
    //   Upper ledges y=8: surface = 8.5 > 5.8 ✓
    //   Summit y=11: surface = 11.5 > 5.8 ✓
    spawns: [
      { x: -6, y: 9 },   // upper left ledge (tile x:-7..-4, y=8, surface 8.5)
      { x:  6, y: 9 },   // upper right ledge (tile x:4..7, y=8, surface 8.5)
      { x: -5, y: 9 },   // upper left inner
      { x:  5, y: 9 },   // upper right inner
      { x: -2, y: 12 },  // summit left (tile x:-3..3, y=11, surface 11.5)
      { x:  2, y: 12 },  // summit right
      { x:  0, y: 12 },  // summit center
    ],
    weaponSpawns: [
      // Summit prize — most exposed king-of-the-hill reward.
      { x:  0, y: 12 },
      // Tempting mid-tier weapons — they flood at peak, grab fast!
      { x: -10, y: 1 }, { x: 10, y: 1 },   // low pads
      { x: -10, y: 5 }, { x: 10, y: 5 },   // mid ledges
      // Safe upper weapons.
      { x: -6, y: 9 }, { x: 6, y: 9 },
    ],
    background: [
      // Sky gradient — deep red/black.
      bg(0, 20, 60, 12, 0x3c0808, -14),
      bg(0, 10, 60,  8, 0x600e10, -14),
      bg(0,  3, 60,  6, 0x901820, -13),
      // Volcano silhouette cone.
      bg(0, 18, 20,  2.0, 0x180806, -10),
      bg(0, 16, 24,  2.0, 0x180806, -10),
      bg(0, 14, 28,  2.0, 0x180806, -10),
      bg(0, 12, 32,  2.0, 0x180806, -10),
      bg(0, 10, 36,  2.0, 0x180806, -10),
      bg(0,  8, 40,  2.0, 0x180806, -10),
      bg(0,  6, 44,  2.0, 0x180806, -10),
      // Crater glow.
      bgGlow(0, 18, 6,   1.4, 0xff6600, -9.5),
      bgGlow(0, 19, 3.5, 0.9, 0xffcc22, -9.4),
      bgGlow(0, 20, 2.0, 0.6, 0xffffff, -9.3),
      // Lava pool glow from below.
      bgGlow(0, -1, 22, 2.5, 0xdd3308, -11),
      // Side lava streams on the cone flanks.
      bgGlow(-8, 10, 0.9, 8, 0xff5511, -9.5),
      bgGlow( 8, 10, 0.9, 8, 0xff5511, -9.5),
      bgGlow(-5, 14, 0.7, 5, 0xff7722, -9.4),
      bgGlow( 5, 14, 0.7, 5, 0xff7722, -9.4),
      // Ember sparks floating up.
      bgGlow(-11, 17, 0.15, 0.15, 0xffaa44, -10.5),
      bgGlow(-4,  22, 0.15, 0.15, 0xffcc55, -10.5),
      bgGlow( 3,  19, 0.15, 0.15, 0xffaa44, -10.5),
      bgGlow( 9,  24, 0.15, 0.15, 0xffcc55, -10.5),
      bgGlow(-7,  25, 0.15, 0.15, 0xffaa44, -10.5),
      bgGlow( 6,  21, 0.15, 0.15, 0xff8833, -10.5),
      // Smoke plumes (dark spheres at high altitude).
      bgSphere(-3, 26, 2.2, 0x1a0a08, -12),
      bgSphere( 2, 29, 2.8, 0x120806, -12),
      bgSphere(-1, 32, 3.5, 0x0e0604, -12),
    ],
  },

  // ---------------------------------------------------------------------
  // SPACE STATION — orbital ring with low gravity. Asteroids serve as
  // platforms; planet/nebula in deep BG.
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // SPACE STATION — flat orbital ring layout (PLAYABLE).
  // The Mario-Galaxy planet redesign is committed but disabled until the
  // physics tuning is solid. Re-enable by switching this entry to the
  // planet config in Git history (commit ddae489) once gravity feel is
  // worked out; all the planet/meteor code in src/levels/space/ stays in
  // the tree dormant until the level def opts into `curvedGravity: true`.
  // ---------------------------------------------------------------------
  {
    id: 'space',
    name: 'Space Station',
    bgColor: 0x000010,
    gravity: -5.0,
    tiles: [
      ...row(0, -10, 10, { material: 'metal', hp: 100, color: 0x707888 }),
      ...row(-1, -8, 8, { material: 'metal', hp: 100, color: 0x4a5060 }),
      ...tough(-2, -6, 6, { color: 0x202830 }),
      // Side asteroid floats.
      ...row(3, -12, -9, { material: 'stone', hp: 30, color: 0x6a605a }),
      ...row(3,  9, 12, { material: 'stone', hp: 30, color: 0x6a605a }),
      // Mid station deck.
      ...row(6, -3, 3, { material: 'metal', hp: 50, color: 0x808898 }),
      // Upper asteroid floats — staggered.
      ...row(9, -8, -5, { material: 'stone', hp: 25, color: 0x6a605a }),
      ...row(9,  5,  8, { material: 'stone', hp: 25, color: 0x6a605a }),
      // Top dock.
      ...row(12, -2, 2, { material: 'metal', hp: 60, color: 0x90a0b0 }),
      // Solar-panel pillars.
      { x: -6, y: 1.5, shape: 'box', w: 0.4, h: 2.2, material: 'metal', hp: 80, color: 0x305080 },
      { x:  6, y: 1.5, shape: 'box', w: 0.4, h: 2.2, material: 'metal', hp: 80, color: 0x305080 },
      // Crystal asteroid mid prop.
      { x: 0, y: 4, shape: 'sphere', radius: 0.7, material: 'stone', hp: 50, color: 0x88aaff },
    ],
    hazards: [
      { kind: 'lava', x: 0, y: -6, w: 50, h: 1.4, dps: 999 },
      { kind: 'pendulum', x: 0, y: 16, length: 5, amplitude: Math.PI / 2.8, speed: 0.8 },
      { kind: 'spike', x: -7, y: 10.0, w: 1.6 },
      { kind: 'spike', x:  7, y: 10.0, w: 1.6 },
    ],
    spawns: [
      { x: -10, y: 1 }, { x: 10, y: 1 },
      { x: -10, y: 4 }, { x: 10, y: 4 },
      { x: 0, y: 7 },
      { x: 0, y: 13 },
    ],
    weaponSpawns: [
      { x: 0, y: 13 },                        // top dock prize
      { x: 0, y: 7 },
      { x: -10, y: 4 }, { x: 10, y: 4 },
      { x: -6, y: 10 }, { x: 6, y: 10 },
      { x: 0, y: 1 },
    ],
    background: [
      bgSphere(-18, 6, 7, 0x2a4a8a, -16, { emissive: 0x102040, emissiveIntensity: 0.3 }),
      bgDisc(-18, 6, 8, 0x4070cc, -16.2, { emissiveIntensity: 0.2 }),
      bgSphere(15, 18, 1.6, 0xa0a0a0, -15),
      bgGlow(-2, 22, 30, 1.5, 0x4d4080, -15),
      bgGlow(8,  19, 18, 1.0, 0x803060, -15),
      bgGlow(-6, 12, 22, 0.8, 0x5050a0, -15),
      ...(() => {
        const stars = [];
        const seeds = [
          [-22, 8], [-19, 16], [-15, 22], [-11, 9], [-7, 14], [-3, 21], [1, 11],
          [5, 18], [9, 23], [13, 9], [17, 14], [20, 20], [22, 11], [-25, 12],
          [-2, 7], [3, 25], [11, 7], [-13, 4], [16, 5], [-21, 25], [21, 4],
        ];
        for (const [x, y] of seeds) {
          stars.push(bgGlow(x, y, 0.18, 0.18, 0xffffff, -16));
        }
        return stars;
      })(),
      bg(12, 14, 1.4, 0.4, 0x808898, -14),
      bg(12, 14.6, 0.2, 0.8, 0x808898, -14),
      bgGlow(11.5, 14, 0.2, 0.2, 0xff4444, -13.9),
    ],
  },

  // ---------------------------------------------------------------------
  // PLANET TEST — 6-planet curved-gravity arena (DEV).
  // Two anchor planets (pullStrength 18) + four moons (pullStrength 10).
  // killBound x:30 y:25. Spawns placed one radius above each planet.
  // ---------------------------------------------------------------------
  {
    id: 'planettest',
    name: 'Orbit',
    bgColor: 0x0b0a1e,
    gravity: 0,
    curvedGravity: true,
    cameraClamp: { x: [-30, 30], y: [-25, 25], zoom: [12, 32] },
    killBound: { x: 24, y: 22 },
    meteorShower: { activateAfter: 20, interval: [6, 11], perShower: [1, 3] },
    planets: [
      { id: 'p1', cx:  0,   cy:  11,  radius: 3.5, mantleRadius: 2.1,  coreRadius: 1.12, pullStrength: 16, haloMul: 4.5, crustHp: 90, mantleHp: 80 },
      { id: 'p2', cx:  9.5, cy:  5.5, radius: 2.5, mantleRadius: 1.5,  coreRadius: 0.8,  pullStrength: 16, haloMul: 4.5, crustHp: 24, mantleHp: 30 },
      { id: 'p3', cx:  9.5, cy: -5.5, radius: 2.5, mantleRadius: 1.5,  coreRadius: 0.8,  pullStrength: 16, haloMul: 4.5, crustHp: 24, mantleHp: 30 },
      { id: 'p4', cx:  0,   cy: -11,  radius: 3.5, mantleRadius: 2.1,  coreRadius: 1.12, pullStrength: 16, haloMul: 4.5, crustHp: 90, mantleHp: 80 },
      { id: 'p5', cx: -9.5, cy: -5.5, radius: 2.5, mantleRadius: 1.5,  coreRadius: 0.8,  pullStrength: 16, haloMul: 4.5, crustHp: 24, mantleHp: 30 },
      { id: 'p6', cx: -9.5, cy:  5.5, radius: 2.5, mantleRadius: 1.5,  coreRadius: 0.8,  pullStrength: 16, haloMul: 4.5, crustHp: 24, mantleHp: 30 },
    ],
    tiles: [],
    hazards: [],
    spawns: [
      { x:   0,    y:  16.00 },  // above p1 (0,11) r3.5 dir(0,1)
      { x:  12.96, y:   7.50 },  // above p2 (9.5,5.5) r2.5 dir(0.865,0.501)
      { x:  12.96, y:  -7.50 },  // above p3 (9.5,-5.5) r2.5 dir(0.865,-0.501)
      { x:   0,    y: -16.00 },  // above p4 (0,-11) r3.5 dir(0,-1)
      { x: -12.96, y:  -7.50 },  // above p5 (-9.5,-5.5) r2.5 dir(-0.865,-0.501)
      { x: -12.96, y:   7.50 },  // above p6 (-9.5,5.5) r2.5 dir(-0.865,0.501)
    ],
    weaponSpawns: [
      { x:   0,    y:  16.00 },  // above p1
      { x:  12.96, y:   7.50 },  // above p2
      { x:  12.96, y:  -7.50 },  // above p3
      { x:   0,    y: -16.00 },  // above p4
      { x: -12.96, y:  -7.50 },  // above p5
      { x: -12.96, y:   7.50 },  // above p6
    ],
    background: [
      // Nebula wash — large soft glows give depth + contrast so dark weapons
      // and stickmen read against the starfield instead of vanishing on black.
      bgGlow(2, 2, 40, 30, 0x171232, -19),        // base indigo wash
      bgGlow(-12, 13, 28, 12, 0x2c1d58, -18),     // purple band
      bgGlow(13, -9, 26, 11, 0x123848, -18),      // teal band
      bgGlow(-15, -13, 18, 8, 0x3c1842, -17.5),   // magenta pocket
      bgGlow(16, 16, 16, 7, 0x1d2a5e, -17.5),     // blue pocket
      // Distant gas giant with a faint ring, upper-left.
      bgSphere(-23, 19, 3.4, 0x2a3a6a, -19, { emissive: 0x223058, emissiveIntensity: 0.4 }),
      bgDisc(-23, 19, 5.0, 0x3a4a8a, -18.9, { emissiveIntensity: 0.12 }),
      // Stars — varied size + slight colour twinkle for a richer field.
      ...(() => {
        const stars = [];
        const seeds = [
          [-22, 8, 0.20, 0xffffff], [-16, 18, 0.14, 0xbfd4ff], [-10, -16, 0.22, 0xffffff],
          [-4, 22, 0.12, 0xfff0c0], [4, -22, 0.18, 0xffffff], [10, 16, 0.16, 0xc8d8ff],
          [16, -8, 0.22, 0xffffff], [22, 12, 0.13, 0xffe0e8], [-26, -10, 0.18, 0xffffff],
          [26, -10, 0.15, 0xbfd4ff], [-20, 22, 0.12, 0xffffff], [20, 22, 0.20, 0xfff0c0],
          [0, 24, 0.16, 0xffffff], [0, -24, 0.14, 0xc8d8ff], [-24, 0, 0.22, 0xffffff],
          [24, 0, 0.18, 0xffffff], [-7, 5, 0.10, 0xffffff], [8, -3, 0.10, 0xbfd4ff],
          [-14, -4, 0.12, 0xffffff], [15, 5, 0.11, 0xffe0e8], [6, 9, 0.10, 0xffffff],
          [-18, 12, 0.13, 0xffffff], [18, -14, 0.12, 0xc8d8ff], [3, 17, 0.10, 0xffffff],
        ];
        for (const [x, y, s, c] of seeds) stars.push(bgGlow(x, y, s, s, c, -16.8));
        return stars;
      })(),
    ],
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
  // BOUNCE CASTLE — inflatable party castle. Twin pink towers, rainbow-
  // arched gateway, crenellated battlements, flag tips. Symmetric tier
  // stack inside. NO lava: pit of death via killBound. Yellow tiles are
  // trampoline pads (visual marker for the future stronger-bounce
  // material). Bouncy restitution lives in PhysicsWorld.js.
  // ---------------------------------------------------------------------
  ...(() => {
    const RAIN = [0xff5566, 0xff9944, 0xffdd44, 0x55cc66, 0x4488ee, 0xaa66dd];
    const WALL = 0xee88cc;
    const TRAMP = 0xffee44;
    const TIER = [0x66ddee, 0xff99cc, 0x99ee99, 0xffcc66];

    const castleFrame = () => {
      const t = [];
      // Twin tower walls (x = ±13), inflated bouncy castle pillars.
      for (let y = 0; y <= 18; y++) t.push({ x: -13, y, shape: 'box', w: 1.6, h: 1, material: 'bouncy', hp: 60, color: WALL });
      for (let y = 0; y <= 18; y++) t.push({ x:  13, y, shape: 'box', w: 1.6, h: 1, material: 'bouncy', hp: 60, color: WALL });
      // Crenellated tower tops (3 merlons each).
      for (const dx of [-1, 0, 1]) t.push({ x: -13 + dx * 0.6, y: 19.5, shape: 'box', w: 0.5, h: 0.7, material: 'bouncy', hp: 50, color: WALL });
      for (const dx of [-1, 0, 1]) t.push({ x:  13 + dx * 0.6, y: 19.5, shape: 'box', w: 0.5, h: 0.7, material: 'bouncy', hp: 50, color: WALL });
      // Outer flanking stub walls.
      t.push(...col(-15, 0, 5, { shape: 'box', w: 0.7, h: 1, material: 'bouncy', hp: 40, color: 0xffaaee }));
      t.push(...col( 15, 0, 5, { shape: 'box', w: 0.7, h: 1, material: 'bouncy', hp: 40, color: 0xffaaee }));
      // Ground floor with central gateway opening (x: -3..3 left clear).
      t.push(...row(0, -11, -4, { material: 'bouncy', hp: 40, color: TIER[0] }));
      t.push(...row(0,   4, 11, { material: 'bouncy', hp: 40, color: TIER[0] }));
      return t;
    };

    const castleBg = () => {
      const o = [];
      // Rainbow arch: 6 nested half-rings. Each disc gets a unique z (no
      // z-fight) — rendered outer red back, inner violet front.
      for (let i = 0; i < 6; i++) {
        const r = 7 - i * 0.65;
        o.push(bgDisc(0, 4, r, RAIN[i], -9.5 + i * 0.05, { emissive: RAIN[i], emissiveIntensity: 0.5 }));
      }
      // Sky-color mask disc carves the rings into a true arch (hides the
      // bottom half so they don't peek under the gateway floor).
      o.push(bgDisc(0, 1.0, 8.0, 0x180830, -9.18));
      // Sky panels (deep purple gradient).
      o.push(bg(0, 22, 50, 8, 0x2a1050, -11));
      o.push(bg(0, 12, 50, 12, 0x4818a0, -10.8));
      // Tower interior shading.
      o.push(bg(-13, 9, 1.6, 20, 0x5a1f4a, -8.5));
      o.push(bg( 13, 9, 1.6, 20, 0x5a1f4a, -8.5));
      // Flag poles + flags above tower tops.
      o.push(bg(-13, 22, 0.1, 4, 0xeeeeee, -7.5));
      o.push(bg( 13, 22, 0.1, 4, 0xeeeeee, -7.5));
      o.push(bg(-12, 23.5, 1.4, 1.0, 0xff4488, -7.4));
      o.push(bg( 14, 23.5, 1.4, 1.0, 0x44aaff, -7.4));
      // Spotlights along upper sky line.
      for (const x of [-10, -5, 0, 5, 10]) o.push(bgGlow(x, 22, 0.5, 0.5, 0xffeeaa, -8.5));
      // Confetti dots (deterministic — no Math.random at module init).
      const confetti = [
        [-12, 7], [-9, 14], [-6, 18], [-3, 9], [-1, 16], [2, 11],
        [4, 19], [7, 8], [10, 15], [12, 6], [-11, 12], [11, 20],
        [-7, 11], [3, 14], [8, 17], [-2, 6], [1, 21], [-10, 18],
        [9, 10], [-4, 17], [5, 12], [13, 9], [-13, 17], [0, 14],
      ];
      confetti.forEach(([cx, cy], i) => o.push(bgGlow(cx, cy, 0.18, 0.18, RAIN[i % 6], -7)));
      // Distant carnival tent silhouettes flanking the castle.
      o.push(bg(-22, 5, 4, 8, 0xee5566, -10.5));
      o.push(bg( 22, 5, 4, 8, 0x4488ee, -10.5));
      o.push(bgDisc(-22, 9, 2.4, 0xffeeaa, -10.4));
      o.push(bgDisc( 22, 9, 2.4, 0xffeeaa, -10.4));
      return o;
    };

    return [{
      id: 'bounce',
      name: 'Bounce Castle',
      bgColor: 0x180830,
      cameraClamp: { x: [-22, 22], y: [-8, 30], zoom: [12, 28] },
      killBound: { x: 24, y: 30 },
      tiles: [
        ...castleFrame(),
        // Tier 1 (y=4) — symmetric short bridges.
        ...row(4, -8, -5, { material: 'bouncy', hp: 30, color: TIER[1] }),
        ...row(4,  5,  8, { material: 'bouncy', hp: 30, color: TIER[1] }),
        // Tier 2 (y=8) — wider center bridge.
        ...row(8, -6,  6, { material: 'bouncy', hp: 30, color: TIER[2] }),
        // Tier 3 (y=12) — symmetric short bridges + center trampoline pad.
        ...row(12, -8, -5, { material: 'bouncy', hp: 30, color: TIER[3] }),
        ...row(12,  5,  8, { material: 'bouncy', hp: 30, color: TIER[3] }),
        { x: 0, y: 12, shape: 'box', w: 1.6, h: 0.6, material: 'bouncy', hp: 25, color: TRAMP },
        // Tier 4 (y=16) — narrow top bridge.
        ...row(16, -3, 3, { material: 'bouncy', hp: 25, color: 0xffffff }),
        // Bell prize sphere atop center.
        { x: 0, y: 18.2, shape: 'sphere', radius: 0.7, material: 'bouncy', hp: 30, color: 0xffffff },
      ],
      hazards: [],
      spawns: [
        { x: -9, y: 1 }, { x: 9, y: 1 },
        { x: -7, y: 5 }, { x: 7, y: 5 },
        { x:  0, y: 9 },
        { x:  0, y: 17 },
      ],
      weaponSpawns: [
        { x: 0, y: 18.5 },                   // bell prize
        { x: 0, y: 9 },
        { x: -7, y: 5 }, { x: 7, y: 5 },
        { x: -7, y: 13 }, { x: 7, y: 13 },
      ],
      background: castleBg(),
    }];
  })(),

  // ---------------------------------------------------------------------
  // PLANET TEST — single planet for tuning curved-gravity feel.
  // Once movement + gravity feel right here, scale up to multi-planet.
  // ---------------------------------------------------------------------
  {
    id: 'planettest_single',
    name: 'Planet Test (Single)',
    bgColor: 0x000008,
    gravity: 0,
    curvedGravity: true,
    cameraClamp: { x: [-30, 30], y: [-25, 25], zoom: [12, 30] },
    killBound: { x: 30, y: 25 },
    planets: [
      { id: 'p1', cx: 0, cy: 0, radius: 5.0, mantleRadius: 3.5, coreRadius: 1.6, mass: 40, pullStrength: 18 },
    ],
    tiles: [],
    hazards: [],
    spawns: [
      { x: 0, y: 6.5 },     // top
      { x: -6.5, y: 0 },    // left
      { x: 6.5, y: 0 },     // right
      { x: 0, y: -6.5 },    // bottom
    ],
    weaponSpawns: [
      { x: 0, y: 6.5 }, { x: -6.5, y: 0 }, { x: 6.5, y: 0 }, { x: 0, y: -6.5 },
    ],
    background: [
      bgGlow(-12, 14, 0.18, 0.18, 0xffffff, -16),
      bgGlow(8, 12, 0.18, 0.18, 0xffffff, -16),
      bgGlow(-8, -12, 0.18, 0.18, 0xeeeeff, -16),
      bgGlow(14, -8, 0.18, 0.18, 0xffffff, -16),
      bgGlow(-14, 4, 0.15, 0.15, 0xddddff, -16),
      bgGlow(11, -14, 0.15, 0.15, 0xffffff, -16),
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

  // ---------------------------------------------------------------------
  // CRYSTAL CAVERN — tall vertical cave. Bioluminescent crystal spire as
  // landmark. Every tile destructible (no bedrock); only lava is permanent.
  // Hazards: lava + icicles under wood platforms. ~2x the height of other
  // levels — requires the bumped Camera y-clamp from Task 1.
  // ---------------------------------------------------------------------
  {
    id: 'crystalcave',
    name: 'Crystal Cavern',
    bgColor: 0x0a1a28,
    tiles: [
      // Mossy floor (hp 60, sand-stone color w/ green tint).
      ...row(0, -12, 12, { material: 'stone', hp: 60, color: 0x5a6a58 }),
      // Tough subfloor — destructible but hp 200. Lava at y=-5 below.
      ...tough(-1, -12, 12, { color: 0x181820 }),
      ...tough(-2, -12, 12, { color: 0x181820 }),
      // Destructible wall columns left + right, full vertical extent.
      ...col(-13, 1, 17, { shape: 'box', w: 0.6, h: 1, material: 'stone', hp: 120, color: 0x384450 }),
      ...col( 13, 1, 17, { shape: 'box', w: 0.6, h: 1, material: 'stone', hp: 120, color: 0x384450 }),
      // ---- Tier platforms (left + right, alternating stone / wood) ----
      // Lower wraparound y=3 (stone, hp 60).
      ...row(3, -11, -7, { material: 'stone', hp: 60, color: 0x5a6a58 }),
      ...row(3,   7, 11, { material: 'stone', hp: 60, color: 0x5a6a58 }),
      // Lower wood y=6 (icicles below — see Task 5).
      ...row(6, -10, -7, { material: 'wood', hp: 18, color: 0x6a4020 }),
      ...row(6,   7, 10, { material: 'wood', hp: 18, color: 0x6a4020 }),
      // Mid stone left y=9.
      ...row(9, -11, -7, { material: 'stone', hp: 60, color: 0x5a6a58 }),
      // Mid wood right y=10.
      ...row(10, 7, 11, { material: 'wood', hp: 18, color: 0x6a4020 }),
      // Mid stone left y=13.
      ...row(13, -10, -7, { material: 'stone', hp: 60, color: 0x5a6a58 }),
      // Mid wood right y=14.
      ...row(14, 7, 11, { material: 'wood', hp: 18, color: 0x6a4020 }),
      // Upper stone left y=17.
      ...row(17, -9, -6, { material: 'stone', hp: 60, color: 0x5a6a58 }),
      // Upper chain wood right y=17. Chain anchored to invisible static point
      // at (9, 24); 5 segments hang the platform. Cutting any seg → platform
      // converts dynamic and falls (drop credit anyone standing on it).
      ...row(17, 7, 11, {
        material: 'wood', hp: 18, color: 0x6a4020,
        chainAnchor: { x: 9, y: 24, segs: 5, hp: 30 },
      }),
      // Top sanctum y=20 (durable prize platform).
      ...row(20, -5, 5, { material: 'stone', hp: 80, color: 0x6a7a68 }),
      // ---- Crystal spire centerpiece (segmented). Each main shard is split
      // into vertical sections via parentTileKey: the bottom section is a
      // normal static tile; each section above names the one below as its
      // parent. When a parent breaks, the engine cascade-converts every
      // child into a falling dynamic body via Level._dropSuspendedTile —
      // a tower-of-blocks collapse driven by real physics.
      //
      // Tile y is the CENTER of the box. Section bases align with the top of
      // the section below: section_n.y - h/2 == section_{n-1}.y + h/2.
      //
      // GAMEPLAY NOTE: the main cyan stack tops at y=18 and the tip-cyan cap
      // sits on top reaching y=22 — slightly above the y=20 sanctum. The
      // spire is an alternate climb path to the top in addition to the side
      // platform ladder. Smashing the base toppling the upper sections is
      // the intended highlight moment.
      //
      // KNOWN LIMITATION: shards with fractional y bypass the integer-grid
      // damageArea lookup, so explosion splash (grenade/RPG) only reaches
      // sections whose y is integer. Single-target attacks (bullets, melee,
      // throws) hit every section via Cannon collision callbacks.

      // Back magenta stack — h=15 split into 2 sections of h=7.5, tilted -6°.
      { x: -3, y: 3.75, shape: 'box', w: 2.4, h: 7.5, d: 2.0,
        material: 'stone', hp: 60, rotZ: -0.105,
        color: 0xb060d0, emissive: 0xb060d0, emissiveIntensity: 0.7 },
      { x: -3, y: 11.25, shape: 'box', w: 2.4, h: 7.5, d: 2.0,
        material: 'stone', hp: 60, rotZ: -0.105,
        parentTileKey: '-3,3.75',
        color: 0xb060d0, emissive: 0xb060d0, emissiveIntensity: 0.7 },

      // Main cyan stack — h=18 split into 3 sections of h=6, vertical.
      { x: 0, y: 3, shape: 'box', w: 3.0, h: 6.0, d: 2.4,
        material: 'stone', hp: 50,
        color: 0x5ec8e8, emissive: 0x5ec8e8, emissiveIntensity: 0.8 },
      { x: 0, y: 9, shape: 'box', w: 3.0, h: 6.0, d: 2.4,
        material: 'stone', hp: 50,
        parentTileKey: '0,3',
        color: 0x5ec8e8, emissive: 0x5ec8e8, emissiveIntensity: 0.8 },
      { x: 0, y: 15, shape: 'box', w: 3.0, h: 6.0, d: 2.4,
        material: 'stone', hp: 50,
        parentTileKey: '0,9',
        color: 0x5ec8e8, emissive: 0x5ec8e8, emissiveIntensity: 0.8 },

      // Right magenta stack — h=12 split into 2 sections of h=6, tilted +8°.
      { x: 3, y: 3, shape: 'box', w: 2.0, h: 6.0, d: 1.8,
        material: 'stone', hp: 55, rotZ: 0.140,
        color: 0xb060d0, emissive: 0xb060d0, emissiveIntensity: 0.7 },
      { x: 3, y: 9, shape: 'box', w: 2.0, h: 6.0, d: 1.8,
        material: 'stone', hp: 55, rotZ: 0.140,
        parentTileKey: '3,3',
        color: 0xb060d0, emissive: 0xb060d0, emissiveIntensity: 0.7 },

      // Front cyan stack — h=8 split into 2 sections of h=4, tilted +4°.
      { x: -1, y: 2, shape: 'box', w: 1.4, h: 4.0, d: 1.2,
        material: 'stone', hp: 25, rotZ: 0.070,
        color: 0x80c8e0, emissive: 0x80c8e0, emissiveIntensity: 0.7 },
      { x: -1, y: 6, shape: 'box', w: 1.4, h: 4.0, d: 1.2,
        material: 'stone', hp: 25, rotZ: 0.070,
        parentTileKey: '-1,2',
        color: 0x80c8e0, emissive: 0x80c8e0, emissiveIntensity: 0.7 },

      // Tip cyan — single piece, base y=18 (top of main cyan stack), top y=22.
      // Cascades when ANY main cyan section below it breaks (chain via parent).
      { x: 0, y: 20.0, shape: 'box', w: 1.4, h: 4.0, d: 1.2,
        material: 'stone', hp: 25,
        parentTileKey: '0,15',
        color: 0xc8f4ff, emissive: 0xc8f4ff, emissiveIntensity: 1.2 },
      // Yellow accent nub — short, brittle, breaks for spectacle.
      { x: 1, y: 1.0, shape: 'box', w: 1.0, h: 2.0, d: 0.8,
        material: 'stone', hp: 30,
        color: 0xe8c440, emissive: 0xe8c440, emissiveIntensity: 0.9 },
    ],
    hazards: [
      // Kill plane.
      { kind: 'lava', x: 0, y: -5, w: 36, h: 1.4, dps: 50 },
      // Icicles (pointDown spikes) hanging under each wood platform.
      // Light-blue color to read as crystal-frosted, not torch-orange.
      { kind: 'spike', x: -8.5, y: 5.5,  w: 2.4, pointDown: true, color: 0xa8c8d8 },  // under y=6 wood left
      { kind: 'spike', x:  8.5, y: 5.5,  w: 2.4, pointDown: true, color: 0xa8c8d8 },  // under y=6 wood right
      { kind: 'spike', x:  9,   y: 9.5,  w: 2.6, pointDown: true, color: 0xa8c8d8 },  // under y=10 wood right
      { kind: 'spike', x:  9,   y: 13.5, w: 2.6, pointDown: true, color: 0xa8c8d8 },  // under y=14 wood right
      { kind: 'spike', x:  9,   y: 16.5, w: 2.6, pointDown: true, color: 0xa8c8d8 },  // under y=17 chain wood right
    ],
    spawns: [
      // Lower floor.
      { x: -9, y: 1 }, { x: 9, y: 1 },
      // Lower wood (y=6).
      { x: -9, y: 7 }, { x: 9, y: 7 },
      // Mid (y=13 stone left, y=10 wood right).
      { x: -9, y: 14 }, { x: 9, y: 11 },
      // Top sanctum.
      { x: 0, y: 21 },
    ],
    weaponSpawns: [
      // Top sanctum prize.
      { x: 0, y: 21 },
      // Mid tier rewards.
      { x: -9, y: 14 }, { x: 9, y: 11 },
      // Contested center between lower wood pair.
      { x: 0, y: 7 },
      // Lower wraparound.
      { x: -9, y: 4 }, { x: 9, y: 4 },
    ],
    background: [
      // ---- Far gradient walls (z=-14): dark teal-black depth fade. ----
      bg(0, -2, 50, 8, 0x06101a, -14),
      bg(0,  6, 50, 10, 0x0a1a28, -14),
      bg(0, 14, 50, 8,  0x14283a, -14),
      bg(0, 22, 50, 8,  0x0a1a28, -14),

      // ---- Distant rock silhouette columns (z=-12). ----
      bg(-22, 8,  4, 28, 0x162028, -12),
      bg(-17, 6,  3, 22, 0x121c24, -12),
      bg(-11, 4,  2, 14, 0x0e1820, -12),
      bg( 11, 4,  2, 14, 0x0e1820, -12),
      bg( 17, 6,  3, 22, 0x121c24, -12),
      bg( 22, 8,  4, 28, 0x162028, -12),

      // ---- Cave shell — organic rock silhouettes flanking each wall (z=-11). ----
      // Stacked spheres of varying size to suggest curved cave wall recede.
      bgSphere(-15, 0,  2.0, 0x162028, -11),
      bgSphere(-15, 4,  1.7, 0x1a2632, -11),
      bgSphere(-16, 8,  2.2, 0x121c24, -11),
      bgSphere(-15, 12, 1.6, 0x162028, -11),
      bgSphere(-16, 16, 2.0, 0x1a2632, -11),
      bgSphere(-15, 20, 1.8, 0x121c24, -11),
      bgSphere( 15, 0,  2.0, 0x162028, -11),
      bgSphere( 15, 4,  1.7, 0x1a2632, -11),
      bgSphere( 16, 8,  2.2, 0x121c24, -11),
      bgSphere( 15, 12, 1.6, 0x162028, -11),
      bgSphere( 16, 16, 2.0, 0x1a2632, -11),
      bgSphere( 15, 20, 1.8, 0x121c24, -11),

      // ---- Stalactite teeth at ceiling (z=-10). Stretched dark spheres
      // hanging from y=24 — they read as drips/teeth poking down. ----
      bgSphere(-10, 23, 0.5, 0x2a3640, -10),
      bgSphere(-7,  23, 0.6, 0x2a3640, -10),
      bgSphere(-4,  23, 0.5, 0x2a3640, -10),
      bgSphere( 0,  23, 0.7, 0x2a3640, -10),
      bgSphere( 4,  23, 0.5, 0x2a3640, -10),
      bgSphere( 7,  23, 0.6, 0x2a3640, -10),
      bgSphere( 10, 23, 0.5, 0x2a3640, -10),

      // ---- Wall vein glow strips (z=-10). Cyan left, magenta right.
      // Doubled count + offset x for a snaking vein read. ----
      bgGlow(-12, 4,  0.4, 5, 0x5ee0ff, -10),
      bgGlow(-11.4, 8,  0.3, 3, 0x5ee0ff, -10),
      bgGlow(-12, 12, 0.4, 5, 0x5ee0ff, -10),
      bgGlow(-11.6, 16, 0.3, 2.5, 0x5ee0ff, -10),
      bgGlow(-12, 19, 0.4, 4, 0x5ee0ff, -10),
      bgGlow( 12, 4,  0.4, 5, 0xd878ff, -10),
      bgGlow( 11.4, 8,  0.3, 3, 0xd878ff, -10),
      bgGlow( 12, 12, 0.4, 5, 0xd878ff, -10),
      bgGlow( 11.6, 16, 0.3, 2.5, 0xd878ff, -10),
      bgGlow( 12, 19, 0.4, 4, 0xd878ff, -10),

      // ---- Bioluminescent mushroom dots scattered on bg (z=-9). ----
      bgDisc(-10, 2,  0.25, 0x5ee0ff, -9, { emissiveIntensity: 1.4 }),
      bgDisc(-7,  2,  0.18, 0xd878ff, -9, { emissiveIntensity: 1.2 }),
      bgDisc(-4,  2,  0.22, 0xffd070, -9, { emissiveIntensity: 1.0 }),
      bgDisc( 4,  2,  0.22, 0x5ee0ff, -9, { emissiveIntensity: 1.4 }),
      bgDisc( 7,  2,  0.18, 0xd878ff, -9, { emissiveIntensity: 1.2 }),
      bgDisc( 10, 2,  0.25, 0xffd070, -9, { emissiveIntensity: 1.0 }),
      bgDisc(-9,  9,  0.20, 0x5ee0ff, -9, { emissiveIntensity: 1.2 }),
      bgDisc( 9,  10, 0.20, 0xd878ff, -9, { emissiveIntensity: 1.2 }),
      bgDisc(-7,  16, 0.18, 0xffd070, -9, { emissiveIntensity: 1.0 }),
      bgDisc( 7,  16, 0.18, 0x5ee0ff, -9, { emissiveIntensity: 1.2 }),

      // ---- Cyan ambient halo behind the spire (z=-9.5). Larger to match
      // the now full-height spire centerpiece. ----
      bgDisc(0, 10, 8.0, 0x5ee0ff, -9.5, { emissiveIntensity: 0.5 }),

      // ---- Foreground glowing mushrooms on platform tops (z=-1). Small
      // emissive discs sitting just above platform tiles — visual moss/fungi
      // accents matching the mockup. ----
      // Floor (y=0 → discs at y=0.6).
      bgDisc(-9, 0.6, 0.18, 0x5ee0ff, -1, { emissiveIntensity: 1.6 }),
      bgDisc(-7, 0.6, 0.14, 0xffd070, -1, { emissiveIntensity: 1.4 }),
      bgDisc(-5, 0.6, 0.16, 0xd878ff, -1, { emissiveIntensity: 1.5 }),
      bgDisc( 5, 0.6, 0.16, 0x5ee0ff, -1, { emissiveIntensity: 1.6 }),
      bgDisc( 7, 0.6, 0.14, 0xffd070, -1, { emissiveIntensity: 1.4 }),
      bgDisc( 9, 0.6, 0.18, 0xd878ff, -1, { emissiveIntensity: 1.5 }),
      // Tier y=3 stone platforms.
      bgDisc(-9, 3.6, 0.14, 0xffd070, -1, { emissiveIntensity: 1.4 }),
      bgDisc( 9, 3.6, 0.14, 0x5ee0ff, -1, { emissiveIntensity: 1.4 }),
      // Tier y=9 stone left.
      bgDisc(-9, 9.6, 0.14, 0xd878ff, -1, { emissiveIntensity: 1.4 }),
      // Tier y=13 stone left.
      bgDisc(-9, 13.6, 0.14, 0x5ee0ff, -1, { emissiveIntensity: 1.4 }),
      // Tier y=17 stone left.
      bgDisc(-7, 17.6, 0.14, 0xffd070, -1, { emissiveIntensity: 1.4 }),
      // Top sanctum (y=20).
      bgDisc(-3, 20.7, 0.18, 0x5ee0ff, -1, { emissiveIntensity: 1.6 }),
      bgDisc( 0, 20.7, 0.14, 0xffd070, -1, { emissiveIntensity: 1.4 }),
      bgDisc( 3, 20.7, 0.18, 0xd878ff, -1, { emissiveIntensity: 1.6 }),

      // ---- Mossy strip along floor + each stone tier top (z=-0.8). Thin
      // emissive-green band on top edge of stone platforms. ----
      bgGlow(0,  0.55, 24, 0.1, 0x3a8060, -0.8),
      bgGlow(-9, 3.55, 5,  0.08, 0x3a8060, -0.8),
      bgGlow( 9, 3.55, 5,  0.08, 0x3a8060, -0.8),
      bgGlow(-9, 9.55, 5,  0.08, 0x3a8060, -0.8),
      bgGlow(-9, 13.55, 4, 0.08, 0x3a8060, -0.8),
      bgGlow(-7, 17.55, 4, 0.08, 0x3a8060, -0.8),
      bgGlow(0,  20.6, 11, 0.1, 0x3a8060, -0.8),

      // ---- Foreground mist patches (z=-8). Low-alpha cyan ovals. ----
      bg(0, 0,  20, 0.6, 0x1a3848, -8),
      bg(0, 8,  16, 0.5, 0x1a3848, -8),
      bg(0, 15, 14, 0.4, 0x1a3848, -8),
    ],
  },
];

export function getLevel(id) { return LEVELS.find(l => l.id === id) ?? LEVELS[0]; }
