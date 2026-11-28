import type { InputState } from '../../../shared/src/messages.js';

/** Hard limit on buffered inputs. */
const MAX_QUEUED = 12;
/**
 * How long a car waits for late inputs (ticks). Longer silence means a hidden
 * tab or a dead network: the car then coasts with no keys pressed.
 */
export const MAX_HOLD_TICKS = 8;
/** Late steps repaid in one tick, on top of the normal one. */
const MAX_EXTRA_STEPS = 3;
/** With nothing to repay, a longer queue only adds delay: keep the newest. */
const MAX_LAG = 5;
const KEEP_AFTER_LAG = 2;

const released = (): InputState => ({
  up: false,
  down: false,
  left: false,
  right: false,
  brake: false,
});

/**
 * Per-player input buffer. Normally one input is one physics step per tick.
 * When inputs are late (uneven network) the car waits instead of guessing the
 * keys, then catches up, so the server computes exactly the steps the client
 * predicted. A car only gets extra steps for ticks it waited through, so
 * sending more often cannot make it faster.
 */
export class InputQueue {
  /** seq of the last input applied by the server, -1 before the first one */
  ack = -1;
  private lastReceived = -1;
  private queue: { seq: number; keys: InputState }[] = [];
  /** ticks waited through and not yet repaid */
  private owed = 0;
  private silentTicks = 0;

  /** Ticks the car has been standing still waiting for input right now. */
  get waitingTicks(): number {
    return this.silentTicks <= MAX_HOLD_TICKS ? this.silentTicks : 0;
  }

  push(seq: number, keys: InputState): void {
    if (seq <= this.lastReceived) return;
    this.lastReceived = seq;
    this.queue.push({ seq, keys });
    if (this.queue.length > MAX_QUEUED) this.queue.splice(0, this.queue.length - MAX_QUEUED);
  }

  /** Keys for the physics steps of one tick: none, one, or a few when catching up. */
  next(): InputState[] {
    if (this.queue.length === 0) {
      this.silentTicks++;
      if (this.silentTicks <= MAX_HOLD_TICKS) {
        this.owed = Math.min(this.owed + 1, MAX_HOLD_TICKS);
        return [];
      }
      this.owed = 0;
      return [released()];
    }

    this.silentTicks = 0;
    const steps = [this.take()];
    // one input stays in reserve, to absorb the next small delay
    while (this.owed > 0 && this.queue.length > 1 && steps.length <= MAX_EXTRA_STEPS) {
      steps.push(this.take());
      this.owed--;
    }
    if (this.owed === 0 && this.queue.length > MAX_LAG) {
      this.queue.splice(0, this.queue.length - KEEP_AFTER_LAG);
    }
    return steps;
  }

  /** Outside the race nothing moves: accept everything so no delay builds up. */
  drain(): void {
    const last = this.queue[this.queue.length - 1];
    if (last) this.ack = last.seq;
    this.queue = [];
    this.owed = 0;
    this.silentTicks = 0;
  }

  reset(): void {
    this.ack = -1;
    this.lastReceived = -1;
    this.queue = [];
    this.owed = 0;
    this.silentTicks = 0;
  }

  private take(): InputState {
    const item = this.queue.shift()!;
    this.ack = item.seq;
    return item.keys;
  }
}
