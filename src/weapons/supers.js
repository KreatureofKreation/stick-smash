import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Weapon } from './Weapon.js';
import { Projectile } from './Projectile.js';
import { audio } from '../audio/Audio.js';
import { rand, TAU } from '../util/math.js';
import { COL_GROUPS } from '../physics/PhysicsWorld.js';
import { spawnFirePatch } from './fx/FirePatch.js';


// === SUPER WEAPONS — rare, dramatic ===

// === LIGHTSABER ===
const SABER_COLORS = [0x4d9fff, 0x66e2a3, 0xff4d6d, 0xb24dff, 0xffcc33];



export class Lightsaber extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Lightsaber';
    this.melee = true;
    this.lungeSpeed = 14;
    this.icon = '⚔';
    this.fireDelay = 0.22;
    this.swingTimer = 0;
    this.hits = new Set();
    this.tileSwingDmg = 22;
    this.bladeColor = SABER_COLORS[Math.floor(Math.random() * SABER_COLORS.length)];
    if (this._blade) this._blade.material.color.setHex(this.bladeColor);
    if (this._blade) this._blade.material.emissive.setHex(this.bladeColor);
    this._thrownProj = null;
    this._thrownCooldown = 0;
    this.throwImpulse = 5;
    this.meleeRecoilImpulse = 7;
    this.hitKnockback = 1.3;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const c = 0x4d9fff;
    const bladeGeo = THREE.CapsuleGeometry
      ? new THREE.CapsuleGeometry(0.06, 0.95, 4, 8)
      : new THREE.BoxGeometry(0.10, 0.95, 0.10);
    const blade = new THREE.Mesh(
      bladeGeo,
      new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 2.2, transparent: true, opacity: 0.92 }),
    );
    blade.rotation.z = Math.PI / 2;
    blade.position.x = 0.5;
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 10), new THREE.MeshLambertMaterial({ color: 0x222233 }));
    hilt.rotation.z = Math.PI / 2; hilt.position.x = -0.05;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.015, 6, 12), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
    ring.rotation.y = Math.PI / 2; ring.position.x = 0.05;
    grp.add(blade, hilt, ring);
    this.mesh = grp;
    this._blade = blade;
  }
  fire(player) {
    if (this._thrownProj) return; // can't swing while saber is thrown
    this.swingTimer = 0.25; this._swingDur = 0.25; this.hits.clear();
    audio.swing(); audio.beep(880, 0.06, 'sine', 0.2);
    player.attackTimer = 0.25;
  }
  altFire(player) {
    // Saber Throw — fly out, return.
    if (this._thrownProj || this._thrownCooldown > 0) return;
    this._thrownCooldown = 1.0;
    const ax = player.aimDir.x, ay = player.aimDir.y;
    const owner = player;
    const game = this.game;
    const blade = this;
    this.mesh.visible = false; // saber leaves the hand visually
    const proj = new Projectile(this.game, {
      x: player.position.x + ax * 0.6, y: player.position.y + 0.6 + ay * 0.3,
      vx: ax * 28, vy: ay * 28, damage: 36, owner: player,
      gravity: false, life: 2.0, radius: 0.1,
      color: this.bladeColor, emissive: this.bladeColor,
      mesh: { geometry: new THREE.BoxGeometry(0.95, 0.10, 0.10), material: new THREE.MeshLambertMaterial({ color: this.bladeColor, emissive: this.bladeColor, emissiveIntensity: 2 }) },
    });
    proj.body.angularVelocity.set(0, 0, 30);
    this._thrownProj = proj;
    let t = 0;
    const orig = proj.update.bind(proj);
    proj.update = (dt) => {
      t += dt;
      if (!proj.dead && owner.alive) {
        const dx = owner.position.x - proj.body.position.x;
        const dy = (owner.position.y + 0.65) - proj.body.position.y;
        const d = Math.hypot(dx, dy);
        const homing = Math.min(1, t * 1.2);
        if (homing > 0) {
          const f = 80 * dt * homing;
          proj.body.velocity.x += (dx / Math.max(0.1, d)) * f;
          proj.body.velocity.y += (dy / Math.max(0.1, d)) * f;
        }
        if (t > 0.4 && d < 0.9) {
          // Caught — restore saber to hand.
          blade._thrownProj = null;
          blade.mesh.visible = true;
          proj.destroy();
        }
      }
      orig(dt);
    };
    audio.sweep(1500, 600, 0.25, 'sine', 0.25);
  }
  worldTick(dt) {
    super.worldTick(dt);
    if (this._thrownCooldown > 0) this._thrownCooldown -= dt;
    // If thrown projectile died (timed out / hit something), restore mesh.
    if (this._thrownProj && this._thrownProj.dead) {
      this._thrownProj = null;
      this.mesh.visible = true;
    }
    if (this._blade) this._blade.material.emissiveIntensity = 1.8 + Math.sin(performance.now() * 0.025) * 0.4;
    if (this.swingTimer > 0 && this.holder) {
      this.swingTimer -= dt;
      const phase = 1 - this.swingTimer / 0.25;
      if (phase > 0.18 && phase < 0.85) {
        const cx = this.holder.position.x + this.holder.facing * 1.05;
        const cy = this.holder.position.y + 0.2;
        for (const p of this.game.players) {
          if (!p || p === this.holder || !p.alive || p.invuln > 0) continue;
          if (this.hits.has(p.id)) continue;
          const dx = p.position.x - cx, dy = p.position.y - cy;
          if (dx * dx + dy * dy < 1.1 * 1.1) {
            p.takeDamage(48, {
              attacker: this.holder, weapon: 'saber',
              kb: { x: this.holder.facing * 11, y: 6 }, stun: 0.3,
            });
            this.hits.add(p.id);
            this.game.fx.particles.burst(p.position.x, p.position.y + 0.4, 0, { count: 12, speed: 6, color: this.bladeColor });
            this.game.fx.camera.punch(0.2);
            audio.beep(660, 0.06, 'square', 0.25);
          }
        }
        this._reflectProjectiles(cx, cy, 1.2);
      }
    }
  }
}



