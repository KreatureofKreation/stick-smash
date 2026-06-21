import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { COL_GROUPS } from '../physics/PhysicsWorld.js';
import { audio } from '../audio/Audio.js';
import { rand } from '../util/math.js';
import { Planet } from './space/Planet.js';
import { makeProjectileGravity } from './space/PlanetGravity.js';
import { MeteorShower } from './space/MeteorShower.js';

// Level = grid of destructible tiles + static walls + hazards + spawn points + sky.

const TILE = 1;

export class Tile {
  constructor(level, x, y, opts = {}) {
    this.level = level;
    this.gx = x; this.gy = y;
    this.hp = opts.hp ?? 30;
    this.maxHp = this.hp;
    this.indestructible = !!opts.indestructible;
    this.material = opts.material ?? 'stone';
    this.color = opts.color ?? this._colorFor(this.material);
    this.emissive = opts.emissive ?? null;
    this.emissiveIntensity = opts.emissiveIntensity ?? 0;
    this.shape = opts.shape || 'box';
    this.w = opts.w ?? 1;
    this.h = opts.h ?? 1;
    this.d = opts.d ?? 1;
    this.radius = opts.radius;
    this.dynamic = !!opts.dynamic;
    this.tileMass = opts.tileMass;
    // Optional chain suspension: tile starts static, hung from a static
    // anchor by N chain links. When the chain is severed, the tile falls.
    // Spec: { x, y, segs?: number, hp?: number, mass?: number }
    this.chainAnchor = opts.chainAnchor || null;
    // Optional Z-axis rotation (radians) for tilted decorative shards (e.g., crystal spire).
    // Applied to both the physics body and mesh before the static-tile matrix bake.
    this.rotZ = opts.rotZ ?? 0;
    // Optional parent-tile reference for stacked/segmented props (e.g. crystal
    // spire sections). Format: 'x,y' string matching another tile's key. When
    // the parent tile is destroyed (or itself made dynamic), this child is
    // converted to a falling dynamic body via Level._dropSuspendedTile, and
    // the cascade recurses into this child's own children.
    this.parentTileKey = opts.parentTileKey ?? null;
    this._children = new Set();
    this._dropped = false;
    this.body = null;
    this.mesh = null;
    this._chainSuspension = null;  // { anchorBody, segs:[], constraints:[] }
  }
  _colorFor(mat) {
    return ({ stone: 0x7a808c, wood: 0xa86a3a, ice: 0xbce8ff, bouncy: 0x88e8b8, dirt: 0x8a5530, metal: 0x6a7080 })[mat] ?? 0x7a808c;
  }
  build(scene, world) {
    const x = this.gx * TILE, y = this.gy * TILE;
    const matMap = { ice: world.materials.slick, bouncy: world.materials.bouncy };
    const phyMat = matMap[this.material] ?? world.materials.ground;

    const shape = this.shape || 'box';
    const w = this.w ?? 1;
    const h = this.h ?? 1;
    const d = this.d ?? 1;
    const dyn = !!this.dynamic;

    const body = new CANNON.Body({
      mass: dyn ? (this.tileMass ?? 8) : 0,
      material: phyMat,
      linearDamping: dyn ? 0.2 : 0.01,
      angularDamping: dyn ? 0.5 : 0.01,
      fixedRotation: dyn ? false : true,
      collisionFilterGroup: COL_GROUPS.WORLD,
      collisionFilterMask: -1,
    });

    let geo;
    if (shape === 'sphere') {
      const r = this.radius ?? Math.min(w, h) / 2;
      geo = new THREE.SphereGeometry(r, 16, 12);
      body.addShape(new CANNON.Sphere(r));
    } else if (shape === 'cylinder') {
      const r = this.radius ?? w / 2;
      geo = new THREE.CylinderGeometry(r, r, h, 14);
      body.addShape(new CANNON.Cylinder(r, r, h));
    } else {
      // 'box', 'pillar', 'plate', 'wide', 'tall' all use a cuboid with custom dims.
      geo = new THREE.BoxGeometry(w, h, d);
      body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
    }
    body.position.set(x, y, 0);
    // fixedRotation prevents the solver from spinning the body but the
    // initial quaternion (set before world.add) is used to orient the
    // collision shape — so static tiles with rotZ are physically rotated.
    if (this.rotZ) body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), this.rotZ);
    body.userData = { kind: 'tile', tile: this };
    world.add(body);
    this.body = body;
    this.dynamic = dyn;

    const mat = new THREE.MeshLambertMaterial({
      color: this.color,
      emissive: this.emissive ?? 0x000000,
      emissiveIntensity: this.emissiveIntensity,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, 0);
    if (this.rotZ) mesh.rotation.z = this.rotZ;
    // Tile shadow cast: full quality casts on all tiles. lowQ casts only
    // dynamic tiles (crates) since static platforms casting onto each
    // other doubled the shadow-pass scene (100+ tile draws). Statics
    // still receive shadows either way.
    const lowQ = !!this.level?.game?._lowQ;
    mesh.castShadow = lowQ ? dyn : true;
    mesh.receiveShadow = true;
    // Static tiles never move — bake the matrix once and skip per-frame
    // updateMatrix() in the renderer's traverse. Saves N matrix multiplies
    // every frame across hundreds of tiles per level.
    if (!dyn) {
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
    }
    scene.add(mesh);
    this.mesh = mesh;

    if (dyn) this.level._dynamicTiles.add(this);

    // Chain suspension: hang this (static) tile from a static anchor via N
    // chain link bodies. The tile remains static until any chain seg is
    // destroyed; severing the chain converts the tile to a dynamic body so
    // it falls naturally.
    if (this.chainAnchor) this.level._suspendTile(this, this.chainAnchor);
  }
  damage(amount, by) {
    if (this.indestructible) return false;
    this.hp -= amount;
    // Visual: tint darker as damaged. Lerp on the material color in place
    // — previous impl allocated two THREE.Color objects per hit and queued
    // a setTimeout closure for the scale-pulse reset, both visible in GC
    // pressure during sustained fights.
    const f = Math.max(0, this.hp / this.maxHp);
    if (this.mesh) {
      if (!this._tintBase) {
        this._tintBase = new THREE.Color(this.color);
        this._tintDark = new THREE.Color(0x111111);
      }
      this.mesh.material.color.copy(this._tintBase).lerp(this._tintDark, 1 - f);
    }
    if (this.hp <= 0) {
      this.destroy();
      return true;
    }
    return false;
  }
  destroy() {
    const x = this.body?.position?.x ?? this.gx * TILE;
    const y = this.body?.position?.y ?? this.gy * TILE;
    // Cascade: drop any tiles that named this one as their parent. Each
    // child becomes dynamic and will recursively drop its own children via
    // Level._dropSuspendedTile.
    if (this._children?.size > 0) {
      for (const child of this._children) this.level._dropSuspendedTile(child);
      this._children.clear();
    }
    // Tear down chain suspension first — sever every chain seg + the anchor
    // mesh/body, then remove the constraint chain. The seg destroys also
    // clean up their own constraints.
    if (this._chainSuspension) {
      const cs = this._chainSuspension;
      for (const c of cs.constraints) this.level.physics.removeConstraint(c);
      cs.constraints.length = 0;
      for (const seg of cs.segs) seg.destroy();
      if (cs.anchorBody) this.level.physics.remove(cs.anchorBody);
      if (cs.anchorMesh?.parent) cs.anchorMesh.parent.remove(cs.anchorMesh);
      this._chainSuspension = null;
    }
    if (this.mesh) {
      this.level.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    if (this.body) {
      this.level.physics.remove(this.body);
      this.body = null;
    }
    this.level._dynamicTiles?.delete(this);
    this.level.fx.particles.debris(x, y, 0, this.color, 14);
    audio.break();
    this.level.tiles.delete(this._key);
  }
}

