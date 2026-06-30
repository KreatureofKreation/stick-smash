import { test } from 'node:test';
import assert from 'node:assert/strict';
import { killVerb, KILL_VERBS } from '../src/weapons/killVerbs.js';

test('killVerb returns the mapped verb for known weapons', () => {
  assert.equal(killVerb('sword'), 'sliced');
  assert.equal(killVerb('nuke'), 'NUKED');
  assert.equal(killVerb('saber'), 'lightsabered');
});

test('killVerb defaults to KO\'d for unknown / missing tags', () => {
  assert.equal(killVerb('does-not-exist'), "KO'd");
  assert.equal(killVerb(undefined), "KO'd");
  assert.equal(killVerb(null), "KO'd");
});

test('KILL_VERBS values are all non-empty strings', () => {
  for (const [k, v] of Object.entries(KILL_VERBS)) {
    assert.equal(typeof v, 'string', `${k} verb is not a string`);
    assert.ok(v.length > 0, `${k} verb is empty`);
  }
});