export class FlameSword extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Flame Sword';
    this.melee = true;
    this.lungeSpeed = 13;
    this.icon = '🔥';
    this.fireDelay = 0.3;
    this.swingTimer = 0;
    this.hits = new Set();
    this.tileSwingDmg = 20;
    this.throwImpulse = 5;
    this.meleeRecoilImpulse = 7;
    this.hitKnockback = 1.3;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.09, 0.05), new THREE.MeshLambertMaterial({ color: 0xff8833, emissive: 0xff5500, emissiveIntensity: 1.5 }));
    blade.position.x = 0.45;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.08), new THREE.MeshLambertMaterial({ color: 0x331a08 }));
    handle.position.x = -0.05;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.1), new THREE.MeshLambertMaterial({ color: 0xff4400, emissive: 0xff4400 }));
    guard.position.x = 0.05;
    grp.add(blade, handle, guard);
    this.mesh = grp;
    this._blade = blade;
  }
  fire(player) {
    this.swingTimer = 0.28; this._swingDur = 0.28; this.hits.clear();
    audio.swing(); audio.beep(180, 0.15, 'sawtooth', 0.25);
    player.attackTimer = 0.28;
    this._spawnFireArc(player);
  }
  // Throw a fan of fire in the swing direction — ignites anyone it touches and
  // drops ground-fire patches on the floor. noPush so the flames never shove.
  _spawnFireArc(player) {
    const base = player.input?.aimActive
      ? Math.atan2(player.aimDir.y, player.aimDir.x)
      : (player.facing > 0 ? 0 : Math.PI);
    const mx = player.position.x + player.facing * 0.6;
    const my = player.position.y + 0.2;
    for (let i = 0; i < 5; i++) {
      const a = base + (i - 2) * 0.28;     // ~64° fan
      const sp = 15 + rand(-1, 1);
      const flameMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 6, 5),
        new THREE.MeshLambertMaterial({ color: 0xff5511, emissive: 0xff8833, emissiveIntensity: 1.3 }),
      );
      const proj = new Projectile(this.game, {
        x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        damage: 0, owner: player, mesh: flameMesh,
        gravity: true, gravityScale: 0.3, life: 0.45, radius: 0.1,
        noPush: true, tracerColor: 0xff8833,
      });
      proj.onHit = (pr, other) => {
        if (other.userData?.kind === 'player') other.userData.stickman?.applyBurn?.(2.5, 5, player);
        else if (other.userData?.kind === 'tile') spawnFirePatch(this.game, { x: pr.body.position.x, y: pr.body.position.y, owner: player });
      };
    }
  }
  worldTick(dt) {
    super.worldTick(dt);
    if (this._blade) this._blade.material.emissiveIntensity = 1.2 + Math.sin(performance.now() * 0.02) * 0.4;
    if (this.holder) {
      // Trail flame particles from blade tip while held
      if (Math.random() < dt * 8) {
        this.game.fx.particles.spark.spawn({
          x: this.mesh.position.x + Math.cos(this.mesh.rotation.z) * 0.4,
          y: this.mesh.position.y + Math.sin(this.mesh.rotation.z) * 0.4,
          z: 0, vx: rand(-1, 1), vy: rand(0.5, 2),
          life: 0.4, size: 0.18, color: rand() < 0.5 ? 0xffaa33 : 0xff5500,
          gravity: -2, drag: 0.7, shrink: 1,
        });
      }
    }
    if (this.swingTimer > 0 && this.holder) {
      this.swingTimer -= dt;
      const phase = 1 - this.swingTimer / 0.28;
      if (phase > 0.2 && phase < 0.85) {
        const cx = this.holder.position.x + this.holder.facing * 1.05;
        const cy = this.holder.position.y + 0.2;
        for (const p of this.game.players) {
          if (!p || p === this.holder || !p.alive || p.invuln > 0) continue;
          if (this.hits.has(p.id)) continue;
          const dx = p.position.x - cx, dy = p.position.y - cy;
          if (dx * dx + dy * dy < 1.1 * 1.1) {
            p.takeDamage(40, {
              attacker: this.holder, weapon: 'flame',
              kb: { x: this.holder.facing * 12, y: 6 }, stun: 0.35,
            });
            p.applyBurn?.(2.5, 5, this.holder);
            this.hits.add(p.id);
            this.game.fx.particles.burst(p.position.x, p.position.y + 0.4, 0, { count: 14, speed: 5, color: 0xff5500 });
            this.game.fx.camera.punch(0.25);
            this.game.hitStop?.(0.04);
          }
        }
        this._reflectProjectiles(cx, cy, 1.2);
      }
    }
  }
}



