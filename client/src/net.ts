import type { ClientMessage, ServerMessage } from '../../shared/src/messages.js';

export interface NetClient {
  send(msg: ClientMessage): void;
  /** Close on purpose: no handler is called afterwards. */
  close(): void;
}

export interface NetHandlers {
  onMessage(msg: ServerMessage): void;
  /** The connection was lost: not called after close() */
  onClose(): void;
}

// Handlers are arguments on purpose. When they were fields that started as null
// and were assigned later, the production build removed the onClose call.
export function connect(handlers: NetHandlers): Promise<NetClient> {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // In production the same host serves WS at /ws
    // In dev Vite proxies /ws → localhost:3000
    const url = `${proto}//${location.host}/ws`;
    const ws = new WebSocket(url);
    let closedByUs = false;

    const client: NetClient = {
      send(msg) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      },
      close() {
        closedByUs = true;
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
      if (closedByUs) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }
      handlers.onMessage(msg);
    };
    ws.onclose = () => {
      if (!closedByUs) handlers.onClose();
    };
  });
}
