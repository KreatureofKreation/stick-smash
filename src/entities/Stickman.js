import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { COL_GROUPS } from '../physics/PhysicsWorld.js';
import { StickmanRig } from './StickmanRig.js';
import { clamp, damp, lerp, sign, rand } from '../util/math.js';
import { audio } from '../audio/Audio.js';
import { vibrate } from '../util/haptics.js';

// Stickman = capsule body + procedural rig + state machine.
// Designed to be controlled either by local input, AI, or network state.

const BODY_RADIUS = 0.32;
const BODY_HEIGHT = 1.5;

// Reused Z-axis vec for visual rig rotation on curved-gravity levels — keeps
// us from allocating a Vector3 per stickman per frame.
const _RIG_Z_AXIS = new THREE.Vector3(0, 0, 1);

export const STATE = {
  ACTIVE: 'active',
  GRABBED: 'grabbed',
  RAGDOLL: 'ragdoll',
  DEAD: 'dead',
};

// Strike profile table. Every move shares this shape.
// activeStart/activeEnd are normalized 0..1 progress through `dur`.
// heightOffset adjusts hitbox Y from body center (negative = low, positive = high).
// launch=true means the hit triggers ragdoll on the victim.
// kbX is multiplied by attacker.facing in the hitbox loop.
// Move durations + active windows tuned for "real anticipation" feel:
// windup phase is meaningfully longer than the strike pulse itself, so a
// strike reads as a deliberate commitment (with a counter window for the
// opponent) rather than an instant flick. Hitboxes were also rescaled so
// the active-frame reach matches the new visible fist (arms 0.45+0.45).
const MOVE_TABLE = {
  // Ground lights — chain step 0..4
  jab:          { type:'light', dur:0.26, activeStart:0.32, activeEnd:0.62, reach:1.00, radius:1.0, dmg:6,  kbX:5,  kbY:1, stun:0.15, launch:false, heightOffset:0.15, recovery:0.12 },
  cross:        { type:'light', dur:0.30, activeStart:0.38, activeEnd:0.68, reach:1.10, radius:1.0, dmg:8,  kbX:7,  kbY:1, stun:0.20, launch:false, heightOffset:0.15, recovery:0.15 },
  hook:         { type:'light', dur:0.32, activeStart:0.40, activeEnd:0.68, reach:1.00, radius:1.05,dmg:10, kbX:6,  kbY:2, stun:0.25, launch:false, heightOffset:0.15, recovery:0.18 },
  knee:         { type:'light', dur:0.34, activeStart:0.42, activeEnd:0.68, reach:0.80, radius:1.0, dmg:11, kbX:5,  kbY:4, stun:0.30, launch:false, heightOffset:0.00, recovery:0.20 },
  spinBack:     { type:'light', dur:0.40, activeStart:0.48, activeEnd:0.72, reach:1.20, radius:1.0, dmg:14, kbX:12, kbY:3, stun:0.35, launch:false, heightOffset:0.20, recovery:0.25 },
  // Ground heavies — direction at release. Long windup, snap strike, long recover.
  heavyNeutral: { type:'heavy', dur:0.60, activeStart:0.50, activeEnd:0.70, reach:1.20, radius:1.1, dmg:22, kbX:18, kbY:4, stun:0.40, launch:true,  heightOffset:0.15, recovery:0.55 },
  heavyUp:      { type:'heavy', dur:0.60, activeStart:0.55, activeEnd:0.75, reach:0.95, radius:1.0, dmg:18, kbX:4,  kbY:14,stun:0.40, launch:true,  heightOffset:0.40, recovery:0.55 },
  heavyDown:    { type:'heavy', dur:0.65, activeStart:0.55, activeEnd:0.75, reach:1.00, radius:1.1, dmg:25, kbX:6,  kbY:-8,stun:0.45, launch:true,  heightOffset:-0.20,recovery:0.60 },
  heavyForward: { type:'heavy', dur:0.52, activeStart:0.42, activeEnd:0.65, reach:1.40, radius:1.0, dmg:20, kbX:16, kbY:5, stun:0.40, launch:true,  heightOffset:0.15, recovery:0.48 },
  heavyBack:    { type:'heavy', dur:0.55, activeStart:0.00, activeEnd:0.00, reach:0,    radius:0,   dmg:0,  kbX:0,  kbY:0, stun:0,    launch:false, heightOffset:0,    recovery:0.55 },
  // Aerials — air chain step 0..1
  airJab:       { type:'airLight', dur:0.24, activeStart:0.38, activeEnd:0.68, reach:0.95, radius:1.0, dmg:9,  kbX:8, kbY:2,  stun:0.20, launch:false, heightOffset:0.05, recovery:0.22 },
  airHook:      { type:'airLight', dur:0.28, activeStart:0.40, activeEnd:0.68, reach:1.05, radius:1.0, dmg:11, kbX:9, kbY:2,  stun:0.25, launch:false, heightOffset:0.10, recovery:0.24 },
  airHeavyN:    { type:'airHeavy', dur:0.58, activeStart:0.50, activeEnd:0.72, reach:1.15, radius:1.1, dmg:20, kbX:10,kbY:3,  stun:0.40, launch:true,  heightOffset:0.10, recovery:0.50 },
  airHeavyU:    { type:'airHeavy', dur:0.52, activeStart:0.50, activeEnd:0.72, reach:0.90, radius:1.0, dmg:16, kbX:3, kbY:15, stun:0.40, launch:true,  heightOffset:0.30, recovery:0.50 },
  airHeavyD:    { type:'airHeavy', dur:0.50, activeStart:0.45, activeEnd:0.78, reach:1.00, radius:1.0, dmg:22, kbX:8, kbY:-10,stun:0.45, launch:true,  heightOffset:-0.30,recovery:0.48 },
  // Special
  slideKick:    { type:'special', dur:0.36, activeStart:0.25, activeEnd:0.85, reach:1.35, radius:1.0, dmg:14, kbX:8, kbY:1.5,stun:0.35, launch:true,  heightOffset:-0.35, recovery:0.32 },
};

// Ground light chain order.
const GROUND_CHAIN = ['jab','cross','hook','knee','spinBack'];

// Weapon strings that the back-counter parry can deflect. Must stay in sync
// with the melee weapon list used by _tryClashOnIncoming.
const PARRY_DEFLECT_WEAPONS = new Set(['fist','sword','bat','longsword','mace','hammer','halberd','saber']);

