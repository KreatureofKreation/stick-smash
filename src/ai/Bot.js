// Behavior-tree-ish bot. Picks a target, navigates toward weapons/pickups, attacks when in range, dodges hazards.
import { rand, sign, clamp } from '../util/math.js';

export class Bot {
  constructor(stickman) {
    this.sm = stickman;
    this.target = null;
    this.goal = null;
    this.goalKind = 'idle';
    this.replanTimer = 0;
    this.attackTimer = 0;
    this.jumpTimer = 0;
    this.aimNoise = 0;
    this.skill = rand(0.6, 1.0);
    // Personality knobs — variation between bots.
    this.aggression = rand(0.4, 1.0);   // affects engage distance
    this.fleeThreshold = rand(20, 35);  // health below which they flee
    this.dodgeTimer = 0;
    this.dodgeDir = 0;
    this.grabCooldown = 0;
    this._chargeHoldUntil = 0;
    this._lastLightAt = 0;
    this._slideKickPressAt = 0;   // 0 = not armed; else = perf.now() ms after which to press attack
  }

  _findTarget(players) {
    let best = null, bestD2 = Infinity;
    const now = performance.now();
    for (const p of players) {
      if (!p || p === this.sm || !p.alive) continue;
      // Lose lock on invisible players ~70% of the time.
      if (now < p.invisibleUntil && Math.random() < 0.7) continue;
      const dx = p.position.x - this.sm.position.x;
      const dy = p.position.y - this.sm.position.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = p; }
    }
    return best;
  }

  _findGoal(weapons, pickups) {
    // Pick weapon if currently unarmed
    if (!this.sm.weapon) {
      let best = null, bestD2 = Infinity;
      for (const w of weapons) {
        if (!w || w.holder || w.dead) continue;
        const x = w.body?.position.x ?? w.mesh.position.x;
        const y = w.body?.position.y ?? w.mesh.position.y;
        const dx = x - this.sm.position.x, dy = y - this.sm.position.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = { x, y, kind: 'weapon' }; }
      }
      if (best && bestD2 < 200) return best;
    }
    // Pick health if low
    if (this.sm.health < 50) {
      for (const p of pickups) {
        if (!p || p.dead || p.kind !== 'pickup-health') continue;
        return { x: p.x, y: p.y, kind: 'pickup' };
      }
    }
    return null;
  }

  _avoidHazards(level) {
    let avoidX = 0;
    for (const h of level.hazards) {
      if (h.kind === 'lava') continue; // lava is large; only flee if directly above
      const dx = this.sm.position.x - (h.body?.position.x ?? 0);
      const dy = this.sm.position.y - (h.body?.position.y ?? 0);
      const d = Math.hypot(dx, dy);
      if (d < 2.5) avoidX += sign(dx) * (1 - d / 2.5) * 1.2;
    }
    return clamp(avoidX, -1, 1);
  }

  update(dt, ctx) {
    const { players, weapons, pickups, level } = ctx;
    const sm = this.sm;
    if (!sm.alive) {
      // Reset inputs while dead so we don't fire-spam during respawn
      sm.input.moveX = 0; sm.input.moveY = 0;
      sm.input.jump = false; sm.input.attack = false; sm.input.grab = false; sm.input.special = false;
      return;
    }

    this.replanTimer -= dt;
    if (this.replanTimer <= 0) {
      this.target = this._findTarget(players);
      this.goal = this._findGoal(weapons, pickups);
      this.replanTimer = rand(0.5, 1.2);
    }

    let desiredX = 0, desiredY = null, jump = false, grab = false, attack = false, special = false;
    let aimX = sm.facing, aimY = 0, aimActive = false;

    // Flee if low HP — back off from target.
    const lowHp = sm.health < this.fleeThreshold;

    let destX, destY;
    if (this.goal) { destX = this.goal.x; destY = this.goal.y; }
    else if (this.target) {
      const w = sm.weapon;
      const isRanged = w && (w.aimWeapon || w.kind === 'ranged');
      let idealDist;
      if (lowHp) idealDist = 12; // run away
      else idealDist = isRanged ? rand(4, 8) : rand(0.6, 1.2) * (1 + (1 - this.aggression) * 0.5);
      const dx = this.target.position.x - sm.position.x;
      const dir = sign(dx);
      destX = this.target.position.x - dir * idealDist;
      destY = this.target.position.y;
    } else {
      destX = sm.position.x;
      destY = sm.position.y;
    }

    // Dodge: if target is aiming a ranged weapon at us, occasionally sidestep.
    if (this.target?.weapon?.aimWeapon && Math.random() < dt * 0.7) {
      this.dodgeTimer = rand(0.25, 0.5);
      this.dodgeDir = Math.random() < 0.5 ? -1 : 1;
    }
    let dodgeNudge = 0;
    if (this.dodgeTimer > 0) {
      this.dodgeTimer -= dt;
      dodgeNudge = this.dodgeDir;
    }

    // Move toward dest X (+ dodge nudge for evasion).
    const dx = destX - sm.position.x;
    desiredX = clamp(dx * 0.6 + dodgeNudge * 0.6, -1, 1);
    if (Math.abs(dx) < 0.4 && !dodgeNudge) desiredX = 0;

    // Avoid hazards
    desiredX += this._avoidHazards(level) * 0.8;
    desiredX = clamp(desiredX, -1, 1);

    // Smarter obstacle reasoning: peek at wall height ahead.
    const dy = destY - sm.position.y;
    const wallH = this._wallHeight(level, desiredX);
    const gapAhead = !this._hasGroundBelow(level, sign(desiredX) * 0.7);

    // Self-preservation — if there's a gap ahead, only commit to the leap if
    // we can see ground on the far side (within jump range). Otherwise stop or
    // back off so we don't yeet ourselves into the void.
    let mustCommitJump = false;
    if (sm.grounded && gapAhead && Math.abs(desiredX) > 0.05) {
      const dirSign = sign(desiredX);
      let landingDx = -1;
      for (let probe = 1.5; probe <= 4; probe += 0.5) {
        if (this._hasGroundBelow(level, dirSign * probe)) { landingDx = probe; break; }
      }
      if (landingDx < 0) {
        // No reachable platform — refuse the leap, back away from the edge.
        desiredX = -dirSign * 0.4;
      } else {
        // Reachable — commit, queue a jump regardless of jumpTimer cooldown.
        mustCommitJump = true;
      }
    }

    // Jump over single-tile walls and small vertical gaps.
    if (sm.grounded && (dy > 0.8 || wallH === 1 || mustCommitJump)) {
      this.jumpTimer -= dt;
      if (this.jumpTimer <= 0) { jump = true; this.jumpTimer = rand(0.2, 0.5); }
    }
    // Tall wall ahead — turn around.
    if (sm.grounded && wallH >= 2 && Math.abs(dx) > 0.3) {
      desiredX = -sign(desiredX);
    }
    // Mid-air: if falling toward void with no platform ahead, try to claw back
    // with an air jump. Bots have airJumps too.
    if (!sm.grounded && sm.body.velocity.y < -1 && sm.airJumpsLeft > 0) {
      const px = sm.position.x;
      const py = sm.position.y;
      // Look straight down for any nearby ground within fall distance.
      let groundClose = false;
      for (let yProbe = 0; yProbe < 8; yProbe++) {
        if (this._tileAt(level, px, py - 1 - yProbe)) { groundClose = true; break; }
      }
      if (!groundClose) {
        // Falling into nothing — burn an air jump, then steer toward closest tile.
        this.jumpTimer -= dt;
        if (this.jumpTimer <= 0) { jump = true; this.jumpTimer = rand(0.3, 0.6); }
        // Also pick recovery direction toward nearest ground.
        let bestDir = 0, bestD = Infinity;
        for (let probe = 1; probe <= 8; probe++) {
          if (this._tileAt(level, px + probe, py - 1) && probe < bestD) { bestD = probe; bestDir = 1; }
          if (this._tileAt(level, px - probe, py - 1) && probe < bestD) { bestD = probe; bestDir = -1; }
        }
        if (bestDir !== 0) desiredX = bestDir;
      }
    }
    // Stuck detection: low velocity, far from goal — random hop + occasional reverse.
    if (sm.grounded && Math.abs(sm.body.velocity.x) < 0.5 && Math.abs(dx) > 0.5) {
      if (rand() < dt * 2) jump = true;
      this._stuckTimer = (this._stuckTimer || 0) + dt;
      if (this._stuckTimer > 0.8) {
        desiredX = -desiredX;
        this._stuckTimer = 0;
      }
    } else {
      this._stuckTimer = 0;
    }

    // Grab logic: bots try to grab when up close and either unarmed or have melee.
    if (this.grabCooldown > 0) this.grabCooldown -= dt;
    if (this.target) {
      const d = Math.hypot(this.target.position.x - sm.position.x, this.target.position.y - sm.position.y);
      const w = sm.weapon;
      const wantGrab = !sm.grabbing && d < 0.9 && this.grabCooldown <= 0
        && (!w || (!w.aimWeapon && Math.random() < 0.35));
      if (wantGrab) {
        grab = true;
        this.grabCooldown = rand(1.0, 2.0);
      }
      // Throw any held target after a brief moment.
      if (sm.grabbing && Math.random() < dt * 1.2) grab = false;
    }

    // Aim toward target if ranged
    if (this.target && sm.weapon?.aimWeapon) {
      let ax = this.target.position.x - sm.position.x;
      let ay = (this.target.position.y + 0.5) - (sm.position.y + 0.6);
      // gravity-compensate for arc weapons (Bow, Grenade)
      if (['Bow', 'Grenade'].includes(sm.weapon.name)) {
        const dist = Math.hypot(ax, ay);
        ay += dist * 0.18; // lead upward
      }
      // lead target by velocity
      ax += this.target.body.velocity.x * 0.15;
      ay += this.target.body.velocity.y * 0.05;
      const mag = Math.hypot(ax, ay) || 1;
      const noise = (1 - this.skill) * 0.3;
      aimX = ax / mag + (rand(-noise, noise));
      aimY = ay / mag + (rand(-noise, noise));
      aimActive = true;
    }

    // Attack if target in range
    if (this.target) {
      const d = Math.hypot(this.target.position.x - sm.position.x, this.target.position.y - sm.position.y);
      const w = sm.weapon;
      if (w?.aimWeapon) {
        if (d < 18 && d > 1.5) attack = true;
      } else if (w) {
        if (d < 1.5) attack = true;
      } else {
        // Unarmed: priority chain — slide-kick > back-counter > heavy/light.
        const speedAbs = Math.abs(sm.body.velocity.x);
        const opLow = this.target && (this.target.position.y - sm.position.y) < 0.6;
        const dxToTarget = this.target ? Math.abs(this.target.position.x - sm.position.x) : Infinity;
        const wantSlideKick = speedAbs > 5 && opLow && dxToTarget < 3;

        if (wantSlideKick) {
          // Priority 1: slide-kick — crouch to trigger slide, arm a one-shot attack press.
          if (this._slideKickPressAt === 0) {
            this._slideKickPressAt = performance.now() + 80;
          }
          desiredY = -1;   // crouch — triggers slide
        } else {
          // Clear stale slide-kick arm whenever slide conditions are not met.
          this._slideKickPressAt = 0;

          // Priority 2: back-counter if enemy is swinging at us.
          const swinger = this._nearestSwingingEnemy();
          if (swinger && Math.random() < 0.15 && sm.attackCooldown <= 0 && this._chargeHoldUntil === 0) {
            desiredX = -sm.facing;
            desiredY = 0;
            this._chargeHoldUntil = performance.now() + 280;
            attack = true;
          } else {
            // Priority 3: heavy/light unarmed combat.
            if (d < 1.0) {
              const target = this.target;
              // While a charge is in flight, stay committed to heavy. Otherwise re-roll.
              const chargeActive = this._chargeHoldUntil > 0;
              const wantHeavy = chargeActive || (Math.random() < this._heavyChance(target));
              if (wantHeavy) {
                if (!this._chargeHoldUntil) {
                  // Start a charge — press and hold for 0.25–0.45s.
                  this._chargeHoldUntil = performance.now() + (250 + Math.random() * 200);
                  const dir = this._pickHeavyDir(target);
                  desiredX = dir.x || desiredX;
                  desiredY = dir.y;
                }
                // Hold attack until threshold.
                attack = performance.now() < this._chargeHoldUntil;
                if (performance.now() >= this._chargeHoldUntil) {
                  this._chargeHoldUntil = 0;   // release happens naturally next frame
                }
              } else {
                // Light tap — single-frame attack pulse.
                attack = false;
                if (this._lastLightAt + 200 < performance.now()) {
                  attack = true;
                  this._lastLightAt = performance.now();
                }
              }
            }
          }
        }
      }
    }

    // Slide-kick press: fires once when the armed timer elapses.
    if (this._slideKickPressAt > 0 && performance.now() >= this._slideKickPressAt) {
      attack = true;
      this._slideKickPressAt = 0;
    }

    // Drive inputs
    sm.input.moveX = desiredX;
    sm.input.moveY = desiredY !== null ? desiredY : clamp(dy * 0.5, -1, 1);
    sm.input.jump = jump;
    sm.input.attack = attack;
    sm.input.grab = grab;
    sm.input.special = special;
    sm.input.aimX = aimX; sm.input.aimY = aimY;
    sm.input.aimActive = aimActive;
  }

  // Returns a directional vector for choosing a heavy attack variant.
  _pickHeavyDir(target) {
    if (!target) return { x: 0, y: 0 };
    const me = this.sm;
    const dx = target.position.x - me.position.x;
    const dy = target.position.y - me.position.y;
    const sameFacing = Math.sign(dx) === me.facing;
    // Target airborne above me → up heavy / rising knee.
    if (dy > 1.2) return { x: 0, y: 1 };
    // Target airborne below me → down heavy / dive.
    if (dy < -1.0) return { x: 0, y: -1 };
    // Far + facing → forward charge.
    if (Math.abs(dx) > 2.5 && sameFacing) return { x: Math.sign(dx), y: 0 };
    // Otherwise neutral blow-away.
    return { x: 0, y: 0 };
  }

  // Heuristic probability of using a heavy this attack beat.
  _heavyChance(target) {
    if (!target) return 0;
    // More likely to throw heavy if target stunned or in range.
    if (target.hitstun > 0.1) return 0.7;
    const dx = Math.abs(target.position.x - this.sm.position.x);
    if (dx < 1.5) return 0.25;
    return 0.10;
  }

  // Returns the nearest enemy who is mid-swing and facing us, within ~2.5 units.
  _nearestSwingingEnemy() {
    const me = this.sm;
    const players = me.game?.players || [];
    let best = null, bestD2 = 2.5 * 2.5;
    for (const p of players) {
      if (!p || p === me || !p.alive) continue;
      if (p.attackTimer <= 0 || !p.moveId) continue;
      const dx = p.position.x - me.position.x;
      const dy = p.position.y - me.position.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > bestD2) continue;
      // Opponent must be facing me (their facing points toward us).
      if (Math.sign(-dx) !== p.facing) continue;
      bestD2 = d2;
      best = p;
    }
    return best;
  }

  // Tile lookup at world (x, y) — checks all tile shape variants in level.tiles.
  _tileAt(level, x, y) {
    return level.tiles.get(`${Math.round(x)},${Math.round(y)}`);
  }
  _wallAhead(level, dirX) {
    if (Math.abs(dirX) < 0.1) return false;
    const x = this.sm.position.x + sign(dirX) * 0.7;
    const y = this.sm.position.y;
    return !!this._tileAt(level, x, y);
  }
  // Look at the tower of tiles directly ahead at body / head / above-head height.
  // Returns: 0 = clear, 1 = single-tile wall (jumpable), 2 = tall wall.
  _wallHeight(level, dirX) {
    if (Math.abs(dirX) < 0.1) return 0;
    const px = this.sm.position.x + sign(dirX) * 0.7;
    const py = this.sm.position.y;
    let h = 0;
    for (let dy = 0; dy <= 3; dy++) {
      if (this._tileAt(level, px, py + dy)) h = dy + 1;
      else break;
    }
    return h;
  }
  _hasGroundBelow(level, dx) {
    const px = this.sm.position.x + dx;
    const py = this.sm.position.y - 1;
    for (let dy = 0; dy < 4; dy++) {
      if (this._tileAt(level, px, py - dy)) return true;
    }
    return false;
  }
}
