import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/src/rooms/RoomManager.js';
import type { ServerMessage } from '../shared/src/messages.js';

function setup(t: TestContext) {
  const manager = new RoomManager();
  const players: ReturnType<RoomManager['createPlayer']>[] = [];
  // rooms run on real timers: leave them so the test process can exit
  t.after(() => players.forEach((p) => manager.disconnect(p)));

  const join = (opts: { code?: string; quick?: boolean; map?: string }) => {
    const inbox: ServerMessage[] = [];
    const ws = { readyState: 1, send: (s: string) => inbox.push(JSON.parse(s)) };
    const player = manager.createPlayer(ws as never);
    players.push(player);
    manager.handleMessage(player, JSON.stringify({ type: 'join', nick: 'a', game: 'car', ...opts }));
    const reply = inbox[0];
    return {
      player,
      code: reply.type === 'welcome' ? reply.roomCode : reply.type,
      map: reply.type === 'welcome' ? reply.map : undefined,
    };
  };

  /** Two open rooms: a full 'ring' one forces a second room, then somebody leaves the first. */
  const twoRooms = () => {
    const ring = Array.from({ length: 8 }, () => join({ quick: true, map: 'ring' }));
    const valley = join({ quick: true, map: 'valley' });
    manager.disconnect(ring[0].player);
    return { ring: ring[1], valley };
  };

  /** Test shortcut: the tests run synchronously, so no tick overrides this. */
  const startRace = (p: { player: { room: unknown } }) => {
    (p.player.room as { phase: string }).phase = 'racing';
  };

  return { join, twoRooms, startRace };
}

test('quick play never lands in a room created by code', (t) => {
  const { join } = setup(t);
  assert.equal(join({ code: 'friends' }).code, 'friends');
  const quick = join({ quick: true }).code;
  assert.notEqual(quick, 'friends');
  assert.equal(join({ quick: true }).code, quick, 'quick players are matched together');
});

test('a quick room can be shared by its code, and a full room refuses', (t) => {
  const { join } = setup(t);
  const quick = join({ quick: true }).code;
  for (let i = 0; i < 7; i++) assert.equal(join({ code: quick }).code, quick);
  assert.equal(join({ code: quick }).code, 'room_full');
  assert.notEqual(join({ quick: true }).code, quick);
});

test('quick play finds players on another track and reports that track', (t) => {
  const { join } = setup(t);
  const first = join({ quick: true, map: 'valley' });
  assert.equal(first.map, 'valley', 'a new room gets the chosen track');
  const second = join({ quick: true, map: 'ring' });
  assert.equal(second.code, first.code);
  assert.equal(second.map, 'valley');
});

test('among open rooms quick play prefers the chosen track, then the fuller room', (t) => {
  const { join, twoRooms } = setup(t);
  const { ring, valley } = twoRooms(); // ring: 7 players, valley: 1
  assert.equal(join({ quick: true, map: 'valley' }).code, valley.code);
  assert.equal(join({ quick: true, map: 'serpent' }).code, ring.code);
});

test('a room that starts soon wins over the chosen track in mid race', (t) => {
  const { join, twoRooms, startRace } = setup(t);
  const { ring, valley } = twoRooms();
  startRace(ring);
  assert.equal(join({ quick: true, map: 'ring' }).code, valley.code);
});

test('quick play joins a running race rather than leaving the player alone', (t) => {
  const { join, startRace } = setup(t);
  const first = join({ quick: true, map: 'ring' });
  startRace(first);
  assert.equal(join({ quick: true, map: 'valley' }).code, first.code);
});
