import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom } from './helpers.js';
import { InputQueue } from '../server/src/rooms/InputQueue.js';
import { createCar } from '../shared/src/games/car/physics.js';
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

test('input queue: one per tick, ordered, bounded, released when stale', () => {
  const q = new InputQueue();
  for (let i = 0; i < 10; i++) q.push(i, keys({ up: true }));
  q.push(3, keys()); // old seq is ignored
  q.next();
  assert.equal(q.ack, 6); // only the newest 4 were kept
  q.next();
  q.next();
  q.next();
  assert.equal(q.ack, 9);
  for (let i = 0; i < 10; i++) assert.equal(q.next().up, true);
  assert.equal(q.next().up, false);
});

test('prediction matches the server when state arrives late', (t) => {
  const r = makeRoom(t);
  const a = r.join('a');
  r.runUntil('racing', a);

  const client = createCar();
  let pending: PendingInput[] = [];
  let seq = 0;
  const delayed: { phase: RacePhase; ack: number; car: CarState }[] = [];
  const first = r.state(a);
  reconcile(client, first.cars[0], first.phase, 3, first.ack, []);

  const inFlight: PendingInput[] = [];
  const DELAY = 3; // ticks each way, about 150 ms
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const input = { seq: seq++, keys: keys({ up: true, left: i % 40 < 12 }) };
    pending.push(input);
    inFlight.push(input);
    predictStep(client, input.keys, 3);

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
      pending = reconcile(client, s.car, s.phase, 3, s.ack, pending);
      worst = Math.max(worst, Math.hypot(client.x - before.x, client.z - before.z));
    }
  }
  assert.ok(client.v > 10, 'the car actually drove');
  assert.ok(worst < 0.1, `largest correction was ${worst.toFixed(3)} m`);
});
