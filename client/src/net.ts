import type { ClientMessage, ServerMessage } from '../../shared/src/messages.js';

export interface NetClient {
  send(msg: ClientMessage): void;
  close(): void;
  onMessage: ((msg: ServerMessage) => void) | null;
  onClose: (() => void) | null;
}

export function connect(): Promise<NetClient> {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // In production the same host serves WS at /ws
    // In dev Vite proxies /ws → localhost:3000
    const url = `${proto}//${location.host}/ws`;
    const ws = new WebSocket(url);

    const client: NetClient = {
      onMessage: null,
      onClose: null,
      send(msg) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      },
      close() {
        ws.close();
      },
    };

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timeout'));
    }, 8000);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve(client);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('ws error'));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerMessage;
        client.onMessage?.(msg);
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      client.onClose?.();
    };
  });
}
