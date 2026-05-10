// Tiny haptic-feedback helper. Single-source-of-truth for `navigator.vibrate`
// with two gates: feature detection + a Settings-driven toggle stored in
// localStorage under 'mc_haptics'. iOS Safari and any non-touch browser
// where vibrate isn't defined will silently no-op.
//
// Usage: vibrate(15) — fire a 15ms pulse if supported and enabled.
//
// Default: enabled. The Settings panel writes '0' to disable.

let cached = null; // 1 = enabled, 0 = disabled, null = uncached

function isEnabled() {
  if (cached !== null) return cached === 1;
  const v = localStorage.getItem('mc_haptics');
  cached = (v === '0') ? 0 : 1;
  return cached === 1;
}

export function setHapticsEnabled(on) {
  cached = on ? 1 : 0;
  localStorage.setItem('mc_haptics', on ? '1' : '0');
}

export function vibrate(ms) {
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;
  if (!isEnabled()) return;
  try { navigator.vibrate(ms); } catch (_) { /* swallow — non-critical */ }
}