export class IceSword extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Ice Sword';
    this.melee = true;
    this.lungeSpeed = 13;
    this.icon = '❄';
    this.fireDelay = 0.3;
    this.swingTimer = 0;
    this.hits = new Set();
    this.tileSwingDmg = 20;
    this.throwImpulse = 5;
    this.meleeRecoilImpulse = 7;
    this.hitKnockback = 1.3;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.09, 0.05), new THREE.MeshLambertMaterial({ color: 0x9bdcff, emissive: 0x4d9fff, emissiveIntensity: 1.0, transparent: true, opacity: 0.85 }));
    blade.position.x = 0.45;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.08), new THREE.MeshLambertMaterial({ color: 0x182040 }));
    handle.position.x = -0.05;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.1), new THREE.MeshLambertMaterial({ color: 0x4d9fff, emissive: 0x4d9fff }));
    guard.position.x = 0.05;
    grp.add(blade, handle, guard);
    this.mesh = grp;
  }
  fire(player) {
    this.swingTimer = 0.28; this._swingDur = 0.28; this.hits.clear();
    audio.swing(); audio.beep(880, 0.12, 'sine', 0.2);
    player.attackTimer = 0.28;
  }
  worldTick(dt) {
    super.worldTick(dt);
    if (this.swingTimer > 0 && this.holder) {
      this.swingTimer -= dt;
      const phase = 1 - this.swingTimer / 0.28;
      if (phase > 0.2 && phase < 0.85) {
        const cx = this.holder.position.x + this.holder.facing * 1.05;
        const cy = this.holder.position.y + 0.2;
        for (const p of this.game.players) {
          if (!p || p === this.holder || !p.alive || p.invuln > 0) continue;
          if (this.hits.has(p.id)) continue;
          const dx = p.position.x - cx, dy = p.position.y - cy;
          if (dx * dx + dy * dy < 1.1 * 1.1) {
            const tNow = performance.now();
            const alreadyFrozen = tNow < p._frozenUntil;
            const canFreeze = tNow >= (p._freezeImmuneUntil ?? 0);
            // Shatter: a hit on an already-frozen target does bonus damage.
            p.takeDamage(alreadyFrozen ? 45 : 30, {
              attacker: this.holder, weapon: 'ice',
              kb: { x: this.holder.facing * 8, y: 5 }, stun: alreadyFrozen ? 0.3 : 1.2,
            });
            if (canFreeze && !alreadyFrozen) {
              p._frozenUntil = tNow + 1400;
              p._freezeImmuneUntil = tNow + 1400 + 2000;  // no re-freeze for 2s after thaw
            }
            this.hits.add(p.id);
            this.game.fx.particles.burst(p.position.x, p.position.y + 0.4, 0, { count: alreadyFrozen ? 26 : 18, speed: 6, color: 0xbfeaff });
            this.game.fx.camera.punch(alreadyFrozen ? 0.3 : 0.2);
          }
        }
        this._reflectProjectiles(cx, cy, 1.2);
      }
    }
  }
}



