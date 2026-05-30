import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { COL_GROUPS } from '../physics/PhysicsWorld.js';
import { lerp } from '../util/math.js';

// Module-level temp vectors for getWorldPosition — avoids per-call allocation.
const _wpnTmp  = new THREE.Vector3(); // used in updateMesh
const _wpnTmp2 = new THREE.Vector3(); // used in _muzzlePos (distinct to avoid clobber)

// Base weapon class. Subclasses define visual mesh, fire behavior, etc.
// Weapons have two "modes": world (free body that can be picked up) and held (parented to player hand).

export class Weapon {
  constructor(game, opts = {}) {
    this.game = game;
    this.id = opts.id ?? Math.random().toString(36).slice(2, 9);
    this.kind = 'weapon';
    this.name = 'Weapon';
    this.icon = '🔧';
    this.mesh = null;       // visual when held / in-world
    this.holdOffset = new THREE.Vector3(0.4, 0.1, 0); // local to player
    this.aimWeapon = false; // if true, mesh rotates with aim direction
    this.length = 0.6;        // mesh length along the barrel axis; subclasses with longer barrels override
    this.barrelOffset = 0.55; // distance from handR along aim axis to the barrel tip; ranged subclasses override
    this.poseRight = false; // 'aim' | false — set true on ranged in subclass
    this.poseLeft = null;
    this.holder = null;
    this.body = null;        // when in-world
    this.ammo = Infinity;
    this.cooldown = 0;
    this.fireDelay = 0.3;
    this.dropCooldown = 0;
    // Sub-B impulse tuning — defaults 0 = no force. Per-weapon overrides
    // in weapons.js.
    this.recoilImpulse = 0;       // firearm recoil magnitude (single-shot)
    this.continuousRecoilImpulse = 0;  // sustained-beam recoil, impulse/sec (× dt at call site)
    this.throwImpulse = 0;        // self-impulse when thrown
    this.meleeRecoilImpulse = 0;  // self-impulse on melee strike
    this.hitKnockback = 1.0;      // multiplier for victim knockback on damage
    this.life = 30;          // seconds before world body removed
    this.gravity = true;
    // Swing state (set by melee subclass fire()) — base inits so updateMesh
    // reads sane defaults before any swing happens.
    this.swingTimer = 0;
    this._swingDur = 0.25;
    this._buildMesh();
  }

