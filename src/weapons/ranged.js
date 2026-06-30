import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Weapon } from './Weapon.js';
import { Projectile } from './Projectile.js';
import { audio } from '../audio/Audio.js';
import { rand, TAU } from '../util/math.js';
import { COL_GROUPS } from '../physics/PhysicsWorld.js';
import { spawnFirePatch } from './fx/FirePatch.js';
const _w2a = new THREE.Vector3(); // DualPistols handR / Sniper muzzle


const _w2b = new THREE.Vector3(); // DualPistols handL



// === RANGED ===

export class Pistol extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Pistol';
    this.icon = '🔫';
    this.fireDelay = 0.18;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.ammo = 12;
    this.barrelOffset = 0.55;
    this.recoilImpulse = 2;
    this.throwImpulse = 4;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.1), new THREE.MeshLambertMaterial({ color: 0x333344 }));
    body.position.x = 0.25;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.1), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    grip.position.set(0.05, -0.18, 0); grip.rotation.z = -0.2;
    grp.add(body, grip);
    this.mesh = grp;
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const mz = this._muzzlePos(player);
    const speed = 38;
    new Projectile(this.game, {
      x: mz.x, y: mz.y, vx: aim.x * speed, vy: aim.y * speed,
      damage: 20, owner: player, gravity: false, life: 1.6, radius: 0.08,
      color: 0xffcc33, emissive: 0xffaa00, tracer: true,
    });
    audio.shoot();
    // Sub-B recoil-jump — opposite aim direction. Y kept full (no damping)
    // so shooting straight down recoil-jumps straight up — the whole
    // point of the mechanic.
    if (window.__forceFeatures?.recoil !== 0) {
      const recoilMag = this.recoilImpulse;
      if (recoilMag > 0) {
        player.applyImpulse(-aim.x * recoilMag, -aim.y * recoilMag);
      }
    }
    this.game.fx.particles.burst(mz.x, mz.y, 0, { count: 5, speed: 4, color: 0xffaa33 });
    this.game.fx.camera.punch(0.08);
  }
}



export class Shotgun extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Shotgun';
    this.icon = '💥';
    this.fireDelay = 0.6;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = null;
    this.ammo = 4;
    this.barrelOffset = 0.90;
    this.recoilImpulse = 14;
    this.throwImpulse = 5;
    this.hitKnockback = 2.0;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    // Pump-action style: receiver + double barrels + wood furniture
    const recv = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.13, 0.09), new THREE.MeshLambertMaterial({ color: 0x2a2226 }));
    recv.position.x = 0.18;
    // Twin barrels stacked
    const barrelMat = new THREE.MeshLambertMaterial({ color: 0x14141a });
    const barrelTop = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.65, 10), barrelMat);
    barrelTop.rotation.z = Math.PI / 2; barrelTop.position.set(0.55, 0.045, 0);
    const barrelBot = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.65, 10), barrelMat);
    barrelBot.rotation.z = Math.PI / 2; barrelBot.position.set(0.55, -0.045, 0);
    // Pump handle (forearm) — wood
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.11), new THREE.MeshLambertMaterial({ color: 0x4a2818 }));
    pump.position.set(0.45, -0.08, 0);
    // Stock — wood, slight downward angle
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.09), new THREE.MeshLambertMaterial({ color: 0x3a2010 }));
    stock.position.set(-0.15, -0.06, 0); stock.rotation.z = -0.12;
    // Trigger guard arc
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 12, Math.PI), new THREE.MeshLambertMaterial({ color: 0x2a2226 }));
    guard.rotation.z = -Math.PI / 2; guard.position.set(0.14, -0.08, 0);
    // Front bead sight
    const sight = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), new THREE.MeshLambertMaterial({ color: 0xddccaa }));
    sight.position.set(0.85, 0.085, 0);
    grp.add(recv, barrelTop, barrelBot, pump, stock, guard, sight);
    this.mesh = grp;
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const ax = aim.x, ay = aim.y;
    const mz = this._muzzlePos(player);
    for (let i = 0; i < 7; i++) {
      const a = Math.atan2(ay, ax) + rand(-0.2, 0.2);
      const sp = rand(28, 36);
      new Projectile(this.game, {
        x: mz.x, y: mz.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        damage: 14, owner: player, gravity: false, life: 0.6, radius: 0.07,
        color: 0xffaa33, tracer: true,
      });
    }
    // Sub-B recoil-jump — opposite aim direction. Y kept full (no damping)
    // so shooting straight down recoil-jumps straight up — the whole
    // point of the mechanic.
    if (window.__forceFeatures?.recoil !== 0) {
      const recoilMag = this.recoilImpulse;
      if (recoilMag > 0) {
        player.applyImpulse(-aim.x * recoilMag, -aim.y * recoilMag);
      }
    }
    audio.shoot(); audio.shoot();
    this.game.fx.particles.burst(mz.x, mz.y, 0, { count: 12, speed: 6, color: 0xff8833 });
    this.game.fx.camera.punch(0.3);
  }
}



