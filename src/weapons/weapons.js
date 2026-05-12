import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Weapon } from './Weapon.js';
import { Projectile } from './Projectile.js';
import { audio } from '../audio/Audio.js';
import { rand, TAU } from '../util/math.js';
import { COL_GROUPS } from '../physics/PhysicsWorld.js';
import { spawnFirePatch } from './fx/FirePatch.js';

// === MELEE ===

export class Sword extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Katana';
    this.melee = true;
    this.icon = '⚔';
    this.fireDelay = 0.28;
    this.aimWeapon = false;
    this.swingTimer = 0;
    this.hits = new Set();
    this.tileSwingDmg = 12;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.07, 0.04), new THREE.MeshLambertMaterial({ color: 0xddeeff }));
    blade.position.x = 0.4;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.08), new THREE.MeshLambertMaterial({ color: 0x331a08 }));
    handle.position.x = -0.05;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.1), new THREE.MeshLambertMaterial({ color: 0xffcc33 }));
    guard.position.x = 0.05;
    grp.add(blade, handle, guard);
    this.mesh = grp;
  }
  fire(player) {
    this.swingTimer = 0.22;
    this._swingDur = 0.22;
    this.hits.clear();
    audio.swing();
    player.attackTimer = 0.22;
  }
  worldTick(dt) {
    super.worldTick(dt);
    if (this.swingTimer > 0 && this.holder) {
      this.swingTimer -= dt;
      const phase = 1 - this.swingTimer / 0.22;
      if (phase > 0.2 && phase < 0.85) {
        const cx = this.holder.position.x + this.holder.facing * 1.0;
        const cy = this.holder.position.y + 0.2;
        for (const p of this.game.players) {
          if (!p || p === this.holder || !p.alive || p.invuln > 0) continue;
          if (this.hits.has(p.id)) continue;
          const dx = p.position.x - cx, dy = p.position.y - cy;
          if (dx * dx + dy * dy < 0.95 * 0.95) {
            p.takeDamage(30, {
              attacker: this.holder, weapon: 'sword',
              kb: { x: this.holder.facing * 14, y: 7 }, stun: 0.3,
            });
            this.hits.add(p.id);
            this.game.fx.particles.blood(p.position.x, p.position.y + 0.5, 0, this.holder.facing, 0.5);
            this.game.fx.camera.punch(0.18);
          }
        }
        this._reflectProjectiles(cx, cy, 1.1);
      }
    }
  }
}

export class Bat extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Bat';
    this.melee = true;
    this.icon = '🏏';
    this.fireDelay = 0.45;
    this.swingTimer = 0;
    this.hits = new Set();
    this.tileSwingDmg = 10;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.9, 10), new THREE.MeshLambertMaterial({ color: 0x9a6a30 }));
    body.rotation.z = Math.PI / 2; body.position.x = 0.3;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 8), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    grip.rotation.z = Math.PI / 2; grip.position.x = -0.13;
    grp.add(body, grip);
    this.mesh = grp;
  }
  fire(player) {
    this.swingTimer = 0.3; this._swingDur = 0.3; this.hits.clear(); audio.swing(); player.attackTimer = 0.3;
  }
  worldTick(dt) {
    super.worldTick(dt);
    if (this.swingTimer > 0 && this.holder) {
      this.swingTimer -= dt;
      const phase = 1 - this.swingTimer / 0.3;
      if (phase > 0.3 && phase < 0.85) {
        const cx = this.holder.position.x + this.holder.facing * 1.1;
        const cy = this.holder.position.y + 0.15;
        for (const p of this.game.players) {
          if (!p || p === this.holder || !p.alive || p.invuln > 0) continue;
          if (this.hits.has(p.id)) continue;
          const dx = p.position.x - cx, dy = p.position.y - cy;
          if (dx * dx + dy * dy < 1.0 * 1.0) {
            p.takeDamage(24, {
              attacker: this.holder, weapon: 'bat',
              kb: { x: this.holder.facing * 22, y: 12 }, stun: 0.4,
            });
            this.hits.add(p.id);
            audio.bonk();
            this.game.fx.camera.punch(0.45);
            this.game.hitStop(0.07);
          }
        }
        // Bat is the BEST projectile reflector — wider arc.
        this._reflectProjectiles(cx, cy, 1.4);
      }
    }
  }
}

// === MEDIEVAL ===

export class Longsword extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Longsword';
    this.melee = true;
    this.icon = '🗡';
    this.fireDelay = 0.36;
    this.swingTimer = 0;
    this.hits = new Set();
    this.tileSwingDmg = 18;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.04), new THREE.MeshLambertMaterial({ color: 0xddddee }));
    blade.position.x = 0.6;
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.025, 0.045), new THREE.MeshLambertMaterial({ color: 0xb0b0c0 }));
    fuller.position.x = 0.55;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.12), new THREE.MeshLambertMaterial({ color: 0x886633 }));
    guard.position.x = 0.05;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 8), new THREE.MeshLambertMaterial({ color: 0x331a08 }));
    grip.rotation.z = Math.PI / 2; grip.position.x = -0.07;
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshLambertMaterial({ color: 0xb8a050 }));
    pommel.position.x = -0.18;
    grp.add(blade, fuller, guard, grip, pommel);
    this.mesh = grp;
  }
  fire(player) {
    this.swingTimer = 0.32; this._swingDur = 0.32; this.hits.clear();
    audio.swing(); audio.beep(420, 0.07, 'square', 0.15);
    player.attackTimer = 0.32;
  }
  worldTick(dt) {
    super.worldTick(dt);
    if (this.swingTimer > 0 && this.holder) {
      this.swingTimer -= dt;
      const phase = 1 - this.swingTimer / 0.32;
      if (phase > 0.22 && phase < 0.85) {
        const cx = this.holder.position.x + this.holder.facing * 1.25;
        const cy = this.holder.position.y + 0.2;
        for (const p of this.game.players) {
          if (!p || p === this.holder || !p.alive || p.invuln > 0) continue;
          if (this.hits.has(p.id)) continue;
          const dx = p.position.x - cx, dy = p.position.y - cy;
          if (dx * dx + dy * dy < 1.25 * 1.25) {
            p.takeDamage(42, {
              attacker: this.holder, weapon: 'longsword',
              kb: { x: this.holder.facing * 17, y: 8 }, stun: 0.35,
            });
            this.hits.add(p.id);
            this.game.fx.particles.blood(p.position.x, p.position.y + 0.5, 0, this.holder.facing, 0.5);
            this.game.fx.camera.punch(0.22);
          }
        }
        this._reflectProjectiles(cx, cy, 1.4);
      }
    }
  }
}

