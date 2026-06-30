import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Weapon } from './Weapon.js';
import { Projectile } from './Projectile.js';
import { audio } from '../audio/Audio.js';
import { rand, TAU } from '../util/math.js';
import { COL_GROUPS } from '../physics/PhysicsWorld.js';
import { spawnFirePatch } from './fx/FirePatch.js';


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
    this.throwImpulse = 3;
    this.meleeRecoilImpulse = 3;
    this.hitKnockback = 0.6;
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
              kb: { x: this.holder.facing * 19, y: 11 }, stun: 0.5,
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
    this.throwImpulse = 4;
    this.meleeRecoilImpulse = 4;
    this.hitKnockback = 0.9;
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
    proj.body.angularVelocity.set(0, 0, 25);
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
    this.throwImpulse = 3;
    this.meleeRecoilImpulse = 3;
    this.hitKnockback = 0.6;
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
              kb: { x: this.holder.facing * 11, y: 6 }, stun: 0.35,
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


// SNAIL — a slow, INVULNERABLE crawler that instakills on contact. Deployed by
// the Snail weapon; ducks into game.projectiles so it gets update(dt) each frame
// and is reaped when .dead. Touch = death for ANYONE (incl. the owner, after a
// short grace so they can flee). Despawns after a while.
export class Snail {
  constructor(game, x, y, owner) {
    this.game = game; this.owner = owner; this.dead = false;
    this.life = 14; this._grace = 2.0;
    const grp = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), new THREE.MeshLambertMaterial({ color: 0x9a5a2a, emissive: 0x3a1a08, emissiveIntensity: 0.3 }));
    shell.scale.set(1, 0.95, 0.7); shell.position.set(-0.05, 0.12, 0);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.62, 10), new THREE.MeshLambertMaterial({ color: 0x9fbf7a }));
    foot.rotation.z = Math.PI / 2; foot.position.set(0.08, -0.18, 0);
    const headBall = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshLambertMaterial({ color: 0x9fbf7a }));
    headBall.position.set(0.38, -0.08, 0);
    const mkStalk = (dz) => {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 5), new THREE.MeshLambertMaterial({ color: 0x9fbf7a }));
      s.position.set(0.42, 0.06, dz); s.rotation.z = -0.3;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), new THREE.MeshLambertMaterial({ color: 0x111111 }));
      eye.position.set(0.47, 0.15, dz);
      return [s, eye];
    };
    grp.add(shell, foot, headBall, ...mkStalk(0.07), ...mkStalk(-0.07));
    grp.position.set(x, y, 0);
    this.mesh = grp; game.scene.add(grp);

    this.body = new CANNON.Body({
      mass: 6, material: game.physics.materials.prop,
      collisionFilterGroup: COL_GROUPS.PROP, collisionFilterMask: COL_GROUPS.WORLD,
      fixedRotation: true, linearDamping: 0.3,
    });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(0.34, 0.26, 0.3)));
    this.body.position.set(x, y, 0);
    game.physics.add(this.body);
    game.registerProjectile(this);
    audio.spawn?.();
  }
  // Invulnerable — projectiles/melee that try to damage it are ignored (no hp).
  takeDamage() { return false; }
  update(dt) {
    if (this.dead || !this.body) return;
    this.life -= dt; this._grace -= dt;
    if (this.life <= 0) { this.destroy(); return; }
    let best = null, bd = Infinity;
    for (const p of this.game.players) {
      if (!p || !p.alive) continue;
      if (p === this.owner && this._grace > 0) continue;   // owner gets a head start
      const d = Math.abs(p.position.x - this.body.position.x);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      const dir = Math.sign(best.position.x - this.body.position.x) || 1;
      // Crawl by nudging position (a velocity gets eaten by ground contact) —
      // slow + relentless. Gravity still handles the Y so it rides terrain.
      this.body.position.x += dir * 1.7 * dt;
      const dx = best.position.x - this.body.position.x;
      const dy = best.position.y - this.body.position.y;
      if (dx * dx + dy * dy < 0.75 * 0.75) {
        best.lastDamager = this.owner;
        best.takeDamage(9999, { attacker: this.owner, weapon: 'snail', kb: { x: dir * 4, y: 6 } });
      }
      this.mesh.scale.x = dir < 0 ? -1 : 1;
    }
    this.mesh.position.set(this.body.position.x, this.body.position.y, 0);
    this.mesh.position.y += Math.sin(performance.now() * 0.006) * 0.03;  // gentle bob
  }
  destroy() {
    if (this.dead) return; this.dead = true;
    if (this.mesh?.parent) this.mesh.parent.remove(this.mesh);
    this.mesh?.traverse?.((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    if (this.body) { this.game.physics.remove(this.body); this.body = null; }
  }
}


// SNAIL deployer weapon.
export class SnailDeployer extends Weapon {
  constructor(game) {
    super(game);
    this.name = 'Snail'; this.icon = '🐌'; this.ammo = 1; this.fireDelay = 0.5; this.throwImpulse = 3;
  }
  _buildMesh() {
    const grp = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshLambertMaterial({ color: 0x9a5a2a }));
    shell.scale.set(1, 0.9, 0.7); shell.position.y = 0.08;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.3, 8), new THREE.MeshLambertMaterial({ color: 0x9fbf7a }));
    foot.rotation.z = Math.PI / 2; foot.position.x = 0.05;
    grp.add(shell, foot); this.mesh = grp;
  }
  fire(player) {
    const dir = player.facing || 1;
    new Snail(this.game, player.position.x + dir * 0.9, player.position.y + 0.2, player);
    audio.click?.();
    player.weapon = null;
    this.destroy();
  }
}