export class Minigun extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Minigun';
    this.icon = '🧨';
    this.fireDelay = 0.05;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = null;
    this.ammo = 60;
    this.length = 0.85;
    this.barrelOffset = 0.90;
    this._state = 'idle';      // 'idle' | 'spinningUp' | 'firing' | 'spinningDown'
    this._stateTimer = 0;
    this._fireAccum = 0;
    this._barrelAngle = 0;
    this._spinUpDur = 0.3;
    this._spinDownDur = 0.5;
    this.recoilImpulse = 0.8;
    this.throwImpulse = 6;
    this.hitKnockback = 0.9;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    // Receiver — chunky main body
    const recv = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.22), new THREE.MeshLambertMaterial({ color: 0x33333a }));
    recv.position.x = 0.28;
    // Six rotating barrels arranged in a hex pattern
    const barrelMat = new THREE.MeshLambertMaterial({ color: 0x141418 });
    const barrels = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const by = Math.sin(ang) * 0.08;
      const bz = Math.cos(ang) * 0.08;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), barrelMat);
      b.rotation.z = Math.PI / 2;
      b.position.set(0.7, by, bz);
      barrels.add(b);
    }
    // Hub at front holding the barrels together
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 8), new THREE.MeshLambertMaterial({ color: 0x222229 }));
    hub.rotation.z = Math.PI / 2; hub.position.set(0.99, 0, 0);
    // Ammo drum (right side)
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 12), new THREE.MeshLambertMaterial({ color: 0x44443c }));
    drum.rotation.z = Math.PI / 2; drum.position.set(0.18, -0.08, -0.16);
    // Belt feed link from drum to receiver
    const feed = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.08), new THREE.MeshLambertMaterial({ color: 0x2a2a30 }));
    feed.position.set(0.16, -0.05, -0.07);
    // Pistol grip (rear)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.09), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    grip.position.set(0.05, -0.2, 0); grip.rotation.z = -0.18;
    // Front handle (forward grip)
    const fgrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.08), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    fgrip.position.set(0.5, -0.22, 0);
    grp.add(recv, barrels, hub, drum, feed, grip, fgrip);
    this.mesh = grp;
    this._barrelGroup = barrels;
  }
  tryFire(player) {
    // Press handler — kick into spin-up if currently idle/spin-down.
    if (this._state === 'idle' || this._state === 'spinningDown') {
      this._state = 'spinningUp';
      this._stateTimer = 0;
    }
    // No immediate fire — heldTick handles it after spin-up completes.
  }
  releaseFire(player) {
    if (this._state === 'firing' || this._state === 'spinningUp') {
      this._state = 'spinningDown';
      this._stateTimer = 0;
    }
  }
  heldTick(dt, player) {
    this._stateTimer += dt;
    if (this._state === 'spinningUp') {
      if (this._stateTimer >= this._spinUpDur) {
        this._state = 'firing';
        this._stateTimer = 0;
        this._fireAccum = 0;
      }
    } else if (this._state === 'firing') {
      this._fireAccum += dt;
      while (this._fireAccum >= this.fireDelay && this.ammo > 0) {
        this._fireAccum -= this.fireDelay;
        this.fire(player);
        this.ammo--;
        if (this.ammo <= 0) {
          this._state = 'idle';
          player.weapon = null;
          this.destroy();
          return;
        }
      }
    } else if (this._state === 'spinningDown') {
      if (this._stateTimer >= this._spinDownDur) {
        this._state = 'idle';
        this._stateTimer = 0;
      }
    }
    // Visual barrel rotation. Skip on lowQ per project perf-tier rule.
    if (!window.__lowQ) {
      let rate = 0;
      if (this._state === 'spinningUp') rate = (this._stateTimer / this._spinUpDur) * 30;
      else if (this._state === 'firing') rate = 30;
      else if (this._state === 'spinningDown') rate = 30 * (1 - this._stateTimer / this._spinDownDur);
      this._barrelAngle += rate * dt;
      // Barrel group rotates around its own axis (set by _buildMesh).
      const barrel = this._barrelGroup;
      if (barrel) barrel.rotation.x = this._barrelAngle;
    }
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const a = Math.atan2(aim.y, aim.x) + rand(-0.06, 0.06);
    const mz = this._muzzlePos(player);
    new Projectile(this.game, {
      x: mz.x, y: mz.y,
      vx: Math.cos(a) * 42, vy: Math.sin(a) * 42, damage: 9, owner: player,
      gravity: false, life: 1.2, radius: 0.06, color: 0xffcc33, tracer: true,
    });
    // Sub-B recoil-jump — opposite aim direction. Y kept full (no damping)
    // so shooting straight down recoil-jumps straight up — the whole
    // point of the mechanic.
    if (window.__forceFeatures?.recoil !== 0) {
      const recoilMag = this.recoilImpulse;
      if (recoilMag > 0) {
        player.applyImpulse(-aim.x * recoilMag, -aim.y * recoilMag);
      }
    }
    audio.shoot();
    this.game.fx.camera.punch(0.12);                // ~3× cam shake
  }
}



export class SMG extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'SMG';
    this.icon = '🔫';
    this.fireDelay = 0.06;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = null;
    this.ammo = 60;
    this.length = 0.55;
    this.barrelOffset = 0.55;
    this._held = false;
    this._fireAccum = 0;
    this.recoilImpulse = 1.2;
    this.throwImpulse = 4;
    this.hitKnockback = 0.8;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const recv = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.1), new THREE.MeshLambertMaterial({ color: 0x2a2a2e }));
    recv.position.x = 0.21;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 8), new THREE.MeshLambertMaterial({ color: 0x141417 }));
    barrel.rotation.z = Math.PI / 2; barrel.position.x = 0.55;
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.08), new THREE.MeshLambertMaterial({ color: 0x1a1a1d }));
    mag.position.set(0.18, -0.18, 0); mag.rotation.z = -0.18;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.08), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    grip.position.set(0.05, -0.18, 0); grip.rotation.z = -0.15;
    grp.add(recv, barrel, mag, grip);
    this.mesh = grp;
  }
  tryFire(player) {
    this._held = true;
    if (this.cooldown > 0) return;
    // First shot fires immediately on press.
    this._fireAccum = this.fireDelay;
  }
  releaseFire(player) {
    this._held = false;
    this._fireAccum = 0;
  }
  heldTick(dt, player) {
    if (!this._held) return;
    this._fireAccum += dt;
    while (this._fireAccum >= this.fireDelay && this.ammo > 0) {
      this._fireAccum -= this.fireDelay;
      this.fire(player);
      this.ammo--;
      if (this.ammo <= 0) { player.weapon = null; this.destroy(); return; }
    }
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const a = Math.atan2(aim.y, aim.x) + rand(-0.07, 0.07);
    const sp = 40;
    const mz = this._muzzlePos(player);
    new Projectile(this.game, {
      x: mz.x, y: mz.y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      damage: 6, owner: player, gravity: false, life: 1.2, radius: 0.05,
      color: 0xffcc66, tracer: true,
    });
    audio.shoot();
    // Sub-B recoil-jump — opposite aim direction. Y kept full (no damping)
    // so shooting straight down recoil-jumps straight up — the whole
    // point of the mechanic.
    if (window.__forceFeatures?.recoil !== 0) {
      const recoilMag = this.recoilImpulse;
      if (recoilMag > 0) {
        player.applyImpulse(-aim.x * recoilMag, -aim.y * recoilMag);
      }
    }
    this.game.fx.camera.punch(0.025);
  }
}



