import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, pointAt, project, wallOffset } from '../shared/src/games/car/tracks.js';
import { CARS } from '../shared/src/games/car/cars.js';
import { createCar, placeOnGrid, stepCar } from '../shared/src/games/car/physics.js';
import { autopilot } from '../shared/src/games/car/autopilot.js';
import { MAX_PLAYERS_PER_ROOM, MAX_RACE_SEC } from '../shared/src/messages.js';

for (const track of TRACKS) {
  test(`${track.id}: corners and neighbouring sections leave room for the barriers`, () => {
    const n = track.samples.length;
    for (let i = 0; i < n; i++) {
      const a = track.samples[i];
      const b = track.samples[(i + 4) % n];
      const angle = Math.acos(Math.min(1, a.tx * b.tx + a.tz * b.tz));
      // a tighter bend would fold the inner barrier over itself
      if (angle > 1e-4) assert.ok((4 * track.step) / angle > wallOffset(track), `bend at ${i}`);
      for (let j = i + 1; j < n; j++) {
        if (Math.min(j - i, n - (j - i)) * track.step <= 70) continue;
        const gap = Math.hypot(a.x - track.samples[j].x, a.z - track.samples[j].z);
        assert.ok(gap > 2 * wallOffset(track) + 2, `sections ${i} and ${j} overlap`);
      }
    }
  });

  test(`${track.id}: the starting grid is on the road and cars do not overlap`, () => {
    const cars = Array.from({ length: MAX_PLAYERS_PER_ROOM }, (_, i) => {
      const car = createCar();
      placeOnGrid(car, track, i);
      assert.ok(project(track, car.x, car.z, car.progress).dist < track.halfWidth);
      assert.ok(car.progress < 0);
      return car;
    });
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        assert.ok(Math.hypot(cars[i].x - cars[j].x, cars[i].z - cars[j].z) > 3);
      }
    }
  });

  for (const spec of CARS) {
    test(`${track.id}: ${spec.id} can finish the race`, () => {
      const car = createCar();
      placeOnGrid(car, track, 0);
      car.lapStart = 0;
      let now = 0;
      while (car.laps < track.laps && now < MAX_RACE_SEC * 1000) {
        now += 50;
        stepCar(car, autopilot(car, track, spec), 0.05, track, spec, now);
      }
      assert.equal(car.laps, track.laps);
    });
  }

  test(`${track.id}: barriers hold the car and cutting across gives no progress`, () => {
    const spec = CARS[1];
    const car = createCar();
    placeOnGrid(car, track, 0);
    for (let i = 0; i < 600; i++) {
      // full throttle, never steering
      stepCar(car, { up: true, down: false, left: false, right: false, brake: false }, 0.05, track, spec, i * 50);
      const p = project(track, car.x, car.z, car.progress);
      assert.ok(p.dist <= wallOffset(track) + 0.01, `left the track at tick ${i}`);
      const centre = pointAt(track, car.progress);
      assert.ok(Math.hypot(car.x - centre.x, car.z - centre.z) <= wallOffset(track) + 1);
    }
  });
}
