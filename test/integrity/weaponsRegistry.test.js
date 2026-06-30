// Module-integrity test for the weapon registries. Imports the REAL
// weapons.js graph under stubbed Three/cannon so it runs headless, then
// asserts every registry entry resolves to a constructor. This is the safety
// net for splitting weapons.js into category files: if a class fails to move
// or an import goes missing, a registry entry becomes undefined and this fails
// — something node --check (parse-only) cannot catch. It also guards every
// future weapon you add to a SPAWN_TABLE / WEAPON_CLASSES.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Browser globals touched at module-load time (the Audio singleton wires up
// listeners in its constructor). Stub before importing the graph.
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};

// Remap bare `three` / `cannon-es` to local stubs for this process.
register('./stubs/resolver.mjs', import.meta.url);

const weapons = await import('../../src/weapons/weapons.js');

test('weapons.js exposes the registry API', () => {
  for (const name of ['WEAPON_CLASSES', 'PICKUP_CLASSES', 'SPAWN_TABLE', 'pickRandomSpawn', 'setDisabledWeapons', 'getDisabledWeapons']) {
    assert.ok(name in weapons, `missing export: ${name}`);
  }
});

test('every WEAPON_CLASSES entry is a constructor', () => {
  assert.ok(Array.isArray(weapons.WEAPON_CLASSES) && weapons.WEAPON_CLASSES.length > 0);
  weapons.WEAPON_CLASSES.forEach((cls, i) => {
    assert.equal(typeof cls, 'function', `WEAPON_CLASSES[${i}] is not a class (got ${cls})`);
  });
});

test('every PICKUP_CLASSES entry is a constructor', () => {
  assert.ok(Array.isArray(weapons.PICKUP_CLASSES) && weapons.PICKUP_CLASSES.length > 0);
  weapons.PICKUP_CLASSES.forEach((cls, i) => {
    assert.equal(typeof cls, 'function', `PICKUP_CLASSES[${i}] is not a class (got ${cls})`);
  });
});

test('SPAWN_TABLE entries are well-formed with unique ids', () => {
  const ids = new Set();
  for (const e of weapons.SPAWN_TABLE) {
    assert.equal(typeof e.cls, 'function', `SPAWN_TABLE id=${e.id} has no class`);
    assert.equal(typeof e.w, 'number', `SPAWN_TABLE id=${e.id} has no weight`);
    assert.ok(e.id && !ids.has(e.id), `duplicate/empty SPAWN_TABLE id: ${e.id}`);
    ids.add(e.id);
  }
});

test('pickRandomSpawn returns a class from the table', () => {
  const classes = new Set(weapons.SPAWN_TABLE.map(e => e.cls));
  for (let i = 0; i < 50; i++) {
    assert.ok(classes.has(weapons.pickRandomSpawn()), 'pickRandomSpawn returned an off-table class');
  }
});

test('disabling every spawn id falls back to a class, never crashes', () => {
  const all = weapons.SPAWN_TABLE.map(e => e.id);
  weapons.setDisabledWeapons(all);
  assert.equal(typeof weapons.pickRandomSpawn(), 'function');
  weapons.setDisabledWeapons([]); // restore
  assert.equal(weapons.getDisabledWeapons().size, 0);
});