// =============================================================================
// ChainSeg — a single physics-driven chain link. Lives in COL_GROUPS.CHAIN so
// player capsules pass straight through, but projectiles, melee hits, and
// other chain segs collide with it. Has its own HP; when destroyed it removes
// every constraint that referenced it (severing the chain) and fires an
// optional onBreak callback (used by hanging platforms to drop).
// =============================================================================
export class ChainSeg {
  constructor(level, body, mesh, hp = 18) {
    this.level = level;
    this.body = body;
    this.mesh = mesh;
    this.hp = hp;
    this.maxHp = hp;
    this.constraints = [];
    this.onBreak = null;
    this.dead = false;
    body.userData = { kind: 'chain', seg: this };
  }
  damage(amount, by) {
    if (this.dead) return false;
    this.hp -= amount;
    if (this.mesh) {
      const f = Math.max(0, this.hp / this.maxHp);
      if (!this._tintBase) {
        this._tintBase = new THREE.Color(0x444455);
        this._tintDark = new THREE.Color(0x884422);
      }
      this.mesh.material.color.copy(this._tintBase).lerp(this._tintDark, 1 - f);
    }
    if (this.hp <= 0) { this.destroy(); return true; }
    return false;
  }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    for (const c of this.constraints) this.level.physics.removeConstraint(c);
    this.constraints.length = 0;
    if (this.body) {
      this.level.physics.remove(this.body);
      this.body = null;
    }
    if (this.mesh) {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.mesh.geometry?.dispose();
      this.mesh.material?.dispose();
      this.mesh = null;
    }
    this.level._chainSegs?.delete(this);
    if (this.onBreak) {
      try { this.onBreak(); } catch (_) {}
      this.onBreak = null;
    }
  }
}

