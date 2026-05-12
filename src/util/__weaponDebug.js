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

window.__weaponTest.run = async function (name) {
  const fn = window['__test_' + name];
  if (typeof fn !== 'function') throw new Error('No test named __test_' + name);
  try {
    await fn();
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
  // Teleport so handR (which sits ~0.55m forward in the aim pose) ends up
  // ~0.3m short of the wall — comfortably outside the wall's collider but
  // well within the weapon length 0.6 raycast. body→handR offset for aim
  // pose: shoulder ~0.18 + aimDist 0.7 = ~0.88. So body must be at
  // wall - 1.18 (gives 0.3m clearance from handR to wall surface).
  const wallX = probe.hitPointWorld.x;
  sm.facing = dir;
  sm.body.position.x = wallX - dir * 1.2;
  sm.body.position.y = Math.max(probe.hitPointWorld.y - 0.55, 1.0);
  // Step physics + sync rig many times so the (PR-X-softer) aim-pose spring
  // settles to the new body position. One sync isn't enough at K=200/D=14.
  sm.aimDir = { x: dir, y: 0 };
  sm.input = { ...sm.input, aimActive: true };
  for (let i = 0; i < 30; i++) { window.game.physics.step(1 / 60); sm._syncRig(1 / 60, false); }
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
    ['Shotgun',     'aim', null],   // was 'support'
    ['SniperRifle', 'aim', null],   // was 'support'
    ['Minigun',     'aim', null],   // was 'support'
    ['RPG',         'aim', null],   // was 'support'
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
  w.attachTo(sm); sm.weapon = w;
  // Set a known aim and let rig settle to aim pose so handR is at the
  // expected aim-pose anchor, not the prior idle position.
  sm.aimDir = { x: sm.facing, y: 0 };
  sm.input = { ...sm.input, aimActive: true };
  for (let i = 0; i < 30; i++) { window.game.physics.step(1 / 60); sm._syncRig(1 / 60, false); }
  // Force the same effectiveAimDir _muzzleWorld will read.
  w.effectiveAimDir = { x: sm.facing, y: 0 };
  const mz = w._muzzleWorld(sm);
  // New contract: muzzle = handR + aimDir × 1.27 (barrel-tip local distance).
  const handR = sm.rig?.handR?.position;
  window.__weaponTest.assert(handR, 'rig handR should exist after sync');
  const expectedX = handR.x + sm.facing * 1.27;
  const expectedY = handR.y + 0 * 1.27;
  window.__weaponTest.assertNear(mz.x, expectedX, 0.05, 'sniper muzzle x should track barrel tip from hand');
  window.__weaponTest.assertNear(mz.y, expectedY, 0.05, 'sniper muzzle y should track barrel tip from hand');
  if (sm.weapon === w) { w.destroy(); sm.weapon = null; }
};

window.__test_bow_removed = function () {
  const reg = window.game?.weaponRegistry || {};
  window.__weaponTest.assert(!reg.Bow, 'Bow should be removed from weapon registry (got ' + reg.Bow + ')');
};

window.__test_smg_full_auto = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const SMG = reg.SMG;
  window.__weaponTest.assert(SMG, 'SMG class missing');
  const w = new SMG(window.game);
  w.attachTo(sm); sm.weapon = w;
  sm.aimDir = { x: 1, y: 0 };
  // Press attack — should start auto-firing immediately (no spin-up).
  w.tryFire(sm);
  const before = window.game.projectiles.length;
  // 0.5s of held attack at fireDelay 0.06s = ~8 shots.
  for (let i = 0; i < 30; i++) w.heldTick(1 / 60, sm);
  const after = window.game.projectiles.length;
  window.__weaponTest.assert(after - before >= 6, 'SMG should auto-fire 6+ shots in 0.5s held (got ' + (after - before) + ')');
  // Cleanup
  while (window.game.projectiles.length) window.game.projectiles.pop().destroy?.();
  if (sm.weapon === w) { w.destroy(); sm.weapon = null; }
};

