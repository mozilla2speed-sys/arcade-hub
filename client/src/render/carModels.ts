import * as THREE from 'three';
import type { CarId } from '../../../shared/src/games/car/cars.js';
import { R } from '../../../shared/src/games/car/physics.js';

/** Looks of one car type. Profiles are [z, y] points of the side view. */
interface CarShape {
  body: [number, number][];
  cabin: [number, number][];
  width: number;
  cabinWidth: number;
  roof: { y: number; z: number; length: number };
  wheelScale: number;
  axle: number;
  track: number;
  extras?: ('spoiler' | 'rack' | 'spare' | 'stripe')[];
}

const SHAPES: Record<CarId, CarShape> = {
  sedan: {
    body: [[-2.1, 0.4], [2.1, 0.4], [2.15, 0.7], [2.0, 0.95], [0.9, 1.02], [-1.5, 1.02], [-2.1, 0.95], [-2.15, 0.7]],
    cabin: [[0.95, 1.0], [0.35, 1.5], [-0.85, 1.5], [-1.55, 1.0]],
    width: 1.6, cabinWidth: 1.3, roof: { y: 1.57, z: -0.25, length: 1.3 },
    wheelScale: 1, axle: 1.4, track: 1.0,
  },
  sport: {
    body: [[-2.15, 0.34], [2.25, 0.34], [2.3, 0.52], [1.2, 0.82], [0.7, 0.86], [-1.5, 0.92], [-2.15, 0.9], [-2.2, 0.6]],
    cabin: [[0.75, 0.84], [-0.05, 1.24], [-0.75, 1.24], [-1.6, 0.9]],
    width: 1.72, cabinWidth: 1.22, roof: { y: 1.3, z: -0.42, length: 0.76 },
    wheelScale: 1, axle: 1.45, track: 1.04, extras: ['spoiler', 'stripe'],
  },
  hatch: {
    body: [[-1.7, 0.42], [1.8, 0.42], [1.86, 0.74], [1.7, 0.98], [0.85, 1.08], [-1.7, 1.1], [-1.78, 0.75]],
    cabin: [[0.9, 1.06], [0.3, 1.64], [-1.4, 1.64], [-1.7, 1.08]],
    width: 1.56, cabinWidth: 1.34, roof: { y: 1.71, z: -0.55, length: 1.75 },
    wheelScale: 0.95, axle: 1.18, track: 0.97,
  },
  jeep: {
    body: [[-2.0, 0.62], [2.05, 0.62], [2.1, 1.05], [1.98, 1.28], [0.8, 1.34], [-2.0, 1.34], [-2.05, 0.95]],
    cabin: [[0.82, 1.32], [0.55, 2.02], [-1.85, 2.02], [-1.95, 1.32]],
    width: 1.72, cabinWidth: 1.52, roof: { y: 2.09, z: -0.65, length: 2.4 },
    wheelScale: 1.3, axle: 1.38, track: 1.06, extras: ['rack', 'spare'],
  },
};

export interface CarModel {
  car: THREE.Group;
  /** body without wheels: leans in corners */
  shell: THREE.Group;
  wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean }[];
  tailMat: THREE.MeshStandardMaterial;
}

