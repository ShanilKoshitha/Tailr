import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export async function openDocx(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file('word/document.xml')!.async('string');
  const dom = new DOMParser().parseFromString(docXml, 'text/xml');
  return { zip, dom };
}

/**
 * Re-zip with the mutated document.xml. Every other zip entry passes through
 * byte-identical — only word/document.xml is re-serialized (Principle 1).
 */
export async function saveDocx(zip: JSZip, dom: ReturnType<DOMParser['parseFromString']>): Promise<Buffer> {
  const xml = new XMLSerializer().serializeToString(dom);
  const out = xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${xml}`;
  zip.file('word/document.xml', out);
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

type AnyEl = ReturnType<DOMParser['parseFromString']>['documentElement'];

export function localName(n: { localName?: string | null; nodeName: string }): string {
  return n.localName ?? n.nodeName.replace(/^.*:/, '');
}

/** All <w:p> elements in document order (includes table cells & text boxes). */
export function allParagraphs(dom: ReturnType<DOMParser['parseFromString']>): AnyEl[] {
  const out: AnyEl[] = [];
  const list = dom.getElementsByTagNameNS(W_NS, 'p');
  for (let i = 0; i < list.length; i++) out.push(list.item(i) as AnyEl);
  return out;
}

export function paraText(p: AnyEl): string {
  let s = '';
  const ts = (p as any).getElementsByTagNameNS(W_NS, 't');
  for (let i = 0; i < ts.length; i++) s += ts.item(i)?.textContent ?? '';
  return s;
}

export function firstChildNS(el: AnyEl | null, name: string): AnyEl | null {
  if (!el) return null;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && localName(n as any) === name && (n as any).namespaceURI === W_NS) return n as AnyEl;
  }
  return null;
}

export function childrenNS(el: AnyEl | null, name: string): AnyEl[] {
  const out: AnyEl[] = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && localName(n as any) === name && (n as any).namespaceURI === W_NS) out.push(n as AnyEl);
  }
  return out;
}

export function hasDescendantNS(el: AnyEl, name: string): boolean {
  return (el as any).getElementsByTagNameNS(W_NS, name).length > 0;
}

export function serializeNode(n: AnyEl): string {
  return new XMLSerializer().serializeToString(n as any);
}
