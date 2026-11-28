import type { InputState } from '../../../shared/src/messages.js';

/** More than this many unprocessed inputs means added latency: drop the oldest. */
const MAX_QUEUED = 4;
/** Ticks without new input before the keys are treated as released (hidden tab, bad network). */
const STALE_TICKS = 10;

const released = (): InputState => ({
  up: false,
  down: false,
  left: false,
  right: false,
  brake: false,
});

/**
 * Per-player input buffer. The server takes exactly one input per tick, so a
 * client cannot drive faster by sending more often.
 */
export class InputQueue {
  /** seq of the last input applied by the server, -1 before the first one */
  ack = -1;
  private lastReceived = -1;
  private queue: { seq: number; keys: InputState }[] = [];
  private current = released();
  private idleTicks = 0;

  push(seq: number, keys: InputState): void {
    if (seq <= this.lastReceived) return;
    this.lastReceived = seq;
    this.queue.push({ seq, keys });
    if (this.queue.length > MAX_QUEUED) this.queue.splice(0, this.queue.length - MAX_QUEUED);
  }

  /** Input to use for the next tick. */
  next(): InputState {
    const item = this.queue.shift();
    if (item) {
      this.ack = item.seq;
      this.current = item.keys;
      this.idleTicks = 0;
    } else if (++this.idleTicks > STALE_TICKS) {
      this.current = released();
    }
    return this.current;
  }

  reset(): void {
    this.ack = -1;
    this.lastReceived = -1;
    this.queue = [];
    this.current = released();
    this.idleTicks = 0;
  }
}
