/**
 * Tailoring orchestration: the AI Tailor pipeline (PRD §8.4), edit accept/undo
 * state machine, preview regeneration, and suggestion fingerprint memory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db, getSetting } from '../db.js';
import { newId, now } from '../ids.js';
import { TAILORED_DIR } from '../paths.js';
import { applyEdits } from '../docx/edits.js';
import type { Edit, ResumeModel } from '../docx/types.js';
import { convertToPdf, buildBboxMap, pdfPageCount } from './convert.js';
import { jdAnalyze, matchScore, bulletRelevance, tailorSuggest, type JdAnalysis, type MatchVerdicts, type Suggestion } from './ai/tasks.js';
import { computeScore, type MatchReport } from './scoring.js';
import { broadcast } from '../sse.js';
import type { ModelParagraph } from '../docx/types.js';

/**
 * The only paragraphs AI edits may target: bullets, and body text in
 * summary/skills-type sections. Hyperlink-bearing paragraphs (contact line
 * with LinkedIn/GitHub) are read-only — replace_text would strip the
 * <w:hyperlink> wrapper (PRD Appendix A.4).
 */
export function isEditablePara(p: ModelParagraph): boolean {
  if (p.hasHyperlink) return false;
  return p.kind === 'bullet' ||
    (p.kind === 'body' && ['header', 'summary', 'skills', 'strengths'].includes(p.section));
}

export interface EditLogEntry {
  suggestionId: string | null;   // null = manual edit
  edit: Edit;
  oldText?: string;
  acceptedAt: number;
  formattingFlattened?: boolean;
  suggestion?: Suggestion;       // full card snapshot — restored to pending on undo
}

export interface TailoredState {
  edits: EditLogEntry[];         // accepted, in accept order (undo pops the last)
}

export function fingerprint(s: Suggestion): string {
  return createHash('md5').update(`${s.op}|${s.paraId}|${(s.itemsCovered ?? []).slice().sort().join(',')}`).digest('hex');
}

export function tailoredDir(id: string) {
  return path.join(TAILORED_DIR, id);
}

