import { randomBytes } from 'crypto';
import type { WebSocket } from 'ws';
import {
  type GameId,
  type ClientMessage,
  type PlayerInfo,
  MAX_PLAYERS_PER_ROOM,
  MAX_NICK_LEN,
  MAX_CODE_LEN,
} from '../../../shared/src/messages.js';
import { CarRoom } from '../games/car/CarRoom.js';
import { BaseRoom, type PlayerSocket, safeSend } from './BaseRoom.js';
import { parseClientMessage } from './protocol.js';
import { InputQueue } from './InputQueue.js';
import { DEFAULT_CAR } from '../../../shared/src/games/car/cars.js';
import { DEFAULT_TRACK, type TrackId } from '../../../shared/src/games/car/tracks.js';

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
      car: DEFAULT_CAR,
      color: 0,
      room: null,
      inputs: new InputQueue(),
    };
    this.players.set(id, p);
    return p;
  }

  handleMessage(p: PlayerSocket, raw: string) {
    const msg = parseClientMessage(raw);
    if (!msg) {
      safeSend(p.ws, { type: 'error', message: 'bad message' });
      return;
    }

    switch (msg.type) {
      case 'join':
        this.handleJoin(p, msg);
        break;
      case 'input':
        if (p.room) p.inputs.push(msg.seq, msg.keys);
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
    p.car = msg.car ?? DEFAULT_CAR;
    p.color = msg.color ?? 0;
    const map = msg.map ?? DEFAULT_TRACK;

    const game: GameId = msg.game === 'hole' ? 'hole' : 'car';

    let room: BaseRoom | undefined;

    if (msg.quick) {
      for (const r of this.rooms.values()) {
        const fits = r.isPublic && r.game === game && r.map === map;
        if (fits && r.players.size < MAX_PLAYERS_PER_ROOM) {
          room = r;
          break;
        }
      }
      if (!room) {
        let code = generateCode();
        while (this.rooms.has(code)) code = generateCode();
        room = this.createRoom(code, game, map);
        room.isPublic = true;
      }
    } else {
      const code =
        (msg.code || 'garage').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, MAX_CODE_LEN) ||
        'garage';
      room = this.rooms.get(code);
      if (!room) {
        room = this.createRoom(code, game, map);
      } else if (room.game !== game) {
        safeSend(p.ws, { type: 'error', message: 'В этой комнате другая игра' });
        return;
      } else if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
        safeSend(p.ws, { type: 'room_full' });
        return;
      }
    }

    p.inputs.reset();
    room.add(p);

    const players: PlayerInfo[] = [...room.players.values()].map((pl) => ({
      id: pl.id,
      nick: pl.nick,
      car: pl.car,
      color: pl.color,
    }));

    safeSend(p.ws, {
      type: 'welcome',
      playerId: p.id,
      roomCode: room.code,
      game: room.game,
      map: room.map,
      players,
    });
  }

  private createRoom(code: string, game: GameId, map: TrackId): BaseRoom {
    // only the racing game exists so far
    const room: BaseRoom = new CarRoom(code, map);
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
