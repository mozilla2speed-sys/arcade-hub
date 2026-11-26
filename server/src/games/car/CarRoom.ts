import {
  type ServerMessage,
  type CarState,
  type RacePhase,
  type RaceResultRow,
  TOTAL_LAPS,
} from '../../../../shared/src/messages.js';
import {
  type CarBody,
  createCar,
  stepCar,
  resolveCollision,
  placeOnGrid,
} from '../../../../shared/src/games/car/physics.js';
import { BaseRoom, type PlayerSocket, safeSend } from '../../rooms/BaseRoom.js';

interface CarPlayer {
  socket: PlayerSocket;
  body: CarBody;
}

const LOBBY_WAIT_MS = 4000;
const COUNTDOWN_SEC = 3;
const RESULT_SHOW_MS = 12000;

export class CarRoom extends BaseRoom {
  private cars = new Map<string, CarPlayer>();
  private phase: RacePhase = 'lobby';
  private countdown = 0;
  private phaseTimer = 0; // seconds accumulator
  private nextPlace = 1;
  private results: RaceResultRow[] = [];
  private lobbyStableMs = 0;

  constructor(code: string) {
    super(code, 'car');
  }

  onPlayerJoin(p: PlayerSocket): void {
    const body = createCar();
    const idx = this.cars.size;
    placeOnGrid(body, idx);
    this.cars.set(p.id, { socket: p, body });

    // New player during race joins as spectator-ish (spawned, can drive after next race)
    if (this.phase === 'lobby') {
      this.lobbyStableMs = 0;
      this.regrid();
    }
  }

  onPlayerLeave(p: PlayerSocket): void {
    this.cars.delete(p.id);
    if (this.phase === 'lobby') this.regrid();
  }

  private regrid() {
    let i = 0;
    for (const cp of this.cars.values()) {
      placeOnGrid(cp.body, i++);
    }
  }

  onTick(dt: number): void {
    const now = Date.now();
    this.phaseTimer += dt;

    if (this.phase === 'lobby') {
      this.lobbyStableMs += dt * 1000;
      // Start countdown when at least 1 player and lobby settled
      if (this.cars.size >= 1 && this.lobbyStableMs >= LOBBY_WAIT_MS) {
        this.beginCountdown();
      }
      return;
    }

    if (this.phase === 'countdown') {
      const left = Math.ceil(COUNTDOWN_SEC - this.phaseTimer);
      this.countdown = Math.max(0, left);
      if (this.phaseTimer >= COUNTDOWN_SEC) {
        this.beginRace(now);
      }
      return;
    }

    if (this.phase === 'finished') {
      if (this.phaseTimer >= RESULT_SHOW_MS / 1000) {
        this.resetToLobby();
      }
      return;
    }

    // racing
    const list = [...this.cars.values()];
    const empty = { up: false, down: false, left: false, right: false, brake: false };

    for (const cp of list) {
      const input = cp.body.finished ? empty : cp.socket.lastInput;
      stepCar(cp.body, input, dt, now);

      if (!cp.body.finished && cp.body.laps >= TOTAL_LAPS) {
        cp.body.finished = true;
        cp.body.finishPlace = this.nextPlace++;
        cp.body.totalTime = (now - cp.body.raceStart) / 1000;
        cp.body.v *= 0.5;
      }
    }

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        resolveCollision(list[i].body, list[j].body);
        resolveCollision(list[j].body, list[i].body);
      }
    }

    const allDone =
      list.length > 0 && list.every((c) => c.body.finished);
    // Or first finisher + 25s grace
    const someoneFinished = list.some((c) => c.body.finished);
    if (allDone || (someoneFinished && this.phaseTimer > 25 && list.filter((c) => !c.body.finished).length === 0)) {
      this.endRace();
    } else if (someoneFinished && this.phaseTimer > 40) {
      // force end slow players
      for (const cp of list) {
        if (!cp.body.finished) {
          cp.body.finished = true;
          cp.body.finishPlace = this.nextPlace++;
          cp.body.totalTime = (now - cp.body.raceStart) / 1000;
        }
      }
      this.endRace();
    }
  }

  private beginCountdown() {
    this.phase = 'countdown';
    this.phaseTimer = 0;
    this.countdown = COUNTDOWN_SEC;
    this.regrid();
    for (const cp of this.cars.values()) {
      cp.body.v = 0;
      cp.body.steer = 0;
    }
  }

  private beginRace(now: number) {
    this.phase = 'racing';
    this.phaseTimer = 0;
    this.nextPlace = 1;
    this.results = [];
    for (const cp of this.cars.values()) {
      cp.body.raceStart = now;
      cp.body.lapStart = now;
      cp.body.laps = 0;
      cp.body.progress = cp.body.lastAng;
      cp.body.finished = false;
      cp.body.finishPlace = 0;
      cp.body.best = 0;
      cp.body.v = 0;
    }
  }

  private endRace() {
    this.phase = 'finished';
    this.phaseTimer = 0;
    this.results = [...this.cars.values()]
      .map((cp) => ({
        id: cp.socket.id,
        nick: cp.socket.nick,
        place: cp.body.finishPlace || 99,
        best: +cp.body.best.toFixed(1),
        totalTime: +cp.body.totalTime.toFixed(1),
      }))
      .sort((a, b) => a.place - b.place);

    for (const cp of this.cars.values()) {
      safeSend(cp.socket.ws, { type: 'race_result', results: this.results });
    }
  }

  private resetToLobby() {
    this.phase = 'lobby';
    this.phaseTimer = 0;
    this.lobbyStableMs = 0;
    this.nextPlace = 1;
    this.results = [];
    this.regrid();
  }

  getStateFor(_p: PlayerSocket): ServerMessage {
    const cars: CarState[] = [];
    for (const [id, cp] of this.cars) {
      const b = cp.body;
      cars.push({
        id,
        x: +b.x.toFixed(2),
        z: +b.z.toFixed(2),
        heading: +b.heading.toFixed(3),
        v: +b.v.toFixed(2),
        steer: +b.steer.toFixed(3),
        progress: +b.progress.toFixed(2),
        laps: b.laps,
        best: +b.best.toFixed(1),
        colorHue: cp.socket.colorHue,
        nick: cp.socket.nick,
        finished: b.finished,
        finishPlace: b.finishPlace,
      });
    }
    return {
      type: 'state',
      tick: this.tickCount,
      phase: this.phase,
      countdown: this.phase === 'countdown' ? this.countdown : undefined,
      totalLaps: TOTAL_LAPS,
      cars,
    };
  }
}
