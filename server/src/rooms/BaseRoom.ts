import type { WebSocket } from 'ws';
import {
  type GameId,
  type ServerMessage,
  TICK_MS,
} from '../../../shared/src/messages.js';
import type { InputQueue } from './InputQueue.js';

export interface PlayerSocket {
  id: string;
  ws: WebSocket;
  nick: string;
  colorHue: number;
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
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  tickCount = 0;
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

  start() {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      this.tickCount++;
      this.onTick(TICK_MS / 1000);
      for (const p of this.players.values()) {
        const msg = this.getStateFor(p);
        if (msg) safeSend(p.ws, msg);
      }
    }, TICK_MS);
  }

  stop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  add(p: PlayerSocket) {
    this.players.set(p.id, p);
    p.room = this;
    this.onPlayerJoin(p);
    this.broadcast(
      { type: 'player_joined', player: { id: p.id, nick: p.nick, colorHue: p.colorHue } },
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