// =============================================================================
// KAMEHAMEHA — anime-faithful charge → release.
// Lifecycle:
//   1. tryFire (trigger press): start CHARGE phase. Player aim is locked,
//      movement frozen, a small energy orb appears between the hands.
//   2. CHARGE (~1.6s): orb grows + brightens, audio rises in pitch, particle
//      wisps stream INTO the orb, camera tremors with charge progress.
//   3. RELEASE (instant): big bang, screen shake, ring-burst particles, heavy
//      backward recoil — player gets visibly slammed back as the beam fires.
//   4. FIRE (~1.4s): wide multi-stream beam. Center lane is a fat high-damage
//      core; two outer lanes are thinner wisps for thickness. Continuous
//      recoil push and frequent screen shakes throughout.
//   5. END: dispose orb meshes, decrement ammo, drop the now-empty technique.
//
// Aim is locked at the moment of charge start so the technique commits the
// shooter to one direction (canonically Goku doesn't track during the move).
// ============================================================================
export class Kamehameha extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Kamehameha';
    this.icon = '☄';
    // Long base cooldown so the trigger can't re-fire while a charge cycle
    // is in progress. The cycle itself takes ~3s (charge + fire + grace).
    this.fireDelay = 4.0;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.ammo = 1;

    this.charging = false;
    this.firing = false;
    this.chargeT = 0;
    this.chargeDur = 1.6;
    this.fireT = 0;
    this.fireDur = 1.4;
    this._beamAccum = 0;
    this._lockedAim = null;
    this._chargeMesh = null;
    this._haloMesh = null;
    this.throwImpulse = 4;
    this.recoilImpulse = 3;
    this.continuousRecoilImpulse = 36;  // sustained beam: ~36 impulse/sec horizontal
    this.hitKnockback = 1.2;
  }
  _buildMesh() {
    // Idle pickup mesh — small inert orb the carrier holds.
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0x9be8ff, emissive: 0x4dccff, emissiveIntensity: 1.4 }),
    );
    this.mesh = m;
  }

  // Defer ammo decrement to release-end so the weapon survives the charge.
  // Without this, ammo=1 would destroy the weapon mid-charge after fire().
  tryFire(player) {
    if (this.cooldown > 0) return;
    if (this.charging || this.firing) return;
    this.cooldown = this.fireDelay;
    this.fire(player);
    // Note: ammo is NOT decremented here. _endFire handles it.
  }

  fire(player) {
    this.charging = true;
    this.chargeT = 0;
    // Lock aim at charge start — the move commits the shooter.
    this._lockedAim = { x: player.aimDir.x, y: player.aimDir.y };
    // Lock player movement + attack input for the full cycle.
    const lockMs = (this.chargeDur + this.fireDur + 0.1) * 1000;
    player._frozenUntil = performance.now() + lockMs;
    player.attackTimer = (this.chargeDur + this.fireDur) * 1.05;
    // Energy orb at the hands.
    const orbMat = new THREE.MeshLambertMaterial({
      color: 0xeaffff, emissive: 0x66ccff, emissiveIntensity: 3.0,
      transparent: true, opacity: 0.95,
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), orbMat);
    this.game.scene.add(orb);
    this._chargeMesh = orb;
    // Outer halo for additive bloom feel.
    const haloMat = new THREE.MeshLambertMaterial({
      color: 0xffffff, emissive: 0x44aaff, emissiveIntensity: 1.5,
      transparent: true, opacity: 0.4, depthWrite: false,
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), haloMat);
    this.game.scene.add(halo);
    this._haloMesh = halo;
    // Rising hum building toward release.
    audio.sweep(120, 700, this.chargeDur, 'sawtooth', 0.3);
    this.game.fx.camera.punch(0.10);
  }

  worldTick(dt) {
    super.worldTick(dt);
    // If the holder vanished mid-cycle (death, drop) abort cleanly.
    if ((this.charging || this.firing) && (!this.holder || !this.holder.alive)) {
      this._endFire();
      return;
    }
    if (!this.holder) return;
    const p = this.holder;
    const ax = this._lockedAim?.x ?? p.aimDir.x;
    const ay = this._lockedAim?.y ?? p.aimDir.y;
    const handX = p.position.x + ax * 0.85;
    const handY = p.position.y + 0.55 + ay * 0.4;

    if (this.charging) {
      this.chargeT += dt;
      const t = Math.min(1, this.chargeT / this.chargeDur);
      // Grow orb 0.4 → 2.8 scale; emissive ramps up.
      const s = 0.4 + 2.4 * t;
      if (this._chargeMesh) {
        this._chargeMesh.position.set(handX, handY, 0);
        this._chargeMesh.scale.setScalar(s);
        this._chargeMesh.material.emissiveIntensity = 3 + t * 5;
      }
      if (this._haloMesh) {
        this._haloMesh.position.set(handX, handY, 0);
        this._haloMesh.scale.setScalar(s * 1.4 + Math.sin(performance.now() * 0.02) * 0.12 * t);
        this._haloMesh.material.opacity = 0.3 + 0.5 * t;
      }
      // Energy wisps streaming INTO the orb — anime convergence effect.
      const wispRate = 0.5 + t * 0.7;
      if (Math.random() < wispRate) {
        const a = rand(0, TAU);
        const r = 1.0 + Math.random() * 1.2;
        this.game.fx.particles.spark.spawn({
          x: handX + Math.cos(a) * r,
          y: handY + Math.sin(a) * r,
          z: 0,
          vx: -Math.cos(a) * r * 4.5,
          vy: -Math.sin(a) * r * 4.5,
          life: 0.35, size: 0.16,
          color: t < 0.5 ? 0x66ccff : 0xaaffff,
          gravity: 0, drag: 0.4, shrink: 0.8,
        });
      }
      // Tremor ramps with charge.
      if (Math.random() < t * 0.35) this.game.fx.camera.punch(0.05 * t);
      // Pin player flat to ground if they're standing.
      if (p.grounded) {
        p.body.velocity.x = 0;
        if (p.body.velocity.y < 0) p.body.velocity.y = 0;
      }
      if (this.chargeT >= this.chargeDur) this._beginRelease(p);
      return;
    }

    if (this.firing) {
      this.fireT += dt;
      const t = Math.min(1, this.fireT / this.fireDur);
      // Beam pacing — emit waves at fixed cadence regardless of frame rate.
      this._beamAccum += dt;
      while (this._beamAccum >= 0.025) {
        this._beamAccum -= 0.025;
        const ox = p.position.x + ax * 1.1;
        const oy = p.position.y + 0.6 + ay * 0.4;
        const perpX = -ay, perpY = ax;
        // 3 lanes — fat core + thinner outer wisps for visual thickness.
        for (let lane = -1; lane <= 1; lane++) {
          const offset = lane * 0.32;
          const isCore = lane === 0;
          new Projectile(this.game, {
            x: ox + perpX * offset, y: oy + perpY * offset,
            vx: ax * 80, vy: ay * 80,
            damage: isCore ? 22 : 11,
            owner: p, gravity: false, life: 0.5, radius: isCore ? 0.42 : 0.22,
            color: 0xeaffff, emissive: 0x66ccff, tracer: true,
            mesh: {
              geometry: new THREE.SphereGeometry(isCore ? 0.44 : 0.24, 12, 10),
              material: new THREE.MeshLambertMaterial({
                color: 0xeaffff, emissive: 0x66ccff, emissiveIntensity: 3.0,
              }),
            },
          });
        }
      }
      // Continuous recoil — visibly slides the player back during the beam.
      // Frame-rate independent: continuousRecoilImpulse is impulse/sec, × dt.
      // Y damped to 0.65 so straight-down beam doesn't fling player too high —
      // _beginRelease provides the main vertical kick via recoilImpulse.
      if (window.__forceFeatures?.recoil !== 0 && this.continuousRecoilImpulse > 0) {
        const mag = this.continuousRecoilImpulse;
        p.applyImpulse(-ax * mag * dt, -ay * mag * dt * 0.65);
      }
      // Charge orb fades out as beam fires.
      if (this._chargeMesh) {
        const fade = 1 - t;
        this._chargeMesh.position.set(handX, handY, 0);
        this._chargeMesh.scale.setScalar(2.8 * fade + 0.4);
        this._chargeMesh.material.opacity = 0.95 * fade;
        if (this._haloMesh) {
          this._haloMesh.position.set(handX, handY, 0);
          this._haloMesh.scale.setScalar(3.6 * fade + 0.6);
          this._haloMesh.material.opacity = 0.5 * fade;
        }
      }
      // Frequent shake throughout the beam.
      if (Math.random() < 0.35) this.game.fx.camera.punch(0.16);
      if (this.fireT >= this.fireDur) this._endFire();
    }
  }

  _beginRelease(player) {
    this.charging = false;
    this.firing = true;
    this.fireT = 0;
    this._beamAccum = 0;
    // Big bang — multiple audio layers + heavy shake + hit-stop.
    audio.sweep(1400, 60, 1.2, 'sawtooth', 0.6);
    audio.sweep(220, 60, 1.0, 'sawtooth', 0.4);
    audio.explode();
    this.game.fx.camera.punch(1.0);
    this.game.hitStop?.(0.12);
    const ax = this._lockedAim.x, ay = this._lockedAim.y;
    // Sub-B recoil-jump — opposite aim direction. Y kept full (no damping)
    // so shooting straight down recoil-jumps straight up — the whole
    // point of the mechanic.
    if (window.__forceFeatures?.recoil !== 0) {
      const recoilMag = this.recoilImpulse;
      if (recoilMag > 0) {
        player.applyImpulse(-ax * recoilMag, -ay * recoilMag);
      }
    }
    // Ring of energy bursting outward at the release point.
    const handX = player.position.x + ax * 0.85;
    const handY = player.position.y + 0.55 + ay * 0.4;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU;
      this.game.fx.particles.spark.spawn({
        x: handX, y: handY, z: 0,
        vx: Math.cos(a) * 16, vy: Math.sin(a) * 16,
        life: 0.6, size: 0.3, color: 0xaaeeff,
        gravity: 0, drag: 0.6, shrink: 1,
      });
    }
  }

  _endFire() {
    this.charging = false;
    this.firing = false;
    if (this._chargeMesh) {
      if (this._chargeMesh.parent) this._chargeMesh.parent.remove(this._chargeMesh);
      this._chargeMesh.geometry.dispose();
      this._chargeMesh.material.dispose();
      this._chargeMesh = null;
    }
    if (this._haloMesh) {
      if (this._haloMesh.parent) this._haloMesh.parent.remove(this._haloMesh);
      this._haloMesh.geometry.dispose();
      this._haloMesh.material.dispose();
      this._haloMesh = null;
    }
    this._lockedAim = null;
    // Now decrement ammo (deferred from tryFire). With ammo=1, this drops
    // the weapon — the technique is single-use per pickup.
    this.ammo--;
    if (this.ammo <= 0) {
      if (this.holder) { this.holder.weapon = null; }
      this.destroy();
    }
  }

  destroy() {
    // Ensure orb meshes are gone even if destroy() is called before _endFire.
    if (this._chargeMesh) {
      if (this._chargeMesh.parent) this._chargeMesh.parent.remove(this._chargeMesh);
      this._chargeMesh = null;
    }
    if (this._haloMesh) {
      if (this._haloMesh.parent) this._haloMesh.parent.remove(this._haloMesh);
      this._haloMesh = null;
    }
    super.destroy();
  }
}



