/**
 * Open the game with ?debug=1 to see where a stutter comes from:
 * slow frames mean the device, long gaps between states mean the network or the
 * server, and corrections are the jumps of your own car.
 */
const WINDOW_MS = 10_000;

/** Largest value seen during the last few seconds. */
function recentMax() {
  let items: { at: number; value: number }[] = [];
  return {
    add(value: number, now: number) {
      items.push({ at: now, value });
    },
    get(now: number) {
      items = items.filter((i) => now - i.at <= WINDOW_MS);
      return items.reduce((m, i) => Math.max(m, i.value), 0);
    },
  };
}

export function createDebugPanel(send: (t: number) => void) {
  const box = document.createElement('pre');
  box.id = 'debugPanel';
  document.body.append(box);

  const frame = recentMax();
  const gap = recentMax();
  const fix = recentMax();
  let frames = 0;
  let fps = 0;
  let ping: number | null = null;
  let lastState = 0;
  let jumps = 0;
  let waiting = 0;
  let since = performance.now();

  const pinger = setInterval(() => send(Math.round(performance.now())), 1000);

  return {
    frame(ms: number) {
      const now = performance.now();
      frames++;
      frame.add(ms, now);
      if (now - since < 500) return;
      fps = Math.round((frames * 1000) / (now - since));
      frames = 0;
      since = now;
      box.textContent = [
        `кадров/с: ${fps}`,
        `долгий кадр: ${Math.round(frame.get(now))} мс`,
        `пинг: ${ping === null ? '—' : `${ping} мс`}`,
        `пауза пакетов: ${Math.round(gap.get(now))} мс`,
        `рывок: ${fix.get(now).toFixed(1)} м`,
        `рывков всего: ${jumps}`,
        `ввод в пути: ${waiting}`,
      ].join('\n');
    },
    /** call for every race state; the maxima cover the last 10 s */
    state(correction: number, unacked: number) {
      const now = performance.now();
      if (lastState) gap.add(now - lastState, now);
      lastState = now;
      fix.add(correction, now);
      if (correction > 0.3) jumps++;
      waiting = unacked;
    },
    pong(t: number) {
      ping = Math.round(performance.now() - t);
    },
    destroy() {
      clearInterval(pinger);
      box.remove();
    },
  };
}