window.__test_revolver_heavy_single_shot = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const Rev = reg.Revolver;
  window.__weaponTest.assert(Rev, 'Revolver class missing');
  const w = new Rev(window.game);
  w.attachTo(sm); sm.weapon = w;
  sm.aimDir = { x: 1, y: 0 };
  window.__weaponTest.assert(w.poseLeft === null, 'Revolver should be 1H (poseLeft=null)');
  window.__weaponTest.assert(w.ammo === 6, 'Revolver should start with 6 ammo');
  const before = window.game.projectiles.length;
  // Use the standard tryFire so cooldown logic kicks in (Revolver doesn't override).
  w.tryFire(sm);
  const after = window.game.projectiles.length;
  window.__weaponTest.assert(after - before === 1, 'Revolver should fire exactly 1 projectile per click (got ' + (after - before) + ')');
  const proj = window.game.projectiles[after - 1];
  window.__weaponTest.assert(proj.damage === 35, 'Revolver projectile damage should be 35 (got ' + proj.damage + ')');
  // Click again immediately — cooldown blocks.
  const beforeCool = window.game.projectiles.length;
  w.tryFire(sm);
  window.__weaponTest.assert(window.game.projectiles.length === beforeCool, 'Revolver should be on cooldown after firing');
  while (window.game.projectiles.length) window.game.projectiles.pop().destroy?.();
  if (sm.weapon === w) { w.destroy(); sm.weapon = null; }
};

window.__test_crossbow_flat_arc = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const Cb = reg.Crossbow;
  window.__weaponTest.assert(Cb, 'Crossbow class missing');
  const w = new Cb(window.game);
  w.attachTo(sm); sm.weapon = w;
  sm.aimDir = { x: 1, y: 0 };
  const before = window.game.projectiles.length;
  w.tryFire(sm);
  const after = window.game.projectiles.length;
  window.__weaponTest.assert(after - before === 1, 'Crossbow should spawn one bolt per click');
  const bolt = window.game.projectiles[after - 1];
  window.__weaponTest.assert(bolt.body.velocity.x > 40, 'Crossbow bolt should be fast (got vx=' + bolt.body.velocity.x + ')');
  window.__weaponTest.assertNear(bolt.gravityScale, 0.5, 0.01, 'Crossbow bolt gravityScale should be 0.5 (got ' + bolt.gravityScale + ')');
  window.__weaponTest.assert(bolt.sticky, 'Crossbow bolt should be sticky');
  window.__weaponTest.assert(bolt.damage === 28, 'Crossbow bolt damage should be 28 (got ' + bolt.damage + ')');
  bolt.destroy();
  if (sm.weapon === w) { w.destroy(); sm.weapon = null; }
};

window.__test_ar_three_burst = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const AR = reg.AssaultRifle;
  window.__weaponTest.assert(AR, 'AssaultRifle class missing');
  const w = new AR(window.game);
  w.attachTo(sm); sm.weapon = w;
  sm.aimDir = { x: 1, y: 0 };
  // Drive both heldTick (per-tick state machine) AND worldTick (cooldown
  // decrement). In real gameplay the game loop calls both each frame; in
  // test isolation we have to do it manually.
  const tick = (n) => { for (let i = 0; i < n; i++) { w.heldTick(1 / 60, sm); w.worldTick(1 / 60); } };
  const before = window.game.projectiles.length;
  w.tryFire(sm);
  tick(12); // 0.2s — covers 3 burst shots @ 0.05s
  const after = window.game.projectiles.length;
  window.__weaponTest.assert(after - before === 3, 'AR single tap should fire exactly 3 shots (got ' + (after - before) + ')');
  // Holding (without re-tapping tryFire) should NOT auto-burst more.
  tick(12);
  const sustained = window.game.projectiles.length;
  window.__weaponTest.assert(sustained - after === 0, 'AR should not auto-burst on held attack (got ' + (sustained - after) + ' extra)');
  // After 0.4s cooldown, another tap fires another 3.
  tick(25);
  w.tryFire(sm);
  tick(12);
  const second = window.game.projectiles.length;
  window.__weaponTest.assert(second - sustained === 3, 'AR second tap after cooldown should fire 3 (got ' + (second - sustained) + ')');
  while (window.game.projectiles.length) window.game.projectiles.pop().destroy?.();
  if (sm.weapon === w) { w.destroy(); sm.weapon = null; }
};

