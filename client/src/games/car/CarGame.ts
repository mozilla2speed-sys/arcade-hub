import * as THREE from 'three';
import type { NetClient } from '../../net.js';
import type {
  ServerMessage,
  PlayerInfo,
  CarState,
  InputState,
  RacePhase,
  RaceResultRow,
} from '../../../../shared/src/messages.js';
import {
  R,
  createCar,
  stepCar,
  type CarBody,
} from '../../../../shared/src/games/car/physics.js';

const SKY = 0xaed4ee;

interface RemoteCar {
  obj: ReturnType<typeof buildCar>;
  tag: THREE.Sprite | null;
  name: string;
  target: { x: number; z: number; heading: number; v: number; steer: number };
  spin: number;
}

export class CarGame {
  private net: NetClient;
  private myId: string;
  private roomCode: string;

  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 600);
  private renderer: THREE.WebGLRenderer;
  private myCar: ReturnType<typeof buildCar>;
  private myHue: number;
  private remotes = new Map<string, RemoteCar>();

  private keys: InputState = { up: false, down: false, left: false, right: false, brake: false };
  private seq = 0;
  private sendAcc = 0;
  private playing = true;
  private raf = 0;
  private clock = new THREE.Clock();

  /** Local predicted body (reduces micro-lag) */
  private pred: CarBody = createCar();
  private serverSteer = 0;
  private phase: RacePhase = 'lobby';
  private totalLaps = 3;
  private lastServerTick = 0;

  private speedEl = document.getElementById('speed')!;
  private lapEl = document.getElementById('lap')!;
  private playersEl = document.getElementById('players')!;
  private overlay = document.getElementById('overlay')!;
  private overlayText = document.getElementById('overlayText')!;
  private resultsEl = document.getElementById('results')!;
  private resultsList = document.getElementById('resultsList')!;
  private mobileEl = document.getElementById('mobile')!;
  private ground: THREE.Mesh;
  private sun: THREE.DirectionalLight;

  private unsubTouch: (() => void) | null = null;

  constructor(net: NetClient, myId: string, roomCode: string, players: PlayerInfo[]) {
    this.net = net;
    this.myId = myId;
    this.roomCode = roomCode;
    this.myHue = players.find((p) => p.id === myId)?.colorHue ?? Math.random();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 50, 280);

    this.setupLights();
    this.ground = this.setupWorld();
    this.myCar = buildCar(hex(this.myHue));
    this.myCar.car.position.set(46, 0, 0);
    this.scene.add(this.myCar.car);

    for (const p of players) {
      if (p.id !== myId) this.spawnRemote(p.id, p.nick, p.colorHue);
    }

    this.bindInput();
    this.bindMobile();
    addEventListener('resize', this.onResize);
  }

  start() {
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('resize', this.onResize);
    this.unsubTouch?.();
    this.mobileEl.classList.remove('show');
    this.overlay.classList.remove('show');
    this.resultsEl.classList.remove('show');
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }

  handleServer(msg: ServerMessage) {
    if (msg.type === 'player_joined') {
      if (msg.player.id !== this.myId) {
        this.spawnRemote(msg.player.id, msg.player.nick, msg.player.colorHue);
      }
    } else if (msg.type === 'player_left') {
      const r = this.remotes.get(msg.playerId);
      if (r) {
        this.scene.remove(r.obj.car);
        this.remotes.delete(msg.playerId);
      }
    } else if (msg.type === 'state') {
      this.phase = msg.phase;
      this.totalLaps = msg.totalLaps;
      this.lastServerTick = msg.tick;
      this.updateOverlay(msg.phase, msg.countdown);

      for (const c of msg.cars) {
        if (c.id === this.myId) this.reconcile(c);
        else this.applyRemote(c);
      }
      this.updateLeaderboard(msg.cars);
    } else if (msg.type === 'race_result') {
      this.showResults(msg.results);
    }
  }

  /** Soft reconcile + keep prediction continuous */
  private reconcile(c: CarState) {
    const err = Math.hypot(c.x - this.pred.x, c.z - this.pred.z);
    // Hard snap only if far off (desync / respawn)
    if (err > 8 || this.phase === 'lobby' || this.phase === 'countdown') {
      this.pred.x = c.x;
      this.pred.z = c.z;
      this.pred.heading = c.heading;
      this.pred.v = c.v;
      this.pred.steer = c.steer;
    } else {
      // Blend toward server (smoothing micro-lag)
      const k = Math.min(0.25 + err * 0.05, 0.5);
      this.pred.x += (c.x - this.pred.x) * k;
      this.pred.z += (c.z - this.pred.z) * k;
      this.pred.heading +=
        Math.atan2(Math.sin(c.heading - this.pred.heading), Math.cos(c.heading - this.pred.heading)) * k;
      this.pred.v += (c.v - this.pred.v) * 0.35;
      this.pred.steer += (c.steer - this.pred.steer) * 0.35;
    }
    this.pred.progress = c.progress;
    this.pred.laps = c.laps;
    this.pred.best = c.best;
    this.pred.finished = c.finished;
    this.pred.finishPlace = c.finishPlace;
    this.serverSteer = c.steer;
    this.myCar.tailMat.emissiveIntensity =
      (this.keys.down && c.v > 0.5) || this.keys.brake ? 3.5 : 0.6;
  }

  private applyRemote(c: CarState) {
    let r = this.remotes.get(c.id);
    if (!r) {
      this.spawnRemote(c.id, c.nick, c.colorHue);
      r = this.remotes.get(c.id)!;
    }
    r.target = { x: c.x, z: c.z, heading: c.heading, v: c.v, steer: c.steer };
    if (c.nick !== r.name) {
      if (r.tag) r.obj.car.remove(r.tag);
      r.name = c.nick;
      r.tag = makeLabel(c.nick);
      r.obj.car.add(r.tag);
    }
  }

  private spawnRemote(id: string, nick: string, hue: number) {
    if (this.remotes.has(id)) return;
    const obj = buildCar(hex(hue));
    const tag = makeLabel(nick);
    obj.car.add(tag);
    this.scene.add(obj.car);
    this.remotes.set(id, {
      obj,
      tag,
      name: nick,
      target: { x: 46, z: 0, heading: 0, v: 0, steer: 0 },
      spin: 0,
    });
  }

  private loop = () => {
    if (!this.playing) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05) || 0.016;

    // Send input ~20 Hz
    this.sendAcc += dt;
    if (this.sendAcc >= 0.05) {
      this.sendAcc = 0;
      this.seq++;
      this.net.send({ type: 'input', keys: { ...this.keys }, seq: this.seq });
    }

    // Client-side prediction while racing / free lobby move
    const canDrive = this.phase === 'racing' || this.phase === 'lobby';
    if (canDrive && !this.pred.finished) {
      stepCar(this.pred, this.keys, dt);
    } else if (this.phase === 'countdown') {
      this.pred.v = 0;
    }

    // Apply predicted pose to mesh
    this.myCar.car.position.set(this.pred.x, 0, this.pred.z);
    this.myCar.car.rotation.y = this.pred.heading;
    this.myCar.shell.rotation.set(this.pred.pitch, 0, this.pred.roll);
    this.myCar.wheels.forEach((w) => {
      w.pivot.rotation.y = w.front ? this.pred.steer : 0;
    });

    // Remotes interpolation
    for (const r of this.remotes.values()) {
      const c = r.obj.car;
      const t = r.target;
      const k = 1 - Math.exp(-14 * dt);
      c.position.x += (t.x - c.position.x) * k;
      c.position.z += (t.z - c.position.z) * k;
      c.rotation.y +=
        Math.atan2(Math.sin(t.heading - c.rotation.y), Math.cos(t.heading - c.rotation.y)) * k;
      r.spin += (t.v / R) * dt;
      r.obj.wheels.forEach((w) => {
        w.spin.rotation.x = r.spin;
        w.pivot.rotation.y = w.front ? t.steer : 0;
      });
    }

    this.pred; // spin
    const spin = (this.pred.v / R) * dt;
    this.myCar.wheels.forEach((w) => {
      w.spin.rotation.x += spin;
    });

    this.followCamera(dt);
    this.ground.position.set(
      Math.round(this.pred.x / 4) * 4,
      0,
      Math.round(this.pred.z / 4) * 4,
    );
    this.sun.position.set(this.pred.x + 25, 40, this.pred.z + 18);
    this.sun.target.position.set(this.pred.x, 0, this.pred.z);

    this.speedEl.firstChild!.nodeValue = String(Math.round(Math.abs(this.pred.v) * 3.6));
    const lapShow = Math.min(this.pred.laps + 1, this.totalLaps);
    this.lapEl.textContent =
      this.phase === 'finished'
        ? this.pred.finishPlace
          ? `Финиш · ${this.pred.finishPlace} место`
          : 'Финиш'
        : `Круг ${lapShow}/${this.totalLaps}` +
          (this.pred.best ? ` · лучший ${this.pred.best.toFixed(1)} с` : '');

    this.renderer.render(this.scene, this.camera);
  };

  private updateOverlay(phase: RacePhase, countdown?: number) {
    if (phase === 'countdown' && countdown !== undefined && countdown > 0) {
      this.overlay.classList.add('show');
      this.overlayText.textContent = String(countdown);
      this.resultsEl.classList.remove('show');
    } else if (phase === 'countdown' && countdown === 0) {
      this.overlay.classList.add('show');
      this.overlayText.textContent = 'СТАРТ!';
    } else if (phase === 'lobby') {
      this.overlay.classList.add('show');
      this.overlayText.textContent = 'Ожидание…';
      this.resultsEl.classList.remove('show');
    } else if (phase === 'racing') {
      this.overlay.classList.remove('show');
      this.resultsEl.classList.remove('show');
    }
  }

  private showResults(rows: RaceResultRow[]) {
    this.resultsList.innerHTML = '';
    rows.forEach((r) => {
      const d = document.createElement('div');
      d.className = r.place <= 3 ? `place${r.place}` : '';
      d.textContent = `${r.place}. ${r.nick} — ${r.totalTime.toFixed(1)} с` +
        (r.best ? ` (лучший круг ${r.best.toFixed(1)})` : '');
      this.resultsList.appendChild(d);
    });
    this.resultsEl.classList.add('show');
    this.overlay.classList.remove('show');
  }

  private followCamera(dt: number) {
    const dist = 7.5 + Math.abs(this.pred.v) * 0.03;
    const target = new THREE.Vector3(
      this.pred.x - Math.sin(this.pred.heading) * dist,
      3.0,
      this.pred.z - Math.cos(this.pred.heading) * dist,
    );
    this.camera.position.lerp(target, 1 - Math.exp(-10 * dt));
    this.camera.lookAt(
      this.pred.x + Math.sin(this.pred.heading) * 4,
      1.2,
      this.pred.z + Math.cos(this.pred.heading) * 4,
    );
    const fov = 60 + Math.min(Math.abs(this.pred.v) / 55, 1) * 14;
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, 3 * dt);
    this.camera.updateProjectionMatrix();
  }

  private updateLeaderboard(cars: CarState[]) {
    const rows = [...cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishPlace - b.finishPlace;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    this.playersEl.innerHTML = '';
    const head = document.createElement('div');
    head.textContent = `Комната: ${this.roomCode}`;
    head.style.opacity = '.7';
    this.playersEl.appendChild(head);
    rows.forEach((c, i) => {
      const d = document.createElement('div');
      const me = c.id === this.myId ? ' (вы)' : '';
      const status = c.finished
        ? `финиш #${c.finishPlace}`
        : `круг ${Math.min(c.laps + 1, this.totalLaps)}/${this.totalLaps}`;
      d.textContent = `${i + 1}. ${c.nick}${me} — ${status}`;
      if (c.id === this.myId) d.style.fontWeight = '600';
      this.playersEl.appendChild(d);
    });
  }

  private bindInput() {
    const map: Record<string, keyof InputState> = {
      KeyW: 'up',
      ArrowUp: 'up',
      KeyS: 'down',
      ArrowDown: 'down',
      KeyA: 'left',
      ArrowLeft: 'left',
      KeyD: 'right',
      ArrowRight: 'right',
      Space: 'brake',
    };
    this.onKeyDown = (e: KeyboardEvent) => {
      if (map[e.code]) {
        e.preventDefault();
        this.keys[map[e.code]] = true;
      }
    };
    this.onKeyUp = (e: KeyboardEvent) => {
      if (map[e.code]) this.keys[map[e.code]] = false;
    };
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
  }

  private bindMobile() {
    const coarse = matchMedia('(pointer: coarse)').matches || innerWidth < 900;
    if (!coarse) return;
    this.mobileEl.classList.add('show');

    const zone = document.getElementById('stickZone')!;
    const knob = document.getElementById('stickKnob')!;
    const gas = document.getElementById('btnGas')!;
    const brake = document.getElementById('btnBrake')!;

    let stickId: number | null = null;

    const setStick = (clientX: number, clientY: number) => {
      const rect = zone.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const max = 40;
      const len = Math.hypot(dx, dy) || 1;
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / max;
      this.keys.left = nx < -0.25;
      this.keys.right = nx > 0.25;
    };

    const resetStick = () => {
      knob.style.transform = '';
      this.keys.left = false;
      this.keys.right = false;
      stickId = null;
    };

    const onZoneStart = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      stickId = t.identifier;
      setStick(t.clientX, t.clientY);
    };
    const onMove = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === stickId) {
          e.preventDefault();
          setStick(t.clientX, t.clientY);
        }
      }
    };
    const onEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === stickId) resetStick();
      }
    };

    zone.addEventListener('touchstart', onZoneStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);

    const hold = (el: HTMLElement, key: 'up' | 'brake') => {
      const down = (e: Event) => {
        e.preventDefault();
        if (key === 'up') {
          this.keys.up = true;
          el.classList.add('on');
        } else {
          this.keys.brake = true;
          this.keys.down = true;
          el.classList.add('on');
        }
      };
      const up = () => {
        if (key === 'up') {
          this.keys.up = false;
        } else {
          this.keys.brake = false;
          this.keys.down = false;
        }
        el.classList.remove('on');
      };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up);
      el.addEventListener('touchcancel', up);
      el.addEventListener('mousedown', down);
      el.addEventListener('mouseup', up);
      el.addEventListener('mouseleave', up);
    };
    hold(gas, 'up');
    hold(brake, 'brake');

    this.unsubTouch = () => {
      zone.removeEventListener('touchstart', onZoneStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }

  private onKeyDown = (_e: KeyboardEvent) => {};
  private onKeyUp = (_e: KeyboardEvent) => {};
  private onResize = () => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  };

  private setupLights() {
    this.scene.add(new THREE.HemisphereLight(0xbfdcff, 0x3a5a30, 0.45));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -25,
      right: 25,
      top: 25,
      bottom: -25,
      near: 1,
      far: 120,
    });
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);
  }

  private setupWorld(): THREE.Mesh {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 1, envMapIntensity: 0.3 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const flat = (geo: THREE.BufferGeometry, color: number, y: number) => {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.receiveShadow = true;
      this.scene.add(m);
    };
    flat(new THREE.RingGeometry(38, 54, 128), 0x2b2c30, 0.03);
    flat(new THREE.RingGeometry(38.2, 38.5, 128), 0xe8e8e8, 0.05);
    flat(new THREE.RingGeometry(53.5, 53.8, 128), 0xe8e8e8, 0.05);

    const N = 120;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.25, 0.35, 2, 6),
      new THREE.MeshStandardMaterial({ color: 0x5b3a22 }),
      N,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.8, 5, 7),
      new THREE.MeshStandardMaterial({ color: 0x2d5a28, roughness: 0.9 }),
      N,
    );
    const d = new THREE.Object3D();
    for (let i = 0; i < N; i++) {
      let x: number, z: number, r: number;
      do {
        x = (Math.random() - 0.5) * 480;
        z = (Math.random() - 0.5) * 480;
        r = Math.hypot(x, z);
      } while (r > 34 && r < 60);
      const s = 0.8 + Math.random() * 0.9;
      d.position.set(x, s, z);
      d.scale.setScalar(s);
      d.updateMatrix();
      trunks.setMatrixAt(i, d.matrix);
      d.position.set(x, 2 * s + 2.5 * s, z);
      d.updateMatrix();
      crowns.setMatrixAt(i, d.matrix);
    }
    trunks.castShadow = crowns.castShadow = true;
    this.scene.add(trunks, crowns);

    return ground;
  }
}

