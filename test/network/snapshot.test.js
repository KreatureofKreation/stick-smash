import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodePlayer, decodePlayerInto, encodeSnapshot, applyTiles, applyCurved,
  sanitizeInput, sanitizeSnapshot,
} from '../../src/network/Snapshot.js';

// Minimal duck-typed stand-ins for the Three vectors / Stickman the codec
// touches. The codec only reads props and calls .set()/rig methods, so these
// suffice — no Three.js needed.
const vec = (x = 0, y = 0, z = 0) => ({
  x, y, z,
  set(a, b, c) { this.x = a; this.y = b; if (c !== undefined) this.z = c; return this; },
});
const quat = () => ({ x: 0, y: 0, z: 0, w: 1, set(a, b, c, d) { this.x = a; this.y = b; this.z = c; this.w = d; } });

function mkPlayer(o = {}) {
  return {
    id: o.id ?? 0, name: o.name ?? 'P', character: o.character ?? { id: 'bolt' },
    position: vec(o.x ?? 1.5, o.y ?? 2.5),
    body: { velocity: vec(o.vx ?? 3, o.vy ?? -4), position: vec(), quaternion: quat() },
    aimDir: vec(o.ax ?? 0.6, o.ay ?? 0.8),
    facing: o.facing ?? -1, state: o.state ?? 'active', health: o.health ?? 88, lives: o.lives ?? 2, score: o.score ?? 5,
    weapon: o.weapon ?? null, grabbing: o.grabbing ?? false,
    moveId: o.moveId ?? 'jab', chainStep: o.chainStep ?? 2, airChainStep: o.airChainStep ?? 1,
    kicking: o.kicking ?? true, _attackStep: o._attackStep ?? 3,
    grounded: o.grounded ?? true, sliding: o.sliding ?? false, crouching: o.crouching ?? true,
    _blocking: o._blocking ?? true, _shieldDirX: o._shieldDirX ?? 0.7, _shieldDirY: o._shieldDirY ?? -0.3,
    _severed: o._severed ?? new Set(),
    _gibbed: o._gibbed ?? false,
    _firstSnapApplied: o._firstSnapApplied ?? false,
    _gibCalls: 0,
    _gib() { this._gibbed = true; this._gibCalls++; },
    rig: { hidden: [], resets: 0, hidePart(n) { this.hidden.push(n); }, resetParts() { this.resets++; } },
  };
}

const WIRE_KEYS = [
  'id', 'name', 'character', 'x', 'y', 'vx', 'vy', 'f', 'ax', 'ay', 's', 'hp', 'l', 'sc',
  'wp', 'at', 'gr', 'mid', 'cs', 'acs', 'kk', 'as', 'gd', 'sl', 'cr', 'bk', 'sdx', 'sdy', 'sv', 'gb',
];

test('encodePlayer emits exactly the expected wire keys (guards drift)', () => {
  const wire = encodePlayer(mkPlayer());
  assert.deepEqual(Object.keys(wire).sort(), [...WIRE_KEYS].sort());
});