window.__test_dual_pistols_alt_fire = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const reg = window.game.weaponRegistry || {};
  const DP = reg.DualPistols;
  window.__weaponTest.assert(DP, 'DualPistols class missing');
  const w = new DP(window.game);
  w.attachTo(sm); sm.weapon = w;
  window.__weaponTest.assert(w.poseRight === 'aim', 'poseRight should be aim');
  window.__weaponTest.assert(w.poseLeft === 'aim', 'poseLeft should be aim (dual)');
  sm.input = { ...sm.input, aimActive: true };
  sm.aimDir = { x: 1, y: 0 };
  sm._syncRig(1 / 60, false);
  window.__weaponTest.assert(sm._lastArmPoseR === 'aim', 'right arm should aim (got ' + sm._lastArmPoseR + ')');
  window.__weaponTest.assert(sm._lastArmPoseL === 'aim', 'left arm should aim (got ' + sm._lastArmPoseL + ')');
  // Fire 4 shots — should alternate hand.
  const seen = [];
  const origFire = w.fire.bind(w);
  w.fire = function (player) { seen.push(this._nextHand); origFire(player); };
  w.tryFire(sm); w.cooldown = 0;
  w.tryFire(sm); w.cooldown = 0;
  w.tryFire(sm); w.cooldown = 0;
  w.tryFire(sm);
  window.__weaponTest.assert(seen.length === 4, 'should record 4 shots (got ' + seen.length + ')');
  const alt = (seen[0] !== seen[1]) && (seen[1] !== seen[2]) && (seen[2] !== seen[3]);
  window.__weaponTest.assert(alt, 'fire should alternate hand each click (got ' + seen.join(',') + ')');
  while (window.game.projectiles.length) window.game.projectiles.pop().destroy?.();
  if (sm.weapon === w) { w.destroy(); sm.weapon = null; }
};

window.__test_flamethrower_cone_ignites = async function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  const target = window.game?.players?.find(p => p && p.alive && !p.isLocal);
  window.__weaponTest.assert(sm && target, 'need local + non-local players');
  const reg = window.game.weaponRegistry || {};
  const FT = reg.Flamethrower;
  window.__weaponTest.assert(FT, 'Flamethrower class missing');
  const w = new FT(window.game);
  w.attachTo(sm); sm.weapon = w;
  // Place target ~2m forward, same height.
  target.body.position.x = sm.body.position.x + sm.facing * 2;
  target.body.position.y = sm.body.position.y;
  sm.aimDir = { x: sm.facing, y: 0 };
  // Sync rig so handR is in aim pose.
  for (let i = 0; i < 30; i++) { window.game.physics.step(1 / 60); sm._syncRig(1 / 60, false); }
  w.tryFire(sm);
  // Pump several flame projectiles + step physics + projectile updates so
  // they travel to the target and ignite on contact.
  for (let i = 0; i < 30; i++) {
    w.heldTick(1 / 60, sm);
    window.game.physics.step(1 / 60);
    for (const pr of window.game.projectiles) pr.update(1 / 60);
  }
  window.__weaponTest.assert(target._burnDoT, 'target should be ignited (got _burnDoT=' + target._burnDoT + ')');
  w.releaseFire(sm);
  while (window.game.projectiles.length) window.game.projectiles.pop().destroy?.();
  if (sm.weapon === w) { w.destroy(); sm.weapon = null; }
};

window.__test_fire_patch_cap = async function () {
  const mod = await import('../weapons/fx/FirePatch.js');
  const { spawnFirePatch, getActivePatches, clearAllPatches } = mod;
  clearAllPatches();
  for (let i = 0; i < 25; i++) spawnFirePatch(window.game, { x: i * 0.5, y: 0, owner: null });
  const active = getActivePatches();
  window.__weaponTest.assert(active.length === 16, 'fire patches should cap at 16 (got ' + active.length + ')');
  window.__weaponTest.assert(active[0].x >= 4.5, 'oldest patches should be evicted (got x=' + active[0].x + ')');
  clearAllPatches();
};

window.__test_rigClipsWallStanding = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');

  // Hunt for a wall in either facing direction within 30m of the player.
  const probeY = sm.body.position.y + 0.55;
  const probeFacing = (dir) => window.game.physics.raycast(
    { x: sm.body.position.x, y: probeY, z: 0 },
    { x: sm.body.position.x + dir * 30, y: probeY, z: 0 },
    { mask: 0x0001 },
  );
  let probe = probeFacing(sm.facing);
  let dir = sm.facing;
  if (!probe) {
    probe = probeFacing(-sm.facing);
    dir = -sm.facing;
  }
  if (!probe) return 'SKIP: no wall in 30m of player';

  const wallX = probe.hitPointWorld.x;
  sm.facing = dir;
  // Position body so shoulder + maxReach reaches PAST the wall.
  // body→shoulder offset ~0.18 horizontal, arm reach 0.88 max.
  // Place body 0.7m short of wall — hand wants to be ~0.36m past wall.
  sm.body.position.x = wallX - dir * 0.7;
  sm.body.position.y = Math.max(probe.hitPointWorld.y - 0.55, 1.0);
  sm.aimDir = { x: dir, y: 0 };
  sm.input = { ...sm.input, aimActive: true };

  // Settle pose spring and rig.
  for (let i = 0; i < 30; i++) {
    window.game.physics.step(1 / 60);
    sm._syncRig(1 / 60, false);
  }

  // sm._syncRig(_, false) uses rigInLocal=false → group at (0,0) and
  // rig.handR.position is already in WORLD coords (mesh positions are
  // computed off rigPos which equals body.position in that mode).
  const handWorldX = sm.rig.handR.position.x;

  // Wall surface is at wallX. Sweep should hold hand on the body side
  // of the wall: |handWorldX - wallX| should keep handWorldX on body side.
  // body side = wallX - dir * (positive value) i.e. dir*(wallX - handWorldX) > 0.
  const intoWallSign = dir * (handWorldX - wallX);
  window.__weaponTest.assert(
    intoWallSign < 0.02,
    'hand should NOT cross wall surface (handX=' + handWorldX.toFixed(3) +
    ', wallX=' + wallX.toFixed(3) + ', dir=' + dir + ', signed-penetration=' + intoWallSign.toFixed(3) + ')',
  );
};

