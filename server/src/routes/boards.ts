import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { newId, now } from '../ids.js';
import { getStage, listStages } from '../db/queries.js';
import type { BoardRow } from '../db/rows.js';
import { stageBody, type StageBody } from './bodySchemas.js';

const MAX_STAGES_PER_BOARD = 10;

export default async function boardsRoutes(app: FastifyInstance) {
  app.get('/api/boards', () => {
    const boards = db.prepare('SELECT * FROM boards ORDER BY created_at').all() as BoardRow[];
    return boards.map((b) => ({ ...b, stages: listStages(b.id) }));
  });

  app.post<{ Body: { name?: string } }>(
    '/api/boards',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { name: { type: 'string', maxLength: 80 } },
        },
      },
    },
    (req) => {
      const id = newId('brd');
      db.prepare('INSERT INTO boards (id, name, created_at) VALUES (?, ?, ?)').run(
        id,
        req.body?.name || 'New board',
        now(),
      );
      return { id };
    },
  );

  app.post<{ Params: { boardId: string }; Body: StageBody }>(
    '/api/boards/:boardId/stages',
    { schema: { body: stageBody } },
    (req, reply) => {
      const count = (
        db.prepare('SELECT COUNT(*) AS c FROM stages WHERE board_id = ?').get(req.params.boardId) as {
          c: number;
        }
      ).c;
      if (count >= MAX_STAGES_PER_BOARD) {
        return reply.code(400).send({ error: `Max ${MAX_STAGES_PER_BOARD} stages per board` });
      }
      const id = newId('stg');
      db.prepare(
        'INSERT INTO stages (id, board_id, name, position, color, is_terminal) VALUES (?, ?, ?, ?, ?, 0)',
      ).run(id, req.params.boardId, req.body.name || 'New stage', count, req.body.color ?? '#64748b');
      return { id };
    },
  );

  app.patch<{ Params: { id: string }; Body: StageBody }>(
    '/api/stages/:id',
    { schema: { body: stageBody } },
    (req, reply) => {
      const stage = getStage(req.params.id);
      if (!stage) return reply.code(404).send({ error: 'stage not found' });
      const b = req.body;
      if (b.position !== undefined && b.position !== stage.position) {
        const ids = listStages(stage.board_id)
          .map((s) => s.id)
          .filter((id) => id !== stage.id);
        ids.splice(Math.max(0, Math.min(b.position, ids.length)), 0, stage.id);
        const upd = db.prepare('UPDATE stages SET position = ? WHERE id = ?');
        db.transaction(() => ids.forEach((id, i) => upd.run(i, id)))();
      }
      db.prepare(
        'UPDATE stages SET name = COALESCE(?, name), color = COALESCE(?, color), is_terminal = COALESCE(?, is_terminal) WHERE id = ?',
      ).run(b.name ?? null, b.color ?? null, b.is_terminal ?? null, req.params.id);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/stages/:id', (req, reply) => {
    const jobCount = (
      db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE stage_id = ?').get(req.params.id) as { c: number }
    ).c;
    if (jobCount > 0) return reply.code(400).send({ error: 'Move jobs out of this stage first' });
    db.prepare('DELETE FROM stages WHERE id = ?').run(req.params.id);
    return { ok: true };
  });
}
