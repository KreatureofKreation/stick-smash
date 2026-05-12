// cannon-es API shim backed by Rapier (3D, WASM).
// Drop-in for the small subset of cannon-es our game uses.
// All existing `import * as CANNON from 'cannon-es'` code keeps working.

import RAPIER from '@dimforge/rapier3d-compat';

let RAPIER_READY = false;
export async function initRapier() {
  if (RAPIER_READY) return RAPIER;
  await RAPIER.init();
  RAPIER_READY = true;
  return RAPIER;
}
export function rapierReady() { return RAPIER_READY; }

// === Math types ===

export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setZero() { this.x = 0; this.y = 0; this.z = 0; return this; }
  copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  scale(s, target) {
    const t = target || new Vec3();
    t.x = this.x * s; t.y = this.y * s; t.z = this.z * s;
    return t;
  }
  vadd(o, target) { const t = target || new Vec3(); t.x = this.x + o.x; t.y = this.y + o.y; t.z = this.z + o.z; return t; }
  vsub(o, target) { const t = target || new Vec3(); t.x = this.x - o.x; t.y = this.y - o.y; t.z = this.z - o.z; return t; }
}

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; this.w = o.w; return this; }
  setFromAxisAngle(axis, ang) {
    const half = ang * 0.5, s = Math.sin(half);
    this.x = axis.x * s; this.y = axis.y * s; this.z = axis.z * s; this.w = Math.cos(half);
    return this;
  }
}

// === Materials ===
// Rapier sets friction/restitution per-collider. We track material identity
// here, then ContactMaterial registrations resolve combined values when a
// body is added to the world.
export class Material {
  constructor(name = '') {
    this.name = name;
    this.friction = -1;       // -1 = use ContactMaterial pair lookup
    this.restitution = 0;
    this.id = Material._nextId++;
  }
}
Material._nextId = 0;

export class ContactMaterial {
  constructor(matA, matB, opts = {}) {
    this.materials = [matA, matB];
    this.friction = opts.friction ?? 0;
    this.restitution = opts.restitution ?? 0;
    this.contactEquationStiffness = opts.contactEquationStiffness ?? 1e8;
    this.contactEquationRelaxation = opts.contactEquationRelaxation ?? 3;
  }
}

// === Shapes (lazy descriptors — actual Rapier collider built when added to body in World) ===

export const SHAPE_TYPES = { SPHERE: 1, BOX: 2, PLANE: 3, CYLINDER: 4 };

class Shape {
  constructor(kind) { this.kind = kind; }
}
export class Sphere extends Shape {
  constructor(radius) { super('sphere'); this.radius = radius; }
}
export class Box extends Shape {
  constructor(halfExtents) { super('box'); this.halfExtents = halfExtents; }
}
export class Cylinder extends Shape {
  constructor(rTop, rBot, height) { super('cylinder'); this.radius = (rTop + rBot) * 0.5; this.height = height; }
}
export class Plane extends Shape {
  constructor() { super('plane'); }
}

// === Body (tracks RigidBody + colliders, exposes cannon-es API) ===

export class Body {
  constructor(opts = {}) {
    this.mass = opts.mass ?? 0;
    this.material = opts.material ?? null;
    this._linearDamping = opts.linearDamping ?? 0.01;
    this._angularDamping = opts.angularDamping ?? 0.01;
    this._fixedRotation = !!opts.fixedRotation;
    this.allowSleep = opts.allowSleep ?? true;
    this._collisionFilterGroup = opts.collisionFilterGroup ?? 1;
    this._collisionFilterMask = opts.collisionFilterMask ?? 0xFFFF;
    this.collisionResponse = opts.collisionResponse ?? true;
    this.isTrigger = opts.isTrigger ?? false;
    this.userData = opts.userData ?? null;
    this._pendingShapes = [];   // [[shape, offset]]
    this._world = null;          // assigned by World.addBody
    this._rb = null;             // Rapier RigidBody
    this._colliders = [];        // Rapier Colliders
    this._collideFns = [];
    this._destroyed = false;
    this._forceAccum = { x: 0, y: 0, z: 0 };

    // cannon-es-style mutable position/velocity/angularVelocity/quaternion vectors.
    // We hold them as plain Vec3 / Quaternion. After each physics step the World
    // syncs them FROM Rapier (read), and at the start of the next step it pushes
    // them back TO Rapier (write). Code that does `body.velocity.x += 1` works.
    this.position = new Vec3(opts.position?.x ?? 0, opts.position?.y ?? 0, opts.position?.z ?? 0);
    this.velocity = new Vec3();
    this.angularVelocity = new Vec3();
    this.quaternion = new Quaternion();
    this.force = new Vec3();
  }

