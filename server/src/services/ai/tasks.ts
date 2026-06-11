/**
 * Named AI tasks (PRD §4.4): prompt templates wired to schemas via aiCall.
 * Truthfulness guardrail language is embedded in every generation prompt.
 */
import { aiCall } from './aiCall.js';
import {
  jdAnalyzeSchema, matchScoreSchema, tailorSuggestSchema,
  rewriteOneSchema, bulletRelevanceSchema, resumeClassifySchema,
} from './schemas.js';
import { modelToPromptText } from '../../docx/parse.js';
import type { ResumeModel } from '../../docx/types.js';

export interface JdAnalysis {
  titleEssence: string;
  qualifications: Array<{ id: string; text: string; priority: 'required' | 'preferred' }>;
  responsibilities: Array<{ id: string; text: string; priority: 'primary' | 'secondary' }>;
  keywords: Array<{ id: string; text: string; type: 'hard' | 'soft' | 'domain' }>;
}

export interface MatchVerdicts {
  titleMatch: 'full' | 'adjacent' | 'distant';
  items: Array<{
    itemId: string;
    verdict: 'covered' | 'partial' | 'missing';
    evidenceParaIds?: string[];
    explanation?: string;
    suggestionHint?: string;
  }>;
}

export interface Suggestion {
  id: string;
  op: 'replace_text' | 'insert_paragraph_after' | 'delete_paragraph' | 'replace_skills_line';
  paraId: string;
  entryId?: string | null;
  newText: string;
  oldText?: string;
  itemsCovered?: string[];
  rationale?: string;
  assumptionFlag?: boolean;
  lineDelta?: number;
}

const TRUTH_GUARDRAIL = `TRUTHFULNESS GUARDRAIL (hard constraint): Never fabricate employers, job titles,
dates, degrees, certifications, metrics, or tools the candidate has not listed. You may reframe,
re-emphasize, reorder, and quantify with [X] placeholders only. If a new statement asserts anything
not already present in the resume, set "assumptionFlag": true on it.`;

export interface ClassifiedPara {
  paraId: string;
  kind: string;
  section: string;
  entryId?: string | null;
}

/**
 * resume.classify — AI fallback when section heuristics fail (PRD §6.3 step 3).
 * Receives the ordered paragraph list, returns a label per paraId.
 */
export function resumeClassify(paragraphs: Array<{ paraId: string; text: string; isBullet: boolean }>): Promise<{ paragraphs: ClassifiedPara[] }> {
  const prompt = `Classify every paragraph of this resume. The list is in document order.

For each paraId return:
- "kind": name | headerContact | heading | entryCompany | entryHeader | bullet | body | empty
  (entryHeader = a line carrying a role title and/or date range inside the experience section;
   entryCompany = the company/location line of an experience entry; bullet = an achievement line)
- "section": header | summary | strengths | skills | experience | education | projects | certifications | other
- "entryId": for bullets/entryHeader/entryCompany inside experience, group them as exp_1, exp_2, …
  in document order (most recent role = exp_1). Null elsewhere.

Include EVERY paraId exactly once. A paragraph flagged isBullet=true must keep kind "bullet".

PARAGRAPHS:
${paragraphs.map((p) => `[${p.paraId}]${p.isBullet ? ' (isBullet)' : ''} ${p.text || '(empty)'}`).join('\n').slice(0, 24000)}`;
  return aiCall('resume.classify', prompt, resumeClassifySchema);
}

export function jdAnalyze(jdText: string, title: string, company: string): Promise<JdAnalysis> {
  const prompt = `You are an expert recruiter analyzing a job description.

JOB TITLE: ${title || '(unknown)'}
COMPANY: ${company || '(unknown)'}

JOB DESCRIPTION:
"""
${jdText.slice(0, 20000)}
"""

Extract:
1. "titleEssence" — the core role identity stripped of fluff/level-noise (e.g. "Product Placement Design Lead, Marketing" → "Product Design Lead").
2. "qualifications" — required skills/experience/education items (ids q1, q2, …), each marked "required" or "preferred". Deduplicate. 4–12 items.
3. "responsibilities" — duties of the role (ids r1, r2, …), each "primary" or "secondary". 4–10 items.
4. "keywords" — technologies, tools, methodologies, soft skills explicitly named (ids k1, k2, …), each typed "hard", "soft", or "domain". 6–20 items, no duplicates of one another.`;
  return aiCall<JdAnalysis>('jd.analyze', prompt, jdAnalyzeSchema);
}

