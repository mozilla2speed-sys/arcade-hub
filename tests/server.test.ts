import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

const PORT = 3917;

function open(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

const closed = (ws: WebSocket) => new Promise<number>((r) => ws.once('close', (code) => r(code)));

async function healthy(): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${PORT}/health`)).ok;
  } catch {
    return false;
  }
}

test('hostile frames do not take the server down', { timeout: 30_000 }, async (t) => {
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  t.after(() => void server.kill());
  for (let i = 0; i < 100 && !(await healthy()); i++) await sleep(100);

  const a = await open();
  for (const raw of ['null', '{"type":"join","nick":123,"game":"car"}', '{{{']) a.send(raw);
  await sleep(300);
  assert.ok(await healthy(), 'alive after malformed frames');

  const big = await open();
  const bigClosed = closed(big);
  big.send('x'.repeat(5000));
  assert.equal(await bigClosed, 1009);

  const flood = await open();
  const floodClosed = closed(flood);
  for (let i = 0; i < 500; i++) flood.send('{"type":"ping","t":1}');
  assert.equal(await floodClosed, 1008);

  assert.ok(await healthy(), 'alive after oversized frame and flood');
  a.close();
});
