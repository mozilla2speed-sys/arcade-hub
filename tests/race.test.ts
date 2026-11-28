import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom } from './helpers.js';
import { FINISH_GRACE_SEC, MAX_RACE_SEC, TOTAL_LAPS } from '../shared/src/messages.js';

test('others get the full grace period even after a long race', (t) => {
  const r = makeRoom(t);
  const slow = r.join('slow');
  const mid = r.join('mid');
  const leader = r.join('leader');
  r.runUntil('racing', leader);

  for (let i = 0; i < 90 * 20; i++) r.tick(); // well past the old 40 s cut-off
  assert.equal(r.state(leader).phase, 'racing');

  r.body(mid).progress = 10;
  r.body(slow).progress = 2;
  r.body(leader).laps = TOTAL_LAPS;
  r.tick();

  for (let i = 0; i < (FINISH_GRACE_SEC - 1) * 20; i++) r.tick();
  assert.equal(r.state(leader).phase, 'racing');
  for (let i = 0; i < 21; i++) r.tick();
  assert.equal(r.state(leader).phase, 'finished');

  // unfinished cars are ranked by distance, not by who joined first
  assert.deepEqual(
    r.results(leader)!.map((x) => [x.id, x.place, x.finished]),
    [
      ['leader', 1, true],
      ['mid', 2, false],
      ['slow', 3, false],
    ],
  );
});

test('a race where nobody finishes still ends', (t) => {
  const r = makeRoom(t);
  const a = r.join('a');
  r.runUntil('racing', a);
  for (let i = 0; i <= MAX_RACE_SEC * 20; i++) r.tick();
  assert.equal(r.state(a).phase, 'finished');
});
