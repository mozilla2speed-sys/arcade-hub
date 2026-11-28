import type { WebSocket } from 'ws';
import {
  type GameId,
  type ServerMessage,
  TICK_MS,
} from '../../../shared/src/messages.js';
import type { InputQueue } from './InputQueue.js';
import { TickSchedule } from './TickSchedule.js';
import type { CarId } from '../../../shared/src/games/car/cars.js';
import type { TrackId } from '../../../shared/src/games/car/tracks.js';

export interface PlayerSocket {
  id: string;
  ws: WebSocket;
  nick: string;
  car: CarId;
  color: number;
  room: BaseRoom | null;
  inputs: InputQueue;
}

export function safeSend(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === 1 /* OPEN */) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }
}

export abstract class BaseRoom {
  readonly code: string;
  readonly game: GameId;
  players = new Map<string, PlayerSocket>();
  private schedule: TickSchedule | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private immediate: ReturnType<typeof setImmediate> | null = null;
  tickCount = 0;
  abstract readonly map: TrackId;
  /** true: created by quick play, so strangers may be matched into it */
  isPublic = false;

  constructor(code: string, game: GameId) {
    this.code = code;
    this.game = game;
  }

  abstract onPlayerJoin(p: PlayerSocket): void;
  abstract onPlayerLeave(p: PlayerSocket): void;
  abstract onTick(dt: number): void;
  abstract getStateFor(p: PlayerSocket): ServerMessage | null;
  /** true: somebody who joins now gets to play shortly, not after a running match */
  abstract get startsSoon(): boolean;

  start() {
    if (this.schedule) return;
    this.schedule = new TickSchedule(performance.now(), TICK_MS);
    this.arm();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    if (this.immediate) clearImmediate(this.immediate);
    this.timer = this.immediate = this.schedule = null;
  }

  private arm() {
    const wait = Math.max(0, this.schedule!.next - performance.now());
    this.timer = setTimeout(() => {
      // Timers run before network input. Waiting one step lets inputs that piled
      // up during a stall arrive before the ticks that need them.
      this.immediate = setImmediate(() => this.run());
    }, wait);
  }

  private run() {
    if (!this.schedule) return;
    const count = this.schedule.due(performance.now());
    for (let i = 0; i < count; i++) {
      this.tickCount++;
      this.onTick(TICK_MS / 1000);
    }
    // after catching up only the newest state is worth sending
    if (count > 0) {
      for (const p of this.players.values()) {
        const msg = this.getStateFor(p);
        if (msg) safeSend(p.ws, msg);
      }
    }
    this.arm();
  }

  add(p: PlayerSocket) {
    this.players.set(p.id, p);
    p.room = this;
    this.onPlayerJoin(p);
    this.broadcast(
      { type: 'player_joined', player: { id: p.id, nick: p.nick, car: p.car, color: p.color } },
      p.id,
    );
    if (this.players.size === 1) this.start();
  }

  remove(p: PlayerSocket) {
    this.players.delete(p.id);
    p.room = null;
    this.onPlayerLeave(p);
    this.broadcast({ type: 'player_left', playerId: p.id });
    if (this.players.size === 0) this.stop();
  }

  broadcast(msg: ServerMessage, exceptId?: string) {
    for (const p of this.players.values()) {
      if (p.id !== exceptId) safeSend(p.ws, msg);
    }
  }
}
