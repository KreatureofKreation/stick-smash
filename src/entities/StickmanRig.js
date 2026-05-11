import * as THREE from 'three';
import { lerp, damp, clamp } from '../util/math.js';

// Procedural stick figure rig — clean silhouette, joint spheres at every joint,
// damped-spring hands & feet for Stick-Fight-style ragdoll wobble.

const _v = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const Z_STAGGER = 0.08;

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
  if (t < w2) { const w = (t - w1) / Math.max(0.0001, w2 - w1); return { p: 1, w, e: 1 - Math.pow(1 - w, 3) }; }
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
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LITE);
  let armRX, armRY, leanZ, armLX, armLY, footShift;
  if (ph.p === 0) {
    armRX = lerp(0.20, -0.40, ph.e);
    armRY = lerp(-0.30, 0.50, ph.e);
    armLX = lerp(-0.20, -0.15, ph.e);   // guard hand to chin
    armLY = lerp(-0.30, 0.30, ph.e);
    leanZ = lerp(0, -0.18, ph.e);
    footShift = lerp(0, -0.05, ph.e);   // weight back on rear leg
  } else if (ph.p === 1) {
    armRX = lerp(-0.40, 0.85, ph.e);    // whip forward
    armRY = lerp(0.50, -0.10, ph.e);
    armLX = lerp(-0.15, -0.30, ph.e);   // guard pulls in tight
    armLY = lerp(0.30, 0.10, ph.e);
    leanZ = lerp(-0.18, 0.30, ph.e);
    footShift = lerp(-0.05, 0.12, ph.e);// step into the punch
  } else {
    armRX = lerp(0.85, 0.20, ph.e);
    armRY = lerp(-0.10, -0.30, ph.e);
    armLX = lerp(-0.30, -0.20, ph.e);
    armLY = lerp(0.10, -0.30, ph.e);
    leanZ = lerp(0.30, 0, ph.e);
    footShift = lerp(0.12, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseCross(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LITE);
  let armRX, armRY, leanZ, armLX, armLY, footShift;
  if (ph.p === 0) {
    armRX = lerp(0.20, -0.50, ph.e);    // deeper rear-shoulder chamber
    armRY = lerp(-0.30, 0.55, ph.e);
    armLX = lerp(-0.20, 0.20, ph.e);    // lead hand chambers forward (jab-guard)
    armLY = lerp(-0.30, 0.15, ph.e);
    leanZ = lerp(0, -0.28, ph.e);
    footShift = lerp(0, -0.08, ph.e);
  } else if (ph.p === 1) {
    armRX = lerp(-0.50, 0.88, ph.e);    // long extension from hip-twist
    armRY = lerp(0.55, -0.10, ph.e);
    armLX = lerp(0.20, -0.25, ph.e);    // lead retracts to chin
    armLY = lerp(0.15, 0.30, ph.e);
    leanZ = lerp(-0.28, 0.40, ph.e);    // full hip rotation
    footShift = lerp(-0.08, 0.18, ph.e);// drive off rear foot
  } else {
    armRX = lerp(0.88, 0.20, ph.e);
    armRY = lerp(-0.10, -0.30, ph.e);
    armLX = lerp(-0.25, -0.20, ph.e);
    armLY = lerp(0.30, -0.30, ph.e);
    leanZ = lerp(0.40, 0, ph.e);
    footShift = lerp(0.18, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseHook(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LITE);
  let armRX, armRY, leanZ, armLX, armLY, footShift;
  if (ph.p === 0) {
    armRX = lerp(0.20, 0.55, ph.e);     // arm wide to the side
    armRY = lerp(-0.30, 0.50, ph.e);
    armLX = lerp(-0.20, -0.30, ph.e);   // off-arm sweeps opposite (rotational balance)
    armLY = lerp(-0.30, 0.20, ph.e);
    leanZ = lerp(0, 0.18, ph.e);
    footShift = lerp(0, 0.06, ph.e);    // pivot toward target
  } else if (ph.p === 1) {
    armRX = lerp(0.55, 0.85, ph.e);     // curves to centerline at chin
    armRY = lerp(0.50, -0.05, ph.e);
    armLX = lerp(-0.30, -0.05, ph.e);   // counter-sweeps back through center
    armLY = lerp(0.20, -0.20, ph.e);
    leanZ = lerp(0.18, 0.50, ph.e);
    footShift = lerp(0.06, 0.14, ph.e);
  } else {
    armRX = lerp(0.85, 0.20, ph.e);
    armRY = lerp(-0.05, -0.30, ph.e);
    armLX = lerp(-0.05, -0.20, ph.e);
    armLY = lerp(-0.20, -0.30, ph.e);
    leanZ = lerp(0.50, 0, ph.e);
    footShift = lerp(0.14, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseKnee(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LITE);
  let legRX, legRY, leanZ;
  if (ph.p === 0) {
    legRX = lerp(0.20, 0.05, ph.e);
    legRY = lerp(0, 0.25, ph.e);
    leanZ = lerp(0, 0.18, ph.e);
  } else if (ph.p === 1) {
    legRX = lerp(0.05, 0.55, ph.e);
    legRY = lerp(0.25, 0.45, ph.e);     // knee drives up to chest
    leanZ = lerp(0.18, 0.12, ph.e);
  } else {
    legRX = lerp(0.55, 0.20, ph.e);
    legRY = lerp(0.45, 0, ph.e);
    leanZ = lerp(0.12, 0, ph.e);
  }
  // Both arms drop wide for balance during knee strike (hip-level grab posture).
  const armSpread = ph.p === 1 ? ph.e : (ph.p === 2 ? 1 - ph.e : 0);
  const armRX = 0.05 + armSpread * 0.20;
  const armRY = 0.10 - armSpread * 0.30;
  const armLX = -0.05 - armSpread * 0.20;
  const armLY = 0.10 - armSpread * 0.30;
  return { legRX, legRY, leanZ, armRX, armRY, armLX, armLY };
}

function poseSpinBack(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, 0.42, 0.74);
  let armRX, armRY, leanZ, armLX, armLY, footShift;
  if (ph.p === 0) {
    armRX = lerp(0.20, -0.55, ph.e);
    armRY = lerp(-0.30, 0.55, ph.e);
    armLX = lerp(-0.20, 0.30, ph.e);    // off-arm leads the spin
    armLY = lerp(-0.30, 0.30, ph.e);
    leanZ = lerp(0, -0.70, ph.e);       // wind up huge twist
    footShift = lerp(0, -0.12, ph.e);
  } else if (ph.p === 1) {
    armRX = lerp(-0.55, 0.85, ph.e);    // whip through big horizontal arc
    armRY = lerp(0.55, 0.05, ph.e);
    armLX = lerp(0.30, -0.40, ph.e);    // off-arm whips back the other way
    armLY = lerp(0.30, 0.10, ph.e);
    leanZ = lerp(-0.70, 0.80, ph.e);
    footShift = lerp(-0.12, 0.20, ph.e);
  } else {
    armRX = lerp(0.85, 0.20, ph.e);
    armRY = lerp(0.05, -0.30, ph.e);
    armLX = lerp(-0.40, -0.20, ph.e);
    armLY = lerp(0.10, -0.30, ph.e);
    leanZ = lerp(0.80, 0, ph.e);
    footShift = lerp(0.20, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseBlowAway(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...HVY);
  let armRX, armRY, armLX, armLY, leanZ, footShift;
  if (ph.p === 0) {
    armRX = lerp(0.20, -0.30, ph.e);
    armRY = lerp(-0.30, 0.45, ph.e);
    armLX = lerp(-0.20, -0.30, ph.e);
    armLY = lerp(-0.30, 0.45, ph.e);
    leanZ = lerp(0, -0.40, ph.e);
    footShift = lerp(0, -0.15, ph.e);
  } else if (ph.p === 1) {
    armRX = lerp(-0.30, 0.88, ph.e);
    armRY = lerp(0.45, -0.05, ph.e);
    armLX = lerp(-0.30, 0.78, ph.e);    // both palms drive forward (stacked)
    armLY = lerp(0.45, -0.05, ph.e);
    leanZ = lerp(-0.40, 0.55, ph.e);
    footShift = lerp(-0.15, 0.25, ph.e);// big step into the push
  } else {
    armRX = lerp(0.88, 0.20, ph.e);
    armRY = lerp(-0.05, -0.30, ph.e);
    armLX = lerp(0.78, -0.20, ph.e);
    armLY = lerp(-0.05, -0.30, ph.e);
    leanZ = lerp(0.55, 0, ph.e);
    footShift = lerp(0.25, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseUppercut(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LAUN);
  let armRX, armRY, armLX, armLY, leanZ, footShift;
  if (ph.p === 0) {
    armRX = lerp(0.20, -0.05, ph.e);
    armRY = lerp(-0.30, -0.70, ph.e);   // drop into deep windup
    armLX = lerp(-0.20, -0.25, ph.e);
    armLY = lerp(-0.30, 0.10, ph.e);    // guard up
    leanZ = lerp(0, -0.40, ph.e);
    footShift = lerp(0, -0.10, ph.e);
  } else if (ph.p === 1) {
    armRX = lerp(-0.05, 0.45, ph.e);
    armRY = lerp(-0.70, 0.85, ph.e);    // rocket arc up to overhead
    armLX = lerp(-0.25, -0.35, ph.e);
    armLY = lerp(0.10, 0.20, ph.e);
    leanZ = lerp(-0.40, 0.10, ph.e);
    footShift = lerp(-0.10, 0.16, ph.e);// explode off rear foot
  } else {
    armRX = lerp(0.45, 0.20, ph.e);
    armRY = lerp(0.85, -0.30, ph.e);
    armLX = lerp(-0.35, -0.20, ph.e);
    armLY = lerp(0.20, -0.30, ph.e);
    leanZ = lerp(0.10, 0, ph.e);
    footShift = lerp(0.16, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseAxe(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...HVY);
  let armRX, armRY, armLX, armLY, leanZ;
  if (ph.p === 0) {
    armRX = lerp(0.20, 0.10, ph.e);
    armRY = lerp(0.15, 0.80, ph.e);     // both hands raised overhead
    armLX = lerp(-0.20, -0.10, ph.e);
    armLY = lerp(0.15, 0.80, ph.e);
    leanZ = lerp(0, -0.10, ph.e);
  } else if (ph.p === 1) {
    armRX = lerp(0.10, 0.30, ph.e);
    armRY = lerp(0.80, -0.25, ph.e);    // slam straight down
    armLX = lerp(-0.10, 0.25, ph.e);
    armLY = lerp(0.80, -0.25, ph.e);
    leanZ = lerp(-0.10, 0.35, ph.e);    // body folds over the hammer
  } else {
    armRX = lerp(0.30, 0.20, ph.e);
    armRY = lerp(-0.25, -0.30, ph.e);
    armLX = lerp(0.25, -0.20, ph.e);
    armLY = lerp(-0.25, -0.30, ph.e);
    leanZ = lerp(0.35, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ };
}

function poseCharge(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...HVY);
  let armRX, armRY, armLX, armLY, leanZ, footShift;
  if (ph.p === 0) {
    armRX = lerp(0.20, -0.30, ph.e);
    armRY = lerp(-0.30, 0.30, ph.e);
    armLX = lerp(-0.20, -0.30, ph.e);   // off-arm tucks for shoulder ram
    armLY = lerp(-0.30, 0.30, ph.e);
    leanZ = lerp(0, 0.50, ph.e);        // body lunges forward
    footShift = lerp(0, -0.10, ph.e);
  } else if (ph.p === 1) {
    armRX = lerp(-0.30, 0.85, ph.e);
    armRY = lerp(0.30, -0.10, ph.e);    // shoulder/elbow rams forward
    armLX = lerp(-0.30, 0.40, ph.e);
    armLY = lerp(0.30, -0.05, ph.e);
    leanZ = lerp(0.50, 0.70, ph.e);
    footShift = lerp(-0.10, 0.28, ph.e);// step deep
  } else {
    armRX = lerp(0.85, 0.20, ph.e);
    armRY = lerp(-0.10, -0.30, ph.e);
    armLX = lerp(0.40, -0.20, ph.e);
    armLY = lerp(-0.05, -0.30, ph.e);
    leanZ = lerp(0.70, 0, ph.e);
    footShift = lerp(0.28, 0, ph.e);
  }
  return { armRX, armRY, armLX, armLY, leanZ, footShift };
}

function poseCounterStance(rig, params) {
  // Static stance through duration — slight settle on entry. No strike arc.
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const settle = Math.min(1, t / 0.20);
  // Lead palm raised in bong-sao guard; rear hand cocked at hip ready to counter.
  const armRX = lerp(0.20, 0.55, settle);
  const armRY = lerp(0.15, 0.40, settle);
  const armLX = lerp(-0.20, -0.35, settle);
  const armLY = lerp(-0.30, 0.10, settle);
  const leanZ = lerp(0, -0.30, settle);
  return { armRX, armRY, armLX, armLY, leanZ };
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
  const base = poseHook(rig, params);
  return { ...base, leanZ: (base.leanZ ?? 0) + 0.10 };
}

function poseSomersault(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  // bodyAngle is an absolute override on bodyTilt (no damp), so the spin
  // actually completes inside the move duration. Ease-in-out so the spin
  // accelerates through the peak.
  const e = t * t * (3 - 2 * t);
  const bodyAngle = Math.PI * 2 * e;
  // Leg sweeps overhead at peak rotation for the axe contact.
  const peak = clamp((t - 0.40) / 0.35, 0, 1);
  const axe = Math.sin(peak * Math.PI);
  const legRX = 0.20 + axe * 0.35;
  const legRY = 0.00 + axe * 0.85;
  return {
    legRX, legRY, bodyAngle,
    armRX: 0.05, armRY: 0.05,
    armLX: -0.05, armLY: 0.05,
  };
}

function poseRisingKnee(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, ...LAUN);
  let legRX, legRY, leanZ;
  if (ph.p === 0) {
    legRX = lerp(0.20, 0.05, ph.e);
    legRY = lerp(0, 0.30, ph.e);
    leanZ = lerp(0, 0.25, ph.e);
  } else if (ph.p === 1) {
    legRX = lerp(0.05, 0.10, ph.e);
    legRY = lerp(0.30, 0.75, ph.e);     // knee high — air launcher
    leanZ = lerp(0.25, -0.20, ph.e);    // body uncurls upward
  } else {
    legRX = lerp(0.10, 0.20, ph.e);
    legRY = lerp(0.75, 0, ph.e);
    leanZ = lerp(-0.20, 0, ph.e);
  }
  return { legRX, legRY, leanZ, armRX: 0.05, armRY: 0.10, armLX: -0.05, armLY: 0.10 };
}

function poseDive(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  const ph = phaseSplit(t, 0.35, 0.78);
  let legRX, legRY, legLX, legLY, leanZ;
  if (ph.p === 0) {
    legRX = lerp(0.20, 0.30, ph.e);
    legRY = lerp(0, -0.10, ph.e);
    legLX = lerp(-0.20, 0.25, ph.e);
    legLY = lerp(0, -0.10, ph.e);
    leanZ = lerp(0, 0.45, ph.e);
  } else if (ph.p === 1) {
    legRX = 0.30; legRY = -0.10;
    legLX = 0.25; legLY = -0.10;
    leanZ = 0.45;
  } else {
    legRX = lerp(0.30, 0.20, ph.e);
    legRY = lerp(-0.10, 0, ph.e);
    legLX = lerp(0.25, -0.20, ph.e);
    legLY = lerp(-0.10, 0, ph.e);
    leanZ = lerp(0.45, 0, ph.e);
  }
  // Arms sweep back like a swimmer to maximize dive silhouette.
  return {
    legRX, legRY, legLX, legLY, leanZ,
    armRX: -0.20, armRY: 0.25,
    armLX: -0.30, armLY: 0.25,
  };
}

function poseSlideKick(rig, params) {
  const t = clamp(params.attackProgress ?? 0, 0, 1);
  // Body already in horizontal slide pose; foot snap-extends mid.
  const arc = Math.sin(Math.PI * clamp((t - 0.10) / 0.80, 0, 1));
  const legRX = 0.20 + arc * 0.90;
  const legRY = -0.45 + arc * 0.10;
  const leanZ = -Math.PI / 3 + arc * 0.15;
  return {
    legRX, legRY,
    legLX: -0.20, legLY: -0.10,
    leanZ,
    armRX: -0.30, armRY: 0.10,
    armLX: -0.20, armLY: 0.10,
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
    const mat = new THREE.MeshLambertMaterial({ color: primary });
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

    // Optional armor chestplate — toggled via setArmor().
    this.chestArmor = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.46, 0.32),
      new THREE.MeshLambertMaterial({ color: 0xa0a8b8 }),
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
    this.bodyTiltTarget = clamp(speed * 0.28, -0.5, 0.5);
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
    if (strikePose && (strikePose.leanZ !== undefined || strikePose.bodyAngle !== undefined)) {
      if (strikePose.bodyAngle !== undefined) {
        // Full rotation override (somersault). Caller hands us absolute angle.
        this.bodyTilt = this.facing * strikePose.bodyAngle;
      } else {
        // Pose contributes leanZ — apply on top of base lean, snap directly.
        this.bodyTilt = this.bodyTiltTarget + this.facing * strikePose.leanZ;
      }
    } else {
      this.bodyTilt = damp(this.bodyTilt, this.bodyTiltTarget, 0.0001, dt);
    }
    this.hitTilt = damp(this.hitTilt, 0, 0.001, dt);

    // Landing impact — capture fall speed exactly on the airborne→grounded
    // transition. Heavier falls = bigger squash. Decays over ~0.35s.
    if (params.grounded && !this._wasGrounded) {
      // Use last frame's downward vy as impact intensity (vy here can already
      // be 0 if physics resolved on this tick, so use _lastVy fallback).
      const impactVy = Math.min(0, this._lastVy * 7.5);
      this._landImpact = clamp(-impactVy * 0.06, 0, 1.1);
    }
    this._wasGrounded = params.grounded;
    this._landImpact = damp(this._landImpact, 0, 0.0001, dt); // fast decay

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
    this.squash = damp(this.squash, squashTarget, 0.0008, dt);

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
      // Idle: slow drift just to keep arms breathing.
      this.walkPhase += dt * 1.0;
    }
    // Expose for the leg-target code below.
    this._targetStride = targetStride;
    this._realSpeed = realSpeed;

    // Hip in WORLD or LOCAL space (caller decides via pos).
    // Hip bob: vertical bounce — one dip per step. Run gets a heavier bounce.
    const runBoost = clamp(speedMag * 1.2, 0, 1.0);
    const bob = (params.grounded ? Math.abs(Math.sin(this.walkPhase)) : 0) * speedMag * 0.10 * (1 + runBoost * 0.4);
    const crouchDrop = this.crouchAmount * 0.5;
    const landDrop = this._landImpact * 0.18;
    const hipX = pos.x;
    // Hip-foot reach budget: feet sit at pos.y - 0.75 (capsule bottom).
    // Legs are 1.00m total. Hip at pos.y + 0.25 → diff 1.00m → legs read
    // essentially straight at idle (IK clamps to maxReach 0.99). Bob/crouch
    // /land drop hip from there to flex knees on impact and during stride.
    const hipY = pos.y + 0.25 - bob - crouchDrop - landDrop + breathBob;
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
      // Three phases driven by vy:
      //   takeoff vy > 3      : legs trail under hip (extending push)
      //   apex    vy in [-1,3]: knees tucked up
      //   fall    vy < -1     : legs reach forward to brace landing
      let liftN, footFwd;
      if (vy > 3) {
        const t = clamp((vy - 3) / 4, 0, 1);
        liftN = lerp(0.40, 0.05, t);
        footFwd = 0;
      } else if (vy >= -1) {
        const t = clamp((vy + 1) / 4, 0, 1);
        liftN = lerp(0.40, 0.55, t);
        footFwd = 0;
      } else {
        const t = clamp((-vy - 1) / 6, 0, 1);
        liftN = lerp(0.55, 0.18, t);
        footFwd = lerp(0, 0.10, t);
      }
      footLX = hipX - 0.16 + this.facing * footFwd;
      footRX = hipX + 0.16 + this.facing * footFwd;
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

      // Asymmetric arcs:
      //   yArc — knee drives up fast, peaks at t≈0.37, drops to plant.
      //   xArc — ease-in: foot trails behind early then snaps forward to plant.
      const yArc = (t) => Math.sin(Math.pow(t, 0.7) * Math.PI);
      const xArc = (t) => t * t * (1.6 - 0.6 * t);

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
      if (strikePose.legRX !== undefined) {
        footRX = hipX + this.facing * strikePose.legRX;
        footRY = baseFootY + strikePose.legRY;
        this._plantRX = hipX + this.facing * 0.20;
      }
      if (strikePose.legLX !== undefined) {
        footLX = hipX + this.facing * strikePose.legLX;
        footLY = baseFootY + strikePose.legLY;
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
    const aimDist = Math.min(0.7, Math.hypot(aim.x, aim.y) * 0.7 + 0.55);

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
    } else if (params.armPoseR === 'strikePosed') {
      // Pose offsets are absolute relative to shoulder. Lean is applied earlier
      // (snapped onto bodyTilt) so we don't repeat it here.
      handRX = sRX + this.facing * strikePose.armRX;
      handRY = sRY + strikePose.armRY;
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
      // Airborne arms — phase by vy.
      let armUpAir, armFwdAir;
      if (vy > 3) {
        const t = clamp((vy - 3) / 4, 0, 1);
        armUpAir = lerp(0.20, 0.55, t);
        armFwdAir = 0.20;
      } else if (vy >= -1) {
        const t = clamp((vy + 1) / 4, 0, 1);
        armUpAir = lerp(0.10, 0.20, t);
        armFwdAir = 0.35;
      } else {
        const t = clamp((-vy - 1) / 6, 0, 1);
        armUpAir = lerp(0.20, -0.10, t);
        armFwdAir = lerp(0.35, 0.45, t);
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
      const armSw = Math.sin(phase + Math.PI) * stepAmp * swingDir;
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
      let armUpAir, armFwdAir;
      if (vy > 3) {
        const t = clamp((vy - 3) / 4, 0, 1);
        armUpAir = lerp(0.20, 0.55, t);
        armFwdAir = 0.20;
      } else if (vy >= -1) {
        const t = clamp((vy + 1) / 4, 0, 1);
        armUpAir = lerp(0.10, 0.20, t);
        armFwdAir = 0.35;
      } else {
        const t = clamp((-vy - 1) / 6, 0, 1);
        armUpAir = lerp(0.20, -0.10, t);
        armFwdAir = lerp(0.35, 0.45, t);
      }
      handLX = sLX + this.facing * armFwdAir;
      handLY = sLY + armUpAir;
    } else if (this.crouchAmount > 0.5 && params.armPoseL !== 'aim') {
      handLX = sLX + this.facing * 0.18;
      handLY = sLY - 0.25;
    } else {
      const armSw = Math.sin(phase) * stepAmp * swingDir;
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
      handLX = sLX + this.facing * strikePose.armLX;
      handLY = sLY + strikePose.armLY;
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
    const handK = lerp(stiff ? 380 : 130, 28, ragSoft);
    const handD = lerp(stiff ? 22 : 9, 2.8, ragSoft);
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
    if (params.armPoseR === 'strikePosed') {
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
      const legK = lerp(280, 32, ragSoft);
      const legD = lerp(18, 3.2, ragSoft);
      stepSpring(this._footLPos, this._footLVel, footLX, footLY, legK, legD);
      stepSpring(this._footRPos, this._footRVel, footRX, footRY, legK, legD);
    }

    // Render limbs via IK using the spring-chased extremity positions.
    const zL = hipZ - Z_STAGGER;
    const zR = hipZ + Z_STAGGER;
    this._drawArm(sLX, sLY, this._handLPos.x, this._handLPos.y, zL, this.upperArmL, this.lowerArmL, this.handL, this.shoulderL, this.elbowL, false, false);
    this._drawArm(sRX, sRY, this._handRPos.x, this._handRPos.y, zR, this.upperArmR, this.lowerArmR, this.handR, this.shoulderR, this.elbowR, true, !!params.gumGumPunch);
    this._drawLeg(hipLX, hipLY, this._footLPos.x, this._footLPos.y, zL, this.upperLegL, this.lowerLegL, this.footL, this.hipL, this.kneeL, false);
    this._drawLeg(hipRX, hipRY, this._footRPos.x, this._footRPos.y, zR, this.upperLegR, this.lowerLegR, this.footR, this.hipR, this.kneeR, true);

    // Hand orientation for aim
    if (params.armPoseR === 'aim' || params.armPoseR === 'attack' || params.armPoseR === 'strikePosed') {
      this.handR.rotation.z = aimAng;
    } else {
      this.handR.rotation.z = 0;
    }
  }

  _drawArm(sx, sy, hx, hy, z, upper, lower, handMesh, shoulderJoint, elbowJoint, isRight, stretched) {
    shoulderJoint.position.set(sx, sy, z);
    if (stretched) {
      orientLimb(upper, sx, sy, z, hx, hy, z);
      lower.visible = false;
      elbowJoint.visible = false;
      handMesh.position.set(hx, hy, z);
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
    solveIK(this._tmpKnee, sx, sy, chx, chy, upperLen, lowerLen, this.facing >= 0 ? 1 : -1);
    const ex = this._tmpKnee.x, ey = this._tmpKnee.y;
    elbowJoint.position.set(ex, ey, z);
    orientLimb(upper, sx, sy, z, ex, ey, z);
    orientLimb(lower, ex, ey, z, chx, chy, z);
    handMesh.position.set(chx, chy, z);
  }

  _drawLeg(hx, hy, fx, fy, z, upper, lower, footMesh, hipJoint, kneeJoint, isRight) {
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
