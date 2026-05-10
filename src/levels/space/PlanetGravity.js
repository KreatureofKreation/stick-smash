import * as CANNON from 'cannon-es';

// Outer Wilds-style gravity zones:
//   - INVERSE-LINEAR pull: a = G * mass / r. Firmer at surface than constant
//     magnitude, doesn't spike like 1/r², and naturally tapers toward the
//     halo edge for smooth re-capture of drifting bodies.
//   - SINGLE dominant planet at a time per body. Picked by closest center
//     so dense small planets keep their grip in halo overlaps.
//   - GROUNDED players get a 1.3× stick bonus so micro-bumps from sphere
//     contact don't accumulate into orbital escape.
//
// Tuning per planet via the level config's `mass` field. With G = 1.0,
// surface gravity = mass / radius. So a r=5 planet needing surface a=12
// uses mass=60. Small asteroids can run hotter (higher mass relative to
// radius) without becoming overpowering at distance because the linear
// falloff bleeds the pull.

export function makePlanetGravity(level, game) {
  const G = 1.0;             // global tuning constant
  const STICK_BONUS = 1.0;   // grounded multiplier (1.0 = off; raise once solver is stable)
  return function applyPlanetGravity() {
    const planets = level.planets;
    if (!planets.length) return;
    const pickPlanet = (px, py) => {
      let best = null, bestD2 = Infinity;
      for (const p of planets) {
        const dx = p.cx - px, dy = p.cy - py;
        const d2 = dx * dx + dy * dy;
        if (d2 > p.haloRadius * p.haloRadius) continue;
        if (d2 < bestD2) { bestD2 = d2; best = p; }
      }
      return best;
    };
    const applyTo = (body, isPlayer = false) => {
      if (!body || body.mass === 0) return;
      const planet = pickPlanet(body.position.x, body.position.y);
      if (!planet) return;
      const dx = planet.cx - body.position.x;
      const dy = planet.cy - body.position.y;
      const r = Math.hypot(dx, dy);
      if (r < 0.05) return;          // singularity guard
      // Inverse-linear: a = G * mass / r. No 1/r² blow-up.
      let aMag = (G * (planet.mass ?? 60)) / r;
      if (isPlayer && body.userData?.stickman?.grounded) aMag *= STICK_BONUS;
      const ux = dx / r, uy = dy / r;
      body.force.x += body.mass * ux * aMag;
      body.force.y += body.mass * uy * aMag;
    };
    for (const b of level.physics.world.bodies) {
      if (b.type !== CANNON.Body.DYNAMIC) continue;
      if (b.userData?.kind === 'projectile') continue;
      applyTo(b, b.userData?.kind === 'player');
    }
    if (game?.projectiles) {
      for (const pr of game.projectiles) {
        if (pr.dead || !pr.body) continue;
        applyTo(pr.body, false);
      }
    }
  };
}
