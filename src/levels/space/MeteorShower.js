import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { COL_GROUPS } from '../../physics/PhysicsWorld.js';

// Spawns periodic fiery rocks from outside the kill bound. They obey the same
// planet gravity sum as projectiles, so they curve dramatically into nearby
// planets. Damage planets and players on contact.
export class MeteorShower {
  constructor(level, cfg) {
    this.level = level;
    this.activateAfter = cfg.activateAfter ?? 30;
    this.intervalLo = cfg.interval?.[0] ?? 8;
    this.intervalHi = cfg.interval?.[1] ?? 14;
    this.perLo = cfg.perShower?.[0] ?? 1;
    this.perHi = cfg.perShower?.[1] ?? 3;
    this.t = 0;
    this.nextShowerAt = this.activateAfter + this._randInterval();
    this.meteors = [];
  }
  _randInterval() {
    return this.intervalLo + Math.random() * (this.intervalHi - this.intervalLo);
  }
  update(dt) {
    this.t += dt;
    // Spawn shower if due.
    if (this.t >= this.nextShowerAt) {
      const count = this.perLo + Math.floor(Math.random() * (this.perHi - this.perLo + 1));
      for (let i = 0; i < count; i++) this._spawnOne();
      this.nextShowerAt = this.t + this._randInterval();
    }
    // Tick active meteors.
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.life -= dt;
      // Tail particle.
      if (this.level.fx?.particles?.spark) {
        this.level.fx.particles.spark.spawn({
          x: m.body.position.x, y: m.body.position.y, z: 0,
          vx: -m.body.velocity.x * 0.2, vy: -m.body.velocity.y * 0.2,
          life: 0.4, size: 0.3, color: 0xff7733, gravity: 0, drag: 0.4, shrink: 1,
        });
      }
      m.mesh.position.copy(m.body.position);
      // Despawn on time-out or out-of-bound.
      const kb = this.level.killBound;
      const oob = kb && (Math.abs(m.body.position.x) > kb.x + 5 || Math.abs(m.body.position.y) > kb.y + 5);
      if (m.life <= 0 || oob) { this._destroyMeteor(m); this.meteors.splice(i, 1); }
    }
  }
  _spawnOne() {
    const kb = this.level.killBound ?? { x: 50, y: 35 };
    // Pick a random edge.
    const edge = Math.floor(Math.random() * 4);
    let x, y;
    if (edge === 0)      { x = -kb.x; y = -kb.y + Math.random() * (kb.y * 2); }
    else if (edge === 1) { x =  kb.x; y = -kb.y + Math.random() * (kb.y * 2); }
    else if (edge === 2) { x = -kb.x + Math.random() * (kb.x * 2); y = -kb.y; }
    else                 { x = -kb.x + Math.random() * (kb.x * 2); y =  kb.y; }
    // Initial velocity aimed roughly at center, ±30°.
    const dx = -x, dy = -y;
    const baseAng = Math.atan2(dy, dx);
    const ang = baseAng + (Math.random() - 0.5) * (Math.PI / 3);
    const speed = 14;
    const vx = Math.cos(ang) * speed;
    const vy = Math.sin(ang) * speed;

    const r = 0.4;
    const geo = new THREE.SphereGeometry(r, 12, 8);
    const mat = new THREE.MeshLambertMaterial({ color: 0xff5520, emissive: 0xff5520, emissiveIntensity: 1.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, 0);
    this.level.scene.add(mesh);

    const body = new CANNON.Body({
      mass: 1.5,
      collisionFilterGroup: COL_GROUPS.PROJECTILE,
      collisionFilterMask: COL_GROUPS.WORLD | COL_GROUPS.PLAYER,
      linearDamping: 0,
    });
    body.addShape(new CANNON.Sphere(r));
    body.position.set(x, y, 0);
    body.velocity.set(vx, vy, 0);
    const meteor = { body, mesh, life: 12, dead: false };
    body.userData = { kind: 'meteor', meteor };
    this.level.physics.add(body);

    body.addEventListener('collide', (e) => {
      if (meteor.dead) return;
      const other = e.body;
      if (other?.userData?.kind === 'tile') {
        this.level.damageArea(body.position.x, body.position.y, 1.6, 50, meteor);
      } else if (other?.userData?.kind === 'player') {
        const sm = other.userData.stickman;
        if (sm?.alive && sm.invuln <= 0) {
          sm.takeDamage(30, {
            attacker: null, weapon: 'meteor',
            kb: { x: body.velocity.x * 0.6, y: body.velocity.y * 0.6 + 4 },
            stun: 0.3,
          });
        }
      }
      meteor.life = 0;
    });
    this.meteors.push(meteor);
  }
  _destroyMeteor(m) {
    if (m.dead) return;
    m.dead = true;
    if (m.mesh?.parent) m.mesh.parent.remove(m.mesh);
    m.mesh?.geometry?.dispose();
    m.mesh?.material?.dispose();
    // Capture body position BEFORE physics.remove invalidates the wrapper.
    const px = m.body?.position?.x ?? 0;
    const py = m.body?.position?.y ?? 0;
    if (m.body) this.level.physics.remove(m.body);
    if (this.level.fx?.particles?.burst) {
      this.level.fx.particles.burst(px, py, 0, { count: 10, speed: 6, color: 0xff7733 });
    }
    m.body = null;
    m.mesh = null;
  }
  destroy() {
    for (const m of this.meteors) this._destroyMeteor(m);
    this.meteors.length = 0;
  }
}
