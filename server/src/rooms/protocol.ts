import type { ClientMessage, InputState } from '../../../shared/src/messages.js';
import { CAR_COLORS, isCarId } from '../../../shared/src/games/car/cars.js';
import { isTrackId } from '../../../shared/src/games/car/tracks.js';

/** Largest accepted WebSocket frame. A real `join` is well under 200 bytes. */
export const MAX_MESSAGE_BYTES = 1024;

/**
 * Parse and validate an untrusted client frame.
 * Returns null for anything that does not match the protocol.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data)) return null;

  switch (data.type) {
    case 'join': {
      const { nick, code, quick, game, map, car, color } = data;
      if (nick !== undefined && typeof nick !== 'string') return null;
      if (code !== undefined && typeof code !== 'string') return null;
      if (quick !== undefined && typeof quick !== 'boolean') return null;
      if (game !== 'car' && game !== 'hole') return null;
      if (map !== undefined && !isTrackId(map)) return null;
      if (car !== undefined && !isCarId(car)) return null;
      if (color !== undefined && !isColorIndex(color)) return null;
      return { type: 'join', nick: nick ?? '', code, quick, game, map, car, color };
    }
    case 'input': {
      const { keys, seq } = data;
      if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return null;
      if (!isObject(keys)) return null;
      return { type: 'input', seq, keys: sanitizeInput(keys) };
    }
    case 'ping':
      return typeof data.t === 'number' && Number.isFinite(data.t)
        ? { type: 'ping', t: data.t }
        : null;
    case 'leave':
      return { type: 'leave' };
    case 'ready':
      return { type: 'ready' };
    default:
      return null;
  }
}

function isColorIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < CAR_COLORS.length;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizeInput(k: Record<string, unknown>): InputState {
  return {
    up: k.up === true,
    down: k.down === true,
    left: k.left === true,
    right: k.right === true,
    brake: k.brake === true,
  };
}