test('player round-trips: encode then decode preserves every symmetric field', () => {
  const src = mkPlayer({ x: 4.25, y: -1.5, vx: 2, vy: 7, facing: 1, health: 42, lives: 1, score: 9,
    moveId: 'heavyDown', chainStep: 3, airChainStep: 1, kicking: false, _attackStep: 2,
    grounded: false, sliding: true, crouching: false, _blocking: false, _shieldDirX: -0.2, _shieldDirY: 0.9 });
  const wire = encodePlayer(src);
  const dst = mkPlayer({ /* different starting values */ x: 0, y: 0, health: 100, score: 0, _firstSnapApplied: false });
  decodePlayerInto(dst, wire);

  assert.equal(dst.body.position.x, 4.25, 'first-snap position x');
  assert.equal(dst.body.position.y, -1.5, 'first-snap position y');
  assert.equal(dst._netTargetX, 4.25);
  assert.equal(dst._netTargetY, -1.5);
  assert.equal(dst.body.velocity.x, 2);
  assert.equal(dst.body.velocity.y, 7);
  assert.equal(dst.facing, 1);
  assert.equal(dst.aimDir.x, src.aimDir.x);
  assert.equal(dst.aimDir.y, src.aimDir.y);
  assert.equal(dst.state, 'active');
  assert.equal(dst.health, 42);
  assert.equal(dst.lives, 1);
  assert.equal(dst.score, 9);
  assert.equal(dst.moveId, 'heavyDown');
  assert.equal(dst.chainStep, 3);
  assert.equal(dst.airChainStep, 1);
  assert.equal(dst.kicking, false);
  assert.equal(dst._attackStep, 2);
  assert.equal(dst.grounded, false);
  assert.equal(dst.sliding, true);
  assert.equal(dst.crouching, false);
  assert.equal(dst._blocking, false);
  assert.equal(dst._shieldDirX, -0.2);
  assert.equal(dst._shieldDirY, 0.9);
});

test('decode: subsequent snapshots do not re-snap position (interpolation)', () => {
  const dst = mkPlayer({ _firstSnapApplied: true });
  dst.body.position.set(99, 99, 0);
  decodePlayerInto(dst, encodePlayer(mkPlayer({ x: 1, y: 2 })));
  // position untouched (loop lerps toward target); only the target updates.
  assert.equal(dst.body.position.x, 99);
  assert.equal(dst._netTargetX, 1);
});

test('decode: grounded falls back to |vy|<0.5 when gd is absent', () => {
  const a = mkPlayer({ _firstSnapApplied: true });
  decodePlayerInto(a, { x: 0, y: 0, vx: 0, vy: 0.2, f: 1, ax: 1, ay: 0, s: 'active', hp: 1, l: 1, sc: 0, at: 0, mid: null, cs: 0, acs: 0, kk: 0, as: 0, sl: 0, cr: 0, bk: 0, sdx: 0, sdy: 0, sv: 0, gb: 0 });
  assert.equal(a.grounded, true, 'slow vy → grounded');
  const b = mkPlayer({ _firstSnapApplied: true });
  decodePlayerInto(b, { x: 0, y: 0, vx: 0, vy: 5, f: 1, ax: 1, ay: 0, s: 'active', hp: 1, l: 1, sc: 0, at: 0, mid: null, cs: 0, acs: 0, kk: 0, as: 0, sl: 0, cr: 0, bk: 0, sdx: 0, sdy: 0, sv: 0, gb: 0 });
  assert.equal(b.grounded, false, 'fast vy → airborne');
});

test('decode: shield direction only updates when sdx is present', () => {
  const dst = mkPlayer({ _firstSnapApplied: true, _shieldDirX: 0.1, _shieldDirY: 0.2 });
  const wire = encodePlayer(mkPlayer());
  wire.sdx = null; wire.sdy = null;
  decodePlayerInto(dst, wire);
  assert.equal(dst._shieldDirX, 0.1, 'unchanged when sdx null');
  assert.equal(dst._shieldDirY, 0.2);
});

test('severed limbs round-trip via the bitfield and drive the rig', () => {
  const src = mkPlayer({ _severed: new Set(['armL', 'legR']) }); // bits 1 | 8 = 9
  const wire = encodePlayer(src);
  assert.equal(wire.sv, 9);
  const dst = mkPlayer({ _firstSnapApplied: true });
  decodePlayerInto(dst, wire);
  assert.ok(dst._severed.has('armL') && dst._severed.has('legR'));
  assert.deepEqual(dst.rig.hidden.sort(), ['armL', 'legR']);
});

test('severed resets (limbs restored) when sv returns to 0', () => {
  const dst = mkPlayer({ _firstSnapApplied: true, _severed: new Set(['armR']), _gibbed: true });
  const wire = encodePlayer(mkPlayer()); // sv 0, gb 0
  decodePlayerInto(dst, wire);
  assert.equal(dst._severed.size, 0);
  assert.equal(dst._gibbed, false);
  assert.equal(dst.rig.resets, 1);
});

