import * as THREE from 'three';
import { pointAt, wallOffset, type Track, type TrackId } from '../../../shared/src/games/car/tracks.js';
import type { Theme } from '../theme.js';
import { lowPower } from './renderer.js';

interface Palette {
  sky: number;
  fog: [number, number];
  ground: number;
  road: number;
  line: number;
  curb: [number, number];
  wall: [number, number];
  /** barriers and curbs glow instead of being lit */
  glow: boolean;
  hemi: [number, number, number];
  sun: [number, number];
  mountain: number;
}

const DAY: Palette = {
  sky: 0x8fd8ff, fog: [140, 520], ground: 0x4ea24a, road: 0x4a505c, line: 0xffffff,
  curb: [0xffffff, 0xe0262f], wall: [0xf4f6f8, 0xd8303a], glow: false,
  hemi: [0xeaf6ff, 0x7aa060, 1.8], sun: [0xfff2d0, 2.2], mountain: 0x6aaa7c,
};

const NIGHT: Palette = {
  sky: 0x0c0824, fog: [90, 420], ground: 0x140d33, road: 0x25213d, line: 0x29e6ff,
  curb: [0x29e6ff, 0xff3da5], wall: [0x29e6ff, 0xff3da5], glow: true,
  hemi: [0xaaa6ff, 0x3a2470, 1.8], sun: [0xc9d4ff, 1.3], mountain: 0x241352,
};

const GROUND: Record<TrackId, { day: number; night: number; mountain: number }> = {
  ring: { day: DAY.ground, night: NIGHT.ground, mountain: DAY.mountain },
  valley: { day: 0x3f8f45, night: 0x0f1230, mountain: 0x4f8f6c },
  serpent: { day: 0xd9b36c, night: 0x23102e, mountain: 0xc07a4a },
};

export interface World {
  group: THREE.Group;
  background: THREE.Color;
  fog: THREE.Fog;
  /** keep the shadow-casting sun above the point of interest */
  follow(x: number, z: number): void;
}

/** Repeatable random numbers, so every player sees the same scenery. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

const SUN_OFFSET = new THREE.Vector3(25, 45, 18);
/** size of one shadow-map pixel on the ground: 60 m across 2048 pixels */
const SHADOW_TEXEL = 60 / 2048;
const shadowRight = new THREE.Vector3(0, 1, 0).cross(SUN_OFFSET).normalize();
const shadowUp = SUN_OFFSET.clone().cross(shadowRight).normalize();