export class Nuke extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Nuke';
    this.icon = '☢';
    this.fireDelay = 1.0;
    this.aimWeapon = true;
    this.ammo = 1;
    this.throwImpulse = 5;
    this.hitKnockback = 1.5;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 12), new THREE.MeshLambertMaterial({ color: 0x444444 }));
    tube.rotation.z = Math.PI / 2; tube.position.x = 0.25;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.25, 12), new THREE.MeshLambertMaterial({ color: 0xff4400, emissive: 0xff4400, emissiveIntensity: 0.6 }));
    tip.rotation.z = -Math.PI / 2; tip.position.x = 0.55;
    grp.add(tube, tip);
    this.mesh = grp;
  }
  fire(player) {
    const ax = player.aimDir.x, ay = player.aimDir.y;
    const proj = new Projectile(this.game, {
      x: player.position.x + ax * 1.0, y: player.position.y + 0.7 + ay * 0.4,
      vx: ax * 22, vy: ay * 22, damage: 0, owner: player,
      gravity: false, life: 4, radius: 0.25,
      explosive: true, explodeOnContact: true, color: 0xff4400, emissive: 0xff8800,
      mesh: { geometry: new THREE.ConeGeometry(0.18, 0.6, 10).rotateZ(-Math.PI / 2), material: new THREE.MeshLambertMaterial({ color: 0xff4400, emissive: 0xff4400, emissiveIntensity: 1 }) },
    });
    // Override explode to be MASSIVE
    const game = this.game;
    proj.explode = function () {
      if (this.dead) return;
      const x = this.body?.position?.x ?? this.mesh.position.x;
      const y = this.body?.position?.y ?? this.mesh.position.y;
      // Three concentric particle bursts
      for (let i = 0; i < 60; i++) {
        const a = rand(0, Math.PI * 2);
        game.fx.particles.spark.spawn({
          x, y, z: 0, vx: Math.cos(a) * rand(8, 22), vy: Math.sin(a) * rand(8, 22) + 5,
          life: rand(0.6, 1.2), size: rand(0.15, 0.4), color: rand() < 0.5 ? 0xffaa33 : 0xff4400,
          gravity: -10, drag: 0.6, shrink: 1,
        });
      }
      game.fx.particles.smokePuff(x, y, 0, 0x222222);
      for (let i = 0; i < 20; i++) game.fx.particles.smokePuff(x + rand(-3, 3), y + rand(0, 5), 0, 0x444444);
      game.fx.camera.punch(1.2);
      game.hitStop?.(0.18);
      audio.explode(); audio.explode(); audio.sweep(60, 20, 0.8, 'sawtooth', 0.5);
      const radius = 9;
      for (const p of game.players) {
        if (!p || !p.alive || p.invuln > 0) continue;
        const dx = p.position.x - x, dy = p.position.y - y;
        const d = Math.hypot(dx, dy);
        if (d < radius) {
          const f = 1 - d / radius;
          const nx = dx / Math.max(0.01, d), ny = dy / Math.max(0.01, d);
          p.takeDamage(120 * f, {
            attacker: this.owner, weapon: 'nuke',
            kb: { x: nx * 35 * f, y: 18 + ny * 18 * f }, stun: 0.7 * f,
          });
        }
      }
      game.level.damageArea(x, y, radius, 200, this);
      this.destroy();
    };
    audio.shoot();
    // Sub-B recoil-jump — opposite aim direction. Y kept full (no damping)
    // so shooting straight down recoil-jumps straight up — the whole
    // point of the mechanic.
    if (window.__forceFeatures?.recoil !== 0) {
      const recoilMag = this.recoilImpulse;
      if (recoilMag > 0) {
        player.applyImpulse(-ax * recoilMag, -ay * recoilMag);
      }
    }
  }
}



