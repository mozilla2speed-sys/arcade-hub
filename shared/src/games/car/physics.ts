/**
 * Shared bicycle-model physics for the car game.
 * Used by both server (authoritative) and client (prediction / visuals).
 */

export const R = 0.38;          // wheel radius
export const WB = 2.8;          // wheelbase
export const VMAX = 55;         // m/s ≈ 198 km/h

export interface CarBody {
  x: number;
  z: number;
  heading: number;
  v: number;
  steer: number;
  roll: number;
  pitch: number;
  progress: number;
  lastAng: number;
  laps: number;
  best: number;
  lapStart: number;
}

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
}

export function createCar(x = 46, z = 0): CarBody {
  return {
    x, z,
    heading: 0,
    v: 0,
    steer: 0,
    roll: 0,
    pitch: 0,
    progress: 0,
    lastAng: Math.atan2(z, x),
    laps: 0,
    best: 0,
    lapStart: performance.now?.() ?? Date.now(),
  };
}

export function resetCar(car: CarBody): void {
  car.v = 0;
  car.heading = 0;
  car.steer = 0;
  car.x = 41 + Math.random() * 10;
  car.z = -Math.random() * 10;
  car.progress = 0;
  car.lastAng = Math.atan2(car.z, car.x);
  car.laps = 0;
  car.best = 0;
  car.lapStart = performance.now?.() ?? Date.now();
  car.roll = 0;
  car.pitch = 0;
}

/**
 * Advance physics by dt seconds. Mutates `car`.
 * Returns true if a new lap was completed.
 */
export function stepCar(car: CarBody, input: InputState, dt: number, now = Date.now()): boolean {
  const v0 = car.v;
  let a = 0;

  if (input.up) a = car.v < -0.5 ? 18 : 11 * (1 - Math.max(car.v, 0) / VMAX);
  if (input.down) a = car.v > 0.5 ? -20 : -6 * (1 - Math.max(-car.v, 0) / 14);
  if (input.brake) a -= Math.sign(car.v || 1) * 22;

  const rad = Math.hypot(car.x, car.z);
  const off = rad < 37.5 || rad > 54.5;
  a -= Math.sign(car.v || 1) * (0.8 + 0.0016 * car.v * car.v + (off ? 5 + 0.006 * car.v * car.v : 0));

  car.v += a * dt;
  if (!input.up && !input.down && (v0 * car.v < 0 || Math.abs(car.v) < 0.2)) car.v = 0;

  const aLong = (car.v - v0) / (dt || 1e-6);

  const dir = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const maxS = Math.min(0.55, Math.atan(18 * WB / (car.v * car.v + 1)));
  car.steer += (dir * maxS - car.steer) * Math.min(1, (dir ? 6 : 9) * dt);
  const t = Math.tan(car.steer);

  car.heading += (car.v / WB) * t * dt;
  car.x += Math.sin(car.heading) * car.v * dt;
  car.z += Math.cos(car.heading) * car.v * dt;

  const aLat = (car.v * car.v / WB) * t;
  car.roll += (clamp(aLat * 0.004, -0.06, 0.06) - car.roll) * Math.min(1, 8 * dt);
  car.pitch += (clamp(-aLong * 0.004, -0.05, 0.05) - car.pitch) * Math.min(1, 8 * dt);

  // Lap detection
  const ang = Math.atan2(car.z, car.x);
  let da = ang - car.lastAng;
  if (da > Math.PI) da -= 2 * Math.PI;
  if (da < -Math.PI) da += 2 * Math.PI;
  car.progress += da;
  car.lastAng = ang;

  let newLap = false;
  if (Math.floor(car.progress / (2 * Math.PI)) > car.laps) {
    car.laps++;
    const tLap = (now - car.lapStart) / 1000;
    car.lapStart = now;
    if (!car.best || tLap < car.best) car.best = tLap;
    newLap = true;
  }
  return newLap;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Simple circle collision between two cars */
export function resolveCollision(a: CarBody, b: CarBody, radius = 2.3): void {
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