export class Stickman {
  constructor(world, scene, opts) {
    this.world = world;
    this.scene = scene;
    this.game = opts.game ?? null;   // for fx/camera/hitStop access
    this.id = opts.id;
    this.name = opts.name ?? 'Player';
    this.character = opts.character;
    this.team = opts.team ?? 0;
    this.isLocal = opts.isLocal ?? false;
    this.isBot = opts.isBot ?? false;
    this.inputSource = opts.inputSource ?? null;  // {kind:'kb-mouse'} | {kind:'gamepad', gamepadIdx:N} | null (bot/net)

    // Physics: capsule = sphere + cylinder + sphere via two spheres + box (cheap & robust)
    const body = new CANNON.Body({
      mass: 70,
      material: world.materials.player,
      linearDamping: 0.12,
      angularDamping: 0.99,
      // Keep capsule physics rotation locked even on curved-gravity levels.
      // Rotating the 2-sphere capsule through Rapier moves the subshape
      // centers each tick, invalidating contact pairs and producing
      // velocity spikes ("flings"). The body stays upright in the sim;
      // the visual rig is rotated separately via _syncRig + _visualAngle.
      fixedRotation: true,
      allowSleep: false,  // direct velocity writes won't wake a sleeping body
      collisionFilterGroup: COL_GROUPS.PLAYER,
      collisionFilterMask: COL_GROUPS.WORLD | COL_GROUPS.PROP | COL_GROUPS.WEAPON | COL_GROUPS.HAZARD | COL_GROUPS.PLAYER | COL_GROUPS.PROJECTILE,
    });
    // Pure 2-sphere body (no box). Box edges were catching on tile seams. Spheres
    // glide smoothly across adjacent tiles.
    const halfMid = (BODY_HEIGHT - BODY_RADIUS * 2) / 2;
    body.addShape(new CANNON.Sphere(BODY_RADIUS), new CANNON.Vec3(0, halfMid, 0));
    body.addShape(new CANNON.Sphere(BODY_RADIUS), new CANNON.Vec3(0, -halfMid, 0));

    const spawnY = this._safeSpawnY(world, opts.spawn?.x ?? 0, opts.spawn?.y ?? 5);
    body.position.set(opts.spawn?.x ?? 0, spawnY, 0);
    body.userData = { kind: 'player', stickman: this };
    world.add(body);
    this.body = body;

    // Velocity-based impact damage: when a player slams into a destructible
    // tile fast enough (knocked into a wall, ground-pound landing, big fall),
    // the tile takes damage proportional to the relative speed. Per-tile
    // throttle prevents the same body from chewing a tile every physics tick.
    this._impactHitCooldown = new Map();
    this._onImpactHit = (e) => {
      const other = e.body;
      const ud = other?.userData;
      if (!ud) return;
      // Damage destructible tiles directly. Players + props could cascade
      // here too, but for now the tile case is the visible one and avoids
      // double-counting damage that other systems already handle.
      if (ud.kind !== 'tile' || !ud.tile || ud.tile.indestructible) return;
      const now = performance.now();
      const last = this._impactHitCooldown.get(other) ?? 0;
      if (now - last < 200) return;
      const v = this.body.velocity;
      const speed = Math.hypot(v.x, v.y);
      const threshold = 8;
      if (speed < threshold) return;
      this._impactHitCooldown.set(other, now);
      const dmg = (speed - threshold) * 2.5;
      if (dmg <= 0) return;
      this.game?.level?.damageTile?.(ud.tile, dmg, this);
      if (this.game?.fx?.particles) {
        this.game.fx.particles.burst(this.position.x, this.position.y, 0, { count: 6, speed: 4, color: 0xddc890 });
      }
      // Light camera punch only on heavy slams.
      if (speed > 14) this.game?.fx?.camera?.punch?.(0.10);
    };
    body.addEventListener('collide', this._onImpactHit);

    // Visual rig
    this.rig = new StickmanRig(opts.character || {});
    scene.add(this.rig.group);

    // Name tag
    this.nameSprite = this._makeNameSprite();
    if (this.nameSprite) scene.add(this.nameSprite);

    // Input snapshot (filled by controller each tick)
    this.input = {
      moveX: 0, moveY: 0,
      jump: false, jumpPressed: false,
      attack: false, attackPressed: false,
      grab: false, grabPressed: false,
      special: false, specialPressed: false,
      throw: false, throwPressed: false,
      aimX: 1, aimY: 0,
      aimActive: false,
    };
    this._prev = { jump: false, attack: false, grab: false, special: false, throw: false };
    this._attackPressedAt = 0;   // ms — last press timestamp for hold detection

    // State
    this.state = STATE.ACTIVE;
    this.health = 100;
    this.maxHealth = 100;
    this.armor = 0;
    this.maxArmor = 60;
    this.lives = 5;
    this.score = 0;
    this.deaths = 0;
    this.grounded = false;
    this.prevGrounded = false;
    this.groundNormalY = 1;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this._jumpLockUntil = 0;
    this._jumpInputCooldown = 0;
    this._dustTimer = 0;
    this.airJumps = 2; // 1 ground + 2 air = triple jump
    this.airJumpsLeft = 2;
    this.facing = 1;
    this.aimDir = new THREE.Vector2(1, 0);
    this.crouching = false;
    this.sliding = false;
    this._currentPlanetRef = null;     // populated by _updateGroundCheck on curved-gravity levels

    // Combat
    this.attackTimer = 0;        // counts down through swing
    this.attackCooldown = 0;
    this.attackHits = new Set();  // bodies hit this swing
    this.hitstun = 0;
    // Combat — combo state
    this.moveId = null;          // 'jab'|'cross'|'hook'|'knee'|'spinBack'
                                  // |'heavyNeutral'|'heavyUp'|'heavyDown'|'heavyForward'|'heavyBack'
                                  // |'airJab'|'airHook'|'airHeavyN'|'airHeavyU'|'airHeavyD'
                                  // |'slideKick'  or null
    this.chainStep = 0;          // 0..4 ground light chain
    this.airChainStep = 0;       // 0..1 air light chain
    this.chainTimer = 0;         // s remaining in chain window before reset
    this.charging = false;
    this.chargeStartedAt = 0;    // performance.now() ms when attack pressed
    this._pressDir = { x: 0, y: 0 };  // dir cached at press
    this.parryUntil = 0;         // ms — back-counter active until
    this.parryRecoverUntil = 0;  // ms — back-counter whiff lockout end
    this.juggled = false;        // launched-airborne flag
    this.juggledUntil = 0;       // ms
    this.juggleHits = 0;         // count of launched hits this window
    this.juggleStartedAt = 0;    // ms — when launcher hit landed (juggle ceiling anchor)
    this._attackBuffer = 0;      // ms deadline — buffered press, drained by _attackTick

    // Back-compat aliases for legacy code paths (rig reads, weapons, etc.).
    // Keep these as derived flags so renders + bot AI continue working unchanged
    // during partial rollouts.
    this._attackStep = 0;        // legacy — rig reads this
    this.kicking = false;        // legacy — rig reads this

    this._chargeTellTick = 0;    // charge tell particle counter

    this.invuln = 0;
    this.flashAmount = 0;
    this.lastDamager = null;
    this.lastDamageWeapon = null;
    this.killStreak = 0;
    this.spawnTime = 0;

    // Grab/throw
    this.grabbing = null;          // body grabbed by us
    this.grabConstraint = null;
    this.grabbedBy = null;          // stickman holding us
    this.grabReachTimer = 0;        // 0..GRAB_REACH_DUR while reaching for a grab
    // Throw windup — when grabbing button released with throw intent, queue a
    // windup. Arm rears back over the shoulder, then release fires the throw.
    this._throwWindupT = 0;
    this._throwWindupVx = 0;
    this._throwWindupVy = 0;
    this.climbing = null;           // body we cling to
    this.climbConstraint = null;
    this.climbCooldown = 0;

    // Weapon
    this.weapon = null;            // Weapon instance
    this.weaponMesh = null;

    // Death
    this.deathTimer = 0;
    this.respawnAt = 0;

    // Pickups & powers
    this.speedBoostUntil = 0;
    this.flightUntil = 0;
    this.invisibleUntil = 0;
    this.superPunchUntil = 0;
    this.timeSlowUntil = 0;
    this.gumGumUntil = 0;
    this.forcePushUntil = 0;
    this.forcePullUntil = 0;
    this.forceLightningUntil = 0;
    this.forceChokeUntil = 0;
    this._forceCooldown = 0;
    this._burnUntil = 0;
    this._burnTickAt = 0;
    this._burnSrc = null;
    this._frozenUntil = 0;

    // Misc visuals
    this._handAnchorWorld = new THREE.Vector3();
    // Reused per-frame scratch passed to rig.update() — avoids allocating
    // a fresh holdPos Vector3, aim object, and params bag every _syncRig.
    // 4 chars × 60 Hz = 240 GC-triggering allocs/sec eliminated.
    this._rigHoldPos = new THREE.Vector3();
    this._rigAim = { x: 0, y: 0 };
    this._rigParams = {};
  }

  // Cast down from above the requested spawn; return a Y that places the
  // capsule's bottom comfortably above any tile at that position.
  _safeSpawnY(world, sx, sy) {
    const top = sy + 8;
    const bot = sy - 8;
    const r = world.raycast({ x: sx, y: top, z: 0 }, { x: sx, y: bot, z: 0 }, { mask: COL_GROUPS.WORLD });
    if (r && r.hitPointWorld) {
      const groundY = r.hitPointWorld.y;
      // Capsule center sits at ground + BODY_HEIGHT/2 + small clearance.
      return groundY + BODY_HEIGHT / 2 + 0.05;
    }
    // No ground found — keep requested y but lift slightly to be safe.
    return sy + 0.5;
  }

  _makeNameSprite() {
    if (this.isBot && !this.name) return null;
    const cnv = document.createElement('canvas');
    cnv.width = 256; cnv.height = 64;
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const text = this.name.toUpperCase();
    ctx.font = 'bold 32px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 24;
    ctx.fillRect(128 - w / 2, 14, w, 36);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(cnv);
    tex.minFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(1.4, 0.35, 1);
    spr.renderOrder = 999;
    return spr;
  }

  get position() { return this.body.position; }
  get velocity() { return this.body.velocity; }
  get alive() { return this.state !== STATE.DEAD && this.lives > 0; }

  setWeapon(weapon) {
    if (this.charging) this._clearCombatState();
    if (this.weapon) {
      const old = this.weapon;
      old.detach();
      old.dropAt(this.position, { x: this.facing * 5, y: 4 });
    }
    this.weapon = weapon;
    if (weapon) {
      weapon.attachTo(this);
      audio.pickup();
      if (this.isLocal && this.game?.hud) {
        this.game.hud.toast?.(`${weapon.icon || ''} ${weapon.name}`);
      }
    }
  }

  applyKnockback(vx, vy, stun = 0.25) {
    this.body.wakeUp();
    this.body.velocity.x = vx;
    this.body.velocity.y = vy;
    this.hitstun = Math.max(this.hitstun, stun);
  }

