import type { FastifyReply } from 'fastify';

/** Tiny SSE bus: clients subscribe at GET /api/events; services broadcast() */
const clients = new Set<FastifyReply>();

export function subscribe(reply: FastifyReply) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  reply.raw.write(': connected\n\n');
  clients.add(reply);
  const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
  reply.raw.on('close', () => {
    clearInterval(ping);
    clients.delete(reply);
  });
}

export function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try {
      c.raw.write(payload);
    } catch {
      clients.delete(c);
    }
  }
}