export class Mace extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Mace';
    this.melee = true;
    this.icon = '🔨';
    this.fireDelay = 0.5;
    this.swingTimer = 0;
    this.hits = new Set();
    this.tileSwingDmg = 16;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.6, 8), new THREE.MeshLambertMaterial({ color: 0x331a08 }));
    handle.rotation.z = Math.PI / 2; handle.position.x = 0.2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshLambertMaterial({ color: 0x707880 }));
    head.position.x = 0.55;
    // Spikes on the mace head
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 5), new THREE.MeshLambertMaterial({ color: 0xa0a8b8 }));
      sp.position.set(0.55 + Math.cos(a) * 0.18, Math.sin(a) * 0.18, 0);
      sp.rotation.z = a - Math.PI / 2;
      grp.add(sp);
    }
    grp.add(handle, head);
    this.mesh = grp;
  }
  fire(player) {
    this.swingTimer = 0.42; this._swingDur = 0.42; this.hits.clear();
    audio.bonk();
    player.attackTimer = 0.42;
  }
  worldTick(dt) {
    super.worldTick(dt);
    if (this.swingTimer > 0 && this.holder) {
      this.swingTimer -= dt;
      const phase = 1 - this.swingTimer / 0.42;
      if (phase > 0.32 && phase < 0.85) {
        const cx = this.holder.position.x + this.holder.facing * 1.05;
        const cy = this.holder.position.y + 0.15;
        for (const p of this.game.players) {
          if (!p || p === this.holder || !p.alive || p.invuln > 0) continue;
          if (this.hits.has(p.id)) continue;
          const dx = p.position.x - cx, dy = p.position.y - cy;
          if (dx * dx + dy * dy < 0.9 * 0.9) {
            p.takeDamage(40, {
              attacker: this.holder, weapon: 'mace',
              kb: { x: this.holder.facing * 26, y: 14 }, stun: 0.5,
            });
            this.hits.add(p.id);
            audio.bonk();
            this.game.fx.camera.punch(0.5);
            this.game.hitStop?.(0.09);
            this.game.fx.particles.burst(p.position.x, p.position.y, 0, { count: 18, speed: 8, color: 0xa0a8b8 });
          }
        }
        this._reflectProjectiles(cx, cy, 1.0);
      }
    }
  }
}

export class WarHammer extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'War Hammer';
    this.melee = true;
    this.icon = '⚒';
    this.fireDelay = 0.65;
    this.swingTimer = 0;
    this.hits = new Set();
    this.tileSwingDmg = 25;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.85, 8), new THREE.MeshLambertMaterial({ color: 0x4a2a18 }));
    handle.rotation.z = Math.PI / 2; handle.position.x = 0.32;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.22), new THREE.MeshLambertMaterial({ color: 0x606870 }));
    head.position.x = 0.78;
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 4), new THREE.MeshLambertMaterial({ color: 0x707880 }));
    claw.rotation.z = Math.PI / 2; claw.position.x = 0.97;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8), new THREE.MeshLambertMaterial({ color: 0xb8a050 }));
    cap.rotation.z = Math.PI / 2; cap.position.x = -0.13;
    grp.add(handle, head, claw, cap);
    this.mesh = grp;
  }
  fire(player) {
    this.swingTimer = 0.55; this._swingDur = 0.55; this.hits.clear();
    audio.bonk(); audio.beep(120, 0.18, 'sine', 0.35);
    player.attackTimer = 0.55;
  }
  worldTick(dt) {
    super.worldTick(dt);
    if (this.swingTimer > 0 && this.holder) {
      this.swingTimer -= dt;
      const phase = 1 - this.swingTimer / 0.55;
      if (phase > 0.4 && phase < 0.85) {
        const cx = this.holder.position.x + this.holder.facing * 1.15;
        const cy = this.holder.position.y + 0.15;
        for (const p of this.game.players) {
          if (!p || p === this.holder || !p.alive || p.invuln > 0) continue;
          if (this.hits.has(p.id)) continue;
          const dx = p.position.x - cx, dy = p.position.y - cy;
          if (dx * dx + dy * dy < 1.05 * 1.05) {
            p.takeDamage(60, {
              attacker: this.holder, weapon: 'hammer',
              kb: { x: this.holder.facing * 32, y: 18 }, stun: 0.7,
            });
            this.hits.add(p.id);
            audio.bonk(); audio.bonk();
            this.game.fx.camera.punch(0.7);
            this.game.hitStop?.(0.14);
            this.game.fx.particles.burst(p.position.x, p.position.y, 0, { count: 24, speed: 10, color: 0xc0c0d0 });
            this.game.fx.particles.smokePuff(p.position.x, p.position.y, 0, 0x666677);
          }
        }
        this._reflectProjectiles(cx, cy, 1.2);
      }
    }
  }
}

export class Halberd extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Halberd';
    this.melee = true;
    this.icon = '⚔';
    this.fireDelay = 0.45;
    this.swingTimer = 0;
    this.hits = new Set();
    this.tileSwingDmg = 16;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 8), new THREE.MeshLambertMaterial({ color: 0x4a2a18 }));
    pole.rotation.z = Math.PI / 2; pole.position.x = 0.5;
    // Axe blade
    const axe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.04), new THREE.MeshLambertMaterial({ color: 0xddddee }));
    axe.position.set(0.95, 0.18, 0);
    // Spike top
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.28, 4), new THREE.MeshLambertMaterial({ color: 0xddddee }));
    spike.position.x = 1.35;
    spike.rotation.z = Math.PI / 2;
    // Hook
    const hook = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), new THREE.MeshLambertMaterial({ color: 0x808898 }));
    hook.position.set(0.95, -0.16, 0);
    hook.rotation.z = Math.PI;
    grp.add(pole, axe, spike, hook);
    this.mesh = grp;
  }
  fire(player) {
    this.swingTimer = 0.4; this._swingDur = 0.4; this.hits.clear();
    audio.swing();
    player.attackTimer = 0.4;
  }
  worldTick(dt) {
    super.worldTick(dt);
    if (this.swingTimer > 0 && this.holder) {
      this.swingTimer -= dt;
      const phase = 1 - this.swingTimer / 0.4;
      if (phase > 0.28 && phase < 0.85) {
        const cx = this.holder.position.x + this.holder.facing * 1.5;
        const cy = this.holder.position.y + 0.25;
        for (const p of this.game.players) {
          if (!p || p === this.holder || !p.alive || p.invuln > 0) continue;
          if (this.hits.has(p.id)) continue;
          const dx = p.position.x - cx, dy = p.position.y - cy;
          if (dx * dx + dy * dy < 1.4 * 1.4) {
            p.takeDamage(38, {
              attacker: this.holder, weapon: 'halberd',
              kb: { x: this.holder.facing * 15, y: 7 }, stun: 0.3,
            });
            this.hits.add(p.id);
            this.game.fx.particles.blood(p.position.x, p.position.y + 0.5, 0, this.holder.facing, 0.5);
            this.game.fx.camera.punch(0.25);
          }
        }
        this._reflectProjectiles(cx, cy, 1.6);
      }
    }
  }
}

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
    const rec = player.grounded ? 0.5 : 1.4;
    player.body.velocity.x -= aim.x * rec;
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
    // Strong recoil — shotgun blast. Tame on ground, big in air.
    const rec = player.grounded ? 3 : 8;
    player.body.velocity.x -= ax * rec;
    if (!player.grounded) player.body.velocity.y -= ay * 4;
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
    const rec = player.grounded ? 1.2 : 3.5;       // hard to control, like a real minigun
    player.body.velocity.x -= aim.x * rec;
    if (!player.grounded) player.body.velocity.y -= aim.y * 1.5;  // air = even pushier
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
    const rec = player.grounded ? 0.25 : 0.5;
    player.body.velocity.x -= aim.x * rec;
    if (!player.grounded) player.body.velocity.y -= aim.y * 0.4;
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
      sticky: true, stickLife: 1.5,
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
  spawnAt(x, y, z = 0) {
    this._packForWorld();
    return super.spawnAt(x, y, z);
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
    const handR = player.rig?.handR?.position;
    const handL = player.rig?.handL?.position;
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
    const mx = handBone?.position?.x ?? (player.position.x + aim.x * 0.7);
    const my = handBone?.position?.y ?? (player.position.y + 0.7);
    new Projectile(this.game, {
      x: mx + aim.x * 0.3, y: my + aim.y * 0.3,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      damage: 12, owner: player, gravity: false, life: 1.5, radius: 0.07,
      color: 0xffcc55, emissive: 0xffaa22, tracer: true,
    });
    audio.shoot();
    this.game.fx.camera.punch(0.07);
    this._nextHand = (this._nextHand === 'R') ? 'L' : 'R';
  }
}