  addShape(shape, offset, orientation) {
    this._pendingShapes.push({ shape, offset: offset || new Vec3(), orientation: orientation || null });
    if (this._world) this._world._buildPendingColliders(this);
    return this;
  }

  addEventListener(ev, fn) {
    if (ev === 'collide') this._collideFns.push(fn);
  }
  removeEventListener(ev, fn) {
    if (ev === 'collide') {
      const i = this._collideFns.indexOf(fn);
      if (i >= 0) this._collideFns.splice(i, 1);
    }
  }
  _onCollide(other, contact) {
    for (const fn of this._collideFns) fn({ body: other, contact });
  }

  wakeUp() { this._rb?.wakeUp(); }
  sleep() { this._rb?.sleep(); }

  updateMassProperties() {
    // Mass is derived from collider density in Rapier. No-op compatibility.
  }

  // Compatibility for cannon-es body.type — return string or constant.
  get type() {
    if (!this._rb) return Body.STATIC;
    const t = this._rb.bodyType();
    if (t === RAPIER.RigidBodyType.Dynamic) return Body.DYNAMIC;
    if (t === RAPIER.RigidBodyType.Fixed) return Body.STATIC;
    return Body.KINEMATIC;
  }
  set type(v) {
    if (!this._rb) return;
    if (v === Body.DYNAMIC) this._rb.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    else if (v === Body.KINEMATIC) this._rb.setBodyType(RAPIER.RigidBodyType.KinematicVelocityBased, true);
    else this._rb.setBodyType(RAPIER.RigidBodyType.Fixed, true);
  }

  get linearDamping() { return this._linearDamping; }
  set linearDamping(v) { this._linearDamping = v; this._rb?.setLinearDamping(v); }
  get angularDamping() { return this._angularDamping; }
  set angularDamping(v) { this._angularDamping = v; this._rb?.setAngularDamping(v); }

  // Native per-body gravity scaling (cleaner than force-cancellation).
  setGravityScale(s) { this._rb?.setGravityScale(s, true); }
  get fixedRotation() { return this._fixedRotation; }
  set fixedRotation(v) {
    this._fixedRotation = v;
    if (this._rb) this._rb.lockRotations(v, true);
  }

  // Live collision filter — updates Rapier colliders immediately.
  get collisionFilterGroup() { return this._collisionFilterGroup; }
  set collisionFilterGroup(v) {
    this._collisionFilterGroup = v;
    this._applyCollisionGroups();
  }
  get collisionFilterMask() { return this._collisionFilterMask; }
  set collisionFilterMask(v) {
    this._collisionFilterMask = v;
    this._applyCollisionGroups();
  }
  _applyCollisionGroups() {
    const g = (((this._collisionFilterGroup & 0xFFFF) << 16) | (this._collisionFilterMask & 0xFFFF)) >>> 0;
    for (const c of this._colliders) {
      c.setCollisionGroups(g);
      c.setSolverGroups(g);
    }
  }

  pointToLocalFrame(p, target) {
    const t = target || new Vec3();
    t.x = p.x - this.position.x;
    t.y = p.y - this.position.y;
    t.z = p.z - this.position.z;
    return t;
  }

  pointToWorldFrame(p, target) {
    const t = target || new Vec3();
    t.x = p.x + this.position.x;
    t.y = p.y + this.position.y;
    t.z = p.z + this.position.z;
    return t;
  }
}
Body.DYNAMIC = 'dynamic';
Body.STATIC = 'static';
Body.KINEMATIC = 'kinematic';
Body.AWAKE = 0;

// === Constraints ===

export class PointToPointConstraint {
  constructor(bodyA, pivotA, bodyB, pivotB, maxForce) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    this.pivotA = pivotA?.clone ? pivotA.clone() : new Vec3(pivotA?.x ?? 0, pivotA?.y ?? 0, pivotA?.z ?? 0);
    this.pivotB = pivotB?.clone ? pivotB.clone() : new Vec3(pivotB?.x ?? 0, pivotB?.y ?? 0, pivotB?.z ?? 0);
    this.maxForce = maxForce ?? 1e6;
    this._joint = null;
    this._world = null;
  }
}

