/**
 * Movement rules used by both sides. The server applies them to the real cars,
 * the client applies the same ones to predict its own car.
 */
import { TICK_MS, type CarState, type InputState, type RacePhase } from '../../messages.js';
import { stepCar, type CarBody } from './physics.js';

export const TICK_SEC = TICK_MS / 1000;

export interface PendingInput {
  seq: number;
  keys: InputState;
}

/** Cars move only during the race, and only if they started in it. */
export function canDrive(phase: RacePhase, waiting: boolean): boolean {
  return phase === 'racing' && !waiting;
}

/**
 * Rebuild the predicted car: start from the server state and replay the inputs
 * the server has not processed yet. Mutates `body`, returns the remaining inputs.
 */
export function reconcile(
  body: CarBody,
  server: CarState,
  phase: RacePhase,
  totalLaps: number,
  ack: number,
  pending: PendingInput[],
): PendingInput[] {
  body.x = server.x;
  body.z = server.z;
  body.heading = server.heading;
  body.v = server.v;
  body.steer = server.steer;
  body.progress = server.progress;
  body.lastAng = Math.atan2(server.z, server.x);
  body.laps = server.laps;
  body.best = server.best;
  body.finished = server.finished;
  body.finishPlace = server.finishPlace;

  const rest = pending.filter((p) => p.seq > ack);
  if (!canDrive(phase, server.waiting)) return rest;

  for (const p of rest) predictStep(body, p.keys, totalLaps);
  // Lap times are measured by the server only
  body.best = server.best;
  return rest;
}

/** One client-side tick, same length as a server tick. */
export function predictStep(body: CarBody, keys: InputState, totalLaps: number): void {
  stepCar(body, keys, TICK_SEC);
  if (!body.finished && body.laps >= totalLaps) {
    body.finished = true;
    body.v *= 0.5;
  }
}