// === EXPLOSIVES ===

export class Grenade extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Grenade';
    this.icon = '🧨';
    this.fireDelay = 0.5;
    this.aimWeapon = true;
    this.ammo = 3;
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
    // RPG recoil — meaningful kick on ground, big in air for rocket-jumps.
    const rec = player.grounded ? 4 : 8;
    player.body.velocity.x -= aim.x * rec;
    if (!player.grounded) player.body.velocity.y -= aim.y * 5;
    audio.shoot(); audio.explode();
    this.game.fx.camera.punch(0.4);
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
    const handR = player.rig?.handR?.position;
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
    // Big recoil — air recoil is huge to enable rocket-jump-style boosts.
    const rec = player.grounded ? 5 : 12;
    player.body.velocity.x -= ax * rec;
    if (!player.grounded) player.body.velocity.y -= ay * 5;
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
              kb: { x: ax * 18, y: 10 + Math.abs(ay) * 4 }, stun: 0.6,
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
              kb: { x: ax * 14, y: 6 + Math.abs(ay) * 4 }, stun: 0.4,
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
  }
  _buildMesh() {
    // 6-pointed throwing star with center hub + circular hole. Built via
    // Shape (12 vertices: alternating outer-tip + inner-cleft) extruded
    // thin, with a center hole punched through.
    const grp = new THREE.Group();
    grp.add(_buildShurikenMesh(0.14, 0.04, 0.025));
    this.mesh = grp;
    // Anchor offset so it visually centers in hand.
    grp.position.x = 0.14;
  }
  fire(player) {
    const ax = player.aimDir.x, ay = player.aimDir.y;
    const mesh = _buildShurikenMesh(0.16, 0.045, 0.03);
    const proj = new Projectile(this.game, {
      x: player.position.x + ax * 0.7, y: player.position.y + 0.7 + ay * 0.3,
      vx: ax * 26, vy: ay * 26, damage: 22, owner: player,
      gravity: true, gravityScale: 0.2, life: 2.2, radius: 0.10,
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

// Hulk Hands — oversized stone-skin gauntlet fists. Replaces both visible
// hands while held. Heavy melee with very high knockback and damage; the
// huge KB synergises with the velocity-based impact-damage system on
// Stickman so victims thrown into walls chew terrain on the way through.
//
// Special: HOLD DOWN + ATTACK while airborne triggers a ground pound. The
// player slams straight down at high speed; on landing, an AOE shockwave
// damages every player in radius, knocks them outward, and damages tiles.
// ============================================================================

// Build one anatomical stone fist (Group). Origin = wrist; +X = punch dir.
// Scale 1.0 base; caller scales up to ~2.0 for in-game presence.
function _buildStoneFist({ skinMat, knuckMat, veinMat, shardMat, crackMat }) {
  const grp = new THREE.Group();
  // Sleeve (short forearm shroud — won't clip lower-arm rig segment).
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.052, 0.16, 14), skinMat);
  sleeve.rotation.z = Math.PI / 2; sleeve.position.set(-0.10, 0, 0);
  grp.add(sleeve);
  for (let i = 0; i < 2; i++) {
    const c = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.005, 6, 12), crackMat);
    c.rotation.y = Math.PI / 2; c.position.set(-0.05 - i * 0.06, 0, 0);
    grp.add(c);
  }
  // Wrist taper + palm block.
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.04, 12), skinMat);
  wrist.rotation.z = Math.PI / 2; wrist.position.set(-0.018, 0, 0);
  grp.add(wrist);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.10, 0.085), skinMat);
  palm.position.set(0.04, 0, 0);
  grp.add(palm);
  for (const sgn of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), skinMat);
    c.position.set(0.04, sgn[0] * 0.05, sgn[1] * 0.04);
    grp.add(c);
  }
  // Curled fingers — knuckles arc (middle highest+forward, pinky lowest+back).
  const fingers = [
    { yK:  0.040, xK: 0.075, len: 0.07,  w: 0.020 },
    { yK:  0.014, xK: 0.082, len: 0.075, w: 0.022 },
    { yK: -0.012, xK: 0.077, len: 0.07,  w: 0.020 },
    { yK: -0.038, xK: 0.067, len: 0.06,  w: 0.017 },
  ];
  for (const f of fingers) {
    const kn = new THREE.Mesh(new THREE.SphereGeometry(f.w * 1.25, 12, 10), knuckMat);
    kn.position.set(f.xK, f.yK, 0); kn.scale.set(0.9, 1.0, 1.05);
    grp.add(kn);
    const prox = new THREE.Mesh(new THREE.CylinderGeometry(f.w, f.w * 0.95, f.len * 0.55, 8), skinMat);
    prox.rotation.z = Math.PI / 2; prox.position.set(f.xK + 0.018, f.yK, 0.022);
    grp.add(prox);
    const midKn = new THREE.Mesh(new THREE.SphereGeometry(f.w, 8, 8), skinMat);
    midKn.position.set(f.xK + 0.030, f.yK, 0.045);
    grp.add(midKn);
    const dist = new THREE.Mesh(new THREE.CylinderGeometry(f.w * 0.85, f.w * 0.7, f.len * 0.55, 8), skinMat);
    dist.position.set(f.xK + 0.013, f.yK, 0.063);
    dist.rotation.x = -Math.PI / 2 + 0.3;
    grp.add(dist);
  }
  // Thumb wrap.
  const thumbBase = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), skinMat);
  thumbBase.position.set(0.020, 0.038, 0.040);
  grp.add(thumbBase);
  const thumbProx = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.020, 0.058, 8), skinMat);
  thumbProx.position.set(0.050, 0.030, 0.060); thumbProx.rotation.z = -0.7; thumbProx.rotation.y = -0.4;
  grp.add(thumbProx);
  const thumbDist = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.017, 0.046, 8), skinMat);
  thumbDist.position.set(0.078, 0.020, 0.054); thumbDist.rotation.z = -0.3; thumbDist.rotation.y = -0.6;
  grp.add(thumbDist);
  const thumbTip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), skinMat);
  thumbTip.position.set(0.094, 0.012, 0.040);
  grp.add(thumbTip);
  const thumbKn = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), knuckMat);
  thumbKn.position.set(0.068, 0.026, 0.062);
  grp.add(thumbKn);
  // Stone shard nubs + glowing fissures (subtle).
  if (shardMat) {
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.034, 4), shardMat);
      s.position.set(0.015 + i * 0.018, 0.038 - i * 0.026, -0.045);
      s.rotation.set(Math.PI / 2 - 0.5, Math.random() * 0.5, 0);
      grp.add(s);
    }
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.030, 4), shardMat);
      s.position.set(-0.05 - i * 0.04, 0.06, 0); s.rotation.set(Math.PI / 2, 0, 0);
      grp.add(s);
    }
  }
  const fiss = (x, y, z, len, ang) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.005, 0.005), crackMat);
    m.position.set(x, y, z); m.rotation.z = ang;
    grp.add(m);
  };
  fiss(0.040, 0.020, -0.050, 0.060, 0.4);
  fiss(0.025, -0.010, -0.050, 0.045, -0.3);
  fiss(-0.060, 0.045, 0.0, 0.080, 0.0);
  fiss(-0.140, -0.040, 0.0, 0.060, 0.2);
  return grp;
}

