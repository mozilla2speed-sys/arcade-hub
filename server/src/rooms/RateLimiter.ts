/**
 * Token bucket. The client sends 20 inputs per second; the burst size leaves
 * room for frames that arrive together after a network stall.
 */
export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(
    private readonly perSecond = 60,
    private readonly burst = 150,
    now = Date.now(),
  ) {
    this.tokens = burst;
    this.last = now;
  }

  allow(now = Date.now()): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.perSecond);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
