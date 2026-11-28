import * as THREE from 'three';
import type { NetClient } from '../../net.js';
import type {
  ServerMessage,
  PlayerInfo,
  CarState,
  InputState,
  RacePhase,
} from '../../../../shared/src/messages.js';
import { R, createCar, type CarBody } from '../../../../shared/src/games/car/physics.js';
import { CAR_COLORS, getCar, type CarId, type CarSpec } from '../../../../shared/src/games/car/cars.js';
import {
  getTrack,
  pointAt,
  project,
  type Projection,
  type Track,
  type TrackId,
} from '../../../../shared/src/games/car/tracks.js';
import {
  TICK_SEC,
  canDrive,
  predictStep,
  reconcile,
  type PendingInput,
} from '../../../../shared/src/games/car/prediction.js';
import type { Theme } from '../../theme.js';
import { disposeTree, getRenderer, lowPower } from '../../render/renderer.js';
import { buildCar, type CarModel } from '../../render/carModels.js';
import { buildWorld, type World } from '../../render/world.js';
import { bindControls } from './controls.js';
import { createMinimap, type MapDot } from './minimap.js';
import { RemoteMotion, ServerClock } from './remoteMotion.js';
import { createDebugPanel } from './debugPanel.js';
import { sfx, startEngine, stopEngine, updateEngine } from './sound.js';
import {
  formatTime,
  graceText,
  hideResults,
  raceOrder,
  resetHud,
  setText,
  showBanner,
  showOverlay,
  showResults,
  updateBoard,
} from './hud.js';

interface Pose {
  x: number;
  z: number;
  heading: number;
}

interface RemoteCar {
  model: CarModel;
  tag: THREE.Sprite;
  color: number;
  motion: RemoteMotion;
  waiting: boolean;
  spin: number;
  /** already placed on screen, so later positions are blended in */
  shown: boolean;
}