export class LightningStaff extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Lightning';
    this.icon = '⚡';
    this.fireDelay = 0.6;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.ammo = 6;
    this.throwImpulse = 4;
    this.recoilImpulse = 3;
    this.hitKnockback = 1.2;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 8), new THREE.MeshLambertMaterial({ color: 0x442266 }));
    staff.rotation.z = Math.PI / 2; staff.position.x = 0.4;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshLambertMaterial({ color: 0xeeccff, emissive: 0xb24dff, emissiveIntensity: 1.6 }));
    orb.position.x = 0.85;
    grp.add(staff, orb);
    this.mesh = grp;
  }
  fire(player) {
    // Chain to up-to-3 nearest enemies in a line.
    audio.sweep(2000, 200, 0.2, 'square', 0.3);
    audio.noise(0.15, 0.3, 6000);
    const start = { x: player.position.x + player.aimDir.x * 0.8, y: player.position.y + 0.65 };
    const hit = new Set();
    let prev = start;
    const game = this.game;
    for (let i = 0; i < 3; i++) {
      // Find nearest player not hit, in front.
      let best = null, bestD2 = 12 * 12;
      for (const p of game.players) {
        if (!p || p === player || !p.alive || p.invuln > 0) continue;
        if (hit.has(p.id)) continue;
        const dx = p.position.x - prev.x, dy = p.position.y - prev.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = p; }
      }
      if (!best) break;
      hit.add(best.id);
      // Visual bolt: line of small spheres
      const segs = 8;
      for (let s = 0; s < segs; s++) {
        const t = s / (segs - 1);
        const x = prev.x + (best.position.x - prev.x) * t + rand(-0.15, 0.15);
        const y = prev.y + (best.position.y + 0.4 - prev.y) * t + rand(-0.15, 0.15);
        game.fx.particles.spark.spawn({
          x, y, z: 0, vx: 0, vy: 0, life: 0.18, size: 0.12, color: 0xeeccff, gravity: 0, drag: 0.9, shrink: 1,
        });
      }
      best.takeDamage(22 - i * 4, {
        attacker: player, weapon: 'lightning',
        kb: { x: (best.position.x - prev.x) * 1.2, y: 4 }, stun: 0.25,
      });
      prev = { x: best.position.x, y: best.position.y };
    }
    game.fx.camera.punch(0.2);
    // Sub-B recoil-jump — opposite aim direction. Y kept full (no damping)
    // so shooting straight down recoil-jumps straight up — the whole
    // point of the mechanic.
    if (window.__forceFeatures?.recoil !== 0) {
      const recoilMag = this.recoilImpulse;
      if (recoilMag > 0) {
        player.applyImpulse(-player.aimDir.x * recoilMag, -player.aimDir.y * recoilMag);
      }
    }
  }
}



