import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMessage } from '../server/src/rooms/protocol.js';
import { RateLimiter } from '../server/src/rooms/RateLimiter.js';

test('rejects malformed messages', () => {
  const bad = [
    'not json',
    'null',
    '42',
    '[]',
    '{}',
    '{"type":"nope"}',
    '{"type":"join","nick":123,"game":"car"}',
    '{"type":"join","code":5,"game":"car"}',
    '{"type":"join","nick":"a","game":"chess"}',
    '{"type":"input","seq":1}',
    '{"type":"input","seq":-1,"keys":{}}',
    '{"type":"input","seq":1.5,"keys":{}}',
    '{"type":"ping","t":"x"}',
  ];
  for (const raw of bad) assert.equal(parseClientMessage(raw), null, raw);
});

test('accepts valid messages and keeps only boolean keys', () => {
  assert.equal(parseClientMessage('{"type":"join","nick":"a","game":"car"}')?.type, 'join');
  assert.deepEqual(parseClientMessage('{"type":"input","seq":3,"keys":{"up":true,"left":"yes"}}'), {
    type: 'input',
    seq: 3,
    keys: { up: true, down: false, left: false, right: false, brake: false },
  });
});

test('rate limiter allows normal play and stops a flood', () => {
  const normal = new RateLimiter(60, 150, 0);
  for (let i = 1; i <= 2000; i++) assert.ok(normal.allow(i * 50));

  const flood = new RateLimiter(60, 150, 0);
  let accepted = 0;
  for (let i = 0; i < 1000; i++) if (flood.allow(0)) accepted++;
  assert.equal(accepted, 150);
});