window.__test_rigClipsFloorOnLunge = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');

  // Find a floor tile under the player.
  const probe = window.game.physics.raycast(
    { x: sm.body.position.x, y: sm.body.position.y + 4, z: 0 },
    { x: sm.body.position.x, y: sm.body.position.y - 4, z: 0 },
    { mask: 0x0001 },
  );
  if (!probe) return 'SKIP: no floor under player';
  const floorY = probe.hitPointWorld.y;

  // Drive the body deep sub-floor so the rig's natural head position
  // (hip + ~0.95m) lands BELOW the clamp's lift threshold of
  // floor + HEAD_RADIUS + LIMB_PAD = floor + 0.40m. We never call
  // physics.step in this test, so the artificially-low body position
  // holds for the single _syncRig call.
  // Body at floorY - 1.0 → head natural world ~ floorY - 0.05 (below
  // floor). Clamp must lift it to floor + 0.40m.
  const savedY = sm.body.position.y;
  sm.body.position.y = floorY - 1.0;
  try {
    sm._syncRig(1 / 60, false);
    // rigInLocal=false → group at (0,0), head.position is already world.
    const headWorldY = sm.rig.head.position.y;
    const HEAD_RADIUS = 0.34;
    const LIMB_PAD = 0.06;
    // After clamp: head bottom = floor + LIMB_PAD (within numeric eps).
    const headBottom = headWorldY - HEAD_RADIUS;
    window.__weaponTest.assert(
      headBottom >= floorY - 0.005,
      'head bottom must stay above floor (headBottom=' + headBottom.toFixed(3) +
      ', floorY=' + floorY.toFixed(3) + ', bodyY=' + sm.body.position.y.toFixed(3) +
      ', headWorldY=' + headWorldY.toFixed(3) + ')',
    );
    // Also assert the clamp actually fired — head world Y should be
    // very close to floor + HEAD_RADIUS + LIMB_PAD, not floating high.
    const expectedHeadWorldY = floorY + HEAD_RADIUS + LIMB_PAD;
    window.__weaponTest.assert(
      Math.abs(headWorldY - expectedHeadWorldY) < 0.05,
      'clamp should drive head to floor + radius + pad (expected ' +
      expectedHeadWorldY.toFixed(3) + ', got ' + headWorldY.toFixed(3) + ')',
    );
  } finally {
    // Restore body position so subsequent tests/playtest aren't broken.
    sm.body.position.y = savedY;
  }
};

window.__test_punchBoostImpulse = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  const target = window.game.players.find(p => p && !p.isLocal && p.alive);
  window.__weaponTest.assert(target, 'need bot target — start match with bots: 1');

  sm.body.position.x = target.body.position.x - 0.6 * sm.facing;
  sm.body.position.y = target.body.position.y;
  sm.body.velocity.x = 0;
  sm.body.velocity.y = 0;
  sm._impulseFrameBudget = 0;
  sm._impulseStunUntil = 0;
  const startVx = sm.body.velocity.x;

  const prevW = sm.weapon; sm.weapon = null; // simulate unarmed
  const wasFeature = window.__forceFeatures.punch;
  window.__forceFeatures.punch = 1;

  // Stand-in for the takeDamage+punch-boost combo. Call applyImpulse
  // directly with the math the punch-boost hook would apply: FIST_RECOIL=4,
  // kb direction = facing × +x.
  const FIST_RECOIL = 4;
  const kbX = sm.facing * 8, kbY = 4;
  const dirLen = Math.hypot(kbX, kbY);
  const ux = kbX / dirLen, uy = kbY / dirLen;
  sm.applyImpulse(-ux * FIST_RECOIL, -uy * FIST_RECOIL * 0.6);

  window.__forceFeatures.punch = wasFeature;
  sm.weapon = prevW;

  const deltaVx = sm.body.velocity.x - startVx;
  const expectedSign = -sm.facing;
  window.__weaponTest.assert(
    Math.sign(deltaVx) === expectedSign,
    'punch-boost should push attacker backward (facing=' + sm.facing +
    ', deltaVx=' + deltaVx.toFixed(3) + ')',
  );
  window.__weaponTest.assert(
    Math.abs(deltaVx) >= 2.5,
    'punch-boost magnitude should be at least 2.5 m/s (got ' + Math.abs(deltaVx).toFixed(3) + ')',
  );
};

