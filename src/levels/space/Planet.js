import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { COL_GROUPS } from '../../physics/PhysicsWorld.js';
import { audio } from '../../audio/Audio.js';

// One round destructible body. Owns annular-wedge tiles for crust + mantle and
// a single core sphere. Wedges register into level.tiles using composite ids
// (`planet${id}_${kind}_${idx}`) so existing tile-damage code paths Just Work.
export class Planet {
  constructor(level, cfg) {
    this.level = level;
    this.id = cfg.id;
    this.cx = cfg.cx;
    this.cy = cfg.cy;
    this.radius = cfg.radius;
    this.baseRadius = cfg.radius;
    this.mantleRadius = cfg.mantleRadius ?? cfg.radius * 0.65;
    this.coreRadius = cfg.coreRadius ?? cfg.radius * 0.3;
    this.mass = cfg.mass ?? cfg.radius * cfg.radius * cfg.radius * 1.0;
    this.pullStrength = cfg.pullStrength ?? 15;  // m/s² applied inside halo (constant-pull model)
    this.haloMul = cfg.haloMul ?? 3;
    this.crustWedges = cfg.crustWedges ?? 16;
    this.mantleWedges = cfg.mantleWedges ?? 8;
    this.crustHp = cfg.crustHp ?? 80;
    this.mantleHp = cfg.mantleHp ?? 200;
    this.crustColor = cfg.crustColor ?? 0x808898;
    this.mantleColor = cfg.mantleColor ?? 0x7a3a3a;
    this.coreColor = cfg.coreColor ?? 0xff6633;
    this.wedges = [];     // populated by _buildCrust / _buildMantle
    this.coreBody = null;
    this.coreMesh = null;
    this.crustAlive = this.crustWedges;  // count of un-destroyed crust wedges; hits 0 → peel
    this.molten = false;                 // true after crust is fully stripped
  }

  get haloRadius() { return this.baseRadius * this.haloMul; }

  build(scene, world) {
    this._buildSurface(scene, world);
    this._buildCrust(scene, world);
    this._buildMantle(scene, world);
    this._buildCore(scene, world);
  }

  _buildSurface(scene, world) {
    // Solid impenetrable surface sphere. Player walks on this; wedges sit
    // visually on top and take damage from projectiles + explosions but
    // are NOT what blocks the capsule. This eliminates the gap-tunneling
    // bug where the wedge Box colliders left angular gaps the capsule
    // could slip through.
    const body = new CANNON.Body({
      mass: 0,
      collisionFilterGroup: COL_GROUPS.WORLD,
      collisionFilterMask: -1,
    });
    body.addShape(new CANNON.Sphere(this.radius));
    body.position.set(this.cx, this.cy, 0);
    world.add(body);
    this.surfaceBody = body;
    this._world = world;
  }

  destroy() {
    if (this.surfaceBody) {
      this.level.physics.remove(this.surfaceBody);
      this.surfaceBody = null;
    }
    // Wedges + core are torn down via level.tiles / level.hazards sweeps
    // in Level.destroy. Nothing else to do here.
  }

  _buildMantle(scene, world) {
    const N = this.mantleWedges;
    const rOut = this.mantleRadius;
    const rIn = this.coreRadius;
    for (let i = 0; i < N; i++) {
      const theta0 = (i / N) * Math.PI * 2 - Math.PI / 2;
      const theta1 = ((i + 1) / N) * Math.PI * 2 - Math.PI / 2;
      const wedge = this._buildWedge({
        kind: 'mantle', idx: i, rIn, rOut, theta0, theta1,
        color: this.mantleColor, hp: this.mantleHp,
      });
      scene.add(wedge.mesh);
      world.add(wedge.body);
      this.wedges.push(wedge);
      const key = `planet${this.id}_mantle_${i}`;
      wedge._key = key;
      this.level.tiles.set(key, wedge);
    }
  }

