import {
  type ServerMessage,
  type CarState,
  type RacePhase,
  type RaceResultRow,
  FINISH_GRACE_SEC,
  MAX_RACE_SEC,
} from '../../../../shared/src/messages.js';
import {
  type CarBody,
  createCar,
  stepCar,
  resolveCollision,
  placeOnGrid,
} from '../../../../shared/src/games/car/physics.js';
import { getCar } from '../../../../shared/src/games/car/cars.js';
import {
  DEFAULT_TRACK,
  getTrack,
  type Track,
  type TrackId,
} from '../../../../shared/src/games/car/tracks.js';
import { TICK_SEC, canDrive } from '../../../../shared/src/games/car/prediction.js';
import { BaseRoom, type PlayerSocket, safeSend } from '../../rooms/BaseRoom.js';

interface CarPlayer {
  socket: PlayerSocket;
  body: CarBody;
  /** joined mid-race: stays parked until the next one */
  waiting: boolean;
}

const byProgress = (a: CarPlayer, b: CarPlayer) => b.body.progress - a.body.progress;

const LOBBY_WAIT_MS = 4000;
const COUNTDOWN_SEC = 3;
const RESULT_SHOW_MS = 12000;

export class CarRoom extends BaseRoom {
  private cars = new Map<string, CarPlayer>();
  private phase: RacePhase = 'lobby';
  private countdown = 0;
  private phaseTimer = 0; // seconds accumulator
  private nextPlace = 1;
  /** phaseTimer value when the first car finished */
  private firstFinishAt: number | null = null;
  /** ids of cars that did not cross the line in time */
  private dnf = new Set<string>();
  private results: RaceResultRow[] = [];
  private lobbyStableMs = 0;
  readonly map: TrackId;
  private readonly track: Track;

  constructor(code: string, map: TrackId = DEFAULT_TRACK) {
    super(code, 'car');
    this.map = map;
    this.track = getTrack(map);
  }

  get startsSoon(): boolean {
    // after the results the next race is only seconds away
    return this.phase !== 'racing';
  }

  onPlayerJoin(p: PlayerSocket): void {
    const body = createCar();
    const idx = this.cars.size;
    placeOnGrid(body, this.track, idx);
    const waiting = this.phase === 'racing' || this.phase === 'finished';
    this.cars.set(p.id, { socket: p, body, waiting });

    if (this.phase === 'lobby') this.lobbyStableMs = 0;
    if (!waiting) this.regrid();
  }

  onPlayerLeave(p: PlayerSocket): void {
    this.cars.delete(p.id);
    if (this.phase === 'lobby' || this.phase === 'countdown') this.regrid();
  }

  private regrid() {
    let i = 0;
    for (const cp of this.cars.values()) {
      cp.waiting = false;
      placeOnGrid(cp.body, this.track, i++);
    }
  }

  onTick(dt: number): void {
    const now = Date.now();
    this.phaseTimer += dt;

    // Cars that cannot move accept their inputs at once, so none pile up before the start
    for (const cp of this.cars.values()) {
      if (!canDrive(this.phase, cp.waiting)) cp.socket.inputs.drain();
    }

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
    const list = [...this.cars.values()].filter((cp) => canDrive(this.phase, cp.waiting));
    // Everyone who started has left: free the room for those waiting
    if (list.length === 0) {
      this.resetToLobby();
      return;
    }

    for (const cp of list) {
      // stepCar ignores the keys of a finished car and lets it coast
      const spec = getCar(cp.socket.car);
      // usually one step; see InputQueue for late inputs
      for (const keys of cp.socket.inputs.next()) {
        stepCar(cp.body, keys, dt, this.track, spec, now);
      }
    }

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        resolveCollision(list[i].body, list[j].body);
        resolveCollision(list[j].body, list[i].body);
      }
    }

    // Cars that crossed the line on the same tick: the one further ahead wins
    const arrived = list
      .filter((cp) => !cp.body.finished && cp.body.laps >= this.track.laps)
      .sort(byProgress);
    for (const cp of arrived) {
      this.finishCar(cp, now);
      cp.body.v *= 0.5;
      this.firstFinishAt ??= this.phaseTimer;
    }

    const allDone = list.every((c) => c.body.finished);
    const graceOver =
      this.firstFinishAt !== null && this.phaseTimer - this.firstFinishAt >= FINISH_GRACE_SEC;

    if (allDone || graceOver || this.phaseTimer >= MAX_RACE_SEC) {
      // Everyone still on track is ranked by distance covered
      for (const cp of list.filter((c) => !c.body.finished).sort(byProgress)) {
        this.dnf.add(cp.socket.id);
        this.finishCar(cp, now);
      }
      this.endRace();
    }
  }

  private finishCar(cp: CarPlayer, now: number) {
    cp.body.finished = true;
    cp.body.finishPlace = this.nextPlace++;
    cp.body.totalTime = (now - cp.body.raceStart) / 1000;
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
    this.firstFinishAt = null;
    this.dnf.clear();
    this.results = [];
    for (const cp of this.cars.values()) {
      cp.body.raceStart = now;
      cp.body.lapStart = now;
      cp.body.laps = 0;
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
      .filter((cp) => !cp.waiting)
      .map((cp) => ({
        id: cp.socket.id,
        nick: cp.socket.nick,
        place: cp.body.finishPlace || 99,
        best: +cp.body.best.toFixed(1),
        totalTime: +cp.body.totalTime.toFixed(1),
        finished: !this.dnf.has(cp.socket.id),
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

  getStateFor(p: PlayerSocket): ServerMessage {
    const cars: CarState[] = [];
    for (const [id, cp] of this.cars) {
      const b = cp.body;
      // Others must not see a car freeze while it waits for late input: show it
      // where it is heading. Its owner gets the exact state for prediction.
      const ahead =
        id !== p.id && canDrive(this.phase, cp.waiting)
          ? b.v * TICK_SEC * Math.min(cp.socket.inputs.waitingTicks, 4)
          : 0;
      cars.push({
        id,
        x: +(b.x + Math.sin(b.heading) * ahead).toFixed(2),
        z: +(b.z + Math.cos(b.heading) * ahead).toFixed(2),
        heading: +b.heading.toFixed(3),
        v: +b.v.toFixed(2),
        steer: +b.steer.toFixed(3),
        progress: +b.progress.toFixed(2),
        laps: b.laps,
        best: +b.best.toFixed(1),
        lapTime:
          this.phase === 'racing' && !cp.waiting && !b.finished
            ? +((Date.now() - b.lapStart) / 1000).toFixed(1)
            : 0,
        car: cp.socket.car,
        color: cp.socket.color,
        nick: cp.socket.nick,
        finished: b.finished,
        finishPlace: b.finishPlace,
        waiting: cp.waiting,
      });
    }
    return {
      type: 'state',
      tick: this.tickCount,
      phase: this.phase,
      countdown: this.phase === 'countdown' ? this.countdown : undefined,
      totalLaps: this.track.laps,
      graceLeft:
        this.phase === 'racing' && this.firstFinishAt !== null
          ? Math.max(0, Math.ceil(FINISH_GRACE_SEC - (this.phaseTimer - this.firstFinishAt)))
          : undefined,
      nextRaceIn:
        this.phase === 'finished'
          ? Math.max(0, Math.ceil(RESULT_SHOW_MS / 1000 - this.phaseTimer))
          : undefined,
      cars,
      ack: p.inputs.ack,
    };
  }
}