export function matchScore(model: ResumeModel, jd: JdAnalysis): Promise<MatchVerdicts> {
  const items = [
    ...jd.qualifications.map((q) => `${q.id} [qualification/${q.priority}]: ${q.text}`),
    ...jd.responsibilities.map((r) => `${r.id} [responsibility/${r.priority}]: ${r.text}`),
    ...jd.keywords.map((k) => `${k.id} [keyword/${k.type}]: ${k.text}`),
  ].join('\n');
  const prompt = `You are scoring how well a resume covers a job description. Use SEMANTIC matching:
"presented quarterly narratives to execs" covers the keyword "storytelling". Credit transferable evidence
as "partial". Only mark "covered" when the resume clearly demonstrates the item.

RESUME (each line is "[paraId|kind] text"):
"""
${modelToPromptText(model).slice(0, 24000)}
"""

TARGET JOB TITLE ESSENCE: ${jd.titleEssence}

JD ITEMS TO VERDICT (one verdict per item, include EVERY itemId exactly once):
${items}

For each item return verdict covered|partial|missing, evidenceParaIds (paraIds of supporting resume lines,
empty if missing), a one-sentence explanation, and a suggestionHint for missing/partial items.
Also return "titleMatch": full|adjacent|distant comparing the resume's most recent role title to the title essence.`;
  return aiCall<MatchVerdicts>('match.score', prompt, matchScoreSchema);
}

export function bulletRelevance(model: ResumeModel, jd: JdAnalysis): Promise<{ bullets: Array<{ paraId: string; relevance: number; reason?: string }> }> {
  const bullets = model.paragraphs.filter((p) => p.kind === 'bullet');
  const prompt = `Rate each resume bullet's relevance (0–100) to this job. 100 = directly demonstrates a core
requirement; 0 = unrelated to anything in the JD.

JOB: ${jd.titleEssence}
KEY ITEMS: ${[...jd.qualifications, ...jd.responsibilities].map((i) => i.text).join(' | ').slice(0, 4000)}
KEYWORDS: ${jd.keywords.map((k) => k.text).join(', ').slice(0, 2000)}

BULLETS:
${bullets.map((b) => `[${b.paraId}] ${b.text}`).join('\n').slice(0, 16000)}

Return every paraId with its relevance score.`;
  return aiCall('bullet.relevance', prompt, bulletRelevanceSchema);
}