function _stoneFistMaterials() {
  return {
    skinMat: new THREE.MeshLambertMaterial({ color: 0x4a6845, emissive: 0x081008, emissiveIntensity: 0.10 }),
    knuckMat: new THREE.MeshLambertMaterial({ color: 0x5a7b54, emissive: 0x33ff66, emissiveIntensity: 0.35 }),
    veinMat: new THREE.MeshBasicMaterial({ color: 0x223322 }),
    shardMat: new THREE.MeshLambertMaterial({ color: 0x4a5a44 }),
    crackMat: new THREE.MeshBasicMaterial({ color: 0x88ee77 }),
  };
}

const HULK_FIST_SCALE = 2.0;        // big, but not cartoon-mitt sized

export class HulkHands extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Hulk Hands';
    this.icon = '🟢';
    this.melee = true;
    this.lungeSpeed = 12;
    this.fireDelay = 0.42;
    this.swingTimer = 0;
    this._swingDur = 0.32;
    this.hits = new Set();
    this.tileSwingDmg = 30;
    // Ground-pound state.
    this._poundActive = false;
    this._poundCooldown = 0;
    // Track whether we hid the rig hands so detach() can restore.
    this._hidRigHands = false;
  }

  _buildMesh() {
    // Two fists, wrapped in a top-level Group so the base Weapon plumbing
    // (mesh in scene + life/world tick) still works. Each fist is positioned
    // at its corresponding rig hand each frame in updateMesh.
    const grp = new THREE.Group();
    this._fistR = _buildStoneFist(_stoneFistMaterials());
    this._fistL = _buildStoneFist(_stoneFistMaterials());
    this._fistR.scale.setScalar(HULK_FIST_SCALE);
    this._fistL.scale.setScalar(HULK_FIST_SCALE);
    this._fistL.scale.x *= -1;            // mirror to the left
    grp.add(this._fistR, this._fistL);
    this.mesh = grp;
  }

  attachTo(player) {
    super.attachTo(player);
    // Hide the rig's hand spheres while wielding — the giant fists replace them.
    if (player?.rig?.handL && player.rig.handL.visible) {
      player.rig.handL.visible = false;
      this._hidRigHands = true;
    }
    if (player?.rig?.handR && player.rig.handR.visible) {
      player.rig.handR.visible = false;
      this._hidRigHands = true;
    }
  }

  detach() {
    // Restore hand visibility BEFORE super.detach() clears holder.
    if (this._hidRigHands && this.holder?.rig) {
      if (this.holder.rig.handL) this.holder.rig.handL.visible = true;
      if (this.holder.rig.handR) this.holder.rig.handR.visible = true;
    }
    this._hidRigHands = false;
    super.detach();
  }

  destroy() {
    if (this._hidRigHands && this.holder?.rig) {
      if (this.holder.rig.handL) this.holder.rig.handL.visible = true;
      if (this.holder.rig.handR) this.holder.rig.handR.visible = true;
    }
    super.destroy();
  }

  // Compact the two fist children into local-space positions around the
  // parent origin before the weapon goes back into the world. Held-mode
  // updateMesh sets each fist to a WORLD position via getWorldPosition;
  // without recentering, throwing the weapon would make both fists orbit
  // the parent in a huge arc as the body spins. (Same fix as DualPistols.)
  _packForWorld() {
    if (this._fistR) {
      this._fistR.position.set(0.0, 0.10, 0);
      this._fistR.rotation.set(0, 0, 0);
      this._fistR.scale.set(HULK_FIST_SCALE, HULK_FIST_SCALE, HULK_FIST_SCALE);
    }
    if (this._fistL) {
      this._fistL.position.set(0.0, -0.10, 0);
      this._fistL.rotation.set(0, 0, 0);
      this._fistL.scale.set(-HULK_FIST_SCALE, HULK_FIST_SCALE, HULK_FIST_SCALE);
    }
  }
  spawnAt(x, y, z = 0) {
    this._packForWorld();
    return super.spawnAt(x, y, z);
  }
  dropAt(pos, vel) {
    this._packForWorld();
    return super.dropAt(pos, vel);
  }

  updateMesh(player) {
    if (!player) return;
    const rig = player.rig;
    if (!rig) return;
    // Reset the parent mesh to origin — child fists position themselves in
    // world space. Without this the parent's stale position (carried over
    // from when the weapon was a free body before pickup) offsets both
    // fists by the original spawn point.
    this.mesh.position.set(0, 0, 0);
    this.mesh.rotation.set(0, 0, 0);
    // Compute hand world positions via getWorldPosition. The rig parents
    // joints to rig.group, whose transform is identity in flat-gravity but
    // body-following in curved-gravity. getWorldPosition handles both.
    const tmpR = (this._tmpR ||= new THREE.Vector3());
    const tmpL = (this._tmpL ||= new THREE.Vector3());
    let hasR = false, hasL = false;
    if (rig.handR) { rig.handR.getWorldPosition(tmpR); hasR = true; }
    if (rig.handL) { rig.handL.getWorldPosition(tmpL); hasL = true; }
    const facing = player.facing >= 0 ? 1 : -1;
    // Both fists punch forward — knuckles must point in the facing
    // direction. The geometry is built knuckles-at-+X, so scale.x = facing
    // flips the whole fist when the player turns left. Don't mirror the
    // left fist independently; that left it pointing backwards relative to
    // the player when facing right.
    if (this._fistR && hasR) {
      this._fistR.position.set(tmpR.x, tmpR.y, 0);
      this._fistR.rotation.set(0, 0, 0);
      this._fistR.scale.set(HULK_FIST_SCALE * facing, HULK_FIST_SCALE, HULK_FIST_SCALE);
    }
    if (this._fistL && hasL) {
      this._fistL.position.set(tmpL.x, tmpL.y, 0);
      this._fistL.rotation.set(0, 0, 0);
      // Mirror on Y so the thumb sits on the opposite side of the left
      // fist vs the right (right hand has thumb on top in our build) —
      // keeps both fists punching forward but visually distinct as a pair.
      this._fistL.scale.set(HULK_FIST_SCALE * facing, -HULK_FIST_SCALE, HULK_FIST_SCALE);
    }
    // During a pound, trail green particles from the active fist.
    if (this._poundActive && Math.random() < 0.7 && this.game?.fx?.particles?.spark) {
      const sx = (hasR ? tmpR.x : player.position.x) + rand(-0.1, 0.1);
      const sy = (hasR ? tmpR.y : player.position.y) + 0.0;
      this.game.fx.particles.spark.spawn({
        x: sx, y: sy, z: 0, vx: rand(-1, 1), vy: rand(2, 5),
        life: 0.35, size: 0.18, color: 0x88ee77, gravity: -2, drag: 0.5, shrink: 1,
      });
    }
  }

  worldTick(dt) {
    super.worldTick(dt);
    if (this._poundCooldown > 0) this._poundCooldown -= dt;
    if (!this.holder) return;
    // Resolve a pound when the holder touches ground.
    if (this._poundActive) {
      // Cap fall speed visually (so it slams every time).
      if (this.holder.body.velocity.y > -20) this.holder.body.velocity.y = -38;
      // Lock horizontal movement during the dive.
      this.holder.body.velocity.x = 0;
      if (this.holder.grounded) this._resolvePound();
    }
    // Punch swing arc damage (similar pattern to Sword/Bat but heavier).
    if (this.swingTimer > 0) {
      this.swingTimer -= dt;
      const phase = 1 - this.swingTimer / this._swingDur;
      if (phase > 0.25 && phase < 0.85) {
        const cx = this.holder.position.x + this.holder.facing * 1.0;
        const cy = this.holder.position.y + 0.2;
        const radius = 1.05;
        for (const p of this.game.players) {
          if (!p || p === this.holder || !p.alive || p.invuln > 0) continue;
          if (this.hits.has(p.id)) continue;
          const dx = p.position.x - cx, dy = p.position.y - cy;
          if (dx * dx + dy * dy < radius * radius) {
            p.takeDamage(45, {
              attacker: this.holder, weapon: 'hulk',
              kb: { x: this.holder.facing * 38, y: 14 }, stun: 0.45,
            });
            this.hits.add(p.id);
            audio.bonk();
            this.game.fx.camera.punch(0.55);
            this.game.hitStop?.(0.10);
            this.game.fx.particles.burst(p.position.x, p.position.y + 0.4, 0, { count: 18, speed: 9, color: 0x88ee77 });
          }
        }
        this._reflectProjectiles(cx, cy, 1.2);
      }
    }
  }

  // Override tryFire so HOLD-DOWN + ATTACK in midair = ground pound.
  tryFire(player) {
    if (this.cooldown > 0) return;
    const wantPound = !player.grounded && (player.input?.moveY ?? 0) < -0.3 && this._poundCooldown <= 0 && !this._poundActive;
    if (wantPound) {
      this._startPound(player);
      this.cooldown = 0.6;
      return;
    }
    // Normal punch path.
    this.cooldown = this.fireDelay;
    this.fire(player);
    if (this.melee) this._lungeMelee(player);
    // Hulk hands are infinite ammo (no decrement) — the pickup just runs out
    // when the carrier dies + drops it. Skip the ammo-- branch entirely.
  }

  fire(player) {
    this.swingTimer = this._swingDur;
    this.hits.clear();
    audio.swing();
    audio.bonk();
    player.attackTimer = this._swingDur;
  }

  _startPound(player) {
    this._poundActive = true;
    player.body.velocity.y = -38;
    player.body.velocity.x = 0;
    audio.beep?.(110, 0.18, 'sawtooth', 0.5);
    this.game.fx.camera.punch(0.30);
    // Brief invulnerability to chip damage during the slam? Skip — risk vs reward.
  }

  _resolvePound() {
    if (!this._poundActive || !this.holder) return;
    this._poundActive = false;
    this._poundCooldown = 1.0;
    const x = this.holder.position.x, y = this.holder.position.y - 0.4;
    const radius = 4.2;
    audio.explode?.();
    audio.bonk();
    audio.bonk();
    this.game.fx.camera.punch(0.95);
    this.game.hitStop?.(0.16);
    // Shockwave ring particles
    if (this.game?.fx?.particles?.spark) {
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * TAU;
        this.game.fx.particles.spark.spawn({
          x, y, z: 0, vx: Math.cos(a) * 22, vy: Math.abs(Math.sin(a)) * 6 + 3,
          life: 0.55, size: 0.32, color: i % 2 === 0 ? 0x88ee77 : 0xddc890,
          gravity: -8, drag: 0.5, shrink: 1,
        });
      }
    }
    this.game.fx.particles.smokePuff?.(x, y, 0, 0x999988);
    // AOE damage + radial knockback.
    for (const p of this.game.players) {
      if (!p || p === this.holder || !p.alive || p.invuln > 0) continue;
      const dx = p.position.x - x, dy = (p.position.y + 0.3) - y;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const f = 1 - d / radius;
      const nx = dx / Math.max(0.01, d), ny = dy / Math.max(0.01, d);
      p.takeDamage(55 * f, {
        attacker: this.holder, weapon: 'hulk-pound',
        kb: { x: nx * 28 * f, y: 12 + ny * 14 * f }, stun: 0.6 * f,
      });
    }
    // Tile damage in radius (uses the existing area-damage helper).
    this.game.level.damageArea?.(x, y, radius, 100, this);
  }
}

