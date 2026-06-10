/**
 * DOCX → ResumeModel. Port of demos/parse.py (the validated prototype),
 * generalized: walks every <w:p> in document order (incl. tables/text boxes),
 * classifies headings/sections heuristically, detects experience entries and
 * bullets, and assigns stable paraIds.
 */
import { createHash } from 'node:crypto';
import {
  openDocx, allParagraphs, paraText, firstChildNS, childrenNS,
  hasDescendantNS, W_NS, localName, serializeNode,
} from './xml.js';
import type { ModelEntry, ModelParagraph, ParaKind, ResumeModel, Section } from './types.js';

const DATE_RE = /\b(19|20)\d{2}\b.*(present|current|\b(19|20)\d{2}\b)/i;

const HEADINGS: Array<{ section: Section; rx: RegExp }> = [
  { section: 'experience', rx: /experience|employment|work history/i },
  { section: 'education', rx: /^education/i },
  { section: 'skills', rx: /technical stack|technical skills|^skills/i },
  { section: 'summary', rx: /summary|profile|objective/i },
  { section: 'strengths', rx: /core strengths|leadership/i },
  { section: 'projects', rx: /^projects|personal projects/i },
  { section: 'certifications', rx: /certifications?|licenses/i },
];

function makeParaId(idx: number, text: string): string {
  const h = createHash('md5').update(text.slice(0, 24), 'utf8').digest('hex').slice(0, 6);
  return `p_${idx}_${h}`;
}

type El = any;

function isBulletEl(p: El): boolean {
  const pPr = firstChildNS(p, 'pPr');
  if (pPr && firstChildNS(pPr as El, 'numPr')) return true;
  return /^\s*[•–—\-\*]\s+/.test(paraText(p));
}

function hasBoldOrUnderline(p: El): boolean {
  const rprs = p.getElementsByTagNameNS(W_NS, 'rPr');
  for (let i = 0; i < rprs.length; i++) {
    const rpr = rprs.item(i) as El;
    if (firstChildNS(rpr, 'u') || firstChildNS(rpr, 'b')) return true;
  }
  return false;
}

function isInTable(p: El): boolean {
  for (let n = p.parentNode; n; n = n.parentNode) {
    if (n.nodeType === 1 && localName(n) === 'tbl') return true;
  }
  return false;
}

/** >1 distinct run formats among text-bearing runs → flattening warning on edit */
function hasMixedFormatting(p: El): boolean {
  const sigs = new Set<string>();
  for (const r of childrenNS(p, 'r')) {
    if ((r as El).getElementsByTagNameNS(W_NS, 't').length === 0) continue;
    const rpr = firstChildNS(r as El, 'rPr');
    sigs.add(rpr ? serializeNode(rpr) : '');
    if (sigs.size > 1) return true;
  }
  return false;
}

export async function parseDocx(buf: Buffer): Promise<{ model: ResumeModel }> {
  const { dom } = await openDocx(buf);
  const paras = allParagraphs(dom);

  const model: ResumeModel = { paragraphs: [], entries: [], sections: {} };
  let section: Section = 'header';
  let entry: ModelEntry | null = null;
  let entryN = 0;
  let sawHeading = false;

  paras.forEach((p, idx) => {
    const text = paraText(p).trim();
    const paraId = makeParaId(idx, text);
    const bullet = isBulletEl(p);
    let kind: ParaKind = 'body';

    let secHit: Section | null = null;
    if (text && text.length < 60) {
      for (const h of HEADINGS) {
        if (h.rx.test(text)) { secHit = h.section; break; }
      }
    }

    if (secHit && (hasBoldOrUnderline(p) || text === text.toUpperCase() || text.endsWith(':'))) {
      kind = 'heading';
      section = secHit;
      sawHeading = true;
      entry = null;
    } else if (bullet) {
      kind = 'bullet';
      if (entry) entry.bulletIds.push(paraId);
    } else if (section === 'experience' && text && DATE_RE.test(text)) {
      kind = 'entryHeader';
      entryN += 1;
      entry = { entryId: `exp_${entryN}`, headerId: paraId, title: text, company: '', bulletIds: [] };
      model.entries.push(entry);
    } else if (section === 'experience' && text && text.length < 80 && entry === null && sawHeading) {
      kind = 'entryCompany';
    } else if (section === 'experience' && text && text.length < 60 && !DATE_RE.test(text) && !text.endsWith('.')) {
      kind = 'entryCompany';
    } else if (!sawHeading && idx <= 4 && text) {
      kind = idx <= 1 ? 'name' : 'headerContact';
    }
    if (!text) kind = 'empty';

    // company back-fill: the entryCompany line directly above an entryHeader
    if (kind === 'entryHeader') {
      const prev = model.paragraphs[model.paragraphs.length - 1];
      if (prev && prev.kind === 'entryCompany' && entry) entry.company = prev.text;
    }

    model.paragraphs.push({
      paraId, idx, text, kind, section,
      entryId: entry && kind === 'bullet' ? entry.entryId : null,
      isBullet: bullet,
      inTable: isInTable(p),
      hasHyperlink: hasDescendantNS(p, 'hyperlink'),
      mixedFormatting: hasMixedFormatting(p),
    });
    (model.sections[section] ??= []).push(paraId);
  });

  return { model };
}

/** Plain-text view of the resume for AI prompts: "[paraId] text" lines, skipping empties. */
export function modelToPromptText(model: ResumeModel): string {
  return model.paragraphs
    .filter((p) => p.text)
    .map((p) => `[${p.paraId}|${p.kind}${p.entryId ? `|${p.entryId}` : ''}] ${p.text}`)
    .join('\n');
}
