import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { newId, now } from '../ids.js';
import { broadcast } from '../sse.js';
import { ensureJdAnalysis } from '../services/tailoring.js';

function logActivity(jobId: string, type: string, title: string, body = '', dueAt: number | null = null) {
  db.prepare('INSERT INTO activities (id, job_id, type, title, body, due_at, done, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
    .run(newId('act'), jobId, type, title, body, dueAt, now());
}

export default async function jobsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { boardId?: string; archived?: string } }>('/api/jobs', (req) => {
    const archived = req.query.archived === '1' ? 1 : 0;
    const rows = req.query.boardId
      ? db.prepare('SELECT * FROM jobs WHERE board_id = ? AND is_archived = ? ORDER BY position').all(req.query.boardId, archived)
      : db.prepare('SELECT * FROM jobs WHERE is_archived = ? ORDER BY position').all(archived);
    return (rows as any[]).map(hydrateJob);
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', (req, reply) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id) as any;
    if (!job) return reply.code(404).send({ error: 'not found' });
    return {
      ...hydrateJob(job),
      activities: db.prepare('SELECT * FROM activities WHERE job_id = ? ORDER BY created_at DESC').all(job.id),
      contacts: db.prepare('SELECT * FROM contacts WHERE job_id = ?').all(job.id),
      tailored: db.prepare(`SELECT t.*, r.name as resume_name FROM tailored_resumes t
                            JOIN resumes r ON r.id = t.resume_id
                            WHERE t.job_id = ? ORDER BY t.created_at DESC`).all(job.id),
    };
  });

  app.post<{ Body: any }>('/api/jobs', async (req) => {
    const b = (req.body ?? {}) as any;
    const id = newId('job');
    const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(b.stageId) as any;
    if (!stage) throw Object.assign(new Error('stageId required'), { statusCode: 400 });
    const max = (db.prepare('SELECT COALESCE(MAX(position), -1) m FROM jobs WHERE stage_id = ?').get(b.stageId) as any).m;
    db.prepare(`INSERT INTO jobs (id, board_id, stage_id, position, title, company, location, url, salary, post_date,
                jd_text, color, stage_entered_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, stage.board_id, b.stageId, max + 1, b.title ?? '', b.company ?? '', b.location ?? '',
        b.url ?? '', b.salary ?? '', b.postDate ?? '', b.jdText ?? '', b.color ?? null, now(), now(), now());
    broadcast('job.updated', { jobId: id });
    // background JD analysis if a JD came with the card (PRD §9.1)
    if (b.jdText?.trim()) {
      void ensureJdAnalysis(id, () => {}).catch((e) =>
        broadcast('ai.error', { jobId: id, message: (e as Error).message }));
    }
    return { id };
  });

  app.patch<{ Params: { id: string }; Body: any }>('/api/jobs/:id', (req, reply) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id) as any;
    if (!job) return reply.code(404).send({ error: 'not found' });
    const b = (req.body ?? {}) as any;

    // stage / position move
    if (b.stageId !== undefined || b.position !== undefined) {
      const targetStage = b.stageId ?? job.stage_id;
      const stageRow = db.prepare('SELECT * FROM stages WHERE id = ?').get(targetStage) as any;
      const siblings = (db.prepare('SELECT id FROM jobs WHERE stage_id = ? AND is_archived = 0 ORDER BY position').all(targetStage) as any[])
        .map((r) => r.id).filter((rid) => rid !== job.id);
      const pos = b.position !== undefined ? Math.max(0, Math.min(b.position, siblings.length)) : siblings.length;
      siblings.splice(pos, 0, job.id);
      const updPos = db.prepare('UPDATE jobs SET position = ? WHERE id = ?');
      const updMove = db.prepare('UPDATE jobs SET position = ?, stage_id = ? WHERE id = ?');
      db.transaction(() => {
        siblings.forEach((rid, i) => (rid === job.id ? updMove.run(i, targetStage, rid) : updPos.run(i, rid)));
      })();
      if (b.stageId && b.stageId !== job.stage_id) {
        db.prepare('UPDATE jobs SET stage_entered_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), job.id);
        logActivity(job.id, 'stage_change', `Moved to ${stageRow?.name ?? 'stage'}`);
      }
    }

    const fields = ['title', 'company', 'location', 'url', 'salary', 'post_date', 'jd_text', 'color', 'is_archived'] as const;
    const map: Record<string, string> = { postDate: 'post_date', jdText: 'jd_text', isArchived: 'is_archived' };
    for (const [k, v] of Object.entries(b)) {
      const col = map[k] ?? k;
      if ((fields as readonly string[]).includes(col)) {
        db.prepare(`UPDATE jobs SET ${col} = ?, updated_at = ? WHERE id = ?`).run(v as any, now(), job.id);
        if (col === 'jd_text') db.prepare('UPDATE jobs SET jd_analysis = NULL WHERE id = ?').run(job.id); // invalidate cache
      }
    }
    broadcast('job.updated', { jobId: job.id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/jobs/:id', (req) => {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM activities WHERE job_id = ?').run(req.params.id);
      db.prepare('DELETE FROM contacts WHERE job_id = ?').run(req.params.id);
      const tailored = db.prepare('SELECT id FROM tailored_resumes WHERE job_id = ?').all(req.params.id) as any[];
      for (const t of tailored) db.prepare('DELETE FROM match_reports WHERE tailored_id = ?').run(t.id);
      db.prepare('DELETE FROM tailored_resumes WHERE job_id = ?').run(req.params.id);
      db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
    });
    tx();
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

  // activities
  app.post<{ Params: { id: string }; Body: any }>('/api/jobs/:id/activities', (req) => {
    const b = (req.body ?? {}) as any;
    const id = newId('act');
    db.prepare('INSERT INTO activities (id, job_id, type, title, body, due_at, done, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.params.id, b.type ?? 'note', b.title ?? '', b.body ?? '', b.dueAt ?? null, b.done ? 1 : 0, now());
    broadcast('job.updated', { jobId: req.params.id });
    return { id };
  });
  app.patch<{ Params: { id: string }; Body: any }>('/api/activities/:id', (req) => {
    const b = (req.body ?? {}) as any;
    db.prepare('UPDATE activities SET title = COALESCE(?, title), body = COALESCE(?, body), due_at = COALESCE(?, due_at), done = COALESCE(?, done) WHERE id = ?')
      .run(b.title ?? null, b.body ?? null, b.dueAt ?? null, b.done === undefined ? null : (b.done ? 1 : 0), req.params.id);
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/activities/:id', (req) => {
    db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // contacts
  app.post<{ Params: { id: string }; Body: any }>('/api/jobs/:id/contacts', (req) => {
    const b = (req.body ?? {}) as any;
    const id = newId('cnt');
    db.prepare('INSERT INTO contacts (id, job_id, name, role, email, linkedin, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.params.id, b.name ?? '', b.role ?? '', b.email ?? '', b.linkedin ?? '', b.notes ?? '');
    return { id };
  });
  app.patch<{ Params: { id: string }; Body: any }>('/api/contacts/:id', (req) => {
    const b = (req.body ?? {}) as any;
    db.prepare('UPDATE contacts SET name = COALESCE(?, name), role = COALESCE(?, role), email = COALESCE(?, email), linkedin = COALESCE(?, linkedin), notes = COALESCE(?, notes) WHERE id = ?')
      .run(b.name ?? null, b.role ?? null, b.email ?? null, b.linkedin ?? null, b.notes ?? null, req.params.id);
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/contacts/:id', (req) => {
    db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
    return { ok: true };
  });
}

function hydrateJob(job: any) {
  const tailored = db.prepare('SELECT id, match_score_before, match_score_after, status FROM tailored_resumes WHERE job_id = ? ORDER BY created_at DESC LIMIT 1').get(job.id) as any;
  const overdue = (db.prepare('SELECT COUNT(*) c FROM activities WHERE job_id = ? AND done = 0 AND due_at IS NOT NULL AND due_at < ?').get(job.id, now()) as any).c;
  return {
    ...job,
    jd_analysis: job.jd_analysis ? JSON.parse(job.jd_analysis) : null,
    latest_tailored: tailored ?? null,
    overdue_count: overdue,
  };
}