export class AssaultRifle extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'AssaultRifle';
    this.icon = '🪖';
    this.fireDelay = 0.4;        // burst cooldown
    this._burstInterval = 0.05;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = null;
    this.ammo = 30;
    this.length = 0.95;
    this.barrelOffset = 1.00;
    this._burstRemaining = 0;
    this._burstAccum = 0;
    this._burstShotIndex = 0;
    this.recoilImpulse = 3;
    this.throwImpulse = 4;
    this.hitKnockback = 1.1;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const recv = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.13, 0.1), new THREE.MeshLambertMaterial({ color: 0x33332e }));
    recv.position.x = 0.27;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 10), new THREE.MeshLambertMaterial({ color: 0x14140f }));
    barrel.rotation.z = Math.PI / 2; barrel.position.x = 0.78;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.08), new THREE.MeshLambertMaterial({ color: 0x2a201a }));
    stock.position.x = -0.08;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.05), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    rail.position.set(0.32, 0.1, 0);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.08), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
    grip.position.set(0.08, -0.18, 0); grip.rotation.z = -0.15;
    grp.add(recv, barrel, stock, rail, grip);
    this.mesh = grp;
  }
  tryFire(player) {
    if (this.cooldown > 0) return;
    if (this._burstRemaining > 0) return;
    this.cooldown = this.fireDelay;
    this._burstRemaining = 3;
    this._burstAccum = this._burstInterval; // fire shot 0 on next heldTick
    this._burstShotIndex = 0;
  }
  heldTick(dt, player) {
    if (this._burstRemaining <= 0) return;
    this._burstAccum += dt;
    while (this._burstAccum >= this._burstInterval && this._burstRemaining > 0 && this.ammo > 0) {
      this._burstAccum -= this._burstInterval;
      this.fire(player, this._burstShotIndex);
      this._burstShotIndex++;
      this._burstRemaining--;
      this.ammo--;
      if (this.ammo <= 0) { player.weapon = null; this.destroy(); return; }
    }
  }
  fire(player, shotIndex = 0) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const spread = [0.035, 0.025, 0.015][shotIndex] ?? 0.02;
    const a = Math.atan2(aim.y, aim.x) + rand(-spread, spread);
    const sp = 50;
    const mz = this._muzzlePos(player);
    new Projectile(this.game, {
      x: mz.x, y: mz.y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      damage: 12, owner: player, gravity: false, life: 1.4, radius: 0.06,
      color: 0xffeecc, tracer: true,
    });
    audio.shoot();
    // Sub-B recoil-jump — opposite aim direction. Y kept full (no damping)
    // so shooting straight down recoil-jumps straight up — the whole
    // point of the mechanic.
    if (window.__forceFeatures?.recoil !== 0) {
      const recoilMag = this.recoilImpulse;
      if (recoilMag > 0) {
        player.applyImpulse(-aim.x * recoilMag, -aim.y * recoilMag);
      }
    }
    const punch = shotIndex === 0 ? 0.06 : 0.04;
    this.game.fx.camera.punch(punch);
  }
}



export class Revolver extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Revolver';
    this.icon = '🔫';
    this.fireDelay = 0.5;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = null;          // 1H
    this.ammo = 6;
    this.length = 0.55;
    this.barrelOffset = 0.65;
    this._hammerCock = 0;
    this.recoilImpulse = 5;
    this.throwImpulse = 4;
    this.hitKnockback = 1.4;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    // Frame — slim, longer than a pistol body
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.08), new THREE.MeshLambertMaterial({ color: 0x2a2226 }));
    frame.position.x = 0.16;
    // Long barrel — distinguishes from pistol
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 12), new THREE.MeshLambertMaterial({ color: 0x14141a }));
    barrel.rotation.z = Math.PI / 2; barrel.position.set(0.42, 0.015, 0);
    // Top strap (continues over barrel)
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.06), new THREE.MeshLambertMaterial({ color: 0x14141a }));
    top.position.set(0.42, 0.07, 0);
    // Exposed cylinder — fat, visible, between frame and grip
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 8), new THREE.MeshLambertMaterial({ color: 0x33333a }));
    cylinder.rotation.z = Math.PI / 2; cylinder.position.set(0.18, -0.02, 0);
    // Cylinder front face flute (cosmetic — visible chamber holes)
    const fluteMat = new THREE.MeshLambertMaterial({ color: 0x111114 });
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const fx = 0.18 + Math.cos(ang) * 0.045 * 0; // x is the rotation axis — depth doesn't change
      const fy = -0.02 + Math.sin(ang) * 0.045;
      const fz = Math.cos(ang) * 0.045;
      const flute = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.13, 4), fluteMat);
      flute.rotation.z = Math.PI / 2;
      flute.position.set(0.18, fy, fz);
      grp.add(flute);
    }
    // Front sight blade
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.04, 0.015), new THREE.MeshLambertMaterial({ color: 0x080808 }));
    sight.position.set(0.6, 0.07, 0);
    // Hammer — exposed
    const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.05), new THREE.MeshLambertMaterial({ color: 0x111114 }));
    hammer.position.set(0.05, 0.11, 0);
    // Grip — sharp back-lean angle, wood color
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.08), new THREE.MeshLambertMaterial({ color: 0x4a2818 }));
    grip.position.set(-0.02, -0.18, 0); grip.rotation.z = -0.32;
    // Trigger guard — small arc
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 12, Math.PI), new THREE.MeshLambertMaterial({ color: 0x2a2226 }));
    guard.rotation.z = -Math.PI / 2; guard.position.set(0.12, -0.07, 0);
    grp.add(frame, barrel, top, cylinder, sight, hammer, grip, guard);
    this.mesh = grp;
    this._hammerMesh = hammer;
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const sp = 60;
    const mz = this._muzzlePos(player);
    new Projectile(this.game, {
      x: mz.x, y: mz.y,
      vx: aim.x * sp, vy: aim.y * sp,
      damage: 35, owner: player, gravity: false, life: 1.5, radius: 0.09,
      color: 0xffaa55, emissive: 0xff7733, tracer: true,
    });
    audio.shoot();
    // Sub-B recoil-jump — opposite aim direction. Y kept full (no damping)
    // so shooting straight down recoil-jumps straight up — the whole
    // point of the mechanic.
    if (window.__forceFeatures?.recoil !== 0) {
      const recoilMag = this.recoilImpulse;
      if (recoilMag > 0) {
        player.applyImpulse(-aim.x * recoilMag, -aim.y * recoilMag);
      }
    }
    this.game.fx.camera.punch(0.18);
    this.game.fx.particles.burst(mz.x, mz.y, 0,
      { count: 7, speed: 5, color: 0xffaa55 });
    this._hammerCock = 1;
  }
  heldTick(dt, player) {
    // Cosmetic hammer cock-back animation only.
    if (this._hammerCock > 0) {
      this._hammerCock = Math.max(0, this._hammerCock - dt * 4);
      if (this._hammerMesh) this._hammerMesh.rotation.z = -0.4 * this._hammerCock;
    }
  }
}