// === Broadphase (no-op shim — Rapier handles internally) ===
export class SAPBroadphase { constructor(world) { this.world = world; } }
export class NaiveBroadphase { constructor() {} }

// === RaycastResult ===
export class RaycastResult {
  constructor() {
    this.hasHit = false;
    this.hitPointWorld = new Vec3();
    this.hitNormalWorld = new Vec3(0, 1, 0);
    this.body = null;
    this.distance = 0;
  }
}

// === World ===
export class World {
  constructor(opts = {}) {
    if (!RAPIER_READY) throw new Error('Call initRapier() first.');
    this._gravity = new Vec3(opts.gravity?.x ?? 0, opts.gravity?.y ?? -9.81, opts.gravity?.z ?? 0);
    this._rapier = new RAPIER.World({ x: this._gravity.x, y: this._gravity.y, z: this._gravity.z });
    this._eventQueue = new RAPIER.EventQueue(true);
    this.broadphase = null;
    this.bodies = [];
    this.constraints = [];
    this._byHandle = new Map();      // rb.handle -> Body
    this._listeners = { preStep: [], postStep: [] };
    this.solver = { iterations: 8, tolerance: 0.001 };
    this._stepAccum = 0;
    this._fixedDt = 1 / 60;
    this.defaultContactMaterial = {
      friction: 0,
      restitution: 0,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 3,
    };
    this._contactMaterials = []; // ContactMaterial registrations
  }

  get gravity() { return this._gravity; }
  set gravity(g) {
    this._gravity.copy(g);
    this._rapier.gravity = { x: g.x, y: g.y, z: g.z };
  }

  addContactMaterial(cm) { this._contactMaterials.push(cm); }

  addEventListener(ev, fn) { (this._listeners[ev] ??= []).push(fn); }
  removeEventListener(ev, fn) {
    const l = this._listeners[ev];
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }

  addBody(body) {
    if (body._rb) return body;
    body._world = this;
    let desc;
    if (body.mass > 0) desc = RAPIER.RigidBodyDesc.dynamic();
    else desc = RAPIER.RigidBodyDesc.fixed();
    desc.setTranslation(body.position.x, body.position.y, body.position.z);
    desc.setRotation({ x: body.quaternion.x, y: body.quaternion.y, z: body.quaternion.z, w: body.quaternion.w });
    desc.setLinvel(body.velocity.x, body.velocity.y, body.velocity.z);
    desc.setLinearDamping(body.linearDamping);
    desc.setAngularDamping(body.angularDamping);
    if (body.fixedRotation) desc.lockRotations();
    if (body.allowSleep === false) desc.setCanSleep(false);
    body._rb = this._rapier.createRigidBody(desc);
    this._byHandle.set(body._rb.handle, body);
    this.bodies.push(body);
    this._buildPendingColliders(body);
    return body;
  }

  addConstraint(c) {
    if (!(c instanceof PointToPointConstraint)) return c;
    const jd = RAPIER.JointData.spherical(
      { x: c.pivotA.x, y: c.pivotA.y, z: c.pivotA.z },
      { x: c.pivotB.x, y: c.pivotB.y, z: c.pivotB.z },
    );
    c._joint = this._rapier.createImpulseJoint(jd, c.bodyA._rb, c.bodyB._rb, true);
    c._world = this;
    this.constraints.push(c);
    return c;
  }

  removeConstraint(c) {
    if (!c?._joint) return;
    try { this._rapier.removeImpulseJoint(c._joint, true); } catch (_) {}
    c._joint = null;
    const i = this.constraints.indexOf(c);
    if (i >= 0) this.constraints.splice(i, 1);
  }

