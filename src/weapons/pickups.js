import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Weapon } from './Weapon.js';
import { Projectile } from './Projectile.js';
import { audio } from '../audio/Audio.js';
import { rand, TAU } from '../util/math.js';
import { COL_GROUPS } from '../physics/PhysicsWorld.js';
import { spawnFirePatch } from './fx/FirePatch.js';


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