export class Crossbow extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Crossbow';
    this.icon = '🏹';
    this.fireDelay = 0.9;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = null;        // 1H outstretched
    this.ammo = 8;
    this.length = 1.6;
    this.barrelOffset = 1.1;
    this._postFireTimer = 0;
    this.recoilImpulse = 3;
    this.throwImpulse = 4;
    this.hitKnockback = 1.1;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.14, 0.13), new THREE.MeshLambertMaterial({ color: 0x3a2410 }));
    stock.position.x = 0.25;
    // Horizontal limbs (NOT a vertical bow arc) — long & wide
    const limbU = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.65, 0.06), new THREE.MeshLambertMaterial({ color: 0x4a2a14 }));
    limbU.position.set(0.45, 0.09, 0); limbU.rotation.z = 0.5;
    const limbD = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.65, 0.06), new THREE.MeshLambertMaterial({ color: 0x4a2a14 }));
    limbD.position.set(0.45, -0.09, 0); limbD.rotation.z = -0.5;
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.012, 0.012), new THREE.MeshLambertMaterial({ color: 0xddd8c8 }));
    string.position.set(0.05, 0, 0);
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.035, 0.035), new THREE.MeshLambertMaterial({ color: 0x202024 }));
    bolt.position.set(0.45, 0.06, 0);
    grp.add(stock, limbU, limbD, string, bolt);
    this.mesh = grp;
    this._stringMesh = string;
    this._boltMesh = bolt;
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const sp = 48;  // 1.6× the old bow's 30
    const boltMesh = (() => {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.6, 6), new THREE.MeshLambertMaterial({ color: 0x202024 }));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 6), new THREE.MeshLambertMaterial({ color: 0x666674 }));
      tip.position.y = 0.36;
      const fletch = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.005), new THREE.MeshLambertMaterial({ color: 0xddccaa }));
      fletch.position.y = -0.26;
      g.add(shaft, tip, fletch);
      return g;
    })();
    const mz = this._muzzlePos(player);
    const proj = new Projectile(this.game, {
      x: mz.x, y: mz.y,
      vx: aim.x * sp, vy: aim.y * sp,
      damage: 28, owner: player, mesh: boltMesh,
      gravity: true, gravityScale: 0.5,
      life: 4, radius: 0.05,
      sticky: true, stickLife: 5,
    });
    proj._orientToVel = true;
    audio.shoot();
    // Sub-B recoil-jump — opposite aim direction. Y kept full (no damping)
    // so shooting straight down recoil-jumps straight up — the whole
    // point of the mechanic.
    if (window.__forceFeatures?.recoil !== 0) {
      const recoilMag = this.recoilImpulse;
      if (recoilMag > 0) {
        player.applyImpulse(-aim.x * recoilMag, -aim.y * recoilMag);
      }
    }
    this.game.fx.camera.punch(0.12);
    if (this._stringMesh) this._stringMesh.scale.x = 0.85;
    if (this._boltMesh) this._boltMesh.visible = false;
    this._postFireTimer = 0.3;
  }
  heldTick(dt, player) {
    if (this._postFireTimer > 0) {
      this._postFireTimer -= dt;
      if (this._postFireTimer <= 0) {
        if (this._stringMesh) this._stringMesh.scale.x = 1;
        if (this._boltMesh) this._boltMesh.visible = true;
      }
    }
  }
}



export class Flamethrower extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Flamethrower';
    this.icon = '🔥';
    this.fireDelay = 0.04;       // 25Hz fire rate while held
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = null;
    this.ammo = 80;              // ~3.2s sustained
    this.length = 0.65;
    this.barrelOffset = 0.55;
    this._held = false;
    this._fireAccum = 0;
    this.recoilImpulse = 0.4;
    this.throwImpulse = 4;
    this.hitKnockback = 0.4;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.32, 8), new THREE.MeshLambertMaterial({ color: 0x553311 }));
    tank.rotation.z = Math.PI / 2; tank.position.set(0.0, -0.05, 0);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 8), new THREE.MeshLambertMaterial({ color: 0x222226 }));
    nozzle.rotation.z = Math.PI / 2; nozzle.position.set(0.4, 0.05, 0);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.08), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    grip.position.set(0.18, -0.18, 0); grip.rotation.z = -0.15;
    grp.add(tank, nozzle, grip);
    this.mesh = grp;
  }
  tryFire(player) {
    this._held = true;
    if (this.cooldown > 0) return;
    this._fireAccum = this.fireDelay;
  }
  releaseFire(player) {
    this._held = false;
    this._fireAccum = 0;
  }
  heldTick(dt, player) {
    if (!this._held) return;
    this._fireAccum += dt;
    while (this._fireAccum >= this.fireDelay && this.ammo > 0) {
      this._fireAccum -= this.fireDelay;
      this._fireOneFlame(player);
      this.ammo--;
      if (this.ammo <= 0) {
        this._held = false;
        player.weapon = null;
        this.destroy();
        return;
      }
    }
    // Continuous low cam shake while firing.
    if (this._held) this.game.fx.camera.punch(0.005);
  }
  _fireOneFlame(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    // 15° cone spread per shot — fans out naturally.
    const a = Math.atan2(aim.y, aim.x) + rand(-0.13, 0.13);
    const sp = 22 + rand(-2, 2);
    const mz = this._muzzlePos(player);
    // Small orange-red glowing sphere.
    const flameMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 5),
      new THREE.MeshLambertMaterial({ color: 0xff5511, emissive: 0xff8833, emissiveIntensity: 1.2 }),
    );
    const proj = new Projectile(this.game, {
      x: mz.x, y: mz.y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      damage: 0,                  // damage is the ignite, not the impact
      owner: player,
      mesh: flameMesh,
      gravity: true, gravityScale: 0.25,
      life: 0.6, radius: 0.08,
      noPush: true,               // ignite without shoving/lifting the victim
      tracerColor: 0xff8833,
    });
    // On impact: ignite players hit, drop a fire patch on world hits.
    proj.onHit = (pr, other) => {
      if (other.userData?.kind === 'player') {
        const sm = other.userData.stickman;
        sm?.applyBurn?.(2.5, 4, player);
      } else if (other.userData?.kind === 'tile') {
        spawnFirePatch(this.game, {
          x: pr.body.position.x, y: pr.body.position.y, owner: player,
        });
      }
    };
    audio.shoot();
    // Sub-B recoil-jump — opposite aim direction. Y kept full (no damping)
    // so shooting straight down recoil-jumps straight up — the whole
    // point of the mechanic.
    if (window.__forceFeatures?.recoil !== 0) {
      const recoilMag = this.recoilImpulse;
      if (recoilMag > 0) {
        player.applyImpulse(-aim.x * recoilMag, -aim.y * recoilMag);
      }
    }
  }
}



