// ESM loader resolve hook: remap the bare `three` / `cannon-es` specifiers to
// local stubs so the weapon module graph can be imported in plain Node (no
// browser, no real Three/physics). Registered via module.register() by the
// integrity test before it dynamically imports weapons.js.
const STUBS = {
  'three': new URL('./three.stub.mjs', import.meta.url).href,
  'cannon-es': new URL('./cannon.stub.mjs', import.meta.url).href,
};

export function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
  return nextResolve(specifier, context);
}