test('gib fires when gb set and player not already gibbed', () => {
  const dst = mkPlayer({ _firstSnapApplied: true });
  const wire = encodePlayer(mkPlayer({ _gibbed: true })); // gb 1, sv 0
  decodePlayerInto(dst, wire);
  assert.equal(dst._gibbed, true);
  assert.equal(dst._gibCalls, 1);
  assert.equal(dst.rig.resets, 0, 'no reset on the first gib');
});

// Documents a PRE-EXISTING quirk the refactor preserves verbatim: a steady
// stream of {sv:0, gb:1} snapshots resets (sv===0 && _gibbed) then re-gibs
// every frame. Flagged in docs/REFACTOR_PLAN.md as a candidate fix for the
// net-hardening phase — not changed here so this stays behavior-preserving.
test('gib re-triggers on repeated sv:0/gb:1 snapshots (preserved quirk)', () => {
  const dst = mkPlayer({ _firstSnapApplied: true });
  const wire = encodePlayer(mkPlayer({ _gibbed: true }));
  decodePlayerInto(dst, wire); // gib once
  decodePlayerInto(dst, wire); // reset (because _gibbed) then re-gib
  assert.equal(dst._gibCalls, 2);
  assert.equal(dst.rig.resets, 1);
  assert.equal(dst._gibbed, true);
});

test('encodeSnapshot: no level → empty payload', () => {
  assert.deepEqual(encodeSnapshot({ level: null, players: [] }), { players: [], tiles: [] });
});

test('encodeSnapshot: maps players (nulls preserved) and ships only damaged tiles', () => {
  const tiles = new Map([
    ['0,0', { gx: 0, gy: 0, hp: 100, maxHp: 100 }], // pristine → skipped
    ['1,0', { gx: 1, gy: 0, hp: 30, maxHp: 100 }],  // damaged → shipped
  ]);
  const game = { level: { tiles }, players: [mkPlayer({ id: 0 }), null] };
  const snap = encodeSnapshot(game);
  assert.equal(snap.players.length, 2);
  assert.equal(snap.players[1], null);
  assert.deepEqual(snap.tiles, [[1, 0, 30]]);
});

test('applyTiles: hp<=0 destroys, otherwise sets hp', () => {
  let destroyed = false;
  const t1 = { hp: 50, destroy() { destroyed = true; } };
  const t2 = { hp: 50, destroy() {} };
  const level = { tiles: new Map([['0,0', t1], ['1,0', t2]]) };
  applyTiles(level, [[0, 0, 0], [1, 0, 25]]);
  assert.equal(destroyed, true);
  assert.equal(t2.hp, 25);
});

test('applyCurved: applies quaternions and damages wedges', () => {
  const p = mkPlayer({ _firstSnapApplied: true });
  let dmg = 0;
  const wedge = { kind: 'ice', idx: 2, hp: 100, damage(n) { dmg = n; } };
  const level = { planets: [{ id: 7, wedges: [wedge] }] };
  applyCurved(level, [p], { playersQ: [[0.1, 0.2, 0.3, 0.9]], wedges: [[7, 'ice', 2, 60]] });
  assert.equal(p.body.quaternion.x, 0.1);
  assert.equal(p.body.quaternion.w, 0.9);
  assert.equal(dmg, 40); // hp 100 -> 60
});

// ── Untrusted-input sanitizers ──────────────────────────────────────────────