// === SUPERPOWER PICKUPS ===

class SuperPickup {
  constructor(game, opts) {
    this.game = game;
    this.kind = opts.kind;
    this.icon = opts.icon;
    this.color = opts.color;
    this.duration = opts.duration ?? 5000;
    this.apply = opts.apply;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), new THREE.MeshLambertMaterial({ color: this.color, emissive: this.color, emissiveIntensity: 1 }));
    this.mesh = m;
    this.life = 30;
  }
  spawnAt(x, y, z = 0) { this.game.scene.add(this.mesh); this.x = x; this.y = y; this.z = z; return this; }
  worldTick(dt) {
    this.mesh.position.set(this.x, this.y + Math.sin(performance.now() * 0.003) * 0.15, this.z);
    this.mesh.rotation.y += dt * 2;
    this.mesh.rotation.x += dt * 1.3;
    this.life -= dt;
    if (this.life <= 0) this.destroy();
  }
  tryPickup(player) {
    const dx = player.position.x - this.x, dy = player.position.y - this.y;
    if (dx * dx + dy * dy < 0.7 * 0.7) {
      this.apply(player, this.duration);
      audio.pickup();
      audio.beep(1320, 0.18, 'square', 0.3);
      this.game.fx.particles.burst(this.x, this.y, 0, { count: 22, speed: 8, color: this.color });
      if (player.isLocal && this.game.hud) this.game.hud.showCenter(this.kind.toUpperCase(), '', 1200);
      this.destroy();
      return true;
    }
    return false;
  }
  destroy() { if (this.mesh.parent) this.mesh.parent.remove(this.mesh); this.dead = true; }
}



