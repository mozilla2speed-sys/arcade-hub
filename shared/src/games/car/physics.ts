/**
 * Shared bicycle-model physics for the car game.
 * Used by both server (authoritative) and client (prediction / visuals).
 */
import type { InputState } from '../../messages.js';
import type { CarSpec } from './cars.js';
import { pointAt, project, wallOffset, type Track } from './tracks.js';

export const R = 0.38; // wheel radius
export const WB = 2.8; // wheelbase

export interface CarBody {
  x: number;
  z: number;
  heading: number;
  v: number;
  steer: number;
  roll: number;
  pitch: number;
  /** metres driven along the track since the start line (negative on the grid) */
  progress: number;
  laps: number;
  best: number;
  lapStart: number;
  raceStart: number;
  finished: boolean;
  finishPlace: number;
  totalTime: number;
}

export function createCar(): CarBody {
  return {
    x: 0,
    z: 0,
    heading: 0,
    v: 0,
    steer: 0,
    roll: 0,
    pitch: 0,
    progress: 0,
    laps: 0,
    best: 0,
    lapStart: Date.now(),
    raceStart: Date.now(),
    finished: false,
    finishPlace: 0,
    totalTime: 0,
  };
}

/** Place car on the starting grid, two per row behind the line. index 0 = pole. */
export function placeOnGrid(car: CarBody, track: Track, index: number): void {
  const side = index % 2 === 0 ? 1 : -1;
  const back = 5 + Math.floor(index / 2) * 5.5 + (index % 2) * 1.5;
  const p = pointAt(track, -back);
  const lateral = side * track.halfWidth * 0.4;
  Object.assign(car, createCar(), {
    x: p.x + p.tz * lateral,
    z: p.z - p.tx * lateral,
    heading: Math.atan2(p.tx, p.tz),
    progress: -back,
  });
}

/**
 * Advance physics by dt seconds. Mutates `car`.
 * Returns true if a new lap was completed.
 */
export function stepCar(
  car: CarBody,
  input: InputState,
  dt: number,
  track: Track,
  spec: CarSpec,
  now = Date.now(),
): boolean {
  if (car.finished) {
    car.v *= 0.96;
    if (Math.abs(car.v) < 0.3) car.v = 0;
    move(car, dt);
    collideWithWalls(car, track);
    return false;
  }

  const v0 = car.v;
  let a = 0;

  if (input.up) a = car.v < -0.5 ? 18 : spec.accel * (1 - Math.max(car.v, 0) / spec.vmax);
  if (input.down) a = car.v > 0.5 ? -spec.brake : -6 * (1 - Math.max(-car.v, 0) / 14);
  if (input.brake) a -= Math.sign(car.v || 1) * 22;

  const off = project(track, car.x, car.z, car.progress).dist > track.halfWidth;
  const drag = 0.8 + 0.0016 * car.v * car.v;
  const grass = off ? (5 + 0.006 * car.v * car.v) * spec.offroad : 0;
  a -= Math.sign(car.v || 1) * (drag + grass);

  car.v += a * dt;
  if (!input.up && !input.down && (v0 * car.v < 0 || Math.abs(car.v) < 0.2)) car.v = 0;

  const aLong = (car.v - v0) / (dt || 1e-6);

  const dir = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const maxS = Math.min(0.55, Math.atan((spec.grip * WB) / (car.v * car.v + 1)));
  car.steer += (dir * maxS - car.steer) * Math.min(1, (dir ? 6 : 9) * dt);
  const t = Math.tan(car.steer);

  car.heading += (car.v / WB) * t * dt;
  move(car, dt);
  const s = collideWithWalls(car, track);

  const aLat = ((car.v * car.v) / WB) * t;
  car.roll += (clamp(aLat * 0.004, -0.06, 0.06) - car.roll) * Math.min(1, 8 * dt);
  car.pitch += (clamp(-aLong * 0.004, -0.05, 0.05) - car.pitch) * Math.min(1, 8 * dt);

  // Lap detection: add the signed distance moved along the centre line
  const half = track.length / 2;
  let ds = s - mod(car.progress, track.length);
  if (ds > half) ds -= track.length;
  if (ds < -half) ds += track.length;
  car.progress += ds;

  if (Math.floor(car.progress / track.length) > car.laps) {
    car.laps++;
    const tLap = (now - car.lapStart) / 1000;
    car.lapStart = now;
    if (!car.best || tLap < car.best) car.best = tLap;
    return true;
  }
  return false;
}

function move(car: CarBody, dt: number) {
  car.x += Math.sin(car.heading) * car.v * dt;
  car.z += Math.cos(car.heading) * car.v * dt;
}

/**
 * Keep the car inside the barriers: push it back, take speed according to how
 * head-on the hit was, and turn the nose along the wall so it does not stick.
 * Returns the car's distance along the lap.
 */
function collideWithWalls(car: CarBody, track: Track): number {
  const p = project(track, car.x, car.z, car.progress);
  const limit = wallOffset(track);
  if (p.dist <= limit) return p.s;

  const nx = (car.x - p.x) / p.dist;
  const nz = (car.z - p.z) / p.dist;
  car.x = p.x + nx * limit;
  car.z = p.z + nz * limit;

  const way = Math.sign(car.v) || 1;
  const impact = (Math.sin(car.heading) * nx + Math.cos(car.heading) * nz) * way;
  if (impact > 0) {
    car.v *= 1 - 0.3 * impact;
    const t = pointAt(track, p.s);
    // wall direction closest to where the car is already going
    let along = Math.atan2(t.tx, t.tz);
    const facing = car.heading + (way < 0 ? Math.PI : 0);
    if (Math.cos(along - facing) < 0) along += Math.PI;
    const turn = Math.atan2(Math.sin(along - facing), Math.cos(along - facing));
    car.heading += turn * 0.3;
  }
  return p.s;
}

const mod = (v: number, m: number) => ((v % m) + m) % m;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Simple circle collision between two cars */
export function resolveCollision(a: CarBody, b: CarBody, radius = 2.3): void {
  if (a.finished && b.finished) return;
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const dd = Math.hypot(dx, dz);
  if (dd < radius && dd > 0.01) {
    const push = (radius - dd) * 0.6;
    a.x += (dx / dd) * push;
    a.z += (dz / dd) * push;
    a.v *= 0.96;
  }
}
