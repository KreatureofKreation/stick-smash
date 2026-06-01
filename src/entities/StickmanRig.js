import * as THREE from 'three';
import { lerp, damp, clamp } from '../util/math.js';

// Procedural stick figure rig — clean silhouette, joint spheres at every joint,
// damped-spring hands & feet for Stick-Fight-style ragdoll wobble.

const _v = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const Z_STAGGER = 0.08;
// Minimum distance from limb endpoint to wall surface after clamp.
// 0.06m clears cylinder radius (~0.04) plus a small visual margin so
// the mesh doesn't poke into the tile at glancing angles.
const LIMB_PAD = 0.06;
// Mask for world geometry only. Equals COL_GROUPS.WORLD = 0x0001 (see
// src/physics/PhysicsWorld.js). Hardcoded here to avoid importing the
// physics module into the rig — rig stays display-only.
const WORLD_MASK = 0x0001;

// Animation feel tunables — live-tunable via window.__anim so the feel can be
// tightened in-browser without a rebuild (e.g. `window.__anim.RUN_LEAN = 0.45`
// then watch it live). Defaults below are a tightened first pass: weightier
// landings, snappier lean/squash, a takeoff pop, a calmer idle. Lower *_LAMBDA
// = faster (snappier) convergence.
const ANIM_DEFAULTS = {
  LAND_WEIGHT: 1.35,      // landing squash + hip-dip weight (was ~1.0)
  TILT_LAMBDA: 0.00004,   // body-lean damp; smaller = snappier (was 0.0001)
  SQUASH_LAMBDA: 0.0004,  // squash damp; smaller = snappier (was 0.0008)
  RUN_LEAN: 0.36,         // forward lean per unit speed (was 0.28)
  BOB_AMT: 0.13,          // hip bob amplitude (was 0.10)
  TAKEOFF_POP: 0.22,      // extra upward stretch pulse on jump takeoff
  IDLE_DRIFT: 0.4,        // idle phase drift scale; lower = calmer arms (was 1.0)
  // Escapable grab tunables
  GRAB_MASH_GAIN: 0.12,   // escape added per fresh input edge while grabbed
  GRAB_ESCAPE_DECAY: 0.25,// escape/sec passive decay (must keep mashing)
  GRAB_MAX_HOLD: 2.5,     // s before a grab auto-breaks
  GRAB_BREAK_KB: 7,       // shove speed on a mash-break
  GRAB_IMMUNE: 0.6,       // s of re-grab immunity for the escapee
  GRAB_HIT_BREAK_KB: 6,   // grabber knockback magnitude that breaks the grab
  // Strike animation tunables
  STRIKE_REACH: 1.08,      // uniform scale on strike-pose limb offsets (bumped from 1.0)
  STRIKE_OVERSHOOT: 0.16,  // follow-through bump: hand cracks past target then settles (bumped from 0.10)
  LIGHT_PHASE_W1: 0.30, LIGHT_PHASE_W2: 0.65,   // light windup/strike split (live-tunable)
  HEAVY_PHASE_W1: 0.50, HEAVY_PHASE_W2: 0.72,   // heavy windup/strike split (live-tunable)
  // Walk feel tunables
  WALK_HIP_SWAY: 0.09,    // side-to-side hip translation per speed unit (bumped from 0.06)
  WALK_ARM_SWING: 1.2,    // arm counter-swing amplitude scale (bumped from 1.0)
  // Jump/land tunables
  TAKEOFF_CROUCH: 0.10,   // hip-dip depth on jump takeoff (legs pre-compress before stretch)
};
const ANIM = (typeof window !== 'undefined')
  ? (window.__anim = Object.assign({}, ANIM_DEFAULTS, window.__anim || {}))
  : ANIM_DEFAULTS;

