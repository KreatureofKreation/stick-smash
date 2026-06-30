// Weighted weapon-spawn selection — pure, no Three/cannon deps so the drawing
// logic can be unit-tested in isolation from the ~50 weapon classes. weapons.js
// owns the actual SPAWN_TABLE (which references the classes); this module only
// knows how to draw from a table of { id, w, cls } entries.

// Draw one entry's `cls` from a weighted table, skipping any id in `disabled`.
// Returns `fallback` when the filtered pool is empty. `rng` returns [0,1).
export function pickWeighted(table, disabled, rng = Math.random, fallback = null) {
  const skip = disabled instanceof Set ? disabled : new Set(disabled || []);
  // Filter disabled before computing weights so the weight sums stay correct.
  const pool = table.filter(e => !skip.has(e.id));
  if (!pool.length) return fallback;
  const total = pool.reduce((s, e) => s + e.w, 0);
  let r = rng() * total;
  for (const e of pool) { r -= e.w; if (r <= 0) return e.cls; }
  return pool[0].cls;
}
