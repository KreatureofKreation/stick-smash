// Stub for the bare `cannon-es` import. Re-exports the universal proxy under
// every CANNON.* name referenced in the weapon module graph.
import { U } from './universal.mjs';
export {
  U as Body, U as Box, U as Material, U as RaycastResult,
  U as Sphere, U as Vec3, U as World,
};
export default U;
