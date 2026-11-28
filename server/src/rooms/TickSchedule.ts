/** Ticks run at once after a stall. A longer backlog is dropped, not replayed. */
export const MAX_CATCH_UP = 5;

/**
 * Keeps the long-run tick rate exact. A plain setInterval runs a little late
 * every time, so the server fell behind the clients (they send exactly 20 inputs
 * a second), their input queues overflowed and cars jumped every few seconds.
 * Here every tick has a fixed due time, so lateness does not add up.
 */
export class TickSchedule {
  /** time the next tick is due, ms */
  next: number;

  constructor(
    now: number,
    private readonly interval: number,
  ) {
    this.next = now + interval;
  }

  /** How many ticks to run now. */
  due(now: number): number {
    if (now < this.next) return 0;
    const count = Math.floor((now - this.next) / this.interval) + 1;
    if (count > MAX_CATCH_UP) {
      this.next = now + this.interval;
      return MAX_CATCH_UP;
    }
    this.next += count * this.interval;
    return count;
  }
}