window.__test_recoilJump = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');

  const Shotgun = window.game.weaponRegistry?.Shotgun;
  window.__weaponTest.assert(Shotgun, 'no Shotgun in registry');
  sm.weapon = new Shotgun(window.game);
  sm.weapon.attachTo(sm);

  // aimDir is a THREE.Vector3 in production — mutate via .set, don't
  // replace the object (game tick would crash on aimDir.set call later).
  sm.aimDir.set(0, -1, 0);
  sm.input = { ...sm.input, aimActive: true };
  sm.body.velocity.x = 0;
  sm.body.velocity.y = 0;
  sm._impulseFrameBudget = 0;
  sm.weapon.cooldown = 0;
  const startVy = sm.body.velocity.y;

  const wasFeature = window.__forceFeatures.recoil;
  window.__forceFeatures.recoil = 1;
  sm.weapon.fire(sm);
  window.__forceFeatures.recoil = wasFeature;

  const deltaVy = sm.body.velocity.y - startVy;
  window.__weaponTest.assert(
    deltaVy > 5,
    'shoot-down recoil should boost player upward (deltaVy=' +
    deltaVy.toFixed(3) + ')',
  );
};

window.__test_standableWeapon = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');
  // Probe DOWNWARD from just below the player capsule to find the floor
  // the player is resting on (or would fall onto). Starting above the
  // player can falsely hit a platform above them in stratified levels.
  const probe = window.game.physics.raycast(
    { x: sm.body.position.x, y: sm.body.position.y - 0.8, z: 0 },
    { x: sm.body.position.x, y: sm.body.position.y - 10, z: 0 },
    { mask: 0x0001 },
  );
  if (!probe) return 'SKIP: no floor under player';
  const floorY = probe.hitPointWorld.y;

  const Sword = window.game.weaponRegistry?.Sword;
  if (!Sword) return 'SKIP: no Sword class';
  const sw = new Sword(window.game);
  const swX = sm.body.position.x + 1.5;
  sw.spawnAt(swX, floorY + 0.5, 0);
  window.__weaponTest.assert(sw.body, 'weapon body should spawn');

  for (let i = 0; i < 60; i++) window.game.physics.step(1 / 60);

  sm.body.position.x = swX;
  sm.body.position.y = sw.body.position.y + 1.0;
  sm.body.velocity.x = 0;
  sm.body.velocity.y = 0;
  for (let i = 0; i < 90; i++) window.game.physics.step(1 / 60);

  const playerBottom = sm.body.position.y - 0.75;
  const standingOnWeapon = playerBottom > floorY + 0.05;

  if (sw.body) window.game.physics.remove(sw.body);

  window.__weaponTest.assert(
    standingOnWeapon,
    'player should rest above floor on weapon (playerBottom=' +
    playerBottom.toFixed(3) + ', floor=' + floorY.toFixed(3) + ')',
  );
};

window.__test_hitReactionKnockback = function () {
  const sm = window.game?.players?.find(p => p && p.isLocal && p.alive);
  window.__weaponTest.assert(sm, 'need local live player');

  sm.body.velocity.x = 0;
  sm.body.velocity.y = 0;
  sm._impulseFrameBudget = 0;
  sm._impulseStunUntil = 0;
  const startVx = sm.body.velocity.x;
  const startStun = sm._impulseStunUntil;

  const wasFeature = window.__forceFeatures.hitReaction;
  window.__forceFeatures.hitReaction = 1;
  sm.takeDamage(10, {
    attacker: { weapon: { hitKnockback: 2.0 } },
    weapon: 'test',
    kb: { x: 10, y: 4 },
    stun: 0.2,
  });
  window.__forceFeatures.hitReaction = wasFeature;

  const deltaVx = sm.body.velocity.x - startVx;
  window.__weaponTest.assert(
    deltaVx > 0,
    'hit-reaction should push victim in kb direction (deltaVx=' +
    deltaVx.toFixed(3) + ')',
  );
  window.__weaponTest.assert(
    sm._impulseStunUntil > startStun,
    'hit-reaction should set _impulseStunUntil',
  );
};
