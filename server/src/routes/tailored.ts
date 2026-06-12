import type { FastifyInstance, FastifyReply } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import type { JdAnalysis, Suggestion } from '@tailr/shared';
import { db, getSetting } from '../db.js';
import { newId, now } from '../ids.js';
import { getJob, getResume, saveSuggestions } from '../db/queries.js';
import {
  getTailored,
  tailoredDir,
  readEditsLog,
  writeEditsLog,
  rebuild,
  refreshPreview,
  aiTailor,
  runScore,
  latestReport,
  fingerprint,
  effectiveModel,
  loadModel,
  isEditablePara,
  type TailoredContext,
} from '../services/tailoring.js';
import { rewriteOne } from '../services/ai/tasks.js';
import { applyOptimisticCoverage } from '../services/scoring.js';
import { convertToPdf } from '../services/convert.js';
import { broadcast } from '../sse.js';
import { tailoredEditBody, type TailoredEditBody } from './bodySchemas.js';

function parseSuggestions(ctx: TailoredContext): Suggestion[] {
  return ctx.t.suggestions ? (JSON.parse(ctx.t.suggestions) as Suggestion[]) : [];
}

function parseJdAnalysis(ctx: TailoredContext): JdAnalysis | null {
  return ctx.job.jd_analysis ? (JSON.parse(ctx.job.jd_analysis) as JdAnalysis) : null;
}

/** Undo: pop the last accepted edit, rebuild, restore the card + prior score. */
async function handleUndo(ctx: TailoredContext, reply: FastifyReply) {
  const { t } = ctx;
  const suggestions = parseSuggestions(ctx);
  const state = readEditsLog(t.id);
  const popped = state.edits.pop();
  if (!popped) return reply.code(400).send({ error: 'nothing to undo' });
  writeEditsLog(t.id, state);
  await rebuild(t.id);
  // restore the undone suggestion card to the pending list (PRD §8.6 AC2)
  if (popped.suggestion && !suggestions.some((x) => x.id === popped.suggestion?.id)) {
    saveSuggestions(t.id, [popped.suggestion, ...suggestions], now());
  }
  // roll back the optimistic score report that accept inserted
  if (popped.suggestion?.itemsCovered?.length) {
    db.prepare(
      `DELETE FROM match_reports WHERE id = (
         SELECT id FROM match_reports WHERE tailored_id = ? ORDER BY created_at DESC LIMIT 1)`,
    ).run(t.id);
    const prev = latestReport(t.id);
    db.prepare('UPDATE tailored_resumes SET match_score_after = ? WHERE id = ?').run(
      prev?.total ?? null,
      t.id,
    );
    if (prev) broadcast('score.updated', { tailoredId: t.id, total: prev.total });
  }
  return { ok: true, undone: popped, report: latestReport(t.id) };
}

/** Reject: remember the suggestion's fingerprint so it never reappears. */
function handleReject(ctx: TailoredContext, suggestionId: string | undefined, reply: FastifyReply) {
  const { t } = ctx;
  const suggestions = parseSuggestions(ctx);
  const s = suggestions.find((x) => x.id === suggestionId);
  if (!s) return reply.code(404).send({ error: 'suggestion not found' });
  const dismissed = JSON.parse(t.dismissed || '[]') as string[];
  const fp = fingerprint(s);
  if (!dismissed.includes(fp)) dismissed.push(fp);
  db.prepare(
    'UPDATE tailored_resumes SET dismissed = ?, suggestions = ?, updated_at = ? WHERE id = ?',
  ).run(
    JSON.stringify(dismissed),
    JSON.stringify(suggestions.filter((x) => x.id !== s.id)),
    now(),
    t.id,
  );
  return { ok: true };
}

