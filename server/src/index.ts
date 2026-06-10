import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { ensureDirs, CLIENT_DIST } from './paths.js';
import { seedIfEmpty } from './db.js';
import { subscribe } from './sse.js';
import boardsRoutes from './routes/boards.js';
import jobsRoutes from './routes/jobs.js';
import resumesRoutes from './routes/resumes.js';
import tailoredRoutes from './routes/tailored.js';
import aiRoutes from './routes/ai.js';

const PORT = Number(process.env.PORT ?? 7777);

ensureDirs();
seedIfEmpty();

const app = Fastify({ logger: { level: 'warn' } });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

app.get('/api/events', (_req, reply) => {
  subscribe(reply);
});

await app.register(boardsRoutes);
await app.register(jobsRoutes);
await app.register(resumesRoutes);
await app.register(tailoredRoutes);
await app.register(aiRoutes);

// serve built client (production); in dev, Vite proxies /api here
if (fs.existsSync(CLIENT_DIST)) {
  // wildcard:true resolves files per-request (survives client rebuilds);
  // missing files fall through to the SPA handler below via callNotFound.
  await app.register(fastifyStatic, { root: CLIENT_DIST });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return (reply as any).sendFile('index.html');
  });
}

app.listen({ port: PORT, host: '127.0.0.1' }).then(() => {
  console.log(`\n  Tailr is running → http://localhost:${PORT}\n`);
});
