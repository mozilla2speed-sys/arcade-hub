import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CATCH_UP, TickSchedule } from '../server/src/rooms/TickSchedule.js';

test('late wake-ups do not lower the tick rate', () => {
  const schedule = new TickSchedule(0, 50);
  let ticks = 0;
  let now = 0;
  // every wake-up comes a few milliseconds late, as real timers do
  while (now < 60_000) {
    now = schedule.next + 4;
    ticks += schedule.due(now);
  }
  assert.ok(Math.abs(ticks - 1200) <= 1, `${ticks} ticks in a minute`);
});

test('a short stall is caught up, a long one is not replayed', () => {
  const schedule = new TickSchedule(0, 50);
  assert.equal(schedule.due(20), 0);
  assert.equal(schedule.due(180), 3);
  assert.equal(schedule.due(190), 0);
  assert.equal(schedule.due(5000), MAX_CATCH_UP);
  assert.equal(schedule.due(5049), 0);
  assert.equal(schedule.due(5050), 1);
});