// === FUNNY ===

export class RubberChicken extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Chicken';
    this.melee = true;
    this.lungeSpeed = 9;
    this.icon = '🐔';
    this.fireDelay = 0.5;
    this.swingTimer = 0;
    this.hits = new Set();
    this.tileSwingDmg = 5;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffeecc }));
    body.scale.set(1.6, 1, 1); body.position.x = 0.3;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffeecc }));
    head.position.set(0.55, 0.18, 0);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 6), new THREE.MeshLambertMaterial({ color: 0xff9933 }));
    beak.rotation.z = -Math.PI / 2; beak.position.set(0.7, 0.15, 0);
    const comb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshLambertMaterial({ color: 0xff4d6d }));
    comb.position.set(0.55, 0.3, 0);
    grp.add(body, head, beak, comb);
    this.mesh = grp;
  }
  fire(player) {
    this.swingTimer = 0.4; this._swingDur = 0.4; this.hits.clear();
    [880, 660, 990, 770].forEach((f, i) => setTimeout(() => audio.beep(f, 0.06, 'square', 0.25), i * 60));
    player.attackTimer = 0.4;
  }
  worldTick(dt) {
    super.worldTick(dt);
    if (this.swingTimer > 0 && this.holder) {
      this.swingTimer -= dt;
      const phase = 1 - this.swingTimer / 0.4;
      // visual wiggle
      this.mesh.rotation.z += Math.sin(phase * 30) * 0.4 * dt;
      if (phase > 0.2 && phase < 0.7) {
        const cx = this.holder.position.x + this.holder.facing * 0.9;
        const cy = this.holder.position.y + 0.2;
        for (const p of this.game.players) {
          if (!p || p === this.holder || !p.alive || p.invuln > 0) continue;
          if (this.hits.has(p.id)) continue;
          const dx = p.position.x - cx, dy = p.position.y - cy;
          if (dx * dx + dy * dy < 0.9 * 0.9) {
            // huge knockback, low damage — comedy weapon
            p.takeDamage(2, {
              attacker: this.holder, weapon: 'chicken',
              kb: { x: this.holder.facing * 30, y: 18 }, stun: 0.5,
            });
            this.hits.add(p.id);
            this.game.fx.particles.burst(p.position.x, p.position.y, 0, { count: 16, speed: 7, color: 0xffeecc });
          }
        }
        this._reflectProjectiles(cx, cy, 1.0);
      }
    }
  }
}

