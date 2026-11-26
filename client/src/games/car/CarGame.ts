import * as THREE from 'three';
import type { NetClient } from '../../net.js';
import type { ServerMessage, PlayerInfo, CarState, InputState } from '../../../../shared/src/messages.js';
import { R, WB } from '../../../../shared/src/games/car/physics.js';

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

  private local = { x: 46, z: 0, heading: 0, v: 0, progress: 0, laps: 0, best: 0 };
  private spinAngle = 0;

  private speedEl = document.getElementById('speed')!;
  private lapEl = document.getElementById('lap')!;
  private playersEl = document.getElementById('players')!;
  private ground: THREE.Mesh;
  private sun: THREE.DirectionalLight;

  constructor(net: NetClient, myId: string, roomCode: string, players: PlayerInfo[]) {
    this.net = net;
    this.myId = myId;
    this.roomCode = roomCode;
    this.myHue = players.find(p => p.id === myId)?.colorHue ?? Math.random();

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
      for (const c of msg.cars) {
        if (c.id === this.myId) {
          this.applyMyState(c);
        } else {
          this.applyRemote(c);
        }
      }
      this.updateLeaderboard(msg.cars);
    }
  }

  private applyMyState(c: CarState) {
    const k = 0.35;
    this.local.x += (c.x - this.local.x) * k;
    this.local.z += (c.z - this.local.z) * k;
    this.local.heading += Math.atan2(Math.sin(c.heading - this.local.heading), Math.cos(c.heading - this.local.heading)) * k;
    this.local.v = c.v;
    this.local.progress = c.progress;
    this.local.laps = c.laps;
    this.local.best = c.best;

    this.myCar.car.position.set(this.local.x, 0, this.local.z);
    this.myCar.car.rotation.y = this.local.heading;
    this.myCar.wheels.forEach(w => {
      w.pivot.rotation.y = w.front ? c.steer : 0;
    });
    this.myCar.tailMat.emissiveIntensity = (this.keys.down && c.v > 0.5) || this.keys.brake ? 3.5 : 0.6;
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
      obj, tag, name: nick,
      target: { x: 46, z: 0, heading: 0, v: 0, steer: 0 },
      spin: 0,
    });
  }

  private loop = () => {
    if (!this.playing) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05) || 0.016;

    this.sendAcc += dt;
    if (this.sendAcc >= 0.05) {
      this.sendAcc = 0;
      this.seq++;
      this.net.send({ type: 'input', keys: { ...this.keys }, seq: this.seq });
    }

    for (const r of this.remotes.values()) {
      const c = r.obj.car;
      const t = r.target;
      const k = 1 - Math.exp(-12 * dt);
      c.position.x += (t.x - c.position.x) * k;
      c.position.z += (t.z - c.position.z) * k;
      c.rotation.y += Math.atan2(Math.sin(t.heading - c.rotation.y), Math.cos(t.heading - c.rotation.y)) * k;
      r.spin += t.v / R * dt;
      r.obj.wheels.forEach(w => {
        w.spin.rotation.x = r.spin;
        w.pivot.rotation.y = w.front ? t.steer : 0;
      });
    }

    this.spinAngle += this.local.v / R * dt;
    this.myCar.wheels.forEach(w => { w.spin.rotation.x = this.spinAngle; });

    this.followCamera(dt);
    this.ground.position.set(Math.round(this.local.x / 4) * 4, 0, Math.round(this.local.z / 4) * 4);
    this.sun.position.set(this.local.x + 25, 40, this.local.z + 18);
    this.sun.target.position.set(this.local.x, 0, this.local.z);

    this.speedEl.firstChild!.nodeValue = String(Math.round(Math.abs(this.local.v) * 3.6));
    this.lapEl.textContent = `Круг ${this.local.laps + 1}` +
      (this.local.best ? ` · лучший ${this.local.best.toFixed(1)} с` : '');

    this.renderer.render(this.scene, this.camera);
  };

  private followCamera(dt: number) {
    const dist = 7.5 + Math.abs(this.local.v) * 0.03;
    const target = new THREE.Vector3(
      this.local.x - Math.sin(this.local.heading) * dist,
      3.0,
      this.local.z - Math.cos(this.local.heading) * dist,
    );
    this.camera.position.lerp(target, 1 - Math.exp(-10 * dt));
    this.camera.lookAt(
      this.local.x + Math.sin(this.local.heading) * 4,
      1.2,
      this.local.z + Math.cos(this.local.heading) * 4,
    );
    const fov = 60 + Math.min(Math.abs(this.local.v) / 55, 1) * 14;
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, 3 * dt);
    this.camera.updateProjectionMatrix();
  }

  private updateLeaderboard(cars: CarState[]) {
    const rows = [...cars].sort((a, b) => b.progress - a.progress);
    this.playersEl.innerHTML = '';
    const head = document.createElement('div');
    head.textContent = `Комната: ${this.roomCode}`;
    head.style.opacity = '.7';
    this.playersEl.appendChild(head);
    rows.forEach((c, i) => {
      const d = document.createElement('div');
      const me = c.id === this.myId ? ' (вы)' : '';
      d.textContent = `${i + 1}. ${c.nick}${me} — кругов ${Math.max(0, Math.floor(c.progress / (2 * Math.PI)))}` +
        (c.best ? `, лучший ${c.best.toFixed(1)} с` : '');
      if (c.id === this.myId) d.style.fontWeight = '600';
      this.playersEl.appendChild(d);
    });
  }

  private bindInput() {
    const map: Record<string, keyof InputState> = {
      KeyW: 'up', ArrowUp: 'up',
      KeyS: 'down', ArrowDown: 'down',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
      Space: 'brake',
    };
    this.onKeyDown = (e: KeyboardEvent) => {
      if (map[e.code]) { e.preventDefault(); this.keys[map[e.code]] = true; }
    };
    this.onKeyUp = (e: KeyboardEvent) => {
      if (map[e.code]) this.keys[map[e.code]] = false;
    };
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
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
    Object.assign(this.sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 120 });
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
      new THREE.MeshStandardMaterial({ color: 0x5b3a22 }), N,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.8, 5, 7),
      new THREE.MeshStandardMaterial({ color: 0x2d5a28, roughness: 0.9 }), N,
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
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 1.6 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0.6 });

  function extrude(points: number[][], width: number, bevel: number, mat: THREE.Material) {
    const s = new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1])));
    const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4 });
    g.translate(0, 0, -width / 2);
    g.rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    shell.add(m);
    return m;
  }
  extrude([[-2.1, .4], [2.1, .4], [2.15, .7], [2.0, .95], [.9, 1.0], [-1.5, 1.0], [-2.1, .95], [-2.15, .7]], 1.6, 0.12, paint);
  extrude([[.95, 1.0], [.35, 1.5], [-.85, 1.5], [-1.55, 1.0]], 1.3, 0.06, glass);

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    shell.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(1.46, 0.07, 1.3), paint, 0, 1.57, -0.25);
  add(new THREE.BoxGeometry(1.75, 0.12, 4.3), black, 0, 0.34, 0);
  add(new THREE.BoxGeometry(1.0, 0.14, 0.06), black, 0, 0.6, 2.2);
  [-1, 1].forEach(s => {
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

  [[-1, 1.4, true], [1, 1.4, true], [-1, -1.4, false], [1, -1.4, false]].forEach(([sx, z, front]) => {
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

  car.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { car, shell, wheels, tailMat };
}

function makeLabel(text: string) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,.6)';
  g.strokeText(text, 128, 44);
  g.fillStyle = '#fff';
  g.fillText(text, 128, 44);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, fog: false }));
  s.scale.set(4, 1, 1);
  s.position.y = 2.6;
  s.renderOrder = 5;
  return s;
}