  takeDamage(amount, opts = {}) {
    if (this.state === STATE.DEAD) return false;
    if (this.invuln > 0) return false;
    // Melee clash — if a punch / melee swing connects while this defender is
    // also mid-swing of a melee/fist and facing the attacker, both attacks
    // parry. No damage, both knocked back, both staggered briefly.
    if (this._tryClashOnIncoming(opts)) return false;
    // Back-counter parry: if attacker is mid-melee swing and the defender
    // is in their active parry window, treat as a clash (both bounce,
    // both cancel) — no damage taken on either side.
    const tNow = performance.now();
    const parryActive = tNow < this.parryUntil;
    const allowed = PARRY_DEFLECT_WEAPONS.has(opts.weapon);
    if (parryActive && allowed && opts.attacker && opts.attacker !== this) {
      // Reuse the existing two-strike clash resolution.
      if (this._clash) this._clash(opts.attacker);
      this.parryUntil = 0;
      // Drop the defender out of counter-stance immediately so they can act.
      this.attackTimer = 0;
      this.moveId = null;
      this.parryRecoverUntil = 0;
      return;  // damage suppressed
    }
    // Armor absorbs damage first. When armor breaks, spawn a chunk that falls.
    if (this.armor > 0 && opts.weapon !== 'lava' && opts.weapon !== 'flame') {
      const absorbed = Math.min(this.armor, amount);
      this.armor -= absorbed;
      amount -= absorbed * 0.7; // armor absorbs 70% of the hit
      if (this.game?.fx) {
        this.game.fx.particles.debris(this.position.x, this.position.y + 0.4, 0, 0xa0a8b8, 4);
      }
      if (this.armor <= 0) {
        // Armor broken — bigger pop
        if (this.game?.fx) this.game.fx.particles.debris(this.position.x, this.position.y + 0.4, 0, 0xa0a8b8, 12);
        audio.break();
      }
    }
    this.health -= amount;
    this.flashAmount = Math.min(1, this.flashAmount + Math.min(1, amount / 10));
    this.lastDamageWeapon = opts.weapon ?? null;
    // Skip sound for tiny continuous DoT (lava, burn).
    const quiet = opts.weapon === 'lava' || opts.weapon === 'flame';
    if (amount >= 3 && !quiet) audio.hit();
    if (opts.kb) {
      this.applyKnockback(opts.kb.x, opts.kb.y, opts.stun ?? 0.25);
      this.rig.flinch?.(opts.kb.x, clamp(amount / 25, 0.4, 1.5));
    }
    // Launch flag from combat MOVE_TABLE — heavy/launcher hits ragdoll the
    // victim regardless of remaining HP. Pure stagger lights leave the
    // victim upright.
    if (opts.launch && this.alive) {
      // Approximate by setting hitstun proportional to launch force and
      // letting physics carry the body.
      const launchStun = (opts.stun ?? 0.3) + 0.25;
      this.hitstun = Math.max(this.hitstun, launchStun);
      this.flashAmount = 1;
    }
    this.lastDamager = opts.attacker ?? null;

    // Visual feedback: blood, hit-stop, screenshake, briefly tilt body.
    const game = this.game ?? opts.attacker?.game;
    if (game?.fx && amount >= 3) {
      const dirX = opts.kb ? Math.sign(opts.kb.x || 0) || 0 : 0;
      const dirY = opts.kb ? Math.sign(opts.kb.y || 1) || 1 : 1;
      game.fx.particles.blood(this.position.x, this.position.y + 0.4, 0, dirX, dirY);
      // Camera kick scaled by damage; bigger if it's the local player getting hit.
      const punch = clamp((amount / 30) * (this.isLocal ? 0.6 : 0.25), 0.05, 0.7);
      game.fx.camera.punch(punch);
      // Hit-stop on every meaningful hit, stronger on big damage.
      game.hitStop?.(clamp(amount / 80, 0.02, 0.1));
      // Red flash overlay — P1 only. Single full-screen overlay, can't represent
      // four locals, so couch-MP P2/P3/P4 hits don't trigger it.
      if (this === game.localPlayer && game.hud) game.hud.damageFlash?.(amount);
      // Haptics: hit-taken on local player (stronger), hit-landed when
      // the local player did the damage (weaker).
      if (this === game.localPlayer) vibrate(25);
      else if (opts.attacker && opts.attacker === game.localPlayer) vibrate(15);
    }

    if (this.health <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  die(reason = 'ko') {
    if (this.state === STATE.DEAD) return;
    this._clearCombatState();
    this.state = STATE.DEAD;
    this.health = 0;
    this.deaths++;
    this.lives--;
    this.deathTimer = 1.6;
    this.respawnAt = performance.now() + 1600;
    audio.death();
    if (this.lastDamager && this.lastDamager !== this && this.lastDamager.alive) {
      this.lastDamager.score++;
      this.lastDamager.killStreak++;
    }
    this.body.collisionFilterMask = COL_GROUPS.WORLD; // ragdoll only collides with world
    this.body.linearDamping = 1.2;
    this.body.angularDamping = 0.5;
    this.body.fixedRotation = false;
    this.body.updateMassProperties();
    // Tumble spin proportional to direction of last damager so the corpse
    // pinwheels away from attacker instead of slumping straight down.
    const lastDmg = this.lastDamager;
    const hitDx = lastDmg ? Math.sign(this.body.position.x - lastDmg.body.position.x) : (Math.random() < 0.5 ? -1 : 1);
    this.body.angularVelocity.z = hitDx * (8 + Math.random() * 4);
    // pop limbs
    if (this.weapon) {
      this.weapon.detach();
      this.weapon.dropAt(this.position, this.body.velocity);
      this.weapon = null;
    }
    if (this.grabbing) this.releaseGrab();
    if (this.grabbedBy) this.grabbedBy.releaseGrab();
  }

  // Knock the held weapon out of the hand without ragdolling the player.
  // Triggered when a projectile hits the weapon while the player isn't
  // mid-swing (mid-swing projectiles are reflected by Weapon._reflectProjectiles).
  // `incoming` is the projectile that did the disarm; we use its velocity to
  // throw the weapon in the same direction so it visually "knocks loose."
  _disarm(incoming) {
    if (!this.weapon) return false;
    const w = this.weapon;
    const v = incoming?.body?.velocity;
    const vx = v ? v.x * 0.4 : (this.facing * 4);
    const vy = v ? Math.max(0, v.y * 0.3) + 4 : 5;
    w.detach();
    // Drop slightly above the hand so it tumbles naturally.
    const hand = this.rig?.handR?.position;
    const hx = hand?.x ?? (this.position.x + this.facing * 0.4);
    const hy = hand?.y ?? (this.position.y + 0.6);
    w.dropAt({ x: hx, y: hy }, { x: vx, y: vy });
    this.weapon = null;
    audio.click?.();
    return true;
  }

  respawn(spawnPos) {
    this.state = STATE.ACTIVE;
    this.health = this.maxHealth;
    this.invuln = 1.5;
    // Detach corpse-hit handler if a thrown body is being respawned mid-air.
    if (this._corpseHitFn) {
      try { this.body.removeEventListener('collide', this._corpseHitFn); } catch (_) {}
      this._corpseHitFn = null;
      this._corpseAttacker = null;
    }
    if (this.grabbedBy) this.grabbedBy.releaseGrab();
    this.rig.resetSprings?.();
    const safeY = this._safeSpawnY(this.world, spawnPos.x, spawnPos.y);
    this.body.position.set(spawnPos.x, safeY, 0);
    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
    this.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), 0);
    this.body.collisionFilterMask = COL_GROUPS.WORLD | COL_GROUPS.PROP | COL_GROUPS.WEAPON | COL_GROUPS.HAZARD | COL_GROUPS.PLAYER | COL_GROUPS.PROJECTILE;
    this.body.fixedRotation = true;     // capsule physics always upright; rig rotates separately
    this._visualAngle = 0;              // reset rig rotation on respawn
    this.body.linearDamping = 0.12;
    this.body.angularDamping = 0.99;
    this.body.updateMassProperties();
    this.killStreak = 0;
    this.spawnTime = performance.now();
    audio.spawn();
  }

  releaseGrab(throwVx = 0, throwVy = 0) {
    if (!this.grabbing) return;
    if (this.grabConstraint) {
      this.world.removeConstraint(this.grabConstraint);
      this.grabConstraint = null;
    }
    const target = this.grabbing;
    this.grabbing = null;
    if (target.userData?.stickman) {
      const sm = target.userData.stickman;
      sm.grabbedBy = null;
      if (sm.state === STATE.GRABBED) sm.state = STATE.ACTIVE;
      sm.body.collisionFilterMask = sm.state === STATE.DEAD
        ? COL_GROUPS.WORLD
        : (COL_GROUPS.WORLD | COL_GROUPS.PROP | COL_GROUPS.WEAPON | COL_GROUPS.HAZARD | COL_GROUPS.PLAYER | COL_GROUPS.PROJECTILE);
    }
    target.collisionResponse = true;
    target.wakeUp();
    if (throwVx !== 0 || throwVy !== 0) {
      target.velocity.x += throwVx;
      target.velocity.y += throwVy;
    }
  }

  releaseClimb() {
    if (!this.climbing) return;
    this.climbing = null;
    this.body.setGravityScale?.(1);
    this.climbCooldown = 0.2;
  }

  _updateGroundCheck() {
    if (this.game?.level?.curvedGravity) {
      this._currentPlanetRef = this._currentPlanet();
      const planet = this._currentPlanetRef;
      if (!planet) {
        this.grounded = false;
        this.groundNormalY = 1;
        this.coyote = Math.max(0, this.coyote - this._dt);
        return;
      }
      const dx = this.body.position.x - planet.cx;
      const dy = this.body.position.y - planet.cy;
      const r = Math.hypot(dx, dy) || 1;
      const ux = dx / r, uy = dy / r;
      const top = { x: this.body.position.x, y: this.body.position.y, z: 0 };
      const bot = {
        x: this.body.position.x - ux * 0.95,
        y: this.body.position.y - uy * 0.95,
        z: 0,
      };
      const hit = this.world.raycast(top, bot, { mask: COL_GROUPS.WORLD });
      const groundedRaw = !!hit;
      const lockActive = performance.now() < (this._jumpLockUntil || 0);
      // FIX I1: use radial outward velocity, not world-y, for the rising check.
      const vR = this.body.velocity.x * ux + this.body.velocity.y * uy;
      const rising = vR > 0.5;
      const jumpLocked = lockActive && rising;
      this.grounded = groundedRaw && !jumpLocked;
      this.groundNormalY = hit ? hit.hitNormalWorld.y : 1;
      if (this.grounded && !this.prevGrounded) {
        this.airJumpsLeft = this.airJumps;
      }
      if (this.grounded) {
        this.coyote = 0.14;
      } else {
        this.coyote = Math.max(0, this.coyote - this._dt);
      }
      return;
    }
    // ... existing flat-gravity grounded check below ...
    const from = this.body.position;
    const yTop = from.y - BODY_HEIGHT / 2 - 0.02;
    const yBot = from.y - BODY_HEIGHT / 2 - 0.40;
    const mask = COL_GROUPS.WORLD | COL_GROUPS.PROP;
    // Center ray first — covers ~95% of cases (player standing/walking on a tile
    // wider than the capsule). Side rays only fire when center misses, e.g. one
    // foot dangling over a ledge. Cuts raycasts/frame from 3N to ~N typical.
    let bestHit = this.world.raycast(
      { x: from.x, y: yTop, z: from.z },
      { x: from.x, y: yBot, z: from.z },
      { mask },
    );
    if (!bestHit) {
      const off = BODY_RADIUS * 0.85;
      const rL = this.world.raycast(
        { x: from.x - off, y: yTop, z: from.z },
        { x: from.x - off, y: yBot, z: from.z },
        { mask },
      );
      const rR = this.world.raycast(
        { x: from.x + off, y: yTop, z: from.z },
        { x: from.x + off, y: yBot, z: from.z },
        { mask },
      );
      if (rL && (!bestHit || rL.distance < bestHit.distance)) bestHit = rL;
      if (rR && (!bestHit || rR.distance < bestHit.distance)) bestHit = rR;
    }
    // Pure distance-based ground check. Ray length is short (0.4m), so any
    // hit within 0.2m means we're effectively touching the surface.
    //
    // Suppression: ONLY reject grounded while actively rising (vy > ~1.5).
    // The jump-lock window also applies but only matters during the rise — it
    // covers the brief frame post-jump where the ray still touches the floor
    // we just left. Crucially, a landing during a fall (vy <= 0) is ALWAYS
    // honored, even mid-air-jump cooldown — otherwise air-jumping and
    // immediately landing on a lower platform leaves the player un-grounded
    // with no air jumps left = soft-locked.
    const groundedRaw = !!bestHit && bestHit.distance < 0.2;
    // Only ignore grounded while genuinely rising AND inside the post-jump
    // window. As soon as vy goes to zero / negative the body is falling,
    // so any ray hit IS a real landing — never reject it. This is the
    // cure for "jumping breaks after landing on a lower platform": the
    // landing during a fall always counts.
    const lockActive = performance.now() < (this._jumpLockUntil || 0);
    const rising = this.body.velocity.y > 0.5;
    const jumpLocked = lockActive && rising;
    this.grounded = groundedRaw && !jumpLocked;
    this.groundNormalY = bestHit ? bestHit.hitNormalWorld.y : 1;
    // Reset air jumps ONLY on the landing transition (was airborne, now
    // grounded). Sitting on the ground does not re-arm anything; this avoids
    // any accidental re-arm during the post-jump frame where the ray might
    // briefly clip the floor we just left.
    if (this.grounded && !this.prevGrounded) {
      this.airJumpsLeft = this.airJumps;
    }
    if (this.grounded) {
      this.coyote = 0.14;
    } else {
      this.coyote = Math.max(0, this.coyote - this._dt);
    }
  }

  _tryGrab(world, players) {
    // Grab origin = the right hand's projected world position when in grab pose.
    // Restricts grabs to actual hand contact (not torso/leg pass-throughs).
    // Reach is generous (Stick-Fight scale) — players slide into grab range
    // without needing pixel-perfect spacing.
    const cx = this.position.x + this.facing * 0.95;
    const cy = this.position.y + 0.55;
    const cz = this.position.z;
    const reach = 0.95;

    // Players first (alive + dead corpses are valid targets).
    let best = null, bestDist = reach * reach;
    for (const p of players) {
      if (!p || p === this) continue;
      if (p.state === STATE.GRABBED) continue;
      if (p.grabbing) continue;          // can't grab someone already grabbing another
      // Skip alive invulnerable players. Dead bodies are always grabbable.
      if (p.state !== STATE.DEAD && p.invuln > 0) continue;
      if (p.state !== STATE.DEAD && !p.alive) continue;
      const dx = p.position.x - cx, dy = p.position.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) { best = p; bestDist = d2; }
    }
    if (best) {
      this._grabBody(best.body, best);
      return true;
    }