export class Boomerang extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Boomerang';
    this.icon = '🪃';
    this.fireDelay = 0.8;
    this.aimWeapon = true;
    this.ammo = 5;
  }
  _buildMesh() {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.quadraticCurveTo(0.3, 0.4, 0.6, 0); shape.quadraticCurveTo(0.3, 0.1, 0, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
    g.translate(-0.3, 0, 0);
    this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xc88240 }));
  }
  fire(player) {
    const ax = player.aimDir.x, ay = player.aimDir.y;
    const proj = new Projectile(this.game, {
      x: player.position.x + ax * 0.6, y: player.position.y + 0.7 + ay * 0.3,
      vx: ax * 26, vy: ay * 26, damage: 26, owner: player,
      gravity: false, life: 1.6, radius: 0.1, color: 0xc88240,
      mesh: { geometry: new THREE.TorusGeometry(0.18, 0.04, 6, 12, Math.PI), material: new THREE.MeshLambertMaterial({ color: 0xc88240 }) },
    });
    proj.body.angularVelocity.set(0, 25, 0);
    audio.swing();
  }
}

export class FishSlap extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Trout';
    this.melee = true;
    this.lungeSpeed = 10;
    this.icon = '🐟';
    this.fireDelay = 0.35;
    this.swingTimer = 0;
    this.hits = new Set();
    this.tileSwingDmg = 6;
  }
  _buildMesh() {
    const g = new THREE.SphereGeometry(0.18, 10, 8);
    g.scale(2.2, 1, 0.6);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x5a7aaa }));
    m.position.x = 0.3;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 6), new THREE.MeshLambertMaterial({ color: 0x405066 }));
    tail.rotation.z = Math.PI / 2; tail.position.x = -0.05;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    eye.position.set(0.6, 0.05, 0.1);
    const grp = new THREE.Group(); grp.add(m, tail, eye);
    this.mesh = grp;
  }
  fire(player) {
    this.swingTimer = 0.25; this._swingDur = 0.25; this.hits.clear();
    audio.swing();
    player.attackTimer = 0.25;
  }
  worldTick(dt) {
    super.worldTick(dt);
    if (this.swingTimer > 0 && this.holder) {
      this.swingTimer -= dt;
      const phase = 1 - this.swingTimer / 0.25;
      if (phase > 0.3 && phase < 0.85) {
        const cx = this.holder.position.x + this.holder.facing * 0.95;
        const cy = this.holder.position.y + 0.2;
        for (const p of this.game.players) {
          if (!p || p === this.holder || !p.alive || p.invuln > 0) continue;
          if (this.hits.has(p.id)) continue;
          const dx = p.position.x - cx, dy = p.position.y - cy;
          if (dx * dx + dy * dy < 0.9 * 0.9) {
            p.takeDamage(10, {
              attacker: this.holder, weapon: 'fish',
              kb: { x: this.holder.facing * 16, y: 9 }, stun: 0.35,
            });
            this.hits.add(p.id);
            audio.beep(220, 0.08, 'sine', 0.2);
            this.game.fx.particles.burst(p.position.x, p.position.y + 0.5, 0, { count: 8, speed: 4, color: 0x6a8acc });
          }
        }
        this._reflectProjectiles(cx, cy, 0.95);
      }
    }
  }
}

// === POWER-UPS ===

export class HealthPack {
  constructor(game) {
    this.game = game;
    this.kind = 'pickup-health';
    this.icon = '❤';
    const grp = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x440000 }));
    const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.41), new THREE.MeshLambertMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 0.5 }));
    const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.41), new THREE.MeshLambertMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 0.5 }));
    grp.add(box, cross1, cross2);
    this.mesh = grp;
    this.life = 30;
  }
  spawnAt(x, y, z = 0) {
    this.game.scene.add(this.mesh);
    this.x = x; this.y = y; this.z = z;
    return this;
  }
  worldTick(dt) {
    this.mesh.position.set(this.x, this.y + Math.sin(performance.now() * 0.003) * 0.1, this.z);
    this.mesh.rotation.y += dt * 1.5;
    this.life -= dt;
    if (this.life <= 0) this.destroy();
  }
  tryPickup(player) {
    if (player.health >= player.maxHealth) return false;
    const dx = player.position.x - this.x, dy = player.position.y - this.y;
    if (dx * dx + dy * dy < 0.7 * 0.7) {
      player.health = Math.min(player.maxHealth, player.health + 50);
      audio.pickup();
      this.game.fx.particles.burst(this.x, this.y, 0, { count: 12, color: 0xff4d6d });
      this.destroy();
      return true;
    }
    return false;
  }
  destroy() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.dead = true;
  }
}