export function tailorSuggest(opts: {
  model: ResumeModel;
  jd: JdAnalysis;
  verdicts: MatchVerdicts;
  pageCount: number;
  deletions: Suggestion[];
  dismissedFingerprints: string[];
  allowNewBullets?: boolean;
  maxNewBullets?: number;
}): Promise<{ suggestions: Suggestion[] }> {
  const { model, jd, verdicts, pageCount, deletions, allowNewBullets = true, maxNewBullets = 2 } = opts;
  const gaps = verdicts.items.filter((i) => i.verdict !== 'covered');
  const itemText = (id: string) =>
    [...jd.qualifications, ...jd.responsibilities, ...jd.keywords].find((i) => i.id === id)?.text ?? id;
  const lineBudget = pageCount <= 1 ? 3 : 8;
  const summaryIds = [...(opts.model.sections['summary'] ?? []), ...(opts.model.sections['header'] ?? [])];
  const summaryPara = model.paragraphs.find((p) => summaryIds.includes(p.paraId) && p.kind === 'body' && p.text.length > 120);
  const skillsParas = (model.sections['skills'] ?? [])
    .map((id) => model.paragraphs.find((p) => p.paraId === id)!)
    .filter((p) => p && p.kind === 'body');

  const prompt = `You are tailoring a resume to a job description. Propose surgical edits as suggestion cards.

${TRUTH_GUARDRAIL}

RESUME (each line "[paraId|kind|entryId?] text"):
"""
${modelToPromptText(model).slice(0, 24000)}
"""

TARGET ROLE: ${jd.titleEssence}

COVERAGE GAPS (address these, highest priority first — required quals & primary responsibilities first):
${gaps.map((g) => `${g.itemId} (${g.verdict}): ${itemText(g.itemId)}${g.suggestionHint ? ` — hint: ${g.suggestionHint}` : ''}`).join('\n').slice(0, 8000)}

ALREADY-PLANNED DELETIONS (do not touch these paraIds): ${deletions.map((d) => d.paraId).join(', ') || 'none'}

HARD CONSTRAINTS:
- ops allowed: replace_text (rewrite ONE existing bullet, ≤1 rewrite per bullet, keep its core factual claim),
  ${allowNewBullets
    ? `insert_paragraph_after (new bullet AFTER an existing bullet paraId, max ${maxNewBullets} per entryId, assumptionFlag
  required if it asserts anything new; use [X] placeholders for unverifiable numbers),`
    : `(insert_paragraph_after is DISABLED — do not propose new bullets),`}
  replace_skills_line (target paraId must be one of: ${skillsParas.map((p) => p.paraId).join(', ') || 'none'} —
  keep the "Label:<TAB>values" shape of the original line),
  and a summary rewrite via replace_text targeting ${summaryPara ? summaryPara.paraId : '(no summary paragraph found — skip summary)'}
  (≤45 words, mirror the title essence + top 3 required qualifications).
- Only target paraIds whose kind is "bullet" or "body" in summary/skills sections. NEVER touch headings,
  entryHeader, entryCompany, name, or contact lines.
- PAGE BUDGET: resume is ${pageCount} page(s); total net lineDelta of all suggestions must be ≤ +${lineBudget} lines.
  A bullet ≈ 1 line per 110 characters. Report "lineDelta" per suggestion (insertions positive, length growth positive).
- Each suggestion lists "itemsCovered" (JD item ids it satisfies) and includes "oldText" (the exact current text
  of the target paragraph; empty string for insertions).
- newText must be FINAL resume copy: never embed hedges or disclaimers in it ("If accurate:", "if used",
  "[Stripe/Adyen/etc.]" option lists). Pick the single most plausible phrasing, use [X] only for numbers,
  and let assumptionFlag carry the uncertainty — the UI shows a verification banner for flagged items.
- ids: s1, s2, … Aim for 6–14 high-impact suggestions.`;
  return aiCall<{ suggestions: Suggestion[] }>('tailor.suggest', prompt, tailorSuggestSchema);
}

export function rewriteOne(opts: {
  model: ResumeModel;
  jd: JdAnalysis;
  paraId: string;
  targetItemIds: string[];
  userHint?: string;
  previousText?: string;
}): Promise<{ newText: string; itemsCovered?: string[]; rationale?: string; assumptionFlag?: boolean }> {
  const { model, jd, paraId, targetItemIds, userHint, previousText } = opts;
  const para = model.paragraphs.find((p) => p.paraId === paraId);
  const all = [...jd.qualifications, ...jd.responsibilities, ...jd.keywords];
  const targets = targetItemIds.map((id) => all.find((i) => i.id === id)).filter(Boolean);
  const prompt = `Rewrite ONE resume bullet to better cover specific JD items.

${TRUTH_GUARDRAIL}

CURRENT BULLET [${paraId}]: ${para?.text ?? ''}
${previousText ? `PREVIOUS AI ATTEMPT (user asked to regenerate — produce something different): ${previousText}` : ''}
TARGET JD ITEMS:
${targets.map((t) => `${t!.id}: ${t!.text}`).join('\n')}
${userHint ? `USER HINT: ${userHint}` : ''}

Keep the bullet's core factual claim. One sentence, strong verb first, ≤230 characters.`;
  return aiCall('tailor.rewriteOne', prompt, rewriteOneSchema);
}
