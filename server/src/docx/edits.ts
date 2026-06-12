/**
 * DocxEngine.applyEdits — the only four edit operations that exist (PRD §6.4).
 * Edits are applied to a COPY of the original DOCX by mutating <w:t>/<w:p>
 * nodes; the document is never re-templated.
 */
import { createHash } from 'node:crypto';
import type { AppliedEdit, Edit, ResumeModel } from '@tailr/shared';
import {
  openDocx,
  saveDocx,
  allParagraphs,
  firstChildNS,
  childrenNS,
  serializeNode,
  W_NS,
  XML_NS,
  localName,
  type XmlDocument,
  type XmlElement,
} from './xml.js';

function cloneFirstRpr(p: XmlElement): XmlElement | null {
  for (const r of childrenNS(p, 'r')) {
    const rpr = firstChildNS(r, 'rPr');
    if (rpr) return rpr.cloneNode(true) as XmlElement;
  }
  return null;
}

function removeRunsAndHyperlinks(p: XmlElement) {
  const toRemove: XmlElement[] = [];
  for (let n = p.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) {
      const el = n as XmlElement;
      const ln = localName(el);
      if (ln === 'r' || ln === 'hyperlink' || ln === 'fldSimple' || ln === 'smartTag') {
        toRemove.push(el);
      }
    }
  }
  toRemove.forEach((n) => p.removeChild(n));
}

function appendRun(doc: XmlDocument, p: XmlElement, rpr: XmlElement | null, text: string) {
  const run = doc.createElementNS(W_NS, 'w:r');
  if (rpr) run.appendChild(rpr);
  const t = doc.createElementNS(W_NS, 'w:t');
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  run.appendChild(t);
  p.appendChild(run);
}

/** Count distinct run formats among text-bearing runs (for formattingFlattened). */
function textRunCountWithDistinctFormat(p: XmlElement): number {
  const sigs = new Set<string>();
  for (const r of childrenNS(p, 'r')) {
    if (r.getElementsByTagNameNS(W_NS, 't').length === 0) continue;
    const rpr = firstChildNS(r, 'rPr');
    sigs.add(rpr ? serializeNode(rpr) : '');
  }
  return sigs.size;
}

function replaceText(doc: XmlDocument, p: XmlElement, newText: string): boolean {
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
function replaceSkillsLine(doc: XmlDocument, p: XmlElement, newText: string): boolean {
  const runs = childrenNS(p, 'r').filter((r) => r.getElementsByTagNameNS(W_NS, 't').length > 0);
  const firstRpr = runs.length ? firstChildNS(runs[0], 'rPr') : null;
  const firstIsBold = firstRpr ? !!firstChildNS(firstRpr, 'b') : false;
  const m = newText.match(/^([^:]{1,40}:)(\s*)([\s\S]*)$/);
  if (!firstIsBold || !firstRpr || !m || runs.length < 2) {
    return replaceText(doc, p, newText);
  }
  // plain rPr: clone from the last text run (the values run in the original)
  const lastRpr = firstChildNS(runs[runs.length - 1], 'rPr');
  removeRunsAndHyperlinks(p);
  appendRun(doc, p, firstRpr.cloneNode(true) as XmlElement, m[1] + (m[2] || '\t'));
  appendRun(doc, p, lastRpr ? (lastRpr.cloneNode(true) as XmlElement) : null, m[3]);
  return false;
}

function deleteParagraph(p: XmlElement) {
  p.parentNode?.removeChild(p);
}

function insertParagraphAfter(doc: XmlDocument, anchor: XmlElement, newText: string): XmlElement {
  const clone = anchor.cloneNode(true) as XmlElement;
  replaceText(doc, clone, newText);
  if (anchor.nextSibling) anchor.parentNode?.insertBefore(clone, anchor.nextSibling);
  else anchor.parentNode?.appendChild(clone);
  return clone;
}

export interface ApplyResult {
  buffer: Buffer;
  applied: AppliedEdit[];
}

/**
 * Apply edits to a docx buffer. Paragraphs are located by the model's idx;
 * element refs are collected FIRST so they stay valid while mutating.
 */
export async function applyEdits(
  originalBuf: Buffer,
  model: ResumeModel,
  edits: Edit[],
): Promise<ApplyResult> {
  const { zip, dom } = await openDocx(originalBuf);
  const paras = allParagraphs(dom);

  const byId = new Map<string, XmlElement>();
  for (const mp of model.paragraphs) {
    const el = paras[mp.idx];
    if (el) byId.set(mp.paraId, el);
  }

  const applied: AppliedEdit[] = [];
  for (const e of edits) {
    const el = byId.get(e.paraId);
    if (!el) throw new Error(`applyEdits: unknown paraId ${e.paraId}`);
    switch (e.op) {
      case 'replace_text': {
        const flattened = replaceText(dom, el, e.newText ?? '');
        applied.push({ ...e, formattingFlattened: flattened });
        break;
      }
      case 'replace_skills_line': {
        const flattened = replaceSkillsLine(dom, el, e.newText ?? '');
        applied.push({ ...e, formattingFlattened: flattened });
        break;
      }
      case 'delete_paragraph': {
        deleteParagraph(el);
        applied.push({ ...e });
        break;
      }
      case 'insert_paragraph_after': {
        insertParagraphAfter(dom, el, e.newText ?? '');
        const hash = createHash('md5')
          .update((e.newText ?? '').slice(0, 24), 'utf8')
          .digest('hex')
          .slice(0, 6);
        applied.push({ ...e, insertedParaId: `pnew_${hash}` });
        break;
      }
      default:
        throw new Error(`applyEdits: unsupported op ${(e as Edit).op}`);
    }
  }

  const buffer = await saveDocx(zip, dom);
  return { buffer, applied };
}