export class DualPistols extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'DualPistols';
    this.icon = '🔫🔫';
    this.fireDelay = 0.18;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = 'aim';        // dual — both arms aim independently
    this.ammo = 24;
    this.length = 0.55;
    this.barrelOffset = 0.55;
    this._nextHand = 'R';
    this.recoilImpulse = 2;
    this.throwImpulse = 3;
  }
  _buildMesh() {
    const buildOne = (color = 0x333344) => {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.08), new THREE.MeshLambertMaterial({ color }));
      body.position.x = 0.2;
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.08), new THREE.MeshLambertMaterial({ color: 0x222222 }));
      grip.position.set(0.04, -0.15, 0); grip.rotation.z = -0.18;
      grp.add(body, grip);
      return grp;
    };
    this._meshR = buildOne(0x333344);
    this._meshL = buildOne(0x333344);
    const grp = new THREE.Group();
    grp.add(this._meshR);
    grp.add(this._meshL);
    this.mesh = grp;
  }
  // Compact children back into local-space positions around the parent
  // origin. Held updateMesh sets each child to a WORLD position (handR /
  // handL); without recentering, throwing the weapon would make both
  // pistols orbit the parent in a huge circle as the body spins.
  _packForWorld() {
    if (this._meshR) {
      this._meshR.position.set(0.0, 0.08, 0);
      this._meshR.rotation.set(0, 0, 0);
      this._meshR.scale.set(1, 1, 1);
    }
    if (this._meshL) {
      this._meshL.position.set(0.0, -0.08, 0);
      this._meshL.rotation.set(0, 0, 0);
      this._meshL.scale.set(1, 1, 1);
    }
  }
  spawnAt(x, y, z = 0, opts = {}) {
    this._packForWorld();
    return super.spawnAt(x, y, z, opts);
  }
  dropAt(pos, vel) {
    this._packForWorld();
    return super.dropAt(pos, vel);
  }
  updateMesh(player) {
    // Override: don't run base wall-reorient (would conflict with two
    // independent muzzle anchors). Position each pistol at its respective
    // hand bone, rotate to aim direction.
    if (!player) return;
    // Reset parent group to origin — child meshes use world coordinates
    // for their positions, but they'd be offset by any stale parent
    // transform left over from world-spawn (pickup) state.
    this.mesh.position.set(0, 0, 0);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.quaternion.identity();
    this.mesh.scale.set(1, 1, 1);
    const handR = player.rig?.handR?.getWorldPosition(_w2a);
    const handL = player.rig?.handL?.getWorldPosition(_w2b);
    const aim = player.aimDir;
    const ang = Math.atan2(aim.y, aim.x);
    const facing = player.facing;
    if (handR && this._meshR) {
      this._meshR.position.set(handR.x, handR.y, 0);
      this._meshR.rotation.set(0, 0, ang);
      this._meshR.scale.set(1, facing >= 0 ? 1 : -1, 1);
    }
    if (handL && this._meshL) {
      this._meshL.position.set(handL.x, handL.y, 0);
      this._meshL.rotation.set(0, 0, ang);
      this._meshL.scale.set(1, facing >= 0 ? 1 : -1, 1);
    }
    this.effectiveAimDir = { x: aim.x, y: aim.y };
    this.aimAdjusted = false;
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const a = Math.atan2(aim.y, aim.x) + rand(-0.018, 0.018);
    const sp = 38;
    const handBone = (this._nextHand === 'R') ? player.rig?.handR : player.rig?.handL;
    const muzzleVec = handBone ? handBone.getWorldPosition(_w2a) : null;
    const mx = muzzleVec ? muzzleVec.x : (player.position.x + aim.x * 0.7);
    const my = muzzleVec ? muzzleVec.y : (player.position.y + 0.7);
    new Projectile(this.game, {
      x: mx + aim.x * 0.3, y: my + aim.y * 0.3,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      damage: 12, owner: player, gravity: false, life: 1.5, radius: 0.07,
      color: 0xffcc55, emissive: 0xffaa22, tracer: true,
    });
    audio.shoot();
    // Sub-B recoil-jump — opposite aim direction. Y kept full (no damping)
    // so shooting straight down recoil-jumps straight up — the whole
    // point of the mechanic.
    if (window.__forceFeatures?.recoil !== 0) {
      const recoilMag = this.recoilImpulse;
      if (recoilMag > 0) {
        player.applyImpulse(-aim.x * recoilMag, -aim.y * recoilMag);
      }
    }
    this.game.fx.camera.punch(0.07);
    this._nextHand = (this._nextHand === 'R') ? 'L' : 'R';
  }
}



