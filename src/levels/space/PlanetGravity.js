import * as CANNON from 'cannon-es';

// Tunables exposed on window.__planet for live in-browser tuning.
const DEFAULTS = {
  PROJECTILE_PULL_DEFAULT: 15,   // m/s² inside halo, per planet
  EDGE_TAPER_FRAC: 0.10,         // last 10% of halo radius tapers from full → 0
  DEBRIS_MUL: 0.5,               // softer pull for crates/ragdoll/debris bodies
  // Player-side magnetic-gravity tunables (read by Stickman._movePlanetMagnetic).
  JUMP_DOWN_ACCEL: 30,           // scripted "down" accel during a player jump
  AIR_ACCEL: 18,                 // mid-air tangential accel (rad/s²)
  ROT_SLERP_RATE: 12,            // rad/s body quaternion align to local up
  LAUNCH_MIN_KB: 6,              // m/s knockback magnitude that triggers launched
  LAUNCH_DRAG: 0.98,             // per-60Hz-frame velocity multiplier in launched
  RETURN_ACCEL: 40,              // m/s² pull during returning
  RETURN_VEL_CAP: 25,            // m/s speed cap during returning
};
if (typeof window !== 'undefined') {
  window.__planet = Object.assign({}, DEFAULTS, window.__planet || {});
}

// Constant-pull halo gravity for NON-PLAYER dynamic bodies. Players are driven
// by the magnetic state machine in Stickman._move (no physics force).
//
// Per body: sum over each planet of:
//   if r >= haloRadius:   contribution = 0
//   else:                 contribution = pullStrength * taper * unit(planet.center - body)
//   taper = 1 inside the inner 90% of halo, linearly drops to 0 over outer 10%.
// Debris-style bodies (crates, ragdoll segments) multiply pull by DEBRIS_MUL so
// they settle instead of orbiting forever.
export function makeProjectileGravity(level, game) {
  return function applyProjectileGravity() {
    const planets = level.planets;
    if (!planets.length) return;
    const T = window.__planet ?? DEFAULTS;
    const taperFrac = T.EDGE_TAPER_FRAC ?? 0.10;
    const debrisMul = T.DEBRIS_MUL ?? 0.5;

    const applyTo = (body, mul) => {
      if (!body || body.mass === 0 || body._rb?.isSleeping?.()) return;
      let fx = 0, fy = 0;
      for (const p of planets) {
        const dx = p.cx - body.position.x;
        const dy = p.cy - body.position.y;
        const r = Math.hypot(dx, dy);
        if (r < 0.05) continue;
        if (r >= p.haloRadius) continue;
        const t = r / p.haloRadius;
        let k = 1;
        if (t > 1 - taperFrac) k = (1 - t) / taperFrac;
        const a = (p.pullStrength ?? T.PROJECTILE_PULL_DEFAULT) * k * mul;
        const inv = 1 / r;
        fx += dx * inv * a;
        fy += dy * inv * a;
      }
      body.force.x += body.mass * fx;
      body.force.y += body.mass * fy;
    };

    for (const b of level.physics.world.bodies) {
      if (b.type !== CANNON.Body.DYNAMIC) continue;
      const kind = b.userData?.kind;
      if (kind === 'player') continue;            // players are scripted, not forced
      if (kind === 'projectile') continue;        // handled below from game.projectiles
      // crates, ragdoll segments, meteor bodies registered as DYNAMIC fall here
      applyTo(b, debrisMul);
    }
    if (game?.projectiles) {
      for (const pr of game.projectiles) {
        if (pr.dead || !pr.body) continue;
        applyTo(pr.body, 1.0);
      }
    }
  };
}
