import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGameOver } from '../../src/match/outcome.js';

// Player stand-ins. `state: 'dead'` matches Stickman STATE.DEAD.
const P = (lives, state = 'active', name = 'P') => ({ lives, state, name });
const isDead = (p) => p.state === 'dead';
const ev = (players, locals) => evaluateGameOver(players, locals, isDead);

test('no local players → match not evaluated (null)', () => {
  assert.equal(ev([P(1), P(1)], []), null);
  assert.equal(ev([P(1)], null), null);
});

test('solo: KO the instant P1 is out of lives and dead', () => {
  const p1 = P(0, 'dead');
  assert.deepEqual(ev([p1, P(1)], [p1]), { reason: 'ko', winner: null });
});

test('solo: still in the fight (alive, or dead with lives left) → not over', () => {
  const alive = P(2, 'active'), other = P(1);
  assert.equal(ev([alive, other], [alive]), null);
  const midRespawn = P(2, 'dead'); // dead but lives remain → still in
  assert.equal(ev([midRespawn, other], [midRespawn]), null);
});

test('solo death with bots still alive → KO (solo exit, not a bot victory)', () => {
  const me = P(0, 'dead', 'me');
  const bot = P(2, 'active', 'bot');
  assert.deepEqual(ev([me, bot], [me]), { reason: 'ko', winner: null });
});

test('single alive fighter, none eliminated yet → not over (totalEverIn<=1)', () => {
  const solo = P(1, 'active');
  assert.equal(ev([solo], [solo]), null);
  assert.equal(ev([solo, null, null], [solo]), null);
});

test('draw: 2+ locals all out simultaneously', () => {
  const a = P(0, 'dead'), b = P(0, 'dead');
  assert.deepEqual(ev([a, b], [a, b]), { reason: 'draw', winner: null });
});

test('victory: the surviving local is the winner', () => {
  const winner = P(1, 'active', 'Bolt');
  const loser = P(0, 'dead');
  assert.deepEqual(ev([winner, loser], [winner]), { reason: 'victory', winner });
});

test('victory for a non-local winner when all locals are out (local-MP)', () => {
  const l1 = P(0, 'dead'), l2 = P(0, 'dead');
  const bot = P(2, 'active', 'bot');
  const res = ev([l1, l2, bot], [l1, l2]);
  assert.equal(res.reason, 'victory');
  assert.equal(res.winner, bot);
});

test('ongoing: two or more fighters still have lives → null', () => {
  assert.equal(ev([P(1), P(2), P(0, 'dead')], [P(1)]), null);
});

test('local-MP (>1 local): solo KO branch is skipped, normal rules apply', () => {
  // Two locals, one bot. One local out, others alive → still ongoing.
  const l1 = P(0, 'dead'), l2 = P(1), bot = P(1);
  assert.equal(ev([l1, l2, bot], [l1, l2]), null);
  // Both locals out, bot alive → bot victory.
  const res = ev([P(0, 'dead'), P(0, 'dead'), bot], [P(0, 'dead'), P(0, 'dead')]);
  assert.equal(res.reason, 'victory');
});

test('null player slots are ignored in the tallies', () => {
  const winner = P(1);
  assert.deepEqual(ev([null, winner, P(0, 'dead'), null], [winner]), { reason: 'victory', winner });
});
