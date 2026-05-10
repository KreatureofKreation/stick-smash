# Mobile Controls Overhaul — Design

**Status:** Approved (brainstorm)
**Date:** 2026-05-10
**Scope:** Replace current 6-button + AIM-toggle mobile control scheme with a 4-button drag-from-Attack model that mirrors PC mouse-aim semantics. Add juice (haptics, button squash), settings (sensitivity, scale, left-handed mirror, haptics toggle), and a one-time tutorial overlay.

## Goals

1. **Match PC controls.** Aim is a sticky, always-defined 2D direction (PC mouse parallel). Tap = fire in current aim direction. No auto-aim.
2. **Feel fun.** Tactile feedback (haptics + squash animation), low-attention visuals (translucent buttons), guided onboarding.
3. **Reduce thumb gymnastics.** 4 buttons instead of 6. Eliminate AIM toggle (was clunky). Eliminate Throw button (folded into Grab release).

## Non-Goals

- No new gameplay mechanics (movement, weapons, physics unchanged).
- No auto-aim / target lock / aim assist (explicitly rejected; see Q3 in brainstorm).
- No twin-stick model (rejected in favor of drag-from-Attack).
- No multiplayer protocol changes — input snapshot shape stays identical.

---

## Input Model

### Movement (left half)
Floating joystick — unchanged from current `TouchControls.js`. Touch-down on left half spawns joy at finger; drag updates `moveX/moveY`; release hides + zeroes movement. Gated by `body.in-game` and `body.menu-open`.

### Aim (right thumb, drag-from-Attack)
Aim direction is a **sticky 2D unit vector** (`aimDir = {x, y}`) that persists indefinitely until updated by a new drag.

- **Default at spawn:** `(1, 0)` (facing right).
- **Tap Attack** (touch-down + touch-up within drag threshold) → emits `attack=true` for one frame in current `aimDir`. No aim change.
- **Hold Attack + drag** → as the finger moves, recompute `aimDir` from the drag delta vector (normalized). Character body/weapon rotates to match every frame.
- **Release after drag** → `aimDir` stays at last computed direction. Also fires once on release (`attack=true` for one frame). This is intentional (Brawl-Stars-style "aim-and-fire in one motion"). Side effect: there is no way to adjust aim without firing — accepted tradeoff for chaotic brawler pace.
- **No auto-aim.** Tap fires in current sticky direction regardless of enemy positions.

**Drag threshold:** if finger moves >12px from touch-down before release, treat as drag (no fire on touch-down, fire on release). Otherwise treat as tap (fire on touch-up).

**Aim sensitivity:** drag delta is multiplied by Settings sensitivity (default 1.0, range 0.5–2.0) before normalization. Higher = more aim change per pixel of drag.

**Melee weapons** follow same rule — swing direction = `aimDir`. Confirmed in brainstorm.

### Throw (no dedicated button)
Two distinct throws fold into the Grab button:

**Throw grabbed thing (player/crate)** — mirrors existing PC behavior:
- **Tap Grab next to a thing** → grab.
- **Release Grab with no left-joy input** → drop in place.
- **Release Grab with left-joy held** → throw in joy direction at moment of release.

Right-thumb (Grab) and left-thumb (joy) operate independently — no conflict.