function hex(h: number) {
  return new THREE.Color().setHSL(h, 0.75, 0.42).getHex();
}

function buildCar(color: number) {
  const car = new THREE.Group();
  const shell = new THREE.Group();
  car.add(shell);

  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.28 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0d1822, metalness: 0.9, roughness: 0.08 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.8 });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff4d6,
    emissiveIntensity: 1.6,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x550000,
    emissive: 0xff1010,
    emissiveIntensity: 0.6,
  });

  function extrude(points: number[][], width: number, bevel: number, mat: THREE.Material) {
    const s = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], p[1])));
    const g = new THREE.ExtrudeGeometry(s, {
      depth: width,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 4,
    });
    g.translate(0, 0, -width / 2);
    g.rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    shell.add(m);
    return m;
  }
  extrude(
    [
      [-2.1, 0.4],
      [2.1, 0.4],
      [2.15, 0.7],
      [2.0, 0.95],
      [0.9, 1.0],
      [-1.5, 1.0],
      [-2.1, 0.95],
      [-2.15, 0.7],
    ],
    1.6,
    0.12,
    paint,
  );
  extrude(
    [
      [0.95, 1.0],
      [0.35, 1.5],
      [-0.85, 1.5],
      [-1.55, 1.0],
    ],
    1.3,
    0.06,
    glass,
  );

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    shell.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(1.46, 0.07, 1.3), paint, 0, 1.57, -0.25);
  add(new THREE.BoxGeometry(1.75, 0.12, 4.3), black, 0, 0.34, 0);
  add(new THREE.BoxGeometry(1.0, 0.14, 0.06), black, 0, 0.6, 2.2);
  [-1, 1].forEach((s) => {
    add(new THREE.BoxGeometry(0.42, 0.14, 0.08), headMat, s * 0.62, 0.8, 2.2);
    add(new THREE.BoxGeometry(0.5, 0.14, 0.08), tailMat, s * 0.6, 0.82, -2.24);
    add(new THREE.BoxGeometry(0.12, 0.1, 0.2), paint, s * 0.88, 1.12, 0.7);
  });

  const wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean }[] = [];
  const tireGeo = new THREE.CylinderGeometry(R, R, 0.3, 32).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.32, 24).rotateZ(Math.PI / 2);
  const archGeo = new THREE.CylinderGeometry(0.47, 0.47, 0.34, 24).rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc4c8ce, metalness: 0.9, roughness: 0.25 });

  [
    [-1, 1.4, true],
    [1, 1.4, true],
    [-1, -1.4, false],
    [1, -1.4, false],
  ].forEach(([sx, z, front]) => {
    const arch = new THREE.Mesh(archGeo, black);
    arch.position.set((sx as number) * 0.9, R, z as number);
    shell.add(arch);
    const pivot = new THREE.Group();
    pivot.position.set((sx as number) * 1.0, R, z as number);
    const spin = new THREE.Group();
    pivot.add(spin);
    spin.add(new THREE.Mesh(tireGeo, tireMat), new THREE.Mesh(rimGeo, rimMat));
    car.add(pivot);
    wheels.push({ pivot, spin, front: front as boolean });
  });

  car.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { car, shell, wheels, tailMat };
}

function makeLabel(text: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,.6)';
  g.strokeText(text, 128, 44);
  g.fillStyle = '#fff';
  g.fillText(text, 128, 44);
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, fog: false }),
  );
  s.scale.set(4, 1, 1);
  s.position.y = 2.6;
  s.renderOrder = 5;
  return s;
}
