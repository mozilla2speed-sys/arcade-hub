import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom } from './helpers.js';
import { InputQueue, MAX_HOLD_TICKS } from '../server/src/rooms/InputQueue.js';
import { createCar } from '../shared/src/games/car/physics.js';
import { getCar } from '../shared/src/games/car/cars.js';
import { getTrack } from '../shared/src/games/car/tracks.js';
import { canDrive, predictStep, reconcile, type PendingInput } from '../shared/src/games/car/prediction.js';
import type { CarState, InputState, RacePhase } from '../shared/src/messages.js';

const keys = (patch: Partial<InputState> = {}): InputState => ({
  up: false,
  down: false,
  left: false,
  right: false,
  brake: false,
  ...patch,
});

test('cars stay parked in the lobby even with gas held', (t) => {
  const r = makeRoom(t);
  const a = r.join('a');
  const start = r.state(a).cars[0];
  for (let i = 0; i < 40; i++) {
    a.inputs.push(i, keys({ up: true }));
    r.tick();
  }
  const s = r.state(a);
  assert.equal(s.phase, 'lobby');
  assert.deepEqual([s.cars[0].x, s.cars[0].z], [start.x, start.z]);
  assert.equal(s.ack, 39);
  assert.equal(canDrive('lobby', false), false);
});

test('mid-race joiner waits for the next race and is not in the results', (t) => {
  const r = makeRoom(t);
  const a = r.join('a');
  r.runUntil('racing', a);
  const late = r.join('late');
  const parked = r.state(late).cars.find((c) => c.id === 'late')!;
  assert.equal(parked.waiting, true);
  for (let i = 0; i < 40; i++) {
    late.inputs.push(i, keys({ up: true }));
    r.tick();
  }
  const after = r.state(late).cars.find((c) => c.id === 'late')!;
  assert.deepEqual([after.x, after.z], [parked.x, parked.z]);

  r.body(a).laps = 3;
  r.tick();
  assert.equal(r.state(a).phase, 'finished'); // the waiting car does not hold the race open
  assert.deepEqual(r.results(a)!.map((x) => x.id), ['a']);
  r.runUntil('countdown', late);
  assert.equal(r.state(late).cars.find((c) => c.id === 'late')!.waiting, false);
});

test('race resets when all its drivers leave', (t) => {
  const r = makeRoom(t);
  const a = r.join('a');
  r.runUntil('racing', a);
  const late = r.join('late');
  r.leave(a);
  r.tick();
  assert.equal(r.state(late).phase, 'lobby');
  assert.equal(r.state(late).cars[0].waiting, false);
});

test('input queue: one step per tick, ordered and bounded', () => {
  const q = new InputQueue();
  for (let i = 0; i < 20; i++) q.push(i, keys({ up: true }));
  q.push(3, keys()); // old seq is ignored
  assert.equal(q.next().length, 1);
  assert.ok(q.ack >= 8, 'only the newest inputs were kept');
  for (let i = 0; i < 20; i++) assert.ok(q.next().length <= 1);
  assert.equal(q.ack, 19);
});

test('input queue: the car waits for late input, then repays exactly those ticks', () => {
  const q = new InputQueue();
  q.push(0, keys({ up: true }));
  assert.equal(q.next().length, 1);
  for (let i = 0; i < 4; i++) assert.equal(q.next().length, 0);
  assert.equal(q.waitingTicks, 4);
  // the five delayed inputs arrive together
  for (let i = 1; i <= 5; i++) q.push(i, keys({ up: true }));
  const steps = q.next().length + q.next().length;
  assert.equal(steps, 5);
  assert.equal(q.ack, 5);
});

test('input queue: long silence releases the keys and forgets the waiting', () => {
  const q = new InputQueue();
  q.push(0, keys({ up: true }));
  q.next();
  for (let i = 0; i < MAX_HOLD_TICKS; i++) assert.equal(q.next().length, 0);
  const coasting = q.next();
  assert.equal(coasting.length, 1);
  assert.equal(coasting[0].up, false);
  assert.equal(q.waitingTicks, 0);
  for (let i = 1; i <= 6; i++) q.push(i, keys({ up: true }));
  assert.equal(q.next().length, 1, 'nothing left to repay');
});