  removeBody(body) {
    if (!body || body._destroyed) return;
    body._destroyed = true;
    // Remove constraints touching this body
    for (let i = this.constraints.length - 1; i >= 0; i--) {
      const c = this.constraints[i];
      if (c.bodyA === body || c.bodyB === body) this.removeConstraint(c);
    }
    if (body._rb) {
      this._byHandle.delete(body._rb.handle);
      try { this._rapier.removeRigidBody(body._rb); } catch (_) {}
    }
    body._rb = null;
    body._colliders.length = 0;
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  _shapeVolume(shape) {
    if (shape.kind === 'sphere') return (4 / 3) * Math.PI * shape.radius ** 3;
    if (shape.kind === 'box') return 8 * shape.halfExtents.x * shape.halfExtents.y * shape.halfExtents.z;
    if (shape.kind === 'cylinder') return Math.PI * shape.radius ** 2 * shape.height;
    if (shape.kind === 'plane') return 1;
    return 1;
  }

  // For each pending shape on body, create a Rapier collider with appropriate
  // friction/restitution + density tuned to match target body mass.
  _buildPendingColliders(body) {
    if (!body._rb) return;
    if (body._pendingShapes.length === 0) return;
    let totalV = 0;
    for (const ps of body._pendingShapes) totalV += this._shapeVolume(ps.shape);
    const density = (body.mass > 0 && totalV > 0) ? (body.mass / totalV) : 0;
    while (body._pendingShapes.length) {
      const { shape, offset } = body._pendingShapes.shift();
      let cdesc;
      if (shape.kind === 'sphere') cdesc = RAPIER.ColliderDesc.ball(shape.radius);
      else if (shape.kind === 'box') {
        const he = shape.halfExtents;
        cdesc = RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z);
      } else if (shape.kind === 'cylinder') {
        cdesc = RAPIER.ColliderDesc.cylinder(shape.height / 2, shape.radius);
      } else if (shape.kind === 'plane') {
        cdesc = RAPIER.ColliderDesc.cuboid(500, 0.1, 500);
      } else continue;
      cdesc.setTranslation(offset.x, offset.y, offset.z);
      const mat = body.material;
      const { friction, restitution } = this._resolveMat(mat);
      cdesc.setFriction(friction);
      cdesc.setRestitution(restitution);
      cdesc.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
      cdesc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
      cdesc.setDensity(density);
      if (body.isTrigger) cdesc.setSensor(true);
      const groups = (((body._collisionFilterGroup & 0xFFFF) << 16) | (body._collisionFilterMask & 0xFFFF)) >>> 0;
      cdesc.setCollisionGroups(groups);
      cdesc.setSolverGroups(groups);
      cdesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const c = this._rapier.createCollider(cdesc, body._rb);
      body._colliders.push(c);
    }
  }

  _resolveMat(mat) {
    if (!mat) return { friction: this.defaultContactMaterial.friction, restitution: this.defaultContactMaterial.restitution };
    // Use the material's intrinsic friction/restitution directly.
    // Rapier combines colliders' values via CoefficientCombineRule.Min/Max,
    // approximating cannon-es ContactMaterial pair lookups.
    const f = mat.friction >= 0 ? mat.friction : this.defaultContactMaterial.friction;
    const r = mat.restitution >= 0 ? mat.restitution : this.defaultContactMaterial.restitution;
    return { friction: f, restitution: r };
  }

