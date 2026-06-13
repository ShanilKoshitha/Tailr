import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { ensureDirs, CLIENT_DIST } from './paths.js';
import { seedIfEmpty } from './db.js';
import { startCodexOauthRelay } from './services/oauthRelay.js';
import { subscribe } from './sse.js';
import boardsRoutes from './routes/boards.js';
import jobsRoutes from './routes/jobs.js';
import resumesRoutes from './routes/resumes.js';
import tailoredRoutes from './routes/tailored.js';
import aiRoutes from './routes/ai.js';

const PORT = Number(process.env.PORT ?? 7777);
// 127.0.0.1 for local installs; containers set HOST=0.0.0.0 so published
// ports can reach the server (loopback inside a container is unreachable).
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

ensureDirs();
seedIfEmpty();
startCodexOauthRelay();

const app = Fastify({ logger: { level: 'warn' } });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });

/**
 * Consistent error envelope: schema validation failures stay 400 with their
 * message; everything unexpected is logged and returned as a plain 500 so
 * internals never leak into responses.
 */
app.setErrorHandler((err: FastifyError, _req, reply) => {
  if (err.validation) {
    return reply.code(400).send({ error: `Invalid request: ${err.message}` });
  }
  const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (statusCode >= 500) app.log.error(err);
  return reply
    .code(statusCode)
    .send({ error: statusCode >= 500 ? 'Internal server error' : err.message });
});

app.get('/api/events', (_req, reply) => {
  subscribe(reply);
});

await app.register(boardsRoutes);
await app.register(jobsRoutes);
await app.register(resumesRoutes);
await app.register(tailoredRoutes);
await app.register(aiRoutes);

// serve the built client (production); in dev, Vite proxies /api here
if (fs.existsSync(CLIENT_DIST)) {
  // wildcard:true resolves files per-request (survives client rebuilds);
  // missing files fall through to the SPA handler below via callNotFound.
  await app.register(fastifyStatic, { root: CLIENT_DIST });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: PORT, host: HOST });
console.log(`\n  Tailr is running → http://localhost:${PORT}\n`);
