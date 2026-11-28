import type { TestContext } from 'node:test';
import { CarRoom } from '../server/src/games/car/CarRoom.js';
import { InputQueue } from '../server/src/rooms/InputQueue.js';
import type { PlayerSocket } from '../server/src/rooms/BaseRoom.js';
import type { ServerMessage } from '../shared/src/messages.js';
import { TICK_SEC } from '../shared/src/games/car/prediction.js';

/** A room driven tick by tick with a fake clock instead of timers. */
export function makeRoom(t: TestContext) {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const room = new CarRoom('test');
  const inbox = new Map<string, ServerMessage[]>();

  const join = (id: string) => {
    inbox.set(id, []);
    const player = {
      id,
      nick: id,
      colorHue: 0,
      room: null,
      inputs: new InputQueue(),
      ws: { readyState: 1, send: (s: string) => inbox.get(id)!.push(JSON.parse(s)) },
    } as unknown as PlayerSocket;
    room.players.set(id, player);
    room.onPlayerJoin(player);
    return player;
  };

  const leave = (player: PlayerSocket) => {
    room.players.delete(player.id);
    room.onPlayerLeave(player);
  };

  const tick = () => {
    now += TICK_SEC * 1000;
    room.onTick(TICK_SEC);
  };

  const state = (p: PlayerSocket) => {
    const msg = room.getStateFor(p);
    if (msg.type !== 'state') throw new Error('not a state message');
    return msg;
  };

  const runUntil = (phase: string, p: PlayerSocket) => {
    for (let i = 0; i < 10_000 && state(p).phase !== phase; i++) tick();
    if (state(p).phase !== phase) throw new Error(`phase ${phase} not reached`);
  };

  /** Test shortcut: reach into the room to place a car where the test needs it. */
  const body = (p: PlayerSocket) => (room as any).cars.get(p.id).body;

  const results = (p: PlayerSocket) => {
    const msg = inbox.get(p.id)!.find((m) => m.type === 'race_result');
    return msg?.type === 'race_result' ? msg.results : undefined;
  };

  return { room, join, leave, tick, state, runUntil, body, results };
}