export class SpeedBoost {
  constructor(game) {
    this.game = game;
    this.kind = 'pickup-speed';
    this.icon = '⚡';
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshLambertMaterial({ color: 0x66e2a3, emissive: 0x66e2a3, emissiveIntensity: 0.7 }));
    this.mesh = m;
    this.life = 30;
  }
  spawnAt(x, y, z = 0) { this.game.scene.add(this.mesh); this.x = x; this.y = y; this.z = z; return this; }
  worldTick(dt) {
    this.mesh.position.set(this.x, this.y + Math.sin(performance.now() * 0.003) * 0.1, this.z);
    this.mesh.rotation.y += dt * 2;
    this.life -= dt;
    if (this.life <= 0) this.destroy();
  }
  tryPickup(player) {
    const dx = player.position.x - this.x, dy = player.position.y - this.y;
    if (dx * dx + dy * dy < 0.7 * 0.7) {
      player.speedBoostUntil = performance.now() + 6000;
      audio.pickup();
      this.game.fx.particles.burst(this.x, this.y, 0, { count: 12, color: 0x66e2a3 });
      this.destroy();
      return true;
    }
    return false;
  }
  destroy() { if (this.mesh.parent) this.mesh.parent.remove(this.mesh); this.dead = true; }
}

export class ArmorPlate {
  constructor(game) {
    this.game = game;
    this.kind = 'pickup-armor';
    this.icon = '🛡';
    const grp = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.18), new THREE.MeshLambertMaterial({ color: 0xa0a8b8 }));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.19), new THREE.MeshLambertMaterial({ color: 0xffcc33, emissive: 0xffcc33, emissiveIntensity: 0.4 }));
    grp.add(plate, stripe);
    this.mesh = grp;
    this.life = 30;
  }
  spawnAt(x, y, z = 0) { this.game.scene.add(this.mesh); this.x = x; this.y = y; this.z = z; return this; }
  worldTick(dt) {
    this.mesh.position.set(this.x, this.y + Math.sin(performance.now() * 0.003) * 0.1, this.z);
    this.mesh.rotation.y += dt * 1.5;
    this.life -= dt;
    if (this.life <= 0) this.destroy();
  }
  tryPickup(player) {
    if (player.armor >= player.maxArmor) return false;
    const dx = player.position.x - this.x, dy = player.position.y - this.y;
    if (dx * dx + dy * dy < 0.7 * 0.7) {
      player.armor = Math.min(player.maxArmor, player.armor + 30);
      audio.pickup();
      this.game.fx.particles.burst(this.x, this.y, 0, { count: 12, color: 0xa0a8b8 });
      this.destroy();
      return true;
    }
    return false;
  }
  destroy() { if (this.mesh.parent) this.mesh.parent.remove(this.mesh); this.dead = true; }
}