export class Hazard {
  constructor(level, opts) {
    this.level = level;
    this.kind = opts.kind;
    this.x = opts.x; this.y = opts.y;
    this.w = opts.w ?? 1; this.h = opts.h ?? 0.4;
    this.dps = opts.dps ?? 30;
    this.kb = opts.kb ?? { x: 0, y: 14 };
    this._build(opts);
  }
  _build(opts) {
    const scene = this.level.scene;
    const world = this.level.physics;
    if (this.kind === 'lava') {
      const geo = new THREE.BoxGeometry(this.w, this.h, 1.1);
      const mat = new THREE.MeshLambertMaterial({ color: 0xff4400, emissive: 0xff6600, emissiveIntensity: 1 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(this.x, this.y, 0);
      scene.add(m);
      this.mesh = m;

      const body = new CANNON.Body({
        mass: 0, isTrigger: true,
        collisionFilterGroup: COL_GROUPS.HAZARD,
      });
      body.addShape(new CANNON.Box(new CANNON.Vec3(this.w / 2, this.h / 2, 0.5)));
      body.position.set(this.x, this.y, 0);
      body.userData = { kind: 'hazard', hazard: this };
      world.add(body);
      this.body = body;
      // Optional rising/falling lava — periodically floods up then recedes.
      // opts.rise = { height, period, phase? }. Height in world units, period
      // in seconds for a full up+down cycle. The DoT trigger + mesh move
      // together so the danger zone always matches the visible magma.
      this.rise = opts.rise ?? null;
      this._riseBaseY = this.y;
      this._riseT = (opts.rise?.phase ?? 0);
    } else if (this.kind === 'spike') {
      const grp = new THREE.Group();
      const count = Math.max(1, Math.round(this.w / 0.3));
      const down = !!opts.pointDown;
      const tipColor = opts.color ?? (down ? 0xcde6ff : 0xddddee);
      for (let i = 0; i < count; i++) {
        const c = new THREE.Mesh(
          new THREE.ConeGeometry(down ? 0.16 : 0.18, down ? 0.6 : 0.5, 6),
          new THREE.MeshLambertMaterial({ color: tipColor }),
        );
        // Up-pointing: cone base at y=0, tip at y=0.5. Down-pointing flips
        // so the base sits flush with the platform underside above.
        c.position.set((i - (count - 1) / 2) * 0.32, down ? -0.30 : 0.25, 0);
        if (down) c.rotation.x = Math.PI;
        grp.add(c);
      }
      grp.position.set(this.x, this.y, 0);
      scene.add(grp);
      this.mesh = grp;

      const body = new CANNON.Body({
        mass: 0, isTrigger: true, collisionFilterGroup: COL_GROUPS.HAZARD,
      });
      body.addShape(new CANNON.Box(new CANNON.Vec3(this.w / 2, 0.3, 0.5)));
      // Trigger volume centered on the cone tips (not their bases) so contact
      // detection matches the visible threat.
      body.position.set(this.x, this.y + (down ? -0.30 : 0.25), 0);
      body.userData = { kind: 'hazard', hazard: this };
      world.add(body);
      this.body = body;
      this.pointDown = down;
    } else if (this.kind === 'saw') {
      // Blade radius — opts.radius scales the whole saw (mesh + collider) so a
      // level can drop in a giant centerpiece sweeping blade, not just the
      // default small patrol saw.
      const R = opts.radius ?? 0.55;
      const teethCount = Math.max(12, Math.round(R * 22));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.9, R * 0.18, 8, 20), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
      const teeth = new THREE.Group();
      for (let i = 0; i < teethCount; i++) {
        const t = new THREE.Mesh(new THREE.ConeGeometry(R * 0.18, R * 0.36, 4), new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
        const a = (i / teethCount) * Math.PI * 2;
        t.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
        t.rotation.z = a - Math.PI / 2;
        teeth.add(t);
      }
      const hub = new THREE.Mesh(new THREE.CircleGeometry(R * 0.55, 18), new THREE.MeshLambertMaterial({ color: 0x6a7078 }));
      const grp = new THREE.Group(); grp.add(hub, ring, teeth);
      grp.position.set(this.x, this.y, 0);
      scene.add(grp);
      this.mesh = grp; this.spinning = grp;
      this.sawR = R;

      const body = new CANNON.Body({ mass: 0, isTrigger: true, collisionFilterGroup: COL_GROUPS.HAZARD });
      body.addShape(new CANNON.Sphere(R));
      body.position.set(this.x, this.y, 0);
      body.userData = { kind: 'hazard', hazard: this };
      world.add(body);
      this.body = body;
      this.movePath = opts => null;
      this.t = 0;
      this.path = { axis: 'x', range: this.w / 2, speed: 1, base: this.x };
    } else if (this.kind === 'pendulum') {
      // ── Physics-based pendulum ──────────────────────────────────────
      // Anchor (static, no collision) at (this.x, this.y). N dynamic
      // chain-link bodies hung from it via PointToPoint constraints. A
      // heavy tip body (the saw blade) at the end of the chain. Players
      // pass through the chain links (CHAIN group has no PLAYER bit) but
      // projectiles + melee can shoot the chain to sever it.
      this.length = opts.length ?? 4;
      this.speed = opts.speed ?? 1.4;
      this.amplitude = opts.amplitude ?? Math.PI / 3;
      this.tipHp = opts.tipHp ?? 999;          // tip is hard to destroy
      this.chainHp = opts.chainHp ?? 22;       // each link hp
      this.driveForce = opts.driveForce ?? 18; // sinusoidal driver
      this._t = opts.phase ?? 0;

      // ── Visible anchor block ──
      const anchorMat = new THREE.MeshLambertMaterial({ color: 0x202028 });
      const anchorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.4), anchorMat);
      anchorMesh.position.set(this.x, this.y, 0);
      anchorMesh.updateMatrix(); anchorMesh.matrixAutoUpdate = false;
      scene.add(anchorMesh);
      this.anchorMesh = anchorMesh;

      // ── Static anchor body (constraint host, no collision) ──
      const anchorBody = new CANNON.Body({
        mass: 0, type: CANNON.Body.STATIC,
        collisionFilterGroup: 0, collisionFilterMask: 0,
      });
      anchorBody.position.set(this.x, this.y, 0);
      world.add(anchorBody);
      this.anchorBody = anchorBody;

      // ── Chain link bodies + meshes ──
      const segCount = Math.max(4, Math.floor(this.length * 1.6));
      const segLen = this.length / segCount;
      const segR = 0.10;
      const chainMat = new THREE.MeshLambertMaterial({ color: 0x444455 });
      this.chainSegs = [];
      let prevBody = anchorBody;
      let prevPivot = new CANNON.Vec3(0, 0, 0);   // bottom of anchor block
      for (let i = 0; i < segCount; i++) {
        const segBody = new CANNON.Body({
          mass: 0.25,
          material: world.materials.prop,
          linearDamping: 0.1,
          angularDamping: 0.4,
          collisionFilterGroup: COL_GROUPS.CHAIN,
          // Mask excludes PLAYER (players pass through), excludes other CHAIN
          // links (constraint-only coupling avoids solver flicker), and
          // excludes WORLD so dangling chains don't snag on platforms.
          collisionFilterMask: COL_GROUPS.PROJECTILE | COL_GROUPS.HAZARD,
        });
        segBody.addShape(new CANNON.Sphere(segR));
        segBody.position.set(this.x, this.y - (i + 0.5) * segLen, 0);
        world.add(segBody);

        const segMesh = new THREE.Mesh(new THREE.SphereGeometry(segR + 0.02, 8, 6), chainMat);
        segMesh.position.copy(segBody.position);
        scene.add(segMesh);

        const seg = new ChainSeg(this.level, segBody, segMesh, this.chainHp);
        this.level._chainSegs.add(seg);
        this.chainSegs.push(seg);

        const c = new CANNON.PointToPointConstraint(
          prevBody, prevPivot,
          segBody, new CANNON.Vec3(0, segLen / 2, 0),
        );
        world.addConstraint(c);
        seg.constraints.push(c);
        // The constraint is also referenced by the previous seg (so
        // destroying either end severs cleanly).
        if (this.chainSegs.length > 1) this.chainSegs[this.chainSegs.length - 2].constraints.push(c);

        prevBody = segBody;
        prevPivot = new CANNON.Vec3(0, -segLen / 2, 0);
      }

      // ── Blade tip body (the threat) ──
      const bladeMat = new THREE.MeshLambertMaterial({ color: 0xddddee });
      const bladeGrp = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.1, 8, 18), bladeMat);
      bladeGrp.add(ring);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 4), bladeMat);
        tooth.position.set(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0);
        tooth.rotation.z = a - Math.PI / 2;
        bladeGrp.add(tooth);
      }
      this.blade = bladeGrp;
      scene.add(bladeGrp);

      const tipBody = new CANNON.Body({
        mass: 3.0,
        material: world.materials.prop,
        linearDamping: 0.15,
        angularDamping: 0.6,
        collisionFilterGroup: COL_GROUPS.HAZARD,
        // Tip collides with WORLD (so it falls and rests when chain breaks)
        // and PROJECTILE (shootable) but NOT PLAYER — player damage is
        // applied via the Hazard._aabbOverlap trigger pattern instead.
        collisionFilterMask: COL_GROUPS.WORLD | COL_GROUPS.PROJECTILE,
      });
      tipBody.addShape(new CANNON.Sphere(0.55));
      tipBody.position.set(this.x, this.y - this.length, 0);
      tipBody.userData = { kind: 'hazard', hazard: this };
      world.add(tipBody);
      this.body = tipBody;

      // Final constraint: last chain seg → tip body.
      const cTip = new CANNON.PointToPointConstraint(
        prevBody, prevPivot,
        tipBody, new CANNON.Vec3(0, 0.45, 0),
      );
      world.addConstraint(cTip);
      this.chainSegs[this.chainSegs.length - 1].constraints.push(cTip);
      this._tipConstraint = cTip;

      // Kick the chain off-axis so it actually swings on spawn.
      tipBody.velocity.set(this.speed * 4 * (Math.cos(this._t) < 0 ? -1 : 1), 0, 0);

      // Driver: nudge the tip body's horizontal velocity each tick toward a
      // sinusoidal target. cannon-shim (Rapier-backed) doesn't expose
      // applyForce, so we drive the swing by modifying velocity directly.
      // tipMass is captured locally so heavier blades still swing visibly
      // (the impulse here is a fraction of mass × target velocity).
      const tipMass = tipBody.mass;
      this._drive = (dt) => {
        if (this._destroyed || !this.body) return;
        // If every chain seg has died (full sever), let the tip fall freely
        // — no more drive.
        let chainAlive = false;
        for (const s of this.chainSegs) { if (!s.dead) { chainAlive = true; break; } }
        if (!chainAlive) return;
        this._t += dt;
        const targetV = Math.cos(this._t * this.speed) * this.driveForce / Math.max(1, tipMass);
        const alpha = Math.min(1, dt * 6);
        const cur = this.body.velocity.x;
        this.body.velocity.x = cur + (targetV - cur) * alpha;
      };
      this.level._hazardDrivers.add(this._drive);
    }
  }
  update(dt) {
    if (this.kind === 'lava' && this.mesh) {
      this.mesh.material.emissiveIntensity = 0.8 + Math.sin(performance.now() * 0.003) * 0.3;
      // Rising lava: smooth ease up to full height then back down. Uses a
      // raised-cosine so the magma dwells briefly at the top + bottom of the
      // cycle (telegraphs the flood) rather than snapping through.
      if (this.rise) {
        this._riseT += dt;
        const period = this.rise.period ?? 10;
        const phase = (this._riseT / period) * Math.PI * 2;
        const lvl = (1 - Math.cos(phase)) * 0.5;           // 0..1..0
        const y = this._riseBaseY + lvl * (this.rise.height ?? 4);
        this.mesh.position.y = y;
        if (this.body) this.body.position.y = y;
      }
    }
    if (this.kind === 'saw') {
      this.spinning.rotation.z += dt * 18;
      this.t = (this.t || 0) + dt;
      if (this.path) {
        const off = Math.sin(this.t * this.path.speed) * this.path.range;
        if (this.path.axis === 'x') {
          this.mesh.position.x = this.path.base + off;
          this.body.position.x = this.path.base + off;
        }
      }
    } else if (this.kind === 'pendulum') {
      // Sync chain seg meshes to their dynamic bodies (positions are
      // already integrated by the physics solver; we just mirror them).
      for (const seg of this.chainSegs) {
        if (!seg.body || !seg.mesh) continue;
        seg.mesh.position.copy(seg.body.position);
      }
      // Sync blade visual to tip body. Spin teeth on top of the body
      // rotation so the saw always looks active even when nearly motionless.
      if (this.body && this.blade) {
        const p = this.body.position;
        this.blade.position.set(p.x, p.y, 0);
        this.blade.rotation.z += dt * 12;
      }
    }
  }
  contactPlayer(player, dt) {
    if (player.invuln > 0 || !player.alive) return;
    if (this.kind === 'lava') {
      // Continuous DoT — no knockback so the player can walk over briefly.
      player.takeDamage(this.dps * dt, { attacker: null, weapon: 'lava' });
    } else if (this.kind === 'spike') {
      // Icicles (pointDown) fling the player toward the floor. Floor spikes
      // pop the player up.
      const yKick = this.pointDown ? -this.kb.y : this.kb.y;
      player.takeDamage(40, {
        attacker: null, weapon: 'spike',
        kb: { x: 0, y: yKick }, stun: 0.4,
      });
      if (this.pointDown) {
        player.body.velocity.y = -Math.abs(player.body.velocity.y) - this.kb.y;
      } else {
        player.body.velocity.y = Math.abs(player.body.velocity.y) + this.kb.y;
      }
      player.invuln = 0.6;
    } else if (this.kind === 'saw') {
      player.takeDamage(35, {
        attacker: null, weapon: 'saw',
        kb: { x: (player.position.x - this.x) > 0 ? 16 : -16, y: 8 }, stun: 0.3,
      });
      player.invuln = 0.4;
    } else if (this.kind === 'pendulum') {
      const dirX = Math.sign(player.position.x - this.body.position.x) || 1;
      player.takeDamage(50, {
        attacker: null, weapon: 'blade',
        kb: { x: dirX * 22, y: 10 }, stun: 0.5,
      });
      player.invuln = 0.6;
    }
  }

  // Centralized teardown for all hazard variants. Pendulum has its own
  // chain segs (auto-cleaned via ChainSeg.destroy from Level.destroy), an
  // anchor body, an anchor mesh, a blade mesh group, and a tip body. Saw,
  // spike, lava: single mesh + body. Cleanup is idempotent.
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._drive) this.level._hazardDrivers?.delete(this._drive);
    // Pendulum: dismantle anchor + blade. Chain segs are released by the
    // central _chainSegs sweep in Level.destroy.
    if (this.anchorBody) { this.level.physics.remove(this.anchorBody); this.anchorBody = null; }
    if (this.anchorMesh?.parent) this.anchorMesh.parent.remove(this.anchorMesh);
    if (this.blade?.parent) this.blade.parent.remove(this.blade);
    // Generic mesh+body (lava / spike / saw, and pendulum's tip body).
    if (this.mesh?.parent) this.mesh.parent.remove(this.mesh);
    if (this.body) { this.level.physics.remove(this.body); this.body = null; }
  }
}

