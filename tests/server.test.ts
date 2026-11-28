import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

const PORT = 3917;

function open(port = PORT, headers: Record<string, string> = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

const closed = (ws: WebSocket) => new Promise<number>((r) => ws.once('close', (code) => r(code)));

async function healthy(port = PORT): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health`)).ok;
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

test('one address cannot open more connections than the limit', { timeout: 30_000 }, async (t) => {
  const port = PORT + 1;
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      RENDER: 'true',
      MAX_CONNECTIONS_PER_IP: '2',
    },
    stdio: 'ignore',
  });
  t.after(() => void server.kill());
  for (let i = 0; i < 100 && !(await healthy(port)); i++) await sleep(100);

  const from = (ip: string) => open(port, { 'cf-connecting-ip': ip });
  const a = await from('203.0.113.1');
  const b = await from('203.0.113.1');

  // listen before the connection opens: the refusal arrives at once
  const extra = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: { 'cf-connecting-ip': '203.0.113.1' },
  });
  const messages: { type: string; message?: string }[] = [];
  extra.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  // a join sent to a refused connection must be ignored
  extra.on('open', () => extra.send('{"type":"join","nick":"x","game":"car","quick":true}'));
  assert.equal(await closed(extra), 1013);
  assert.deepEqual(messages.map((m) => m.type), ['error']);

  const other = await from('203.0.113.2');
  await sleep(200);
  assert.equal(other.readyState, WebSocket.OPEN, 'another address is welcome');

  const aClosed = closed(a);
  a.close();
  await aClosed;
  await sleep(200);
  const again = await from('203.0.113.1');
  await sleep(200);
  assert.equal(again.readyState, WebSocket.OPEN, 'a closed connection frees its slot');

  const stats = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as { players: number };
  assert.equal(stats.players, 3);
  for (const ws of [b, other, again]) ws.close();
});
