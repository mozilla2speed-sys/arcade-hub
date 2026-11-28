/** The menu background: the chosen car drives itself around the chosen map. */
import * as THREE from 'three';
import { CAR_COLORS, getCar, type CarId } from '../../shared/src/games/car/cars.js';
import { getTrack, type TrackId } from '../../shared/src/games/car/tracks.js';
import { R, createCar, placeOnGrid, stepCar } from '../../shared/src/games/car/physics.js';
import { autopilot } from '../../shared/src/games/car/autopilot.js';
import { TICK_SEC } from '../../shared/src/games/car/prediction.js';
import type { Theme } from './theme.js';
import { disposeTree, getRenderer, lowPower } from './render/renderer.js';
import { buildCar, type CarModel } from './render/carModels.js';
import { buildWorld, type World } from './render/world.js';

export interface PreviewChoice {
  map: TrackId;
  car: CarId;
  color: number;
  theme: Theme;
}

export function createPreview(initial: PreviewChoice) {
  const renderer = getRenderer();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 900);
  const scene = new THREE.Scene();

  let choice = initial;
  let world: World | null = null;
  let worldKey = '';
  let model: CarModel | null = null;
  let modelKey = '';
  const body = createCar();
  const prev = { x: 0, z: 0, heading: 0 };
  let raf = 0;
  let last = 0;
  let acc = 0;
  let time = 0;

  const restart = () => {
    placeOnGrid(body, getTrack(choice.map), 0);
    Object.assign(prev, { x: body.x, z: body.z, heading: body.heading });
  };

  const set = (next: PreviewChoice) => {
    const mapChanged = next.map !== choice.map;
    choice = next;
    const wk = `${next.map}/${next.theme}`;
    if (wk !== worldKey) {
      if (world) {
        scene.remove(world.group);
        disposeTree(world.group);
      }
      world = buildWorld(getTrack(next.map), next.theme);
      scene.add(world.group);
      scene.background = world.background;
      scene.fog = world.fog;
      if (mapChanged || !worldKey) restart();
      worldKey = wk;
    }
    const mk = `${next.car}/${next.color}`;
    if (mk !== modelKey) {
      if (model) {
        scene.remove(model.car);
        disposeTree(model.car);
      }
      model = buildCar(next.car, (CAR_COLORS[next.color] ?? CAR_COLORS[0]).hex);
      scene.add(model.car);
      modelKey = mk;
    }
  };

  /** Keep the car in the part of the screen the menu panel does not cover. */
  const frame = () => {
    const w = innerWidth;
    const h = innerHeight;
    camera.aspect = w / h;
    const panel = document.getElementById('panel')!.getBoundingClientRect();
    const sideBySide = panel.width < w * 0.7;
    if (sideBySide) camera.setViewOffset(w, h, -(panel.right / 2), 0, w, h);
    // upright phone: centre the car between the header and the panel
    else camera.setViewOffset(w, h, 0, Math.max(0, h / 2 - Math.max(110, (70 + panel.top) / 2)), w, h);
  };

  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    // half the frame rate is plenty for a background on a weak phone
    if (lowPower && now - last < 30) return;
    const dt = Math.min((now - last) / 1000 || 0, 0.1);
    last = now;
    time += dt;
    acc += dt;
    const track = getTrack(choice.map);
    const spec = getCar(choice.car);
    while (acc >= TICK_SEC) {
      acc -= TICK_SEC;
      Object.assign(prev, { x: body.x, z: body.z, heading: body.heading });
      const keys = autopilot(body, track, spec);
      // a calm pace: this is scenery, not a race
      if (body.v > 17) keys.up = false;
      stepCar(body, keys, TICK_SEC, track, spec);
    }
    const a = acc / TICK_SEC;
    const x = prev.x + (body.x - prev.x) * a;
    const z = prev.z + (body.z - prev.z) * a;
    const turn = Math.atan2(Math.sin(body.heading - prev.heading), Math.cos(body.heading - prev.heading));
    const heading = prev.heading + turn * a;

    const m = model!;
    m.car.position.set(x, 0, z);
    m.car.rotation.y = heading;
    m.shell.rotation.set(body.pitch, 0, body.roll);
    for (const wheel of m.wheels) {
      wheel.pivot.rotation.y = wheel.front ? body.steer : 0;
      wheel.spin.rotation.x += (body.v / R) * dt;
    }

    // the camera swings slowly around the front quarter of the car
    const angle = heading + 0.75 + Math.sin(time * 0.17) * 0.45;
    const dist = innerWidth < innerHeight ? 17 : 10;
    camera.position.set(x + Math.sin(angle) * dist, 3.6, z + Math.cos(angle) * dist);
    camera.lookAt(x, 0.9, z);
    frame();
    camera.updateProjectionMatrix();
    world!.follow(x, z);
    renderer.render(scene, camera);
  };

  set(initial);
  restart();

  return {
    set,
    start() {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