export function readEditsLog(id: string): TailoredState {
  const p = path.join(tailoredDir(id), 'edits.json');
  if (!fs.existsSync(p)) return { edits: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeEditsLog(id: string, state: TailoredState) {
  fs.writeFileSync(path.join(tailoredDir(id), 'edits.json'), JSON.stringify(state, null, 2));
}

export function loadModel(modelPath: string): ResumeModel {
  return JSON.parse(fs.readFileSync(modelPath, 'utf8'));
}

interface TailoredRow {
  id: string; resume_id: string; job_id: string; file_path: string;
  edits_json_path: string; match_score_before: number | null;
  match_score_after: number | null; status: string; suggestions: string | null;
  dismissed: string; created_at: number; updated_at: number;
}
interface ResumeRow { id: string; name: string; file_path: string; model_json_path: string; page_count: number | null }
interface JobRow { id: string; title: string; company: string; jd_text: string; jd_analysis: string | null }

export function getTailored(id: string) {
  const t = db.prepare('SELECT * FROM tailored_resumes WHERE id = ?').get(id) as TailoredRow | undefined;
  if (!t) return null;
  const resume = db.prepare('SELECT * FROM resumes WHERE id = ?').get(t.resume_id) as ResumeRow;
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(t.job_id) as JobRow;
  return { t, resume, job };
}

/** Rebuild tailored.docx from original + full accepted edit log, refresh preview. */
export async function rebuild(id: string): Promise<void> {
  const ctx = getTailored(id);
  if (!ctx) throw new Error('tailored not found');
  const { t, resume } = ctx;
  const model = loadModel(resume.model_json_path);
  const state = readEditsLog(id);
  const original = fs.readFileSync(resume.file_path);
  const { buffer } = await applyEdits(original, model, state.edits.map((e) => e.edit));
  fs.writeFileSync(t.file_path, buffer);
  db.prepare('UPDATE tailored_resumes SET updated_at = ? WHERE id = ?').run(now(), id);
  // refresh preview asynchronously; UI gets an SSE when ready
  void refreshPreview(id, t.file_path, resume.model_json_path);
}

export async function refreshPreview(id: string, docxPath: string, modelPath: string): Promise<string | null> {
  const pdf = await convertToPdf(docxPath);
  if (pdf) {
    const model = loadModel(modelPath);
    const bbox = await buildBboxMap(pdf, model).catch(() => null);
    fs.writeFileSync(path.join(path.dirname(docxPath), 'bbox.json'), JSON.stringify(bbox));
    broadcast('preview.updated', { tailoredId: id });
  }
  return pdf;
}

export async function ensureJdAnalysis(jobId: string, emit: (stage: string, data?: unknown) => void): Promise<JdAnalysis> {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow;
  if (!job) throw new Error('job not found');
  if (job.jd_analysis) return JSON.parse(job.jd_analysis);
  if (!job.jd_text?.trim()) throw new Error('This job has no job description text. Paste the JD into the job first.');
  emit('analyzing_jd');
  const jd = await jdAnalyze(job.jd_text, job.title, job.company);
  db.prepare('UPDATE jobs SET jd_analysis = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(jd), now(), jobId);
  broadcast('job.updated', { jobId });
  return jd;
}

export async function runScore(tailoredId: string, emit: (s: string, d?: unknown) => void): Promise<MatchReport> {
  const ctx = getTailored(tailoredId);
  if (!ctx) throw new Error('tailored not found');
  const jd = await ensureJdAnalysis(ctx.job.id, emit);
  emit('scoring');
  // score the CURRENT tailored text: original model with accepted edits applied in-memory
  const model = effectiveModel(tailoredId);
  const verdicts = await matchScore(model, jd);
  const report = computeScore(jd, verdicts);
  db.prepare('INSERT INTO match_reports (id, tailored_id, report, created_at) VALUES (?, ?, ?, ?)')
    .run(newId('rpt'), tailoredId, JSON.stringify(report), now());
  const t = ctx.t;
  if (t.match_score_before == null) {
    db.prepare('UPDATE tailored_resumes SET match_score_before = ?, match_score_after = ? WHERE id = ?')
      .run(report.total, report.total, tailoredId);
  } else {
    db.prepare('UPDATE tailored_resumes SET match_score_after = ? WHERE id = ?').run(report.total, tailoredId);
  }
  broadcast('score.updated', { tailoredId, total: report.total });
  return report;
}

export function latestReport(tailoredId: string): MatchReport | null {
  const row = db.prepare('SELECT report FROM match_reports WHERE tailored_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(tailoredId) as { report: string } | undefined;
  return row ? JSON.parse(row.report) : null;
}

/** Model with accepted edits applied to paragraph texts (for prompt context + re-scoring). */
export function effectiveModel(tailoredId: string): ResumeModel {
  const ctx = getTailored(tailoredId)!;
  const model: ResumeModel = loadModel(ctx.resume.model_json_path);
  const state = readEditsLog(tailoredId);
  const byId = new Map(model.paragraphs.map((p) => [p.paraId, p]));
  const deleted = new Set<string>();
  const inserts: Array<{ afterId: string; text: string }> = [];
  for (const e of state.edits) {
    const { edit } = e;
    if (edit.op === 'replace_text' || edit.op === 'replace_skills_line') {
      const p = byId.get(edit.paraId);
      if (p) p.text = edit.newText ?? '';
    } else if (edit.op === 'delete_paragraph') {
      deleted.add(edit.paraId);
    } else if (edit.op === 'insert_paragraph_after') {
      inserts.push({ afterId: edit.paraId, text: edit.newText ?? '' });
    }
  }
  model.paragraphs = model.paragraphs.filter((p) => !deleted.has(p.paraId));
  for (const ins of inserts) {
    const i = model.paragraphs.findIndex((p) => p.paraId === ins.afterId);
    if (i >= 0) {
      const anchor = model.paragraphs[i];
      model.paragraphs.splice(i + 1, 0, {
        ...anchor,
        paraId: `virt_${createHash('md5').update(ins.text.slice(0, 24)).digest('hex').slice(0, 6)}`,
        text: ins.text,
      });
    }
  }
  return model;
}

/** Full AI Tailor pipeline (PRD §8.4): relevance trim → suggestions, with guards. */
export async function aiTailor(tailoredId: string, emit: (stage: string, data?: unknown) => void): Promise<Suggestion[]> {
  const ctx = getTailored(tailoredId);
  if (!ctx) throw new Error('tailored not found');
  const jd = await ensureJdAnalysis(ctx.job.id, emit);
  let report = latestReport(tailoredId);
  if (!report) report = await runScore(tailoredId, emit);

  const model = effectiveModel(tailoredId);
  const pageCount = ctx.resume.page_count ?? 2;

  // step 2: relevance-driven deletions with guards
  emit('relevance');
  const deletions: Suggestion[] = [];
  const aggressive = getSetting('aggressive_trimming', '0') === '1';
  try {
    const rel = await bulletRelevance(model, jd);
    const relMap = new Map(rel.bullets.map((b) => [b.paraId, b]));
    const mostRecentEntry = model.entries[0]?.entryId;
    let dIdx = 0;
    for (const entry of model.entries) {
      const liveBullets = entry.bulletIds.filter((id) => model.paragraphs.some((p) => p.paraId === id));
      if (liveBullets.length <= 3) continue; // never go below 2; only trim entries with >3
      for (const bid of liveBullets) {
        const r = relMap.get(bid);
        if (!r || r.relevance >= 30) continue;
        if (entry.entryId === mostRecentEntry && r.relevance >= 15) continue; // most-recent-role guard
        if (!aggressive && pageCount <= 1) continue;
        const para = model.paragraphs.find((p) => p.paraId === bid);
        deletions.push({
          id: `d${++dIdx}`, op: 'delete_paragraph', paraId: bid, entryId: entry.entryId,
          newText: '', oldText: para?.text ?? '',
          itemsCovered: [], rationale: r.reason ?? `Low relevance (${r.relevance}/100) to this JD`, lineDelta: -1,
        });
        if (deletions.filter((d) => d.entryId === entry.entryId).length >= 3) break;
      }
    }
  } catch (e) {
    emit('relevance_failed', { message: (e as Error).message }); // non-fatal: continue without deletions
  }

  emit('drafting');
  const dismissed: string[] = JSON.parse(ctx.t.dismissed || '[]');
  const allowNewBullets = getSetting('allow_new_bullets', '1') === '1';
  const maxNewBullets = Math.max(0, parseInt(getSetting('max_new_bullets', '2'), 10) || 2);
  const out = await tailorSuggest({
    model, jd, verdicts: report.verdicts, pageCount, deletions,
    dismissedFingerprints: dismissed, allowNewBullets, maxNewBullets,
  });

  // merge + filter: dismissed fingerprints, invalid paraIds, protected kinds
  const editable = new Set(model.paragraphs.filter(isEditablePara).map((p) => p.paraId));
  const seen = new Set<string>();
  const insertsPerEntry = new Map<string, number>();
  const all = [...out.suggestions, ...deletions].filter((s) => {
    if (!s.paraId || !editable.has(s.paraId)) return false;
    // hard-enforce the new-bullet guardrails regardless of what the model emitted
    if (s.op === 'insert_paragraph_after') {
      if (!allowNewBullets) return false;
      const key = s.entryId ?? s.paraId;
      const n = insertsPerEntry.get(key) ?? 0;
      if (n >= maxNewBullets) return false;
      insertsPerEntry.set(key, n + 1);
    }
    const fp = fingerprint(s);
    if (dismissed.includes(fp) || seen.has(fp)) return false;
    seen.add(fp);
    // backfill oldText from the model so diffs always render
    const para = model.paragraphs.find((p) => p.paraId === s.paraId);
    if (para && s.op !== 'insert_paragraph_after' && !s.oldText) s.oldText = para.text;
    if (s.op === 'insert_paragraph_after') s.oldText = '';
    return true;
  });

  db.prepare('UPDATE tailored_resumes SET suggestions = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(all), now(), tailoredId);
  return all;
}
