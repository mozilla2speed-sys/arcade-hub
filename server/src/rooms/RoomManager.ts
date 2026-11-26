import { randomBytes } from 'crypto';
import type { WebSocket } from 'ws';
import {
  type GameId,
  type ClientMessage,
  type PlayerInfo,
  type InputState,
  MAX_PLAYERS_PER_ROOM,
  MAX_NICK_LEN,
  MAX_CODE_LEN,
} from '../../../shared/src/messages.js';
import { CarRoom } from '../games/car/CarRoom.js';
import { BaseRoom, type PlayerSocket, safeSend } from './BaseRoom.js';

export type { PlayerSocket };
export { BaseRoom, safeSend };

export class RoomManager {
  private rooms = new Map<string, BaseRoom>();
  private players = new Map<string, PlayerSocket>();

  createPlayer(ws: WebSocket): PlayerSocket {
    const id = randomBytes(8).toString('hex');
    const p: PlayerSocket = {
      id,
      ws,
      nick: 'Гонщик',
      colorHue: Math.random(),
      room: null,
      lastInput: { up: false, down: false, left: false, right: false, brake: false },
      seq: 0,
    };
    this.players.set(id, p);
    return p;
  }

  handleMessage(p: PlayerSocket, raw: string) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      safeSend(p.ws, { type: 'error', message: 'bad json' });
      return;
    }

    switch (msg.type) {
      case 'join':
        this.handleJoin(p, msg);
        break;
      case 'input':
        if (p.room && typeof msg.seq === 'number') {
          p.lastInput = sanitizeInput(msg.keys);
          p.seq = msg.seq;
        }
        break;
      case 'ping':
        safeSend(p.ws, { type: 'pong', t: msg.t });
        break;
      case 'leave':
        this.leaveRoom(p);
        break;
    }
  }

  private handleJoin(p: PlayerSocket, msg: Extract<ClientMessage, { type: 'join' }>) {
    this.leaveRoom(p);

    const nick = (msg.nick || 'Гонщик').trim().slice(0, MAX_NICK_LEN) || 'Гонщик';
    p.nick = nick;
    p.colorHue = Math.random();

    const game: GameId = msg.game === 'hole' ? 'hole' : 'car';

    let room: BaseRoom | undefined;

    if (msg.quick) {
      for (const r of this.rooms.values()) {
        if (r.game === game && r.players.size < MAX_PLAYERS_PER_ROOM) {
          room = r;
          break;
        }
      }
      if (!room) {
        const code = generateCode();
        room = this.createRoom(code, game);
      }
    } else {
      const code =
        (msg.code || 'garage').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, MAX_CODE_LEN) ||
        'garage';
      room = this.rooms.get(code);
      if (!room) {
        room = this.createRoom(code, game);
      } else if (room.game !== game) {
        safeSend(p.ws, { type: 'error', message: 'В этой комнате другая игра' });
        return;
      } else if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
        safeSend(p.ws, { type: 'room_full' });
        return;
      }
    }

    room.add(p);

    const players: PlayerInfo[] = [...room.players.values()].map((pl) => ({
      id: pl.id,
      nick: pl.nick,
      colorHue: pl.colorHue,
    }));

    safeSend(p.ws, {
      type: 'welcome',
      playerId: p.id,
      roomCode: room.code,
      game: room.game,
      players,
    });
  }

  private createRoom(code: string, game: GameId): BaseRoom {
    const room: BaseRoom = game === 'car' ? new CarRoom(code) : new CarRoom(code);
    this.rooms.set(code, room);
    return room;
  }

  leaveRoom(p: PlayerSocket) {
    if (p.room) {
      const room = p.room;
      room.remove(p);
      if (room.players.size === 0) {
        this.rooms.delete(room.code);
      }
    }
  }

  disconnect(p: PlayerSocket) {
    this.leaveRoom(p);
    this.players.delete(p.id);
  }

  getStats() {
    return {
      rooms: this.rooms.size,
      players: this.players.size,
    };
  }
}

function generateCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function sanitizeInput(k: any): InputState {
  return {
    up: !!k?.up,
    down: !!k?.down,
    left: !!k?.left,
    right: !!k?.right,
    brake: !!k?.brake,
  };
}