/** Accept: append to the edit log, rebuild the docx, bump the score optimistically. */
async function handleAccept(ctx: TailoredContext, body: TailoredEditBody, reply: FastifyReply) {
  const { t } = ctx;
  const suggestions = parseSuggestions(ctx);
  const state = readEditsLog(t.id);

  let edit: { op: Suggestion['op']; paraId: string; newText?: string };
  let suggestion: Suggestion | undefined;
  if (body.suggestionId) {
    const s = suggestions.find((x) => x.id === body.suggestionId);
    if (!s) return reply.code(404).send({ error: 'suggestion not found' });
    suggestion = s;
    // ✎ "edit before accepting" overrides the suggested text
    const text = typeof body.editedText === 'string' ? body.editedText : s.newText;
    edit = { op: s.op, paraId: s.paraId, newText: text };
  } else if (body.manualEdit) {
    edit = body.manualEdit;
  } else {
    return reply.code(400).send({ error: 'suggestionId or manualEdit required' });
  }

  state.edits.push({
    suggestionId: suggestion?.id ?? null,
    edit,
    oldText: suggestion?.oldText,
    suggestion,
    acceptedAt: now(),
  });
  writeEditsLog(t.id, state);
  try {
    await rebuild(t.id);
  } catch (e) {
    state.edits.pop(); // roll the log back — the document was not modified
    writeEditsLog(t.id, state);
    return reply.code(500).send({ error: `Edit failed to apply: ${(e as Error).message}` });
  }

  let report = null;
  if (suggestion) {
    const current = latestReport(t.id);
    if (current && suggestion.itemsCovered?.length) {
      report = applyOptimisticCoverage(current, suggestion.itemsCovered);
      db.prepare(
        'INSERT INTO match_reports (id, tailored_id, report, created_at) VALUES (?, ?, ?, ?)',
      ).run(newId('rpt'), t.id, JSON.stringify(report), now());
      db.prepare('UPDATE tailored_resumes SET match_score_after = ? WHERE id = ?').run(
        report.total,
        t.id,
      );
      broadcast('score.updated', { tailoredId: t.id, total: report.total });
    }
    saveSuggestions(
      t.id,
      suggestions.filter((x) => x.id !== suggestion.id),
      now(),
    );
  }
  return { ok: true, report };
}