// Sniper rifle — hitscan, line-of-sight laser sight. The laser updates each
// tick to terminate at the first WORLD or PLAYER body the ray hits, so it
// honours cover (walls block both the laser and the shot). Single-shot, big
// damage, big recoil. Reward for committing to the aim animation.
export class SniperRifle extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Sniper';
    this.icon = '🎯';
    this.fireDelay = 1.0;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = null;
    this.ammo = 3;
    this.barrelOffset = 1.27;
    this._laser = null;
    this._laserDot = null;
    this._tracerTime = 0;
    this.recoilImpulse = 8;
    this.throwImpulse = 5;
    this.hitKnockback = 2.4;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.13, 0.09), new THREE.MeshLambertMaterial({ color: 0x2a1a10 }));
    stock.position.x = -0.05;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.11, 0.09), new THREE.MeshLambertMaterial({ color: 0x222230 }));
    body.position.x = 0.32;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 10), new THREE.MeshLambertMaterial({ color: 0x111118 }));
    barrel.rotation.z = Math.PI / 2; barrel.position.x = 0.78;
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8), new THREE.MeshLambertMaterial({ color: 0x080808 }));
    muzzle.rotation.z = Math.PI / 2; muzzle.position.x = 1.27;
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 12), new THREE.MeshLambertMaterial({ color: 0x101018 }));
    scope.rotation.z = Math.PI / 2; scope.position.set(0.32, 0.16, 0);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), new THREE.MeshLambertMaterial({ color: 0x44ddff, emissive: 0x2288cc, emissiveIntensity: 0.8 }));
    lens.rotation.y = Math.PI / 2; lens.position.set(0.5, 0.16, 0);
    const bipod = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), new THREE.MeshLambertMaterial({ color: 0x333344 }));
    bipod.position.set(0.7, -0.13, 0);
    grp.add(stock, body, barrel, muzzle, scope, lens, bipod);
    this.mesh = grp;
  }
  _muzzleWorld(player) {
    // Anchor laser/raycast origin to the actual rendered barrel tip:
    // hand world position + aim direction × local muzzle distance. This
    // way the red dot follows the gun mesh as the hand sways/recoils,
    // not a fixed body-relative point that drifts away from the visual.
    // Mesh layout: barrel cylinder centered at local x=0.78 with length
    // 0.95 → tip at local x ≈ 1.27 (matches the muzzle puff mesh).
    const aim = this.effectiveAimDir ?? player.aimDir;
    const handRJoint = player.rig?.handR;
    const handR = handRJoint ? handRJoint.getWorldPosition(_w2a) : null;
    if (handR) {
      const tipDist = 1.27;
      return { x: handR.x + aim.x * tipDist, y: handR.y + aim.y * tipDist };
    }
    // Fallback before rig is ready: shoulder-anchored approximation.
    const facing = player.facing || 1;
    return { x: player.position.x + facing * 0.55, y: player.position.y + 0.45 };
  }
  _castShot(player, maxRange = 60) {
    // Two-ray approach because the cannon-shim Rapier raycast doesn't return
    // the hit body — only the hit point + distance. Cast against WORLD/PROP
    // (walls + tiles) and PLAYER separately, compare distances. Closest hit
    // is the real hit; if no player ray hit before the world ray, line of
    // sight is blocked by cover.
    const mz = this._muzzleWorld(player);
    const aim = this.effectiveAimDir ?? player.aimDir;
    const ax = aim.x, ay = aim.y;
    const from = { x: mz.x, y: mz.y, z: 0 };
    const to = { x: mz.x + ax * maxRange, y: mz.y + ay * maxRange, z: 0 };
    const worldHit = this.game.physics.raycast(from, to, { mask: COL_GROUPS.WORLD | COL_GROUPS.PROP });
    // For player hits we'd ideally raycast PLAYER mask, but the shim still
    // can't tell us *which* player. Cheaper: walk the players list and test
    // the ray against each one's body cylinder + head sphere.
    const projectOnto = (cx, cy) => {
      const rx = cx - from.x, ry = cy - from.y;
      const along = rx * ax + ry * ay;
      if (along < 0 || along > maxRange) return null;
      const px = from.x + ax * along, py = from.y + ay * along;
      return { along, perp: Math.hypot(cx - px, cy - py) };
    };
    let playerHit = null;
    let playerDist = Infinity;
    let isHead = false;
    for (const target of this.game.players) {
      if (!target || !target.alive || target === player) continue;
      const tx = target.position.x;
      // Head sphere — tight radius, sits above shoulder. Hit here = headshot.
      const headP = projectOnto(tx, target.position.y + 1.15);
      // Body cylinder — wider slack, includes torso and lower legs.
      const bodyP = projectOnto(tx, target.position.y + 0.55);
      let along = Infinity, head = false;
      if (headP && headP.perp <= 0.22) { along = headP.along; head = true; }
      if (bodyP && bodyP.perp <= 0.55 && bodyP.along < along) { along = bodyP.along; head = false; }
      if (along < playerDist) { playerDist = along; playerHit = target; isHead = head; }
    }
    const worldDist = worldHit ? worldHit.distance : Infinity;
    if (playerHit && playerDist < worldDist) {
      const hp = { x: from.x + ax * playerDist, y: from.y + ay * playerDist, z: 0 };
      return { from: mz, to: hp, hit: { kind: 'player', target: playerHit, isHead, point: hp, distance: playerDist } };
    }
    if (worldHit) {
      const hp = worldHit.hitPointWorld;
      return { from: mz, to: { x: hp.x, y: hp.y, z: 0 }, hit: { kind: 'world', point: { x: hp.x, y: hp.y, z: 0 }, distance: worldDist } };
    }
    return { from: mz, to, hit: null };
  }
  worldTick(dt) {
    super.worldTick(dt);
    if (this._tracerTime > 0) this._tracerTime -= dt;
    // Laser sight: always visible while held — gives the carrier (and
    // their targets) a constant readout of where the shot will land.
    // Hidden only when the weapon isn't held.
    if (!this.holder) {
      if (this._laser) this._laser.visible = false;
      if (this._laserDot) this._laserDot.visible = false;
      return;
    }
    const player = this.holder;
    const cast = this._castShot(player);
    if (!this._laser) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const mat = new THREE.LineBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.55 });
      this._laser = new THREE.Line(geo, mat);
      this.game.scene.add(this._laser);
      const dotGeo = new THREE.SphereGeometry(0.06, 8, 6);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xff3344 });
      this._laserDot = new THREE.Mesh(dotGeo, dotMat);
      this.game.scene.add(this._laserDot);
    }
    this._laser.visible = true;
    this._laserDot.visible = true;
    const pos = this._laser.geometry.attributes.position;
    pos.setXYZ(0, cast.from.x, cast.from.y, 0);
    pos.setXYZ(1, cast.to.x, cast.to.y, 0);
    pos.needsUpdate = true;
    this._laserDot.position.set(cast.to.x, cast.to.y, 0);
    // Color hints: brighter + slight pulse when the laser is on a player's
    // head — a "you're locked" cue for both shooter and target.
    const onHead = cast.hit?.kind === 'player' && cast.hit.isHead;
    const onPlayer = cast.hit?.kind === 'player';
    const baseOpacity = this._tracerTime > 0 ? 0.95 : (onHead ? 0.95 : 0.55);
    this._laser.material.opacity = baseOpacity;
    this._laser.material.color.setHex(onHead ? 0xff2244 : (onPlayer ? 0xff5566 : 0xff3344));
    this._laserDot.material.color.setHex(onHead ? 0xff2244 : 0xff3344);
    const dotScale = (this._tracerTime > 0 ? 3 : (onHead ? 1.6 + Math.sin(performance.now() * 0.018) * 0.3 : 1));
    this._laserDot.scale.setScalar(dotScale);
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const cast = this._castShot(player);
    const ax = aim.x, ay = aim.y;
    audio.shoot(); audio.beep(220, 0.18, 'sawtooth', 0.4);
    this._tracerTime = 0.18;
    // Sub-B recoil-jump — opposite aim direction. Y kept full (no damping)
    // so shooting straight down recoil-jumps straight up — the whole
    // point of the mechanic.
    if (window.__forceFeatures?.recoil !== 0) {
      const recoilMag = this.recoilImpulse;
      if (recoilMag > 0) {
        player.applyImpulse(-aim.x * recoilMag, -aim.y * recoilMag);
      }
    }
    this.game.fx.camera.punch(0.55);
    this.game.hitStop?.(0.06);
    this.game.fx.particles.burst(cast.from.x, cast.from.y, 0, { count: 14, speed: 8, color: 0xffd060 });
    if (cast.hit) {
      const hp = cast.hit.point;
      if (cast.hit.kind === 'player') {
        const sm = cast.hit.target;
        if (sm && sm !== player && sm.alive && sm.invuln <= 0) {
          if (cast.hit.isHead) {
            // Headshot — instant kill. Pass enough damage to clear any
            // armor + max health so takeDamage drops the target regardless.
            const overkill = (sm.maxHealth ?? 100) + (sm.maxArmor ?? 0) + 200;
            sm.takeDamage(overkill, {
              attacker: player, weapon: 'sniper-head',
              kb: { x: ax * 12, y: 7 + Math.abs(ay) * 3 }, stun: 0.6,
            });
            this.game.fx.particles.blood?.(hp.x, hp.y, 0, ax >= 0 ? 1 : -1, 1.4);
            this.game.fx.particles.burst(hp.x, hp.y, 0, { count: 32, speed: 14, color: 0xff2244 });
            this.game.fx.camera.punch(0.85);
            this.game.hitStop?.(0.14);
            audio.beep?.(140, 0.22, 'sawtooth', 0.5);
            this.game.hud?.showCenter?.('HEADSHOT', '', 900);
          } else {
            sm.takeDamage(85, {
              attacker: player, weapon: 'sniper',
              kb: { x: ax * 10, y: 4 + Math.abs(ay) * 3 }, stun: 0.4,
            });
            this.game.fx.particles.blood?.(hp.x, hp.y, 0, ax >= 0 ? 1 : -1, 0.8);
          }
        }
      }
      // Tile damage: shim raycast doesn't return the hit body, so we damage
      // any tile within a small radius of the hit point. Less precise than a
      // single-tile hit but visually consistent and avoids needing body refs.
      this.game.level.damageArea?.(hp.x, hp.y, 0.6, 30, this);
      this.game.fx.particles.burst(hp.x, hp.y, 0, { count: 10, speed: 6, color: 0xffeeaa });
    }
  }
  detach() {
    super.detach();
    // Hide laser when dropped — re-shown when picked back up + aimed.
    if (this._laser) this._laser.visible = false;
    if (this._laserDot) this._laserDot.visible = false;
  }
  destroy() {
    if (this._laser) {
      this._laser.parent?.remove(this._laser);
      this._laser.geometry.dispose();
      this._laser.material.dispose();
      this._laser = null;
    }
    if (this._laserDot) {
      this._laserDot.parent?.remove(this._laserDot);
      this._laserDot.geometry.dispose();
      this._laserDot.material.dispose();
      this._laserDot = null;
    }
    super.destroy();
  }
}



