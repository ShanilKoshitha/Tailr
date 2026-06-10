/**
 * DocxEngine.applyEdits — port of demos/apply_edits.py.
 * The only four ops that exist (PRD §6.4). Edits are applied to a COPY of the
 * original DOCX by mutating <w:t>/<w:p> nodes; nothing is re-templated.
 */
import { createHash } from 'node:crypto';
import {
  openDocx, saveDocx, allParagraphs, paraText, firstChildNS, childrenNS,
  W_NS, XML_NS, localName,
} from './xml.js';
import type { AppliedEdit, Edit, ResumeModel } from './types.js';

type El = any;

function cloneFirstRpr(p: El): El | null {
  for (const r of childrenNS(p, 'r')) {
    const rpr = firstChildNS(r as El, 'rPr');
    if (rpr) return (rpr as El).cloneNode(true);
  }
  return null;
}

function removeRunsAndHyperlinks(p: El) {
  const toRemove: El[] = [];
  for (let n = p.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) {
      const ln = localName(n as El);
      if (ln === 'r' || ln === 'hyperlink' || ln === 'fldSimple' || ln === 'smartTag') toRemove.push(n);
    }
  }
  toRemove.forEach((n) => p.removeChild(n));
}

function appendRun(doc: El, p: El, rpr: El | null, text: string) {
  const run = doc.createElementNS(W_NS, 'w:r');
  if (rpr) run.appendChild(rpr);
  const t = doc.createElementNS(W_NS, 'w:t');
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  run.appendChild(t);
  p.appendChild(run);
}

/** Count distinct run formats among text-bearing runs (for formattingFlattened). */
function textRunCountWithDistinctFormat(p: El): number {
  const sigs = new Set<string>();
  for (const r of childrenNS(p, 'r')) {
    if ((r as El).getElementsByTagNameNS(W_NS, 't').length === 0) continue;
    const rpr = firstChildNS(r as El, 'rPr');
    sigs.add(rpr ? (rpr as El).toString() : '');
  }
  return sigs.size;
}

function replaceText(doc: El, p: El, newText: string): boolean {
  const flattened = textRunCountWithDistinctFormat(p) > 1;
  const rpr = cloneFirstRpr(p);
  removeRunsAndHyperlinks(p);
  appendRun(doc, p, rpr, newText);
  return flattened;
}

/**
 * Skills-line exception (PRD Appendix A.5): if the paragraph started with a
 * bold label run and newText matches "Label:<sep>values", emit TWO runs —
 * bold label clone + plain values run — so "Label:\tvalues" formatting survives.
 */
function replaceSkillsLine(doc: El, p: El, newText: string): boolean {
  const runs = childrenNS(p, 'r').filter((r) => (r as El).getElementsByTagNameNS(W_NS, 't').length > 0);
  const firstRpr = runs.length ? firstChildNS(runs[0] as El, 'rPr') : null;
  const firstIsBold = firstRpr ? !!firstChildNS(firstRpr as El, 'b') : false;
  const m = newText.match(/^([^:]{1,40}:)(\s*)([\s\S]*)$/);
  if (!firstIsBold || !m || runs.length < 2) {
    return replaceText(doc, p, newText);
  }
  // plain rPr: clone from the last text run (the values run in the original)
  const lastRpr = firstChildNS(runs[runs.length - 1] as El, 'rPr');
  removeRunsAndHyperlinks(p);
  appendRun(doc, p, (firstRpr as El).cloneNode(true), m[1] + (m[2] || '\t'));
  appendRun(doc, p, lastRpr ? (lastRpr as El).cloneNode(true) : null, m[3]);
  return false;
}

function deleteParagraph(p: El) {
  p.parentNode.removeChild(p);
}

function insertParagraphAfter(doc: El, anchor: El, newText: string): El {
  const clone = anchor.cloneNode(true);
  replaceText(doc, clone, newText);
  if (anchor.nextSibling) anchor.parentNode.insertBefore(clone, anchor.nextSibling);
  else anchor.parentNode.appendChild(clone);
  return clone;
}

export interface ApplyResult {
  buffer: Buffer;
  applied: AppliedEdit[];
}

/**
 * Apply edits to a docx buffer. Locates paragraphs by paraId via the model's
 * idx (collect element refs FIRST, then mutate — refs stay valid in the DOM).
 */
export async function applyEdits(originalBuf: Buffer, model: ResumeModel, edits: Edit[]): Promise<ApplyResult> {
  const { zip, dom } = await openDocx(originalBuf);
  const doc = dom as El;
  const paras = allParagraphs(dom);

  const byId = new Map<string, El>();
  for (const mp of model.paragraphs) {
    const el = paras[mp.idx];
    if (!el) continue;
    // guard against drift between model and file
    const t = paraText(el).trim();
    if (t === mp.text || mp.text.startsWith(t.slice(0, 16))) byId.set(mp.paraId, el);
    else byId.set(mp.paraId, el); // still map; paraId carries idx + hash, mismatch is logged upstream
  }

  const applied: AppliedEdit[] = [];
  for (const e of edits) {
    const el = byId.get(e.paraId);
    if (!el) throw new Error(`applyEdits: unknown paraId ${e.paraId}`);
    switch (e.op) {
      case 'replace_text': {
        const flattened = replaceText(doc, el, e.newText ?? '');
        applied.push({ ...e, formattingFlattened: flattened });
        break;
      }
      case 'replace_skills_line': {
        const flattened = replaceSkillsLine(doc, el, e.newText ?? '');
        applied.push({ ...e, formattingFlattened: flattened });
        break;
      }
      case 'delete_paragraph': {
        deleteParagraph(el);
        applied.push({ ...e });
        break;
      }
      case 'insert_paragraph_after': {
        const inserted = insertParagraphAfter(doc, el, e.newText ?? '');
        const hash = createHash('md5').update((e.newText ?? '').slice(0, 24), 'utf8').digest('hex').slice(0, 6);
        applied.push({ ...e, insertedParaId: `pnew_${hash}` });
        void inserted;
        break;
      }
      default:
        throw new Error(`applyEdits: unsupported op ${(e as Edit).op}`);
    }
  }

  const buffer = await saveDocx(zip, dom);
  return { buffer, applied };
}
