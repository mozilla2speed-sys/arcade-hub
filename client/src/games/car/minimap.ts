import { pointAt, type Track } from '../../../../shared/src/games/car/tracks.js';

export interface MapDot {
  x: number;
  z: number;
  color: string;
  me: boolean;
}

/**
 * Top view of the track with every car on it. Seen from above with +z up,
 * world +x points left, hence both axes are negated.
 */
export function createMinimap(canvas: HTMLCanvasElement, track: Track) {
  const size = 300;
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;

  const xs = track.samples.map((p) => p.x);
  const zs = track.samples.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const scale = (size - 44) / span;
  const px = (x: number) => size / 2 - (x - cx) * scale;
  const pz = (z: number) => size / 2 - (z - cz) * scale;

  const road = new Path2D();
  track.samples.forEach((p, i) => (i ? road.lineTo(px(p.x), pz(p.z)) : road.moveTo(px(p.x), pz(p.z))));
  road.closePath();
  const start = pointAt(track, 0);
  const color = getComputedStyle(canvas).color;

  return {
    draw(dots: MapDot[]) {
      g.clearRect(0, 0, size, size);
      g.lineJoin = 'round';
      g.strokeStyle = color;
      g.globalAlpha = 0.35;
      g.lineWidth = 18;
      g.stroke(road);
      g.globalAlpha = 1;
      // start line, across the road
      g.lineWidth = 8;
      g.beginPath();
      g.moveTo(px(start.x + start.tz * 14 / (scale * 2)), pz(start.z - start.tx * 14 / (scale * 2)));
      g.lineTo(px(start.x - start.tz * 14 / (scale * 2)), pz(start.z + start.tx * 14 / (scale * 2)));
      g.stroke();
      // own car last, so it stays on top
      for (const d of [...dots].sort((a, b) => Number(a.me) - Number(b.me))) {
        g.beginPath();
        g.arc(px(d.x), pz(d.z), d.me ? 16 : 11, 0, Math.PI * 2);
        g.fillStyle = d.color;
        g.fill();
        g.lineWidth = d.me ? 6 : 3;
        g.strokeStyle = d.me ? '#ffffff' : '#000000';
        g.stroke();
        if (d.me) {
          g.lineWidth = 2;
          g.strokeStyle = '#000000';
          g.beginPath();
          g.arc(px(d.x), pz(d.z), 19, 0, Math.PI * 2);
          g.stroke();
        }
      }
    },
  };
}
