/**
 * Heuristics-first section classification with AI fallback (PRD §6.3 step 3).
 * Heuristics are deterministic and free; the AI pass only runs when they
 * clearly failed (<2 meaningful sections or no experience entries).
 */
import type { ResumeModel } from '../docx/types.js';
import { resumeClassify } from './ai/tasks.js';

export function heuristicsFailed(model: ResumeModel): boolean {
  const meaningful = Object.entries(model.sections)
    .filter(([name, ids]) => name !== 'header' && ids.length > 0).length;
  return meaningful < 2 || model.entries.length === 0;
}

/** Returns a re-labeled model, or the original if AI is unavailable/fails. */
export async function aiClassifyModel(model: ResumeModel): Promise<{ model: ResumeModel; usedAi: boolean }> {
  if (!heuristicsFailed(model)) return { model, usedAi: false };
  let labels;
  try {
    labels = await resumeClassify(model.paragraphs.map((p) => ({ paraId: p.paraId, text: p.text, isBullet: p.isBullet })));
  } catch {
    return { model, usedAi: false }; // graceful degrade: keep heuristic model
  }
  const byId = new Map(labels.paragraphs.map((l) => [l.paraId, l]));
  const out: ResumeModel = { paragraphs: [], entries: [], sections: {} };
  const entryMap = new Map<string, { entryId: string; headerId: string; title: string; company: string; bulletIds: string[] }>();

  for (const p of model.paragraphs) {
    const l = byId.get(p.paraId);
    const kind = (p.isBullet ? 'bullet' : (l?.kind ?? p.kind)) as ResumeModel['paragraphs'][number]['kind'];
    const section = (l?.section ?? p.section) as ResumeModel['paragraphs'][number]['section'];
    const entryId = l?.entryId ?? null;
    out.paragraphs.push({ ...p, kind, section, entryId: kind === 'bullet' ? entryId : null });
    (out.sections[section] ??= []).push(p.paraId);
    if (entryId && section === 'experience') {
      const e = entryMap.get(entryId) ?? { entryId, headerId: '', title: '', company: '', bulletIds: [] };
      if (kind === 'entryHeader') { e.headerId = p.paraId; e.title = p.text; }
      else if (kind === 'entryCompany') e.company = p.text;
      else if (kind === 'bullet') e.bulletIds.push(p.paraId);
      entryMap.set(entryId, e);
    }
  }
  out.entries = [...entryMap.values()].filter((e) => e.bulletIds.length || e.headerId);
  // sanity: the AI pass must actually improve things, otherwise keep heuristics
  if (heuristicsFailed(out)) return { model, usedAi: false };
  return { model: out, usedAi: true };
}
