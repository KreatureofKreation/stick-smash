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
  if (!sm.weapon) {
    const reg = window.game.weaponRegistry || {};
    const W = reg.Pistol || Object.values(reg)[0];
    window.__weaponTest.assert(W, 'no weapon class to equip');
    sm.weapon = new W(window.game);
    sm.weapon.attachTo(sm);
  }
  // Reset prior-test residue so a stale `true` can't pass us silently.
  sm.weapon.aimAdjusted = false;
  sm.weapon.effectiveAimDir = null;

  const wallY = sm.position.y + 0.55;
  const beforeHit = window.game.physics.raycast(
    { x: sm.position.x, y: wallY, z: 0 },
    { x: sm.position.x + sm.facing * 1.5, y: wallY, z: 0 },
  );
  if (!beforeHit) return 'SKIP: no near wall in test scene';

  const wallNormal = beforeHit.hitNormalWorld;
  const nx = wallNormal.x, ny = wallNormal.y;
  const nlen = Math.hypot(nx, ny) || 1;
  const nnx = nx / nlen, nny = ny / nlen;

  // Case A: aim straight forward into the wall.
  sm.aimDir = { x: sm.facing, y: 0 };
  sm.input = { ...sm.input, aimActive: true };
  sm.weapon.updateMesh(sm);
  window.__weaponTest.assert(sm.weapon.aimAdjusted === true, 'aimAdjusted should be true on wall hit');
  let ea = sm.weapon.effectiveAimDir;
  window.__weaponTest.assert(ea, 'effectiveAimDir should be set after wall hit');
  // Effective aim should be tangent to the wall — perpendicular to the normal.
  let dotToNormal = Math.abs(ea.x * nnx + ea.y * nny);
  window.__weaponTest.assert(dotToNormal < 0.1, 'effective aim should be perpendicular to wall normal (got dot=' + dotToNormal.toFixed(3) + ')');

  // Case B: aim slightly UP into the wall — effective aim Y should be > 0.
  sm.weapon.aimAdjusted = false;
  sm.weapon.effectiveAimDir = null;
  sm.aimDir = { x: sm.facing * 0.95, y: 0.31 };
  sm.weapon.updateMesh(sm);
  ea = sm.weapon.effectiveAimDir;
  window.__weaponTest.assert(sm.weapon.aimAdjusted === true, 'aimAdjusted true for slight-up case');
  window.__weaponTest.assert(ea && ea.y > 0, 'aim-up bias should produce positive ea.y (got ' + (ea && ea.y) + ')');

  // Case C: aim slightly DOWN into the wall — effective aim Y should be < 0.
  sm.weapon.aimAdjusted = false;
  sm.weapon.effectiveAimDir = null;
  sm.aimDir = { x: sm.facing * 0.95, y: -0.31 };
  sm.weapon.updateMesh(sm);
  ea = sm.weapon.effectiveAimDir;
  window.__weaponTest.assert(sm.weapon.aimAdjusted === true, 'aimAdjusted true for slight-down case');
  window.__weaponTest.assert(ea && ea.y < 0, 'aim-down bias should produce negative ea.y (got ' + (ea && ea.y) + ')');
};

window.__test_weapon_no_wall_no_adjust = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm && sm.weapon, 'need armed local player');
  // Poison both fields with sentinel values to detect a no-op or stale path.
  sm.weapon.aimAdjusted = true;
  sm.weapon.effectiveAimDir = { x: 999, y: 999 };
  sm.aimDir = { x: 0, y: 1 };
  sm.input = { ...sm.input, aimActive: true };
  sm.weapon.updateMesh(sm);
  window.__weaponTest.assert(sm.weapon.aimAdjusted === false, 'no wall = aimAdjusted false');
  const ea = sm.weapon.effectiveAimDir;
  window.__weaponTest.assert(ea, 'effectiveAimDir should be set');
  // No-hit branch should pass through the unadjusted aim — both components should match.
  window.__weaponTest.assertNear(ea.x, 0, 0.001, 'no-wall: ea.x should equal aimDir.x (0)');
  window.__weaponTest.assertNear(ea.y, 1, 0.001, 'no-wall: ea.y should equal aimDir.y (1)');
};

window.__test_pose_left_respects_flag = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  // Equip a weapon with poseLeft = null (1H) and verify left arm is NOT 'aim'.
  const fake1H = { poseRight: 'aim', poseLeft: null, aimWeapon: true,
    updateMesh: () => {}, attachTo: () => {}, detach: () => {}, mesh: { visible: false } };
  sm.weapon = fake1H;
  sm.input = { ...sm.input, aimActive: true };
  sm.aimDir = { x: sm.facing, y: 0 };
  sm._syncRig(1 / 60, false);
  const armPoseL = sm._lastArmPoseL;
  window.__weaponTest.assert(armPoseL !== 'aim', '1H weapon should NOT drive left arm to aim (got ' + armPoseL + ')');

  fake1H.poseLeft = 'support';
  sm._syncRig(1 / 60, false);
  const armPoseL2 = sm._lastArmPoseL;
  window.__weaponTest.assert(armPoseL2 === 'aim', '2H weapon (poseLeft=support) should drive left arm to aim (got ' + armPoseL2 + ')');

  // Also confirm poseLeft='aim' (future dual-pistol case) drives left arm to aim.
  fake1H.poseLeft = 'aim';
  sm._syncRig(1 / 60, false);
  window.__weaponTest.assert(sm._lastArmPoseL === 'aim', 'dual (poseLeft=aim) should also drive left arm to aim (got ' + sm._lastArmPoseL + ')');

  sm.weapon = null;
};
