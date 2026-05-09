import * as CANNON from 'cannon-es';

// Returns a per-step callback that applies summed planet gravity to every
// dynamic body in the world AND every active projectile in `game`. The same
// callback is used for both pre-step physics integration and projectile arc.
export function makePlanetGravity(level, game) {
  const G = 1.5;                  // tuning constant
  return function applyPlanetGravity() {
    const planets = level.planets;
    if (!planets.length) return;
    // Helper: accumulate summed gravitational FORCE (= mass × accel) onto
    // body.force. The cannon-shim's _stepOnce reads body.force AFTER preStep
    // listeners run and applies it via Rapier.addForce. Writing to
    // body.velocity here would be clobbered because the shim already pushed
    // velocity → Rapier earlier in _stepOnce.
    const applyTo = (body) => {
      if (!body || body.mass === 0) return;
      let ax = 0, ay = 0;
      for (const p of planets) {
        const dx = p.cx - body.position.x;
        const dy = p.cy - body.position.y;
        const r2 = dx * dx + dy * dy;
        if (r2 > p.haloRadius * p.haloRadius) continue;
        if (r2 < 0.04) continue;          // avoid singularity inside core
        const r = Math.sqrt(r2);
        const a = G * p.mass / r2;
        ax += (dx / r) * a;
        ay += (dy / r) * a;
      }
      // Clamp summed acceleration so overlapping halos / near-singularity
      // pulls can't yeet a body across the map. ~25 m/s² is roughly 2.5G —
      // strong enough to feel weighty, gentle enough to keep play in frame.
      const aMag = Math.hypot(ax, ay);
      const aMax = 25;
      if (aMag > aMax) {
        const k = aMax / aMag;
        ax *= k;
        ay *= k;
      }
      body.force.x += body.mass * ax;
      body.force.y += body.mass * ay;
    };
    // 1. Every dynamic body in the world EXCEPT projectiles (handled below).
    for (const b of level.physics.world.bodies) {
      if (b.type !== CANNON.Body.DYNAMIC) continue;
      if (b.userData?.kind === 'projectile') continue;
      applyTo(b);
    }
    // 2. Every active projectile (host-side; clients use snapshot interp).
    // Override per-projectile gravity flag — every projectile arcs here.
    if (game?.projectiles) {
      for (const pr of game.projectiles) {
        if (pr.dead || !pr.body) continue;
        applyTo(pr.body);
      }
    }
  };
}
