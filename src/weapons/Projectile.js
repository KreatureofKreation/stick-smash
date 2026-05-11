import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { COL_GROUPS } from '../physics/PhysicsWorld.js';
import { audio } from '../audio/Audio.js';

// Generic projectile: physics sphere + visual mesh + on-hit callback.
export class Projectile {
  constructor(game, opts) {
    this.game = game;
    this.life = opts.life ?? 3;
    this.damage = opts.damage ?? 10;
    this.kb = opts.kb ?? { x: 0, y: 0 };
    this.owner = opts.owner ?? null;
    this.onHit = opts.onHit ?? null;
    this.explosive = opts.explosive ?? false;
    this.explodeOnContact = opts.explodeOnContact ?? false;
    this.tracerColor = opts.tracerColor ?? 0xffcc33;
    this.gravity = opts.gravity ?? true;
    // Sticky: on contact, freeze proj relative to whatever it hit (player or
    // tile/world body) until stickLife expires. Body is removed; mesh stays.
    this.sticky = opts.sticky ?? false;
    this.stickLife = opts.stickLife ?? 6;
    // Bouncy: instead of destroying/exploding on contact, dampen velocity and
    // decrement bounces. Detonation (if explosive) defers to fuse / 0 bounces.
    this.bounces = opts.bounces ?? 0;
    this.bounceDamp = opts.bounceDamp ?? 0.65;
    // Optional explosion radius override — sniper/sticky tune this without
    // overriding `explode()` wholesale.
    this.explodeRadius = opts.explodeRadius ?? 3.2;
    this.explodeDamage = opts.explodeDamage ?? 40;

    const r = opts.radius ?? 0.12;
    // opts.mesh may be a pre-built Object3D (Group/Mesh) — use it as-is so
    // multi-part visuals (e.g., arrow shaft + head + fletching) survive. Only
    // fall through to {geometry, material} bag form for legacy call sites.
    if (opts.mesh && opts.mesh.isObject3D) {
      this.mesh = opts.mesh;
    } else {
      const geo = opts.mesh?.geometry ?? new THREE.SphereGeometry(r, 8, 6);
      const mat = opts.mesh?.material ?? new THREE.MeshLambertMaterial({ color: opts.color ?? 0xffcc33, emissive: opts.emissive ?? 0x442200 });
      this.mesh = new THREE.Mesh(geo, mat);
    }
    game.scene.add(this.mesh);

    this.body = new CANNON.Body({
      mass: opts.mass ?? 0.5,
      material: opts.material ?? game.physics.materials.prop,
      collisionFilterGroup: COL_GROUPS.PROJECTILE,
      collisionFilterMask: COL_GROUPS.WORLD | COL_GROUPS.PROP | COL_GROUPS.PLAYER | COL_GROUPS.CHAIN | COL_GROUPS.HAZARD,
      linearDamping: opts.drag ?? 0,
      angularDamping: opts.angularDamping ?? 0.9,
    });
    this.body.addShape(new CANNON.Sphere(r));
    this.body.position.set(opts.x, opts.y, opts.z ?? 0);
    this.body.velocity.set(opts.vx, opts.vy, 0);
    this.body.userData = { kind: 'projectile', proj: this };
    game.physics.add(this.body);
    game.registerProjectile(this);
    this.gravityScale = opts.gravityScale ?? (this.gravity ? 1 : 0);
    // Use Rapier's native per-body gravity scaling (no force tricks, no
    // accumulation bugs at high frame rate).
    if (this.gravityScale !== 1) {
      this.body.setGravityScale?.(this.gravityScale);
    }

    this._collide = (e) => {
      const other = e.body;
      if (other === this.owner?.body) return;
      if (other.userData?.kind === 'projectile') return;
      this._impact(other, e.contact);
    };
    this.body.addEventListener('collide', this._collide);

    // Tracer line (visual flair for fast projectiles)
    if (opts.tracer) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const lineMat = new THREE.LineBasicMaterial({ color: this.tracerColor });
      this.tracer = new THREE.Line(lineGeo, lineMat);
      game.scene.add(this.tracer);
      this._lastPos = new THREE.Vector3(opts.x, opts.y, 0);
    }
  }

  _impact(other, contact) {
    if (this.dead || this._pendingExplode || this._pendingDestroy || this.stuck || this._pendingStick) return;
    let hitPlayer = null;
    if (other.userData?.kind === 'player') {
      const sm = other.userData.stickman;
      if (sm && sm !== this.owner && sm.alive && sm.invuln <= 0) {
        sm.takeDamage(this.damage, {
          attacker: this.owner,
          weapon: 'projectile',
          kb: { x: this.body.velocity.x * 0.15, y: 5 + Math.abs(this.body.velocity.y) * 0.1 },
          stun: 0.25,
        });
        hitPlayer = sm;
      }
    } else if (other.userData?.kind === 'tile') {
      this.game.level.damageTile(other.userData.tile, this.damage * 0.7, this);
    } else if (other.userData?.kind === 'chain') {
      // Chain link — projectiles can sever physics chains.
      other.userData.seg.damage(this.damage * 1.0, this);
    }
    if (this.onHit) this.onHit(this, other, contact);
    // Sticky: latch onto whatever was hit and stop simulating.
    if (this.sticky) {
      this._pendingStick = { other, player: hitPlayer };
      return;
    }
    // Bouncy: dampen + count bounces. Only destroy/explode when bounces
    // exhausted. Explosive bouncy projectiles still detonate by fuse (life).
    if (this.bounces > 0 && !this.explodeOnContact) {
      this.bounces--;
      // Dampen velocity directly — Rapier's restitution handles the bounce
      // direction; we just reduce energy each contact so it eventually rests.
      const v = this.body.velocity;
      v.x *= this.bounceDamp; v.y *= this.bounceDamp;
      return;
    }
    // Defer destroy/explode to next update tick — cannon-es crashes if body
    // is removed from inside its own collide handler.
    if (this.explodeOnContact || this.explosive) this._pendingExplode = true;
    else this._pendingDestroy = true;
  }

  // Convert a free-flying projectile into a stuck visual. Removes the body
  // (no more collisions / physics), tracks the hit body so the mesh follows
  // moving targets (e.g., an arrow stuck in a player), and shortens life.
  _applyStick(stickInfo) {
    if (this.stuck || this.dead) return;
    this.stuck = true;
    const { other, player } = stickInfo;
    // Snapshot pose at impact.
    const px = this.body.position.x, py = this.body.position.y;
    const v = this.body.velocity;
    const ang = Math.atan2(v.y, v.x);
    this.life = this.stickLife;
    // Track offset relative to host body so the arrow sticks to a moving target.
    this._stickHost = other;
    this._stickOffset = { x: px - other.position.x, y: py - other.position.y };
    this._stickAng = ang;
    this._stickPlayer = player ?? null;
    // Tear down our physics body — no more collisions, no movement of our own.
    if (this.body) {
      this.body.removeEventListener('collide', this._collide);
      this.game.physics.remove(this.body);
      this.body = null;
    }
    // Place mesh at impact point with locked orientation along travel axis.
    this.mesh.position.set(px, py, 0);
    this.mesh.rotation.set(0, 0, ang - Math.PI / 2);
    if (player) {
      this.game.fx.particles.blood?.(px, py, 0, Math.sign(v.x) || 1, 0.4);
    }
    if (this.tracer) {
      this.tracer.parent?.remove(this.tracer);
      this.tracer = null;
    }
  }

  explode() {
    if (this.dead) return;
    // Stuck explosive (sticky bomb) detonates from its locked offset rather
    // than the body (which has been removed by _applyStick).
    const x = this.body ? this.body.position.x : this.mesh.position.x;
    const y = this.body ? this.body.position.y : this.mesh.position.y;
    return this._explodeAt(x, y);
  }

  _explodeAt(x, y) {
    if (this.dead) return;
    this.game.fx.particles.burst(x, y, 0, { count: 28, speed: 10, color: 0xffaa33 });
    this.game.fx.particles.smokePuff(x, y, 0, 0x444444);
    this.game.fx.camera.punch(0.6);
    this.game.hitStop?.(0.08);
    audio.explode();
    const radius = this.explodeRadius;
    const dmg = this.explodeDamage;
    // Damage everyone in radius
    for (const p of this.game.players) {
      if (!p || !p.alive || p.invuln > 0) continue;
      const dx = p.position.x - x, dy = p.position.y - y;
      const d = Math.hypot(dx, dy);
      if (d < radius) {
        const f = 1 - d / radius;
        const nx = dx / Math.max(0.01, d), ny = dy / Math.max(0.01, d);
        p.takeDamage(dmg * f, {
          attacker: this.owner,
          weapon: 'explosion',
          kb: { x: nx * 18 * f, y: 8 + ny * 10 * f },
          stun: 0.4 * f,
        });
      }
    }
    // Damage tiles — tile damage scales with explode damage so a sticky bomb
    // (bigger dmg) chews terrain harder than a thrown grenade.
    this.game.level.damageArea(x, y, radius, dmg * 1.5, this);
    this.destroy();
  }

  update(dt) {
    if (this.dead) return;
    // Apply deferred stick BEFORE other branches: if we collided this tick
    // and stuck, we want the body teardown to happen here, not while the
    // physics step is still iterating contacts.
    if (this._pendingStick) {
      const info = this._pendingStick; this._pendingStick = null;
      this._applyStick(info);
    }
    if (this._pendingExplode) { this._pendingExplode = false; return this.explode(); }
    if (this._pendingDestroy) { this._pendingDestroy = false; return this.destroy(); }
    this.life -= dt;
    if (this.life <= 0) {
      if (this.explosive) return this.explode();
      return this.destroy();
    }
    // Stuck: track host body (so an arrow stuck in a moving player follows
    // them) and skip all the live-projectile logic below.
    if (this.stuck) {
      const host = this._stickHost;
      if (host && host.position) {
        this.mesh.position.set(host.position.x + this._stickOffset.x, host.position.y + this._stickOffset.y, 0);
        this.mesh.rotation.set(0, 0, this._stickAng - Math.PI / 2);
      }
      // If the host player died/destroyed, drop the arrow shortly after.
      if (this._stickPlayer && !this._stickPlayer.alive && this.life > 0.5) this.life = 0.5;
      return;
    }
    const p = this.body.position;
    // ── Disarm check ──────────────────────────────────────────────────
    // If a projectile passes within reach of a held weapon and the wielder
    // isn't mid-swing, knock the weapon loose. Mid-swing projectiles are
    // already reflected back by Weapon._reflectProjectiles, so this only
    // triggers in the idle / blocking state.
    for (const player of this.game.players) {
      if (!player || !player.alive || player === this.owner) continue;
      if (!player.weapon) continue;
      // Mid-swing? Reflect path owns the projectile — skip disarm.
      if (player.weapon.swingTimer > 0) continue;
      // Punching with empty hands also reflects; same skip rule.
      if (player.attackTimer > 0) continue;
      const hand = player.rig?.handR?.position;
      const hx = hand?.x ?? (player.position.x + player.facing * 0.4);
      const hy = hand?.y ?? (player.position.y + 0.6);
      const dx = p.x - hx, dy = p.y - hy;
      if (dx * dx + dy * dy > 0.45 * 0.45) continue;
      if (player._disarm(this)) {
        this.game.fx.particles.burst(hx, hy, 0, { count: 10, speed: 7, color: 0xffeeaa });
        this.game.fx.camera.punch?.(0.2);
        this._pendingDestroy = true;
        break;
      }
    }
    this.mesh.position.set(p.x, p.y, p.z);
    if (this._orientToVel) {
      const v = this.body.velocity;
      const ang = Math.atan2(v.y, v.x);
      this.mesh.rotation.set(0, 0, ang - Math.PI / 2); // cylinder long axis is Y
    } else {
      const q = this.body.quaternion;
      this.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
    if (this.tracer) {
      const positions = this.tracer.geometry.attributes.position;
      positions.setXYZ(0, this._lastPos.x, this._lastPos.y, 0);
      positions.setXYZ(1, p.x, p.y, 0);
      positions.needsUpdate = true;
      this._lastPos.set(p.x, p.y, 0);
    }
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    if (this.body) {
      this.body.removeEventListener('collide', this._collide);
      this.game.physics.remove(this.body);
      this.body = null;
    }
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    if (this.tracer) this.tracer.parent?.remove(this.tracer);
  }
}