// Throwing knives — fast, light, sticky. High rate of fire, low per-hit dmg.
// Niche between bow (slow, heavy) and pistol (fast, no stick) — sticks into
// terrain and players for 5s, leaving visible record of recent fights.
export class Shurikens extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Shurikens';
    this.icon = '⭐';
    this.fireDelay = 0.18;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.ammo = 8;
    this.throwImpulse = 2;
    this.hitKnockback = 0.5;
  }
  _buildMesh() {
    // 6-pointed throwing star with center hub + circular hole. Built via
    // Shape (12 vertices: alternating outer-tip + inner-cleft) extruded
    // thin, with a center hole punched through.
    const grp = new THREE.Group();
    grp.add(_buildShurikenMesh(0.18, 0.05, 0.025));
    this.mesh = grp;
    // Anchor offset so it visually centers in hand.
    grp.position.x = 0.14;
  }
  fire(player) {
    const ax = player.aimDir.x, ay = player.aimDir.y;
    const mesh = _buildShurikenMesh(0.20, 0.058, 0.03);
    const proj = new Projectile(this.game, {
      x: player.position.x + ax * 0.7, y: player.position.y + 0.7 + ay * 0.3,
      vx: ax * 22, vy: ay * 22, damage: 22, owner: player,
      gravity: true, gravityScale: 0.2, life: 2.5, radius: 0.13,
      sticky: true, stickLife: 5, mesh, color: 0x888899,
    });
    // Spin freely as it flies — do NOT orient to velocity.
    proj.body.angularVelocity.set(0, 0, 25);
    audio.beep(900, 0.05, 'square', 0.18);
    audio.swing();
  }
}



// Build a 6-pointed shuriken mesh: thin extruded star with center hole.
// outerR = blade-tip radius, innerR = cleft radius, depth = thickness.
function _buildShurikenMesh(outerR, innerR, depth) {
  const points = 6;
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const ang = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = (i % 2 === 0) ? outerR : innerR;
    const px = Math.cos(ang) * r;
    const py = Math.sin(ang) * r;
    if (i === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  }
  shape.closePath();
  // Center hole — small circle subtracted.
  const hole = new THREE.Path();
  const holeR = innerR * 0.35;
  for (let i = 0; i <= 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const px = Math.cos(ang) * holeR;
    const py = Math.sin(ang) * holeR;
    if (i === 0) hole.moveTo(px, py);
    else hole.lineTo(px, py);
  }
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -depth / 2);
  const mat = new THREE.MeshLambertMaterial({ color: 0x888899, emissive: 0x222233 });
  return new THREE.Mesh(geo, mat);
}



// Spawn table — every entry tagged with a stable `id` (used for the
// player-facing toggle UI's localStorage keys), a `label` (display text),
// and a `cat` (group bucket for the weapon-toggle settings panel).
// =============================================================================
// New weapons (overhaul Phase 5).
// =============================================================================

// SPIKE THROWER — fires a spike that impales + PINS the target in place
// (no bleed). noPush so the pin isn't fought by knockback.
export class SpikeThrower extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Spike Thrower'; this.icon = '🔱';
    this.fireDelay = 0.7; this.aimWeapon = true; this.poseRight = 'aim'; this.poseLeft = null;
    this.ammo = 5; this.length = 0.7; this.barrelOffset = 0.6;
    this.recoilImpulse = 4; this.throwImpulse = 4; this.hitKnockback = 1.0;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.1), new THREE.MeshLambertMaterial({ color: 0x3a3a44 }));
    body.position.x = 0.2;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.04), new THREE.MeshLambertMaterial({ color: 0x6a6a72 }));
    rail.position.set(0.32, 0.08, 0);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.08), new THREE.MeshLambertMaterial({ color: 0x222226 }));
    grip.position.set(0.05, -0.16, 0); grip.rotation.z = -0.2;
    grp.add(body, rail, grip); this.mesh = grp;
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const sp = 42; const mz = this._muzzlePos(player);
    const spike = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0x9a9aa4 }));
    shaft.rotation.z = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), new THREE.MeshLambertMaterial({ color: 0xcfcfd8 }));
    tip.rotation.z = -Math.PI / 2; tip.position.x = 0.3;
    spike.add(shaft, tip); spike.rotation.z = Math.atan2(aim.y, aim.x);
    const proj = new Projectile(this.game, {
      x: mz.x, y: mz.y, vx: aim.x * sp, vy: aim.y * sp,
      damage: 0, owner: player, gravity: true, gravityScale: 0.4, life: 2, radius: 0.09,
      mesh: spike, noPush: true, tracerColor: 0xcfcfd8,
    });
    proj.onHit = (pr, other) => {
      if (other.userData?.kind !== 'player') return;
      const sm = other.userData.stickman;
      if (!sm || sm === player) return;
      sm.takeDamage(14, { attacker: player, weapon: 'spike' });   // no kb → stays put
      sm._pinnedUntil = performance.now() + 1200;
      this.game.fx.particles.burst(sm.position.x, sm.position.y + 0.3, 0, { count: 12, speed: 5, color: 0xcfcfd8 });
    };
    audio.shoot();
    if (window.__forceFeatures?.recoil !== 0 && this.recoilImpulse > 0) player.applyImpulse(-aim.x * this.recoilImpulse, -aim.y * this.recoilImpulse);
    this.game.fx.camera.punch(0.15);
  }
}



