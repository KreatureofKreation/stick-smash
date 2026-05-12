import * as THREE from 'three';

// Global cap — total active fire patches across the whole game. FIFO
// eviction: spawning the 17th patch removes the oldest.
const PATCH_CAP = 16;
const SPREAD_CHANCE_PER_SEC = 0.25;
const SPREAD_RADIUS = 1.0;
const PATCH_LIFETIME = 1.2;
const PATCH_RADIUS = 0.5;
const PATCH_DAMAGE_PER_SEC = 8;

const patches = [];

export function spawnFirePatch(game, { x, y, owner = null }) {
  if (patches.length >= PATCH_CAP) {
    const evicted = patches.shift();
    evicted.destroy();
  }
  const p = new FirePatch(game, x, y, owner);
  patches.push(p);
  return p;
}

export function getActivePatches() { return patches.slice(); }

export function clearAllPatches() {
  while (patches.length) patches.pop().destroy();
}

export function tickAllFirePatches(dt) {
  const snap = patches.slice();
  for (const p of snap) p.tick(dt);
}

class FirePatch {
  constructor(game, x, y, owner) {
    this.game = game;
    this.x = x; this.y = y; this.owner = owner;
    this.life = PATCH_LIFETIME;
    this._dead = false;
    const isLow = !!window.__lowQ;
    const geo = isLow
      ? new THREE.CircleGeometry(PATCH_RADIUS, 6)
      : new THREE.PlaneGeometry(PATCH_RADIUS * 2, PATCH_RADIUS * 1.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff8833, transparent: true, opacity: 0.85 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x, y + 0.05, 0);
    if (game?.scene) game.scene.add(this.mesh);
  }
  tick(dt) {
    if (this._dead) return;
    this.life -= dt;
    if (this.life <= 0) { this._evict(); return; }
    if (Math.random() < SPREAD_CHANCE_PER_SEC * dt) {
      const ang = Math.random() * Math.PI * 2;
      const r = SPREAD_RADIUS * (0.4 + 0.6 * Math.random());
      const nx = this.x + Math.cos(ang) * r;
      const ny = this.y;
      let near = false;
      for (const p of patches) {
        const dx = p.x - nx, dy = p.y - ny;
        if (dx * dx + dy * dy < 0.25 * 0.25) { near = true; break; }
      }
      if (!near) spawnFirePatch(this.game, { x: nx, y: ny, owner: this.owner });
    }
    if (this.game?.players) {
      for (const player of this.game.players) {
        if (!player || !player.alive || player.invuln > 0) continue;
        const dx = player.position.x - this.x;
        const dy = player.position.y - this.y;
        if (dx * dx + dy * dy < PATCH_RADIUS * PATCH_RADIUS) {
          player.takeDamage(PATCH_DAMAGE_PER_SEC * dt, {
            attacker: this.owner, weapon: 'fire', kb: { x: 0, y: 0 }, stun: 0,
          });
        }
      }
    }
    if (!window.__lowQ) {
      this.mesh.material.opacity = 0.6 + 0.3 * Math.sin(performance.now() * 0.025);
    }
  }
  destroy() {
    if (this._dead) return;
    this._dead = true;
    if (this.mesh?.parent) this.mesh.parent.remove(this.mesh);
  }
  _evict() {
    const idx = patches.indexOf(this);
    if (idx >= 0) patches.splice(idx, 1);
    this.destroy();
  }
}