export class CarGame {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 900);
  private renderer = getRenderer();
  private track: Track;
  private world: World;
  private myCar: CarModel;
  private spec: CarSpec;
  private myColor: number;
  private remotes = new Map<string, RemoteCar>();

  private controls = bindControls();
  private keys: InputState = { up: false, down: false, left: false, right: false, brake: false };
  private minimap: ReturnType<typeof createMinimap>;
  private seq = 0;
  private tickAcc = 0;
  private pending: PendingInput[] = [];
  private playing = true;
  private raf = 0;
  private clock = new THREE.Clock();

  private pred: CarBody = createCar();
  /** predicted state one tick ago, to interpolate between ticks */
  private prev: Pose = { x: 0, z: 0, heading: 0 };
  /** visual-only offset that hides server corrections, decays to zero */
  private smooth: Pose = { x: 0, z: 0, heading: 0 };
  /** what is actually drawn */
  private view: Pose = { x: 0, z: 0, heading: 0 };
  private placed = false;

  // last known race state
  private phase: RacePhase = 'lobby';
  private waiting = false;
  private totalLaps: number;
  private lapTime = 0;
  private place = 1;
  private racers = 1;
  private countdownShown = 0;
  private goUntil = 0;
  private graceLeft: number | undefined;
  private lapsSeen = 0;
  private wasFinished = false;
  private wrongWayFor = 0;

  private serverClock = new ServerClock();
  private debug: ReturnType<typeof createDebugPanel> | null = null;
  private cameraTarget = new THREE.Vector3();
  private minimapWait = 0;

  private fpsFrames = 0;
  private fpsAcc = 0;
  private fpsChecked = false;

  constructor(
    private net: NetClient,
    private myId: string,
    private roomCode: string,
    mapId: TrackId,
    players: PlayerInfo[],
    theme: Theme,
    debug = false,
  ) {
    if (debug) this.debug = createDebugPanel((t) => this.net.send({ type: 'ping', t }));
    this.track = getTrack(mapId);
    this.totalLaps = this.track.laps;
    this.world = buildWorld(this.track, theme);
    this.scene.background = this.world.background;
    this.scene.fog = this.world.fog;
    this.scene.add(this.world.group);

    const me = players.find((p) => p.id === myId);
    const carId: CarId = me?.car ?? 'sedan';
    this.spec = getCar(carId);
    this.myColor = me?.color ?? 0;
    this.myCar = buildCar(carId, paintOf(this.myColor));
    this.myCar.car.visible = false;
    this.scene.add(this.myCar.car);

    for (const p of players) {
      if (p.id !== myId) this.spawnRemote(p.id, p.nick, p.car, p.color);
    }

    this.minimap = createMinimap(document.getElementById('minimap') as HTMLCanvasElement, this.track);
    resetHud();
    setText('trackName', this.track.name);
    addEventListener('resize', this.onResize);
    this.onResize();
  }

  start() {
    startEngine();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    this.controls.destroy();
    this.debug?.destroy();
    stopEngine();
    resetHud();
    disposeTree(this.scene);
  }

  handleServer(msg: ServerMessage) {
    if (msg.type === 'player_joined') {
      const p = msg.player;
      if (p.id !== this.myId) this.spawnRemote(p.id, p.nick, p.car, p.color);
    } else if (msg.type === 'player_left') {
      this.removeRemote(msg.playerId);
    } else if (msg.type === 'pong') {
      this.debug?.pong(msg.t);
    } else if (msg.type === 'state') {
      const me = msg.cars.find((c) => c.id === this.myId);
      this.updatePhase(msg.phase, msg.countdown);
      this.totalLaps = msg.totalLaps;
      this.graceLeft = msg.graceLeft;
      this.waiting = me?.waiting ?? false;
      this.serverClock.observe(msg.tick, performance.now());
      for (const c of msg.cars) {
        if (c.id === this.myId) this.applyOwn(c, msg.ack);
        else this.applyRemote(c, msg.tick);
      }
      const order = raceOrder(msg.cars);
      this.racers = Math.max(1, order.filter((c) => !c.waiting).length);
      this.place = order.findIndex((c) => c.id === this.myId) + 1;
      updateBoard(order, this.myId, this.roomCode, this.totalLaps);
      setText('nextRace', msg.nextRaceIn !== undefined ? `Следующий заезд через ${msg.nextRaceIn} с` : '');
    } else if (msg.type === 'race_result') {
      showOverlay('');
      showBanner('');
      showResults(msg.results, this.myId);
    }
  }

  private updatePhase(phase: RacePhase, countdown?: number) {
    const before = this.phase;
    this.phase = phase;
    if (phase === 'lobby' || phase === 'countdown') {
      hideResults();
      this.lapsSeen = 0;
      this.wasFinished = false;
    }
    if (phase === 'countdown' && countdown) {
      if (countdown !== this.countdownShown) sfx.countdown();
      this.countdownShown = countdown;
      showOverlay(String(countdown));
    } else if (phase === 'lobby') {
      showOverlay(this.track.name, `${lapsText(this.track.laps)} · гонка скоро начнётся`);
    } else if (phase === 'racing') {
      if (before === 'countdown') {
        this.goUntil = performance.now() + 1000;
        sfx.go();
        showOverlay('СТАРТ!');
      } else if (performance.now() > this.goUntil) {
        showOverlay('');
      }
    } else if (phase === 'finished') {
      showOverlay('');
    }
    if (phase !== 'countdown') this.countdownShown = 0;
  }

  private applyOwn(c: CarState, ack: number) {
    const before = { x: this.pred.x, z: this.pred.z, heading: this.pred.heading };
    this.pending = reconcile(this.pred, c, this.track, this.spec, this.phase, ack, this.pending);
    this.lapTime = c.lapTime;

    if (c.finished && !this.wasFinished && this.phase !== 'lobby') sfx.finish();
    else if (c.laps > this.lapsSeen && !c.finished) sfx.lap();
    this.wasFinished = c.finished;
    this.lapsSeen = c.laps;

    const dx = before.x - this.pred.x;
    const dz = before.z - this.pred.z;
    const dh = angleDiff(before.heading, this.pred.heading);
    // Move the interpolation start together with the correction
    this.prev.x -= dx;
    this.prev.z -= dz;
    this.prev.heading -= dh;

    const jump = Math.hypot(dx, dz);
    if (this.placed && this.phase === 'racing') this.debug?.state(jump > 6 ? 0 : jump, this.pending.length);
    if (!this.placed || jump > 6) {
      // first state or a new grid position: do not glide there
      this.prev = { x: this.pred.x, z: this.pred.z, heading: this.pred.heading };
      this.view = { ...this.prev };
      this.smooth = { x: 0, z: 0, heading: 0 };
      this.followCamera(1, true);
      this.placed = true;
      this.myCar.car.visible = true;
    } else {
      this.smooth.x += dx;
      this.smooth.z += dz;
      this.smooth.heading += dh;
    }
  }

  /** One fixed step: send the input and apply it locally. */
  private tick() {
    this.keys = this.controls.read();
    const input: PendingInput = { seq: this.seq++, keys: this.keys };
    this.net.send({ type: 'input', keys: input.keys, seq: input.seq });

    this.pending.push(input);
    // two seconds of history is far more than any playable latency
    if (this.pending.length > 40) this.pending.shift();

    this.prev = { x: this.pred.x, z: this.pred.z, heading: this.pred.heading };
    if (this.placed && canDrive(this.phase, this.waiting)) {
      const speed = Math.abs(this.pred.v);
      predictStep(this.pred, input.keys, this.track, this.spec);
      // a sudden loss of speed that the brakes cannot explain is a hit
      if (speed - Math.abs(this.pred.v) > this.spec.brake * TICK_SEC * 2) sfx.bump();
    }
  }

  private applyRemote(c: CarState, tick: number) {
    const r = this.remotes.get(c.id) ?? this.spawnRemote(c.id, c.nick, c.car, c.color);
    r.motion.push(tick, c);
    r.waiting = c.waiting;
  }

  private spawnRemote(id: string, nick: string, carId: CarId, color: number): RemoteCar {
    const existing = this.remotes.get(id);
    if (existing) return existing;
    const model = buildCar(carId, paintOf(color));
    const tag = makeLabel(nick);
    model.car.add(tag);
    model.car.visible = false;
    this.scene.add(model.car);
    const remote: RemoteCar = {
      model, tag, color, motion: new RemoteMotion(), waiting: false, spin: 0, shown: false,
    };
    this.remotes.set(id, remote);
    return remote;
  }

  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.model.car);
    disposeTree(r.model.car);
    this.remotes.delete(id);
  }

  private loop = () => {
    if (!this.playing) return;
    this.raf = requestAnimationFrame(this.loop);
    const elapsed = this.clock.getDelta();
    const dt = Math.min(elapsed, 0.05) || 0.016;

    // Physics runs at the server tick rate whatever the frame rate is.
    // The cap avoids a burst of inputs after the tab was hidden.
    this.tickAcc += Math.min(elapsed, 0.25);
    while (this.tickAcc >= TICK_SEC) {
      this.tickAcc -= TICK_SEC;
      this.tick();
    }

    const alpha = this.tickAcc / TICK_SEC;
    const decay = Math.exp(-12 * dt);
    this.smooth.x *= decay;
    this.smooth.z *= decay;
    this.smooth.heading *= decay;
    this.view = {
      x: this.prev.x + (this.pred.x - this.prev.x) * alpha + this.smooth.x,
      z: this.prev.z + (this.pred.z - this.prev.z) * alpha + this.smooth.z,
      heading:
        this.prev.heading +
        angleDiff(this.pred.heading, this.prev.heading) * alpha +
        this.smooth.heading,
    };

    const mine = this.myCar;
    mine.car.position.set(this.view.x, 0, this.view.z);
    mine.car.rotation.y = this.view.heading;
    mine.shell.rotation.set(this.pred.pitch, 0, this.pred.roll);
    const spin = (this.pred.v / R) * dt;
    for (const w of mine.wheels) {
      w.pivot.rotation.y = w.front ? this.pred.steer : 0;
      w.spin.rotation.x += spin;
    }
    const braking = (this.keys.down && this.pred.v > 0.5) || this.keys.brake;
    mine.tailMat.emissiveIntensity = braking ? 3.5 : 0.6;

    const dots: MapDot[] = [];
    const renderTime = this.serverClock.renderTime(performance.now());
    for (const r of this.remotes.values()) {
      // somebody waiting for the next race is not on the road
      r.model.car.visible = !r.motion.empty && !(r.waiting && this.phase !== 'lobby');
      if (r.motion.empty) continue;
      const c = r.model.car;
      const t = r.motion.at(renderTime);
      const jump = !r.shown || Math.hypot(t.x - c.position.x, t.z - c.position.z) > 8;
      // light blending only hides the small error left after a late state
      const k = jump ? 1 : 1 - Math.exp(-25 * dt);
      r.shown = true;
      c.position.x += (t.x - c.position.x) * k;
      c.position.z += (t.z - c.position.z) * k;
      c.rotation.y += angleDiff(t.heading, c.rotation.y) * k;
      r.spin += (t.v / R) * dt;
      for (const w of r.model.wheels) {
        w.spin.rotation.x = r.spin;
        w.pivot.rotation.y = w.front ? t.steer : 0;
      }
      if (c.visible) dots.push({ x: c.position.x, z: c.position.z, color: paintOf(r.color), me: false });
    }
    dots.push({ x: this.view.x, z: this.view.z, color: paintOf(this.myColor), me: true });

    this.followCamera(dt);
    this.world.follow(this.view.x, this.view.z);
    this.renderer.render(this.scene, this.camera);
    // the small map does not need every frame
    this.minimapWait -= dt;
    if (this.minimapWait <= 0) {
      this.minimapWait = 1 / 20;
      this.minimap.draw(dots);
    }
    const onRoad = project(this.track, this.view.x, this.view.z, this.pred.progress);
    this.updateHud(dt, onRoad);
    this.updateSound(braking, onRoad.dist);
    this.checkFrameRate(dt);
    this.debug?.frame(elapsed * 1000);
  };

  private updateHud(dt: number, projection: Projection) {
    setText('speed', String(Math.round(Math.abs(this.pred.v) * 3.6)));
    setText('hudPlace', this.waiting ? '—' : `${this.place || 1} / ${this.racers}`);
    setText('hudLap', this.waiting ? '—' : `${Math.min(this.pred.laps + 1, this.totalLaps)} / ${this.totalLaps}`);
    const racing = this.phase === 'racing' && !this.waiting && !this.pred.finished;
    setText('hudTime', formatTime(racing ? this.lapTime : 0));
    setText('hudBest', this.pred.best ? `лучший ${formatTime(this.pred.best)}` : '');

    if (this.phase === 'racing' && performance.now() > this.goUntil) showOverlay('');

    const road = pointAt(this.track, projection.s);
    const along = Math.sin(this.view.heading) * road.tx + Math.cos(this.view.heading) * road.tz;
    this.wrongWayFor = racing && along < -0.4 && this.pred.v > 4 ? this.wrongWayFor + dt : 0;

    if (this.phase === 'finished' || this.phase === 'lobby') showBanner('');
    else if (this.waiting) showBanner('Идёт заезд — вы стартуете в следующем');
    else if (this.pred.finished) showBanner('Финиш! Ждём остальных');
    else if (this.wrongWayFor > 0.8) showBanner('Не туда! Развернитесь');
    else showBanner(graceText(this.graceLeft));
  }

  private updateSound(braking: boolean, fromCentre: number) {
    const speed = Math.abs(this.pred.v);
    const off = fromCentre > this.track.halfWidth;
    const hard = speed > 14 && (braking || Math.abs(this.pred.steer) * speed > 11);
    updateEngine(
      speed / this.spec.vmax,
      this.keys.up && this.phase === 'racing',
      hard ? 1 : 0,
      off && speed > 4 ? Math.min(1, speed / 25) : 0,
    );
  }

  private checkFrameRate(dt: number) {
    if (this.fpsChecked) return;
    this.fpsFrames++;
    this.fpsAcc += dt;
    if (this.fpsFrames < 90) return;
    this.fpsChecked = true;
    if (this.fpsFrames / this.fpsAcc < 28 && !lowPower) {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
    }
  }

  private followCamera(dt: number, snap = false) {
    const speed = Math.abs(this.pred.v);
    const dist = 7.8 + speed * 0.03;
    const target = this.cameraTarget.set(
      this.view.x - Math.sin(this.view.heading) * dist,
      3.3,
      this.view.z - Math.cos(this.view.heading) * dist,
    );
    if (snap) this.camera.position.copy(target);
    else this.camera.position.lerp(target, 1 - Math.exp(-10 * dt));
    this.camera.lookAt(
      this.view.x + Math.sin(this.view.heading) * 4,
      1.3,
      this.view.z + Math.cos(this.view.heading) * 4,
    );
    // a tall phone screen needs a wider vertical angle to see the turns
    const base = this.camera.aspect < 1 ? 70 : 60;
    const fov = base + Math.min(speed / 55, 1) * 12;
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, 3 * dt);
    this.camera.updateProjectionMatrix();
  }

  private onResize = () => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  };
}

/** Shortest signed difference between two angles. */
function angleDiff(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function paintOf(index: number) {
  return (CAR_COLORS[index] ?? CAR_COLORS[0]).hex;
}

export function lapsText(n: number) {
  return `${n} ${n === 1 ? 'круг' : n < 5 ? 'круга' : 'кругов'}`;
}

function makeLabel(text: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '700 30px Rubik, system-ui, sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,.6)';
  g.strokeText(text, 128, 44);
  g.fillStyle = '#fff';
  g.fillText(text, 128, 44);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, fog: false }));
  s.scale.set(4, 1, 1);
  s.position.y = 3;
  s.renderOrder = 5;
  return s;
}
