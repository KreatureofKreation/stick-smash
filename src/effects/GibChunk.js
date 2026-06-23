import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { COL_GROUPS } from '../physics/PhysicsWorld.js';

// A severed body part flying off as a real, tumbling physics chunk. Ducks into
// game.projectiles so it gets update(dt) each frame and is reaped on .dead.
// Collides with WORLD only (rests on the ground), inert to damage, fades out.
export class GibChunk {
  constructor(game, mesh, x, y, vx, vy, spin = 16) {
    this.game = game;
    this.dead = false;
    this.life = 2.5 + Math.random() * 1.5;
    this.mesh = mesh;
    mesh.position.set(x, y, 0);
    game.scene.add(mesh);

    this.body = new CANNON.Body({
      mass: 0.4,
      material: game.physics.materials.prop,
      collisionFilterGroup: COL_GROUPS.PROP,
      collisionFilterMask: COL_GROUPS.WORLD,
      linearDamping: 0.1,
      angularDamping: 0.2,
    });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(0.1, 0.12, 0.1)));
    this.body.position.set(x, y, 0);
    this.body.velocity.set(vx, vy, (Math.random() - 0.5) * 2);
    this.body.angularVelocity.set(
      (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin,
    );
    game.physics.add(this.body);
    game.registerProjectile(this);
  }

  takeDamage() { return false; }   // inert — a chunk can't be hurt

  update(dt) {
    if (this.dead || !this.body) return;
    this.life -= dt;
    this.mesh.position.copy(this.body.position);
    this.mesh.quaternion.copy(this.body.quaternion);
    if (this.life < 0.6 && this.mesh.material) {
      this.mesh.material.transparent = true;
      this.mesh.material.opacity = Math.max(0, this.life / 0.6);
    }
    if (this.life <= 0) this.destroy();
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    if (this.mesh?.parent) this.mesh.parent.remove(this.mesh);
    this.mesh?.geometry?.dispose?.();
    this.mesh?.material?.dispose?.();
    if (this.body) { this.game.physics.remove(this.body); this.body = null; }
  }
}
