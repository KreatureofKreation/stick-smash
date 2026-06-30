// Network snapshot codec. The host serializes match state with `encodeSnapshot`
// and clients apply it with the helpers here. Encoder and decoder live in ONE
// file, side by side, so a field added to one half is obvious if the other
// isn't updated — and `test/network/snapshot.test.js` round-trips them to catch
// drift mechanically (this is the bug class that silently desyncs net play).
//
// Pure + dependency-free (no Three/cannon/Stickman imports): every function
// operates on duck-typed objects, so it loads in plain Node for testing. Entity
// construction + local-player binding stays in Game.applySnapshot, which calls
// `decodePlayerInto` for the per-player field application.

// Bitfield <-> limb-name mapping for dismemberment sync.
const SEVERED_BITS = [['armL', 1], ['armR', 2], ['legL', 4], ['legR', 8]];

// Serialize one player to the terse wire object. Terse keys keep the 30Hz
// broadcast small. Mirror every key in `decodePlayerInto`.
export function encodePlayer(p) {
  return {
    id: p.id, name: p.name, character: p.character,
    x: p.position.x, y: p.position.y,
    vx: p.body.velocity.x, vy: p.body.velocity.y,
    f: p.facing, ax: p.aimDir.x, ay: p.aimDir.y,
    s: p.state, hp: p.health, l: p.lives, sc: p.score,
    wp: p.weapon ? p.weapon.name : null,
    at: p.attackTimer, gr: p.grabbing ? 1 : 0,
    // Strike-pose state — clients need these to render the right animation for
    // net players (not just the legacy single-arc attack).
    mid: p.moveId || null,
    cs: p.chainStep | 0,
    acs: p.airChainStep | 0,
    kk: p.kicking ? 1 : 0,
    as: p._attackStep | 0,
    gd: p.grounded ? 1 : 0,
    sl: p.sliding ? 1 : 0,
    cr: p.crouching ? 1 : 0,
    bk: p._blocking ? 1 : 0, sdx: p._shieldDirX, sdy: p._shieldDirY,
    sv: (p._severed?.has('armL') ? 1 : 0) | (p._severed?.has('armR') ? 2 : 0)
      | (p._severed?.has('legL') ? 4 : 0) | (p._severed?.has('legR') ? 8 : 0),
    gb: p._gibbed ? 1 : 0,
  };
}

// Apply a wire player object onto an EXISTING player. Mirror of encodePlayer.
// Handles position snap-on-first, interpolation target, velocity, pose flags,
// and dismemberment (which drives the rig). Does NOT construct players or bind
// the local player — Game.applySnapshot owns that.
export function decodePlayerInto(p, sp) {
  // First snapshot for this player: snap to position. Subsequent: interpolate
  // toward the target (Game's loop does the lerp).
  if (!p._firstSnapApplied) {
    p.body.position.set(sp.x, sp.y, 0);
    p._firstSnapApplied = true;
  }
  p._netTargetX = sp.x;
  p._netTargetY = sp.y;
  p.body.velocity.set(sp.vx, sp.vy, 0);
  p.facing = sp.f;
  p.aimDir.set(sp.ax, sp.ay);
  p.state = sp.s;
  p.health = sp.hp;
  p.lives = sp.l;
  p.score = sp.sc;
  p.attackTimer = sp.at;
  // Strike-pose dispatcher reads moveId; legacy paths read kicking + _attackStep.
  p.moveId = sp.mid ?? null;
  p.chainStep = sp.cs | 0;
  p.airChainStep = sp.acs | 0;
  p.kicking = !!sp.kk;
  p._attackStep = sp.as | 0;
  p.sliding = !!sp.sl;
  p.crouching = !!sp.cr;
  p.grounded = sp.gd != null ? !!sp.gd : Math.abs(sp.vy) < 0.5;
  p._blocking = !!sp.bk;
  if (sp.sdx != null) { p._shieldDirX = sp.sdx; p._shieldDirY = sp.sdy; }
  // Dismemberment sync: hide severed limbs / gib / reset on respawn.
  const sv = sp.sv | 0;
  if (sv === 0 && (p._severed?.size || p._gibbed)) {
    p._severed?.clear(); p._gibbed = false; p.rig.resetParts?.();
  } else if (sv) {
    for (const [name, bit] of SEVERED_BITS) {
      if ((sv & bit) && !p._severed.has(name)) { p._severed.add(name); p.rig.hidePart?.(name); }
    }
  }
  if (sp.gb && !p._gibbed) p._gib?.();
}