**Throw wielded weapon (PC `Q` parity)** — swipe-from-Grab. Symmetric with drag-from-Attack:
- **Tap Grab** (touch-down + release within 20px movement) → grab nearby thing / drop held thing. Same as today.
- **Hold Grab still** (held but finger doesn't move) → continuous grab on while held. Lets the player walk a grabbed player around with the left joy. Same as today.
- **Hold Grab + drag finger >20px from start + release** → emits `throw=true` for one frame on release, triggers `_throwWeapon()` which fires the wielded weapon in the swipe direction. The regular grab/drop logic is suppressed for that touch so it doesn't double-fire.
- If the player has no wielded weapon, swipe is a no-op (no error, no grab side effect).

The 20px threshold matches the drag-from-Attack threshold for consistency. Throw-weapon direction is the swipe vector (from touch-down to release), normalized; this is independent of `aimDir` to keep the gesture's intent obvious.

This keeps the cluster at 4 buttons while preserving full PC-parity weapon-throwing.

### Action buttons
4 buttons in a thumb arc on the right side (sized + positioned by §Layout). All single-fire (`attack`, `jump`, `grab`, `special`) plus drag-aim on Attack only.

---

## Layout

Right-thumb cluster, anchored to bottom-right safe area.

| Button  | Position (right, bottom) | Size  | Notes                                        |
|---------|--------------------------|-------|----------------------------------------------|
| Attack  | 8px, 8px                 | 96px  | Primary. Tap = fire. Hold + drag = update aim. |
| Jump    | 8px, 110px               | 72px  | Above Attack (outer arc).                    |
| Grab    | 110px, 30px              | 68px  | Inner arc, lower. Hold to grab/climb.        |
| Special | 110px, 110px             | 64px  | Inner arc, upper. Smaller (rare use).        |

Sizes scale by Settings `--btn-scale` (S=0.85, M=1.0, L=1.15).

**Removed buttons:** Throw, AIM. Their CSS rules (`.tbtn.throw`, `.tbtn.aim`) deleted.

**Joystick:** unchanged (floating, left half). Resting opacity dropped from `.08`/`.3` to `.06`/`.22`.

### Visual treatment — minimal weight

Resting buttons are nearly invisible to keep attention on gameplay:

- Fill alpha: 0.10–0.12
- Border alpha: 0.35–0.40
- Glyph: 50% white

Per-button color hints (resting):
- Attack: `rgba(255,77,109, .12)` fill, `rgba(255,77,109, .40)` border
- Jump: `rgba(102,226,163, .12)` / `.40`
- Grab: `rgba(255,204,51, .10)` / `.35`
- Special: `rgba(220,140,255, .12)` / `.40`

**Active/pressed:** fill jumps to ~0.6, glyph 100% white, border bright. Combined with squash animation = clear feedback only when touched.

### Left-handed mirror
Settings toggle. Adds `body.touch.left-handed` class. CSS swaps:
- Cluster moves to bottom-left.
- Joystick spawn region flips to right half.

---

## Juice & Feedback

### Haptics
`navigator.vibrate(ms)` on key game moments. Gated by Settings toggle (default on). Wrap with `navigator.vibrate?.()` so iOS Safari (no support) silently no-ops.

| Event                    | Duration |
|--------------------------|----------|
| Attack tap (button feel) | 8 ms     |
| Hit landed (you damaged) | 15 ms    |
| Hit taken (enemy damaged you) | 25 ms |
| Jump from ground         | 12 ms    |
| Special activation       | 40 ms    |

Skipped: throw release, grab, mid-air double-jump (avoid spam).

### Button animation
Upgrade existing `.tbtn:active scale(0.92)`:
- On press: scale to 0.92.
- On release: 120ms keyframe animation `scale 1.06 → 1.0` (overshoot bounce).
- Radial ripple via `::before` pseudo-element fading from button center on press.

All CSS — no JS. Touch input remains instant (no animation gating logic).

### First-run tutorial overlay
New file `src/ui/TutorialOverlay.js` (~150 lines, no deps).

- Trigger: first mobile session per browser (gated by `localStorage.touch_tutorial_done`).
- Renders frozen-frame backdrop + 4 sequential ghost-finger CSS animations:
  1. Left thumb traces joystick arc — caption: "drag to move"
  2. Right thumb taps Attack twice — caption: "tap to attack"
  3. Right thumb holds Attack, drags arc, releases — caption: "hold + drag to aim"
  4. Right thumb holds Grab on a thing, left thumb pushes joy in chosen direction, right thumb releases Grab — caption: "release grab + push = throw"
  5. Right thumb on Grab, swipes diagonally and releases — caption: "swipe grab to throw weapon"
- Skip button (top-right corner) dismisses immediately.
- Auto-dismiss after final step.
- Sets `localStorage.touch_tutorial_done = '1'` on dismissal.
- Replayable from Settings → "Show tutorial again".

---

## Settings

New "Mobile Controls" section in existing Settings panel. Persisted to `localStorage`.

| Setting | Type | Default | Effect |
|---------|------|---------|--------|
| Aim sensitivity | Slider 0.5×–2.0× | 1.0 | Multiplies drag delta when computing `aimDir`. Doesn't affect movement joy. |
| Button scale | Radio S/M/L | M | Sets CSS var `--btn-scale` ∈ {0.85, 1.0, 1.15}. |
| Left-handed mirror | Toggle | off | Adds `body.touch.left-handed`. |
| Haptics | Toggle | on | Gates all `navigator.vibrate` calls. |
| Show tutorial again | Button | — | Clears `localStorage.touch_tutorial_done`, opens overlay. |

---

## Files Touched

| File | Change |
|---|---|
| `src/input/TouchControls.js` | Rewrite. Replace AIM toggle + Throw button with 4-button thumb-arc cluster + drag-from-Attack aim + swipe-from-Grab throw. Track sticky `aimDir`. Tap vs drag classification by 12px threshold on Attack, 20px on Grab. Apply Settings sensitivity. Suppress grab toggle on swipe-classified Grab touches. |
| `src/input/Input.js` | Touch path always sets `aimX/aimY/aimActive=true` (sticky). Remove `aimActive` toggle gate (always active). No new fields. |
| `src/Game.js` | Wire haptic calls into damage handler (hit landed/taken), jump handler (ground only), special activation. Wrap `navigator.vibrate?.()` with feature + Settings check. Verify grab release-with-joy throw path matches PC parity (likely no change). |
| `src/ui/styles.css` | Rewrite touch button styles (low-opacity resting, pressed states, squash + overshoot keyframes, radial ripple ::before). Add `--btn-scale` CSS var. Add `.touch.left-handed` mirror class. Drop `.tbtn.throw`, `.tbtn.aim` rules. |
| `src/ui/Menu.js` (`_settings()` method, ~line 341) | Add "Mobile Controls" section to existing settings panel with the 5 settings above. Persist to `localStorage`. Apply via CSS vars + body classes on change. |
| `src/ui/TutorialOverlay.js` (new) | First-run mobile overlay (described above). |

---

## State Machine

No changes. Existing `body.in-game` / `body.menu-open` gating on `#touch-root` covers the cluster. Tutorial overlay gated by additional `body.touch.tutorial-active` class to suppress input passthrough while ghost fingers play.

---

## Risks & Mitigations

- **Drag threshold tuning.** 12px may feel sluggish or trigger spurious fires. Plan: ship 12px, expose as a hidden constant first, tune based on feedback.
- **Sticky aim confusion.** New players may wonder why their character is facing nowhere useful at spawn. Mitigation: tutorial step 3 explicitly demonstrates re-aiming. Default `(1, 0)` matches a right-facing spawn pose.
- **Haptic battery drain.** Vibration is expensive. Mitigation: short bursts (≤40ms), skip frequent events (grab, double-jump). Settings toggle for full opt-out.
- **Left-handed mirror bugs.** Joy spawn-region flip + cluster flip must be atomic. Test by toggling mid-match.

---

## Out of Scope (Future)

- Auto-aim assist toggle (could be revisited if casual playtest shows pure-skill model is too punishing).
- Twin-stick (right joy) alternative scheme as a Settings option.
- Gyro aim.
- Drag-arc visualization on Attack button while aiming (decided: not needed, character orientation suffices).
