import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWeighted } from '../src/weapons/spawnPick.js';

// Synthetic table — no weapon classes needed, so this stays dependency-free.
const TABLE = [
  { id: 'a', w: 1, cls: 'A' },
  { id: 'b', w: 3, cls: 'B' },
  { id: 'c', w: 6, cls: 'C' }, // total weight 10
];

test('pickWeighted: r in a weight band returns that entry', () => {
  // total = 10. Bands: A=[0,1), B=[1,4), C=[4,10).
  assert.equal(pickWeighted(TABLE, [], () => 0.0), 'A');   // r=0 → A
  assert.equal(pickWeighted(TABLE, [], () => 0.2), 'B');   // r=2 → B
  assert.equal(pickWeighted(TABLE, [], () => 0.9), 'C');   // r=9 → C
});

test('pickWeighted: disabled ids are filtered before weighting', () => {
  // With A,B disabled only C remains → always C regardless of rng.
  assert.equal(pickWeighted(TABLE, ['a', 'b'], () => 0.0), 'C');
  assert.equal(pickWeighted(TABLE, new Set(['a', 'b']), () => 0.99), 'C');
});

test('pickWeighted: weights recompute against the filtered pool', () => {
  // Disable C (w6). Remaining A(1)+B(3)=4. Bands: A=[0,1), B=[1,4).
  assert.equal(pickWeighted(TABLE, ['c'], () => 0.1), 'A');  // r=0.4 → A
  assert.equal(pickWeighted(TABLE, ['c'], () => 0.5), 'B');  // r=2.0 → B
});

test('pickWeighted: empty pool returns the fallback', () => {
  assert.equal(pickWeighted(TABLE, ['a', 'b', 'c'], Math.random, 'FALLBACK'), 'FALLBACK');
  assert.equal(pickWeighted([], [], Math.random, 'FALLBACK'), 'FALLBACK');
});

test('pickWeighted: r at the very top of the range still resolves', () => {
  // rng()=~1 → r just under total; must land on the last band, never undefined.
  const got = pickWeighted(TABLE, [], () => 0.999999);
  assert.equal(got, 'C');
});

test('pickWeighted: accepts a Set or an array for disabled', () => {
  assert.equal(pickWeighted(TABLE, undefined, () => 0), 'A'); // no disabled → ok
});