// SHRINK RAY — beam that shrinks the target for a few seconds (smaller, easier
// to launch). Wears off.
export class ShrinkRay extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Shrink Ray'; this.icon = '🔬';
    this.fireDelay = 0.8; this.aimWeapon = true; this.poseRight = 'aim'; this.poseLeft = null;
    this.ammo = 4; this.length = 0.6; this.barrelOffset = 0.6; this.throwImpulse = 3;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.12), new THREE.MeshLambertMaterial({ color: 0x6a3a8a }));
    body.position.x = 0.18;
    const dish = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.18, 12, 1, true), new THREE.MeshLambertMaterial({ color: 0xc060ff, emissive: 0x6a1a8a, side: THREE.DoubleSide }));
    dish.rotation.z = -Math.PI / 2; dish.position.x = 0.42;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.18, 0.08), new THREE.MeshLambertMaterial({ color: 0x2a1838 }));
    grip.position.set(0.05, -0.15, 0);
    grp.add(body, dish, grip); this.mesh = grp;
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const sp = 48; const mz = this._muzzlePos(player);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshLambertMaterial({ color: 0xc060ff, emissive: 0x9020dd, emissiveIntensity: 1 }));
    const proj = new Projectile(this.game, {
      x: mz.x, y: mz.y, vx: aim.x * sp, vy: aim.y * sp,
      damage: 0, owner: player, gravity: false, life: 1.2, radius: 0.13,
      mesh: orb, noPush: true, tracerColor: 0xc060ff,
    });
    proj.onHit = (pr, other) => {
      if (other.userData?.kind !== 'player') return;
      const sm = other.userData.stickman;
      if (!sm || sm === player) return;
      sm._shrinkUntil = performance.now() + 5000;
      sm.takeDamage(6, { attacker: player, weapon: 'shrink' });
      this.game.fx.particles.burst(sm.position.x, sm.position.y + 0.3, 0, { count: 16, speed: 6, color: 0xc060ff });
    };
    audio.shoot(); audio.beep(1400, 0.1, 'sine', 0.2); this.game.fx.camera.punch(0.1);
  }
}



// VACUUM GUN — hold to suck players (+loose stuff) toward the muzzle; release to
// blast them back out. Captured count boosts the blast.
export class VacuumGun extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Vacuum Gun'; this.icon = '🌀';
    this.aimWeapon = true; this.poseRight = 'aim'; this.poseLeft = null;
    this.ammo = Infinity; this.length = 0.75; this.barrelOffset = 0.62;
    this._held = false; this._captured = 0; this.throwImpulse = 3; this.hitKnockback = 1.0;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.14), new THREE.MeshLambertMaterial({ color: 0x33445a }));
    body.position.x = 0.16;
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.08, 0.26, 14, 1, true), new THREE.MeshLambertMaterial({ color: 0x5a7aa0, side: THREE.DoubleSide, emissive: 0x14304a }));
    funnel.rotation.z = -Math.PI / 2; funnel.position.x = 0.5;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.08), new THREE.MeshLambertMaterial({ color: 0x202830 }));
    grip.position.set(0.04, -0.16, 0);
    grp.add(body, funnel, grip); this.mesh = grp;
  }
  tryFire(player) { this._held = true; }
  releaseFire(player) { if (this._held) { this._held = false; this._blast(player); } }
  heldTick(dt, player) { if (this._held) this._suck(dt, player); }
  _suck(dt, player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const mz = this._muzzlePos(player);
    for (const p of this.game.players) {
      if (!p || p === player || !p.alive) continue;
      const dx = p.position.x - mz.x, dy = p.position.y - mz.y; const d = Math.hypot(dx, dy) || 1;
      if (d > 7 || d < 0.6) { if (d < 0.6) this._captured++; continue; }
      const dot = (dx / d) * aim.x + (dy / d) * aim.y;
      if (dot < 0.3) continue;                 // only what's in front of the funnel
      // Drag the target IN by nudging position toward the muzzle — a velocity
      // push would just be overwritten by their own _move each frame. Capped so
      // it can't tunnel through walls.
      const step = Math.min(0.26, 20 * (1 - d / 7) * dt);
      p.body.wakeUp?.();
      p.body.position.x += -(dx / d) * step;
      p.body.position.y += (-(dy / d) + 0.15) * step;
      p.body.velocity.x += -(dx / d) * 4 * dt;   // a little velocity for feel
      if (d < 1.4) this._captured++;
    }
    if (Math.random() < dt * 25 && this.game.fx) this.game.fx.particles.spark.spawn({
      x: mz.x + aim.x * rand(1, 4), y: mz.y + aim.y * rand(1, 4), z: 0,
      vx: -aim.x * 9, vy: -aim.y * 9, life: 0.25, size: 0.1, color: 0x99ccff, gravity: 0, drag: 0.8, shrink: 1,
    });
  }
  _blast(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const mz = this._muzzlePos(player);
    const power = 16 + Math.min(20, this._captured * 0.5); this._captured = 0;
    for (const p of this.game.players) {
      if (!p || p === player || !p.alive) continue;
      const dx = p.position.x - mz.x, dy = p.position.y - mz.y; const d = Math.hypot(dx, dy) || 1;
      if (d > 5.5) continue;
      const dot = (dx / d) * aim.x + (dy / d) * aim.y;
      if (dot < 0) continue;
      p.takeDamage(10, { attacker: player, weapon: 'vacuum', kb: { x: (dx / d) * power, y: Math.abs((dy / d) * power) + 6 }, stun: 0.3 });
    }
    audio.explode(); this.game.fx?.camera.punch(0.3);
    player.applyImpulse(-aim.x * 5, -aim.y * 5);
  }
}
