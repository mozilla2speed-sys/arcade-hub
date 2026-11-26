import {
  type ServerMessage,
  type CarState,
} from '../../../../shared/src/messages.js';
import {
  type CarBody,
  createCar,
  stepCar,
  resolveCollision,
  resetCar,
} from '../../../../shared/src/games/car/physics.js';
import { BaseRoom, type PlayerSocket } from '../../rooms/BaseRoom.js';

interface CarPlayer {
  socket: PlayerSocket;
  body: CarBody;
}

export class CarRoom extends BaseRoom {
  private cars = new Map<string, CarPlayer>();

  constructor(code: string) {
    super(code, 'car');
  }

  onPlayerJoin(p: PlayerSocket): void {
    const body = createCar();
    resetCar(body);
    this.cars.set(p.id, { socket: p, body });
  }

  onPlayerLeave(p: PlayerSocket): void {
    this.cars.delete(p.id);
  }

  onTick(dt: number): void {
    const now = Date.now();
    const list = [...this.cars.values()];

    for (const cp of list) {
      stepCar(cp.body, cp.socket.lastInput, dt, now);
    }

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        resolveCollision(list[i].body, list[j].body);
        resolveCollision(list[j].body, list[i].body);
      }
    }
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
      });
    }
    return {
      type: 'state',
      tick: this.tickCount,
      cars,
    };
  }
}