  _buildCore(scene, world) {
    const r = this.coreRadius;
    const geo = new THREE.SphereGeometry(r, 24, 18);
    const mat = new THREE.MeshLambertMaterial({
      color: this.coreColor,
      emissive: this.coreColor,
      emissiveIntensity: 1.4,
      
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.cx, this.cy, 0);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    this.coreMesh = mesh;

    // Static trigger body — handled like a lava hazard (continuous DoT on touch).
    const body = new CANNON.Body({
      mass: 0, isTrigger: true,
      collisionFilterGroup: COL_GROUPS.HAZARD,
    });
    body.addShape(new CANNON.Sphere(r));
    body.position.set(this.cx, this.cy, 0);
    // Reuse the existing Hazard contactPlayer pattern via a minimal stub.
    const level = this.level;
    const hazard = {
      kind: 'lava', x: this.cx, y: this.cy, w: r * 2, h: r * 2,
      dps: 60, body, mesh,
      kb: { x: 0, y: 0 },
      planetRef: this,
      contactPlayer(player, dt) {
        if (this.planetRef?.molten) return;   // molten DoT handled by the walking branch
        if (player.invuln > 0 || !player.alive) return;
        player.takeDamage(this.dps * dt, { attacker: null, weapon: 'lava' });
      },
      update() { /* no-op */ },
      destroy() {
        if (this.mesh?.parent) this.mesh.parent.remove(this.mesh);
        this.mesh?.geometry?.dispose();
        this.mesh?.material?.dispose();
        this.mesh = null;
        if (this.body) level.physics.remove(this.body);
        this.body = null;
      },
    };
    body.userData = { kind: 'hazard', hazard };
    world.add(body);
    this.coreBody = body;
    this.level.hazards.push(hazard);
  }

  _buildCrust(scene, world) {
    const N = this.crustWedges;
    const rOut = this.radius;
    const rIn = this.mantleRadius;
    for (let i = 0; i < N; i++) {
      const theta0 = (i / N) * Math.PI * 2 - Math.PI / 2;
      const theta1 = ((i + 1) / N) * Math.PI * 2 - Math.PI / 2;
      const wedge = this._buildWedge({
        kind: 'crust', idx: i, rIn, rOut, theta0, theta1,
        color: this.crustColor, hp: this.crustHp,
      });
      scene.add(wedge.mesh);
      world.add(wedge.body);
      this.wedges.push(wedge);
      // Register so damageArea / projectile impact can find it.
      const key = `planet${this.id}_crust_${i}`;
      wedge._key = key;
      this.level.tiles.set(key, wedge);
    }
  }

  // Build one annular wedge: arc-segment mesh + approximate Box collider at
  // the radial midpoint. Returned object is shaped like a Tile for compat
  // with damageArea / Projectile._impact (userData.kind = 'tile').
  _buildWedge({ kind, idx, rIn, rOut, theta0, theta1, color, hp }) {
    // Mesh: a closed 2D Shape from theta0..theta1 sweep at rIn..rOut, extruded.
    const shape = new THREE.Shape();
    const arcSegs = Math.max(4, Math.ceil((theta1 - theta0) / 0.12));
    // Outer arc (theta0 → theta1).
    shape.moveTo(Math.cos(theta0) * rOut, Math.sin(theta0) * rOut);
    for (let s = 1; s <= arcSegs; s++) {
      const t = theta0 + (theta1 - theta0) * (s / arcSegs);
      shape.lineTo(Math.cos(t) * rOut, Math.sin(t) * rOut);
    }
    // Back along inner arc.
    for (let s = arcSegs; s >= 0; s--) {
      const t = theta0 + (theta1 - theta0) * (s / arcSegs);
      shape.lineTo(Math.cos(t) * rIn, Math.sin(t) * rIn);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
    geo.translate(0, 0, -0.25);
    const mat = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.cx, this.cy, 0);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    // Planet wedges are static + always at scene-scale silhouette — drop
    // cast to match the flat-level static-tile cut.
    mesh.castShadow = false;
    mesh.receiveShadow = true;

    // Collider: single Box at the radial midpoint of the wedge.
    const midR = (rIn + rOut) / 2;
    const midTheta = (theta0 + theta1) / 2;
    const localX = Math.cos(midTheta) * midR;
    const localY = Math.sin(midTheta) * midR;
    const arcLen = (theta1 - theta0) * midR;
    const halfX = arcLen * 0.5;
    const halfY = (rOut - rIn) * 0.5;
    const halfZ = 0.25;
    const body = new CANNON.Body({
      mass: 0,
      // Wedge colliders do NOT block players — surface sphere does.
      // Wedges still need to receive projectile + explosion hits, so they
      // collide with PROJECTILE only. The `kind: 'tile'` userData routes
      // damage events the same way as before.
      collisionFilterGroup: COL_GROUPS.WORLD,
      collisionFilterMask: COL_GROUPS.PROJECTILE,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(halfX, halfY, halfZ)));
    body.position.set(this.cx + localX, this.cy + localY, 0);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), midTheta);

