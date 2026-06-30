import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, lerp, invLerp, remap, sign, damp, angDelta, lerpAng, dist2, TAU,
} from '../src/util/math.js';

test('clamp bounds a value to [lo, hi]', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('lerp / invLerp are inverses', () => {
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(invLerp(0, 10, 5), 0.5);
  assert.equal(invLerp(0, 10, lerp(0, 10, 0.3)), 0.3);
});

test('remap maps across ranges', () => {
  assert.equal(remap(5, 0, 10, 0, 100), 50);
  assert.equal(remap(0, 0, 10, -1, 1), -1);
});

test('sign returns -1 / 0 / 1', () => {
  assert.equal(sign(-3), -1);
  assert.equal(sign(0), 0);
  assert.equal(sign(2), 1);
});

test('damp is frame-rate independent: full step reaches target', () => {
  // With dt=1 and smoothing s, lerp factor is 1 - s. Converges toward b.
  const a = damp(0, 100, 0.01, 1);
  assert.ok(a > 98 && a <= 100, `expected near 100, got ${a}`);
});

test('angDelta returns shortest signed angle', () => {
  assert.ok(Math.abs(angDelta(0, 0.1) - 0.1) < 1e-9);
  // Wrapping past π takes the short way round (negative).
  assert.ok(angDelta(0, TAU - 0.1) < 0);
});

test('lerpAng interpolates the short way across the wrap', () => {
  const mid = lerpAng(0.1, TAU - 0.1, 0.5);
  // Midpoint should be near 0 (crossing the seam), not near π.
  assert.ok(Math.abs(angDelta(0, mid)) < 0.05, `got ${mid}`);
});

test('dist2 is squared euclidean distance', () => {
  assert.equal(dist2(0, 0, 3, 4), 25);
});
