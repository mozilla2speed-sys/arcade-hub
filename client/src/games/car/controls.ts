import type { InputState } from '../../../../shared/src/messages.js';

const KEYS: Record<string, keyof InputState> = {
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

/** Keyboard plus on-screen buttons. */
export function bindControls() {
  const keyboard = new Set<string>();
  const touch = { left: false, right: false, up: false, brake: false };
  const abort = new AbortController();
  const { signal } = abort;

  addEventListener('keydown', (e) => {
    if (!KEYS[e.code]) return;
    e.preventDefault();
    keyboard.add(e.code);
  }, { signal });
  addEventListener('keyup', (e) => keyboard.delete(e.code), { signal });

  const steer = document.getElementById('steer')!;
  const leftBtn = document.getElementById('btnLeft')!;
  const rightBtn = document.getElementById('btnRight')!;
  const gas = document.getElementById('btnGas')!;
  const brake = document.getElementById('btnBrake')!;

  const paint = () => {
    leftBtn.classList.toggle('on', touch.left);
    rightBtn.classList.toggle('on', touch.right);
    gas.classList.toggle('on', touch.up);
    brake.classList.toggle('on', touch.brake);
  };

  // Both arrows are one pad: a thumb can slide from one to the other without lifting
  let steering: number | null = null;
  const aim = (clientX: number) => {
    const a = leftBtn.getBoundingClientRect();
    const b = rightBtn.getBoundingClientRect();
    touch.left = clientX < (a.right + b.left) / 2;
    touch.right = !touch.left;
    paint();
  };
  const endSteer = (e: PointerEvent) => {
    if (e.pointerId !== steering) return;
    steering = null;
    touch.left = touch.right = false;
    paint();
  };
  steer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    steering = e.pointerId;
    steer.setPointerCapture(e.pointerId);
    aim(e.clientX);
  }, { signal });
  steer.addEventListener('pointermove', (e) => {
    if (e.pointerId === steering) aim(e.clientX);
  }, { signal });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    steer.addEventListener(type, endSteer, { signal });
  }

  const pedal = (el: HTMLElement, key: 'up' | 'brake') => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      touch[key] = true;
      paint();
    }, { signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      el.addEventListener(type, () => {
        touch[key] = false;
        paint();
      }, { signal });
    }
  };
  pedal(gas, 'up');
  pedal(brake, 'brake');

  // long press must not open the browser's context menu
  document.getElementById('mobile')!.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

  const release = () => {
    keyboard.clear();
    steering = null;
    touch.left = touch.right = touch.up = touch.brake = false;
    paint();
  };
  // no stuck keys after switching to another window
  addEventListener('blur', release, { signal });

  return {
    read(): InputState {
      const keys: InputState = {
        up: touch.up,
        down: touch.brake,
        left: touch.left,
        right: touch.right,
        brake: touch.brake,
      };
      for (const code of keyboard) keys[KEYS[code]] = true;
      return keys;
    },
    destroy() {
      release();
      abort.abort();
    },
  };
}
