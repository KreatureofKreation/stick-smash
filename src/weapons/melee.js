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
    this.throwImpulse = 4;
    this.meleeRecoilImpulse = 5;
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
              kb: { x: this.holder.facing * 9, y: 5 }, stun: 0.3,
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
    this.throwImpulse = 4;
    this.meleeRecoilImpulse = 5;
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
              kb: { x: this.holder.facing * 14, y: 8 }, stun: 0.4,
            });
            this.hits.add(p.id);
            audio.bonk();
            this.game.fx.camera.punch(0.45);
            this.game.hitStop?.(0.07);
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
    this.throwImpulse = 5;
    this.meleeRecoilImpulse = 7;
    this.hitKnockback = 1.2;
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
              kb: { x: this.holder.facing * 11, y: 6 }, stun: 0.35,
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
    this.throwImpulse = 6;
    this.meleeRecoilImpulse = 9;
    this.hitKnockback = 1.6;
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
              kb: { x: this.holder.facing * 17, y: 9 }, stun: 0.5,
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
    this.throwImpulse = 6;
    this.meleeRecoilImpulse = 9;
    this.hitKnockback = 1.6;
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
              kb: { x: this.holder.facing * 20, y: 11 }, stun: 0.7,
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
    this.throwImpulse = 6;
    this.meleeRecoilImpulse = 9;
    this.hitKnockback = 1.6;
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
              kb: { x: this.holder.facing * 10, y: 5 }, stun: 0.3,
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
    this.throwImpulse = 5;
    this.meleeRecoilImpulse = 7;
    this.hitKnockback = 1.3;
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
  spawnAt(x, y, z = 0, opts = {}) {
    this._packForWorld();
    return super.spawnAt(x, y, z, opts);
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
              kb: { x: this.holder.facing * 24, y: 10 }, stun: 0.45,
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