export class FlightPower {
  constructor(game) { return new SuperPickup(game, {
    kind: 'Flight', icon: '🪽', color: 0x9be8ff, duration: 6000,
    apply: (p, d) => { p.flightUntil = performance.now() + d; },
  }); }
}


export class InvisibilityPower {
  constructor(game) { return new SuperPickup(game, {
    kind: 'Invisibility', icon: '👻', color: 0xaaaaaa, duration: 5000,
    apply: (p, d) => { p.invisibleUntil = performance.now() + d; },
  }); }
}


export class TimeSlowPower {
  constructor(game) { return new SuperPickup(game, {
    kind: 'Bullet Time', icon: '⏱', color: 0xff4d6d, duration: 4000,
    apply: (p, d) => { p.timeSlowUntil = performance.now() + d; if (p.game) p.game.timeSlowOwner = p; },
  }); }
}


export class SuperPunchPower {
  constructor(game) { return new SuperPickup(game, {
    kind: 'Super Punch', icon: '👊', color: 0xffcc33, duration: 7000,
    apply: (p, d) => { p.superPunchUntil = performance.now() + d; },
  }); }
}



export class GumGumFruit {
  constructor(game) { return new SuperPickup(game, {
    kind: 'Gum-Gum', icon: '🟣', color: 0xc870ff, duration: 8000,
    apply: (p, d) => { p.gumGumUntil = performance.now() + d; },
  }); }
}



// ===== FORCE POWERS — special key triggers ability while pickup active =====
export class ForcePushPower {
  constructor(game) { return new SuperPickup(game, {
    kind: 'Force Push', icon: '🌀', color: 0x77aaff, duration: 8000,
    apply: (p, d) => { p.forcePushUntil = performance.now() + d; },
  }); }
}


export class ForcePullPower {
  constructor(game) { return new SuperPickup(game, {
    kind: 'Force Pull', icon: '🧲', color: 0x4dccff, duration: 8000,
    apply: (p, d) => { p.forcePullUntil = performance.now() + d; },
  }); }
}


export class ForceLightningPower {
  constructor(game) { return new SuperPickup(game, {
    kind: 'Force Lightning', icon: '⚡', color: 0xc870ff, duration: 7000,
    apply: (p, d) => { p.forceLightningUntil = performance.now() + d; },
  }); }
}


export class ForceChokePower {
  constructor(game) { return new SuperPickup(game, {
    kind: 'Force Choke', icon: '👐', color: 0xff4d6d, duration: 7000,
    apply: (p, d) => { p.forceChokeUntil = performance.now() + d; },
  }); }
}
