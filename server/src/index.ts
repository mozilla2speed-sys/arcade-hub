import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { RoomManager } from './rooms/RoomManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

const app = Fastify({ logger: true });
const rooms = new RoomManager();

await app.register(websocket);

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

    socket.on('message', (raw) => {
      const data = typeof raw === 'string' ? raw : raw.toString();
      rooms.handleMessage(player, data);
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
