/** Common protocol between client and server */
import type { CarId } from './games/car/cars.js';
import type { TrackId } from './games/car/tracks.js';

export type GameId = 'car' | 'hole'; // hole later

export type RacePhase = 'lobby' | 'countdown' | 'racing' | 'finished';

export interface PlayerInfo {
  id: string;
  nick: string;
  car: CarId;
  /** index in CAR_COLORS */
  color: number;
}

// ---- Client → Server ----
export type ClientMessage =
  | {
      type: 'join';
      nick: string;
      code?: string;
      quick?: boolean;
      game: GameId;
      /** used when this join creates the room; otherwise the room's map applies */
      map?: TrackId;
      car?: CarId;
      color?: number;
    }
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
  | {
      type: 'welcome';
      playerId: string;
      roomCode: string;
      game: GameId;
      map: TrackId;
      players: PlayerInfo[];
    }
  | { type: 'player_joined'; player: PlayerInfo }
  | { type: 'player_left'; playerId: string }
  | {
      type: 'state';
      tick: number;
      phase: RacePhase;
      countdown?: number;
      totalLaps: number;
      /** seconds left to finish, once somebody has finished */
      graceLeft?: number;
      /** seconds until the next race, while results are shown */
      nextRaceIn?: number;
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
  /** current lap, seconds */
  lapTime: number;
  car: CarId;
  color: number;
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
/** Time the others get after the first car crosses the line */
export const FINISH_GRACE_SEC = 30;
/** Hard limit, so a race where nobody finishes still ends */
export const MAX_RACE_SEC = 360;