function makeLimb(radius, length, mat) {
  const g = new THREE.CylinderGeometry(radius, radius, length, 8, 1, false);
  g.translate(0, length / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.userData.baseLen = length;
  m.castShadow = true;
  return m;
}

function orientLimb(mesh, fromX, fromY, fromZ, toX, toY, toZ) {
  _v.set(toX - fromX, toY - fromY, toZ - fromZ);
  const len = _v.length();
  if (len < 1e-5) { mesh.visible = false; return; }
  mesh.visible = true;
  mesh.position.set(fromX, fromY, fromZ);
  mesh.scale.y = len / mesh.userData.baseLen;
  _v.divideScalar(len);
  mesh.quaternion.setFromUnitVectors(_yAxis, _v);
}

function solveIK(out, rootX, rootY, targetX, targetY, upperLen, lowerLen, bend = 1) {
  const dx = targetX - rootX, dy = targetY - rootY;
  const distRaw = Math.hypot(dx, dy);
  const dist = Math.min(distRaw, upperLen + lowerLen - 0.001);
  const a = (distRaw === 0) ? 0 : Math.atan2(dy, dx);
  const cosB = clamp((upperLen * upperLen + dist * dist - lowerLen * lowerLen) / (2 * upperLen * Math.max(0.0001, dist)), -1, 1);
  const b = Math.acos(cosB);
  const elbowAngle = a + b * bend;
  out.x = rootX + Math.cos(elbowAngle) * upperLen;
  out.y = rootY + Math.sin(elbowAngle) * upperLen;
}

// ---------------------------------------------------------------------------
// Strike pose functions — each returns a partial override object with any
// subset of { armRX, armRY, armLX, armLY, legRX, legRY, legLX, legLY,
//             leanZ, bodyAngle, footShift }.
// Coordinates are OFFSETS from the shoulder/hip anchor; rig applies them.
// `t` = params.attackProgress (0..1 over move duration).
//
// Animation principles:
//   - Three-phase keyframing: WINDUP (chamber) → STRIKE (snap) → RECOVER (settle).
//   - Lights: 30/35/35 split — fast windup, quick snap, fast recover. Chain stays
//     mashable.
//   - Heavies: 50/22/28 split — long held anticipation reads as commitment.
//   - Strike phase uses ease-OUT cubic so the hand cracks into the impact rather
//     than floating (smoothstep felt like a wave).
//   - Counter-arm + weight-shift: every pose drives the off-arm and the plant
//     foot to sell rotation around a real center of mass.
// Amplitude budget: arm reach is 0.45+0.45 = 0.90 m (maxReach 0.89 m after
// clamp). Pose magnitudes should fit sqrt(x²+y²) ≤ 0.88; the IK clamp swallows
// any overshoot silently, so keep peak armRX/RY combined under 0.88.
// ---------------------------------------------------------------------------

// Resolves t into one of three phases plus its local weight (linear) and an
// ease-out cubic version. Strike phase uses easeOut to crack into the peak;
// windup/recover use eased smoothstep for gentle transitions.
function phaseSplit(t, w1, w2) {
  if (t < w1) { const w = t / Math.max(0.0001, w1); return { p: 0, w, e: w * w * (3 - 2 * w) }; }
  if (t < w2) {
    const w = (t - w1) / Math.max(0.0001, w2 - w1);
    const o = ANIM.STRIKE_OVERSHOOT ?? 0.10;
    const eb = 1 - Math.pow(1 - w, 3);          // ease-out cubic base (0→1)
    const over = Math.sin(w * Math.PI) * o;      // 0 at ends, peak mid → overshoot bump
    return { p: 1, w, e: eb + over };
  }
  const w = (t - w2) / Math.max(0.0001, 1 - w2);
  return { p: 2, w, e: w * w * (3 - 2 * w) };
}

// Light split — 30% windup / 35% strike pulse / 35% recover
const LITE = [0.30, 0.65];
// Heavy split — 50% windup / 22% strike pulse / 28% recover
const HVY  = [0.50, 0.72];
// Launcher split — 55% windup / 20% strike / 25% recover
const LAUN = [0.55, 0.75];

function poseJab(rig, params) {
  // Fast straight — short snappy chamber, explosive centerline extension,
  // lead-hand guard stays tight, quick settle.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LITE);
  let armRX, armRY, leanZ, armLX, armLY, footShift;
  if (ph.p === 0) {
    // Chamber: rear shoulder loads back, lead hand rises to chin-guard
    armRX = lerp(0.10, -0.55, ph.e);   // lead fist retracts to chin-level
    armRY = lerp(-0.25, 0.45, ph.e);
    armLX = lerp(-0.20, -0.10, ph.e);  // guard snaps up to chin
    armLY = lerp(-0.30, 0.38, ph.e);
    leanZ = lerp(0, -0.22, ph.e);      // slight shoulder-load lean back
    footShift = lerp(0, -0.06, ph.e);  // weight loads rear foot
  } else if (ph.p === 1) {
    // Strike: explosive centerline extension, guard locks at chin
    // Note: phaseSplit e can reach ~1.16 at mid-strike (overshoot bump), so
    // effective peak = end + (end-start)*0.16. Size accordingly.
    armRX = lerp(-0.55, 0.82, ph.e);   // whip straight forward (budget: keep combined <1.0)
    armRY = lerp(0.45, 0.05, ph.e);    // stays close to horizontal
    armLX = lerp(-0.10, -0.28, ph.e);  // guard pulls in tight
    armLY = lerp(0.38, 0.35, ph.e);    // stays at chin height
    leanZ = lerp(-0.22, 0.28, ph.e);   // lead-shoulder drives forward
    footShift = lerp(-0.06, 0.10, ph.e); // quick weight push
  } else {
    // Settle: hand pulls back to a slightly different neutral (not dead snap)
    armRX = lerp(0.90, 0.15, ph.e);
    armRY = lerp(0.05, -0.20, ph.e);
    armLX = lerp(-0.28, -0.18, ph.e);
    armLY = lerp(0.35, 0.28, ph.e);    // guard hand rests a bit higher than start
    leanZ = lerp(0.28, 0.05, ph.e);    // settle just past zero (follow-through)
    footShift = lerp(0.10, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseCross(rig, params) {
  // Power straight — deep rear-hip load, long extension driven by full hip
  // rotation, rear foot drives. The "money" punch — full commitment.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LITE);
  let armRX, armRY, leanZ, armLX, armLY, footShift;
  if (ph.p === 0) {
    // Deep chamber: rear arm coils WAY back, torso winds hard, lead guard up
    armRX = lerp(0.10, -0.65, ph.e);   // rear fist coils back past shoulder
    armRY = lerp(-0.20, 0.60, ph.e);   // arm rises as it chambers
    armLX = lerp(-0.20, 0.15, ph.e);   // lead arm holds guard forward
    armLY = lerp(-0.30, 0.25, ph.e);
    leanZ = lerp(0, -0.45, ph.e);      // deep torso wind-back (bigger than jab)
    footShift = lerp(0, -0.14, ph.e);  // rear foot loads hard
  } else if (ph.p === 1) {
    // Strike: full hip rotation drives the long extension
    armRX = lerp(-0.65, 0.82, ph.e);   // long extension from hip-wind uncoil (budget)
    armRY = lerp(0.60, 0.02, ph.e);    // travels forward and slightly down
    armLX = lerp(0.15, -0.32, ph.e);   // lead retracts sharply to chin
    armLY = lerp(0.25, 0.38, ph.e);    // guard stays at chin height
    leanZ = lerp(-0.45, 0.55, ph.e);   // massive hip rotation — full commit
    footShift = lerp(-0.14, 0.22, ph.e); // rear foot drives into the punch
  } else {
    // Settle: slightly past neutral — body still rotated, arm pulling back
    armRX = lerp(0.90, 0.12, ph.e);
    armRY = lerp(0.00, -0.22, ph.e);
    armLX = lerp(-0.32, -0.18, ph.e);
    armLY = lerp(0.38, 0.30, ph.e);
    leanZ = lerp(0.55, 0.08, ph.e);    // settles just past zero
    footShift = lerp(0.22, 0.05, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseHook(rig, params) {
  // Horizontal arc — wide load to the side, whip a tight horizontal arc to
  // centerline, strong torso rotation, off-arm counter-sweeps through center.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LITE);
  let armRX, armRY, leanZ, armLX, armLY, footShift;
  if (ph.p === 0) {
    // Wide load: arm sweeps FAR to the outside, torso pre-rotates outward
    armRX = lerp(0.10, 0.68, ph.e);    // arm opens wide to the side (silhouette read)
    armRY = lerp(-0.25, 0.55, ph.e);   // rises as it loads
    armLX = lerp(-0.20, -0.52, ph.e);  // counter-arm sweeps opposite direction hard
    armLY = lerp(-0.30, 0.28, ph.e);
    leanZ = lerp(0, 0.32, ph.e);       // torso pre-rotates outward (opens the arc)
    footShift = lerp(0, -0.08, ph.e);  // plant foot loads
  } else if (ph.p === 1) {
    // Arc: whip through horizontal arc to centerline, off-arm counter-sweeps back
    armRX = lerp(0.68, 0.88, ph.e);    // arc tip reaches centerline (stay ≤0.95)
    armRY = lerp(0.55, 0.08, ph.e);    // drops from high to level as it arcs
    armLX = lerp(-0.52, 0.05, ph.e);   // counter-arm whips all the way through center
    armLY = lerp(0.28, -0.30, ph.e);   // swings down as it passes
    leanZ = lerp(0.32, 0.62, ph.e);    // full hip rotation — rotational punch
    footShift = lerp(-0.08, 0.16, ph.e); // hip pivots
  } else {
    // Settle: past centerline, body carries the rotation momentum
    armRX = lerp(0.88, 0.18, ph.e);
    armRY = lerp(0.08, -0.22, ph.e);
    armLX = lerp(0.05, -0.18, ph.e);
    armLY = lerp(-0.30, -0.25, ph.e);
    leanZ = lerp(0.62, 0.10, ph.e);    // settles with a bit of follow-through
    footShift = lerp(0.16, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseKnee(rig, params) {
  // Close knee strike — both hands grab-posture pull in, drive knee UP hard
  // to chest height, body curls over the knee then settles. Close-range, vertical.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LITE);
  let legRX, legRY, leanZ, armRX, armRY, armLX, armLY;
  if (ph.p === 0) {
    // Chamber: leg pulls back/in, arms pull into grab-clinch posture
    legRX = lerp(0.20, -0.05, ph.e);   // foot sweeps back to load
    legRY = lerp(0, 0.20, ph.e);       // slight knee-up
    leanZ = lerp(0, 0.20, ph.e);       // body begins to curl forward
    armRX = lerp(0.10, 0.32, ph.e);    // both arms reach forward to grab-pull
    armRY = lerp(-0.20, 0.18, ph.e);
    armLX = lerp(-0.10, -0.32, ph.e);
    armLY = lerp(-0.20, 0.18, ph.e);
  } else if (ph.p === 1) {
    // Strike: knee ROCKETS upward to chest height, body curls over it
    legRX = lerp(-0.05, 0.42, ph.e);   // knee drives forward and up
    legRY = lerp(0.20, 0.80, ph.e);    // high knee — drives to chest level
    leanZ = lerp(0.20, 0.05, ph.e);    // body folds forward over the knee
    armRX = lerp(0.32, 0.22, ph.e);    // arms pull the target INTO the knee
    armRY = lerp(0.18, -0.15, ph.e);   // pull down as knee drives up
    armLX = lerp(-0.32, -0.22, ph.e);
    armLY = lerp(0.18, -0.15, ph.e);
  } else {
    // Settle: knee drops, arms relax
    legRX = lerp(0.42, 0.20, ph.e);
    legRY = lerp(0.80, 0, ph.e);
    leanZ = lerp(0.05, 0, ph.e);
    armRX = lerp(0.22, 0.08, ph.e);
    armRY = lerp(-0.15, -0.20, ph.e);
    armLX = lerp(-0.22, -0.08, ph.e);
    armLY = lerp(-0.15, -0.20, ph.e);
  }
  return { legRX, legRY, leanZ, armRX, armRY, armLX, armLY };
}

function poseSpinBack(rig, params) {
  // Spinning backfist — flashiest light. Huge wind-up twist one way, whip all
  // the way through a big horizontal arc, off-arm leads then whips opposite.
  // Maximize the arc — use leanZ budget to its fullest.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, 0.42, 0.74);
  let armRX, armRY, leanZ, armLX, armLY, footShift;
  if (ph.p === 0) {
    // Wind up: DEEP opposite twist, off-arm leads the rotation direction
    armRX = lerp(0.10, -0.70, ph.e);    // strike arm coils HARD behind body
    armRY = lerp(-0.20, 0.65, ph.e);    // rises as it coils
    armLX = lerp(-0.20, 0.55, ph.e);    // off-arm leads the spin direction strongly
    armLY = lerp(-0.30, 0.35, ph.e);
    leanZ = lerp(0, -0.90, ph.e);       // maximum wind — near budget limit
    footShift = lerp(0, -0.18, ph.e);   // weight loads rear foot hard
  } else if (ph.p === 1) {
    // Whip: arc SWEEPS from behind all the way to full extension, body rotates max
    armRX = lerp(-0.70, 0.84, ph.e);    // full horizontal backfist arc (budget-safe)
    armRY = lerp(0.65, 0.10, ph.e);     // sweeps from high to level
    armLX = lerp(0.55, -0.58, ph.e);    // off-arm whips ALL THE WAY back the other way
    armLY = lerp(0.35, 0.15, ph.e);
    leanZ = lerp(-0.90, 0.80, ph.e);    // massive arc — budget-safe with overshoot
    footShift = lerp(-0.18, 0.28, ph.e); // weight shifts completely across
  } else {
    // Settle: still carrying rotation, gradually slows
    armRX = lerp(0.90, 0.15, ph.e);
    armRY = lerp(0.10, -0.25, ph.e);
    armLX = lerp(-0.60, -0.20, ph.e);
    armLY = lerp(0.15, -0.28, ph.e);
    leanZ = lerp(0.90, 0.12, ph.e);     // follow-through settle with overshoot
    footShift = lerp(0.28, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseBlowAway(rig, params) {
  // heavyNeutral — double-palm push. Both arms chamber back, then drive BOTH
  // palms forward stacked with a big step-in, strong forward lean, slow committed recover.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...HVY);
  let armRX, armRY, armLX, armLY, leanZ, footShift;
  if (ph.p === 0) {
    // Long chamber: both arms pulled BACK and UP, torso winds back, weight loads rear
    armRX = lerp(0.10, -0.48, ph.e);   // right arm coils back to shoulder height
    armRY = lerp(-0.20, 0.55, ph.e);   // rises into chamber
    armLX = lerp(-0.10, -0.48, ph.e);  // left mirrors right (symmetric two-hand chamber)
    armLY = lerp(-0.20, 0.55, ph.e);
    leanZ = lerp(0, -0.50, ph.e);      // big torso wind-back for a heavy
    footShift = lerp(0, -0.20, ph.e);  // weight loads rear foot hard
  } else if (ph.p === 1) {
    // Strike: BOTH palms shoot forward stacked, massive step-in, lean commits
    armRX = lerp(-0.48, 0.86, ph.e);   // right palm drives full extension (budget)
    armRY = lerp(0.55, 0.05, ph.e);    // drops to horizontal push height
    armLX = lerp(-0.48, 0.75, ph.e);   // left slightly less extended (stacked)
    armLY = lerp(0.55, 0.05, ph.e);
    leanZ = lerp(-0.50, 0.60, ph.e);   // big lean into the shove
    footShift = lerp(-0.20, 0.32, ph.e); // large step-in — covers distance
  } else {
    // Slow recover — committed heavy settle
    armRX = lerp(0.90, 0.15, ph.e);
    armRY = lerp(0.05, -0.25, ph.e);
    armLX = lerp(0.78, -0.15, ph.e);
    armLY = lerp(0.05, -0.25, ph.e);
    leanZ = lerp(0.60, 0.05, ph.e);    // holds forward lean a bit (committed weight)
    footShift = lerp(0.32, 0.05, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseUppercut(rig, params) {
  // heavyUp launcher — drop into deep low coil (striking hand dips below hip),
  // then ROCKET the fist up overhead on an arc, explode off rear foot.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LAUN);
  let armRX, armRY, armLX, armLY, leanZ, footShift;
  if (ph.p === 0) {
    // Deep crouch-coil: fist drops ALL the way below hip level, body dips
    armRX = lerp(0.10, 0.08, ph.e);    // arm moves inward as it drops
    armRY = lerp(-0.20, -0.82, ph.e);  // fist BELOW hip — deepest coil (budget: |0.82|<0.95)
    armLX = lerp(-0.20, -0.30, ph.e);  // guard stays up to protect
    armLY = lerp(-0.25, 0.20, ph.e);   // guard rises as right drops
    leanZ = lerp(0, -0.55, ph.e);      // body dips into the coil
    footShift = lerp(0, -0.15, ph.e);  // rear foot loads
  } else if (ph.p === 1) {
    // ROCKET: fist arcs upward explosively — shoulder, elbow, fist all extend overhead
    armRX = lerp(0.08, 0.30, ph.e);    // arm drives upward and slightly forward
    armRY = lerp(-0.82, 0.76, ph.e);   // full vertical arc — floor to overhead (budget)
    armLX = lerp(-0.30, -0.42, ph.e);  // left arm sweeps down as counterweight
    armLY = lerp(0.20, -0.28, ph.e);   // drops hard to counterbalance the rocket
    leanZ = lerp(-0.55, 0.20, ph.e);   // body extends upward with the punch
    footShift = lerp(-0.15, 0.22, ph.e); // explode off rear foot
  } else {
    // Settle: arm comes back down, body returns from extended stretch
    armRX = lerp(0.38, 0.15, ph.e);
    armRY = lerp(0.90, -0.22, ph.e);   // comes back down from overhead
    armLX = lerp(-0.42, -0.18, ph.e);
    armLY = lerp(-0.28, -0.22, ph.e);
    leanZ = lerp(0.20, 0.05, ph.e);
    footShift = lerp(0.22, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseAxe(rig, params) {
  // heavyDown overhead slam — both hands raise HIGH overhead (chamber up),
  // then SLAM straight down past body centerline, body folds forward hard.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...HVY);
  let armRX, armRY, armLX, armLY, leanZ, footShift;
  if (ph.p === 0) {
    // Raise up: both arms stretch overhead — as high as possible, lean back
    armRX = lerp(0.10, 0.18, ph.e);    // arms converge toward center as they rise
    armRY = lerp(-0.20, 0.90, ph.e);   // reaches maximum overhead height
    armLX = lerp(-0.10, -0.18, ph.e);
    armLY = lerp(-0.20, 0.90, ph.e);
    leanZ = lerp(0, -0.30, ph.e);      // slight lean back to load the overhead
    footShift = lerp(0, -0.10, ph.e);  // weight shifts back slightly
  } else if (ph.p === 1) {
    // SLAM: both arms drive straight down hard, body folds forward violently
    armRX = lerp(0.18, 0.28, ph.e);    // slight outward flare as arms pass body
    armRY = lerp(0.90, -0.55, ph.e);   // slams DOWN past hip level
    armLX = lerp(-0.18, -0.25, ph.e);
    armLY = lerp(0.90, -0.55, ph.e);
    leanZ = lerp(-0.30, 0.65, ph.e);   // body folds HARD forward over the slam
    footShift = lerp(-0.10, 0.15, ph.e); // body hunches forward
  } else {
    // Heavy settle: arms hang low, body straightens slowly
    armRX = lerp(0.28, 0.15, ph.e);
    armRY = lerp(-0.55, -0.30, ph.e);  // arms stay low in settle
    armLX = lerp(-0.25, -0.15, ph.e);
    armLY = lerp(-0.55, -0.30, ph.e);
    leanZ = lerp(0.65, 0.08, ph.e);    // gradually straightens (heavy settle)
    footShift = lerp(0.15, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseCharge(rig, params) {
  // heavyForward lunge — wind striking arm back + load rear foot hard,
  // then long lunging extension with big forward step. Covers distance.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...HVY);
  let armRX, armRY, armLX, armLY, leanZ, footShift;
  if (ph.p === 0) {
    // Load: striking arm retracts DEEP behind body, lead arm guards, weight loads rear
    armRX = lerp(0.10, -0.60, ph.e);   // arm coils WAY back for lunge
    armRY = lerp(-0.20, 0.42, ph.e);   // rises as it chambers
    armLX = lerp(-0.20, 0.18, ph.e);   // lead guard pushes slightly forward
    armLY = lerp(-0.20, 0.28, ph.e);
    leanZ = lerp(0, -0.30, ph.e);      // body loads back before the lunge
    footShift = lerp(0, -0.20, ph.e);  // rear foot loads HARD for the drive
  } else if (ph.p === 1) {
    // Lunge: body rockets forward, arm extends with full forward lean
    armRX = lerp(-0.60, 0.82, ph.e);   // full extension — covers distance (budget)
    armRY = lerp(0.42, -0.05, ph.e);   // drives forward-level
    armLX = lerp(0.18, 0.30, ph.e);    // lead arm partially extends to guide direction
    armLY = lerp(0.28, 0.10, ph.e);
    leanZ = lerp(-0.30, 0.75, ph.e);   // massive forward lean — commits full body
    footShift = lerp(-0.20, 0.38, ph.e); // long lunge step — biggest footShift
  } else {
    // Slow settle: over-extended, gradually pulls back
    armRX = lerp(0.90, 0.15, ph.e);
    armRY = lerp(-0.05, -0.25, ph.e);
    armLX = lerp(0.30, -0.15, ph.e);
    armLY = lerp(0.10, -0.22, ph.e);
    leanZ = lerp(0.75, 0.10, ph.e);    // holds lean a bit (still weighted forward)
    footShift = lerp(0.38, 0.08, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseCounterStance(rig, params) {
  // heavyBack — defensive read. Bladed stance, lead hand forward as a guard/parry,
  // weight back, subtle settle-bob. Should look like "bracing to counter," not a strike.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  // Quick settle into stance (first 15% of duration), then hold + subtle bob
  const settle = Math.min(1, t / 0.15);
  // Subtle breathing bob through hold — reads as alert, not frozen
  const holdPhase = Math.max(0, t - 0.15) / 0.85;
  const bob = Math.sin(holdPhase * Math.PI * 2.5) * 0.04 * settle;
  // Bladed stance: lead arm extends as a parry/ward, rear arm cocks back at hip
  // Lead arm (left arm in facing-right convention = armLX) pushes out as guard
  const armRX = lerp(0.12, -0.42, settle) + bob * 0.08; // rear arm cocked at hip
  const armRY = lerp(-0.20, 0.22, settle) + bob;         // slightly raised (ready)
  const armLX = lerp(-0.20, 0.45, settle) - bob * 0.05; // lead guard pushes forward
  const armLY = lerp(-0.25, 0.35, settle) + bob;         // guard at head level (parry)
  // Bladed stance leans weight back
  const leanZ = lerp(0, -0.38, settle) + bob * 0.06;
  // Slight foot shift back (weight back for counter)
  const footShift = lerp(0, -0.12, settle);
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseFlyingKnee(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LITE);
  let legRX, legRY, leanZ;
  if (ph.p === 0) {
    legRX = lerp(0.20, 0.10, ph.e);
    legRY = lerp(0, 0.25, ph.e);
    leanZ = lerp(0, 0.15, ph.e);
  } else if (ph.p === 1) {
    legRX = lerp(0.10, 0.55, ph.e);
    legRY = lerp(0.25, 0.45, ph.e);
    leanZ = lerp(0.15, 0.10, ph.e);
  } else {
    legRX = lerp(0.55, 0.20, ph.e);
    legRY = lerp(0.45, 0, ph.e);
    leanZ = lerp(0.10, 0, ph.e);
  }
  // Arms thrust forward to catch the target — like leaping onto someone.
  const reach = ph.p === 1 ? ph.e : (ph.p === 2 ? 1 - ph.e : 0);
  return {
    legRX, legRY, leanZ,
    armRX: 0.10 + reach * 0.50,
    armRY: 0.20 - reach * 0.10,
    armLX: -0.10 - reach * 0.30,
    armLY: 0.20 - reach * 0.10,
  };
}

function poseAirHook(rig, params) {
  // Airborne spinning hook — wider horizontal arc, body rotation tell,
  // off-arm counter-sweep, legs tucked so it reads as airborne not grounded.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LITE);
  let armRX, armRY, armLX, armLY, leanZ, legRX, legRY, legLX, legLY;
  if (ph.p === 0) {
    // Wind-up: arm cocks wide to the side, body pre-rotates, legs tuck
    armRX = lerp(0.20, 0.60, ph.e);
    armRY = lerp(-0.20, 0.45, ph.e);
    armLX = lerp(-0.20, -0.45, ph.e);   // counter-arm sweeps back hard
    armLY = lerp(-0.20, 0.25, ph.e);
    leanZ = lerp(0, 0.28, ph.e);        // bigger body twist tell
    legRX = lerp(0.15, 0.10, ph.e);    // both legs tuck up for air posture
    legRY = lerp(-0.10, 0.20, ph.e);
    legLX = lerp(-0.15, -0.12, ph.e);
    legLY = lerp(-0.10, 0.15, ph.e);
  } else if (ph.p === 1) {
    // Strike: hook whips through wider arc, body rotates hard, off-arm whips back
    armRX = lerp(0.60, 0.88, ph.e);
    armRY = lerp(0.45, -0.05, ph.e);
    armLX = lerp(-0.45, -0.10, ph.e);   // off-arm flicks the other way
    armLY = lerp(0.25, -0.15, ph.e);
    leanZ = lerp(0.28, 0.65, ph.e);     // full air-spin rotation tell
    legRX = lerp(0.10, 0.15, ph.e);    // legs stay tucked during the hook
    legRY = lerp(0.20, 0.30, ph.e);
    legLX = lerp(-0.12, -0.08, ph.e);
    legLY = lerp(0.15, 0.25, ph.e);
  } else {
    armRX = lerp(0.88, 0.20, ph.e);
    armRY = lerp(-0.05, -0.20, ph.e);
    armLX = lerp(-0.10, -0.20, ph.e);
    armLY = lerp(-0.15, -0.20, ph.e);
    leanZ = lerp(0.65, 0, ph.e);
    legRX = lerp(0.15, 0.15, ph.e);
    legRY = lerp(0.30, 0, ph.e);        // legs drop back to neutral
    legLX = lerp(-0.08, -0.15, ph.e);
    legLY = lerp(0.25, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, legRX, legRY, legLX, legLY };
}

function poseSomersault(rig, params) {
  // Whole-body Z-axis spin is applied at the rig.group level (see
  // Stickman._syncRig). Pose only contributes the axe-leg sweep so the
  // limbs don't hang loose during the rotation.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const peak = clamp((t - 0.40) / 0.35, 0, 1);
  const axe = Math.sin(peak * Math.PI);
  const legRX = 0.20 + axe * 0.35;
  const legRY = 0.00 + axe * 0.85;
  return {
    legRX, legRY,
    armRX: 0.05, armRY: 0.05,
    armLX: -0.05, armLY: 0.05,
  };
}

function poseRisingKnee(rig, params) {
  // Explosive aerial knee launcher — deep coil in windup, sharp uncurl on strike.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LAUN);
  let legRX, legRY, legLX, legLY, leanZ, armRX, armRY, armLX, armLY;
  if (ph.p === 0) {
    // Deep coil: knee tucked in tight, body curls forward, arms raise for launch
    legRX = lerp(0.20, 0.05, ph.e);    // strike leg folds back tight
    legRY = lerp(0, 0.35, ph.e);       // knee pulls toward chest
    legLX = lerp(-0.15, -0.10, ph.e); // plant leg tucks under
    legLY = lerp(0, 0.20, ph.e);
    leanZ = lerp(0, 0.35, ph.e);       // body curls (deeper than before)
    armRX = lerp(0.10, -0.15, ph.e);  // arms coil back for counter-throw
    armRY = lerp(0.10, 0.55, ph.e);
    armLX = lerp(-0.10, -0.20, ph.e);
    armLY = lerp(0.10, 0.50, ph.e);
  } else if (ph.p === 1) {
    // Sharp uncurl: knee drives explosively high, body snaps back, arms throw down
    legRX = lerp(0.05, 0.20, ph.e);   // knee drives up and out
    legRY = lerp(0.35, 0.80, ph.e);   // high knee — air launcher (was 0.75)
    legLX = lerp(-0.10, -0.15, ph.e);
    legLY = lerp(0.20, -0.10, ph.e);  // trailing leg kicks down for counter-weight
    leanZ = lerp(0.35, -0.30, ph.e);  // body uncurls hard (snaps back)
    armRX = lerp(-0.15, 0.20, ph.e); // arms throw DOWN as counter-balance
    armRY = lerp(0.55, -0.35, ph.e);
    armLX = lerp(-0.20, -0.15, ph.e);
    armLY = lerp(0.50, -0.30, ph.e);
  } else {
    legRX = lerp(0.20, 0.20, ph.e);
    legRY = lerp(0.80, 0, ph.e);
    legLX = lerp(-0.15, -0.15, ph.e);
    legLY = lerp(-0.10, 0, ph.e);
    leanZ = lerp(-0.30, 0, ph.e);
    armRX = lerp(0.20, 0.10, ph.e);
    armRY = lerp(-0.35, 0.10, ph.e);
    armLX = lerp(-0.15, -0.10, ph.e);
    armLY = lerp(-0.30, 0.10, ph.e);
  }
  return { legRX, legRY, legLX, legLY, leanZ, armRX, armRY, armLX, armLY };
}

function poseDive(rig, params) {
  // Committed downward spear — strong body-rotation tell, legs spear together,
  // arms tuck in windup then thrust back on strike for streamlined dive silhouette.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, 0.35, 0.78);
  let legRX, legRY, legLX, legLY, leanZ, armRX, armRY, armLX, armLY;
  if (ph.p === 0) {
    // Windup: body pitches forward, arms tuck in for the dive commit
    legRX = lerp(0.20, 0.35, ph.e);    // legs draw together forward
    legRY = lerp(0, 0.10, ph.e);       // slight knee-up before the spear
    legLX = lerp(-0.20, 0.28, ph.e);   // left leg matches right
    legLY = lerp(0, 0.10, ph.e);
    leanZ = lerp(0, 0.70, ph.e);       // strong forward pitch (was 0.45)
    armRX = lerp(0.10, -0.10, ph.e);   // arms tuck back and up toward body
    armRY = lerp(0.10, 0.50, ph.e);
    armLX = lerp(-0.10, -0.20, ph.e);
    armLY = lerp(0.10, 0.50, ph.e);
  } else if (ph.p === 1) {
    // Strike: legs spear straight down-forward, arms thrust back for streamline
    legRX = lerp(0.35, 0.30, ph.e);   // legs converge at spear point
    legRY = lerp(0.10, -0.30, ph.e);  // drive downward
    legLX = lerp(0.28, 0.25, ph.e);
    legLY = lerp(0.10, -0.30, ph.e);
    leanZ = lerp(0.70, 0.70, ph.e);   // hold the peak pitch through contact
    armRX = lerp(-0.10, -0.25, ph.e); // arms fully swept back for dive shape
    armRY = lerp(0.50, 0.30, ph.e);
    armLX = lerp(-0.20, -0.35, ph.e);
    armLY = lerp(0.50, 0.30, ph.e);
  } else {
    // Recover: legs spread to catch, body straightens, arms come back out
    legRX = lerp(0.30, 0.20, ph.e);
    legRY = lerp(-0.30, 0, ph.e);
    legLX = lerp(0.25, -0.20, ph.e);
    legLY = lerp(-0.30, 0, ph.e);
    leanZ = lerp(0.70, 0, ph.e);
    armRX = lerp(-0.25, -0.15, ph.e);
    armRY = lerp(0.30, 0.20, ph.e);
    armLX = lerp(-0.35, -0.25, ph.e);
    armLY = lerp(0.30, 0.20, ph.e);
  }
  return { legRX, legRY, legLX, legLY, leanZ, armRX, armRY, armLX, armLY };
}

function poseSlideKick(rig, params) {
  // Sliding low kick — body horizontal (slide). Foot spears out long and low
  // on active frames then retracts. Snappier + longer extension than before.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  // Snappier: arc peaks faster (window 0.08→0.72 instead of 0.10→0.90)
  // and uses ease-out cubic for explosive extension, ease-in for retract.
  const rawArc = clamp((t - 0.08) / 0.64, 0, 1);
  // Ease-out extend (t < 0.5) + ease-in retract (t > 0.5): smooth peak
  const arcBlend = rawArc < 0.5
    ? 1 - Math.pow(1 - rawArc * 2, 3) // ease-out into peak
    : Math.pow(2 - rawArc * 2, 2) * 0.5 + 0.5; // ease-in from peak (actually we want descend)
  // Actually: just sin arc — but shifted so the peak hits earlier and the
  // retract is slower (foot lingers at extension then pulls back).
  const arc = Math.sin(Math.PI * clamp((t - 0.08) / 0.72, 0, 1));
  // legRX is the forward reach from hip (facing-sign applied by rig).
  // Budget: sqrt(legRX²+legRY²) < 1.0. legRY≈-0.42 so legRX must stay <0.91.
  // legRX at peak: 0.20 + 0.70 = 0.90; combined: sqrt(0.90²+0.42²) ≈ 0.994 ✓
  const legRX = 0.20 + arc * 0.70;    // spear extends forward (budget-safe)
  const legRY = -0.42 + arc * 0.08;   // stays low, slight rise at peak
  // leanZ budget ±1.0 — clamp -PI/3 ≈ -1.047 → use -0.95
  const leanZ = -0.95 + arc * 0.18;   // horizontal body tilt (budget-safe)
  return {
    legRX, legRY,
    legLX: -0.20, legLY: -0.08,  // trail leg tucks back
    leanZ,
    armRX: -0.35, armRY: 0.12,   // arms trail back (aerodynamic slide posture)
    armLX: -0.25, armLY: 0.08,
  };
}

// Strike pose functions keyed on moveId.
const STRIKE_POSES = {
  jab:          poseJab,
  cross:        poseCross,
  hook:         poseHook,
  knee:         poseKnee,
  spinBack:     poseSpinBack,
  heavyNeutral: poseBlowAway,
  heavyUp:      poseUppercut,
  heavyDown:    poseAxe,
  heavyForward: poseCharge,
  heavyBack:    poseCounterStance,
  airJab:       poseFlyingKnee,
  airHook:      poseAirHook,
  airHeavyN:    poseSomersault,
  airHeavyU:    poseRisingKnee,
  airHeavyD:    poseDive,
  slideKick:    poseSlideKick,
};

export class StickmanRig {
  constructor({ primary = 0xffcc33, accent = 0x1a1a2e } = {}) {
    this.group = new THREE.Group();
    this.primary = primary;
    this.accent = accent;

    // Single shared material for the whole figure (silhouette feel).
    // PBR (Standard) gives the body a subtle sheen + responds to fills.
    // Only 4 players × 1 material = 4 PBR materials total. Tiles stay
    // Lambert because there are hundreds of them and PBR per-pixel on
    // floor surfaces was the biggest fragment cost.
    const mat = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.55, metalness: 0.05 });
    this.material = mat;

    // Head — slightly larger so silhouette reads.
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 14), mat);
    this.head.castShadow = true;
    this.group.add(this.head);

    // Torso — beefier cylinder.
    this.torso = makeLimb(0.18, 0.65, mat);
    this.group.add(this.torso);

    // Limbs — moderately thick. Arms 0.45+0.45 = 0.90m max reach so the
    // biggest strike poses (≈1.20m offset) still hit near-full extension
    // after the maxReach clamp in _drawArm. Old 0.34+0.34 = 0.67m silently
    // truncated big swings to half-amplitude — strikes looked weak. Fist
    // sphere (radius 0.13) adds another ~0.13m of perceived reach.
    this.upperArmL = makeLimb(0.10, 0.45, mat);
    this.lowerArmL = makeLimb(0.09, 0.45, mat);
    this.upperArmR = makeLimb(0.10, 0.45, mat);
    this.lowerArmR = makeLimb(0.09, 0.45, mat);
    // Each leg = 0.50 + 0.50 = 1.00m total — long enough for the taller body
    // (capsule height 1.5) so legs read as straight when standing and bend
    // visibly during stride/run instead of collapsing into a deep squat.
    this.upperLegL = makeLimb(0.13, 0.50, mat);
    this.lowerLegL = makeLimb(0.11, 0.50, mat);
    this.upperLegR = makeLimb(0.13, 0.50, mat);
    this.lowerLegR = makeLimb(0.11, 0.50, mat);
    // Lower-limb shadows are silhouette-redundant with the uppers (light
    // angle is high, lowers sit within upper-shadow penumbra). Each cast
    // saved = one less geo in the shadow-map pass per char per frame.
    // 4 char × 4 lowers = 16 fewer shadow draws/frame at zoom-out.
    this.lowerArmL.castShadow = false;
    this.lowerArmR.castShadow = false;
    this.lowerLegL.castShadow = false;
    this.lowerLegR.castShadow = false;

    // Joint spheres — visible at every joint so the rig reads cleanly.
    // castShadow defaults to false: small spheres add shadow draw calls without
    // changing silhouette (limbs already cast). Segments dropped 12,10 → 8,6
    // — at <0.15m radius the difference is invisible past 2m.
    const joint = (r) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);
      return m;
    };
    this.shoulderL = joint(0.10);
    this.shoulderR = joint(0.10);
    this.elbowL = joint(0.09);
    this.elbowR = joint(0.09);
    this.hipL = joint(0.13);
    this.hipR = joint(0.13);
    this.kneeL = joint(0.11);
    this.kneeR = joint(0.11);

    // Hands & feet — bigger end-caps.
    this.handL = joint(0.13);
    this.handR = joint(0.13);
    this.footL = joint(0.15);
    this.footR = joint(0.15);

    [this.upperArmL, this.lowerArmL, this.upperArmR, this.lowerArmR,
     this.upperLegL, this.lowerLegL, this.upperLegR, this.lowerLegR,
     this.shoulderL, this.shoulderR, this.elbowL, this.elbowR,
     this.hipL, this.hipR, this.kneeL, this.kneeR,
     this.handL, this.handR, this.footL, this.footR,
    ].forEach(m => this.group.add(m));

    // Optional armor chestplate — PBR for proper metallic sheen.
    this.chestArmor = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.46, 0.32),
      new THREE.MeshStandardMaterial({ color: 0xa0a8b8, metalness: 0.7, roughness: 0.4 }),
    );
    // Armor sits in torso silhouette — shadow contribution is invisible.
    this.chestArmor.castShadow = false;
    this.chestArmor.visible = false;
    this.group.add(this.chestArmor);

    // Anim state
    this.t = 0;
    this.walkPhase = 0;
    this.facing = 1;
    this.ragdollAmount = 0;
    this.bodyTilt = 0;
    this.bodyTiltTarget = 0;
    this.squash = 1;
    this.hitTilt = 0;
    this.crouchAmount = 0;
    // Landing impact — spike on grounded transition with downward velocity,
    // decays via damp. Drives squash + knee-bend on touchdown.
    this._landImpact = 0;
    this._wasGrounded = true;
    // Idle breathing phase — slow sine drives hip/torso/arm micro-motion
    // when standing still so the stance never feels frozen.
    this._breath = 0;
    // Jump takeoff crouch — set on grounded→airborne for a brief pre-compress.
    // Decays fast so it reads as a quick crouch→stretch, not a delayed jump.
    this._takeoffCrouch = 0;

    // Throw windup arm rear-back amount, 0..1. Driven by Stickman via params.
    this._throwAnticipation = 0;

    // Head pitch — extra rotation.x applied on top of aim.y.
    // Used by slide (looking forward despite pitched body).
    this.headPitch = 0;
    this.headPitchTarget = 0;

    // Slide pose state — set each frame when sliding, cleared after use.
    this._slideArmDrift = false;
    this._slideLeadX = 0;
    this._slideTrailX = 0;

    // Prone loose-limb gate — set true on prone tick, cleared at end of frame.
    this._proneLooseLimbs = false;

    // Reused vectors / state
    this._hip = new THREE.Vector3();
    this._headLagX = 0; this._headLagY = 0;
    this._lastVx = 0; this._lastVy = 0;
    this._handJiggle = 0;
    // Torso wobble — control center is upper body; lower body (legs) stays
    // planted while torso/head trail with spring-damped lag.
    this._torsoOffsetX = 0;
    this._torsoOffsetY = 0;
    this._torsoVelX = 0;
    this._torsoVelY = 0;

    // Spring chases on hands & feet — calm so it doesn't look broken.
    this._handLPos = new THREE.Vector3();
    this._handLVel = new THREE.Vector3();
    this._handRPos = new THREE.Vector3();
    this._handRVel = new THREE.Vector3();
    this._footLPos = new THREE.Vector3();
    this._footLVel = new THREE.Vector3();
    this._footRPos = new THREE.Vector3();
    this._footRVel = new THREE.Vector3();
    this._springInit = false;

    // World-anchored plant state — feet stay fixed in world while planted, swing
    // through an arc to a forward plant when lifting. Body moves OVER the foot.
    this._plantLX = 0; this._plantRX = 0;
    this._stepInit = false;

    // Scratch
    this._tmpKnee = { x: 0, y: 0 };
    this._sweepOut = { x: 0, y: 0 };
  }

  resetSprings() {
    this._springInit = false;
    this._stepInit = false;
    this._handLVel.set(0, 0, 0);
    this._handRVel.set(0, 0, 0);
    this._footLVel.set(0, 0, 0);
    this._footRVel.set(0, 0, 0);
  }

  setArmor(amount) {
    this.chestArmor.visible = amount > 0;
    if (amount > 0) {
      const f = Math.min(1, amount / 60);
      this.chestArmor.material.color.setHex(f > 0.66 ? 0xffcc66 : 0xa0a8b8);
    }
  }

  flinch(fromDirX, intensity = 1) {
    this.hitTilt = clamp(-fromDirX * intensity * 0.6, -0.7, 0.7);
  }

  // One-frame positional impulse on the head's lag offsets. Driven by
  // Stickman.headSnap when a projectile lands a headshot. The next damp()
  // tick eases _headLagX/Y back toward their target — that smooth settle
  // reads as a snap-back to the player.
  kickHead(ix, iy) {
    this._headLagX += ix;
    this._headLagY += iy;
  }

  // pos: world-space body center (or {0,0,0} when ragdolled — the group carries the body transform).
  update(pos, params) {
    const dt = params.dt || 0.016;
    this.t += dt;
    this.facing = params.facing >= 0 ? 1 : -1;
    this.ragdollAmount = damp(this.ragdollAmount, params.ragdollAmount ?? 0, 0.0001, dt);

    // Crouch amount: 1 for static crouch, 1.4 for slide (deeper collapse).
    const crouchTarget = params.sliding ? 1.4 : (params.crouching ? 1 : 0);
    this.crouchAmount = damp(this.crouchAmount, crouchTarget, 0.0001, dt);

    const speed = params.moveX || 0;
    const speedMag = Math.abs(speed);
    const vy = params.vy || 0;

    // Resolve strike pose early so body-tilt branches know whether a move owns
    // the lean. `params.moveId` set → pose drives bodyTilt directly (snap, no
    // damp lag), and we skip the generic params.attack lean to avoid the
    // two-systems-fighting double-count.
    const moveId = params.moveId;
    const strikePose = moveId ? STRIKE_POSES[moveId]?.(this, params) : null;
    this._strikePose = strikePose; // expose to leg/arm code below without reresolving

    // Body tilt — stronger forward lean when sprinting.
    this.bodyTiltTarget = clamp(speed * (ANIM.RUN_LEAN ?? 0.28), -0.6, 0.6);
    if (strikePose) {
      // Move-driven lean owns the body. Generic attack lean is skipped.
    } else if (params.attack) {
      // Phase-aware attack lean for unposed swings (weapons / legacy attack path).
      const att = clamp(params.attackProgress ?? 0, 0, 1);
      let attackLean;
      if (att < 0.22) attackLean = lerp(0, -0.22, att / 0.22);
      else if (att < 0.55) attackLean = lerp(-0.22, 0.45, (att - 0.22) / 0.33);
      else attackLean = lerp(0.45, 0.0, (att - 0.55) / 0.45);
      this.bodyTiltTarget += this.facing * attackLean;
    }
    this.bodyTiltTarget += this.hitTilt;

    // Slide pose — body pitches forward, head looks forward, arms trail.
    // Activates whenever params.sliding is true and not in a strike-pose
    // that already drives the body (slideKick uses its own leg arc on top
    // of this).
    if (params.sliding) {
      this.bodyTiltTarget = this.facing * (-Math.PI / 3);
      // Lead leg extends forward (1.3 reach from hip).
      const lead = 1.30 * this.facing;
      // Trail leg tucks under (knee toward chest).
      const trail = -0.20 * this.facing;
      // Arms drift back + slightly up (override walk targets later).
      this._slideArmDrift = true;
      this._slideLeadX = lead;
      this._slideTrailX = trail;
      // Head looks forward despite body pitch.
      this.headPitchTarget = 0.25;
    } else {
      this._slideArmDrift = false;
    }

    // Prone crouch — body lays near-horizontal.
    if (params.prone) {
      const bob = Math.sin(performance.now() * 0.003) * 0.04;
      this.bodyTiltTarget = this.facing * (-Math.PI / 2) + bob;
      this._proneLooseLimbs = true;
    } else {
      this._proneLooseLimbs = false;
    }

    // Strike-driven lean snaps directly so the rear-back / lunge / follow-through
    // arc actually arrives inside the move's duration. Damp at 0.0001 closes ~14%
    // of the gap per 60 fps frame; a 0.22 s jab ends before lean catches up.
    if (strikePose && strikePose.leanZ !== undefined) {
      // Pose contributes leanZ — apply on top of base lean, snap directly.
      this.bodyTilt = this.bodyTiltTarget + this.facing * strikePose.leanZ;
    } else {
      this.bodyTilt = damp(this.bodyTilt, this.bodyTiltTarget, ANIM.TILT_LAMBDA ?? 0.0001, dt);
    }
    this.hitTilt = damp(this.hitTilt, 0, 0.001, dt);

    // Landing impact — capture fall speed exactly on the airborne→grounded
    // transition. Heavier falls = bigger squash. Decays over ~0.35s.
    if (params.grounded && !this._wasGrounded) {
      // Use last frame's downward vy as impact intensity (vy here can already
      // be 0 if physics resolved on this tick, so use _lastVy fallback).
      const impactVy = Math.min(0, this._lastVy * 7.5);
      this._landImpact = clamp(-impactVy * 0.06 * (ANIM.LAND_WEIGHT ?? 1), 0, 1.3);
    } else if (!params.grounded && this._wasGrounded && vy > 2) {
      // Takeoff — quick upward stretch pulse as the legs push off, so jumps
      // launch with snap instead of a constant pose.
      this._takeoffPop = (ANIM.TAKEOFF_POP ?? 0.22);
      // Brief leg pre-compress: hip dips for ~2 frames then releases into the
      // stretch. Starts positive (crouch), decays very fast. Does NOT add input
      // latency — the impulse has already fired; this is cosmetic only.
      this._takeoffCrouch = (ANIM.TAKEOFF_CROUCH ?? 0.10);
    }
    this._wasGrounded = params.grounded;
    this._landImpact = damp(this._landImpact, 0, 0.0001, dt); // fast decay
    if (this._takeoffPop === undefined) this._takeoffPop = 0;
    this._takeoffPop = damp(this._takeoffPop, 0, 0.0002, dt); // ~0.2s pop
    if (this._takeoffCrouch === undefined) this._takeoffCrouch = 0;
    this._takeoffCrouch = damp(this._takeoffCrouch, 0, 0.00008, dt); // fast ~2-frame decay

    // Idle breathing — slow sine when standing still so the stance breathes
    // rather than freezes. Phase advances regardless; amplitude gates on idle.
    this._breath += dt * 1.6;
    const idle = params.grounded && speedMag < 0.05 && Math.abs(vy) < 0.5
      && !params.attack && !params.kicking && this.crouchAmount < 0.1
      && (params.armPoseR === 'walk' || params.armPoseR === undefined);
    const breathAmt = idle ? 1 : 0.15;
    const breathBob = Math.sin(this._breath) * 0.025 * breathAmt;

    // Squash — stretch up while rising, compress on land/crouch. Land impact
    // adds extra knee-bend that springs back so touchdowns feel weighty.
    let squashTarget = 1;
    if (params.grounded && Math.abs(vy) < 0.5) squashTarget = 1 - speedMag * 0.04;
    else if (!params.grounded) squashTarget = 1 + clamp(vy * 0.022, -0.15, 0.2);
    squashTarget *= 1 - this.crouchAmount * 0.45;
    squashTarget *= 1 - this._landImpact * 0.32;
    // Contact spike — decays fast (~0.18 s) and pulls a quick vertical squash
    // out of the rig on hits taken/landed. Reads as a recoil pop on the
    // fighter the moment the hit registers.
    if (this._hitSquash === undefined) this._hitSquash = 0;
    this._hitSquash = damp(this._hitSquash, 0, 0.00005, dt);
    squashTarget *= 1 - this._hitSquash * 0.18;
    squashTarget += this._takeoffPop;   // stretch up on jump takeoff
    this.squash = damp(this.squash, squashTarget, ANIM.SQUASH_LAMBDA ?? 0.0008, dt);

    // Throw windup — Stickman sets params.throwWindup 0..1 to telegraph a throw.
    this._throwAnticipation = damp(this._throwAnticipation, params.throwWindup ?? 0, 0.0004, dt);

    // Walk cadence — phase rate matches actual ground speed so each foot
    // plants where the body is going, not behind it. This is the fix for
    // the "feet dragging" feel: cycle time = 2*stride / body_speed, so a
    // step always advances by `stride` and the body moves smoothly over it.
    // `speed` here is body.velocity.x / 5.5 (normalized in caller).
    const realSpeed = Math.abs(speed) * 5.5;
    const targetStride = clamp(realSpeed * 0.10 + 0.20, 0.20, 0.65);
    if (params.grounded && realSpeed > 0.5) {
      // phase 2π = full L+R cycle = 2 * stride covered. So rate = π * v / stride.
      this.walkPhase += dt * (Math.PI * realSpeed / targetStride);
    } else if (!params.grounded) {
      this.walkPhase += dt * 6;
    } else {
      // Idle: slow drift just to keep arms breathing. IDLE_DRIFT calms it.
      this.walkPhase += dt * 1.0 * (ANIM.IDLE_DRIFT ?? 1);
    }
    // Expose for the leg-target code below.
    this._targetStride = targetStride;
    this._realSpeed = realSpeed;

    // Hip in WORLD or LOCAL space (caller decides via pos).
    // Hip bob: vertical bounce — one dip per step. Run gets a heavier bounce.
    const runBoost = clamp(speedMag * 1.2, 0, 1.0);
    const bob = (params.grounded ? Math.abs(Math.sin(this.walkPhase)) : 0) * speedMag * (ANIM.BOB_AMT ?? 0.10) * (1 + runBoost * 0.4);
    const crouchDrop = this.crouchAmount * 0.5;
    const landDrop = this._landImpact * 0.22;   // hip dips on touchdown (weight)
    // Takeoff crouch: brief hip-dip (~2 frames) before takeoff stretch.
    // Reads as legs compressing before push-off. Decays very fast so it
    // doesn't linger into the air or affect apex feel.
    const takeoffCrouchDrop = (this._takeoffCrouch ?? 0) * 0.18;
    // Hip sway: pelvis shifts toward the planted foot each step. Scales with
    // speed so it's invisible at idle but clearly reads at walk/run. The sin()
    // peak at phase=π/2 (foot planted) shifts hip toward stance side.
    // Facing-signed so it mirrors correctly when facing left.
    const hipSway = Math.sin(this.walkPhase) * speedMag * (ANIM.WALK_HIP_SWAY ?? 0.06) * this.facing;
    const hipX = pos.x + (params.grounded ? hipSway : 0);
    // Hip-foot reach budget: feet sit at pos.y - 0.75 (capsule bottom).
    // Legs are 1.00m total. Hip at pos.y + 0.25 → diff 1.00m → legs read
    // essentially straight at idle (IK clamps to maxReach 0.99). Bob/crouch
    // /land drop hip from there to flex knees on impact and during stride.
    const hipY = pos.y + 0.25 - bob - crouchDrop - landDrop - takeoffCrouchDrop + breathBob;
    const hipZ = pos.z;
    this._hip.set(hipX, hipY, hipZ);

    // Shoulder counter-rotation against stride so arm pump reads as
    // articulated. Pelvis itself stays at fixed ±0.16 stance width — a
    // 3D pelvic-twist projects mostly to Z (in/out of screen) in side view,
    // so faking it as an X shift collapses the hips toward center on each
    // peak and looked broken. Shoulders still get the counter-sway.
    const shoulderTwist = Math.sin(this.walkPhase) * speedMag * 0.10 * this.facing;
    const pelvicSgn = Math.sin(this.walkPhase);
    const pelvicLift = Math.abs(pelvicSgn) * speedMag * 0.04;
    // Torso wobble: opposite-impulse from body acceleration, spring-back to 0.
    const accelX = (speed - this._lastVx) / Math.max(1e-3, dt);
    const accelY = (vy - this._lastVy * 7.5) / Math.max(1e-3, dt);
    this._torsoVelX -= accelX * 0.035;
    this._torsoVelY -= accelY * 0.012;
    // Softer spring + lower damping = more visible wobble.
    const torsoSprK = 50, torsoSprD = 4;
    this._torsoVelX += -this._torsoOffsetX * torsoSprK * dt;
    this._torsoVelY += -this._torsoOffsetY * torsoSprK * dt;
    const torsoDamp = Math.exp(-torsoSprD * dt);
    this._torsoVelX *= torsoDamp;
    this._torsoVelY *= torsoDamp;
    this._torsoOffsetX += this._torsoVelX * dt;
    this._torsoOffsetY += this._torsoVelY * dt;
    // Clamp so torso never flies off
    this._torsoOffsetX = clamp(this._torsoOffsetX, -0.4, 0.4);
    this._torsoOffsetY = clamp(this._torsoOffsetY, -0.3, 0.3);

    // Grab struggle — quick shake scaling with escape progress so a grabbed
    // player visibly fights to get free.
    const struggle = params.struggle ?? 0;
    if (struggle > 0.01) {
      const s = Math.sin(this.t * 40) * struggle * 0.18;
      this.bodyTilt += s;
      this._torsoOffsetX += Math.sin(this.t * 33) * struggle * 0.06;
    }

    // Torso direction (with wobble offset on torso tip)
    const torsoUpX = Math.sin(this.bodyTilt);
    const torsoUpY = Math.cos(this.bodyTilt);
    const torsoLen = 0.65 * this.squash;
    const torsoTipX = hipX + torsoUpX * torsoLen + this._torsoOffsetX;
    const torsoTipY = hipY + torsoUpY * torsoLen + this._torsoOffsetY;
    orientLimb(this.torso, hipX, hipY, hipZ, torsoTipX, torsoTipY, hipZ);

    // Shoulder, head — also offset by torso wobble (so they trail with torso).
    const shoulderCenterX = hipX + torsoUpX * (0.55 * this.squash) + this._torsoOffsetX * 0.85;
    const shoulderCenterY = hipY + torsoUpY * (0.55 * this.squash) + this._torsoOffsetY * 0.85;
    const headX = hipX + torsoUpX * (0.95 * this.squash) + this._torsoOffsetX * 1.0;
    const headY = hipY + torsoUpY * (0.95 * this.squash) + this._torsoOffsetY * 1.0;

    // Velocity-based head lag
    const targetLagX = -speed * 0.18;
    const targetLagY = -clamp(vy * 0.012, -0.18, 0.18);
    this._headLagX = damp(this._headLagX, targetLagX, 0.0008, dt);
    this._headLagY = damp(this._headLagY, targetLagY, 0.0008, dt);
    this.head.position.set(headX + this._headLagX, headY + this._headLagY, hipZ);
    // Floor clamp — prevent head sphere from dipping below ground on
    // big lunges, somersaults, or post-knockdown sprawl. Vertical
    // down-ray only; horizontal walls are already handled by body
    // capsule + arm/leg sweeps (head shoulder is rigidly attached
    // ~0.95m above torso, can't reach a wall the body hasn't).
    if (params.physics && params.physics.raycast) {
      const HEAD_RADIUS = 0.34; // matches SphereGeometry(0.34) in constructor
      const ox = params.worldOriginX ?? 0;
      const oy = params.worldOriginY ?? 0;
      const headWorldX = ox + this.head.position.x;
      const headWorldY = oy + this.head.position.y;
      const floor = params.physics.raycast(
        { x: headWorldX, y: headWorldY, z: 0 },
        { x: headWorldX, y: headWorldY - (HEAD_RADIUS + 0.20), z: 0 },
        { mask: WORLD_MASK },
      );
      if (floor && floor.hitPointWorld) {
        const minLocalY = (floor.hitPointWorld.y + HEAD_RADIUS + LIMB_PAD) - oy;
        if (this.head.position.y < minLocalY) {
          this.head.position.y = minLocalY;
        }
      }
    }
    this.headPitch = damp(this.headPitch, this.headPitchTarget, 0.0008, dt);
    this.headPitchTarget = 0; // reset each frame — callers set it before the head render
    this.head.rotation.set((params.aim?.y ?? 0) * 0.4 + this.headPitch, this.facing < 0 ? Math.PI : 0, this.bodyTilt * 0.5);

    if (this.chestArmor.visible) {
      const cx = hipX + torsoUpX * (0.35 * this.squash);
      const cy = hipY + torsoUpY * (0.35 * this.squash);
      this.chestArmor.position.set(cx, cy, hipZ);
      this.chestArmor.rotation.set(0, 0, this.bodyTilt);
    }

    // Hand jiggle from velocity changes
    const accelMag = Math.abs(speed - this._lastVx) + Math.abs(vy / 7.5 - this._lastVy);
    this._handJiggle = damp(this._handJiggle, 0, 0.0003, dt);
    if (accelMag > 0.1) this._handJiggle = clamp(this._handJiggle + accelMag * 0.5, 0, 0.35);
    this._lastVx = speed;
    this._lastVy = vy / 7.5;

    // Walk-cycle leg targets
    const phase = this.walkPhase;
    // Bigger stride amplitude — feet swing further during run.
    const stepAmp = clamp(speedMag * 0.85, 0, 0.95);
    const swingDir = Math.sign(speed * this.facing) || 1;
    // Feet rest on capsule bottom (world-fixed relative to body center). Bob
    // and crouchDrop only move the upper body — feet stay planted on ground.
    // Capsule half-height = 0.75 so feet at pos.y - 0.75 sit on the floor.
    const baseFootY = pos.y - 0.75 + this.crouchAmount * 0.10;

    // Wider hip stance so both legs are visible alongside the torso.
    // Swing-side hip lifts slightly with the knee drive (pelvicLift).
    const hipLX = hipX - 0.16;
    const hipRX = hipX + 0.16;
    const hipLY = hipY + (pelvicSgn < 0 ? pelvicLift : 0);
    const hipRY = hipY + (pelvicSgn > 0 ? pelvicLift : 0);

    let footLX, footLY, footRX, footRY;
    if (!params.grounded) {
      // Four phases driven by vy for a more expressive airborne pose:
      //   launch  vy > 5      : strong push-off stretch — legs trail behind, extended
      //   rise    vy in [1,5] : transitioning into tuck
      //   apex    vy in [-2,1]: DEEP tuck — knees pulled up to chest, forward curl
      //   fall    vy < -2     : legs reach FORWARD and DOWN to brace landing
      // The tuck at apex is now much more dramatic (knees genuinely up),
      // and the reaching fall has both legs spread forward for a weighty catch.
      let liftN, footFwd, spreadX;
      if (vy > 5) {
        // Launch stretch: legs push down and trail behind (extending the push)
        const tl = clamp((vy - 5) / 5, 0, 1);
        liftN = lerp(0.50, 0.12, tl);   // feet near ground level (push-off extension)
        footFwd = lerp(0, -0.08, tl);   // feet slightly behind body (trail)
        spreadX = lerp(0.16, 0.12, tl); // normal stance width
      } else if (vy >= 1) {
        // Rising: legs pull up, transitioning into tuck
        const tl = clamp((5 - vy) / 4, 0, 1);
        liftN = lerp(0.50, 0.68, tl);   // feet rising toward chest
        footFwd = 0;
        spreadX = 0.16;
      } else if (vy >= -2) {
        // APEX TUCK: knees pulled up close to chest — most expressive phase
        const tl = clamp((1 - vy) / 3, 0, 1);
        liftN = lerp(0.68, 0.72, tl);   // deep tuck — feet near hip height
        footFwd = lerp(0, 0.04, tl);    // feet slightly forward (fetal curl)
        spreadX = lerp(0.16, 0.18, tl); // feet spread slightly at apex
      } else {
        // FALL reach: legs extend forward and down to catch the landing
        const tl = clamp((-vy - 2) / 7, 0, 1);
        liftN = lerp(0.72, 0.08, tl);   // feet drop from tuck toward ground
        footFwd = lerp(0.04, 0.22, tl); // feet reach FORWARD to brace
        spreadX = lerp(0.18, 0.22, tl); // feet spread wider (stable landing base)
      }
      footLX = hipX - spreadX + this.facing * footFwd;
      footRX = hipX + spreadX + this.facing * footFwd;
      footLY = baseFootY + liftN;
      footRY = baseFootY + liftN;
    } else if ((this._realSpeed ?? 0) < 0.5) {
      // Standing: feet snap to rest under hips. No phantom shuffle.
      const restL = hipX - 0.16;
      const restR = hipX + 0.16;
      this._plantLX = damp(this._plantLX, restL, 0.0001, dt);
      this._plantRX = damp(this._plantRX, restR, 0.0001, dt);
      footLX = this._plantLX;
      footRX = this._plantRX;
      footLY = baseFootY;
      footRY = baseFootY;
      this._stepInit = false; // reset so next step starts clean
    } else {
      // Run cycle — stance fraction shrinks with speed, opening a brief
      // flight phase at sprint where neither foot is planted. Each foot
      // has its own stance window: L starts at phase 0, R at phase π.
      if (!this._stepInit) {
        this._plantLX = hipX - 0.16;
        this._plantRX = hipX + 0.16;
        this._stepInit = true;
      }
      const phaseMod = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const stanceFrac = clamp(0.5 - speedMag * 0.22, 0.32, 0.5);
      const stanceLen = Math.PI * 2 * stanceFrac;
      const swingLen = Math.PI * 2 - stanceLen;

      // null = in stance, else swing progress 0..1.
      const swingT = (start) => {
        let d = phaseMod - start;
        while (d < 0) d += Math.PI * 2;
        if (d < stanceLen) return null;
        return (d - stanceLen) / swingLen;
      };

      const stride = this._targetStride ?? (stepAmp * 0.45);
      // Foot lift in meters. With hip-foot reach 0.97m standing, lifting
      // 0.30 leaves 0.67m diff = 96° knee bend = visible knee drive.
      // Sprint peak 0.42 gives a tight athletic tuck.
      const liftAmp = 0.12 + stepAmp * 0.30;
      const maxDrag = stride * 0.8;

      if (this._plantLX < hipX - maxDrag) this._plantLX = hipX - maxDrag;
      if (this._plantLX > hipX + maxDrag) this._plantLX = hipX + maxDrag;
      if (this._plantRX < hipX - maxDrag) this._plantRX = hipX - maxDrag;
      if (this._plantRX > hipX + maxDrag) this._plantRX = hipX + maxDrag;

      // Asymmetric arcs — reworked for a confident, weighted stride:
      //   yArc — contact phase: foot lifts FAST (quick toe-off), peaks early at
      //          t≈0.28 (passing phase), then drops steadily for a clean heel-strike.
      //          The fast lift + sharp peak reads as a purposeful knee drive rather
      //          than a flat shuffle. Math: pow(t,0.5) shifts peak earlier than
      //          the previous pow(t,0.7); the full sin arc closes cleanly.
      //   xArc — forward travel: foot stays behind on initial lift (heel peels off),
      //          then accelerates forward in the second half for a confident plant.
      //          Old cubic was t²(1.6-0.6t) — still an ease-in. New version adds a
      //          slight shoulder to better simulate the foot hanging behind then
      //          snapping forward (pendulum swing feel).
      const yArc = (t) => Math.sin(Math.pow(t, 0.50) * Math.PI);
      const xArc = (t) => {
        // Ease-in-out with bias toward late: foot hangs back ~40% of swing,
        // then swoops forward into plant. Cleaner weight-shift reading.
        const c = t * t * (3 - 2 * t); // smoothstep base
        return c * c * (1 + (1 - c) * 0.6); // add late-swing acceleration
      };

      const tL = swingT(0);
      if (tL === null) {
        footLX = this._plantLX;
        footLY = baseFootY;
      } else {
        const target = hipLX + this.facing * stride * 0.5;
        footLX = lerp(this._plantLX, target, xArc(tL));
        footLY = baseFootY + yArc(tL) * liftAmp;
        if (tL > 0.98) this._plantLX = target;
      }

      const tR = swingT(Math.PI);
      if (tR === null) {
        footRX = this._plantRX;
        footRY = baseFootY;
      } else {
        const target = hipRX + this.facing * stride * 0.5;
        footRX = lerp(this._plantRX, target, xArc(tR));
        footRY = baseFootY + yArc(tR) * liftAmp;
        if (tR > 0.98) this._plantRX = target;
      }
    }

    // KICK — combo step 3 whips the right leg forward in a quick arc that
    // overrides the walk plant so the foot reaches well past the body.
    if (params.kicking) {
      const k = clamp(params.attackProgress ?? 0, 0, 1);
      const arc = Math.sin(k * Math.PI);
      footRX = hipX + this.facing * (0.20 + arc * 1.05);
      footRY = baseFootY + 0.10 + arc * 0.55;
      // Plant the LEFT foot firmly under the body so the kick has a base.
      footLX = hipX - 0.16 - this.facing * 0.10;
      footLY = baseFootY;
      this._plantRX = hipX + this.facing * 0.20; // reset plant for after kick
      this._plantLX = footLX;
    }

    // Slide foot stance — lock foot poses to slide stance.
    if (params.sliding && !params.moveId) {
      footRX = hipX + this._slideLeadX;
      footRY = baseFootY - 0.15;
      footLX = hipX + this._slideTrailX;
      footLY = baseFootY - 0.10;
    }

    // strikePose was resolved at the top of update() so the body-tilt block
    // could see it. Reuse the cached value here for leg/arm overrides.

    // Strike pose leg overrides (e.g. knee, flying-knee, dive, slide-kick).
    // These run AFTER kicking so pose-specific arcs take precedence.
    if (strikePose) {
      const _sr = ANIM.STRIKE_REACH ?? 1;
      if (strikePose.legRX !== undefined) {
        footRX = hipX + this.facing * strikePose.legRX * _sr;
        footRY = baseFootY + strikePose.legRY * _sr;
        this._plantRX = hipX + this.facing * 0.20;
      }
      if (strikePose.legLX !== undefined) {
        footLX = hipX + this.facing * strikePose.legLX * _sr;
        footLY = baseFootY + strikePose.legLY * _sr;
        this._plantLX = footLX;
      }
      // Weight-shift footwork: drive plant foot forward during strike phase
      // and rear-back during windup. Sells the hip rotation behind every
      // swing instead of the upper body waving over still feet.
      if (strikePose.footShift !== undefined && params.grounded) {
        const fs = this.facing * strikePose.footShift;
        if (strikePose.legRX === undefined) {
          footRX += fs;
          this._plantRX = footRX;
        }
        if (strikePose.legLX === undefined) {
          footLX += fs;
          this._plantLX = footLX;
        }
      }
    }

    // Walk-cycle arm targets — shoulder roll twists shoulders opposite of hip
    // sway during run so torso reads as articulated, not a rigid plank.
    // Shoulders counter-rotate against pelvis: when R hip leads forward,
    // L shoulder leads forward (opposite-side coupling = natural run).
    const sLX = shoulderCenterX - 0.18 - shoulderTwist;
    const sRX = shoulderCenterX + 0.18 + shoulderTwist;
    const sLY = shoulderCenterY;
    const sRY = shoulderCenterY;

    const aim = params.aim || { x: 0, y: 0 };
    const aimAng = Math.atan2(aim.y, aim.x);
    // Aim arm is fully extended along the aim direction (close to maxReach
    // 0.88) like a melee strike pose. Reads as "weapon at full reach" — the
    // player can blind-fire over cover by extending the arm up and over.
    const aimDist = Math.min(0.85, Math.hypot(aim.x, aim.y) * 0.85 + 0.85);

    // STRIKE_POSES dispatcher — strikePose is already resolved above (hoisted
    // to fix TDZ); just apply arm override here if the pose defines one.
    if (strikePose && strikePose.armRX !== undefined) {
      // Override right-arm pose with strike-specific arc.
      // Mutate params so the branch below skips the old 'attack' arc.
      params.armPoseR = 'strikePosed';
    }

    let handRX, handRY;
    if (params.armPoseR === 'aim') {
      handRX = sRX + Math.cos(aimAng) * aimDist;
      handRY = sRY + Math.sin(aimAng) * aimDist;
      // Breathing sway: small low-frequency oscillation perpendicular to aim
      // direction so the gun hand has visible weight, not stuck-on-rails.
      // Spring stiffness reduction below lets motion + recoil also push
      // the hand around naturally.
      const breath = Math.sin(this.t * 1.6) * 0.015;
      handRX += -Math.sin(aimAng) * breath;
      handRY += Math.cos(aimAng) * breath;
    } else if (params.armPoseR === 'strikePosed') {
      // Pose offsets are absolute relative to shoulder. Lean is applied earlier
      // (snapped onto bodyTilt) so we don't repeat it here.
      const _sr = ANIM.STRIKE_REACH ?? 1;
      handRX = sRX + this.facing * strikePose.armRX * _sr;
      handRY = sRY + strikePose.armRY * _sr;
    } else if (params.armPoseR === 'attack') {
      // Three-phase swing: windup (rear back & up) → strike (whip through a
      // big arc, arm extends at peak) → follow-through (settle to neutral).
      // Angle convention: 0 rad = forward, +PI/2 = up, -PI/2 = down.
      const att = clamp(params.attackProgress ?? 0, 0, 1);
      let ang, reach;
      if (att < 0.22) {
        const w = att / 0.22;
        const e = 1 - Math.pow(1 - w, 3); // ease-out into windup
        ang = lerp(0.15, 2.5, e);          // forward → up-and-behind shoulder
        reach = lerp(0.55, 0.70, e);
      } else if (att < 0.55) {
        const w = (att - 0.22) / 0.33;
        const e = w * w * (3 - 2 * w);     // smoothstep through strike arc
        ang = lerp(2.5, -0.55, e);         // up-behind → forward-down
        reach = lerp(0.70, 1.00, e);       // arm extends as it whips through
      } else {
        const w = (att - 0.55) / 0.45;
        ang = lerp(-0.55, 0.15, w);
        reach = lerp(1.00, 0.55, w);
      }
      const stretch = params.gumGumPunch ? 4.5 * Math.sin(att * Math.PI) : 0;
      handRX = sRX + this.facing * (Math.cos(ang) * reach + stretch);
      handRY = sRY + Math.sin(ang) * reach;
    } else if (params.armPoseR === 'grab') {
      // Grab reach — arm extends fully forward with slight upward grip angle.
      // Anticipation: hand lunges out a touch farther than rest pose to sell
      // the reach. Held button keeps arm extended (defensive grip-ready).
      handRX = sRX + this.facing * 0.78;
      handRY = sRY + 0.12;
    } else if (params.armPoseR === 'hold' && params.holdPos) {
      // Grip at victim's upper-chest area, hand pulled slightly toward grabber
      // so it reads as "holding by the collar" not "groping at center mass."
      // Throw windup rears the arm back over the shoulder before launch.
      const gripX = params.holdPos.x - this.facing * 0.18;
      const gripY = params.holdPos.y + 0.42;
      const w = this._throwAnticipation;
      if (w > 0.02) {
        // Pull held entity back overhead — arm goes up-and-behind shoulder.
        const backX = sRX - this.facing * 0.55;
        const backY = sRY + 0.7;
        handRX = lerp(gripX, backX, w);
        handRY = lerp(gripY, backY, w);
      } else {
        handRX = gripX;
        handRY = gripY;
      }
    } else if (!params.grounded) {
      // Airborne arms — phase by vy, matching the new jump pose phases.
      // Launch: arms drive DOWN (counter to legs pushing up) — reads as spring-off.
      // Apex tuck: arms wrap IN toward body (fetal curl with the knees-up tuck).
      // Fall: arms spread OUT and slightly down — balance/catch posture.
      let armUpAir, armFwdAir;
      if (vy > 5) {
        // Launch stretch: arms drive down (opposite of leg push-off)
        const t = clamp((vy - 5) / 5, 0, 1);
        armUpAir = lerp(0.30, 0.55, t);   // rises during strong launch
        armFwdAir = lerp(0.25, 0.18, t);
      } else if (vy >= 1) {
        // Rising: arms lift to help with upward momentum
        const t = clamp((5 - vy) / 4, 0, 1);
        armUpAir = lerp(0.55, 0.18, t);
        armFwdAir = lerp(0.18, 0.30, t);
      } else if (vy >= -2) {
        // Apex tuck: arms pull slightly in + up (curl with the body)
        const t = clamp((1 - vy) / 3, 0, 1);
        armUpAir = lerp(0.18, 0.22, t);
        armFwdAir = lerp(0.30, 0.38, t);  // slightly forward at apex
      } else {
        // Fall reach: arms spread OUT and forward for balance/catch
        const t = clamp((-vy - 2) / 7, 0, 1);
        armUpAir = lerp(0.22, -0.08, t);  // drops as reaching for ground
        armFwdAir = lerp(0.38, 0.52, t);  // reaches more forward to brace
      }
      handRX = sRX + this.facing * armFwdAir;
      handRY = sRY + armUpAir;
    } else if (this.crouchAmount > 0.5 && params.armPoseR !== 'aim') {
      handRX = sRX + this.facing * 0.18;
      handRY = sRY - 0.25;
    } else {
      // Run arm — bent-elbow pump. Hand traces a forward+up arc on the
      // forward stroke (chin level) and a back+down arc on the back
      // stroke (hand drops past hip behind). Baseline blends to relaxed
      // hang at standstill: at runBlend=0, hand drops directly below
      // shoulder with no forward push so idle reads as relaxed-at-sides
      // instead of stiff-braced-forward.
      const _armSwingR = (ANIM.WALK_ARM_SWING ?? 1.0);
      const armSw = Math.sin(phase + Math.PI) * stepAmp * swingDir * _armSwingR;
      const fwdBoost = Math.max(0, armSw);
      const runBlend = clamp(stepAmp * 1.6, 0, 1);
      // Idle baseline at -0.88 (was -0.55): with arms 0.45+0.45 = 0.90m, a
      // -0.55 hang sits at 61 % extension → elbow bent 52°, which reads as
      // "always crouched and braced." Dropping to -0.88 puts the hand at
      // ~98 % extension → ~10° residual bend, i.e. arms hang straight at
      // the sides. Run baseline stays at -0.18 so the pump arc is unchanged.
      const baseUp = lerp(-0.88, -0.18, runBlend);
      const idleForward = lerp(0, 0.06, runBlend);
      const armForward = idleForward + armSw * 0.34 + fwdBoost * 0.10;
      const armUp = baseUp + armSw * 0.08 + fwdBoost * 0.34;
      handRX = sRX + this.facing * armForward;
      handRY = sRY + armUp;
    }

    let handLX, handLY;
    if (params.armPoseL === 'hold' && params.holdPos) {
      // Left as second grip (two-handed hold) — placed slightly lower than the
      // right grip so they don't overlap. Stickman sets armPoseL='hold' only
      // when explicitly two-handing; default carry leaves left to pump freely.
      handLX = params.holdPos.x - this.facing * 0.05;
      handLY = params.holdPos.y + 0.18;
    } else if (params.armPoseL === 'grab') {
      handLX = sLX + this.facing * 0.78;
      handLY = sLY + 0.12;
    } else if (params.armPoseL === 'aim') {
      handLX = sLX + Math.cos(aimAng) * aimDist * 0.7;
      handLY = sLY + Math.sin(aimAng) * aimDist * 0.7;
    } else if (!params.grounded) {
      // Left arm mirrors right arm airborne pose (same vy phases)
      let armUpAir, armFwdAir;
      if (vy > 5) {
        const t = clamp((vy - 5) / 5, 0, 1);
        armUpAir = lerp(0.30, 0.55, t);
        armFwdAir = lerp(0.25, 0.18, t);
      } else if (vy >= 1) {
        const t = clamp((5 - vy) / 4, 0, 1);
        armUpAir = lerp(0.55, 0.18, t);
        armFwdAir = lerp(0.18, 0.30, t);
      } else if (vy >= -2) {
        const t = clamp((1 - vy) / 3, 0, 1);
        armUpAir = lerp(0.18, 0.22, t);
        armFwdAir = lerp(0.30, 0.38, t);
      } else {
        const t = clamp((-vy - 2) / 7, 0, 1);
        armUpAir = lerp(0.22, -0.08, t);
        armFwdAir = lerp(0.38, 0.52, t);
      }
      handLX = sLX + this.facing * armFwdAir;
      handLY = sLY + armUpAir;
    } else if (this.crouchAmount > 0.5 && params.armPoseL !== 'aim') {
      handLX = sLX + this.facing * 0.18;
      handLY = sLY - 0.25;
    } else {
      const _armSwingL = (ANIM.WALK_ARM_SWING ?? 1.0);
      const armSw = Math.sin(phase) * stepAmp * swingDir * _armSwingL;
      const fwdBoost = Math.max(0, armSw);
      const runBlend = clamp(stepAmp * 1.6, 0, 1);
      // Idle baseline at -0.88 (was -0.55): with arms 0.45+0.45 = 0.90m, a
      // -0.55 hang sits at 61 % extension → elbow bent 52°, which reads as
      // "always crouched and braced." Dropping to -0.88 puts the hand at
      // ~98 % extension → ~10° residual bend, i.e. arms hang straight at
      // the sides. Run baseline stays at -0.18 so the pump arc is unchanged.
      const baseUp = lerp(-0.88, -0.18, runBlend);
      const idleForward = lerp(0, 0.06, runBlend);
      const armForward = idleForward + armSw * 0.34 + fwdBoost * 0.10;
      const armUp = baseUp + armSw * 0.08 + fwdBoost * 0.34;
      handLX = sLX + this.facing * armForward;
      handLY = sLY + armUp;
    }

    // Apply strikePose left-arm override (e.g. two-handed moves like poseBlowAway / poseAxe).
    if (strikePose && strikePose.armLX !== undefined) {
      const _sr = ANIM.STRIKE_REACH ?? 1;
      handLX = sLX + this.facing * strikePose.armLX * _sr;
      handLY = sLY + strikePose.armLY * _sr;
    }

    // Land catch — on hard landings bias both arms downward/outward to brace,
    // so a heavy touchdown reads with weight (hands drop instinctively).
    // Only applies when grounded, not attacking or grabbed/holding, and only
    // when impact is significant (> 0.4). Stays within arm amplitude budget.
    if (params.grounded && this._landImpact > 0.4
        && !strikePose
        && params.armPoseR !== 'aim' && params.armPoseR !== 'attack'
        && params.armPoseR !== 'strikePosed' && params.armPoseR !== 'grab'
        && params.armPoseR !== 'hold') {
      const catchWeight = clamp((this._landImpact - 0.4) / 0.6, 0, 1);
      const catchScale  = Math.min(this._landImpact, 1.0);
      // Pull both hands down and slightly outward — brace posture.
      const catchDropY = catchWeight * catchScale * 0.38;
      const catchOutX  = catchWeight * catchScale * 0.14 * this.facing;
      handRX = handRX - catchOutX;
      handRY = handRY - catchDropY;
      handLX = handLX + catchOutX;
      handLY = handLY - catchDropY;
    }

    // Slide arm drift — both arms trail behind body.
    if (params.sliding && this._slideArmDrift && !params.moveId) {
      handRX = sRX - this.facing * 0.50;   // arm trails behind
      handRY = sRY + 0.20;                  // slightly up (wind drag)
      handLX = sLX - this.facing * 0.40;   // mirror left arm trailing
      handLY = sLY + 0.15;
    }

    // Prone loose limbs — drop pose blend weight for off-arm + both legs.
    // The aim arm stays stiff and tracks params.aim even while prone.
    if (this._proneLooseLimbs && params.armPoseR !== 'strikePosed') {
      // Slacken off-arm target toward neutral hanging position.
      handLX = lerp(handLX, sLX, 0.85);
      handLY = lerp(handLY, sLY - 0.20, 0.85);
      // Legs hang where they fall — push targets toward ground.
      footRY = baseFootY - 0.05;
      footLY = baseFootY - 0.05;
    }
    // Aim-arm tracks aim vector even in prone.
    if (params.prone && params.aim) {
      const aimAngProne = Math.atan2(params.aim.y, params.aim.x);
      handRX = sRX + Math.cos(aimAngProne) * 0.7;
      handRY = sRY + Math.sin(aimAngProne) * 0.7;
    }

    // Idle baseline ragdoll droop on arms (only in walk pose)
    const idleLoose = (params.armPoseR === 'walk' && params.armPoseL === 'walk') ? 0.10 : 0;
    const totalRag = Math.max(idleLoose, this.ragdollAmount);
    if (totalRag > 0.02) {
      if (this.ragdollAmount > 0.5) {
        // Full collapse: throw limbs OUT perpendicular to torso axis (in
        // local rig frame). The rig.group quaternion already follows the
        // physics body's rotation when ragdolling (Stickman.js:1232-1233),
        // so local-frame splay rotates with the tumbling body in world.
        const ragAmt = this.ragdollAmount;
        // Local-frame perpendicular to torso direction (sin(tilt), cos(tilt)).
        const perpX =  Math.cos(this.bodyTilt);
        const perpY = -Math.sin(this.bodyTilt);
        const avSplay = (params.angVz || 0) * 0.08; // amplified from 0.04
        handLX = lerp(handLX, sLX - perpX * 0.6 + avSplay,        ragAmt);
        handLY = lerp(handLY, sLY - perpY * 0.6 - 0.10,           ragAmt);
        handRX = lerp(handRX, sRX + perpX * 0.6 + avSplay,        ragAmt);
        handRY = lerp(handRY, sRY + perpY * 0.6 - 0.10,           ragAmt);
        footLX = lerp(footLX, hipLX - perpX * 0.7 + avSplay * 0.7, ragAmt);
        footLY = lerp(footLY, hipLY - perpY * 0.7,                 ragAmt);
        footRX = lerp(footRX, hipRX + perpX * 0.7 + avSplay * 0.7, ragAmt);
        footRY = lerp(footRY, hipRY - perpY * 0.7,                 ragAmt);
      } else {
        // Partial droop — idle dazed flail (totalRag in (0.02, 0.5]).
        // Limbs whip with body angular velocity for trail-behind-rotation feel.
        const r = totalRag;
        const av = (params.angVz || 0) * 0.04;
        // Sag matches the new idle baseUp (-0.88). Old -0.55 was tuned for
        // 0.34+0.34 arms and pulled idle hands UP from the relaxed-straight
        // hang we want with the new 0.45+0.45 limbs.
        const sag = -0.88 - Math.sin(this.t * 4) * 0.05;
        handLX = lerp(handLX, sLX + av,  r);
        handLY = lerp(handLY, sLY + sag, r);
        handRX = lerp(handRX, sRX + av,  r);
        handRY = lerp(handRY, sRY + sag, r);
      }
    }

    if (this._handJiggle > 0.01) {
      const jx = Math.sin(this.t * 35) * this._handJiggle;
      const jy = Math.cos(this.t * 30) * this._handJiggle;
      handLX += jx; handLY += jy;
      handRX -= jx * 0.7; handRY += jy * 0.8;
    }

    // Spring physics on extremities — calm so it stays readable.
    if (!this._springInit) {
      this._handLPos.set(handLX, handLY, hipZ);
      this._handRPos.set(handRX, handRY, hipZ);
      this._footLPos.set(footLX, footLY, hipZ);
      this._footRPos.set(footRX, footRY, hipZ);
      this._springInit = true;
    }
    const sdt = Math.min(dt, 1 / 60);
    const stiff = (params.armPoseR === 'aim' || params.armPoseR === 'attack' || params.armPoseR === 'strikePosed' || params.armPoseR === 'hold');
    // Ragdoll softens spring stiffness so limbs flop instead of snapping back.
    // Fully ragdoll (1.0) = very soft; idle ragdoll (0.10) barely affects feel.
    const ragSoft = clamp(this.ragdollAmount, 0, 1);
    // Aim hold uses softer spring than melee strike-pose so the gun has
    // visible weight (sways with motion + breath) instead of feeling
    // welded to the hand. Strike/hold poses keep the original stiffness
    // — those need to land on a precise pose at a precise moment.
    const aimHold = (params.armPoseR === 'aim');
    let handK = lerp(stiff ? (aimHold ? 200 : 380) : 130, 28, ragSoft);
    let handD = lerp(stiff ? (aimHold ? 14 : 22) : 9, 2.8, ragSoft);
    // Mid-spin (somersault) — drop spring stiffness so hands trail behind
    // the body rotation instead of snapping to the pose. Reads as floppy
    // ragdoll arms whirling around the spin axis.
    if (params.spinning) {
      handK = 70;
      handD = 4;
    }
    const stepSpring = (pos, vel, tx, ty, k, d) => {
      vel.x += (tx - pos.x) * k * sdt;
      vel.y += (ty - pos.y) * k * sdt;
      const damping = Math.exp(-d * sdt);
      vel.x *= damping; vel.y *= damping;
      pos.x += vel.x * sdt;
      pos.y += vel.y * sdt;
      // Snap to target if drift gets huge (post-teleport safety).
      if (Math.hypot(tx - pos.x, ty - pos.y) > 4) { pos.x = tx; pos.y = ty; vel.x = 0; vel.y = 0; }
    };
    // During strike poses, snap directly to target — pose math already
    // provides the in/out curve over the move duration; spring smoothing
    // here just delays the visible motion past the move's end and makes
    // strikes look like they're barely firing.
    if (params.armPoseR === 'strikePosed' && !params.spinning) {
      this._handRPos.set(handRX, handRY, hipZ);
      this._handRVel.set(0, 0, 0);
      // Left arm: snap only if the strike pose itself overrides the left
      // arm (two-handed moves). Otherwise spring through the walk pose.
      if (strikePose && strikePose.armLX !== undefined) {
        this._handLPos.set(handLX, handLY, hipZ);
        this._handLVel.set(0, 0, 0);
      } else {
        stepSpring(this._handLPos, this._handLVel, handLX, handLY, handK, handD);
      }
    } else {
      stepSpring(this._handLPos, this._handLVel, handLX, handLY, handK, handD);
      stepSpring(this._handRPos, this._handRVel, handRX, handRY, handK, handD);
    }

    // Feet: when grounded and not ragdolled, render plant+swing targets
    // DIRECTLY. Spring chase here was filtering the yArc lift into a smoothed
    // ~30% peak, making feet appear to drag. Plant logic already produces
    // world-stable, frame-coherent targets so no smoothing needed.
    // Airborne / ragdoll keep spring for flop & lag feel.
    if (params.grounded && this.ragdollAmount < 0.5) {
      this._footLPos.set(footLX, footLY, hipZ);
      this._footRPos.set(footRX, footRY, hipZ);
      this._footLVel.set(0, 0, 0);
      this._footRVel.set(0, 0, 0);
    } else {
      let legK = lerp(280, 32, ragSoft);
      let legD = lerp(18, 3.2, ragSoft);
      // Spin softens leg springs the same way it softens arms — feet drag
      // behind the rotation for a ragdoll whirl.
      if (params.spinning) { legK = 90; legD = 5; }
      stepSpring(this._footLPos, this._footLVel, footLX, footLY, legK, legD);
      stepSpring(this._footRPos, this._footRVel, footRX, footRY, legK, legD);
    }

    // Render limbs via IK using the spring-chased extremity positions.
    const zL = hipZ - Z_STAGGER;
    const zR = hipZ + Z_STAGGER;
    // During aim pose: elbow tucks DOWN for both arms — natural gun-shoulder
    // posture. solveIK's elbowAngle = a + b * bend; for the elbow to land
    // below the shoulder→hand line the bend has to FLIP with facing:
    //   facing right (a≈0):  bend=-1 → elbowAngle = -b → below.
    //   facing left  (a≈π):  bend=+1 → elbowAngle = π+b → below (mirror).
    // Default melee bend uses +facingSign which puts elbow ABOVE for windup
    // arcs — wrong for aim. Aim flips it.
    const aimBend = -(this.facing >= 0 ? 1 : -1);
    const aimBendR = (params.armPoseR === 'aim') ? aimBend : undefined;
    const aimBendL = (params.armPoseL === 'aim') ? aimBend : undefined;
    this._drawArm(sLX, sLY, this._handLPos.x, this._handLPos.y, zL, this.upperArmL, this.lowerArmL, this.handL, this.shoulderL, this.elbowL, false, false, aimBendL, params);
    this._drawArm(sRX, sRY, this._handRPos.x, this._handRPos.y, zR, this.upperArmR, this.lowerArmR, this.handR, this.shoulderR, this.elbowR, true, !!params.gumGumPunch, aimBendR, params);
    this._drawLeg(hipLX, hipLY, this._footLPos.x, this._footLPos.y, zL, this.upperLegL, this.lowerLegL, this.footL, this.hipL, this.kneeL, false, params);
    this._drawLeg(hipRX, hipRY, this._footRPos.x, this._footRPos.y, zR, this.upperLegR, this.lowerLegR, this.footR, this.hipR, this.kneeR, true, params);

    // Hand orientation for aim
    if (params.armPoseR === 'aim' || params.armPoseR === 'attack' || params.armPoseR === 'strikePosed') {
      this.handR.rotation.z = aimAng;
    } else {
      this.handR.rotation.z = 0;
    }
  }

  _sweepClamp(sxLocal, syLocal, hxLocal, hyLocal, params, out) {
    out.x = hxLocal;
    out.y = hyLocal;
    const phys = params.physics;
    if (!phys || !phys.raycast) return;
    const ox = params.worldOriginX ?? 0;
    const oy = params.worldOriginY ?? 0;
    const sxW = ox + sxLocal, syW = oy + syLocal;
    const hxW = ox + hxLocal, hyW = oy + hyLocal;
    const dxW = hxW - sxW, dyW = hyW - syW;
    const segLen = Math.hypot(dxW, dyW);
    if (segLen < 0.02) return;
    // Forward ray: shoulder → hand. Project z to 0 (rig lives near z=0,
    // colliders are at z=0).
    const fwd = phys.raycast(
      { x: sxW, y: syW, z: 0 },
      { x: hxW, y: hyW, z: 0 },
      { mask: WORLD_MASK },
    );
    if (fwd && fwd.hitPointWorld) {
      const hitXW = fwd.hitPointWorld.x, hitYW = fwd.hitPointWorld.y;
      // Pull back along ray by LIMB_PAD.
      const inv = 1 / segLen;
      const ux = dxW * inv, uy = dyW * inv;
      out.x = (hitXW - ux * LIMB_PAD) - ox;
      out.y = (hitYW - uy * LIMB_PAD) - oy;
      return;
    }
    // Back-ray fallback — hand may already be inside a wall (prior frame
    // penetration). Cast hand → shoulder; a hit means hand is on the
    // wrong side of geometry.
    const back = phys.raycast(
      { x: hxW, y: hyW, z: 0 },
      { x: sxW, y: syW, z: 0 },
      { mask: WORLD_MASK },
    );
    if (back && back.hitPointWorld) {
      const hitXW = back.hitPointWorld.x, hitYW = back.hitPointWorld.y;
      // The back-ray hit point is the entry surface on the shoulder side
      // of the wall. Pull TOWARD shoulder by LIMB_PAD (along back-ray dir,
      // which is hand→shoulder).
      const inv = 1 / segLen;
      const ux = -dxW * inv, uy = -dyW * inv;
      out.x = (hitXW + ux * LIMB_PAD) - ox;
      out.y = (hitYW + uy * LIMB_PAD) - oy;
    }
    // Both rays missed → no penetration → leave (out.x, out.y) at the
    // requested hand position. Already initialized at function entry.
  }

  _drawArm(sx, sy, hx, hy, z, upper, lower, handMesh, shoulderJoint, elbowJoint, isRight, stretched, bendOverride, params) {
    shoulderJoint.position.set(sx, sy, z);
    if (stretched) {
      let sxh = hx, syh = hy;
      if (params) {
        this._sweepClamp(sx, sy, hx, hy, params, this._sweepOut);
        sxh = this._sweepOut.x;
        syh = this._sweepOut.y;
      }
      orientLimb(upper, sx, sy, z, sxh, syh, z);
      lower.visible = false;
      elbowJoint.visible = false;
      handMesh.position.set(sxh, syh, z);
      return;
    }
    if (!lower.visible) lower.visible = true;
    if (!elbowJoint.visible) elbowJoint.visible = true;
    const upperLen = 0.45, lowerLen = 0.45;
    const maxReach = (upperLen + lowerLen) * 0.99;
    // Clamp hand to within arm reach so limb segments don't stretch.
    const dx = hx - sx, dy = hy - sy;
    const d = Math.hypot(dx, dy);
    let chx = hx, chy = hy;
    if (d > maxReach) {
      const f = maxReach / d;
      chx = sx + dx * f; chy = sy + dy * f;
    }
    // World-collision clamp — if shoulder→hand crosses a wall, pull the
    // hand back to LIMB_PAD short of the surface. IK below auto-folds the
    // arm with the shortened reach (cartoon squish).
    if (params) {
      this._sweepClamp(sx, sy, chx, chy, params, this._sweepOut);
      chx = this._sweepOut.x;
      chy = this._sweepOut.y;
    }
    // bendOverride: explicit -1 forces elbow below the shoulder→hand line
    // (natural for aiming a gun — the elbow tucks down). Default uses
    // facing sign which puts elbow up for melee windup arcs.
    const bend = bendOverride !== undefined ? bendOverride : (this.facing >= 0 ? 1 : -1);
    solveIK(this._tmpKnee, sx, sy, chx, chy, upperLen, lowerLen, bend);
    const ex = this._tmpKnee.x, ey = this._tmpKnee.y;
    elbowJoint.position.set(ex, ey, z);
    orientLimb(upper, sx, sy, z, ex, ey, z);
    orientLimb(lower, ex, ey, z, chx, chy, z);
    handMesh.position.set(chx, chy, z);
  }

  _drawLeg(hx, hy, fx, fy, z, upper, lower, footMesh, hipJoint, kneeJoint, isRight, params) {
    hipJoint.position.set(hx, hy, z);
    const upperLen = 0.50, lowerLen = 0.50;
    const maxReach = (upperLen + lowerLen) * 0.99;
    const dx = fx - hx, dy = fy - hy;
    const d = Math.hypot(dx, dy);
    let cfx = fx, cfy = fy;
    if (d > maxReach) {
      const f = maxReach / d;
      cfx = hx + dx * f; cfy = hy + dy * f;
    }
    if (params) {
      this._sweepClamp(hx, hy, cfx, cfy, params, this._sweepOut);
      cfx = this._sweepOut.x;
      cfy = this._sweepOut.y;
    }
    solveIK(this._tmpKnee, hx, hy, cfx, cfy, upperLen, lowerLen, this.facing >= 0 ? 1 : -1);
    const kx = this._tmpKnee.x, ky = this._tmpKnee.y;
    kneeJoint.position.set(kx, ky, z);
    orientLimb(upper, hx, hy, z, kx, ky, z);
    orientLimb(lower, kx, ky, z, cfx, cfy, z);
    footMesh.position.set(cfx, cfy, z);
  }

  // Spike a squash recoil on contact. Stickman owns the flash channel; this
  // only handles the brief vertical compress that sells "I got hit / I just
  // connected". Tier: 'light' | 'heavy' | 'launcher'.
  hitImpact(tier = 'light') {
    const squash = tier === 'launcher' ? 0.55 : tier === 'heavy' ? 0.42 : 0.28;
    if (this._hitSquash === undefined) this._hitSquash = 0;
    this._hitSquash = Math.max(this._hitSquash, squash);
  }

  setFlash(amount) {
    if (amount < 0.02) {
      if (this._flashWasActive) {
        this.material.color.setHex(this.primary);
        this._flashWasActive = false;
      }
      return;
    }
    // Reuse cached THREE.Color objects — previous impl allocated two new
    // Colors every frame during the ~0.5s flash decay, multiplied by N
    // stickmen, all simultaneously when chains land. GC pressure showed
    // up as FPS dips during fights.
    if (!this._flashBaseColor) {
      this._flashBaseColor = new THREE.Color(this.primary);
      this._flashWhite = new THREE.Color(0xffffff);
      this._flashScratch = new THREE.Color();
    }
    this._flashScratch.copy(this._flashBaseColor).lerp(this._flashWhite, Math.min(1, amount));
    this.material.color.copy(this._flashScratch);
    this._flashWasActive = true;
  }
}
