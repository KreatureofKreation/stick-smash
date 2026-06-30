// Stub for the bare `three` import. Re-exports the universal proxy under every
// THREE.* name referenced in the weapon module graph (grep'd from src). Adding
// a new THREE export usage may require adding its name here.
import { U } from './universal.mjs';
export {
  U as BoxGeometry, U as BufferGeometry, U as CapsuleGeometry, U as CircleGeometry,
  U as Color, U as ConeGeometry, U as CylinderGeometry, U as DodecahedronGeometry,
  U as DoubleSide, U as DynamicDrawUsage, U as ExtrudeGeometry, U as Group,
  U as IcosahedronGeometry, U as InstancedBufferAttribute, U as InstancedMesh,
  U as Line, U as LineBasicMaterial, U as Mesh, U as MeshBasicMaterial,
  U as MeshLambertMaterial, U as Object3D, U as OctahedronGeometry, U as Path,
  U as PlaneGeometry, U as Shape, U as SphereGeometry, U as TorusGeometry,
  U as Vector3,
};
export default U;
