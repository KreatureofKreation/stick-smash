// Test harness for the firearms-overhaul PRs. Self-registers helpers on
// `window` so dev-time `preview_eval` can run them. No production cost — the
// helpers only execute when explicitly called.

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

function assertNear(actual, expected, eps, msg) {
  if (Math.abs(actual - expected) > eps) {
    throw new Error('ASSERT NEAR FAIL: ' + msg + ' — actual=' + actual + ' expected=' + expected + ' eps=' + eps);
  }
}

window.__weaponTest = { assert, assertNear, results: [] };

window.__weaponTest.run = function (name) {
  const fn = window['__test_' + name];
  if (typeof fn !== 'function') throw new Error('No test named __test_' + name);
  try {
    fn();
    window.__weaponTest.results.push({ name, ok: true });
    return 'PASS: ' + name;
  } catch (e) {
    window.__weaponTest.results.push({ name, ok: false, msg: e.message });
    throw e;
  }
};

window.__test_headSnap_exists = function () {
  const sm = window.game?.players?.find(p => p && p.alive);
  window.__weaponTest.assert(sm, 'no live player to test against');
  window.__weaponTest.assert(typeof sm.headSnap === 'function', 'Stickman.headSnap missing');
};

window.__test_headshot_registers = function () {
  const sm = window.game?.players?.find(p => p && p.alive && !p.isLocal);
  window.__weaponTest.assert(sm, 'need a non-local live player target');
  const startHp = sm.health;
  const startSnap = (sm.rig?._headLagY) || 0;
  // Aim at the head capsule (top of body, slightly above body.position.y).
  const headY = sm.body.position.y + 0.55;
  const startX = sm.body.position.x - 2;
  const proj = window.game.spawnTestProjectile?.({
    x: startX, y: headY,
    vx: 60, vy: 0,
    damage: 10, owner: null,
  });
  window.__weaponTest.assert(proj, 'game.spawnTestProjectile not available');
  // Step physics a few frames to let the sweep run.
  for (let i = 0; i < 10; i++) window.game.physics.step(1 / 60);
  // Damage applied (with head 2× → 20)
  window.__weaponTest.assertNear(startHp - sm.health, 20, 0.5, 'headshot damage should be 2x base');
  // Head snap impulse fired (lag offset moved)
  window.__weaponTest.assert((sm.rig?._headLagY || 0) !== startSnap, 'head should have snap offset');
};

window.__test_bodyshot_no_double = function () {
  const sm = window.game?.players?.find(p => p && p.alive && !p.isLocal);
  window.__weaponTest.assert(sm, 'need a non-local live player target');
  const startHp = sm.health;
  const bodyY = sm.body.position.y;
  window.game.spawnTestProjectile({
    x: sm.body.position.x - 2, y: bodyY,
    vx: 60, vy: 0, damage: 10, owner: null,
  });
  for (let i = 0; i < 10; i++) window.game.physics.step(1 / 60);
  // Damage exactly 10 (not 20 from a double-apply, not 0 from no-hit).
  window.__weaponTest.assertNear(startHp - sm.health, 10, 0.5, 'body shot should apply base damage exactly once');
};

window.__test_weapon_wall_reorient = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  // Force-equip a stub aiming weapon if not already armed.
  if (!sm.weapon) {
    const reg = window.game.weaponRegistry || {};
    const W = reg.Pistol || Object.values(reg)[0];
    window.__weaponTest.assert(W, 'no weapon class to equip');
    sm.weapon = new W(window.game);
    sm.weapon.attachTo(sm);
  }
  const wallY = sm.position.y + 0.55;
  const beforeHit = window.game.physics.raycast(
    { x: sm.position.x, y: wallY, z: 0 },
    { x: sm.position.x + sm.facing * 1.5, y: wallY, z: 0 },
  );
  if (!beforeHit) {
    // Test environment lacks a near wall — skip silently with a clear marker.
    return 'SKIP: no near wall in test scene';
  }
  // Aim straight forward into the wall.
  sm.aimDir = { x: sm.facing, y: 0 };
  sm.input = { ...sm.input, aimActive: true };
  sm.weapon.updateMesh(sm);
  window.__weaponTest.assert(sm.weapon.aimAdjusted === true, 'aimAdjusted flag should be set when hitting wall');
  const ea = sm.weapon.effectiveAimDir;
  window.__weaponTest.assert(ea, 'effectiveAimDir should be set');
  const dotIntoWall = ea.x * sm.facing + ea.y * 0;
  window.__weaponTest.assert(dotIntoWall < 0.95, 'effective aim should rotate off the wall normal');
};

window.__test_weapon_no_wall_no_adjust = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm && sm.weapon, 'need armed local player');
  // Aim straight up — should not hit a ceiling in normal test scene.
  sm.aimDir = { x: 0, y: 1 };
  sm.input = { ...sm.input, aimActive: true };
  sm.weapon.updateMesh(sm);
  window.__weaponTest.assert(sm.weapon.aimAdjusted === false, 'no wall = no adjust');
  // effectiveAimDir should be set to the unadjusted aim
  window.__weaponTest.assert(sm.weapon.effectiveAimDir, 'effectiveAimDir should still be set when no adjust');
};