  _buildMesh() {
    // override
    const g = new THREE.BoxGeometry(0.6, 0.15, 0.15);
    this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x888888 }));
  }

  // Nearest planet to a point (curved-gravity levels only). Used to orient a
  // floating weapon tangent to the surface it hovers over.
  _nearestPlanet(x, y) {
    const planets = this.game.level?.planets;
    if (!planets || !planets.length) return null;
    let best = null, bd = Infinity;
    for (const p of planets) {
      const dx = p.cx - x, dy = p.cy - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // Spawn into world as pickup
  spawnAt(x, y, z = 0) {
    this.game.scene.add(this.mesh);
    // On curved-gravity (planet) levels, dynamic weapon bodies get pulled by
    // the planet gravity and skitter / fly off the curved surface. Instead
    // spawn them as a STATIC floating pickup at the spawn point (like the
    // power-ups): a mass-0 trigger body so it stays put and players pass
    // through it, picked up by the existing proximity check.
    const curved = !!this.game.level?.curvedGravity;
    const body = new CANNON.Body({
      mass: (this.gravity && !curved) ? 1.5 : 0,
      material: this.game.physics.materials.prop,
      collisionFilterGroup: COL_GROUPS.WEAPON,
      collisionFilterMask: COL_GROUPS.WORLD | COL_GROUPS.PLAYER,
      linearDamping: 0.2,
      angularDamping: 0.4,
      isTrigger: curved,
    });
    // Box collider 0.6×0.16×0.16m. Y-extent intentionally low so player
    // walking INTO the side rolls the capsule over the top (standable
    // weapons per Sub-B §3.4). Friction comes from physics.materials.prop.
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 0.08, 0.08)));
    body.position.set(x, y, z);
    body.userData = { kind: 'weapon', weapon: this };
    this.game.physics.add(body);
    this.body = body;
    this.life = 30;

    this._floating = curved;
    if (curved) {
      this._floatX = x; this._floatY = y; this._floatZ = z;
      // Orient the weapon tangent to the planet it hovers over so it lies
      // parallel to the surface, and bob it along the outward radial.
      const pl = this._nearestPlanet(x, y);
      const ang = pl ? Math.atan2(y - pl.cy, x - pl.cx) : Math.PI / 2;
      this._floatUX = Math.cos(ang);
      this._floatUY = Math.sin(ang);
      this._floatAngle = ang + Math.PI / 2;   // tangent to the surface
    }
    return this;
  }

  attachTo(player) {
    this.holder = player;
    if (this.body) {
      this.game.physics.remove(this.body);
      this.body = null;
    }
    if (this.mesh.parent !== this.game.scene) this.game.scene.add(this.mesh);
  }

  detach() {
    this.holder = null;
  }

  dropAt(pos, vel) {
    this.spawnAt(pos.x, pos.y + 0.5, 0);
    if (this.body) {
      this.body.velocity.set(vel?.x ?? 0, (vel?.y ?? 0) + 2, 0);
      this.body.angularVelocity.set(0, 0, (Math.random() - 0.5) * 8);
    }
    this.dropCooldown = 0.4;
  }

  // Update mesh transform — anchored to the rig's right-hand world position
  // so the weapon visibly tracks the hand (which moves with springs/wobble).
  updateMesh(player) {
    if (!player) return;
    const handJoint = player.rig?.handR;
    const hand = handJoint ? handJoint.getWorldPosition(_wpnTmp) : null;
    const facing = player.facing;
    const handX = hand ? hand.x : player.position.x + facing * 0.3;
    const handY = hand ? hand.y : player.position.y + 0.65;

    if (this.aimWeapon) {
      const aim = player.aimDir;
      let aimX = aim.x, aimY = aim.y;
      // Wall reorient: cast forward along the player's aim from handR. If we'd
      // poke through a wall, rotate aim to the wall tangent biased toward the
      // input aim's vertical sign so the gun pivots in the direction the user
      // is leaning the cursor (slightly up = points up along the wall, etc.).
      const weaponLength = this.length ?? 0.6;
      const from = { x: handX, y: handY, z: 0 };
      const to = { x: handX + aimX * weaponLength, y: handY + aimY * weaponLength, z: 0 };
      const hit = this.game.physics.raycast(from, to, { mask: COL_GROUPS.WORLD });
      if (hit) {
        const n = hit.hitNormalWorld;
        let nx = n.x, ny = n.y;
        const nlen = Math.hypot(nx, ny) || 1;
        nx /= nlen; ny /= nlen;
        // Tangent perpendicular to the normal (2D).
        let tx = -ny, ty = nx;
        // Bias tangent direction by input aim's vertical sign. If aimY is near
        // zero, fall back to whichever tangent has the same horizontal sign as
        // the player's facing (so a flat shot along a vertical wall points
        // along the player's facing rather than back toward them).
        const wantUp = aimY > 0.05 ? 1 : (aimY < -0.05 ? -1 : 0);
        if (wantUp !== 0) {
          if (Math.sign(ty) !== wantUp) { tx = -tx; ty = -ty; }
        } else {
          if (Math.sign(tx) !== Math.sign(facing) && Math.sign(tx) !== 0) { tx = -tx; ty = -ty; }
        }
        aimX = tx; aimY = ty;
        this.aimAdjusted = true;
      } else {
        this.aimAdjusted = false;
      }
      this.effectiveAimDir = { x: aimX, y: aimY };
      const aimAng = Math.atan2(aimY, aimX);
      this.mesh.position.set(handX, handY, 0);
      this.mesh.rotation.set(0, 0, aimAng);
      this.mesh.scale.set(1, facing >= 0 ? 1 : -1, 1);
    } else if (this.swingTimer > 0) {
      // Three-phase melee swing: anticipation (rear-back), strike (whip-through
      // a wide arc with smoothstep eased velocity), follow-through (overshoot
      // then settle). Sells weight + impact instead of a flat sweep.
      const dur = this._swingDur || 0.25;
      const phase = 1 - this.swingTimer / dur;
      let localAng;
      if (phase < 0.18) {
        // Anticipation: from rest, blade rotates UP and BACK over the shoulder.
        const t = phase / 0.18;
        const e = 1 - Math.pow(1 - t, 3);            // ease-out
        localAng = Math.PI / 2 + 0.6 * e;            // up → up-and-back (~2.17 rad)
      } else if (phase < 0.85) {
        // Strike: smoothstep through a big arc — slow start, fast at impact.
        const t = (phase - 0.18) / 0.67;
        const e = t * t * (3 - 2 * t);
        localAng = (Math.PI / 2 + 0.6) + (-Math.PI - 0.4) * e;  // overshoots forward-down
      } else {
        // Follow-through: ease back toward a relaxed forward hang.
        const t = (phase - 0.85) / 0.15;
        const start = (Math.PI / 2 + 0.6) + (-Math.PI - 0.4); // ≈ -1.27
        localAng = lerp(start, -0.4, t);
      }
      const bladeAng = facing >= 0 ? localAng : Math.PI - localAng;
      this.mesh.position.set(handX, handY, 0);
      this.mesh.rotation.set(0, 0, bladeAng);
      this.mesh.scale.set(1, 1, 1);
    } else {
      // Idle: when aiming, snap to aim direction. Otherwise drop into a
      // relaxed grip — blade angled slightly down-forward, hanging at the
      // hand. Reads as "ready" rather than perpetually pointed.
      const aim = player.aimDir;
      const aimActive = player.input?.aimActive;
      let ang;
      if (aim && aimActive) {
        ang = Math.atan2(aim.y, aim.x);
      } else {
        // Mild downward angle when relaxed — adds small breathing offset so
        // the blade doesn't lock to a frozen pose.
        const breath = Math.sin(player.rig?.t ?? 0) * 0.04;
        ang = facing >= 0 ? -0.15 + breath : Math.PI + 0.15 - breath;
      }
      this.mesh.position.set(handX, handY, 0);
      this.mesh.rotation.set(0, 0, ang);
      this.mesh.scale.set(1, facing >= 0 ? 1 : -1, 1);
    }
  }

  // World tick — update mesh from body if free.
  worldTick(dt) {
    if (this._floating && this.body && !this.holder) {
      // Floating planet pickup — hover + bob along the outward radial, lie
      // tangent to the surface. The body stays static at the spawn point;
      // only the mesh animates.
      const bob = Math.sin(performance.now() * 0.003) * 0.12;
      this.mesh.position.set(
        this._floatX + this._floatUX * bob,
        this._floatY + this._floatUY * bob,
        this._floatZ,
      );
      this.mesh.rotation.set(0, 0, this._floatAngle);
      this.life -= dt;
      if (this.life <= 0) this.destroy();
    } else if (this.body && !this.holder) {
      const p = this.body.position;
      const q = this.body.quaternion;
      this.mesh.position.set(p.x, p.y, p.z);
      this.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      this.life -= dt;
      if (this.life <= 0) this.destroy();
    }
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.dropCooldown > 0) this.dropCooldown -= dt;
  }

  // Muzzle world position — the actual rendered barrel-tip in world space.
  // Anchors to the player's right hand and projects forward by barrelOffset
  // along the wall-reorient-aware aim direction. Subclasses with non-
  // standard mesh layouts (Sniper) override _muzzleWorld; everything else
  // uses this default.
  _muzzlePos(player) {
    const aim = this.effectiveAimDir ?? player.aimDir;
    const handRJoint = player.rig?.handR;
    const handR = handRJoint ? handRJoint.getWorldPosition(_wpnTmp2) : null;
    if (handR) {
      return { x: handR.x + aim.x * this.barrelOffset, y: handR.y + aim.y * this.barrelOffset };
    }
    // Fallback before rig is built.
    const facing = player.facing || 1;
    return { x: player.position.x + facing * 0.7, y: player.position.y + 0.7 };
  }

  // Per-tick update for held weapons. Base is a no-op; subclasses (Minigun,
  // Flamethrower, SMG, AR, Crossbow, DualPistols) override to drive their
  // own state. Called from Stickman.update each tick when the player is
  // armed.
  heldTick(dt, player) { /* override */ }

  // Optional release-edge hook — Stickman calls this when input.attack
  // transitions from true → false. Used by auto-fire weapons that need to
  // know when the trigger was let go.
  releaseFire(player) { /* override */ }

  tryFire(player) {
    if (this.cooldown > 0) return;
    this.cooldown = this.fireDelay;
    this.fire(player);
    // Anime-style melee lunge: any weapon flagged `melee = true` gives the
    // wielder a strong forward burst toward where they're aiming so swings
    // close distance instead of just whiffing on a stationary opponent.
    // Subclass can tune via `lungeSpeed`. Set `melee = false` to opt out.
    if (this.melee) this._lungeMelee(player);
    this.ammo--;
    if (this.ammo <= 0) {
      // drop empty weapon
      player.weapon = null;
      this.destroy();
    }
  }

  _lungeMelee(player) {
    if (!player?.body) return;
    // Grounded-only — air-spam was letting players "fly" by stacking
    // upward velocity with every swing. Pure horizontal kick on the floor.
    if (!player.grounded) return;
    const ax = player.input?.aimActive ? player.aimDir.x : player.facing;
    const norm = Math.abs(ax) || 1;
    const dx = ax / norm;
    const speed = this.lungeSpeed ?? 12;
    player.body.velocity.x = dx * speed;
  }

  fire(player) { /* override */ }

  altFire(player) { /* optional */ }

  destroy() {
    if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
    if (this.body) { this.game.physics.remove(this.body); this.body = null; }
    if (this.holder?.weapon === this) this.holder.weapon = null;
    this.holder = null;
    this._destroyed = true;
  }

  // Clash check — call BEFORE applying weapon damage. Returns true if the
  // target is also mid-swing of a melee weapon / fist while facing this
  // attacker; in that case, both attacks parry (handled by Stickman._clash).
  // The caller should treat a true return as "skip damage this strike."
  _tryClash(target) {
    if (!this.holder) return false;
    const me = this.holder;
    const targetWeaponSwinging = target.weapon && target.weapon.swingTimer > 0 && !target.weapon.aimWeapon;
    const targetPunching = !target.weapon && target.attackTimer > 0;
    if (!targetWeaponSwinging && !targetPunching) return false;
    const dirToTarget = Math.sign(target.position.x - me.position.x);
    if (dirToTarget !== me.facing) return false;
    if (-dirToTarget !== target.facing) return false;
    me._clash(target);
    return true;
  }

  // Helper for melee weapons: deflect projectiles passing through the swing arc.
  // Call once per active swing tick, with the world-space center + radius of the strike.
  // Also damages physics-chain segs (pendulum links + hanging-platform
  // suspensions) that fall in the arc — this is how players sever chains
  // with melee. We piggyback off this single call site so every melee weapon
  // gets chain damage for free.
  _reflectProjectiles(cx, cy, radius) {
    if (!this.holder) return;
    const r2 = radius * radius;
    if (this.game?.projectiles) {
      for (const pr of this.game.projectiles) {
        if (pr.dead) continue;
        // Stuck projectiles have no body — they're decorative at this point.
        if (!pr.body || pr.stuck) continue;
        if (pr.owner === this.holder) continue;
        const dx = pr.body.position.x - cx;
        const dy = pr.body.position.y - cy;
        if (dx * dx + dy * dy > r2) continue;
        pr.body.velocity.x = -pr.body.velocity.x * 1.4 + this.holder.facing * 4;
        pr.body.velocity.y = Math.abs(pr.body.velocity.y) * 0.6 + 4;
        pr.owner = this.holder;
        this.game.fx.particles.burst(pr.body.position.x, pr.body.position.y, 0, { count: 10, speed: 8, color: 0xffffff });
        this.game.fx.camera.punch(0.08);
        this.game.hitStop?.(0.04);
      }
    }
    this._damageChainsInArc(cx, cy, radius, this.chainSwingDmg ?? 14);
    this._damageTilesInArc(cx, cy, radius, this.tileSwingDmg ?? 0);
  }

  // Per-swing tile damage. Iterates every tile (static + dynamic) by body
  // position so rotated / fractional-grid tiles (e.g. crystal spire shards)
  // are reachable. Per-swing dedupe reuses `this.hits` with a `tile_<key>`
  // namespace. No-op when tileSwingDmg is 0 (non-melee or opt-out weapons).
  _damageTilesInArc(cx, cy, radius, dmg) {
    if (!dmg) return;
    const lvl = this.game?.level;
    if (!lvl?.tiles) return;
    const r2 = radius * radius;
    const hitSet = this.hits ?? new Set();
    for (const t of lvl.tiles.values()) {
      if (!t.body || t.indestructible) continue;
      const key = `tile_${t._key}`;
      if (hitSet.has(key)) continue;
      const dx = t.body.position.x - cx;
      const dy = t.body.position.y - cy;
      if (dx * dx + dy * dy > r2) continue;
      hitSet.add(key);
      lvl.damageTile(t, dmg, this.holder);
    }
  }

  _damageChainsInArc(cx, cy, radius, dmg) {
    const segs = this.game?.level?._chainSegs;
    if (!segs || !segs.size) return;
    const r2 = radius * radius;
    // Per-swing dedupe lives on the same `this.hits` Set the weapon already
    // resets each time it starts a new swing — so chain hits naturally reset
    // between swings without needing extra plumbing.
    const hitSet = this.hits ?? new Set();
    // Snapshot the iteration set — `seg.damage()` can dissolve a chain
    // section, mutating `_chainSegs` mid-loop. Iterating a snapshot frees
    // us from concurrent-modify ambiguity.
    const list = [...segs];
    for (const seg of list) {
      if (!seg || seg.dead || !seg.body) continue;
      const body = seg.body;
      // Re-check velocity exists (paranoid: a body teardown that races
      // with this loop could leave a stale ref with cleared fields).
      if (!body.velocity || !body.position) continue;
      const key = `chain_${body.id}`;
      if (hitSet.has(key)) continue;
      const dx = body.position.x - cx;
      const dy = body.position.y - cy;
      if (dx * dx + dy * dy > r2) continue;
      hitSet.add(key);
      body.velocity.x += this.holder.facing * 4;
      body.velocity.y += 2;
      seg.damage(dmg, this.holder);
    }
  }
}
