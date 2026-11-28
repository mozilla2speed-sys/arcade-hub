/**
 * Tracks. A track is a closed centre line drawn through control points, with
 * asphalt of `halfWidth` on each side, then `runoff` metres of grass, then a
 * barrier. The first control point is the start line; cars drive in point order.
 * To add a map: add an entry to DEFS. tests/tracks.test.ts checks its geometry.
 */
export type TrackId = 'ring' | 'valley' | 'serpent';

interface TrackDef {
  id: TrackId;
  name: string;
  about: string;
  laps: number;
  halfWidth: number;
  runoff: number;
  points: [number, number][];
}

export interface TrackPoint {
  x: number;
  z: number;
  /** unit direction of travel */
  tx: number;
  tz: number;
}

export interface Track extends Omit<TrackDef, 'points'> {
  /** evenly spaced points along the centre line */
  samples: TrackPoint[];
  /** distance between two samples, m */
  step: number;
  /** length of one lap, m */
  length: number;
}

const circle = (r: number, n: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [r * Math.cos(a), r * Math.sin(a)];
  });

const DEFS: TrackDef[] = [
  {
    id: 'ring',
    name: 'Кольцо',
    about: 'Быстрый круг для разминки',
    laps: 3,
    halfWidth: 8,
    runoff: 4.5,
    points: circle(62, 16),
  },
  {
    id: 'valley',
    name: 'Долина',
    about: 'Длинные прямые и плавные повороты',
    laps: 2,
    halfWidth: 8,
    runoff: 3.5,
    points: [
      [150, -40], [150, 40], [145, 105], [105, 140], [45, 130], [5, 90],
      [-45, 85], [-85, 130], [-140, 125], [-165, 75], [-150, 15], [-105, -15],
      [-105, -65], [-145, -105], [-110, -145], [-40, -135], [20, -100],
      [75, -130], [135, -115],
    ],
  },
  {
    id: 'serpent',
    name: 'Серпантин',
    about: 'Шпильки и связки для мастеров',
    laps: 2,
    halfWidth: 7,
    runoff: 3.5,
    points: [
      [170, -60], [170, 20], [170, 100], [145, 140], [110, 125], [98, 80],
      [96, 20], [75, -12], [45, 5], [38, 60], [40, 115], [15, 145],
      [-20, 135], [-30, 95], [-35, 40], [-60, 15], [-90, 35], [-95, 90],
      [-120, 135], [-165, 125], [-175, 70], [-150, 10], [-170, -50],
      [-150, -100], [-95, -105], [-45, -70], [10, -65], [55, -105],
      [120, -125], [160, -105],
    ],
  },
];

const SPACING = 2;

/** Uniform Catmull-Rom spline through a closed loop of points. */
function spline(points: [number, number][], perSegment = 40): [number, number][] {
  const n = points.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment;
      const at = (j: 0 | 1) =>
        0.5 *
        (2 * p1[j] +
          (p2[j] - p0[j]) * t +
          (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t +
          (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t * t * t);
      out.push([at(0), at(1)]);
    }
  }
  return out;
}

function build(def: TrackDef): Track {
  const dense = spline(def.points);
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[dense.length];
  const count = Math.round(length / SPACING);
  const step = length / count;

  const pos: [number, number][] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = i * step;
    while (cum[j + 1] < s) j++;
    const a = dense[j];
    const b = dense[(j + 1) % dense.length];
    const f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    pos.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }

  const samples = pos.map(([x, z], i) => {
    const next = pos[(i + 1) % count];
    const prev = pos[(i - 1 + count) % count];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    return { x, z, tx: dx / len, tz: dz / len };
  });

  const { points: _points, ...info } = def;
  return { ...info, samples, step, length };
}

export const TRACKS: readonly Track[] = DEFS.map(build);

export const DEFAULT_TRACK: TrackId = 'ring';

export function isTrackId(v: unknown): v is TrackId {
  return DEFS.some((d) => d.id === v);
}

export function getTrack(id: TrackId): Track {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

/** Distance from the centre line to the barrier, as seen by a car's centre. */
export function wallOffset(track: Track): number {
  return track.halfWidth + track.runoff;
}

const mod = (v: number, m: number) => ((v % m) + m) % m;

/** Centre-line position and direction at distance `s` along the lap. */
export function pointAt(track: Track, s: number): TrackPoint {
  const n = track.samples.length;
  const f = mod(s, track.length) / track.step;
  const i = Math.floor(f) % n;
  const k = f - Math.floor(f);
  const a = track.samples[i];
  const b = track.samples[(i + 1) % n];
  const tx = a.tx + (b.tx - a.tx) * k;
  const tz = a.tz + (b.tz - a.tz) * k;
  const len = Math.hypot(tx, tz) || 1;
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, tx: tx / len, tz: tz / len };
}

export interface Projection {
  /** distance along the lap, 0..length */
  s: number;
  /** closest point of the centre line */
  x: number;
  z: number;
  /** distance from it */
  dist: number;
}

/**
 * Closest point of the centre line, searched only near `hint` (a distance along
 * the track). Searching nearby means progress cannot jump to another part of
 * the track that happens to be close.
 */
export function project(track: Track, x: number, z: number, hint: number): Projection {
  const n = track.samples.length;
  const centre = Math.round(mod(hint, track.length) / track.step);
  const reach = Math.ceil(24 / track.step);
  let best: Projection = { s: 0, x: 0, z: 0, dist: Infinity };

  for (let d = -reach; d < reach; d++) {
    const i = mod(centre + d, n);
    const a = track.samples[i];
    const b = track.samples[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const dist = Math.hypot(x - px, z - pz);
    if (dist < best.dist) best = { s: mod((i + t) * track.step, track.length), x: px, z: pz, dist };
  }
  return best;
}
