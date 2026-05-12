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
  // Step physics + per-tick projectile updates so both the cannon-es contact
  // path and the swept-capsule path get a chance to fire. The game's main
  // loop drives both each frame; in test isolation we have to do it manually.
  for (let i = 0; i < 10; i++) {
    window.game.physics.step(1 / 60);
    for (const pr of window.game.projectiles) pr.update(1 / 60);
  }
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
  for (let i = 0; i < 10; i++) {
    window.game.physics.step(1 / 60);
    for (const pr of window.game.projectiles) pr.update(1 / 60);
  }
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

  // Probe outward in BOTH facing directions to find a wall within the
  // weapon's short raycast range. The test scene's player spawn is not
  // guaranteed to be near a wall, so we hunt for one and teleport the
  // player + flip facing as needed.
  const weaponLen = sm.weapon.length ?? 0.6;
  const probeY = sm.body.position.y + 0.55;
  // Long probe in current facing first.
  const probeFacing = (dir) => window.game.physics.raycast(
    { x: sm.body.position.x, y: probeY, z: 0 },
    { x: sm.body.position.x + dir * 30, y: probeY, z: 0 },
    { mask: 0x0001 /* WORLD */ },
  );
  let probe = probeFacing(sm.facing);
  let dir = sm.facing;
  if (!probe) {
    probe = probeFacing(-sm.facing);
    dir = -sm.facing;
  }
  if (!probe) return 'SKIP: no wall in 30m of player in test scene';
  // Teleport: handR sits at body.x + facing*0.4 (rig offset). Place body so
  // handR is 0.3m short of the wall — well within weapon length 0.6.
  const wallX = probe.hitPointWorld.x;
  sm.facing = dir;
  sm.body.position.x = wallX - dir * 0.7;
  sm.body.position.y = Math.max(probe.hitPointWorld.y - 0.55, 1.0);
  // Step physics + sync rig so handR follows the teleported body. Without
  // this the rig (and thus updateMesh's raycast origin) keeps the pre-
  // teleport hand position.
  sm.aimDir = { x: dir, y: 0 };
  sm.input = { ...sm.input, aimActive: true };
  window.game.physics.step(1 / 60);
  sm._syncRig(1 / 60, false);
  const handR = sm.rig?.handR?.position;
  const handX = handR?.x ?? (sm.body.position.x + dir * 0.4);
  const handY = handR?.y ?? (sm.body.position.y + 0.55);
  let beforeHit = window.game.physics.raycast(
    { x: handX, y: handY, z: 0 },
    { x: handX + dir * weaponLen, y: handY, z: 0 },
    { mask: 0x0001 },
  );
  if (!beforeHit) return 'SKIP: could not reposition near wall in test scene (hand at ' + handX.toFixed(2) + ',' + handY.toFixed(2) + ')';

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
  // Teleport to open space (well above any tile + high enough that a short
  // upward ray can't hit anything). Test scene tops out around y=6, so y=20
  // is safely clear. Important: raycast from inside player's own collider
  // returns dist=0 even with a WORLD-only mask in this shim, so we also
  // step physics + sync rig to settle the hand position before testing.
  sm.body.position.x = 0;
  sm.body.position.y = 20;
  window.game.physics.step(1 / 60);
  sm._syncRig(1 / 60, false);
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

window.__test_weapon_pose_flags = function () {
  const reg = window.game?.weaponRegistry || {};
  window.__weaponTest.assert(Object.keys(reg).length > 0, 'weaponRegistry should be populated');
  const expected = [
    ['Pistol',      'aim', null],
    ['Shotgun',     'aim', 'support'],
    ['SniperRifle', 'aim', 'support'],
    ['Minigun',     'aim', 'support'],
    ['RPG',         'aim', 'support'],
  ];
  for (const [name, right, left] of expected) {
    const W = reg[name];
    if (!W) continue;  // weapon not in this build (e.g., not yet added)
    const inst = new W(window.game);
    window.__weaponTest.assert(inst.poseRight === right,
      name + '.poseRight should be ' + JSON.stringify(right) + ' (got ' + JSON.stringify(inst.poseRight) + ')');
    window.__weaponTest.assert(inst.poseLeft === left,
      name + '.poseLeft should be ' + JSON.stringify(left) + ' (got ' + JSON.stringify(inst.poseLeft) + ')');
    inst.destroy?.();
  }
};

