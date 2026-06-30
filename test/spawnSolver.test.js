import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasGroundBelow, isSpawnClear, liftSpawnClear, safeDropX, pickSpawn,
  SPAWN_RADIUS, SPAWN_HALF_H,
} from '../src/levels/spawnSolver.js';

// Build a tile world from a list of "gx,gy" keys.
function world(keys = [], extra = {}) {
  return { tiles: new Set(keys), hazards: extra.hazards, killBound: extra.killBound };
}
// Deterministic RNG so jitter-dependent results are stable in tests.
const fixedRng = (v) => () => v;

test('hasGroundBelow: no tiles → always grounded (open/curved levels)', () => {
  assert.equal(hasGroundBelow(null, 0, 5), true);
  assert.equal(hasGroundBelow({ tiles: null }, 0, 5), true);
});

test('hasGroundBelow: finds a floor tile within maxDrop', () => {
  // floor tile at gy=0; spawn capsule bottom at y - 0.75.
  const w = world(['0,0']);
  assert.equal(hasGroundBelow(w, 0, 2, 14), true);
  // too far up to reach within maxDrop
  assert.equal(hasGroundBelow(w, 0, 20, 5), false);
});

test('hasGroundBelow: scans ±1 column for capsule width', () => {
  const w = world(['1,0']); // ground only in the +1 column
  assert.equal(hasGroundBelow(w, 0, 1, 14), true);
  // 3 columns away → not scanned
  assert.equal(hasGroundBelow(world(['3,0']), 0, 1, 14), false);
});

test('isSpawnClear: null world is always clear', () => {
  assert.equal(isSpawnClear(null, { x: 0, y: 0 }), true);
});

test('isSpawnClear: rejects deep interpenetration with a tile', () => {
  // Tile occupies gy=0 (spans y -0.5..0.5). Spawn centered at y=0 buries the
  // capsule bottom (-0.75) well past the 0.3 slop → blocked.
  assert.equal(isSpawnClear(world(['0,0']), { x: 0, y: 0 }), false);
});

test('isSpawnClear: allows standing ON TOP of a platform (the Gauntlet bug)', () => {
  // Capsule bottom rests right at the tile top — small intended overlap, not
  // interpenetration. Must be accepted, and there is ground below.
  const sp = { x: 0, y: 0.5 + SPAWN_HALF_H }; // bottom == tile top (0.5)
  assert.equal(isSpawnClear(world(['0,0']), sp), true);
});

test('isSpawnClear: rejects a spawn sitting in a lava/spike hazard', () => {
  const w = world(['0,-2'], { hazards: [{ kind: 'lava', x: 0, y: 5, w: 4, h: 1 }] });
  assert.equal(isSpawnClear(w, { x: 0, y: 5 }), false);
});

test('isSpawnClear: ignores kinetic hazards (saw/pendulum)', () => {
  const w = world(['0,-2'], { hazards: [{ kind: 'saw', x: 0, y: 5, w: 4, h: 1 }] });
  // saw is not lava/spike, so it does not block; ground exists below → clear.
  assert.equal(isSpawnClear(w, { x: 0, y: 5 }), true);
});

test('isSpawnClear: reads moving-hazard position from body when present', () => {
  const w = world(['0,-2'], { hazards: [{ kind: 'spike', body: { position: { x: 0, y: 5 } }, w: 4, h: 1 }] });
  assert.equal(isSpawnClear(w, { x: 0, y: 5 }), false);
});

test('isSpawnClear: rejects a spawn over a destroyed column (void)', () => {
  // No tiles anywhere below the spawn → would fall into the void.
  const w = world(['50,0']); // ground exists, but far away
  assert.equal(isSpawnClear(w, { x: 0, y: 5 }), false);
});

test('liftSpawnClear: raises a buried spawn until it clears', () => {
  const w = world(['0,-2']); // ground at gy=-2 so lifted point still has ground
  const lifted = liftSpawnClear(w, { x: 0, y: -2 }); // start buried in the tile
  assert.ok(lifted.y > -2, 'spawn should be lifted upward');
  assert.equal(isSpawnClear(w, lifted), true);
});

test('liftSpawnClear: falls back to original sp when nothing clears', () => {
  // No ground anywhere → every lifted candidate fails check 3, returns input.
  const w = world([]);
  const sp = { x: 0, y: 0 };
  assert.equal(liftSpawnClear(w, sp), sp);
});

test('safeDropX: clamps to killBound play area', () => {
  // No tiles → hasGroundBelow always true, so first jittered candidate returns.
  const w = world([], { killBound: { x: 10 } });
  const x = safeDropX(w, 100, fixedRng(0.5)); // jitter 0 → refX clamped
  assert.ok(x >= -9 && x <= 9, `expected within [-9,9], got ${x}`);
});

test('safeDropX: scans outward to a column that has ground', () => {
  // Ground only at column 5; refX 0. Jitter is 0 (rng 0.5), so all 8 tries land
  // on x=0 with no ground, forcing the outward scan. The scan stops at x=4 —
  // the nearest column whose ±1-width ground check reaches the tile at col 5.
  const w = world(['5,0'], { killBound: { x: 20 } });
  const x = safeDropX(w, 0, fixedRng(0.5));
  assert.equal(x, 4);
  assert.equal(hasGroundBelow(w, x, 16, 20), true);
});

test('pickSpawn: with no players, returns a clear point', () => {
  const w = world(['0,-2', '8,-2']);
  const points = [{ x: 0, y: 0 }, { x: 8, y: 0 }];
  const sp = pickSpawn(w, points, [], fixedRng(0));
  assert.ok(points.includes(sp));
  assert.equal(isSpawnClear(w, sp), true);
});

test('pickSpawn: prefers the point farthest from live players', () => {
  const w = world(['0,-2', '20,-2']);
  const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }];
  // A live player sits on top of point 0 → solver should pick point 20.
  const sp = pickSpawn(w, points, [{ x: 0, y: 0 }], fixedRng(0));
  assert.equal(sp.x, 20);
});

test('pickSpawn: empty spawn list falls back to default and does not crash', () => {
  const sp = pickSpawn(null, [], [], fixedRng(0));
  assert.deepEqual(sp, { x: 0, y: 5 });
});

test('capsule constants match Stickman body', () => {
  assert.equal(SPAWN_RADIUS, 0.32);
  assert.equal(SPAWN_HALF_H, 0.75);
});
