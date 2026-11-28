import { isIPv4, isIPv6 } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

/** Generous on purpose: friends on one Wi-Fi and many mobile users share an address. */
export const DEFAULT_MAX_PER_IP = 20;

/** MAX_CONNECTIONS_PER_IP: a whole number, 0 switches the limit off. */
export function maxPerIp(value: string | undefined): number {
  const n = value?.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_PER_IP;
}

/**
 * Who a connection comes from, or null when that cannot be told.
 *
 * On Render the socket belongs to Render's proxy, and the real address arrives in
 * headers set by Cloudflare in front of it. X-Forwarded-For is not used: its first
 * entry is whatever the client chose to send. Anywhere else, headers are ignored.
 */
export function clientKey(
  headers: IncomingHttpHeaders,
  remoteAddress: string | undefined,
  onRender: boolean,
): string | null {
  if (!onRender) return addressKey(remoteAddress);
  return addressKey(headers['cf-connecting-ip']) ?? addressKey(headers['true-client-ip']);
}

function addressKey(raw: string | string[] | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const address = raw.trim().toLowerCase().replace(/^::ffff:(?=\d+\.)/, '');
  if (isIPv4(address)) return address;
  if (!isIPv6(address) || address.includes('.') || address.includes('%')) return null;
  // one home or phone usually owns a whole /64, so count it as one client
  const [head, tail] = address.split('::');
  const groups = head ? head.split(':') : [];
  if (tail !== undefined) {
    const rest = tail ? tail.split(':') : [];
    groups.push(...Array(8 - groups.length - rest.length).fill('0'), ...rest);
  }
  const prefix = groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16));
  return `${prefix.join(':')}::/64`;
}

/** Counts open connections per client. */
export class ConnectionLimit {
  private open = new Map<string, number>();

  constructor(private readonly max: number) {}

  /**
   * Takes a slot and returns the function that frees it (safe to call twice),
   * or null when the client has no slot left. Unknown clients are never refused:
   * counting them together would let a few strangers lock everybody out.
   */
  acquire(key: string | null): (() => void) | null {
    if (key === null || this.max === 0) return () => {};
    const used = this.open.get(key) ?? 0;
    if (used >= this.max) return null;
    this.open.set(key, used + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = this.open.get(key)! - 1;
      if (left > 0) this.open.set(key, left);
      else this.open.delete(key);
    };
  }
}
