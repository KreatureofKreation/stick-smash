import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Weapon } from './Weapon.js';
import { Projectile } from './Projectile.js';
import { audio } from '../audio/Audio.js';
import { rand, TAU } from '../util/math.js';
import { COL_GROUPS } from '../physics/PhysicsWorld.js';
import { spawnFirePatch } from './fx/FirePatch.js';

// Throwables & explosives: arc/lob weapons and the meteor barrage.


// === EXPLOSIVES ===

export class Grenade extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Grenade';
    this.icon = '🧨';
    this.fireDelay = 0.5;
    this.aimWeapon = true;
    this.ammo = 3;
    this.throwImpulse = 5;
    this.hitKnockback = 1.5;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), new THREE.MeshLambertMaterial({ color: 0x305030 }));
    // Pineapple-style ridges for visual interest.
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 6, 14), new THREE.MeshLambertMaterial({ color: 0x224020 }));
      ring.position.y = -0.1 + i * 0.1;
      ring.rotation.x = Math.PI / 2;
      grp.add(ring);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 8), new THREE.MeshLambertMaterial({ color: 0x707880 }));
    cap.position.y = 0.21;
    const pin = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 4, 8), new THREE.MeshLambertMaterial({ color: 0xc8a060 }));
    pin.position.y = 0.27;
    pin.rotation.x = Math.PI / 2;
    grp.add(body, cap, pin);
    this.mesh = grp;
  }
  fire(player) {
    const fuse = 2.0;
    // Build the world-mesh so we can blink the body emissive as fuse runs out.
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x305030, emissive: 0x000000 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), bodyMat);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 8), new THREE.MeshLambertMaterial({ color: 0x707880 }));
    cap.position.y = 0.21;
    const grp = new THREE.Group();
    grp.add(body, cap);
    const proj = new Projectile(this.game, {
      x: player.position.x + player.aimDir.x * 0.6, y: player.position.y + 0.7 + player.aimDir.y * 0.3,
      vx: player.aimDir.x * 18 + player.body.velocity.x * 0.5,
      vy: player.aimDir.y * 18 + 4,
      damage: 0, owner: player,
      gravity: true, life: fuse, radius: 0.18,
      explosive: true, color: 0x305030,
      bounces: 5, bounceDamp: 0.55,
      material: this.game.physics.materials.grenade,
      angularDamping: 0.4,
      mesh: grp,
      explodeRadius: 3.4, explodeDamage: 45,
    });
    proj.body.angularVelocity.set(0, 0, rand(-12, 12));
    // Fuse blink — emissive pulses faster as detonation nears.
    const game = this.game;
    let lastBeep = 0;
    const origUpdate = proj.update.bind(proj);
    proj.update = (dt) => {
      if (!proj.dead) {
        const t = 1 - Math.max(0, proj.life / fuse); // 0→1 over fuse
        const freq = 4 + t * t * 22;
        const k = 0.5 + 0.5 * Math.sin(performance.now() * 0.001 * freq * Math.PI * 2);
        bodyMat.emissive.setRGB(k * (0.4 + t * 0.6), k * 0.05, 0);
        bodyMat.emissiveIntensity = 0.4 + t * 1.6;
        // Tick beep accelerates with fuse — last 0.6s gets rapid pings.
        if (t > 0.45) {
          const interval = Math.max(60, 360 - t * 320);
          if (performance.now() - lastBeep > interval) {
            lastBeep = performance.now();
            audio.beep(900 + t * 400, 0.04, 'square', 0.18);
          }
        }
      }
      origUpdate(dt);
    };
    audio.click();
  }
}



export class RPG extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'RPG';
    this.icon = '🚀';
    this.fireDelay = 1.2;
    this.aimWeapon = true;
    this.poseRight = 'aim';
    this.poseLeft = null;
    this.ammo = 1;
    this.barrelOffset = 0.85;
    this.recoilImpulse = 18;
    this.throwImpulse = 12;
    this.hitKnockback = 3.0;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 10), new THREE.MeshLambertMaterial({ color: 0x444444 }));
    tube.rotation.z = Math.PI / 2; tube.position.x = 0.4;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.2, 8), new THREE.MeshLambertMaterial({ color: 0xff4d6d }));
    tip.rotation.z = -Math.PI / 2; tip.position.x = 0.85;
    grp.add(tube, tip);
    this.mesh = grp;
  }
  fire(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const mz = this._muzzlePos(player);
    new Projectile(this.game, {
      x: mz.x, y: mz.y,
      vx: aim.x * 28, vy: aim.y * 28, damage: 0, owner: player,
      gravity: false, life: 2.2, radius: 0.15,
      explosive: true, explodeOnContact: true, color: 0xff4d6d, emissive: 0xaa0030,
      mesh: { geometry: new THREE.ConeGeometry(0.13, 0.5, 8).rotateZ(-Math.PI / 2), material: new THREE.MeshLambertMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 0.5 }) },
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
    audio.shoot(); audio.explode();
    this.game.fx.camera.punch(0.4);
  }
}



