import * as THREE from 'three';
import { rand, TAU } from '../util/math.js';

// Pooled, GPU-instanced particle system. Uses three.js built-in instanceColor.
class Pool {
  constructor(scene, max, geom, mat) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geom, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.particles = [];
    this._tmp = new THREE.Object3D();
    this._color = new THREE.Color();
    // Color buffer only needs upload when particle indices shift (spawn/death).
    // During quiet decay the color array is unchanged — skip GPU re-upload.
    this._colorDirty = false;
  }

  spawn(opts) {
    if (this.particles.length >= this.max) this.particles.shift();
    this.particles.push({
      x: opts.x ?? 0, y: opts.y ?? 0, z: opts.z ?? 0,
      vx: opts.vx ?? 0, vy: opts.vy ?? 0, vz: opts.vz ?? 0,
      life: opts.life ?? 0.6,
      max: opts.life ?? 0.6,
      size: opts.size ?? 0.15,
      gravity: opts.gravity ?? -10,
      drag: opts.drag ?? 1,
      color: opts.color ?? 0xffffff,
      rot: opts.rot ?? 0,
      vrot: opts.vrot ?? 0,
      shrink: opts.shrink ?? 1,
    });
    this._colorDirty = true;
  }

  update(dt) {
    let died = false;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); died = true; continue; }
      p.vy += p.gravity * dt;
      const drag = Math.pow(p.drag, dt);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.vrot * dt;
    }
    if (died) this._colorDirty = true;
    const n = this.particles.length;
    this.mesh.count = n;
    const writeColor = this._colorDirty;
    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      const t = p.life / p.max;
      const s = p.size * (p.shrink ? t : 1);
      this._tmp.position.set(p.x, p.y, p.z);
      this._tmp.rotation.set(0, 0, p.rot);
      this._tmp.scale.set(s, s, s);
      this._tmp.updateMatrix();
      this.mesh.setMatrixAt(i, this._tmp.matrix);
      if (writeColor) {
        this._color.setHex(p.color);
        this.mesh.setColorAt(i, this._color);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (writeColor && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
      this._colorDirty = false;
    }
  }
}

export class Particles {
  constructor(scene) {
    this.scene = scene;
    const matLit = new THREE.MeshBasicMaterial();
    this.spark = new Pool(scene, 400, new THREE.PlaneGeometry(1, 1), matLit);
    this.chunk = new Pool(scene, 200, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    this.smoke = new Pool(scene, 200, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5 }));
  }

  burst(x, y, z, opts = {}) {
    const n = opts.count ?? 14;
    const speed = opts.speed ?? 6;
    const color = opts.color ?? 0xffcc33;
    for (let i = 0; i < n; i++) {
      const a = rand(TAU);
      const v = speed * rand(0.4, 1);
      this.spark.spawn({
        x, y, z,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v + rand(0, 2), vz: rand(-1, 1),
        life: rand(0.3, 0.6), size: rand(0.06, 0.14),
        gravity: -14, drag: 0.6, color,
        vrot: rand(-10, 10),
      });
    }
  }

  blood(x, y, z, dirX = 0, dirY = 0) {
    // 12 → 7 droplets. Per-particle update is matrix build + GPU upload, so
    // count is a direct frame-cost lever. Trail size was decorative excess.
    for (let i = 0; i < 7; i++) {
      this.spark.spawn({
        x, y, z,
        vx: dirX * 4 + rand(-3, 3), vy: dirY * 4 + rand(0, 5), vz: rand(-1, 1),
        life: rand(0.3, 0.7), size: rand(0.08, 0.16),
        gravity: -22, drag: 0.7, color: 0xc02030,
      });
    }
  }

  debris(x, y, z, color = 0x888888, count = 10) {
    for (let i = 0; i < count; i++) {
      this.chunk.spawn({
        x: x + rand(-0.3, 0.3), y, z: z + rand(-0.3, 0.3),
        vx: rand(-4, 4), vy: rand(2, 8), vz: rand(-2, 2),
        life: rand(0.6, 1.2), size: rand(0.1, 0.3),
        gravity: -22, drag: 0.7, color,
        vrot: rand(-15, 15),
      });
    }
  }

  smokePuff(x, y, z, color = 0x666677) {
    // 8 → 5 puffs. Smoke uses transparent material — heaviest fragment cost
    // per particle in the system. Cutting count helps overdraw most.
    for (let i = 0; i < 5; i++) {
      this.smoke.spawn({
        x, y, z, vx: rand(-1, 1), vy: rand(0.5, 2), vz: rand(-1, 1),
        life: rand(0.5, 1.0), size: rand(0.3, 0.6),
        gravity: 2, drag: 0.4, color,
      });
    }
  }

  update(dt) {
    this.spark.update(dt);
    this.chunk.update(dt);
    this.smoke.update(dt);
  }
}