export default async function tailoredRoutes(app: FastifyInstance) {
  /** Create a tailored draft for a job from a base resume. */
  app.post<{ Params: { id: string }; Body: { resumeId: string } }>(
    '/api/jobs/:id/tailored',
    {
      schema: {
        body: {
          type: 'object',
          required: ['resumeId'],
          additionalProperties: false,
          properties: { resumeId: { type: 'string' } },
        },
      },
    },
    async (req, reply) => {
      const job = getJob(req.params.id);
      const resume = getResume(req.body.resumeId);
      if (!job || !resume) return reply.code(404).send({ error: 'job or resume not found' });

      const id = newId('tlr');
      const dir = tailoredDir(id);
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, 'tailored.docx');
      fs.copyFileSync(resume.file_path, filePath); // starts as an exact copy
      const editsPath = path.join(dir, 'edits.json');
      fs.writeFileSync(editsPath, JSON.stringify({ edits: [] }, null, 2));

      db.prepare(
        `INSERT INTO tailored_resumes (id, resume_id, job_id, file_path, edits_json_path, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      ).run(id, resume.id, job.id, filePath, editsPath, now(), now());

      void refreshPreview(id, filePath, resume.model_json_path);
      return { id };
    },
  );

  /** Full studio state. */
  app.get<{ Params: { id: string } }>('/api/tailored/:id', (req, reply) => {
    const ctx = getTailored(req.params.id);
    if (!ctx) return reply.code(404).send({ error: 'not found' });
    const { t, resume, job } = ctx;
    return {
      id: t.id,
      status: t.status,
      job: {
        id: job.id,
        title: job.title,
        company: job.company,
        jd_text: job.jd_text,
        jd_analysis: parseJdAnalysis(ctx),
      },
      resume: { id: resume.id, name: resume.name, page_count: resume.page_count },
      model: loadModel(resume.model_json_path),
      effectiveModel: effectiveModel(t.id),
      suggestions: t.suggestions ? (JSON.parse(t.suggestions) as Suggestion[]) : null,
      dismissed: JSON.parse(t.dismissed || '[]') as string[],
      edits: readEditsLog(t.id).edits,
      report: latestReport(t.id),
      scoreBefore: t.match_score_before,
      scoreAfter: t.match_score_after,
    };
  });

  /** AI Tailor pipeline with SSE progress (PRD §8.4). */
  app.post<{ Params: { id: string } }>('/api/tailored/:id/ai-tailor', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event: string, data: unknown) =>
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const suggestions = await aiTailor(req.params.id, (stage, data) =>
        send('stage', { stage, ...(data && typeof data === 'object' ? data : {}) }),
      );
      send('done', { suggestions });
    } catch (e) {
      send('error', { message: (e as Error).message });
    }
    reply.raw.end();
  });

  app.post<{ Params: { id: string } }>('/api/tailored/:id/score', async (req, reply) => {
    try {
      const report = await runScore(req.params.id, () => {});
      return { report };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  /** Accept / reject / undo edits (PRD §8.3). */
  app.post<{ Params: { id: string }; Body: TailoredEditBody }>(
    '/api/tailored/:id/edits',
    { schema: { body: tailoredEditBody } },
    async (req, reply) => {
      const ctx = getTailored(req.params.id);
      if (!ctx) return reply.code(404).send({ error: 'not found' });
      switch (req.body.action) {
        case 'undo':
          return handleUndo(ctx, reply);
        case 'reject':
          return handleReject(ctx, req.body.suggestionId, reply);
        case 'accept':
          return handleAccept(ctx, req.body, reply);
      }
    },
  );

  /** Regenerate one suggestion card (tailor.rewriteOne). */
  app.post<{ Params: { id: string; sid: string }; Body: { hint?: string } }>(
    '/api/tailored/:id/regenerate/:sid',
    async (req, reply) => {
      const ctx = getTailored(req.params.id);
      if (!ctx) return reply.code(404).send({ error: 'not found' });
      const suggestions = parseSuggestions(ctx);
      const s = suggestions.find((x) => x.id === req.params.sid);
      if (!s) return reply.code(404).send({ error: 'suggestion not found' });
      const jd = parseJdAnalysis(ctx);
      if (!jd) return reply.code(400).send({ error: 'job has no JD analysis' });
      try {
        const r = await rewriteOne({
          model: effectiveModel(ctx.t.id),
          jd,
          paraId: s.paraId,
          targetItemIds: s.itemsCovered ?? [],
          userHint: req.body?.hint,
          previousText: s.newText,
        });
        const updated: Suggestion = {
          ...s,
          newText: r.newText,
          rationale: r.rationale ?? s.rationale,
          assumptionFlag: r.assumptionFlag ?? s.assumptionFlag,
          itemsCovered: r.itemsCovered ?? s.itemsCovered,
        };
        saveSuggestions(
          ctx.t.id,
          suggestions.map((x) => (x.id === s.id ? updated : x)),
          now(),
        );
        return { suggestion: updated };
      } catch (e) {
        return reply.code(500).send({ error: (e as Error).message });
      }
    },
  );

  /** Targeted fix from the Score/Keywords tab: new suggestion card for one JD item. */
  app.post<{ Params: { id: string }; Body: { itemId: string } }>(
    '/api/tailored/:id/fix-item',
    {
      schema: {
        body: {
          type: 'object',
          required: ['itemId'],
          additionalProperties: false,
          properties: { itemId: { type: 'string' } },
        },
      },
    },
    async (req, reply) => {
      const ctx = getTailored(req.params.id);
      if (!ctx) return reply.code(404).send({ error: 'not found' });
      const report = latestReport(ctx.t.id);
      const jd = parseJdAnalysis(ctx);
      if (!report || !jd) return reply.code(400).send({ error: 'run score first' });
      const verdict = report.verdicts.items.find((i) => i.itemId === req.body.itemId);
      if (!verdict) return reply.code(404).send({ error: 'item not found' });
      const model = effectiveModel(ctx.t.id);
      // prefer the evidence paragraph when editable, else the first editable bullet
      const evidence = verdict.evidenceParaIds?.find((id) => {
        const p = model.paragraphs.find((x) => x.paraId === id);
        return p && isEditablePara(p);
      });
      const targetParaId =
        evidence ?? model.paragraphs.find((p) => p.kind === 'bullet' && isEditablePara(p))?.paraId;
      if (!targetParaId) return reply.code(400).send({ error: 'no editable bullet found' });
      try {
        const r = await rewriteOne({
          model,
          jd,
          paraId: targetParaId,
          targetItemIds: [verdict.itemId],
          userHint: verdict.suggestionHint,
        });
        const suggestions = parseSuggestions(ctx);
        const para = model.paragraphs.find((p) => p.paraId === targetParaId);
        const s: Suggestion = {
          id: `fx_${newId('s').slice(2, 8)}`,
          op: 'replace_text',
          paraId: targetParaId,
          entryId: para?.entryId ?? null,
          newText: r.newText,
          oldText: para?.text ?? '',
          itemsCovered: r.itemsCovered ?? [verdict.itemId],
          rationale: r.rationale ?? `Fix for ${verdict.itemId}`,
          assumptionFlag: r.assumptionFlag ?? false,
          lineDelta: 0,
        };
        saveSuggestions(ctx.t.id, [s, ...suggestions], now());
        return { suggestion: s };
      } catch (e) {
        return reply.code(500).send({ error: (e as Error).message });
      }
    },
  );

  app.get<{ Params: { id: string } }>('/api/tailored/:id/preview.pdf', (req, reply) => {
    const ctx = getTailored(req.params.id);
    if (!ctx) return reply.code(404).send({ error: 'not found' });
    const pdf = ctx.t.file_path.replace(/\.docx$/, '.pdf');
    if (!fs.existsSync(pdf)) {
      return reply.code(404).send({ error: 'preview not generated (is LibreOffice installed?)' });
    }
    reply.type('application/pdf');
    return fs.createReadStream(pdf);
  });

  app.get<{ Params: { id: string } }>('/api/tailored/:id/bbox', (req, reply) => {
    const ctx = getTailored(req.params.id);
    if (!ctx) return reply.code(404).send({ error: 'not found' });
    const p = path.join(path.dirname(ctx.t.file_path), 'bbox.json');
    if (!fs.existsSync(p)) return { bbox: null };
    return { bbox: JSON.parse(fs.readFileSync(p, 'utf8')) };
  });

  /** Export DOCX/PDF; marks finalized + logs an activity (PRD §8.5). */
  app.post<{ Params: { id: string }; Body: { format?: 'pdf' | 'docx' } }>(
    '/api/tailored/:id/export',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { format: { type: 'string', enum: ['pdf', 'docx'] } },
        },
      },
    },
    async (req, reply) => {
      const ctx = getTailored(req.params.id);
      if (!ctx) return reply.code(404).send({ error: 'not found' });
      const { t, job, resume } = ctx;
      const fmt = req.body?.format === 'pdf' ? 'pdf' : 'docx';

      const pattern = getSetting('export_pattern', '{Name}_Resume_{Company}');
      const clean = (s: string) =>
        s
          .replace(/[^\w\- ]+/g, '')
          .trim()
          .replace(/\s+/g, '');
      const base = pattern
        .replace('{Name}', clean(resume.name) || 'Resume')
        .replace('{FirstLast}', clean(resume.name) || 'Resume')
        .replace('{Company}', clean(job.company) || 'Company')
        .replace('{Title}', clean(job.title) || 'Role');

      let filePath = t.file_path;
      if (fmt === 'pdf') {
        const pdf = await convertToPdf(t.file_path);
        if (!pdf) {
          return reply
            .code(500)
            .send({ error: 'PDF export requires LibreOffice. DOCX export still works.' });
        }
        filePath = pdf;
      }
      db.prepare("UPDATE tailored_resumes SET status = 'finalized', updated_at = ? WHERE id = ?").run(
        now(),
        t.id,
      );
      const scoreNote =
        t.match_score_before != null
          ? `, score ${t.match_score_before}→${t.match_score_after ?? t.match_score_before}`
          : '';
      db.prepare(
        'INSERT INTO activities (id, job_id, type, title, body, due_at, done, created_at) VALUES (?, ?, ?, ?, ?, NULL, 1, ?)',
      ).run(newId('act'), job.id, 'export', `Tailored resume exported${scoreNote}`, '', now());
      broadcast('job.updated', { jobId: job.id });

      reply.header('Content-Disposition', `attachment; filename="${base}.${fmt}"`);
      reply.type(
        fmt === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      return fs.createReadStream(filePath);
    },
  );
}
