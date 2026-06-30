import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Countdown } from '../../src/match/Countdown.js';

// Fake timer pair: records scheduled + cleared ids and can "fire" by delay.
function fakeTimers() {
  let nextId = 1;
  const scheduled = new Map(); // id -> { delay, fn }
  const cleared = [];
  return {
    set(fn, delay) { const id = nextId++; scheduled.set(id, { delay, fn }); return id; },
    clear(id) { cleared.push(id); scheduled.delete(id); },
    scheduled, cleared,
    fireAll() { for (const { fn } of [...scheduled.values()]) fn(); },
  };
}

const steps = (log) => [
  { delay: 700, fn: () => log.push('2') },
  { delay: 1400, fn: () => log.push('1') },
  { delay: 2100, fn: () => log.push('FIGHT') },
];

test('start schedules every step at its delay', () => {
  const t = fakeTimers();
  const cd = new Countdown(t);
  cd.start(steps([]));
  assert.equal(cd.pending, 3);
  assert.deepEqual([...t.scheduled.values()].map(s => s.delay), [700, 1400, 2100]);
});

test('cancel clears all pending timers', () => {
  const t = fakeTimers();
  const cd = new Countdown(t);
  cd.start(steps([]));
  cd.cancel();
  assert.equal(cd.pending, 0);
  assert.equal(t.cleared.length, 3);
});

test('start cancels a still-pending sequence first (double-countdown guard)', () => {
  const t = fakeTimers();
  const cd = new Countdown(t);
  cd.start(steps([])); // ids 1,2,3
  cd.start(steps([])); // must clear 1,2,3, then schedule 4,5,6
  assert.deepEqual(t.cleared, [1, 2, 3], 'first sequence cancelled');
  assert.equal(cd.pending, 3, 'only the second sequence is live');
  assert.equal(t.scheduled.size, 3);
});

test('only the live sequence fires after a restart (no double messages)', () => {
  const t = fakeTimers();
  const cd = new Countdown(t);
  const log = [];
  cd.start(steps(log));
  cd.start(steps(log)); // restart before any fired
  t.fireAll();
  assert.deepEqual(log, ['2', '1', 'FIGHT'], 'exactly one countdown ran');
});

test('cancel with nothing scheduled is a no-op', () => {
  const t = fakeTimers();
  const cd = new Countdown(t);
  cd.cancel();
  assert.equal(cd.pending, 0);
  assert.equal(t.cleared.length, 0);
});