    // Then nearby props/weapons
    const hits = world.overlapSphere({ x: cx, y: cy, z: cz }, reach, COL_GROUPS.PROP | COL_GROUPS.WEAPON);
    let prop = null, propD2 = reach * reach;
    for (const b of hits) {
      if (b === this.body) continue;
      if (b.userData?.kind === 'weapon') continue; // weapons are picked up via separate touch logic
      const dx = b.position.x - cx, dy = b.position.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < propD2) { prop = b; propD2 = d2; }
    }
    // Dynamic world tiles (crates etc.) — same grab semantics as props.
    // They live in COL_GROUPS.WORLD because they collide with everything,
    // but `mass > 0` + `userData.kind === 'tile'` is enough to treat them
    // as pickup-and-throw objects.
    const worldHits = world.overlapSphere({ x: cx, y: cy, z: cz }, reach, COL_GROUPS.WORLD);
    for (const b of worldHits) {
      if (b === this.body) continue;
      if (b.mass === 0) continue; // static tile — falls through to climb path
      if (b.userData?.kind !== 'tile') continue;
      const dx = b.position.x - cx, dy = b.position.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < propD2) { prop = b; propD2 = d2; }
    }
    if (prop) { this._grabBody(prop, null); return true; }

    // Climb: world bodies (terrain edges/ledges)
    const wallHits = world.overlapSphere({ x: cx, y: cy, z: cz }, reach * 0.9, COL_GROUPS.WORLD);
    for (const b of wallHits) {
      if (b.mass !== 0) continue; // static only for climbing
      if (this.climbCooldown > 0) continue;
      this._climbTo(b);
      return true;
    }
    return false;
  }

  _grabBody(body, smTarget) {
    this.grabbing = body;
    if (smTarget) {
      const wasDead = smTarget.state === STATE.DEAD;
      smTarget.grabbedBy = this;
      if (!wasDead) smTarget.state = STATE.GRABBED;
      // Pass-through other players while held; dead corpses can hit when thrown.
      if (wasDead) {
        smTarget.body.collisionFilterMask = COL_GROUPS.WORLD | COL_GROUPS.PLAYER;
        smTarget._corpseAttacker = this;
        smTarget._corpseHitFn = (e) => {
          const other = e.body;
          if (!other?.userData) return;
          if (other === this.body || other === smTarget.body) return;
          if (other.userData.kind === 'player') {
            const victim = other.userData.stickman;
            if (victim && victim.alive && victim.invuln <= 0 && victim !== smTarget._corpseAttacker) {
              const v = smTarget.body.velocity;
              const speed = Math.hypot(v.x, v.y);
              if (speed > 5) {
                victim.takeDamage(14, {
                  attacker: smTarget._corpseAttacker, weapon: 'corpse',
                  kb: { x: v.x * 0.35, y: 5 + Math.abs(v.y) * 0.2 }, stun: 0.3,
                });
              }
            }
          }
        };
        smTarget.body.addEventListener('collide', smTarget._corpseHitFn);
      } else {
        smTarget.body.collisionFilterMask &= ~COL_GROUPS.PLAYER;
      }
      smTarget.body.wakeUp();
    }
    const offset = new CANNON.Vec3(this.facing * 0.7, 0.2, 0);
    const c = new CANNON.PointToPointConstraint(this.body, offset, body, new CANNON.Vec3(0, 0, 0), 1e6);
    this.grabConstraint = this.world.addConstraint(c);
    audio.click();
  }

  _climbTo(body) {
    // Stay DYNAMIC so floor/roof collisions still work — gravity countered each tick.
    this.climbing = body;
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    audio.click();
  }

  _forcePush() {
    const radius = 6.5;
    const game = this.game;
    if (game?.fx) {
      game.fx.particles.burst(this.position.x + this.facing * 0.6, this.position.y + 0.4, 0, { count: 36, speed: 14, color: 0x88aaff });
      game.fx.camera.punch(0.3);
    }
    audio.sweep(900, 80, 0.3, 'sawtooth', 0.35);
    for (const p of game.players) {
      if (!p || p === this || !p.alive || p.invuln > 0) continue;
      const dx = p.position.x - this.position.x;
      const dy = p.position.y - this.position.y;
      const d = Math.hypot(dx, dy);
      if (d >= radius) continue;
      // Only push targets in front (don't blast 360°).
      if ((dx > 0 ? 1 : -1) !== this.facing) continue;
      const f = 1 - d / radius;
      const nx = dx / Math.max(0.1, d), ny = dy / Math.max(0.1, d);
      p.takeDamage(8 * f, {
        attacker: this, weapon: 'forcePush',
        kb: { x: nx * 28 * f, y: ny * 8 * f + 6 }, stun: 0.4 * f,
      });
    }
  }
  _forcePull() {
    const radius = 8;
    const game = this.game;
    if (game?.fx) game.fx.particles.burst(this.position.x, this.position.y + 0.4, 0, { count: 24, speed: 10, color: 0x4dccff });
    audio.sweep(120, 1000, 0.3, 'sine', 0.3);
    for (const p of game.players) {
      if (!p || p === this || !p.alive || p.invuln > 0) continue;
      const dx = this.position.x - p.position.x;
      const dy = (this.position.y + 0.5) - p.position.y;
      const d = Math.hypot(dx, dy);
      if (d >= radius) continue;
      if (d < 1) continue; // already touching
      const nx = dx / Math.max(0.1, d), ny = dy / Math.max(0.1, d);
      p.body.velocity.x = nx * 18;
      p.body.velocity.y = ny * 14 + 4;
      p.takeDamage(2, { attacker: this, weapon: 'forcePull' });
    }
  }
  _forceLightning() {
    const game = this.game;
    const start = { x: this.position.x + this.facing * 0.6, y: this.position.y + 0.55 };
    let prev = start;
    const hit = new Set();
    audio.sweep(2200, 200, 0.18, 'square', 0.3);
    audio.noise(0.12, 0.25, 6000);
    for (let i = 0; i < 3; i++) {
      let best = null, bestD2 = 12 * 12;
      for (const p of game.players) {
        if (!p || p === this || !p.alive || p.invuln > 0) continue;
        if (hit.has(p.id)) continue;
        const dx = p.position.x - prev.x, dy = p.position.y - prev.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = p; }
      }
      if (!best) break;
      hit.add(best.id);
      const segs = 10;
      for (let s = 0; s < segs; s++) {
        const t = s / (segs - 1);
        const x = prev.x + (best.position.x - prev.x) * t + (Math.random() - 0.5) * 0.25;
        const y = prev.y + (best.position.y + 0.45 - prev.y) * t + (Math.random() - 0.5) * 0.25;
        game.fx.particles.spark.spawn({ x, y, z: 0, vx: 0, vy: 0, life: 0.15, size: 0.13, color: 0xeeccff, gravity: 0, drag: 0.9, shrink: 1 });
      }
      best.takeDamage(18 - i * 4, {
        attacker: this, weapon: 'lightning',
        kb: { x: (best.position.x - prev.x) * 0.8, y: 3 }, stun: 0.25,
      });
      prev = { x: best.position.x, y: best.position.y };
    }
    game.fx.camera.punch(0.18);
  }
  _forceChoke() {
    const game = this.game;
    // Find closest enemy in front of facing.
    let best = null, bestD2 = 7 * 7;
    for (const p of game.players) {
      if (!p || p === this || !p.alive || p.invuln > 0) continue;
      const dx = p.position.x - this.position.x;
      const dy = p.position.y - this.position.y;
      if ((dx > 0 ? 1 : -1) !== this.facing) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = p; }
    }
    if (!best) return;
    audio.sweep(80, 30, 0.6, 'sawtooth', 0.25);
    // Lift target.
    best.body.velocity.x = 0;
    best.body.velocity.y = 12;
    best.takeDamage(20, {
      attacker: this, weapon: 'choke',
      kb: { x: 0, y: 12 }, stun: 0.7,
    });
    // Shake them mid-air.
    const target = best;
    const tickStart = performance.now();
    const shakeFn = () => {
      const elapsed = performance.now() - tickStart;
      if (elapsed > 700 || !target.alive) return;
      target.body.velocity.x = (Math.random() - 0.5) * 6;
      target.body.velocity.y = 6;
      requestAnimationFrame(shakeFn);
    };
    shakeFn();
    if (game.fx) {
      game.fx.particles.burst(target.position.x, target.position.y + 0.4, 0, { count: 18, speed: 6, color: 0xff4d6d });
      game.fx.camera.punch(0.2);
    }
  }

  _throwWeapon() {
    if (!this.weapon) return;
    const w = this.weapon;
    w.detach();
    this.weapon = null;
    // Throw direction from aim (or facing).
    const dx = this.input.aimActive ? this.aimDir.x : this.facing;
    const dy = this.input.aimActive ? this.aimDir.y : 0.2;
    const speed = 22;
    w.spawnAt(this.position.x + dx * 0.6, this.position.y + 0.6 + dy * 0.4, 0);
    if (w.body) {
      w.body.velocity.set(dx * speed, dy * speed + 4, 0);
      w.body.angularVelocity.set(0, 0, this.facing * 18);
      w.dropCooldown = 0.5;     // can't pick back up immediately
      w._thrownBy = this;
      // Damage on impact via collide handler.
      const onHit = (e) => {
        const other = e.body;
        if (!other?.userData) return;
        if (other === this.body) return;
        if (other.userData.kind === 'player') {
          const sm = other.userData.stickman;
          if (sm && sm.alive && sm.invuln <= 0 && sm !== this) {
            sm.takeDamage(18, {
              attacker: this, weapon: 'thrown',
              kb: { x: dx * 14, y: 7 }, stun: 0.3,
            });
          }
        } else if (other.userData.kind === 'tile') {
          w.game.level.damageTile(other.userData.tile, 8, this);
        }
      };
      w.body.addEventListener('collide', onHit);
      // Auto-remove handler after a moment so the weapon can be picked up later
      setTimeout(() => { try { w.body?.removeEventListener('collide', onHit); } catch (_) {} }, 1500);
    }
    audio.swing();
  }

  // Identify melee-class incoming attack vs. ranged/projectile/dot/explosion
  // and check if defender is currently swinging melee facing the attacker.
  _tryClashOnIncoming(opts) {
    const attacker = opts?.attacker;
    if (!attacker || attacker === this) return false;
    // Super-punch / nukes / explosions / projectiles / hazards never clash.
    const meleeWeapons = new Set(['fist','sword','bat','longsword','mace','hammer','halberd','flame','ice','saber']);
    if (!meleeWeapons.has(opts.weapon)) return false;
    const defenderSwinging =
      (this.weapon && this.weapon.swingTimer > 0 && !this.weapon.aimWeapon) ||
      (!this.weapon && this.attackTimer > 0);
    if (!defenderSwinging) return false;
    const dirA = Math.sign(this.position.x - attacker.position.x);
    if (dirA === 0) return false;
    if (dirA !== attacker.facing) return false;
    if (-dirA !== this.facing) return false;
    attacker._clash(this);
    return true;
  }

  // Two attackers parry each other — both bounce away, no damage.
  // Cancels both attack timers + briefly locks them out (stagger).
  _clash(other) {
    if (this._lastClashAt && performance.now() - this._lastClashAt < 200) return;
    this._lastClashAt = performance.now();
    other._lastClashAt = this._lastClashAt;
    const dx = Math.sign(other.position.x - this.position.x) || 1;
    const punch = 8;
    this.body.velocity.x = -dx * punch;
    this.body.velocity.y = 3;
    other.body.velocity.x = dx * punch;
    other.body.velocity.y = 3;
    this.attackTimer = 0;
    other.attackTimer = 0;
    if (this.weapon) this.weapon.swingTimer = 0;
    if (other.weapon) other.weapon.swingTimer = 0;
    this.attackCooldown = Math.max(this.attackCooldown, 0.25);
    other.attackCooldown = Math.max(other.attackCooldown, 0.25);
    this.hitstun = Math.max(this.hitstun, 0.18);
    other.hitstun = Math.max(other.hitstun, 0.18);
    audio.swing();
    audio.beep?.(880, 0.06, 'square', 0.25);
    audio.beep?.(440, 0.04, 'square', 0.18);
    if (this.game?.fx) {
      const mx = (this.position.x + other.position.x) / 2;
      const my = (this.position.y + other.position.y) / 2 + 0.3;
      this.game.fx.particles.burst(mx, my, 0, { count: 14, speed: 9, color: 0xffee88 });
      this.game.fx.particles.burst(mx, my, 0, { count: 8, speed: 6, color: 0xffffff });
      this.game.fx.camera.punch(0.18);
      this.game.hitStop?.(0.06);
    }
  }

  _doAttack() {
    // Compatibility entry-point — still called from tick() on attackPressed.
    // Routes to weapon path if armed, otherwise enters the unarmed FSM.
    if (this.weapon) { this.weapon.tryFire(this); return; }
    // Slide-kick short-circuit — committed even mid-slide.
    if (this.sliding && this.grounded) {
      this._fireMove('slideKick');
      return;
    }
    // Buffer the press if the FSM can't accept it right now — replayed by
    // _attackTick when the current move/cooldown ends. 200ms window covers
    // mash + chain rhythm without producing ghost presses long after.
    const blocked =
      this.attackCooldown > 0
      || performance.now() < this.parryRecoverUntil
      || this.charging
      || this.moveId;
    if (blocked) {
      this._attackBuffer = performance.now() + 200;
      return;
    }
    this.charging = true;
    this.chargeStartedAt = performance.now();
    this._pressDir = { x: this.input.moveX, y: this.input.moveY };
  }

  // Called per-frame from tick() to resolve a held attack on release.
  _chargeTick(dt) {
    if (!this.charging) return;
    // If frozen mid-charge, cancel — we won't receive a release edge during freeze.
    if (performance.now() < this._frozenUntil) {
      this.charging = false;
      this.chargeStartedAt = 0;
      return;
    }
    // Cancel on jump, hit, ragdoll, etc. (Those branches clear this.charging
    // elsewhere — here we only resolve on release.)
    if (!this.input.attackReleased) {
      // Charge tell — emit one glow particle every ~5 frames on the
      // striking limb. Direction at current stick gives a hint of which
      // heavy will fire on release.
      if (this.charging && this.game?.fx?.particles) {
        this._chargeTellTick = (this._chargeTellTick || 0) + 1;
        if (this._chargeTellTick % 5 === 0) {
          const dir = this.input;
          const id = this._heavyForDir({ x: dir.moveX, y: dir.moveY }, !this.grounded);
          const useFoot = (id === 'airHeavyD' || id === 'airHeavyN');
          const cx = this.position.x + this.facing * (useFoot ? 0.25 : 0.55);
          const cy = this.position.y + (useFoot ? -0.30 : 0.30);
          this.game.fx.particles.spark?.spawn?.({
            x: cx, y: cy, z: 0,
            vx: (Math.random() - 0.5) * 1, vy: useFoot ? -0.5 : 0.5,
            life: 0.25, size: 0.18,
            color: 0xffd866, gravity: 0, drag: 0.8, shrink: 1.5,
          });
        }
      }
      return;
    }
    const heldS = (performance.now() - this.chargeStartedAt) / 1000;
    this.charging = false;
    const liveDir = { x: this.input.moveX, y: this.input.moveY };
    const dir = (heldS >= 0.20) ? liveDir : this._pressDir;
    const airborne = !this.grounded;
    let id;
    if (heldS >= 0.20) {
      id = this._heavyForDir(dir, airborne);
    } else if (airborne) {
      id = (this.airChainStep === 0) ? 'airJab' : 'airHook';
      this.airChainStep = (this.airChainStep + 1) % 2;
    } else {
      id = GROUND_CHAIN[this.chainStep];
      this.chainStep = (this.chainStep + 1) % GROUND_CHAIN.length;
      this.chainTimer = 0.45;
    }
    this._fireMove(id);
  }

  _heavyForDir(dir, airborne) {
    if (airborne) {
      if (dir.y < -0.4) return 'airHeavyD';
      if (dir.y >  0.4) return 'airHeavyU';
      return 'airHeavyN';
    }
    if (dir.y >  0.4) return 'heavyUp';
    if (dir.y < -0.4) return 'heavyDown';
    // Treat "back" as stick away from facing.
    const f = this.facing || 1;
    if (Math.abs(dir.x) > 0.4) {
      if (Math.sign(dir.x) === f) return 'heavyForward';
      return 'heavyBack';
    }
    return 'heavyNeutral';
  }

  _clearCombatState() {
    this.charging = false;
    this.chargeStartedAt = 0;
    this._chargeTellTick = 0;
    this.moveId = null;
    this.attackTimer = 0;
    this.kicking = false;
    this.chainStep = 0;
    this.airChainStep = 0;
    this.chainTimer = 0;
    this.juggled = false;
    this.juggledUntil = 0;
    this.juggleHits = 0;
    this.parryUntil = 0;
    this.parryRecoverUntil = 0;
    this._attackBuffer = 0;
    this.attackCooldown = 0;
  }

  _fireMove(id) {
    const m = MOVE_TABLE[id];
    if (!m) return;
    this.moveId = id;
    this.attackTimer = m.dur;
    this.attackCooldown = m.recovery;
    this.attackHits.clear();
    this._feedbackFiredThisSwing = false;
    // Legacy rig flags so old rig code paths render reasonable poses until
    // the rig is rewritten in Task 11–13.
    this.kicking = (id === 'knee'
                    || id === 'airHeavyN' || id === 'airHeavyD' || id === 'slideKick');
    this._attackStep = (id === 'jab') ? 0 : (id === 'cross') ? 1 : 2;

    // Per-move startup impulses.
    if (id === 'heavyForward') {
      this.body.velocity.x += this.facing * 8;
    } else if (id === 'airHeavyD') {
      this.body.velocity.y -= 12;
      this.body.velocity.x += this.facing * 6;
    } else if (id === 'slideKick') {
      // Maintain slide momentum — no impulse change.
    }

    // Back-counter — set parry window, no hitbox.
    if (id === 'heavyBack') {
      const t = performance.now();
      this.parryUntil = t + 250;
      this.parryRecoverUntil = t + 550;
    }

    audio.swing();
    // Subtle press cue — used to be 0.35 which read as a "hit" flash even on
    // whiffs. The bright contact flash (0.55+) now fires on actual connect,
    // so whiff feedback only needs a soft pulse for input registration.
    this.flashAmount = Math.max(this.flashAmount, 0.15);
  }

  _attackTick(dt, players) {
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    // Drain a buffered press once the FSM is ready to accept input again.
    // Lets a mash-press during recovery turn into the next chain hit.
    // Fires a LIGHT directly (buffer is by-design a quick tap) so we don't
    // start a charge that has no release frame to resolve it.
    if (this._attackBuffer
        && performance.now() < this._attackBuffer
        && this.attackCooldown <= 0
        && !this.charging
        && !this.moveId
        && !this.weapon
        && performance.now() >= this.parryRecoverUntil) {
      this._attackBuffer = 0;
      if (this.sliding && this.grounded) {
        this._fireMove('slideKick');
      } else if (!this.grounded) {
        const id = (this.airChainStep === 0) ? 'airJab' : 'airHook';
        this.airChainStep = (this.airChainStep + 1) % 2;
        this._fireMove(id);
      } else {
        const id = GROUND_CHAIN[this.chainStep];
        this.chainStep = (this.chainStep + 1) % GROUND_CHAIN.length;
        this.chainTimer = 0.45;
        this._fireMove(id);
      }
    } else if (this._attackBuffer && performance.now() >= this._attackBuffer) {
      this._attackBuffer = 0;
    }
    if (this.attackTimer <= 0) {
      if (this.moveId) {
        this.moveId = null;
        this.kicking = false;
      }
      return;
    }
    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      this.moveId = null;
      this.kicking = false;
      return;
    }
    // Weapons handle their own hit detection.
    if (this.weapon) return;
    const id = this.moveId;
    if (!id) return;
    const m = MOVE_TABLE[id];
    if (!m) return;
    // heavyBack is parry-only — no hitbox.
    if (m.radius <= 0 || m.dmg === 0) return;

    const phase = 1 - this.attackTimer / m.dur;
    if (phase < m.activeStart || phase > m.activeEnd) return;

    const tNow = performance.now();
    const gumGum = tNow < this.gumGumUntil;
    const superPunch = tNow < this.superPunchUntil;

    // Reach is amplified by gumGum (rubber stretch).
    const reach = gumGum ? Math.max(m.reach, 4.8) : m.reach;
    const radius = gumGum ? 0.8 : m.radius;
    const cx = this.position.x + this.facing * reach;
    const cy = this.position.y + m.heightOffset;

    // Damage / kb base from move table, overridden by super/gumGum.
    let baseDmg = m.dmg;
    let baseKbX = this.facing * m.kbX;
    let baseKbY = m.kbY;
    let baseStun = m.stun;
    if (superPunch) {
      baseDmg = 60;
      baseKbX = this.facing * 38;
      baseKbY = 17;
      baseStun = 0.5;
    } else if (gumGum) {
      baseDmg = 22;
      baseKbX = this.facing * 17;
      baseKbY = 8;
      baseStun = 0.35;
    }

    for (const p of players) {
      if (!p || p === this || !p.alive || p.invuln > 0) continue;
      if (this.attackHits.has(p.id)) continue;
      const dx = p.position.x - cx;
      const dy = p.position.y - cy;
      if (dx * dx + dy * dy >= radius * radius) continue;

      let dmg = baseDmg;
      let kbX = baseKbX;
      let kbY = baseKbY;
      let stun = baseStun;

      // Counter-hit: victim is in their own attack startup.
      if (p.attackTimer > 0 && p.moveId && MOVE_TABLE[p.moveId]) {
        const pDur = MOVE_TABLE[p.moveId].dur;
        const pPhase = 1 - p.attackTimer / pDur;
        if (pPhase < 0.5) {
          dmg *= 1.3;
          stun *= 1.3;
        }
      }

      // Juggle scaling: air-light hits onto launched victim do less.
      if (p.juggled && m.type === 'airLight') {
        dmg *= 0.6;
        kbX *= 0.5;
        kbY *= 0.5;
      }

      const launch = !!m.launch && !superPunch;  // super already mega-launches
      p.takeDamage(dmg, {
        attacker: this,
        weapon: superPunch ? 'super' : (gumGum ? 'gumgum' : 'fist'),
        kb: { x: kbX, y: kbY },
        stun,
        launch: launch || superPunch,
      });
      this.attackHits.add(p.id);

      // Upward-launcher → start juggle on victim.
      if (m.launch && (id === 'heavyUp' || id === 'airHeavyU')) {
        p.juggled = true;
        p.juggledUntil = performance.now() + 1200;
        p.juggleHits = 0;
        p.juggleStartedAt = performance.now();
      }
      if (p.juggled) {
        p.juggleHits++;
        if (p.juggleHits >= 4) p.juggled = false;
        else {
          const JUGGLE_HIT_EXTEND_MS = 400;
          const JUGGLE_MAX_MS = 1200;
          p.juggledUntil = Math.min(
            (p.juggleStartedAt || performance.now()) + JUGGLE_MAX_MS,
            p.juggledUntil + JUGGLE_HIT_EXTEND_MS
          );
        }
      }

      // Contact feedback — fires once per fresh hit, tiered by move class.
      // Capped per _attackTick by tracking which feedback already fired this
      // call so chained hits (rare; same swing rarely hits 2 targets) don't
      // stack hitstop or camera punch on top of each other.
      if (!superPunch) {
        const tier = m.launch ? 'launcher' : (m.type === 'heavy' || m.type === 'airHeavy') ? 'heavy' : 'light';
        // Bright contact flash on both attacker and victim — the "I just
        // connected" cue that the press flash can't sell on its own.
        const flashLvl = tier === 'launcher' ? 0.70 : tier === 'heavy' ? 0.60 : 0.45;
        this.flashAmount = Math.max(this.flashAmount, flashLvl * 0.7);
        p.flashAmount = Math.max(p.flashAmount, flashLvl);
        this.rig?.hitImpact(tier);
        p.rig?.hitImpact(tier);

        if (!this._feedbackFiredThisSwing && this.game) {
          // Hitstop: lights are skipped (PR #32 lesson — per-strike pauses
          // stacked through chains feel like FPS drops). Heavies and
          // launchers keep meaningful but short pauses.
          const stopMs = tier === 'launcher' ? 0.08 : tier === 'heavy' ? 0.04 : 0;
          if (stopMs > 0) this.game.hitStop?.(stopMs);
          // Camera punch: lights skip entirely (PR #32 again). Heavies and
          // launchers get a single small kick that fx.camera.punch already
          // clamps at 1.2 so chains can't blow it out.
          if ((tier === 'heavy' || tier === 'launcher') && this.game.fx?.camera?.punch) {
            const punch = tier === 'launcher' ? 0.14 : 0.08;
            this.game.fx.camera.punch(punch);
          }
          // Particles: lower counts so chain bursts stay cheap. The hit
          // squash + flash on the rig sells contact even without sparks.
          if (this.game.fx?.particles) {
            const count = tier === 'launcher' ? 8 : tier === 'heavy' ? 5 : 3;
            const speed = tier === 'launcher' ? 8 : tier === 'heavy' ? 6 : 4;
            // Burst at impact point (between attacker fist and victim center)
            // so the spark reads as the hit, not as ambient body dust.
            this.game.fx.particles.burst(
              cx + (p.position.x - cx) * 0.4,
              cy + (p.position.y - cy) * 0.4,
              0,
              { count, speed, color: 0xffeecc }
            );
          }
          this._feedbackFiredThisSwing = true;
        }
      }

      if (superPunch && this.game?.fx) {
        this.game.fx.particles.burst(p.position.x, p.position.y, 0, { count: 22, speed: 12, color: 0xffcc33 });
        this.game.fx.camera.punch(0.45);
        this.game.hitStop?.(0.1);
      }
    }

    // Projectile reflection (was in old _attackTick — preserve).
    if (this.game?.projectiles) {
      for (const pr of this.game.projectiles) {
        if (pr.dead || pr.owner === this) continue;
        if (!pr.body || pr.stuck) continue;
        const dx = pr.body.position.x - cx;
        const dy = pr.body.position.y - cy;
        if (dx * dx + dy * dy < 0.9 * 0.9) {
          pr.body.velocity.x = -pr.body.velocity.x * 1.2 + this.facing * 4;
          pr.body.velocity.y = Math.abs(pr.body.velocity.y) * 0.6 + 4;
          pr.owner = this;
          this.game.fx.particles.burst(pr.body.position.x, pr.body.position.y, 0, { count: 8, speed: 6, color: 0xffffff });
          this.game.fx.camera.punch(0.06);
        }
      }
    }

    // Chain severance (preserve).
    const chainSegs = this.game?.level?._chainSegs;
    if (chainSegs?.size) {
      for (const seg of [...chainSegs]) {
        if (!seg || seg.dead || !seg.body) continue;
        const body = seg.body;
        if (!body.velocity || !body.position) continue;
        const key = `chain_${body.id}`;
        if (this.attackHits.has(key)) continue;
        const dxs = body.position.x - cx;
        const dys = body.position.y - cy;
        if (dxs * dxs + dys * dys >= radius * radius) continue;
        this.attackHits.add(key);
        body.velocity.x += this.facing * 4;
        body.velocity.y += 2;
        seg.damage(baseDmg * 0.5, this);
      }
    }
  }

  // Find the planet whose pull on this body is strongest right now. Returns
  // null if nothing is exerting meaningful gravity (deep space).
  // Pick the player's currently-influencing planet. Must match the model
  // used by PlanetGravity.js: inverse-LINEAR field (a = G*M/r), single
  // dominant by closest center within halo. The two have to agree or the
  // body rotation (driven by this lookup) and the gravity force (driven by
  // PlanetGravity's lookup) target different planets and the rig snaps.
  _currentPlanet() {
    const planets = this.game?.level?.planets;
    if (!planets || !planets.length) return null;
    let best = null, bestD2 = Infinity;
    for (const p of planets) {
      const dx = p.cx - this.body.position.x;
      const dy = p.cy - this.body.position.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > p.haloRadius * p.haloRadius) continue;
      if (d2 < bestD2) { bestD2 = d2; best = p; }
    }
    return best;
  }

  _move(dt) {
    const now = performance.now();
    const frozen = now < this._frozenUntil;
    const moveX = frozen ? 0 : this.input.moveX;
    const boosted = now < this.speedBoostUntil;
    const flying = now < this.flightUntil;
    const crouchInput = !flying && this.grounded && this.input.moveY < -0.4;

    // SLIDE — running + press crouch with momentum.
    const speedAbs = Math.abs(this.body.velocity.x);
    if (crouchInput && speedAbs > 4 && this.grounded) this.sliding = true;
    if (this.sliding && (speedAbs < 1.4 || !crouchInput || !this.grounded)) this.sliding = false;

    this.crouching = crouchInput && !this.sliding;

    if (this.sliding) {
      // Coast on momentum — slow decay, no input acceleration.
      this.body.velocity.x *= Math.pow(0.55, dt);
      // Block further accel below by skipping the rest of _move's velocity write.
      // Variable jump cut + flight branches still run after.
      // Jumps cancel slide.
      const tNowSlide = performance.now();
      const inSlideCD = tNowSlide < (this._jumpInputCooldown || 0);
      if (this.input.jumpPressed && this.grounded && !inSlideCD) {
        if (this.charging) this._clearCombatState();
        this.sliding = false;
        this.body.velocity.y = 9.5;
        this.coyote = 0;
        this.grounded = false;
        this.prevGrounded = false;
        this._jumpLockUntil = tNowSlide + 120;
        this._jumpInputCooldown = tNowSlide + 90;
        audio.jump();
        if (this === this.game?.localPlayer) vibrate(12);
      }
      // Skip the standard accel/friction block.
      if (!this.input.jump && this.body.velocity.y > 4) this.body.velocity.y = 4 + (this.body.velocity.y - 4) * Math.pow(0.05, dt);
      // Aim/facing still update below.
      if (this.input.aimActive && !!this.weapon?.aimWeapon) {
        this.facing = this.input.aimX >= 0 ? 1 : -1;
      }
      return;
    }

    if (this.game?.level?.curvedGravity) {
      const planet = this._currentPlanetRef;
      if (planet) {
        const dx = this.body.position.x - planet.cx;
        const dy = this.body.position.y - planet.cy;
        const r = Math.hypot(dx, dy) || 1;
        const ux = dx / r, uy = dy / r;
        const tx = -uy, ty = ux;            // CCW perpendicular
        const vT = this.body.velocity.x * tx + this.body.velocity.y * ty;
        const vR = this.body.velocity.x * ux + this.body.velocity.y * uy;
        // Walk speed cap is below the orbital-velocity threshold (sqrt(g*r))
        // so tangential motion can never out-run gravity and lift the
        // capsule off the surface. For r=5 with g≈8: orbital v ≈ 6.3, so
        // capping ground walk to 4 leaves a comfortable margin.
        const speedMaxC = this.crouching ? 2.0 : (boosted ? 6 : (flying ? 7 : 4.0));
        const accelC = this.grounded ? (boosted ? 65 : 45) : (flying ? 36 : 18);
        const targetT = moveX * speedMaxC;
        // Stick-to-ground: when grounded, kill any outward radial velocity so
        // microbumps from collider edges don't accumulate into a launch. Lets
        // gravity hold the capsule.
        const vRGrounded = this.grounded ? Math.min(vR, 0) : vR;
        const dvT = targetT - vT;
        const stepT = clamp(dvT, -accelC * dt, accelC * dt);
        const newVT = vT + stepT;
        this.body.velocity.x = newVT * tx + vRGrounded * ux;
        this.body.velocity.y = newVT * ty + vRGrounded * uy;
        if (this.grounded && Math.abs(moveX) < 0.05) {
          const k = Math.pow(0.001, dt);
          this.body.velocity.x *= k;
          this.body.velocity.y *= k;
        }
        if (Math.abs(newVT) > 0.2) this.facing = Math.sign(newVT) || this.facing;

        // Jump — apply impulse along radial up (ux, uy). Mirrors the flat-gravity
        // jump logic but oriented to the planet surface. `jumpPressed` is set
        // by the input layer; coyote + air-jump rules are the same as flat.
        const now = this.input;
        const wantJump = now.jumpPressed && performance.now() >= (this._jumpInputCooldown || 0);
        // jumpSpeed tuned for ~12 m/s² surface gravity (Outer Wilds inverse-linear
        // model). Height = v²/(2g) = 64/24 ≈ 2.7m — about half a planet radius.
        const jumpSpeed = 8;
        if (wantJump) {
          if (this.grounded || this.coyote > 0) {
            if (this.charging) this._clearCombatState();
            // Replace radial component with jumpSpeed outward; preserve tangential.
            const newVR = jumpSpeed;
            this.body.velocity.x = newVT * tx + newVR * ux;
            this.body.velocity.y = newVT * ty + newVR * uy;
            this.coyote = 0;
            this._jumpLockUntil = performance.now() + 80;
            this._jumpInputCooldown = performance.now() + 120;
            audio.jump?.();
            if (this === this.game?.localPlayer) vibrate(12);
            this.grounded = false;
          } else if (this.airJumpsLeft > 0) {
            if (this.charging) this._clearCombatState();
            this.airJumpsLeft--;
            const newVR = jumpSpeed * 0.95;
            this.body.velocity.x = newVT * tx + newVR * ux;
            this.body.velocity.y = newVT * ty + newVR * uy;
            this._jumpLockUntil = performance.now() + 80;
            this._jumpInputCooldown = performance.now() + 120;
            audio.jump?.();
          }
        }
        return;
      }
      // No planet captured — leave gravity preStep to handle drift, no walk control.
      return;
    }

    let speedMax = this.crouching ? 2.5 : (boosted ? 9 : (flying ? 7 : 6.5));
    let accel = this.grounded ? (boosted ? 65 : 45) : (flying ? 36 : 18);
    // Heavy carry penalty — grabbing a crate (or anything mass > 4) slows
    // the wielder. Scales gently so a 1×1 crate (~7kg) is a noticeable
    // drag and the precariously-perched 1.2× heavy crates (~14kg) feel
    // like real lifting work.
    const grabbedMass = this.grabbing?.mass ?? 0;
    if (grabbedMass > 4) {
      const carryFactor = 10 / (10 + (grabbedMass - 4));
      speedMax *= carryFactor;
      accel *= carryFactor;
    }
    const targetVx = moveX * speedMax;
    const dvx = targetVx - this.body.velocity.x;
    const maxDelta = accel * dt;
    this.body.velocity.x += clamp(dvx, -maxDelta, maxDelta);

    // Friction when no input
    if (this.grounded && Math.abs(moveX) < 0.05) {
      this.body.velocity.x *= Math.pow(0.001, dt); // strong friction
    }

    // Facing: follows movement direction by default. Aim takes over when the
    // player is wielding ANY weapon (melee or ranged) so the swing arm and
    // body face wherever the player is aiming.
    const aimDriving = this.input.aimActive && !!this.weapon;
    if (aimDriving) {
      this.facing = this.input.aimX >= 0 ? 1 : -1;
    } else if (Math.abs(moveX) > 0.2) {
      this.facing = sign(moveX);
    }

    // Jumps — input cooldown prevents spam from double-firing within a frame
    // and stabilizes the landing-and-immediately-jump-again case.
    const tNowJump = performance.now();
    const inJumpCD = tNowJump < (this._jumpInputCooldown || 0);
    if (this.input.jumpPressed && !inJumpCD) this.jumpBuffer = 0.12;
    if (this.jumpBuffer > 0 && !inJumpCD && (this.coyote > 0 || this.grounded)) {
      if (this.charging) this._clearCombatState();
      this.body.velocity.y = 11;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
      this.prevGrounded = false;
      this._jumpLockUntil = tNowJump + 120;
      this._jumpInputCooldown = tNowJump + 90;
      audio.jump();
      if (this === this.game?.localPlayer) vibrate(12);
    } else if (this.input.jumpPressed && !inJumpCD && this.airJumpsLeft > 0 && !this.grounded) {
      if (this.charging) this._clearCombatState();
      this.body.velocity.y = 10;
      this.airJumpsLeft--;
      this._jumpLockUntil = tNowJump + 100;
      this._jumpInputCooldown = tNowJump + 90;
      audio.jump();
    }
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;

    // Variable jump height: cut velocity if jump released early
    if (!flying && !this.input.jump && this.body.velocity.y > 4) {
      this.body.velocity.y = 4 + (this.body.velocity.y - 4) * Math.pow(0.05, dt);
    }

    // FLIGHT — disable gravity for this body and drive vy from input.
    if (flying) {
      this.body.setGravityScale?.(0);
      if (this.input.jump) this.body.velocity.y = clamp(this.body.velocity.y + 30 * dt, -4, 7);
      else if (this.input.moveY < -0.3) this.body.velocity.y = -4;
      else this.body.velocity.y = damp(this.body.velocity.y, 0, 0.0001, dt);
    } else if (this._wasFlying) {
      this.body.setGravityScale?.(1);
    }
    this._wasFlying = flying;
  }

  _carryGrabbedFollow() {
    // When holding another stickman, position the constraint anchor in front of us.
    if (!this.grabConstraint) return;
    // Throw windup lifts the held body up-and-behind the shoulder so the
    // physical body matches the rig's rear-back arm pose. Without this the
    // body floats in front while the rig pulls back — looks disconnected.
    const w = this._throwWindupT > 0 ? clamp(1 - this._throwWindupT / 0.10, 0, 1) : 0;
    const px = lerp(this.facing * 0.7, -this.facing * 0.35, w);
    const py = lerp(0.2, 1.0, w);
    this.grabConstraint.pivotA.set(px, py, 0);
    // Force the victim's visual facing to point at the grabber so the
    // grip reads as "I'm holding you" instead of "we both face the same way."
    const sm = this.grabbing?.userData?.stickman;
    if (sm) sm.facing = -this.facing;
  }

  update(dt, ctx) {
    this._dt = dt;
    const { players, level } = ctx;

    if (this.state === STATE.DEAD) {
      this.deathTimer -= dt;
      this.body.angularVelocity.z += dt * (Math.random() - 0.5) * 0.5;
      this.flashAmount = damp(this.flashAmount, 0, 0.001, dt);
      return;
    }

    if (this.state === STATE.GRABBED) {
      // Struggle handled by grabber — body driven by constraint.
      return;
    }

    // Fire one-shot edges (suppressed when frozen).
    const now = this.input;
    const frozen = performance.now() < this._frozenUntil;
    now.jumpPressed = !frozen && now.jump && !this._prev.jump;
    now.attackPressed = !frozen && now.attack && !this._prev.attack;
    now.attackReleased = !frozen && !now.attack && this._prev.attack;
    if (now.attackPressed) this._attackPressedAt = performance.now();
    now.attackHeldFor = now.attack
      ? (performance.now() - this._attackPressedAt) / 1000
      : 0;
    now.grabPressed = !frozen && now.grab && !this._prev.grab;
    now.specialPressed = !frozen && now.special && !this._prev.special;
    now.throwPressed = !frozen && now.throw && !this._prev.throw;
    this._prev.jump = now.jump;
    this._prev.attack = now.attack;
    this._prev.grab = now.grab;
    this._prev.special = now.special;
    this._prev.throw = now.throw;

    if (this.invuln > 0) this.invuln -= dt;
    if (this.hitstun > 0) { this.hitstun -= dt; }
    if (this.climbCooldown > 0) this.climbCooldown -= dt;
    this.flashAmount = damp(this.flashAmount, 0, 0.001, dt);

    // Burn DoT
    const tNow = performance.now();
    if (tNow < this._burnUntil) {
      if (tNow - this._burnTickAt > 350) {
        this._burnTickAt = tNow;
        this.takeDamage(5, { attacker: this._burnSrc, weapon: 'flame' });
        if (this.game?.fx) this.game.fx.particles.spark.spawn({
          x: this.position.x + (Math.random() - 0.5) * 0.4,
          y: this.position.y + Math.random() * 0.6,
          z: 0, vx: 0, vy: rand(2, 4), life: 0.5, size: 0.18,
          color: rand() < 0.5 ? 0xff5500 : 0xffaa33, gravity: -2, drag: 0.7, shrink: 1,
        });
      }
    }

    this.prevGrounded = this.grounded;
    this._updateGroundCheck();

    // Climbing logic — body stays DYNAMIC so floor/ceiling collisions work.
    if (this.climbing) {
      if (!this.input.grab) {
        this.releaseClimb();
      } else {
        // Climbing: disable gravity for this body, drive vy from input.
        this.body.setGravityScale?.(0);
        this.body.velocity.x = 0;
        this.body.velocity.y = this.input.moveY * 4;
        if (this.input.jumpPressed) {
          this.releaseClimb();
          this.body.velocity.y = 11;
          this.body.velocity.x = -this.facing * 6;
          audio.jump();
        }
      }
    } else if (this.hitstun <= 0) {
      this._move(dt);

      // Grab vs release. Pressing grab opens a 160ms reach window — the arm
      // stays extended and we keep checking for targets so a sloppy timing
      // still connects (Stick-Fight-style "stuffed grab").
      if (now.grabPressed && !this.grabbing && this._throwWindupT <= 0) {
        this._tryGrab(this.world, players);
        if (!this.grabbing) this.grabReachTimer = 0.16;
      } else if (this.grabReachTimer > 0 && !this.grabbing && this.input.grab) {
        this._tryGrab(this.world, players);
        this.grabReachTimer -= dt;
      } else if (!this.input.grab && this.grabbing && this._throwWindupT <= 0) {
        // Release. Aim direction takes priority, then movement, else facing.
        const aimX = this.input.aimActive ? this.aimDir.x : 0;
        const aimY = this.input.aimActive ? this.aimDir.y : 0;
        const useAim = (aimX !== 0 || aimY !== 0);
        const dx = useAim ? aimX : this.input.moveX;
        const dy = useAim ? aimY : this.input.moveY;
        const directed = (dx * dx + dy * dy) > 0.05;
        if (!directed) {
          // Soft drop — no windup, immediate release.
          this.releaseGrab(0, 0);
          audio.click();
        } else {
          // Throw — telegraph rear-back arm, then release with force on completion.
          const power = 16;
          this._throwWindupVx = (Math.abs(dx) > 0.05 ? dx : this.facing) * power;
          this._throwWindupVy = (Math.abs(dy) > 0.05 ? dy * power : 0.4 * power) + 5;
          this._throwWindupT = 0.10;
        }
      }
      if (!this.input.grab) this.grabReachTimer = 0;

      if (this.grabbing) this._carryGrabbedFollow();

      // Attack
      if (now.attackPressed) this._doAttack();
      this._chargeTick(dt);

      // Special / weapon alt fire / force powers.
      if (now.specialPressed) {
        const tNow = performance.now();
        let didFire = false;
        if (this._forceCooldown <= 0) {
          if (tNow < this.forcePushUntil) { this._forcePush(); this._forceCooldown = 0.7; didFire = true; }
          else if (tNow < this.forcePullUntil) { this._forcePull(); this._forceCooldown = 0.7; didFire = true; }
          else if (tNow < this.forceLightningUntil) { this._forceLightning(); this._forceCooldown = 0.4; didFire = true; }
          else if (tNow < this.forceChokeUntil) { this._forceChoke(); this._forceCooldown = 1.0; didFire = true; }
          else if (this.weapon?.altFire) { this.weapon.altFire(this); didFire = true; }
        } else if (this.weapon?.altFire && performance.now() >= this.forcePushUntil && performance.now() >= this.forcePullUntil) {
          this.weapon.altFire(this);
          didFire = true;
        }
        if (didFire && this === this.game?.localPlayer) vibrate(40);
      }
      if (this._forceCooldown > 0) this._forceCooldown -= dt;

      // Throw held weapon as a projectile.
      if (now.throwPressed && this.weapon) this._throwWeapon();
    }
    // Throw windup countdown — when 0, fire the queued throw.
    if (this._throwWindupT > 0) {
      this._throwWindupT -= dt;
      if (this._throwWindupT <= 0) {
        this._throwWindupT = 0;
        if (this.grabbing) {
          const target = this.grabbing;
          const sm = target.userData?.stickman;
          const tx = this._throwWindupVx, ty = this._throwWindupVy;
          this.releaseGrab(tx, ty);
          if (sm) sm.applyKnockback(tx, ty, 0.45);
          audio.swing();
        }
      }
    }
    if (this.chainTimer > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) this.chainStep = 0;
    }
    // Reset air chain on landing.
    if (this.grounded && !this.prevGrounded) {
      this.airChainStep = 0;
    }
    // Clear juggle on touchdown or timeout.
    if (this.juggled && (this.grounded || performance.now() > this.juggledUntil)) {
      this.juggled = false;
      this.juggleHits = 0;
    }
    // Attack timing always ticks (so swing finishes even if hit).
    this._attackTick(dt, players);

    // Aim direction (used by rig & weapons)
    if (this.input.aimActive) {
      this.aimDir.set(this.input.aimX, this.input.aimY).normalize();
    } else {
      this.aimDir.set(this.facing, 0);
    }

    // Kill box — instakill when launched outside the play area.
    if (this.position.y < -16 || this.position.y > 32 || Math.abs(this.position.x) > 30) {
      const px = this.position.x;
      this.die('void');
      // Freeze ragdoll and park it far below the play area until respawn.
      // Previously teleported to (0,5,0), which put the visible corpse
      // smack in the middle of the map during the 1.6s death timer.
      this.body.velocity.setZero();
      this.body.angularVelocity.setZero();
      this.body.position.set(px, -200, 0);
    }

    if (this.game?.level?.curvedGravity) {
      this._updateBodyRotation(dt);
    }
  }

  // Continuously slerp the capsule body's quaternion so its local +Y axis
  // points away from the current planet's center. Outside any halo, body
  // settles back toward world up. Z-axis lock in PhysicsWorld.postStep
  // keeps rotation strictly in-plane (no pitch/yaw).
  _updateBodyRotation(dt) {
    // Visual-only rotation. The physics body stays upright (fixedRotation=true);
    // we just slerp `_visualAngle` toward the planet-up angle and use it in
    // _syncRig to orient the rig group. Decoupling visual from physics
    // eliminates the capsule-subshape contact instability that caused
    // "flinging" on curved planets.
    const planet = this._currentPlanetRef;
    let targetAngle = 0;
    if (planet) {
      const dx = this.body.position.x - planet.cx;
      const dy = this.body.position.y - planet.cy;
      targetAngle = Math.atan2(dy, dx) - Math.PI / 2;
    }
    const cur = this._visualAngle ?? 0;
    let delta = targetAngle - cur;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const rate = 8;
    const step = clamp(delta, -rate * dt, rate * dt);
    this._visualAngle = cur + step;
  }

  _syncRig(dt, ragdoll) {
    // Aim pose drives the right arm whenever a weapon is held (so melee arms
    // also extend toward the aim direction, not just ranged). Falls back to
    // the original ranged-only behavior when unarmed.
    const rangedAim = this.weapon?.poseRight === 'aim';
    const meleeAim = !!this.weapon && this.input.aimActive && !rangedAim;
    const aimPose = rangedAim || meleeAim;
    const armPoseR =
      this.attackTimer > 0 ? 'attack' :
      aimPose ? 'aim' :
      this.grabbing ? 'hold' :
      this.input.grab ? 'grab' : 'walk';
    // Two-hand grip — left arm also aims while ranged weapon is held.
    const armPoseL =
      aimPose ? 'aim' :
      this.weapon?.poseLeft === 'support' ? 'aim' :
      this.grabbing ? 'hold' :
      this.input.grab ? 'grab' : 'walk';

    let holdPos = null;
    if (this.grabbing) {
      holdPos = this._rigHoldPos.set(this.grabbing.position.x, this.grabbing.position.y, this.grabbing.position.z);
    }
    const aim = this._rigAim;
    aim.x = this.aimDir.x; aim.y = this.aimDir.y;

    // Ragdoll factor: dead, grabbed, hitstun
    let ragAmt = 0;
    if (this.state === STATE.DEAD) ragAmt = 1;
    else if (this.state === STATE.GRABBED) ragAmt = 0.7;
    else if (this.hitstun > 0) ragAmt = clamp(this.hitstun * 1.5, 0, 0.6);

    const gumGum = performance.now() < this.gumGumUntil;
    // When dead OR on a curved-gravity level, draw limbs in LOCAL space
    // (origin) — group transform carries world pos+rot so the rig follows
    // the capsule's planet-aligned rotation. Flat levels keep the
    // existing world-space rig path (`identity` group + absolute coords).
    const rigInLocal = this.state === STATE.DEAD || !!this.game?.level?.curvedGravity;
    const rigPos = rigInLocal ? { x: 0, y: 0, z: 0 } : this.body.position;
    const stepDur = this.moveId && MOVE_TABLE[this.moveId]
      ? MOVE_TABLE[this.moveId].dur
      : (this._attackStep === 0 ? 0.18 : this._attackStep === 1 ? 0.22 : 0.30);
    const params = this._rigParams;
    params.moveX = this.body.velocity.x / 5.5;
    params.vy = this.body.velocity.y;
    params.grounded = this.grounded;
    params.facing = this.facing;
    params.attack = this.attackTimer > 0;
    params.attackProgress = this.attackTimer > 0 ? 1 - this.attackTimer / stepDur : 0;
    params.attackStep = this._attackStep;
    params.kicking = this.kicking;
    params.moveId = this.moveId;
    params.armPoseR = armPoseR;
    params.armPoseL = armPoseL;
    params.holdPos = holdPos;
    params.aim = aim;
    params.crouching = this.crouching;
    params.sliding = this.sliding;
    params.prone = this.crouching && !this.sliding;
    params.ragdollAmount = ragAmt;
    params.gumGumPunch = gumGum && this.attackTimer > 0 && !this.weapon;
    params.throwWindup = this._throwWindupT > 0 ? clamp(1 - this._throwWindupT / 0.10, 0, 1) : 0;
    params.angVz = this.body.angularVelocity?.z || 0;
    params.dt = dt;
    this.rig.update(rigPos, params);

    if (rigInLocal) {
      // Group carries body's transform; limbs are in local space.
      // For curved-gravity levels the physics body stays upright (locked
      // rotation) — the visual angle comes from `_visualAngle` slerped
      // toward planet-up in `_updateBodyRotation`. For ragdoll mode we
      // use the actual body quaternion (Rapier integrates spin then).
      const p = this.body.position;
      this.rig.group.position.set(p.x, p.y, p.z);
      if (this.state === STATE.DEAD) {
        const q = this.body.quaternion;
        this.rig.group.quaternion.set(q.x, q.y, q.z, q.w);
      } else {
        this.rig.group.quaternion.setFromAxisAngle(_RIG_Z_AXIS, this._visualAngle ?? 0);
      }
    } else {
      this.rig.group.quaternion.identity();
      this.rig.group.position.set(0, 0, 0);
    }

    // weapon mesh sync
    if (this.weapon) this.weapon.updateMesh(this);

    this.rig.setFlash(this.flashAmount);
    this.rig.setArmor?.(this.armor);

    // Invulnerability flicker / invisibility
    const tNow = performance.now();
    const invisible = tNow < this.invisibleUntil;
    if (invisible) {
      this.rig.material.transparent = true;
      this.rig.material.opacity = 0.18;
      this.rig.group.visible = true;
    } else if (this.invuln > 0 && this.state !== STATE.DEAD) {
      this.rig.group.visible = Math.floor(tNow / 80) % 2 === 0;
      if (this.rig.material.transparent) { this.rig.material.opacity = 1; this.rig.material.transparent = false; }
    } else {
      this.rig.group.visible = true;
      if (this.rig.material.transparent) { this.rig.material.opacity = 1; this.rig.material.transparent = false; }
    }
  }

  _updateNameTag() {
    if (!this.nameSprite) return;
    this.nameSprite.position.set(this.position.x, this.position.y + 1.5, this.position.z);
    this.nameSprite.visible = this.state !== STATE.DEAD;
  }

  destroy() {
    if (this._corpseHitFn) {
      try { this.body.removeEventListener('collide', this._corpseHitFn); } catch (_) {}
      this._corpseHitFn = null;
    }
    this.world.remove(this.body);
    this.scene.remove(this.rig.group);
    if (this.nameSprite) this.scene.remove(this.nameSprite);
    if (this.weapon) this.weapon.destroy();
  }
}