// Serialize the whole match. `game` is duck-typed: { level, players }.
export function encodeSnapshot(game) {
  if (!game.level) return { players: [], tiles: [] };
  const data = {
    players: game.players.map(p => (p ? encodePlayer(p) : null)),
    // Only ship damaged tiles (hp < maxHp) — cuts the payload from hundreds of
    // entries to whatever is broken. Clients diff against the initial state.
    tiles: [...game.level.tiles.values()]
      .filter(t => t.hp < (t.maxHp ?? Infinity))
      .map(t => [t.gx, t.gy, t.hp]),
  };
  // Curved-gravity levels also ship player rotation + wedge HP. Meteors are
  // host-only render in v1 (clients don't simulate them yet).
  if (game.level?.curvedGravity) {
    data.playersQ = game.players.map(p => p
      ? [p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w]
      : null);
    data.wedges = [];
    for (const planet of (game.level.planets ?? [])) {
      for (const w of planet.wedges) {
        if (w && w.hp < w.maxHp && w.hp > 0) data.wedges.push([planet.id, w.kind, w.idx, w.hp]);
      }
    }
  }
  return data;
}

// Apply tile-HP deltas to the level (destroy at <=0, else set hp).
export function applyTiles(level, tiles) {
  for (const [gx, gy, hp] of tiles ?? []) {
    const t = level.tiles.get(`${gx},${gy}`);
    if (t && hp <= 0) t.destroy();
    else if (t) t.hp = hp;
  }
}

// Apply curved-gravity extras: player quaternions + wedge HP (host sends these
// only when level.curvedGravity is true).
export function applyCurved(level, players, snap) {
  if (snap.playersQ) {
    for (let i = 0; i < snap.playersQ.length; i++) {
      const q = snap.playersQ[i];
      const p = players[i];
      if (!p || !q) continue;
      p.body.quaternion.set(q[0], q[1], q[2], q[3]);
    }
  }
  if (snap.wedges && level?.planets) {
    for (const [planetId, kind, idx, hp] of snap.wedges ?? []) {
      const planet = level.planets.find(pp => pp.id === planetId);
      if (!planet) continue;
      const w = planet.wedges.find(ww => ww && ww.kind === kind && ww.idx === idx);
      if (w && hp < w.hp) w.damage(w.hp - hp);
    }
  }
}

// ── Untrusted-input sanitizers ──────────────────────────────────────────────
// The public room lets anyone join, so peer-supplied messages are untrusted.
// These coerce incoming data to safe shapes BEFORE it reaches the sim, so a
// malformed/malicious peer can't inject NaN positions (which corrupt physics +
// rendering) or stray properties. Net.js calls them at the message boundary.

// Generous bounds — legit gameplay never approaches these; the point is to
// reject NaN/Infinity and absurd values, not to enforce game rules.
const POS_BOUND = 1e6;

const fin = (v, d = 0) => (Number.isFinite(v) ? clampTo(v, -POS_BOUND, POS_BOUND) : d);
const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const unit = (v, d) => (Number.isFinite(v) ? clampTo(v, -1, 1) : d);

// Sanitize a per-frame input the host received from a client. Whitelists the
// canonical input keys (matches Input.getSnapshotFor) and coerces types, so
// Object.assign onto the stickman's input can't introduce junk. Returns null
// for a non-object (caller ignores it).
export function sanitizeInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    moveX: unit(raw.moveX, 0), moveY: unit(raw.moveY, 0),
    jump: !!raw.jump, attack: !!raw.attack, grab: !!raw.grab,
    special: !!raw.special, throw: !!raw.throw,
    aimX: unit(raw.aimX, 1), aimY: unit(raw.aimY, 0), aimActive: !!raw.aimActive,
  };
}

// Sanitize a snapshot a client received from the host. Rejects structurally
// invalid payloads (returns null) and coerces every numeric player field to a
// finite value so decodePlayerInto can't write NaN into bodies. Pose flags are
// left as-is — decodePlayerInto already coerces them (`| 0`, `!!`). Returns a
// new object; does not mutate `raw`.
const MAX_SNAPSHOT_PLAYERS = 16;
export function sanitizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.players)) return null;
  const out = {
    players: raw.players.slice(0, MAX_SNAPSHOT_PLAYERS).map(sp => {
      if (!sp || typeof sp !== 'object') return null;
      return {
        ...sp,
        id: Number.isFinite(sp.id) ? sp.id : 0,
        x: fin(sp.x), y: fin(sp.y), vx: fin(sp.vx), vy: fin(sp.vy),
        ax: unit(sp.ax, 1), ay: unit(sp.ay, 0),
        hp: Number.isFinite(sp.hp) ? clampTo(sp.hp, 0, POS_BOUND) : 0,
        l: Number.isFinite(sp.l) ? Math.max(0, sp.l | 0) : 0,
        sc: fin(sp.sc),
        at: fin(sp.at),
      };
    }),
    tiles: Array.isArray(raw.tiles)
      ? raw.tiles.filter(t => Array.isArray(t) && t.length >= 3 && t.every(Number.isFinite))
      : [],
  };
  // Curved-gravity extras: keep only well-formed entries; decode null-guards.
  if (Array.isArray(raw.playersQ)) {
    out.playersQ = raw.playersQ.map(q =>
      (Array.isArray(q) && q.length === 4 && q.every(Number.isFinite)) ? q : null);
  }
  if (Array.isArray(raw.wedges)) {
    out.wedges = raw.wedges.filter(w =>
      Array.isArray(w) && w.length >= 4 && Number.isFinite(w[3]));
  }
  return out;
}
