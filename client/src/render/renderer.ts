import * as THREE from 'three';

/** One WebGL context shared by the menu preview and the race. */
let renderer: THREE.WebGLRenderer | null = null;

export const lowPower = (() => {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
  return (
    saveData === true ||
    (mem !== undefined && mem <= 4) ||
    (cores <= 4 && coarse) ||
    innerWidth * devicePixelRatio < 900
  );
})();

export function getRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({
    antialias: !lowPower,
    powerPreference: lowPower ? 'low-power' : 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.25 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.id = 'view';
  document.body.prepend(renderer.domElement);
  addEventListener('resize', () => renderer!.setSize(innerWidth, innerHeight));
  return renderer;
}

/** Free the GPU memory held by a scene subtree. */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      if (!m) continue;
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    }
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}
