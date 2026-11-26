/** Common protocol between client and server */

export type GameId = 'car' | 'hole'; // hole later

export type RacePhase = 'lobby' | 'countdown' | 'racing' | 'finished';

export interface PlayerInfo {
  id: string;
  nick: string;
  colorHue: number;
}

// ---- Client → Server ----
export type ClientMessage =
  | { type: 'join'; nick: string; code?: string; quick?: boolean; game: GameId }
  | { type: 'input'; keys: InputState; seq: number }
  | { type: 'ping'; t: number }
  | { type: 'leave' }
  | { type: 'ready' }; // optional: skip lobby wait

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
}

// ---- Server → Client ----
export type ServerMessage =
  | { type: 'welcome'; playerId: string; roomCode: string; game: GameId; players: PlayerInfo[] }
  | { type: 'player_joined'; player: PlayerInfo }
  | { type: 'player_left'; playerId: string }
  | {
      type: 'state';
      tick: number;
      phase: RacePhase;
      countdown?: number;
      totalLaps: number;
      cars: CarState[];
    }
  | { type: 'pong'; t: number }
  | { type: 'error'; message: string }
  | { type: 'room_full' }
  | { type: 'countdown'; seconds: number }
  | { type: 'race_result'; results: RaceResultRow[] };

export interface CarState {
  id: string;
  x: number;
  z: number;
  heading: number;
  v: number;
  steer: number;
  progress: number;
  laps: number;
  best: number;
  colorHue: number;
  nick: string;
  finished: boolean;
  finishPlace: number; // 0 = still racing
}

export interface RaceResultRow {
  id: string;
  nick: string;
  place: number;
  best: number;
  totalTime: number;
}

export const TICK_RATE = 20; // Hz
export const TICK_MS = 1000 / TICK_RATE;
export const MAX_PLAYERS_PER_ROOM = 8;
export const MAX_NICK_LEN = 14;
export const MAX_CODE_LEN = 20;
export const TOTAL_LAPS = 3;