    const wedge = {
      planet: this, kind, idx,
      theta0, theta1, rIn, rOut,
      hp, maxHp: hp,
      indestructible: false,
      material: 'stone',
      color, dynamic: false,
      gx: this.cx, gy: this.cy,
      mesh, body,
      // Damage callback — mirrors Tile.damage.
      damage(amt) {
        if (this.indestructible || this.hp <= 0) return false;
        this.hp -= amt;
        const f = Math.max(0, this.hp / this.maxHp);
        const c = new THREE.Color(this.color);
        c.lerp(new THREE.Color(0x111111), 1 - f);
        this.mesh.material.color.copy(c);
        if (this.hp <= 0) { this.destroy(); return true; }
        return false;
      },
      destroy() {
        if (this.mesh?.parent) this.mesh.parent.remove(this.mesh);
        this.mesh?.geometry?.dispose();
        this.mesh?.material?.dispose();
        this.mesh = null;
        // Capture body world position BEFORE removing — debris spawns there.
        const px = this.body?.position?.x ?? this.planet.cx;
        const py = this.body?.position?.y ?? this.planet.cy;
        if (this.body) this.planet.level.physics.remove(this.body);
        this.body = null;
        this.planet.level.tiles.delete(this._key);
        this.planet.level.fx.particles.debris(px, py, 0, this.color, 12);
      },
    };
    body.userData = { kind: 'tile', tile: wedge };

    // Crust wedges notify the planet when destroyed so it can track crustAlive
    // and trigger the lava-peel when the last one goes.
    if (kind === 'crust') {
      const _origDestroy = wedge.destroy.bind(wedge);
      wedge.destroy = function () {
        _origDestroy();
        this.planet._onCrustDestroyed();
      };
    }

    return wedge;
  }

  _onCrustDestroyed() {
    if (this.molten) return;
    this.crustAlive--;
    if (this.crustAlive <= 0) this._peel();
  }

  _peel() {
    if (this.molten) return;
    this.molten = true;
    // Destroy any remaining mantle wedges (now above the new surface).
    for (const w of this.wedges) {
      if (w.kind === 'mantle' && w.hp > 0) w.destroy();
    }
    // Shrink the solid surface collider to the core so players descend onto lava.
    if (this.surfaceBody) this.level.physics.remove(this.surfaceBody);
    const body = new CANNON.Body({ mass: 0, collisionFilterGroup: COL_GROUPS.WORLD, collisionFilterMask: -1 });
    body.addShape(new CANNON.Sphere(this.coreRadius));
    body.position.set(this.cx, this.cy, 0);
    this._world.add(body);
    this.surfaceBody = body;
    // The walking spring targets planet.radius — lower it to the core surface.
    this.radius = this.coreRadius;
    // Brighten the core glow to read as "exposed".
    if (this.coreMesh?.material) this.coreMesh.material.emissiveIntensity = 2.4;
    this._eruptJuice();
  }

  // Feedback for the moment a planet's crust is fully stripped and the molten
  // core is exposed. Without this the peel is silent + invisible; players miss
  // that the planet just became a death trap. Debris ring off the old crust
  // silhouette + a fireball pop at the core + camera kick + a crunchy sound.
  _eruptJuice() {
    const fx = this.level?.fx;
    if (fx?.particles) {
      const N = 20;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const ex = this.cx + Math.cos(a) * this.baseRadius;
        const ey = this.cy + Math.sin(a) * this.baseRadius;
        fx.particles.debris(ex, ey, 0, this.crustColor, 3);
      }
      fx.particles.burst(this.cx, this.cy, 0, { count: 26, speed: 10, color: 0xff5522 });
    }
    fx?.camera?.punch?.(0.5);
    audio.break?.();
  }
}
