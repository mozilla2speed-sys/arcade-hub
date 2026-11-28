/**
 * Where to draw somebody else's car. States arrive unevenly, so the car is not
 * drawn from the newest one: it is shown a little in the past, between two known
 * states, using the server's tick counter as the clock.
 */
import { TICK_MS } from '../../../../shared/src/messages.js';

/** How far behind the usual arrival time cars are drawn, ms. */
export const RENDER_DELAY_MS = 60;
/** When a state is late, keep the car moving this long at most, ms. */
export const MAX_AHEAD_MS = 250;

export interface Snapshot {
  x: number;
  z: number;
  heading: number;
  v: number;
  steer: number;
}

/** Local time at which a server tick normally arrives. One per connection. */
export class ServerClock {
  private offset: number | null = null;

  observe(tick: number, now: number) {
    const sample = now - tick * TICK_MS;
    if (this.offset === null || Math.abs(sample - this.offset) > 1000) this.offset = sample;
    // follow quick packets fast and slow ones slowly, so one late packet changes little
    else this.offset += (sample - this.offset) * (sample < this.offset ? 0.1 : 0.01);
  }

  /** Server time (ms) to draw other cars at. */
  renderTime(now: number) {
    return now - (this.offset ?? 0) - RENDER_DELAY_MS;
  }
}

const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const turn = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export class RemoteMotion {
  private list: (Snapshot & { time: number })[] = [];

  push(tick: number, s: Snapshot) {
    const time = tick * TICK_MS;
    const last = this.list[this.list.length - 1];
    if (last && time <= last.time) return;
    // a new grid position must not be driven to
    if (last && Math.hypot(s.x - last.x, s.z - last.z) > 15) this.list = [];
    this.list.push({ time, x: s.x, z: s.z, heading: s.heading, v: s.v, steer: s.steer });
    if (this.list.length > 20) this.list.shift();
  }

  get empty() {
    return this.list.length === 0;
  }

  at(time: number): Snapshot {
    const list = this.list;
    const newest = list[list.length - 1];
    if (time >= newest.time) {
      const ahead = Math.min(time - newest.time, MAX_AHEAD_MS) / 1000;
      return {
        ...newest,
        x: newest.x + Math.sin(newest.heading) * newest.v * ahead,
        z: newest.z + Math.cos(newest.heading) * newest.v * ahead,
      };
    }
    let i = list.length - 2;
    while (i >= 0 && list[i].time > time) i--;
    if (i < 0) return list[0];
    const a = list[i];
    const b = list[i + 1];
    const k = (time - a.time) / (b.time - a.time);
    return {
      x: mix(a.x, b.x, k),
      z: mix(a.z, b.z, k),
      heading: a.heading + turn(a.heading, b.heading) * k,
      v: mix(a.v, b.v, k),
      steer: mix(a.steer, b.steer, k),
    };
  }
}
