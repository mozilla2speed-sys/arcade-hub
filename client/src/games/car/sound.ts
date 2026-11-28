/** Sounds are synthesized with WebAudio: nothing to download. */
const MUTE_KEY = 'turbo_muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  /* private mode */
}

interface Engine {
  low: OscillatorNode;
  high: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  noiseGain: GainNode;
  noiseFilter: BiquadFilterNode;
  stop(): void;
}
let engine: Engine | null = null;

/** Browsers only allow audio after a tap or a key press, so call this from one. */
export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended' && !document.hidden) void ctx.resume();
  } catch {
    ctx = null; // no audio on this device: the game stays silent
  }
}

addEventListener('pointerdown', () => ctx && unlockAudio());
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  void (document.hidden ? ctx.suspend() : ctx.resume());
});

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  if (master) master.gain.value = value ? 0 : 1;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    /* private mode */
  }
}

export function startEngine() {
  if (!ctx || !master || engine) return;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  filter.connect(gain).connect(master);

  const low = ctx.createOscillator();
  low.type = 'sawtooth';
  const high = ctx.createOscillator();
  high.type = 'square';
  const highGain = ctx.createGain();
  highGain.gain.value = 0.3;
  low.connect(filter);
  high.connect(highGain).connect(filter);

  // looped noise for tyres and grass
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;
  noise.connect(noiseFilter).connect(noiseGain).connect(master);

  low.start();
  high.start();
  noise.start();
  engine = {
    low, high, gain, filter, noiseGain, noiseFilter,
    stop() {
      low.stop();
      high.stop();
      noise.stop();
      gain.disconnect();
      noiseGain.disconnect();
    },
  };
}

export function stopEngine() {
  engine?.stop();
  engine = null;
}

/** speed 0..1 of top speed; skid and grass are 0..1 */
export function updateEngine(speed: number, throttle: boolean, skid: number, grass: number) {
  if (!engine || !ctx) return;
  const t = ctx.currentTime;
  const s = Math.min(1, Math.abs(speed));
  // four imaginary gears: the pitch climbs, drops on a shift, climbs again
  const gear = Math.min(3, Math.floor(s * 4));
  const rev = s * 4 - gear;
  const freq = 48 + gear * 9 + rev * 70;
  engine.low.frequency.setTargetAtTime(freq, t, 0.04);
  engine.high.frequency.setTargetAtTime(freq * 0.5, t, 0.04);
  engine.filter.frequency.setTargetAtTime(320 + s * 900 + (throttle ? 350 : 0), t, 0.06);
  engine.gain.gain.setTargetAtTime(0.035 + s * 0.035 + (throttle ? 0.025 : 0), t, 0.08);
  engine.noiseFilter.frequency.setTargetAtTime(grass > skid ? 220 : 1900, t, 0.03);
  engine.noiseGain.gain.setTargetAtTime(Math.max(skid * 0.07, grass * 0.22), t, 0.05);
}

function tone(freq: number, seconds: number, delay = 0, volume = 0.16, type: OscillatorType = 'square') {
  if (!ctx || !master || ctx.state !== 'running') return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + seconds);
}

export const sfx = {
  countdown: () => tone(440, 0.22),
  go: () => tone(880, 0.55),
  lap: () => {
    tone(660, 0.12);
    tone(990, 0.2, 0.12);
  },
  finish: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i === 3 ? 0.6 : 0.16, i * 0.14, 0.18, 'triangle')),
  bump: () => tone(90, 0.18, 0, 0.22, 'sawtooth'),
};
