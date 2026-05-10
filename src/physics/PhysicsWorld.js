import * as CANNON from 'cannon-es';

export const COL_GROUPS = {
  WORLD: 1,
  PLAYER: 2,
  PROP: 4,
  WEAPON: 8,
  HAZARD: 16,
  GRABBED: 32,
  PROJECTILE: 64,
  // Chains: hanging chains and pendulum links. Players pass through them
  // (mask intentionally excludes PLAYER) but projectiles, melee swings, and
  // other chain segments collide so chains can be shot apart.
  CHAIN: 128,
};

export const PHYS_STEP = 1 / 60;

// Build a small set of Materials with intrinsic friction values. The shim
// (cannon-shim.js) reads these directly when building Rapier colliders, with
// MIN combine — so any pair involving the player ends up frictionless.
function mkMat(name, friction, restitution = 0) {
  const m = new CANNON.Material(name);
  m.friction = friction;
  m.restitution = restitution;
  return m;
}

export class PhysicsWorld {
  constructor() {
    // Mid-weight brawler gravity (between heavy 28 and floaty 17).
    this.world = new CANNON.World({ gravity: { x: 0, y: -22, z: 0 } });
    this.world.solver.iterations = 16;
    this.world.solver.tolerance = 0.001;
    this.world.defaultContactMaterial.friction = 0;
    this.world.defaultContactMaterial.restitution = 0.05;

    this.materials = {
      ground: mkMat('ground', 0.5),
      player: mkMat('player', 0),       // zero friction → predictable movement (Stickman handles decel)
      prop:   mkMat('prop',   0.4, 0.1),
      slick:  mkMat('slick',  0.02),
      bouncy: mkMat('bouncy', 0.3, 1.5),
      // Grenade-like projectiles. Restitution 0.55 + Rapier MAX combine rule
      // means bombs bounce on any surface even if the surface itself has 0
      // restitution (stone tiles, ground). Friction is moderate so they slow
      // and roll instead of skating forever.
      grenade: mkMat('grenade', 0.45, 0.55),
    };

    this.bodies = new Set();
    this._tickCallbacks = [];
    this._preStepFns = [];

    // Rapier handles preStep/postStep via the shim's listeners.
    this.world.addEventListener('preStep', () => {
      for (const fn of this._preStepFns) fn();
    });
    // Z-axis lock: keep all dynamic bodies on the gameplay plane (z=0).
    this.world.addEventListener('postStep', () => {
      for (const b of this.world.bodies) {
        if (b.type !== CANNON.Body.DYNAMIC) continue;
        if (b.position.z !== 0) b.position.z = 0;
        if (b.velocity.z !== 0) b.velocity.z = 0;
        if (b.angularVelocity.x !== 0) b.angularVelocity.x = 0;
        if (b.angularVelocity.y !== 0) b.angularVelocity.y = 0;
      }
    });
  }

  addPreStep(fn) { this._preStepFns.push(fn); }
  removePreStep(fn) { const i = this._preStepFns.indexOf(fn); if (i >= 0) this._preStepFns.splice(i, 1); }

  add(body) { this.world.addBody(body); this.bodies.add(body); return body; }
  remove(body) {
    if (!this.bodies.has(body)) return;
    const cs = this.world.constraints.slice();
    for (const c of cs) if (c.bodyA === body || c.bodyB === body) this.world.removeConstraint(c);
    this.world.removeBody(body);
    this.bodies.delete(body);
  }

  addConstraint(c) { this.world.addConstraint(c); return c; }
  removeConstraint(c) { try { this.world.removeConstraint(c); } catch (_) {} }

  onTick(fn) { this._tickCallbacks.push(fn); }

  step(dt) {
    for (const fn of this._tickCallbacks) fn(dt);
    // Pass REAL frame dt to the shim — it owns the fixed-step accumulator.
    this.world.step(dt);
  }

  raycast(from, to, opts = {}) {
    const result = new CANNON.RaycastResult();
    this.world.raycastClosest(
      { x: from.x, y: from.y, z: from.z },
      { x: to.x, y: to.y, z: to.z },
      { collisionFilterMask: opts.mask ?? 0xFFFF, skipBackfaces: true },
      result,
    );
    return result.hasHit ? result : null;
  }

  // O(n) sphere overlap over all bodies.
  overlapSphere(pos, radius, mask = 0xFFFF) {
    const r2 = radius * radius;
    const hits = [];
    for (const b of this.world.bodies) {
      if (!(b.collisionFilterGroup & mask)) continue;
      const dx = b.position.x - pos.x, dy = b.position.y - pos.y, dz = b.position.z - pos.z;
      if (dx * dx + dy * dy + dz * dz <= r2 + 1) hits.push(b);
    }
    return hits;
  }
}