export class Level {
  constructor(scene, physics, fx, def, game = null) {
    this.scene = scene;
    this.physics = physics;
    this.fx = fx;
    this.def = def;
    this.game = game;
    this.tiles = new Map();
    this.hazards = [];
    this._dynamicTiles = new Set();
    // Physics chains (pendulum links + hanging-platform suspensions). Tracked
    // here so damageArea can iterate them and Level.destroy can tear them
    // down cleanly. Drivers are per-step force callbacks (e.g. pendulum
    // sustain force) registered by hazards at build time.
    this._chainSegs = new Set();
    this._hazardDrivers = new Set();
    // Space-level mode flags. When `curvedGravity` is true, players + projectiles
    // get planet-source gravity instead of the global world gravity. Camera, kill
    // bound, and meteor shower are also planet-level features.
    this.curvedGravity = !!def.curvedGravity;
    this.planetConfigs = def.planets ?? [];
    this.planets = [];
    this.cameraClamp = def.cameraClamp ?? null;
    this.killBound = def.killBound ?? null;
    this.meteorShowerCfg = def.meteorShower ?? null;
    this.meteorShower = null;
    this.spawnPoints = def.spawns ?? [{ x: 0, y: 5 }];
    this.weaponSpawns = def.weaponSpawns ?? [{ x: 0, y: 4 }];
    this.bgColor = def.bgColor ?? 0x10101a;
    this._build();
  }
  _build() {
    // Per-level gravity override (e.g. space).
    const gy = this.def.gravity ?? -17;
    this.physics.world.gravity = { x: 0, y: gy, z: 0 };

    // sky / fog — gradient sky-dome skipped in low-quality (lowQ / software
    // WebGL) since its ShaderMaterial runs a full-screen fragment pass.
    this.scene.background = new THREE.Color(this.bgColor);
    this.scene.fog = new THREE.Fog(this.bgColor, 30, 80);
    if (!this.game?._lowQ) this._addSkyDome();

    // tiles
    for (const t of this.def.tiles) {
      const key = `${t.x},${t.y}`;
      const tile = new Tile(this, t.x, t.y, t);
      tile._key = key;
      this.tiles.set(key, tile);
      tile.build(this.scene, this.physics);
    }

    // Wire parent-child relationships for stacked/segmented tiles. Done in a
    // second pass so a child can reference a parent that appears later in the
    // tiles array. Parent key is the literal 'x,y' string of the parent tile.
    for (const tile of this.tiles.values()) {
      if (!tile.parentTileKey) continue;
      const parent = this.tiles.get(tile.parentTileKey);
      if (parent) parent._children.add(tile);
      else console.warn(`Tile ${tile._key} parentTileKey '${tile.parentTileKey}' not found`);
    }

    // Space-level: build planets from the config.
    if (this.curvedGravity) {
      for (const cfg of this.planetConfigs) {
        const planet = new Planet(this, cfg);
        planet.build(this.scene, this.physics);
        this.planets.push(planet);
      }
      // Custom multi-planet gravity. World gravity is already 0 (set per
      // level def). Pre-step accumulates summed pull onto each dynamic body.
      this._planetGravityFn = makeProjectileGravity(this, this.game);
      this.physics.addPreStep(this._planetGravityFn);
    }

    if (this.meteorShowerCfg) this.meteorShower = new MeteorShower(this, this.meteorShowerCfg);

    // hazards
    for (const h of (this.def.hazards ?? [])) {
      const haz = new Hazard(this, h);
      this.hazards.push(haz);
    }

    // background props (purely decorative, distant)
    if (this.def.background) {
      for (const b of this.def.background) {
        if (b.type === 'chain') {
          const grp = new THREE.Group();
          const len = b.length ?? 6;
          const segs = Math.max(4, Math.floor(len * 1.8));
          const mat = new THREE.MeshLambertMaterial({ color: b.color ?? 0x444455 });
          for (let i = 0; i < segs; i++) {
            const s = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat);
            s.position.set(0, -((i + 0.5) / segs) * len, 0);
            grp.add(s);
          }
          // Anchor block on top
          const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.4), new THREE.MeshLambertMaterial({ color: 0x202028 }));
          grp.add(anchor);
          grp.position.set(b.x, b.y, b.z ?? -1);
          grp.updateMatrixWorld();
          grp.matrixAutoUpdate = false;
          this.scene.add(grp);
        } else if (b.shape === 'sphere') {
          // Background sphere — planets, suns, rose windows, organic blobs.
          const r = b.radius ?? 1;
          const matBg = new THREE.MeshLambertMaterial({
            color: b.color ?? 0x223355,
            emissive: b.emissive ?? 0x000000,
            emissiveIntensity: b.emissiveIntensity ?? 0,
          });
          const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), matBg);
          m.position.set(b.x, b.y, b.z ?? -10);
          m.updateMatrix();
          m.matrixAutoUpdate = false;
          this.scene.add(m);
        } else if (b.shape === 'circle' || b.shape === 'disc') {
          // Flat disc — moons, crater rings, halos. Always camera-facing (z plane).
          const r = b.radius ?? 1;
          const matBg = new THREE.MeshLambertMaterial({
            color: b.color ?? 0xffffff,
            emissive: b.emissive ?? (b.color ?? 0xffffff),
            emissiveIntensity: b.emissiveIntensity ?? 0.5,
            side: THREE.DoubleSide,
          });
          const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), matBg);
          m.position.set(b.x, b.y, b.z ?? -11);
          m.updateMatrix();
          m.matrixAutoUpdate = false;
          this.scene.add(m);
        } else {
          // Box (default) — pixel-art mural building block.
          const matBg = new THREE.MeshLambertMaterial({
            color: b.color ?? 0x222233,
            emissive: b.emissive ?? 0x000000,
            emissiveIntensity: b.emissiveIntensity ?? 0,
          });
          const m = new THREE.Mesh(new THREE.BoxGeometry(b.w ?? 4, b.h ?? 4, b.d ?? 1), matBg);
          m.position.set(b.x, b.y, b.z ?? -3);
          m.updateMatrix();
          m.matrixAutoUpdate = false;
          this.scene.add(m);
        }
      }
    }

    // (Z-axis lock is handled in PhysicsWorld postStep — no walls needed.)

    // Lighting. HW path gets shadow + dual fills for depth; lowQ keeps
    // single fill + no shadow (matches game._lowQ tier in Game.js).
    const lowQ = !!this.game?._lowQ;
    this.scene.add(new THREE.AmbientLight(0xffffff, lowQ ? 0.55 : 0.45));
    this.scene.add(new THREE.HemisphereLight(0xddddff, 0x504050, lowQ ? 0.8 : 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(8, 22, 14);
    if (!lowQ) {
      dir.castShadow = true;
      dir.shadow.mapSize.set(1024, 1024);
      dir.shadow.camera.left = -28;
      dir.shadow.camera.right = 28;
      dir.shadow.camera.top = 22;
      dir.shadow.camera.bottom = -12;
      dir.shadow.camera.near = 1;
      dir.shadow.camera.far = 80;
      dir.shadow.bias = -0.0003;
    }
    this.scene.add(dir);
    if (lowQ) {
      const fill = new THREE.PointLight(0xffaa88, 0.7, 40);
      fill.position.set(0, 8, 4);
      this.scene.add(fill);
    } else {
      const fill = new THREE.PointLight(0xff77aa, 0.6, 40);
      fill.position.set(-10, 8, 4);
      this.scene.add(fill);
      const fill2 = new THREE.PointLight(0x77aaff, 0.5, 40);
      fill2.position.set(10, 8, 4);
      this.scene.add(fill2);
    }
  }

  _addSkyDome() {
    const top = new THREE.Color(this.bgColor).multiplyScalar(0.5);
    const bottom = new THREE.Color(this.bgColor).lerp(new THREE.Color(0xffffff), 0.08);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: top },
        bottomColor: { value: bottom },
      },
      vertexShader: `varying vec3 vWorld; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `varying vec3 vWorld; uniform vec3 topColor; uniform vec3 bottomColor; void main() { float t = clamp((vWorld.y + 20.0) / 80.0, 0.0, 1.0); gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0); }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 24, 16), mat);
    this.scene.add(sky);
  }

  damageTile(tile, amount, by) {
    if (!tile || tile.indestructible) return;
    tile.damage(amount, by);
  }
  damageArea(x, y, radius, amount, by) {
    // Scan integer-grid tiles in radius (fast lookup).
    const r = radius;
    for (let gx = Math.floor(x - r); gx <= Math.ceil(x + r); gx++) {
      for (let gy = Math.floor(y - r); gy <= Math.ceil(y + r); gy++) {
        const t = this.tiles.get(`${gx},${gy}`);
        if (!t) continue;
        if (t.dynamic) continue; // dynamic tiles handled below using live body pos
        const dx = gx - x, dy = gy - y;
        const d = Math.hypot(dx, dy);
        if (d <= r) {
          const f = 1 - d / r;
          t.damage(amount * f, by);
        }
      }
    }
    // Also scan dynamic tiles (crates etc) — they may be at fractional
    // coords and have moved from spawn position; use live body position.
    const r2 = radius * radius;
    for (const t of this._dynamicTiles) {
      if (!t.body) continue;
      const dx = t.body.position.x - x, dy = t.body.position.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2);
      const f = 1 - d / radius;
      t.damage(amount * f, by);
    }
    // Chain segs (pendulum + suspension) — explosions can sever chains.
    for (const seg of this._chainSegs) {
      if (!seg.body) continue;
      const dx = seg.body.position.x - x, dy = seg.body.position.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2);
      const f = 1 - d / radius;
      seg.damage(amount * 0.6 * f, by);
    }
    // Planet wedges (space level). Their composite keys (`planet${id}_crust_${i}`)
    // don't show up in the integer-grid scan above, so iterate the planet array
    // directly and use each wedge's static body position.
    for (const planet of this.planets) {
      for (const w of planet.wedges) {
        if (!w || !w.body || w.hp <= 0) continue;
        const dx = w.body.position.x - x, dy = w.body.position.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        const f = 1 - d / radius;
        w.damage(amount * f, by);
      }
    }
  }
  randomSpawn() { return this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)]; }
  randomWeaponSpawn() { return this.weaponSpawns[Math.floor(Math.random() * this.weaponSpawns.length)]; }

  update(dt, players) {
    if (this.killBound) {
      const bx = this.killBound.x, by = this.killBound.y;
      for (const p of players) {
        if (!p || !p.alive) continue;
        const x = p.body.position.x, y = p.body.position.y;
        if (Math.abs(x) > bx || Math.abs(y) > by) {
          p.takeDamage(p.maxHealth + 1, { attacker: null, weapon: 'void' });
        }
      }
    }

    // Drive sustained hazards (pendulum sinusoidal force, etc.) before the
    // physics step happens — the Game loop calls level.update AFTER physics
    // step, so apply forces once here for the *next* step. Acceptable lag.
    for (const drive of this._hazardDrivers) drive(dt);

    if (this.meteorShower) this.meteorShower.update(dt);

    for (const h of this.hazards) {
      h.update(dt);
      for (const p of players) {
        if (!p || !p.alive) continue;
        if (this._aabbOverlap(p.position, p.body, h)) h.contactPlayer(p, dt);
      }
    }
    // Sync dynamic tiles' meshes to their physics bodies.
    for (const t of this._dynamicTiles) {
      if (!t.mesh || !t.body) continue;
      const p = t.body.position, q = t.body.quaternion;
      t.mesh.position.set(p.x, p.y, p.z);
      t.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
    // Sync chain seg meshes (pendulum links + hanging-platform suspensions).
    for (const seg of this._chainSegs) {
      if (!seg.body || !seg.mesh) continue;
      seg.mesh.position.copy(seg.body.position);
    }
  }

  // Suspend a static tile from a static anchor by N chain links. When ANY
  // link is destroyed, every constraint on the chain dissolves AND the tile
  // is converted to a dynamic body so it falls.
  _suspendTile(tile, spec) {
    if (!tile.body) return;
    const segCount = Math.max(3, spec.segs ?? 4);
    const segR = 0.10;
    const ax = spec.x, ay = spec.y;
    const tx = tile.body.position.x, ty = tile.body.position.y;
    const dx = tx - ax, dy = ty - ay;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const segLen = dist / segCount;
    const ux = dx / dist, uy = dy / dist;

    // Static anchor body (no collision, just a constraint host).
    const anchorBody = new CANNON.Body({
      mass: 0, type: CANNON.Body.STATIC,
      collisionFilterGroup: 0, collisionFilterMask: 0,
    });
    anchorBody.position.set(ax, ay, 0);
    this.physics.add(anchorBody);

    // Visible anchor block (decorative).
    const anchorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.25, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x202028 }),
    );
    anchorMesh.position.set(ax, ay, 0);
    anchorMesh.updateMatrix(); anchorMesh.matrixAutoUpdate = false;
    this.scene.add(anchorMesh);

    const segs = [];
    const constraints = [];
    let prevBody = anchorBody;
    let prevPivot = new CANNON.Vec3(0, 0, 0);

    for (let i = 0; i < segCount; i++) {
      const segBody = new CANNON.Body({
        mass: 0.20,
        material: this.physics.materials.prop,
        linearDamping: 0.1, angularDamping: 0.4,
        collisionFilterGroup: COL_GROUPS.CHAIN,
        collisionFilterMask: COL_GROUPS.PROJECTILE | COL_GROUPS.HAZARD,
      });
      segBody.addShape(new CANNON.Sphere(segR));
      const px = ax + ux * (i + 0.5) * segLen;
      const py = ay + uy * (i + 0.5) * segLen;
      segBody.position.set(px, py, 0);
      this.physics.add(segBody);

      const segMesh = new THREE.Mesh(
        new THREE.SphereGeometry(segR + 0.02, 8, 6),
        new THREE.MeshLambertMaterial({ color: 0x444455 }),
      );
      segMesh.position.copy(segBody.position);
      this.scene.add(segMesh);

      const seg = new ChainSeg(this, segBody, segMesh, spec.hp ?? 18);
      this._chainSegs.add(seg);

      // When ANY suspension seg breaks, drop the tile.
      seg.onBreak = () => this._dropSuspendedTile(tile);
      segs.push(seg);

      const c = new CANNON.PointToPointConstraint(
        prevBody, prevPivot,
        segBody, new CANNON.Vec3(0, segLen / 2, 0),
      );
      this.physics.world.addConstraint(c);
      seg.constraints.push(c);
      if (segs.length > 1) segs[segs.length - 2].constraints.push(c);
      constraints.push(c);

      prevBody = segBody;
      prevPivot = new CANNON.Vec3(0, -segLen / 2, 0);
    }

    // Final constraint: last seg → tile body.
    const cTile = new CANNON.PointToPointConstraint(
      prevBody, prevPivot,
      tile.body, new CANNON.Vec3(0, tile.h / 2, 0),
    );
    this.physics.world.addConstraint(cTile);
    segs[segs.length - 1].constraints.push(cTile);
    constraints.push(cTile);

    tile._chainSuspension = { anchorBody, anchorMesh, segs, constraints };
  }

  // Convert a chain-suspended OR parent-stacked static tile into a falling
  // dynamic body. Called by ChainSeg.onBreak when a suspension chain dies,
  // and by Tile.destroy() when a parent in a parentTileKey stack is broken.
  // Idempotent: re-calls are no-ops. Cascades recursively into children so a
  // segmented stack collapses top-to-bottom in one shot.
  _dropSuspendedTile(tile) {
    if (!tile || tile._dropped || !tile.body) return;
    tile._dropped = true;
    const body = tile.body;
    const mass = tile.tileMass ?? Math.max(4, tile.w * tile.h * 6);
    body.mass = mass;
    body.type = CANNON.Body.DYNAMIC;
    body.fixedRotation = false;
    body.linearDamping = 0.05;
    body.angularDamping = 0.2;
    body.updateMassProperties();
    body.wakeUp?.();
    tile.dynamic = true;
    // The static-tile build path froze the mesh's matrix to skip per-frame
    // recomputes. Re-enable it now or the mesh visually stays glued to its
    // anchor while the body falls.
    if (tile.mesh) tile.mesh.matrixAutoUpdate = true;
    this._dynamicTiles.add(tile);
    // Cascade into children — when a parent goes dynamic, anything stacked
    // on top of it should also drop.
    if (tile._children?.size > 0) {
      for (const child of tile._children) this._dropSuspendedTile(child);
    }
  }
  _aabbOverlap(pos, body, h) {
    const px = pos.x, py = pos.y;
    if (h.kind === 'saw' || h.kind === 'pendulum') {
      const dx = px - h.body.position.x, dy = py - h.body.position.y;
      const r = h.sawR ?? 0.85;
      return dx * dx + dy * dy < r * r;
    }
    return Math.abs(px - h.body.position.x) < (h.w / 2 + 0.35) &&
           Math.abs(py - h.body.position.y) < (h.h / 2 + 0.7);
  }

  destroy() {
    if (this._planetGravityFn) {
      this.physics.removePreStep(this._planetGravityFn);
      this._planetGravityFn = null;
    }
    if (this.meteorShower) { this.meteorShower.destroy(); this.meteorShower = null; }
    for (const t of this.tiles.values()) t.destroy();
    for (const h of this.hazards) h.destroy();
    // Sweep any chain segs not already released by a hazard or tile destroy
    // (e.g. orphan suspensions whose tile and hazard both went away cleanly).
    for (const seg of [...this._chainSegs]) seg.destroy();
    this.tiles.clear();
    this.hazards.length = 0;
    this._dynamicTiles.clear();
    this._chainSegs.clear();
    this._hazardDrivers.clear();
    for (const p of this.planets) p.destroy?.();
    this.planets.length = 0;
  }
}
