// Spawn-safety math — pure, no Three/cannon imports so it can be unit-tested
// headless. Extracted from Game.js, which now delegates here. A "world" is a
// plain snapshot of the bits these functions need:
//
//   { tiles, hazards, killBound }
//
//   tiles     — Map keyed "gx,gy" (or any object with .has(key)/.keys()), or null
//   hazards   — array of { kind, x, y, w, h, body? }, or undefined
//   killBound — { x } horizontal play-area half-extent, or undefined
//
// All randomness is injected via `rng` (defaults to Math.random) so tests can
// make results deterministic.

// Player capsule dimensions (must match Stickman's BODY_RADIUS / BODY_HEIGHT).
export const SPAWN_RADIUS = 0.32;
export const SPAWN_HALF_H = 0.75;

// Walk down the tile grid from (x, y); return true if a tile is hit within
// `maxDrop` units. Scans the spawn column and ±1 since the capsule has width
// and may straddle a column boundary. No tiles at all = treat as ground
// everywhere (open/curved levels).
export function hasGroundBelow(world, x, y, maxDrop = 14) {
  const tiles = world?.tiles;
  if (!tiles) return true;
  const startGy = Math.floor(y - SPAWN_HALF_H); // bottom of capsule
  for (let dx = -1; dx <= 1; dx++) {
    const gx = Math.round(x) + dx;
    for (let dy = 0; dy <= maxDrop; dy++) {
      if (tiles.has(`${gx},${startGy - dy}`)) return true;
    }
  }
  return false;
}

// Returns true if the player capsule fits at this spawn without overlapping any
// integer-grid tile or static hazard, and has solid ground within a reasonable
// drop. Does not catch off-grid sphere/cylinder tiles or dynamic crates.
export function isSpawnClear(world, sp) {
  if (!world) return true;
  const radius = SPAWN_RADIUS;
  const halfH = SPAWN_HALF_H;

  // 1. Reject only if the capsule penetrates a tile by more than the stand-on
  //    slop (0.3 units). Rejecting ANY AABB overlap falsely kills every spawn
  //    point that sits ON TOP of a platform (small intended overlap between
  //    capsule bottom and tile top).
  const tiles = world.tiles;
  if (tiles) {
    const x0 = Math.floor(sp.x - radius);
    const x1 = Math.floor(sp.x + radius);
    const y0 = Math.floor(sp.y - halfH - 0.1);
    const y1 = Math.floor(sp.y + halfH + 0.1);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        if (!tiles.has(`${gx},${gy}`)) continue;
        const tileTop = gy + 0.5;
        const tileBot = gy - 0.5;
        const capBot = sp.y - halfH;
        const capTop = sp.y + halfH;
        if (capTop <= tileBot || capBot >= tileTop) continue; // no overlap
        // capsule bottom more than 0.3 inside tile = real interpenetration
        if (capBot < tileTop - 0.3) return false;
      }
    }
  }

  // 2. Reject if a static hazard's trigger volume overlaps the capsule. Skips
  //    kinetic hazards (saw, pendulum) since they move.
  for (const h of world.hazards ?? []) {
    if (h.kind !== 'lava' && h.kind !== 'spike') continue;
    const hx = h.body?.position?.x ?? h.x;
    const hy = h.body?.position?.y ?? h.y;
    const hw = (h.w ?? 1) / 2 + radius;
    const hh = (h.h ?? 0.4) / 2 + halfH;
    if (Math.abs(sp.x - hx) < hw && Math.abs(sp.y - hy) < hh) return false;
  }

  // 3. Require solid ground within a reasonable drop. Spawns on top of
  //    destroyed tile columns pass checks 1+2 but drop into the void.
  if (!hasGroundBelow(world, sp.x, sp.y, 14)) return false;
  return true;
}

// Step the spawn upward in 0.5-unit increments until it's clear OR we exceed
// the step budget. Worst-case fallback: the original sp.
export function liftSpawnClear(world, sp) {
  let cur = { x: sp.x, y: sp.y };
  for (let i = 0; i < 20; i++) {
    if (isSpawnClear(world, cur)) return cur;
    cur = { x: cur.x, y: cur.y + 0.5 };
  }
  return sp;
}

// Pick an x for a sky drop that (a) stays within the map's playable x-range and
// (b) has solid ground below. Tries a few jittered candidates near `refX`; if
// none have ground, scans outward for the nearest column that still does.
export function safeDropX(world, refX, rng = Math.random) {
  let minX = -Infinity, maxX = Infinity;
  if (world?.killBound) {
    minX = -world.killBound.x + 1;
    maxX = world.killBound.x - 1;
  } else if (world?.tiles) {
    let lo = Infinity, hi = -Infinity;
    for (const key of world.tiles.keys()) {
      const gx = parseInt(key, 10);
      if (gx < lo) lo = gx;
      if (gx > hi) hi = gx;
    }
    if (isFinite(lo)) { minX = lo + 1; maxX = hi - 1; }
  }
  const clamp = (v) => Math.max(minX, Math.min(maxX, v));
  for (let i = 0; i < 8; i++) {
    const x = clamp(refX + (rng() * 16 - 8)); // rand(-8, 8)
    if (hasGroundBelow(world, x, 16, 20)) return x;
  }
  // Scan outward from refX for first column that has ground.
  const start = Math.round(clamp(refX));
  const range = Math.ceil(Math.max(start - minX, maxX - start));
  for (let d = 0; d <= range; d++) {
    for (const dir of [-1, 1]) {
      const x = start + d * dir;
      if (x < minX || x > maxX) continue;
      if (hasGroundBelow(world, x, 16, 20)) return x;
    }
  }
  return clamp(refX);
}

// Pick spawn point farthest from existing live players AND clear of geometry.
// `livePositions` is an array of { x, y }. Returns a spawn point { x, y }.
export function pickSpawn(world, spawnPoints, livePositions = [], rng = Math.random) {
  const points = (spawnPoints && spawnPoints.length) ? spawnPoints : [{ x: 0, y: 5 }];
  const scored = points.map(sp => {
    let minD = Infinity;
    for (const p of livePositions) {
      const dx = sp.x - p.x, dy = sp.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD) minD = d2;
    }
    if (!livePositions.length) minD = 100;
    return { sp, score: minD + rng() * 0.5, clear: isSpawnClear(world, sp) };
  });
  scored.sort((a, b) => b.score - a.score);
  for (const s of scored) {
    if (s.clear) return s.sp;
  }
  // Every spawn blocked — lift the highest-scoring one above the obstruction.
  return liftSpawnClear(world, scored[0].sp);
}
