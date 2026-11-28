import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/src/rooms/RoomManager.js';
import type { ServerMessage } from '../shared/src/messages.js';

function setup(t: TestContext) {
  const manager = new RoomManager();
  const players: ReturnType<RoomManager['createPlayer']>[] = [];
  // rooms run on real timers: leave them so the test process can exit
  t.after(() => players.forEach((p) => manager.disconnect(p)));

  return (join: { code?: string; quick?: boolean }) => {
    const inbox: ServerMessage[] = [];
    const ws = { readyState: 1, send: (s: string) => inbox.push(JSON.parse(s)) };
    const player = manager.createPlayer(ws as never);
    players.push(player);
    manager.handleMessage(player, JSON.stringify({ type: 'join', nick: 'a', game: 'car', ...join }));
    const reply = inbox[0];
    return reply.type === 'welcome' ? reply.roomCode : reply.type;
  };
}

test('quick play never lands in a room created by code', (t) => {
  const join = setup(t);
  assert.equal(join({ code: 'friends' }), 'friends');
  const quick = join({ quick: true });
  assert.notEqual(quick, 'friends');
  assert.equal(join({ quick: true }), quick, 'quick players are matched together');
});

test('a quick room can be shared by its code, and a full room refuses', (t) => {
  const join = setup(t);
  const quick = join({ quick: true });
  for (let i = 0; i < 7; i++) assert.equal(join({ code: quick }), quick);
  assert.equal(join({ code: quick }), 'room_full');
  assert.notEqual(join({ quick: true }), quick);
});