export function buildWorld(track: Track, theme: Theme): World {
  const night = theme === 'night';
  const pal = night ? NIGHT : DAY;
  const group = new THREE.Group();
  const rand = seeded(track.id.length * 7919 + track.samples.length);

  const xs = track.samples.map((p) => p.x);
  const zs = track.samples.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const radius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2;

  const lit = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

  // ---- light ----
  group.add(new THREE.HemisphereLight(pal.hemi[0], pal.hemi[1], pal.hemi[2]));
  const sun = new THREE.DirectionalLight(pal.sun[0], pal.sun[1]);
  sun.castShadow = !lowPower;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 140 });
  sun.shadow.bias = -0.0004;
  group.add(sun, sun.target);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), lit(GROUND[track.id][theme]));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -0.02, cz);
  ground.receiveShadow = true;
  group.add(ground);

  // ---- road ----
  const n = track.samples.length;
  /** point `offset` metres to the side of sample i */
  const side = (i: number, offset: number, y: number): [number, number, number] => {
    const p = track.samples[i % n];
    return [p.x + p.tz * offset, y, p.z - p.tx * offset];
  };

  /** Strip along the track between two (offset, height) edges, coloured per segment. */
  const ribbon = (
    from: [number, number],
    to: [number, number],
    color: (i: number) => number | null,
    material: THREE.Material,
  ) => {
    const positions: number[] = [];
    const colors: number[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const hex = color(i);
      if (hex === null) continue;
      c.set(hex);
      const a = side(i, ...from);
      const b = side(i, ...to);
      const d = side(i + 1, ...from);
      const e = side(i + 1, ...to);
      for (const v of [a, b, d, b, e, d]) {
        positions.push(...v);
        colors.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = !(material as THREE.MeshBasicMaterial).isMeshBasicMaterial;
    group.add(mesh);
  };

  const flatMat = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide });
  const glowMat = () => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const trimMat = () => (pal.glow ? glowMat() : flatMat());
  const w = track.halfWidth;
  // the car is a point in physics, so leave room for its body; much more and the
  // inner barrier would fold over itself on the tightest corner
  const wall = wallOffset(track) + 0.85;

  ribbon([-w, 0.03], [w, 0.03], () => pal.road, flatMat());
  for (const s of [-1, 1]) {
    ribbon([s * w, 0.05], [s * (w - 0.7), 0.05], (i) => pal.curb[Math.floor(i / 2) % 2], trimMat());
    ribbon([s * wall, 0], [s * wall, night ? 0.28 : 0.75], (i) => pal.wall[Math.floor(i / 4) % 2], trimMat());
    if (night) {
      ribbon([s * wall, 1.0], [s * wall, 1.1], (i) => pal.wall[Math.floor(i / 4) % 2], glowMat());
    }
  }
  ribbon([-0.12, 0.045], [0.12, 0.045], (i) => (i % 4 < 2 ? pal.line : null), trimMat());

  // ---- start line and gantry ----
  const start = pointAt(track, 0);
  const startAngle = Math.atan2(start.tx, start.tz);
  const gate = new THREE.Group();
  gate.position.set(start.x, 0, start.z);
  gate.rotation.y = startAngle;
  const checker = document.createElement('canvas');
  checker.width = 256;
  checker.height = 32;
  const cg = checker.getContext('2d')!;
  for (let i = 0; i < 32; i++) {
    for (let j = 0; j < 4; j++) {
      cg.fillStyle = (i + j) % 2 ? '#111111' : '#ffffff';
      cg.fillRect(i * 8, j * 8, 8, 8);
    }
  }
  const checkerTex = new THREE.CanvasTexture(checker);
  checkerTex.colorSpace = THREE.SRGBColorSpace;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 2), new THREE.MeshBasicMaterial({ map: checkerTex }));
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.06;
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(wall * 2 + 0.8, 1.4, 0.4),
    new THREE.MeshBasicMaterial({ map: textTexture('TURBO POYGA', night ? '#171038' : '#ffc928', night ? '#29e6ff' : '#0d2547') }),
  );
  banner.position.y = 7;
  gate.add(line, banner);
  for (const s of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 7.6, 8), lit(night ? 0x7a5cff : 0x0d2547));
    pole.position.set(s * (wall + 0.5), 3.8, 0);
    gate.add(pole);
  }
  group.add(gate);

  // ---- scenery ----
  /** distance to the nearest part of the road */
  const clearance = (x: number, z: number) => {
    let best = Infinity;
    for (let i = 0; i < n; i += 2) {
      const p = track.samples[i];
      best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
    }
    return Math.sqrt(best);
  };
  /** random spots that keep `margin` metres from the barriers */
  const scatter = (count: number, margin: number, spread = 110) => {
    const out: [number, number][] = [];
    const total = lowPower ? Math.ceil(count * 0.45) : count;
    for (let tries = 0; out.length < total && tries < total * 20; tries++) {
      const x = cx + (rand() - 0.5) * 2 * (radius + spread);
      const z = cz + (rand() - 0.5) * 2 * (radius + spread);
      if (clearance(x, z) > wall + margin) out.push([x, z]);
    }
    return out;
  };

  const dummy = new THREE.Object3D();
  interface Placement { x: number; y: number; z: number; sx: number; sy: number; sz: number; turn?: number; color?: number }
  const instances = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Placement[], shadow = true) => {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const c = new THREE.Color();
    list.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.set(p.sx, p.sy, p.sz);
      dummy.rotation.set(0, p.turn ?? 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (p.color !== undefined) mesh.setColorAt(i, c.set(p.color));
    });
    mesh.castShadow = shadow && !lowPower;
    group.add(mesh);
  };

  const trees = (spots: [number, number][], leaf: number) => {
    const sizes = spots.map(() => 0.8 + rand() * 0.9);
    instances(new THREE.CylinderGeometry(0.25, 0.35, 2, 6), lit(0x6b4527),
      spots.map(([x, z], i) => ({ x, y: sizes[i], z, sx: sizes[i], sy: sizes[i], sz: sizes[i] })));
    instances(new THREE.ConeGeometry(1.8, 5, 7), lit(leaf),
      spots.map(([x, z], i) => ({ x, y: 4.2 * sizes[i], z, sx: sizes[i], sy: sizes[i], sz: sizes[i] })));
  };

  if (track.id === 'ring') {
    trees(scatter(110, 22), night ? 0x1f5b66 : 0x2f7a34);
  } else if (track.id === 'valley') {
    trees(scatter(420, 6), night ? 0x1c4c63 : 0x2c6b30);
    // village houses
    const homes = scatter(26, 12, 50).map(([x, z]) => ({ x, z, turn: rand() * Math.PI, size: 0.8 + rand() * 0.5 }));
    instances(new THREE.BoxGeometry(6, 3.6, 5), lit(night ? 0x32285c : 0xf0e2c4),
      homes.map((h) => ({ x: h.x, y: 1.8 * h.size, z: h.z, sx: h.size, sy: h.size, sz: h.size, turn: h.turn })));
    instances(new THREE.ConeGeometry(4.6, 2.6, 4).rotateY(Math.PI / 4), lit(night ? 0x7a2f6c : 0xb5473a),
      homes.map((h) => ({ x: h.x, y: 4.9 * h.size, z: h.z, sx: h.size, sy: h.size, sz: h.size * 0.85, turn: h.turn })));
  } else {
    // canyon: rocks, mesas and cacti
    const rock = night ? 0x5a2a68 : 0xb8683c;
    instances(new THREE.DodecahedronGeometry(2.2, 0), lit(rock, { flatShading: true }),
      scatter(190, 5, 70).map(([x, z]) => {
        const s = 0.5 + rand() * 1.4;
        return { x, y: s * 0.8, z, sx: s, sy: s * (0.6 + rand()), sz: s, turn: rand() * 6 };
      }));
    instances(new THREE.CylinderGeometry(9, 13, 14, 7), lit(rock, { flatShading: true }),
      scatter(22, 24, 160).map(([x, z]) => {
        const s = 0.7 + rand() * 1.1;
        return { x, y: 7 * s, z, sx: s, sy: s, sz: s, turn: rand() * 6 };
      }), false);
    const cacti = scatter(110, 3, 40);
    const green = lit(night ? 0x1f8f7a : 0x3d7d3a);
    instances(new THREE.CylinderGeometry(0.35, 0.4, 3.4, 7), green,
      cacti.map(([x, z]) => ({ x, y: 1.7, z, sx: 1, sy: 1, sz: 1 })));
    instances(new THREE.BoxGeometry(1.7, 0.35, 0.35), green,
      cacti.map(([x, z]) => ({ x, y: 1.9, z, sx: 1, sy: 1, sz: 1, turn: rand() * 6 })));
  }

  // grandstands along the start straight (all around the stadium ring)
  const standSpots = track.id === 'ring' ? [0, 0.12, 0.38, 0.5, 0.62, 0.88] : [0.01, 0.96];
  const crowd: Placement[] = [];
  const heads: Placement[] = [];
  const shirts = [0xffc928, 0xe0262f, 0x1769e0, 0xffffff, 0x18a058, 0xff3da5];
  for (const f of standSpots) {
    for (const s of [-1, 1]) {
      const p = pointAt(track, f * track.length);
      const off = s * (wall + 6);
      const x = p.x + p.tz * off;
      const z = p.z - p.tx * off;
      if (clearance(x, z) < wall + 5) continue;
      const stand = new THREE.Group();
      stand.position.set(x, 0, z);
      // local +x points away from the road
      stand.rotation.y = Math.atan2(p.tx, p.tz) + (s < 0 ? Math.PI : 0);
      for (let row = 0; row < 4; row++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8 * (row + 1), 14), lit(night ? 0x2c2260 : 0xc9d2de));
        step.position.set(row * 1.6 - 2.4, 0.4 * (row + 1), 0);
        stand.add(step);
        for (let k = 0; k < 14; k++) {
          if (rand() < 0.3) continue;
          const seat = new THREE.Vector3(row * 1.6 - 2.4, 0.8 * (row + 1) + 0.45, k - 6.5)
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), stand.rotation.y);
          const at = { x: x + seat.x, z: z + seat.z, sx: 1, sy: 1, sz: 1 };
          crowd.push({ ...at, y: seat.y - 0.12, color: shirts[Math.floor(rand() * shirts.length)] });
          heads.push({ ...at, y: seat.y + 0.42 });
        }
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.25, 15), lit(night ? 0xff3da5 : 0xe0262f));
      roof.position.set(0.4, 6.2, 0);
      stand.add(roof);
      group.add(stand);
    }
  }
  const fan = (color: number) =>
    night ? new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.6) }) : lit(color);
  instances(new THREE.CylinderGeometry(0.2, 0.32, 0.66, 7), fan(0xffffff), crowd, false);
  instances(new THREE.SphereGeometry(0.22, 8, 6), fan(0xe8b48c), heads, false);

  // lamp posts just behind the barriers
  const lamps: [number, number][] = [];
  for (let s = 20; s < track.length; s += lowPower ? 90 : 45) {
    const p = pointAt(track, s);
    const off = (Math.round(s / 45) % 2 ? 1 : -1) * (wall + 1.2);
    const x = p.x + p.tz * off;
    const z = p.z - p.tx * off;
    if (clearance(x, z) > wall + 0.8) lamps.push([x, z]);
  }
  instances(new THREE.CylinderGeometry(0.12, 0.16, 6, 6), lit(night ? 0x4a3d8f : 0x6d7480),
    lamps.map(([x, z]) => ({ x, y: 3, z, sx: 1, sy: 1, sz: 1 })), false);
  instances(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: night ? 0xfff0a8 : 0xdde3ea }),
    lamps.map(([x, z]) => ({ x, y: 6.1, z, sx: 1, sy: 1, sz: 1 })), false);

  // ---- horizon ----
  const peaks: Placement[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const r = radius + 230 + rand() * 90;
    const h = 40 + rand() * 70;
    peaks.push({ x: cx + Math.cos(a) * r, y: h / 2 - 2, z: cz + Math.sin(a) * r, sx: 55 + rand() * 45, sy: h, sz: 55 + rand() * 45 });
  }
  instances(new THREE.ConeGeometry(1, 1, 6),
    new THREE.MeshStandardMaterial({ color: night ? pal.mountain : GROUND[track.id].mountain, roughness: 1, flatShading: true }),
    peaks, false);

  const disc = new THREE.Mesh(
    new THREE.SphereGeometry(night ? 22 : 26, 20, 14),
    new THREE.MeshBasicMaterial({ color: night ? 0xff3da5 : 0xffe066, fog: false }),
  );
  disc.position.set(cx + 150, 190, cz + radius + 300);
  group.add(disc);

  if (night) {
    const stars: number[] = [];
    for (let i = 0; i < 500; i++) {
      const a = rand() * Math.PI * 2;
      const e = 0.12 + rand() * 1.2;
      stars.push(cx + 520 * Math.cos(e) * Math.cos(a), 520 * Math.sin(e), cz + 520 * Math.cos(e) * Math.sin(a));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
    group.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false })));
  } else {
    const clouds: Placement[] = [];
    for (let i = 0; i < 16; i++) {
      const a = rand() * Math.PI * 2;
      const r = radius + 80 + rand() * 200;
      const s = 8 + rand() * 12;
      for (let k = 0; k < 3; k++) {
        clouds.push({ x: cx + Math.cos(a) * r + (k - 1) * s, y: 95 + rand() * 6, z: cz + Math.sin(a) * r, sx: s, sy: s * 0.45, sz: s * 0.7 });
      }
    }
    instances(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), clouds, false);
  }

  return {
    group,
    background: new THREE.Color(pal.sky),
    fog: new THREE.Fog(pal.sky, pal.fog[0], pal.fog[1]),
    follow(x, z) {
      // move the light in whole shadow pixels, otherwise shadow edges shimmer
      const target = sun.target.position.set(x, 0, z);
      for (const axis of [shadowRight, shadowUp]) {
        const along = target.dot(axis);
        target.addScaledVector(axis, Math.round(along / SHADOW_TEXEL) * SHADOW_TEXEL - along);
      }
      sun.position.copy(target).add(SUN_OFFSET);
    },
  };
}

function textTexture(text: string, background: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = background;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = color;
  g.font = '700 44px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const x of [170, 512, 854]) g.fillText(text, x, 34);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
