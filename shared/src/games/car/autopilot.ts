/**
 * A simple driver that follows the centre line. Used by tests to prove every
 * car can finish every map, and to compare lap times when tuning cars.
 */
import type { InputState } from '../../messages.js';
import type { CarSpec } from './cars.js';
import type { CarBody } from './physics.js';
import { pointAt, type Track } from './tracks.js';

export function autopilot(car: CarBody, track: Track, spec: CarSpec): InputState {
  const aim = pointAt(track, car.progress + 7 + Math.abs(car.v) * 0.35);
  const want = Math.atan2(aim.x - car.x, aim.z - car.z);
  const error = Math.atan2(Math.sin(want - car.heading), Math.cos(want - car.heading));

  // slow down for the sharpest bend ahead that can still be braked for
  let limit = spec.vmax;
  for (let d = 4; d < 90; d += 4) {
    const a = pointAt(track, car.progress + d - 4);
    const b = pointAt(track, car.progress + d + 4);
    const bend = Math.acos(Math.max(-1, Math.min(1, a.tx * b.tx + a.tz * b.tz))) / 8;
    if (bend < 1e-3) continue;
    const corner = Math.sqrt((spec.grip * 0.95) / bend);
    limit = Math.min(limit, Math.sqrt(corner * corner + 2 * spec.brake * 0.6 * Math.max(0, d - 6)));
  }

  return {
    up: car.v < limit,
    down: car.v > limit + 2 && car.v > 6,
    left: error > 0.025,
    right: error < -0.025,
    brake: false,
  };
}
