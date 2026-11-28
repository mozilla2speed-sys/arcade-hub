import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { RoomManager } from './rooms/RoomManager.js';
import { MAX_MESSAGE_BYTES } from './rooms/protocol.js';
import { RateLimiter } from './rooms/RateLimiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';
const HEARTBEAT_MS = 30_000;

const app = Fastify({ logger: true });
const rooms = new RoomManager();

await app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });

// Drop connections that stopped answering pings (e.g. a phone that lost network)
const alive = new WeakSet<object>();
const heartbeat = setInterval(() => {
  for (const client of app.websocketServer.clients) {
    if (!alive.has(client)) {
      client.terminate();
      continue;
    }
    alive.delete(client);
    client.ping();
  }
}, HEARTBEAT_MS);
app.addHook('onClose', async () => clearInterval(heartbeat));

// Health check for cron-job.org / Render keep-alive
app.get('/health', async () => {
  const stats = rooms.getStats();
  return { ok: true, uptime: process.uptime(), ...stats };
});

app.get('/api/stats', async () => rooms.getStats());

// WebSocket endpoint
app.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    const player = rooms.createPlayer(socket);
    const limiter = new RateLimiter();
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));

    socket.on('message', (raw) => {
      if (socket.readyState !== socket.OPEN) return;
      if (!limiter.allow()) {
        socket.close(1008, 'rate limit');
        return;
      }
      // An exception here would otherwise take down the whole process
      try {
        rooms.handleMessage(player, raw.toString());
      } catch (err) {
        app.log.error(err, 'failed to handle message');
        socket.close(1011, 'internal error');
      }
    });

    socket.on('close', () => {
      rooms.disconnect(player);
    });

    socket.on('error', () => {
      rooms.disconnect(player);
    });
  });
});

// Serve built client in production
if (isProd) {
  // When running via tsx from repo root: dist/client
  const clientDir = path.join(process.cwd(), 'dist', 'client');
  await app.register(fastifyStatic, {
    root: clientDir,
    prefix: '/',
  });
  // SPA fallback
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/ws') || req.url.startsWith('/api') || req.url.startsWith('/health')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile('index.html');
  });
} else {
  app.get('/', async () => ({
    message: 'Arcade Hub server (dev). Client runs on Vite :5173',
  }));
}

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Arcade Hub listening on :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