test('sanitizeInput: whitelists keys and coerces types', () => {
  const out = sanitizeInput({
    moveX: 0.5, moveY: -0.3, jump: 1, attack: 'yes', grab: 0, special: true,
    throw: null, aimX: 0.6, aimY: -0.8, aimActive: 1,
    evil: 'DROP TABLE', __proto__: { polluted: true },
  });
  assert.deepEqual(Object.keys(out).sort(),
    ['aimActive', 'aimX', 'aimY', 'attack', 'grab', 'jump', 'moveX', 'moveY', 'special', 'throw'].sort());
  assert.equal(out.moveX, 0.5);
  assert.equal(out.jump, true);
  assert.equal(out.attack, true);
  assert.equal(out.grab, false);
  assert.equal(out.throw, false);
  assert.equal(out.evil, undefined, 'unknown keys dropped');
});

test('sanitizeInput: clamps out-of-range / non-finite numbers', () => {
  const out = sanitizeInput({ moveX: 999, moveY: -999, aimX: NaN, aimY: Infinity });
  assert.equal(out.moveX, 1);
  assert.equal(out.moveY, -1);
  assert.equal(out.aimX, 1, 'NaN aimX → default 1');
  assert.equal(out.aimY, 0, 'Infinity aimY → default 0');
});

test('sanitizeInput: non-object → null (caller ignores)', () => {
  assert.equal(sanitizeInput(null), null);
  assert.equal(sanitizeInput('hax'), null);
});

test('sanitizeSnapshot: rejects structurally invalid payloads', () => {
  assert.equal(sanitizeSnapshot(null), null);
  assert.equal(sanitizeSnapshot({}), null, 'no players array');
  assert.equal(sanitizeSnapshot({ players: 'nope' }), null);
});

test('sanitizeSnapshot: replaces NaN/Infinity player numbers with safe values', () => {
  const clean = sanitizeSnapshot({
    players: [{ id: 0, x: NaN, y: Infinity, vx: -Infinity, vy: 'fast', hp: NaN, l: -5, sc: NaN, ax: 9, ay: NaN }],
    tiles: [],
  });
  const p = clean.players[0];
  assert.equal(p.x, 0); assert.equal(p.y, 0); assert.equal(p.vx, 0); assert.equal(p.vy, 0);
  assert.equal(p.hp, 0);
  assert.equal(p.l, 0, 'negative lives floored to 0');
  assert.equal(p.ax, 1, 'out-of-range aimX clamped to 1');
  assert.equal(p.ay, 0);
});

test('sanitizeSnapshot: preserves valid data and pose flags untouched', () => {
  const clean = sanitizeSnapshot({
    players: [{ id: 2, x: 3.5, y: -1, vx: 2, vy: 4, hp: 75, l: 3, sc: 10, ax: 0.6, ay: 0.8, mid: 'jab', cs: 2, sv: 9, gb: 1 }],
    tiles: [[1, 0, 30]],
  });
  const p = clean.players[0];
  assert.equal(p.x, 3.5); assert.equal(p.hp, 75); assert.equal(p.l, 3);
  assert.equal(p.mid, 'jab'); assert.equal(p.cs, 2); assert.equal(p.sv, 9); assert.equal(p.gb, 1);
  assert.deepEqual(clean.tiles, [[1, 0, 30]]);
});

test('sanitizeSnapshot: drops malformed tiles and caps player count', () => {
  const clean = sanitizeSnapshot({
    players: Array.from({ length: 50 }, (_, i) => ({ id: i, x: 0, y: 0, vx: 0, vy: 0, hp: 1, l: 1, sc: 0, ax: 1, ay: 0 })),
    tiles: [[1, 2, 3], ['bad'], [4, 5], [6, 7, Infinity]],
  });
  assert.equal(clean.players.length, 16, 'player count capped');
  assert.deepEqual(clean.tiles, [[1, 2, 3]], 'only well-formed finite triples kept');
});

test('sanitizeSnapshot: null player slots are preserved', () => {
  const clean = sanitizeSnapshot({ players: [null, { id: 1, x: 0, y: 0, vx: 0, vy: 0, hp: 1, l: 1, sc: 0, ax: 1, ay: 0 }], tiles: [] });
  assert.equal(clean.players[0], null);
  assert.equal(clean.players[1].id, 1);
});
