import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { newId, now } from '../ids.js';

export default async function boardsRoutes(app: FastifyInstance) {
  app.get('/api/boards', () => {
    const boards = db.prepare('SELECT * FROM boards ORDER BY created_at').all() as any[];
    return boards.map((b) => ({
      ...b,
      stages: db.prepare('SELECT * FROM stages WHERE board_id = ? ORDER BY position').all(b.id),
    }));
  });

  app.post<{ Body: { name: string } }>('/api/boards', (req) => {
    const id = newId('brd');
    db.prepare('INSERT INTO boards (id, name, created_at) VALUES (?, ?, ?)').run(id, req.body.name || 'New board', now());
    return { id };
  });

  app.post<{ Params: { boardId: string }; Body: { name: string; color?: string } }>(
    '/api/boards/:boardId/stages', (req, reply) => {
      const count = (db.prepare('SELECT COUNT(*) c FROM stages WHERE board_id = ?').get(req.params.boardId) as any).c;
      if (count >= 10) return reply.code(400).send({ error: 'Max 10 stages per board' });
      const id = newId('stg');
      db.prepare('INSERT INTO stages (id, board_id, name, position, color, is_terminal) VALUES (?, ?, ?, ?, ?, 0)')
        .run(id, req.params.boardId, req.body.name || 'New stage', count, req.body.color ?? '#64748b');
      return { id };
    });

  app.patch<{ Params: { id: string }; Body: { name?: string; color?: string; position?: number; is_terminal?: number } }>(
    '/api/stages/:id', (req, reply) => {
      const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(req.params.id) as any;
      if (!stage) return reply.code(404).send({ error: 'stage not found' });
      const b = req.body;
      if (b.position !== undefined && b.position !== stage.position) {
        // reorder within board
        const stages = db.prepare('SELECT id FROM stages WHERE board_id = ? ORDER BY position').all(stage.board_id) as any[];
        const ids = stages.map((s) => s.id).filter((id) => id !== stage.id);
        ids.splice(Math.max(0, Math.min(b.position, ids.length)), 0, stage.id);
        const upd = db.prepare('UPDATE stages SET position = ? WHERE id = ?');
        ids.forEach((id, i) => upd.run(i, id));
      }
      db.prepare('UPDATE stages SET name = COALESCE(?, name), color = COALESCE(?, color), is_terminal = COALESCE(?, is_terminal) WHERE id = ?')
        .run(b.name ?? null, b.color ?? null, b.is_terminal ?? null, req.params.id);
      return { ok: true };
    });

  app.delete<{ Params: { id: string } }>('/api/stages/:id', (req, reply) => {
    const jobCount = (db.prepare('SELECT COUNT(*) c FROM jobs WHERE stage_id = ?').get(req.params.id) as any).c;
    if (jobCount > 0) return reply.code(400).send({ error: 'Move jobs out of this stage first' });
    db.prepare('DELETE FROM stages WHERE id = ?').run(req.params.id);
    return { ok: true };
  });
}