window.__test_pistol_uses_effective_aim = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const Pistol = reg.Pistol;
  window.__weaponTest.assert(Pistol, 'Pistol class missing');
  const w = new Pistol(window.game);
  w.attachTo(sm);
  sm.weapon = w;
  // Force a known effectiveAimDir different from player.aimDir so the test
  // proves fire() reads effectiveAimDir, not aimDir.
  sm.aimDir = { x: 1, y: 0 };
  w.effectiveAimDir = { x: 0, y: 1 }; // straight up
  const before = window.game.projectiles.length;
  w.fire(sm);
  window.__weaponTest.assert(window.game.projectiles.length === before + 1, 'pistol fire should spawn a projectile');
  const proj = window.game.projectiles[window.game.projectiles.length - 1];
  const vx = proj.body.velocity.x, vy = proj.body.velocity.y;
  window.__weaponTest.assert(Math.abs(vx) < 1, 'pistol projectile vx should be near 0 (got ' + vx + ')');
  window.__weaponTest.assert(vy > 10, 'pistol projectile vy should be positive and large (got ' + vy + ')');
  proj.destroy();
  w.destroy();
  sm.weapon = null;
};

window.__test_minigun_spin_up_then_fire = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const Minigun = reg.Minigun;
  window.__weaponTest.assert(Minigun, 'Minigun class missing');
  const m = new Minigun(window.game);
  m.attachTo(sm); sm.weapon = m;
  sm.aimDir = { x: 1, y: 0 };
  // Press attack — minigun enters spinningUp.
  m.tryFire(sm);
  window.__weaponTest.assert(m._state === 'spinningUp', 'should enter spinningUp on press (got ' + m._state + ')');
  // Tick for ~0.166s (10 frames @ 60fps) — still spinning up, no shots yet.
  for (let i = 0; i < 10; i++) m.heldTick(1 / 60, sm);
  const beforeProj = window.game.projectiles.length;
  window.__weaponTest.assert(m._state === 'spinningUp', 'should still be spinningUp at ~0.166s (got ' + m._state + ')');
  // Tick past 0.3s — should transition to firing and start spawning projectiles.
  for (let i = 0; i < 12; i++) m.heldTick(1 / 60, sm);
  window.__weaponTest.assert(m._state === 'firing', 'should be firing after spin-up (got ' + m._state + ')');
  const afterSpinUp = window.game.projectiles.length;
  window.__weaponTest.assert(afterSpinUp > beforeProj, 'should fire projectiles after spin-up (got ' + (afterSpinUp - beforeProj) + ' new)');
  // Continue holding for 0.5s — sustained fire.
  for (let i = 0; i < 30; i++) m.heldTick(1 / 60, sm);
  const sustained = window.game.projectiles.length;
  window.__weaponTest.assert(sustained - afterSpinUp >= 6, 'should sustain auto-fire (expected >=6 more, got ' + (sustained - afterSpinUp) + ')');
  // Release attack — should enter spinningDown.
  m.releaseFire(sm);
  window.__weaponTest.assert(m._state === 'spinningDown', 'should enter spinningDown on release (got ' + m._state + ')');
  // Tick past 0.5s — should return to idle.
  for (let i = 0; i < 35; i++) m.heldTick(1 / 60, sm);
  window.__weaponTest.assert(m._state === 'idle', 'should return to idle after spin-down (got ' + m._state + ')');
  // Cleanup
  while (window.game.projectiles.length) window.game.projectiles.pop().destroy?.();
  m.destroy();
  sm.weapon = null;
};

window.__test_sniper_muzzle_under_barrel = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const SR = reg.SniperRifle;
  window.__weaponTest.assert(SR, 'SniperRifle class missing');
  const w = new SR(window.game);
  const mz = w._muzzleWorld(sm);
  const expectedX = sm.position.x + sm.facing * 0.55;
  const expectedY = sm.position.y + 0.45;
  window.__weaponTest.assertNear(mz.x, expectedX, 0.001, 'sniper muzzle x should be at barrel tip (' + expectedX + ', got ' + mz.x + ')');
  window.__weaponTest.assertNear(mz.y, expectedY, 0.001, 'sniper muzzle y should be just under barrel (' + expectedY + ', got ' + mz.y + ')');
  w.destroy();
};

window.__test_bow_removed = function () {
  const reg = window.game?.weaponRegistry || {};
  window.__weaponTest.assert(!reg.Bow, 'Bow should be removed from weapon registry (got ' + reg.Bow + ')');
};
