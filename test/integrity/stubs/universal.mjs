// A single "universal" value that absorbs any property access, call, or
// construction by returning itself. Standing in for Three.js / cannon-es so a
// module that does `new THREE.Vector3().set(...)` at import time succeeds
// without the real (browser-only) libraries. Coerces to 0 when used as a
// number (e.g. THREE.DoubleSide). The integrity test never *runs* rendering /
// physics code — it only needs the module graph to load.
export const U = new Proxy(function U() {}, {
  get(_t, p) {
    if (p === Symbol.toPrimitive) return () => 0;
    if (p === Symbol.iterator) return function* () {};
    return U;
  },
  apply() { return U; },
  construct() { return U; },
});
