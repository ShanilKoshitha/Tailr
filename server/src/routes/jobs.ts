import type { FastifyInstance } from 'fastify';
import type { JdAnalysis, Job } from '@tailr/shared';
import { db } from '../db.js';
import { newId, now } from '../ids.js';
import { broadcast } from '../sse.js';
import { ensureJdAnalysis } from '../services/tailoring.js';
import { getJob, getStage, listActivities, listContacts } from '../db/queries.js';
import type { JobRow, TailoredRow } from '../db/rows.js';
import {
  activityBody,
  contactBody,
  createJobBody,
  patchJobBody,
  type ActivityBody,
  type ContactBody,
  type CreateJobBody,
  type PatchJobBody,
} from './bodySchemas.js';

function logActivity(jobId: string, type: string, title: string, body = '') {
  db.prepare(
    'INSERT INTO activities (id, job_id, type, title, body, due_at, done, created_at) VALUES (?, ?, ?, ?, ?, NULL, 0, ?)',
  ).run(newId('act'), jobId, type, title, body, now());
}

/** Job row → API shape: parse cached JD analysis, attach derived fields. */
function hydrateJob(job: JobRow): Job {
  const tailored = db
    .prepare(
      `SELECT id, match_score_before, match_score_after, status FROM tailored_resumes
       WHERE job_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(job.id) as
    | Pick<TailoredRow, 'id' | 'match_score_before' | 'match_score_after' | 'status'>
    | undefined;
  const overdue = db
    .prepare(
      'SELECT COUNT(*) AS c FROM activities WHERE job_id = ? AND done = 0 AND due_at IS NOT NULL AND due_at < ?',
    )
    .get(job.id, now()) as { c: number };
  return {
    ...job,
    jd_analysis: job.jd_analysis ? (JSON.parse(job.jd_analysis) as JdAnalysis) : null,
    latest_tailored: (tailored as Job['latest_tailored']) ?? null,
    overdue_count: overdue.c,
  };
}

export default async function jobsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { boardId?: string; archived?: string } }>('/api/jobs', (req) => {
    const archived = req.query.archived === '1' ? 1 : 0;
    const rows = (
      req.query.boardId
        ? db
            .prepare('SELECT * FROM jobs WHERE board_id = ? AND is_archived = ? ORDER BY position')
            .all(req.query.boardId, archived)
        : db.prepare('SELECT * FROM jobs WHERE is_archived = ? ORDER BY position').all(archived)
    ) as JobRow[];
    return rows.map(hydrateJob);
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'not found' });
    return {
      ...hydrateJob(job),
      activities: listActivities(job.id),
      contacts: listContacts(job.id),
      tailored: db
        .prepare(
          `SELECT t.*, r.name AS resume_name FROM tailored_resumes t
           JOIN resumes r ON r.id = t.resume_id
           WHERE t.job_id = ? ORDER BY t.created_at DESC`,
        )
        .all(job.id),
    };
  });

  app.post<{ Body: CreateJobBody }>(
    '/api/jobs',
    { schema: { body: createJobBody } },
    async (req, reply) => {
      const b = req.body;
      const stage = getStage(b.stageId);
      if (!stage) return reply.code(400).send({ error: 'unknown stageId' });
      const id = newId('job');
      const max = db
        .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM jobs WHERE stage_id = ?')
        .get(b.stageId) as { m: number };
      db.prepare(
        `INSERT INTO jobs (id, board_id, stage_id, position, title, company, location, url, salary, post_date,
         jd_text, color, stage_entered_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        stage.board_id,
        b.stageId,
        max.m + 1,
        b.title ?? '',
        b.company ?? '',
        b.location ?? '',
        b.url ?? '',
        b.salary ?? '',
        b.postDate ?? '',
        b.jdText ?? '',
        b.color ?? null,
        now(),
        now(),
        now(),
      );
      broadcast('job.updated', { jobId: id });
      // a pasted JD triggers background analysis (PRD §9.1)
      if (b.jdText?.trim()) {
        void ensureJdAnalysis(id, () => {}).catch((e: Error) =>
          broadcast('ai.error', { jobId: id, message: e.message }),
        );
      }
      return { id };
    },
  );

  app.patch<{ Params: { id: string }; Body: PatchJobBody }>(
    '/api/jobs/:id',
    { schema: { body: patchJobBody } },
    (req, reply) => {
      const job = getJob(req.params.id);
      if (!job) return reply.code(404).send({ error: 'not found' });
      const b = req.body;

      // stage / position move
      if (b.stageId !== undefined || b.position !== undefined) {
        const targetStage = b.stageId ?? job.stage_id;
        const stageRow = getStage(targetStage);
        if (!stageRow) return reply.code(400).send({ error: 'unknown stageId' });
        const siblings = (
          db
            .prepare('SELECT id FROM jobs WHERE stage_id = ? AND is_archived = 0 ORDER BY position')
            .all(targetStage) as Array<{ id: string }>
        )
          .map((r) => r.id)
          .filter((rid) => rid !== job.id);
        const pos =
          b.position !== undefined
            ? Math.max(0, Math.min(b.position, siblings.length))
            : siblings.length;
        siblings.splice(pos, 0, job.id);
        const updPos = db.prepare('UPDATE jobs SET position = ? WHERE id = ?');
        const updMove = db.prepare('UPDATE jobs SET position = ?, stage_id = ? WHERE id = ?');
        db.transaction(() => {
          siblings.forEach((rid, i) =>
            rid === job.id ? updMove.run(i, targetStage, rid) : updPos.run(i, rid),
          );
        })();
        if (b.stageId && b.stageId !== job.stage_id) {
          db.prepare('UPDATE jobs SET stage_entered_at = ?, updated_at = ? WHERE id = ?').run(
            now(),
            now(),
            job.id,
          );
          logActivity(job.id, 'stage_change', `Moved to ${stageRow.name}`);
        }
      }

      // plain field updates — explicit column map, no dynamic SQL identifiers
      const updates: Array<[column: string, value: string | number | null]> = [];
      if (b.title !== undefined) updates.push(['title', b.title]);
      if (b.company !== undefined) updates.push(['company', b.company]);
      if (b.location !== undefined) updates.push(['location', b.location]);
      if (b.url !== undefined) updates.push(['url', b.url]);
      if (b.salary !== undefined) updates.push(['salary', b.salary]);
      if (b.postDate !== undefined) updates.push(['post_date', b.postDate]);
      if (b.color !== undefined) updates.push(['color', b.color]);
      if (b.isArchived !== undefined) updates.push(['is_archived', b.isArchived]);
      if (b.jdText !== undefined) {
        updates.push(['jd_text', b.jdText]);
        updates.push(['jd_analysis', null]); // JD changed → invalidate cached analysis
      }
      if (updates.length) {
        const setClause = updates.map(([col]) => `${col} = ?`).join(', ');
        db.prepare(`UPDATE jobs SET ${setClause}, updated_at = ? WHERE id = ?`).run(
          ...updates.map(([, v]) => v),
          now(),
          job.id,
        );
      }
      broadcast('job.updated', { jobId: job.id });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/jobs/:id', (req) => {
    db.transaction(() => {
      db.prepare('DELETE FROM activities WHERE job_id = ?').run(req.params.id);
      db.prepare('DELETE FROM contacts WHERE job_id = ?').run(req.params.id);
      const tailored = db
        .prepare('SELECT id FROM tailored_resumes WHERE job_id = ?')
        .all(req.params.id) as Array<{ id: string }>;
      for (const t of tailored) {
        db.prepare('DELETE FROM match_reports WHERE tailored_id = ?').run(t.id);
      }
      db.prepare('DELETE FROM tailored_resumes WHERE job_id = ?').run(req.params.id);
      db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
    })();
    broadcast('job.updated', { jobId: req.params.id, deleted: true });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/jobs/:id/analyze', async (req, reply) => {
    try {
      db.prepare('UPDATE jobs SET jd_analysis = NULL WHERE id = ?').run(req.params.id);
      const jd = await ensureJdAnalysis(req.params.id, () => {});
      return { analysis: jd };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  // --- activities ---
  app.post<{ Params: { id: string }; Body: ActivityBody }>(
    '/api/jobs/:id/activities',
    { schema: { body: activityBody } },
    (req) => {
      const b = req.body;
      const id = newId('act');
      db.prepare(
        'INSERT INTO activities (id, job_id, type, title, body, due_at, done, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        req.params.id,
        b.type ?? 'note',
        b.title ?? '',
        b.body ?? '',
        b.dueAt ?? null,
        b.done ? 1 : 0,
        now(),
      );
      broadcast('job.updated', { jobId: req.params.id });
      return { id };
    },
  );

  app.patch<{ Params: { id: string }; Body: ActivityBody }>(
    '/api/activities/:id',
    { schema: { body: activityBody } },
    (req) => {
      const b = req.body;
      db.prepare(
        `UPDATE activities SET title = COALESCE(?, title), body = COALESCE(?, body),
         due_at = COALESCE(?, due_at), done = COALESCE(?, done) WHERE id = ?`,
      ).run(
        b.title ?? null,
        b.body ?? null,
        b.dueAt ?? null,
        b.done === undefined ? null : b.done ? 1 : 0,
        req.params.id,
      );
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/activities/:id', (req) => {
    db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // --- contacts ---
  app.post<{ Params: { id: string }; Body: ContactBody }>(
    '/api/jobs/:id/contacts',
    { schema: { body: contactBody } },
    (req) => {
      const b = req.body;
      const id = newId('cnt');
      db.prepare(
        'INSERT INTO contacts (id, job_id, name, role, email, linkedin, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        req.params.id,
        b.name ?? '',
        b.role ?? '',
        b.email ?? '',
        b.linkedin ?? '',
        b.notes ?? '',
      );
      return { id };
    },
  );

  app.patch<{ Params: { id: string }; Body: ContactBody }>(
    '/api/contacts/:id',
    { schema: { body: contactBody } },
    (req) => {
      const b = req.body;
      db.prepare(
        `UPDATE contacts SET name = COALESCE(?, name), role = COALESCE(?, role), email = COALESCE(?, email),
         linkedin = COALESCE(?, linkedin), notes = COALESCE(?, notes) WHERE id = ?`,
      ).run(
        b.name ?? null,
        b.role ?? null,
        b.email ?? null,
        b.linkedin ?? null,
        b.notes ?? null,
        req.params.id,
      );
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/contacts/:id', (req) => {
    db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
    return { ok: true };
  });
}