export class Shield {
  constructor(game) {
    this.game = game;
    this.kind = 'pickup-shield';
    this.icon = '🛡';
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28), new THREE.MeshLambertMaterial({ color: 0x4d9fff, emissive: 0x4d9fff, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 }));
    this.mesh = m;
    this.life = 30;
  }
  spawnAt(x, y, z = 0) { this.game.scene.add(this.mesh); this.x = x; this.y = y; this.z = z; return this; }
  worldTick(dt) {
    this.mesh.position.set(this.x, this.y + Math.sin(performance.now() * 0.003) * 0.1, this.z);
    this.mesh.rotation.y += dt * 1.5;
    this.life -= dt;
    if (this.life <= 0) this.destroy();
  }
  tryPickup(player) {
    const dx = player.position.x - this.x, dy = player.position.y - this.y;
    if (dx * dx + dy * dy < 0.7 * 0.7) {
      player.invuln = Math.max(player.invuln, 5);
      audio.pickup();
      this.game.fx.particles.burst(this.x, this.y, 0, { count: 16, color: 0x4d9fff });
      this.destroy();
      return true;
    }
    return false;
  }
  destroy() { if (this.mesh.parent) this.mesh.parent.remove(this.mesh); this.dead = true; }
}

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
              kb: { x: this.holder.facing * 16, y: 8 }, stun: 0.3,
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
              kb: { x: this.holder.facing * 18, y: 9 }, stun: 0.35,
            });
            // Burn DoT — apply via repeated small ticks
            p._burnUntil = performance.now() + 2500;
            p._burnSrc = this.holder;
            this.hits.add(p.id);
            this.game.fx.particles.burst(p.position.x, p.position.y + 0.4, 0, { count: 14, speed: 5, color: 0xff5500 });
            this.game.fx.camera.punch(0.25);
            this.game.hitStop(0.04);
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
            p.takeDamage(30, {
              attacker: this.holder, weapon: 'ice',
              kb: { x: this.holder.facing * 8, y: 5 }, stun: 1.2,
            });
            p._frozenUntil = performance.now() + 1500;
            this.hits.add(p.id);
            this.game.fx.particles.burst(p.position.x, p.position.y + 0.4, 0, { count: 18, speed: 5, color: 0x9bdcff });
            this.game.fx.camera.punch(0.2);
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
      p.body.velocity.x -= ax * 0.6;
      if (!p.grounded) p.body.velocity.y -= ay * 0.4;
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
    this.game.hitStop(0.12);
    const ax = this._lockedAim.x, ay = this._lockedAim.y;
    // Heavy backward yeet — shooter visibly slammed back at the moment of release.
    if (player.grounded) player.body.velocity.x -= ax * 8;
    else { player.body.velocity.x -= ax * 14; player.body.velocity.y -= ay * 8; }
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
    if (this.ammo <= 0 && this.holder) {
      const h = this.holder;
      h.weapon = null;
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
      const x = this.body.position.x, y = this.body.position.y;
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
      game.hitStop(0.18);
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
    if (player.grounded) player.body.velocity.x -= ax * 4;
    else { player.body.velocity.x -= ax * 8; player.body.velocity.y -= ay * 6; }
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

// Catalog of all weapons and weighted pool for spawns.
export const WEAPON_CLASSES = [
  Sword, Bat, Pistol, Shotgun, Minigun, SMG, AssaultRifle, Revolver, Crossbow, Flamethrower, DualPistols, Grenade, RPG, RubberChicken, Boomerang, FishSlap,
  FlameSword, IceSword, Kamehameha, Nuke, LightningStaff, Lightsaber,
  Longsword, Mace, WarHammer, Halberd,
  SniperRifle, Shurikens, StickyBomb,
  HulkHands,
];
export const PICKUP_CLASSES = [
  HealthPack, ArmorPlate, SpeedBoost, Shield,
  FlightPower, InvisibilityPower, TimeSlowPower, SuperPunchPower, GumGumFruit,
  ForcePushPower, ForcePullPower, ForceLightningPower, ForceChokePower,
];

// Spawn table — every entry tagged with a stable `id` (used for the
// player-facing toggle UI's localStorage keys), a `label` (display text),
// and a `cat` (group bucket for the weapon-toggle settings panel).
export const SPAWN_TABLE = [
  // melee
  { cls: Sword,         w: 12,  id: 'sword',        label: 'Katana',        cat: 'melee' },
  { cls: Bat,           w: 10,  id: 'bat',          label: 'Bat',           cat: 'melee' },
  { cls: Longsword,     w: 10,  id: 'longsword',    label: 'Longsword',     cat: 'melee' },
  { cls: Mace,          w: 9,   id: 'mace',         label: 'Mace',          cat: 'melee' },
  { cls: WarHammer,     w: 6,   id: 'warhammer',    label: 'War Hammer',    cat: 'melee' },
  { cls: Halberd,       w: 8,   id: 'halberd',      label: 'Halberd',       cat: 'melee' },
  { cls: HulkHands,     w: 4,   id: 'hulkhands',    label: 'Hulk Hands',    cat: 'melee' },
  // ranged
  { cls: Pistol,        w: 14,  id: 'pistol',       label: 'Pistol',        cat: 'ranged' },
  { cls: Shotgun,       w: 9,   id: 'shotgun',      label: 'Shotgun',       cat: 'ranged' },
  { cls: Minigun,       w: 5,   id: 'minigun',      label: 'Minigun',       cat: 'ranged' },
  { cls: Grenade,       w: 8,   id: 'grenade',      label: 'Grenade',       cat: 'ranged' },
  { cls: RPG,           w: 4,   id: 'rpg',          label: 'RPG',           cat: 'ranged' },
  { cls: SniperRifle,   w: 4,   id: 'sniper',       label: 'Sniper Rifle',  cat: 'ranged' },
  { cls: Shurikens,     w: 6,   id: 'shurikens',    label: 'Shurikens',     cat: 'ranged' },
  { cls: StickyBomb,    w: 4,   id: 'sticky',       label: 'Sticky Bomb',   cat: 'ranged' },
  { cls: SMG,           w: 10,  id: 'smg',          label: 'SMG',           cat: 'ranged' },
  { cls: AssaultRifle,  w: 9,   id: 'assaultrifle', label: 'Assault Rifle', cat: 'ranged' },
  { cls: Revolver,      w: 7,   id: 'revolver',     label: 'Revolver',      cat: 'ranged' },
  { cls: Crossbow,      w: 6,   id: 'crossbow',     label: 'Crossbow',      cat: 'ranged' },
  { cls: Flamethrower,  w: 5,   id: 'flamethrower', label: 'Flamethrower',  cat: 'ranged' },
  { cls: DualPistols,   w: 8,   id: 'dualpistols',  label: 'Dual Pistols',  cat: 'ranged' },
  // joke
  { cls: RubberChicken, w: 2,   id: 'chicken',      label: 'Rubber Chicken',cat: 'joke' },
  { cls: Boomerang,     w: 5,   id: 'boomerang',    label: 'Boomerang',     cat: 'joke' },
  { cls: FishSlap,      w: 2,   id: 'trout',        label: 'Trout',         cat: 'joke' },
  // super
  { cls: FlameSword,    w: 4,   id: 'flamesword',   label: 'Flame Sword',   cat: 'super' },
  { cls: IceSword,      w: 4,   id: 'icesword',     label: 'Ice Sword',     cat: 'super' },
  { cls: LightningStaff,w: 3,   id: 'lightning',    label: 'Lightning',     cat: 'super' },
  { cls: Kamehameha,    w: 2,   id: 'kamehameha',   label: 'Kamehameha',    cat: 'super' },
  { cls: Nuke,          w: 1.5, id: 'nuke',         label: 'Nuke',          cat: 'super' },
  { cls: Lightsaber,    w: 5,   id: 'lightsaber',   label: 'Lightsaber',    cat: 'super' },
  // pickups
  { cls: HealthPack,    w: 8,   id: 'healthpack',   label: 'Health Pack',   cat: 'pickup' },
  { cls: ArmorPlate,    w: 6,   id: 'armor',        label: 'Armor',         cat: 'pickup' },
  { cls: SpeedBoost,    w: 6,   id: 'speed',        label: 'Speed Boost',   cat: 'pickup' },
  { cls: Shield,        w: 5,   id: 'shield',       label: 'Shield',        cat: 'pickup' },
  // powers
  { cls: FlightPower,       w: 5, id: 'flight',     label: 'Flight',        cat: 'power' },
  { cls: InvisibilityPower, w: 5, id: 'invis',      label: 'Invisibility',  cat: 'power' },
  { cls: TimeSlowPower,     w: 4, id: 'timeslow',   label: 'Time Slow',     cat: 'power' },
  // Super Punch removed from spawns — Hulk Hands fills the "big knockback
  // melee" role with proper visual identity. The class stays exported in
  // case other systems still buff Stickman.superPunchUntil directly.
  { cls: GumGumFruit,       w: 4, id: 'gumgum',     label: 'Gum-Gum',       cat: 'power' },
  { cls: ForcePushPower,    w: 5, id: 'forcepush', label: 'Force Push',    cat: 'power' },
  { cls: ForcePullPower,    w: 5, id: 'forcepull', label: 'Force Pull',    cat: 'power' },
  { cls: ForceLightningPower,w: 4,id: 'forcelight',label: 'Force Lightning', cat: 'power' },
  { cls: ForceChokePower,   w: 4, id: 'forcechoke',label: 'Force Choke',   cat: 'power' },
];

// Module-level enabled set. `null` means "all enabled" — the default. The
// weapon-toggle settings panel writes the disabled-set to localStorage and
// calls setEnabledWeapons() on boot. pickRandomSpawn filters by this set
// before doing the weighted draw.
let _disabledIds = new Set();
export function setDisabledWeapons(ids) { _disabledIds = new Set(ids || []); }
export function getDisabledWeapons() { return new Set(_disabledIds); }

export function pickRandomSpawn() {
  // Filter disabled before computing weights so weight sums stay correct.
  const pool = SPAWN_TABLE.filter(e => !_disabledIds.has(e.id));
  // Fallback: if the user disabled literally every spawn, return Pistol so
  // the match still gets weapons (better than spawning nothing forever).
  if (!pool.length) return Pistol;
  const total = pool.reduce((s, e) => s + e.w, 0);
  let r = Math.random() * total;
  for (const e of pool) { r -= e.w; if (r <= 0) return e.cls; }
  return pool[0].cls;
}