  raycastClosest(from, to, opts, result) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    result.hasHit = false;
    if (len < 1e-5) return result;
    const dirX = dx / len, dirY = dy / len, dirZ = dz / len;
    // Reuse a single Ray per world to avoid leaking WASM Ray instances each
    // call (also avoids the recursive-borrow panic in some Rapier versions).
    if (!this._ray) this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this._ray.origin.x = from.x; this._ray.origin.y = from.y; this._ray.origin.z = from.z;
    this._ray.dir.x = dirX; this._ray.dir.y = dirY; this._ray.dir.z = dirZ;
    // Translate cannon-style collisionFilterMask into Rapier's interactionGroups
    // (top 16 bits = membership, bottom 16 = filter). Without this the shim
    // ignores masks and ground-checks hit other players, causing false grounded.
    const mask = (opts && (opts.collisionFilterMask ?? opts.mask)) ?? 0xFFFF;
    const filterGroups = (((0xFFFF) << 16) | (mask & 0xFFFF)) >>> 0;
    // castRayAndGetNormal returns the actual hit normal (cannon-es contract).
    // castRay alone gives only the distance, which forced a (0,1,0) placeholder
    // — that broke any consumer that needs the wall normal (Weapon.updateMesh
    // wall reorient, etc.).
    const hit = this._rapier.castRayAndGetNormal(this._ray, len, true, undefined, filterGroups);
    if (hit) {
      // Rapier 0.14 renamed `toi` → `timeOfImpact`. Read both for safety.
      const toi = hit.timeOfImpact ?? hit.toi;
      if (toi >= 0) {
        result.hasHit = true;
        result.distance = toi;
        result.hitPointWorld.set(from.x + dirX * toi, from.y + dirY * toi, from.z + dirZ * toi);
        const n = hit.normal;
        if (n) result.hitNormalWorld.set(n.x, n.y, n.z);
        else result.hitNormalWorld.set(0, 1, 0);
        result.body = null;
      }
    }
    return result;
  }

  // Fixed-timestep accumulator — Rapier expects a consistent dt for stability,
  // and a 144Hz frame rate must NOT advance physics 2.4× faster than 60Hz.
  step(dt) {
    const fixedDt = this._fixedDt;
    this._rapier.timestep = fixedDt;
    this._stepAccum += Math.min(dt, 0.1);   // clamp huge dt (tab-switch resume)
    const maxSubs = 4;
    let subs = 0;
    while (this._stepAccum >= fixedDt && subs < maxSubs) {
      this._stepOnce();
      this._stepAccum -= fixedDt;
      subs++;
    }
    if (this._stepAccum > fixedDt * maxSubs) this._stepAccum = 0;
  }

  _stepOnce() {
    // 1) Push wrapper pos/vel/rotation → Rapier.
    for (const b of this.bodies) {
      if (!b._rb) continue;
      const rb = b._rb;
      const t = rb.translation();
      if (t.x !== b.position.x || t.y !== b.position.y || t.z !== b.position.z) {
        rb.setTranslation({ x: b.position.x, y: b.position.y, z: b.position.z }, true);
      }
      const v = rb.linvel();
      if (v.x !== b.velocity.x || v.y !== b.velocity.y || v.z !== b.velocity.z) {
        rb.setLinvel({ x: b.velocity.x, y: b.velocity.y, z: b.velocity.z }, true);
      }
      const a = rb.angvel();
      if (a.x !== b.angularVelocity.x || a.y !== b.angularVelocity.y || a.z !== b.angularVelocity.z) {
        rb.setAngvel({ x: b.angularVelocity.x, y: b.angularVelocity.y, z: b.angularVelocity.z }, true);
      }
      const q = rb.rotation();
      if (q.x !== b.quaternion.x || q.y !== b.quaternion.y || q.z !== b.quaternion.z || q.w !== b.quaternion.w) {
        rb.setRotation({ x: b.quaternion.x, y: b.quaternion.y, z: b.quaternion.z, w: b.quaternion.w }, true);
      }
    }
    // 2) preStep hooks may add more body.force (gravity cancellation etc).
    for (const fn of (this._listeners.preStep || [])) fn();
    // 3) Apply accumulated wrapper.force to Rapier and clear.
    for (const b of this.bodies) {
      if (!b._rb) continue;
      if (b.force.x || b.force.y || b.force.z) {
        b._rb.addForce({ x: b.force.x, y: b.force.y, z: b.force.z }, true);
        b.force.x = 0; b.force.y = 0; b.force.z = 0;
      }
    }
    // 4) Step physics.
    this._rapier.step(this._eventQueue);
    // Drain collide events
    this._eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const c1 = this._rapier.getCollider(h1);
      const c2 = this._rapier.getCollider(h2);
      const b1 = c1 ? this._byHandle.get(c1.parent()?.handle) : null;
      const b2 = c2 ? this._byHandle.get(c2.parent()?.handle) : null;
      if (b1 && b2) {
        b1._onCollide(b2);
        b2._onCollide(b1);
      }
    });
    // Sync Rapier → wrapper vectors (so reads after step are accurate).
    for (const b of this.bodies) {
      if (!b._rb) continue;
      const t = b._rb.translation();
      b.position.x = t.x; b.position.y = t.y; b.position.z = t.z;
      const v = b._rb.linvel();
      b.velocity.x = v.x; b.velocity.y = v.y; b.velocity.z = v.z;
      const a = b._rb.angvel();
      b.angularVelocity.x = a.x; b.angularVelocity.y = a.y; b.angularVelocity.z = a.z;
      const q = b._rb.rotation();
      b.quaternion.x = q.x; b.quaternion.y = q.y; b.quaternion.z = q.z; b.quaternion.w = q.w;
    }
    for (const fn of (this._listeners.postStep || [])) fn();
  }

  // Helper used by code that wants to find bodies in a sphere (cannon-es had no
  // direct equivalent — our PhysicsWorld layer used to iterate world.bodies).
}

// Default exported namespace mirroring `import * as CANNON from 'cannon-es'`.
// (Already covered by the named exports above.)

export default { Vec3, Quaternion, Material, ContactMaterial, Body, World, Sphere, Box, Cylinder, Plane, PointToPointConstraint, SAPBroadphase, NaiveBroadphase, RaycastResult };
