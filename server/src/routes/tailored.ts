import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting } from '../db.js';
import { newId, now } from '../ids.js';
import {
  getTailored, tailoredDir, readEditsLog, writeEditsLog, rebuild, refreshPreview,
  aiTailor, runScore, latestReport, fingerprint, effectiveModel, loadModel,
} from '../services/tailoring.js';
import { rewriteOne, type Suggestion } from '../services/ai/tasks.js';
import { applyOptimisticCoverage } from '../services/scoring.js';
import { convertToPdf } from '../services/convert.js';
import { broadcast } from '../sse.js';

export default async function tailoredRoutes(app: FastifyInstance) {
  /** Create a tailored draft for a job from a base resume. */
  app.post<{ Params: { id: string }; Body: { resumeId: string } }>('/api/jobs/:id/tailored', async (req, reply) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id) as any;
    const resume = db.prepare('SELECT * FROM resumes WHERE id = ?').get(req.body?.resumeId) as any;
    if (!job || !resume) return reply.code(404).send({ error: 'job or resume not found' });

    const id = newId('tlr');
    const dir = tailoredDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'tailored.docx');
    fs.copyFileSync(resume.file_path, filePath); // starts as an exact copy
    const editsPath = path.join(dir, 'edits.json');
    fs.writeFileSync(editsPath, JSON.stringify({ edits: [] }, null, 2));

    db.prepare(`INSERT INTO tailored_resumes (id, resume_id, job_id, file_path, edits_json_path, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`)
      .run(id, resume.id, job.id, filePath, editsPath, now(), now());

    void refreshPreview(id, filePath, resume.model_json_path);
    return { id };
  });

  /** Full studio state. */
  app.get<{ Params: { id: string } }>('/api/tailored/:id', (req, reply) => {
    const ctx = getTailored(req.params.id);
    if (!ctx) return reply.code(404).send({ error: 'not found' });
    const { t, resume, job } = ctx;
    const state = readEditsLog(t.id);
    return {
      id: t.id,
      status: t.status,
      job: { id: job.id, title: job.title, company: job.company, jd_text: job.jd_text, jd_analysis: job.jd_analysis ? JSON.parse(job.jd_analysis) : null },
      resume: { id: resume.id, name: resume.name, page_count: resume.page_count },
      model: loadModel(resume.model_json_path),
      effectiveModel: effectiveModel(t.id),
      suggestions: t.suggestions ? JSON.parse(t.suggestions) : null,
      dismissed: JSON.parse(t.dismissed || '[]'),
      edits: state.edits,
      report: latestReport(t.id),
      scoreBefore: t.match_score_before,
      scoreAfter: t.match_score_after,
    };
  });

  /** AI Tailor pipeline with SSE progress (PRD §8.4). */
  app.post<{ Params: { id: string } }>('/api/tailored/:id/ai-tailor', async (req, reply) => {
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (event: string, data: unknown) =>
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const suggestions = await aiTailor(req.params.id, (stage, data) => send('stage', { stage, ...(data as object ?? {}) }));
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

  /**
   * Accept / reject / undo edits (PRD §8.3). Accept applies the op and rebuilds
   * the docx; reject records the suggestion fingerprint as dismissed; undo pops
   * the last accepted edit and rebuilds.
   */
  app.post<{ Params: { id: string }; Body: any }>('/api/tailored/:id/edits', async (req, reply) => {
    const ctx = getTailored(req.params.id);
    if (!ctx) return reply.code(404).send({ error: 'not found' });
    const { t } = ctx;
    const b = (req.body ?? {}) as any;
    const suggestions: Suggestion[] = t.suggestions ? JSON.parse(t.suggestions) : [];
    const state = readEditsLog(t.id);

    if (b.action === 'undo') {
      const popped = state.edits.pop();
      if (!popped) return reply.code(400).send({ error: 'nothing to undo' });
      writeEditsLog(t.id, state);
      await rebuild(t.id);
      return { ok: true, undone: popped, report: recomputeOptimistic(t.id) };
    }

    if (b.action === 'reject') {
      const s = suggestions.find((x) => x.id === b.suggestionId);
      if (!s) return reply.code(404).send({ error: 'suggestion not found' });
      const dismissed: string[] = JSON.parse(t.dismissed || '[]');
      const fp = fingerprint(s);
      if (!dismissed.includes(fp)) dismissed.push(fp);
      db.prepare('UPDATE tailored_resumes SET dismissed = ?, suggestions = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(dismissed), JSON.stringify(suggestions.filter((x) => x.id !== s.id)), now(), t.id);
      return { ok: true };
    }

    if (b.action === 'accept') {
      let edit, suggestionId = null, oldText;
      if (b.suggestionId) {
        const s = suggestions.find((x) => x.id === b.suggestionId);
        if (!s) return reply.code(404).send({ error: 'suggestion not found' });
        suggestionId = s.id;
        oldText = s.oldText;
        const text = typeof b.editedText === 'string' ? b.editedText : s.newText; // ✎ manual override
        edit = { op: s.op, paraId: s.paraId, newText: text };
      } else if (b.manualEdit) {
        edit = { op: b.manualEdit.op, paraId: b.manualEdit.paraId, newText: b.manualEdit.newText };
      } else {
        return reply.code(400).send({ error: 'suggestionId or manualEdit required' });
      }
      state.edits.push({ suggestionId, edit, oldText, acceptedAt: now() });
      writeEditsLog(t.id, state);
      try {
        await rebuild(t.id);
      } catch (e) {
        state.edits.pop();
        writeEditsLog(t.id, state);
        return reply.code(500).send({ error: `Edit failed to apply: ${(e as Error).message}` });
      }
      // optimistic score: flip itemsCovered of the accepted suggestion
      let report = null;
      if (suggestionId) {
        const s = suggestions.find((x) => x.id === suggestionId)!;
        const current = latestReport(t.id);
        if (current && s.itemsCovered?.length) {
          report = applyOptimisticCoverage(current, s.itemsCovered);
          db.prepare('INSERT INTO match_reports (id, tailored_id, report, created_at) VALUES (?, ?, ?, ?)')
            .run(newId('rpt'), t.id, JSON.stringify(report), now());
          db.prepare('UPDATE tailored_resumes SET match_score_after = ? WHERE id = ?').run(report.total, t.id);
          broadcast('score.updated', { tailoredId: t.id, total: report.total });
        }
        // remove accepted suggestion from the pending list
        db.prepare('UPDATE tailored_resumes SET suggestions = ? WHERE id = ?')
          .run(JSON.stringify(suggestions.filter((x) => x.id !== suggestionId)), t.id);
      }
      return { ok: true, report };
    }

    return reply.code(400).send({ error: 'action must be accept|reject|undo' });
  });

  /** Regenerate one suggestion card (tailor.rewriteOne). */
  app.post<{ Params: { id: string; sid: string }; Body: { hint?: string } }>(
    '/api/tailored/:id/regenerate/:sid', async (req, reply) => {
      const ctx = getTailored(req.params.id);
      if (!ctx) return reply.code(404).send({ error: 'not found' });
      const suggestions: Suggestion[] = ctx.t.suggestions ? JSON.parse(ctx.t.suggestions) : [];
      const s = suggestions.find((x) => x.id === req.params.sid);
      if (!s) return reply.code(404).send({ error: 'suggestion not found' });
      const jd = ctx.job.jd_analysis ? JSON.parse(ctx.job.jd_analysis as any) : null;
      if (!jd) return reply.code(400).send({ error: 'job has no JD analysis' });
      try {
        const r = await rewriteOne({
          model: effectiveModel(ctx.t.id), jd, paraId: s.paraId,
          targetItemIds: s.itemsCovered ?? [], userHint: req.body?.hint, previousText: s.newText,
        });
        const updated = { ...s, newText: r.newText, rationale: r.rationale ?? s.rationale, assumptionFlag: r.assumptionFlag ?? s.assumptionFlag, itemsCovered: r.itemsCovered ?? s.itemsCovered };
        db.prepare('UPDATE tailored_resumes SET suggestions = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(suggestions.map((x) => (x.id === s.id ? updated : x))), now(), ctx.t.id);
        return { suggestion: updated };
      } catch (e) {
        return reply.code(500).send({ error: (e as Error).message });
      }
    });

  /** Targeted fix from Score/Keywords tab: create a new suggestion card for an item. */
  app.post<{ Params: { id: string }; Body: { itemId: string } }>('/api/tailored/:id/fix-item', async (req, reply) => {
    const ctx = getTailored(req.params.id);
    if (!ctx) return reply.code(404).send({ error: 'not found' });
    const report = latestReport(ctx.t.id);
    const jd = ctx.job.jd_analysis ? JSON.parse(ctx.job.jd_analysis as any) : null;
    if (!report || !jd) return reply.code(400).send({ error: 'run score first' });
    const verdict = report.verdicts.items.find((i) => i.itemId === req.body?.itemId);
    if (!verdict) return reply.code(404).send({ error: 'item not found' });
    const model = effectiveModel(ctx.t.id);
    // pick target bullet: evidence para if partial, else the most relevant-looking bullet
    const targetParaId = verdict.evidenceParaIds?.[0]
      ?? model.paragraphs.find((p) => p.kind === 'bullet')?.paraId;
    if (!targetParaId) return reply.code(400).send({ error: 'no editable bullet found' });
    try {
      const r = await rewriteOne({ model, jd, paraId: targetParaId, targetItemIds: [verdict.itemId], userHint: verdict.suggestionHint });
      const suggestions: Suggestion[] = ctx.t.suggestions ? JSON.parse(ctx.t.suggestions) : [];
      const para = model.paragraphs.find((p) => p.paraId === targetParaId);
      const s: Suggestion = {
        id: `fx_${newId('s').slice(2, 8)}`, op: 'replace_text', paraId: targetParaId,
        entryId: para?.entryId ?? null, newText: r.newText, oldText: para?.text ?? '',
        itemsCovered: r.itemsCovered ?? [verdict.itemId], rationale: r.rationale ?? `Fix for ${verdict.itemId}`,
        assumptionFlag: r.assumptionFlag ?? false, lineDelta: 0,
      };
      db.prepare('UPDATE tailored_resumes SET suggestions = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify([s, ...suggestions]), now(), ctx.t.id);
      return { suggestion: s };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>('/api/tailored/:id/preview.pdf', (req, reply) => {
    const ctx = getTailored(req.params.id);
    if (!ctx) return reply.code(404).send({ error: 'not found' });
    const pdf = ctx.t.file_path.replace(/\.docx$/, '.pdf');
    if (!fs.existsSync(pdf)) return reply.code(404).send({ error: 'preview not generated (is LibreOffice installed?)' });
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

  /** Export DOCX/PDF; marks finalized + logs activity (PRD §8.5). */
  app.post<{ Params: { id: string }; Body: { format: 'pdf' | 'docx' } }>('/api/tailored/:id/export', async (req, reply) => {
    const ctx = getTailored(req.params.id);
    if (!ctx) return reply.code(404).send({ error: 'not found' });
    const { t, job, resume } = ctx;
    const fmt = req.body?.format === 'pdf' ? 'pdf' : 'docx';

    const pattern = getSetting('export_pattern', '{Name}_Resume_{Company}');
    const clean = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '');
    const base = pattern
      .replace('{Name}', clean(resume.name) || 'Resume')
      .replace('{FirstLast}', clean(resume.name) || 'Resume')
      .replace('{Company}', clean(job.company) || 'Company')
      .replace('{Title}', clean(job.title) || 'Role');

    let filePath = t.file_path;
    if (fmt === 'pdf') {
      const pdf = await convertToPdf(t.file_path);
      if (!pdf) return reply.code(500).send({ error: 'PDF export requires LibreOffice. DOCX export still works.' });
      filePath = pdf;
    }
    db.prepare("UPDATE tailored_resumes SET status = 'finalized', updated_at = ? WHERE id = ?").run(now(), t.id);
    db.prepare('INSERT INTO activities (id, job_id, type, title, body, due_at, done, created_at) VALUES (?, ?, ?, ?, ?, NULL, 1, ?)')
      .run(newId('act'), job.id, 'export',
        `Tailored resume exported${t.match_score_before != null ? `, score ${t.match_score_before}→${t.match_score_after ?? t.match_score_before}` : ''}`,
        '', now());
    broadcast('job.updated', { jobId: job.id });

    reply.header('Content-Disposition', `attachment; filename="${base}.${fmt}"`);
    reply.type(fmt === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    return fs.createReadStream(filePath);
  });
}

function recomputeOptimistic(tailoredId: string) {
  return latestReport(tailoredId);
}
