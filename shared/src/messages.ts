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
      /** seq of the receiver's last input applied by the server (-1: none yet) */
      ack: number;
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
  /** joined mid-race, will drive in the next one */
  waiting: boolean;
}

export interface RaceResultRow {
  id: string;
  nick: string;
  place: number;
  best: number;
  totalTime: number;
  /** false: did not cross the line before the race was closed */
  finished: boolean;
}

export const TICK_RATE = 20; // Hz
export const TICK_MS = 1000 / TICK_RATE;
export const MAX_PLAYERS_PER_ROOM = 8;
export const MAX_NICK_LEN = 14;
export const MAX_CODE_LEN = 20;
export const TOTAL_LAPS = 3;
/** Time the others get after the first car crosses the line */
export const FINISH_GRACE_SEC = 20;
/** Hard limit, so a race where nobody finishes still ends */
export const MAX_RACE_SEC = 300;