export function buildCar(id: CarId, color: string): CarModel {
  const shape = SHAPES[id];
  const car = new THREE.Group();
  const shell = new THREE.Group();
  car.add(shell);

  const std = (params: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(params);
  // a little self-light keeps the chosen colour recognisable in shade and at night
  const paint = std({ color, metalness: 0.15, roughness: 0.35, emissive: color, emissiveIntensity: 0.18 });
  const glass = std({ color: 0x16354f, metalness: 0.7, roughness: 0.1 });
  const black = std({ color: 0x15151a, roughness: 0.8 });
  const white = std({ color: 0xf4f4f4, roughness: 0.5 });
  const headMat = std({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 1.6 });
  const tailMat = std({ color: 0x770000, emissive: 0xff1010, emissiveIntensity: 0.6 });

  const extrude = (points: [number, number][], width: number, bevel: number, mat: THREE.Material) => {
    const outline = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(outline, {
      depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3,
    });
    g.translate(0, 0, -width / 2);
    g.rotateY(-Math.PI / 2);
    shell.add(new THREE.Mesh(g, mat));
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    shell.add(m);
    return m;
  };

  extrude(shape.body, shape.width, 0.12, paint);
  extrude(shape.cabin, shape.cabinWidth, 0.06, glass);
  box(shape.cabinWidth + 0.16, 0.08, shape.roof.length, paint, 0, shape.roof.y, shape.roof.z);

  const zs = shape.body.map((p) => p[0]);
  const ys = shape.body.map((p) => p[1]);
  const nose = Math.max(...zs) + 0.1;
  const tail = Math.min(...zs) - 0.1;
  const floor = Math.min(...ys);
  const lampY = floor + (id === 'jeep' ? 0.48 : 0.34);

  box(shape.width + 0.14, 0.14, nose - tail - 0.1, black, 0, floor - 0.04, 0);
  box(1.0, 0.14, 0.06, black, 0, floor + 0.18, nose);
  box(0.46, 0.13, 0.05, white, 0, floor + 0.24, tail - 0.02);
  for (const s of [-1, 1]) {
    box(0.42, 0.14, 0.08, headMat, s * shape.width * 0.38, lampY, nose - 0.02);
    box(0.46, 0.15, 0.08, tailMat, s * shape.width * 0.36, lampY + 0.04, tail + 0.01);
    box(0.12, 0.1, 0.2, paint, s * (shape.width / 2 + 0.16), shape.cabin[0][1] + 0.1, shape.cabin[0][0] - 0.2);
  }

  if (shape.extras?.includes('spoiler')) {
    for (const s of [-1, 1]) box(0.08, 0.3, 0.14, black, s * 0.6, 1.06, -1.98);
    box(1.85, 0.07, 0.42, paint, 0, 1.23, -2.02);
  }
  if (shape.extras?.includes('stripe')) {
    for (const s of [-1, 1]) box(0.05, 0.08, 3.6, white, s * (shape.width / 2 + 0.13), 0.66, 0);
  }
  if (shape.extras?.includes('rack')) {
    for (const s of [-1, 1]) box(0.08, 0.1, 2.2, black, s * 0.68, shape.roof.y + 0.14, shape.roof.z);
    for (const z of [-1.5, -0.65, 0.2]) box(1.44, 0.07, 0.08, black, 0, shape.roof.y + 0.2, z);
  }
  if (shape.extras?.includes('spare')) {
    const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.26, 24).rotateX(Math.PI / 2), black);
    spare.position.set(0, 1.18, tail - 0.18);
    shell.add(spare);
  }

  const radius = R * shape.wheelScale;
  const tireGeo = new THREE.CylinderGeometry(radius, radius, 0.32, 24).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(radius * 0.68, radius * 0.68, 0.34, 16).rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.36, radius * 1.2, 0.07);
  const archGeo = new THREE.CylinderGeometry(radius + 0.09, radius + 0.09, 0.3, 24).rotateZ(Math.PI / 2);
  const tireMat = std({ color: 0x151517, roughness: 0.95 });
  const rimMat = std({ color: 0xc4c8ce, metalness: 0.8, roughness: 0.3 });

  const wheels: CarModel['wheels'] = [];
  for (const front of [true, false]) {
    for (const s of [-1, 1]) {
      const z = front ? shape.axle : -shape.axle;
      const arch = new THREE.Mesh(archGeo, black);
      arch.position.set(s * (shape.track - 0.1), radius, z);
      shell.add(arch);
      const pivot = new THREE.Group();
      pivot.position.set(s * shape.track, radius, z);
      const spin = new THREE.Group();
      pivot.add(spin);
      spin.add(new THREE.Mesh(tireGeo, tireMat), new THREE.Mesh(rimGeo, rimMat), new THREE.Mesh(spokeGeo, tireMat));
      car.add(pivot);
      wheels.push({ pivot, spin, front });
    }
  }

  car.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { car, shell, wheels, tailMat };
}