// Sticky bomb — thrown adhesive. Sticks to first surface (player or terrain),
// then a short fuse counts down to a fat explosion. Designed to discourage
// camping: tag a perch and the camper has to bail.
export class StickyBomb extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Sticky';
    this.icon = '🟢';
    this.fireDelay = 0.7;
    this.aimWeapon = true;
    this.ammo = 2;
    this.throwImpulse = 5;
    this.hitKnockback = 1.5;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), new THREE.MeshLambertMaterial({ color: 0x66cc44, emissive: 0x224422, emissiveIntensity: 0.5 }));
    // Spikes give it the "burr" look — visually sticky.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 4), new THREE.MeshLambertMaterial({ color: 0x88ee66 }));
      sp.position.set(Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0);
      sp.rotation.z = a - Math.PI / 2;
      grp.add(sp);
    }
    grp.add(body);
    this.mesh = grp;
  }
  fire(player) {
    const ax = player.aimDir.x, ay = player.aimDir.y;
    const fuse = 1.5;
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x66cc44, emissive: 0x224422, emissiveIntensity: 0.6 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), bodyMat);
    const grp = new THREE.Group();
    grp.add(body);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 4), new THREE.MeshLambertMaterial({ color: 0x88ee66 }));
      sp.position.set(Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0);
      sp.rotation.z = a - Math.PI / 2;
      grp.add(sp);
    }
    const proj = new Projectile(this.game, {
      x: player.position.x + ax * 0.6, y: player.position.y + 0.7 + ay * 0.3,
      vx: ax * 22 + player.body.velocity.x * 0.4,
      vy: ay * 22 + 3,
      damage: 0, owner: player,
      gravity: true, life: 4, radius: 0.16,
      explosive: true, sticky: true, stickLife: fuse,
      mesh: grp, color: 0x66cc44,
      explodeRadius: 3.6, explodeDamage: 55,
    });
    // Pulse emissive faster as fuse burns down.
    const origUpdate = proj.update.bind(proj);
    let lastBeep = 0;
    proj.update = (dt) => {
      if (!proj.dead && proj.stuck) {
        const t = 1 - Math.max(0, proj.life / fuse);
        const k = 0.5 + 0.5 * Math.sin(performance.now() * 0.001 * (4 + t * 30) * Math.PI * 2);
        bodyMat.emissive.setRGB(k * 0.2, k * (0.6 + t * 0.4), 0);
        bodyMat.emissiveIntensity = 0.4 + t * 1.8;
        const interval = Math.max(60, 280 - t * 240);
        if (performance.now() - lastBeep > interval) {
          lastBeep = performance.now();
          audio.beep(680 + t * 600, 0.04, 'square', 0.2);
        }
      }
      origUpdate(dt);
    };
    audio.click();
  }
}



// METEOR STORM (super) — calls a barrage of meteors down across the arena.
// Spawned all at once from staggered heights so they rain in over ~2s.
export class MeteorStorm extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Meteor Storm'; this.icon = '☄'; this.ammo = 1; this.fireDelay = 0.5; this.throwImpulse = 3;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16), new THREE.MeshLambertMaterial({ color: 0x6a3a2a, emissive: 0xff4400, emissiveIntensity: 0.4 }));
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0x33221a }));
    staff.position.y = -0.2;
    grp.add(rock, staff); this.mesh = grp;
  }
  fire(player) {
    audio.explode(); this.game.fx.camera.punch(0.5);
    const cx = player.position.x, cy = player.position.y;
    for (let i = 0; i < 18; i++) {
      const x = cx + rand(-13, 13);
      const y = cy + rand(11, 24);   // staggered height → staggered landing
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3), new THREE.MeshLambertMaterial({ color: 0x5a2a1a, emissive: 0xff5500, emissiveIntensity: 0.8 }));
      new Projectile(this.game, {
        x, y, vx: rand(-2, 2), vy: rand(-14, -10),
        damage: 24, owner: player, gravity: true, gravityScale: 1.4, life: 4, radius: 0.3,
        mesh: m, explosive: true, explodeOnContact: true, explodeRadius: 2.4, explodeDamage: 30, tracerColor: 0xff6600,
      });
    }
    player.weapon = null; this.destroy();
  }
}