test('input queue: sending in bursts or too often gives no extra speed', () => {
  for (const pattern of [(i: number) => 3, (i: number) => (i % 9 === 8 ? 9 : 0), (i: number) => (i % 20 < 8 ? 0 : 4)]) {
    const q = new InputQueue();
    let seq = 0;
    let steps = 0;
    for (let tick = 0; tick < 600; tick++) {
      for (let k = 0; k < pattern(tick); k++) q.push(seq++, keys({ up: true }));
      steps += q.next().length;
    }
    assert.ok(steps <= 600, `${steps} steps in 600 ticks`);
  }
});

test('prediction stays exact when inputs arrive unevenly', (t) => {
  const r = makeRoom(t, 'serpent');
  const a = r.join('a');
  r.runUntil('racing', a);

  const track = getTrack('serpent');
  const spec = getCar('sedan');
  const client = createCar();
  let pending: PendingInput[] = [];
  const first = r.state(a);
  reconcile(client, first.cars[0], track, spec, first.phase, first.ack, []);

  let random = 7;
  const rand = () => (random = (random * 16807) % 2147483647) / 2147483647;
  const inFlight: (PendingInput & { at: number })[] = [];
  const states: { at: number; phase: RacePhase; ack: number; car: CarState }[] = [];
  let release = 0;
  let worst = 0;
  let skipped = 0;
  let lastAck = -1;
  for (let tick = 0; tick < 600; tick++) {
    const input = { seq: tick, keys: keys({ up: true, left: tick % 40 < 12, right: tick % 70 > 60 }) };
    pending.push(input);
    predictStep(client, input.keys, track, spec);
    // up to two ticks of jitter and a five tick hold-up now and then; order is kept, as on TCP
    const delay = 2 + Math.floor(rand() * 3) + (tick % 90 === 89 ? 5 : 0);
    release = Math.max(release, tick + delay);
    inFlight.push({ ...input, at: release });

    while (inFlight.length && inFlight[0].at <= tick) {
      const arrived = inFlight.shift()!;
      a.inputs.push(arrived.seq, arrived.keys);
    }
    const before = a.inputs.ack;
    r.tick();
    const s = r.state(a);
    if (lastAck >= 0 && s.ack - before > 4) skipped++;
    lastAck = s.ack;
    states.push({ at: tick + 3, phase: s.phase, ack: s.ack, car: s.cars[0] });

    while (states.length && states[0].at <= tick) {
      const st = states.shift()!;
      const was = { x: client.x, z: client.z };
      pending = reconcile(client, st.car, track, spec, st.phase, st.ack, pending);
      worst = Math.max(worst, Math.hypot(client.x - was.x, client.z - was.z));
    }
  }
  assert.equal(skipped, 0);
  assert.ok(worst < 0.25, `largest correction was ${worst.toFixed(3)} m`);
});

for (const map of ['ring', 'valley', 'serpent'] as const) {
  test(`prediction matches the server when state arrives late (${map})`, (t) => {
    const r = makeRoom(t, map);
    const a = r.join('a');
    r.runUntil('racing', a);

    const track = getTrack(map);
    const spec = getCar('sedan');
    const client = createCar();
    let pending: PendingInput[] = [];
    let seq = 0;
    const delayed: { phase: RacePhase; ack: number; car: CarState }[] = [];
    const first = r.state(a);
    reconcile(client, first.cars[0], track, spec, first.phase, first.ack, []);

    const inFlight: PendingInput[] = [];
    const DELAY = 3; // ticks each way, about 150 ms
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      // drives into barriers and over grass as well as along the road
      const input = { seq: seq++, keys: keys({ up: true, left: i % 40 < 12 }) };
      pending.push(input);
      inFlight.push(input);
      predictStep(client, input.keys, track, spec);

      if (inFlight.length > DELAY) {
        const arrived = inFlight.shift()!;
        a.inputs.push(arrived.seq, arrived.keys);
        r.tick();
        const s = r.state(a);
        delayed.push({ phase: s.phase, ack: s.ack, car: s.cars[0] });
      }
      if (delayed.length > DELAY) {
        const s = delayed.shift()!;
        const before = { x: client.x, z: client.z };
        pending = reconcile(client, s.car, track, spec, s.phase, s.ack, pending);
        worst = Math.max(worst, Math.hypot(client.x - before.x, client.z - before.z));
      }
    }
    assert.ok(Math.hypot(client.x - first.cars[0].x, client.z - first.cars[0].z) > 20, 'the car drove');
    assert.ok(worst < 0.25, `largest correction was ${worst.toFixed(3)} m`);
  });
}
