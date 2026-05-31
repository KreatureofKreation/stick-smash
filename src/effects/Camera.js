import * as THREE from 'three';
import { damp, clamp } from '../util/math.js';

// Side-on chase camera. 2.5D plane (x,y), small z offset for depth.
export class GameCamera {
  constructor(camera) {
    this.cam = camera;
    this.target = new THREE.Vector3(0, 2, 0);
    this.center = new THREE.Vector3(0, 2, 0);
    this.shake = 0;
    this.shakeFreq = 30;
    this.zoom = 14;
    this.zoomTarget = 14;
    this.targets = [];
    this.localTarget = null;
  }

  setTargets(arr) { this.targets = arr; }
  setLocal(t) { this.localTarget = t; }

  update(dt) {
    // Per-level clamp override. Read once for use across the auto-fit pass
    // and the final clamp block.
    const lc = this.cam._level?.cameraClamp ?? null;
    const clampX = lc?.x ?? [-22, 22];
    const clampY = lc?.y ?? [-6, 20];
    const clampZ = lc?.zoom ?? [12, 28];
    // Skip-bound is a tiny outset of the center clamp so flung players
    // don't drag the camera off into space.
    const skipX = Math.max(Math.abs(clampX[0]), Math.abs(clampX[1])) + 6;
    const skipYHi = clampY[1] + 6;
    const skipYLo = clampY[0] - 6;

    // Dynamic frame: average alive targets, expand zoom to fit.
    let cx = 0, cy = 0, n = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const t of this.targets) {
      if (!t || !t.alive) continue;
      const p = t.position;
      // Skip players who've been flung out of the playable area. Bound is
      // derived from the per-level cameraClamp so wide levels (space-planet)
      // don't drop the camera while normal levels stay tight.
      if (Math.abs(p.x) > skipX || p.y > skipYHi || p.y < skipYLo) continue;
      cx += p.x; cy += p.y; n++;
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    if (n > 0) {
      this.target.set(cx / n, cy / n + 1.2, 0);
      const spreadX = maxX - minX, spreadY = maxY - minY;
      const fitZoom = clamp(Math.max(spreadX * 0.7, spreadY * 1.2) + 10, clampZ[0], clampZ[1]);
      this.zoomTarget = fitZoom;
      // Keep the local player framed. On big arenas (e.g. the Orbit ring) a
      // spread-out group pushes the fit centre far from a player at the edge,
      // so they end up tiny/off-screen — "can't see yourself". Bias the centre
      // toward the local player so they always sit well inside the frame.
      const lt = this.localTarget;
      if (lt && lt.alive && n > 1) {
        const lp = lt.position;
        if (Math.abs(lp.x) <= skipX && lp.y <= skipYHi && lp.y >= skipYLo) {
          const b = 0.55;   // 0 = pure group centre, 1 = lock to local player
          this.target.x = this.target.x * (1 - b) + lp.x * b;
          this.target.y = this.target.y * (1 - b) + (lp.y + 1.2) * b;
        }
      }
    }

    this.center.x = damp(this.center.x, this.target.x, 0.0001, dt);
    this.center.y = damp(this.center.y, this.target.y, 0.0005, dt);
    this.zoom = damp(this.zoom, this.zoomTarget, 0.05, dt);
    // Hard clamp so the camera can never wander outside the playable area.
    this.center.x = clamp(this.center.x, clampX[0], clampX[1]);
    this.center.y = clamp(this.center.y, clampY[0], clampY[1]);
    this.zoomTarget = clamp(this.zoomTarget, clampZ[0], clampZ[1]);
    this.zoom = clamp(this.zoom, clampZ[0], clampZ[1]);

    let sx = 0, sy = 0;
    if (this.shake > 0.001) {
      const t = performance.now() * 0.001;
      sx = Math.sin(t * this.shakeFreq * 1.7) * this.shake;
      sy = Math.cos(t * this.shakeFreq * 1.1) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 6);
    }

    this.cam.position.set(this.center.x + sx, this.center.y + sy + 1, this.zoom);
    this.cam.lookAt(this.center.x + sx * 0.3, this.center.y + sy * 0.3, 0);
  }

  punch(amount = 0.3) { this.shake = Math.min(1.2, this.shake + amount); }
}
