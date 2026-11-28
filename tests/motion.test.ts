import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteMotion, ServerClock } from '../client/src/games/car/remoteMotion.js';

test('another car keeps moving evenly when states arrive late and in bunches', () => {
  const clock = new ServerClock();
  const motion = new RemoteMotion();
  const speed = 40; // m/s, straight along z
  let random = 11;
  const rand = () => (random = (random * 16807) % 2147483647) / 2147483647;

  // state of tick n leaves at n*50 ms; delay 40..100 ms, now and then a 150 ms hold-up
  const arrivals: { at: number; tick: number }[] = [];
  let release = 0;
  for (let tick = 0; tick < 400; tick++) {
    release = Math.max(release, tick * 50 + 40 + rand() * 60 + (tick % 70 === 69 ? 150 : 0));
    arrivals.push({ at: release, tick });
  }

  const frame = 1000 / 60;
  const expected = (speed * frame) / 1000;
  let previous: number | null = null;
  let worst = 0;
  for (let now = 0; now < 19_000; now += frame) {
    while (arrivals.length && arrivals[0].at <= now) {
      const { tick } = arrivals.shift()!;
      clock.observe(tick, now);
      motion.push(tick, { x: 0, z: (speed * tick * 50) / 1000, heading: 0, v: speed, steer: 0 });
    }
    if (motion.empty) continue;
    const z = motion.at(clock.renderTime(now)).z;
    if (previous !== null && now > 2000) worst = Math.max(worst, Math.abs(z - previous - expected));
    previous = z;
  }
  // 0.67 m a frame is expected; a freeze or a jump would miss that by far more
  assert.ok(worst < 0.2, `worst frame was off by ${worst.toFixed(2)} m`);
});

test('a new grid position is not driven to', () => {
  const motion = new RemoteMotion();
  const car = { x: 0, z: 0, heading: 0, v: 0, steer: 0 };
  motion.push(1, car);
  motion.push(2, { ...car, z: 200 });
  assert.equal(motion.at(75).z, 200);
});
