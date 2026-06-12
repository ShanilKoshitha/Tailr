/** Low-level DOCX XML access: zip in/out, namespace-aware DOM helpers. */
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom';
import JSZip from 'jszip';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export type XmlDocument = Document;
export type XmlElement = Element;

export async function openDocx(buf: Buffer): Promise<{ zip: JSZip; dom: XmlDocument }> {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('Not a DOCX: word/document.xml missing');
  const docXml = await entry.async('string');
  const dom = new DOMParser().parseFromString(docXml, 'text/xml');
  return { zip, dom };
}

/**
 * Re-zip with the mutated document.xml. Every other zip entry passes through
 * byte-identical — only word/document.xml is re-serialized (Principle 1).
 */
export async function saveDocx(zip: JSZip, dom: XmlDocument): Promise<Buffer> {
  const xml = new XMLSerializer().serializeToString(dom);
  const out = xml.startsWith('<?xml')
    ? xml
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${xml}`;
  zip.file('word/document.xml', out);
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

function isElement(n: Node): n is Element {
  return n.nodeType === 1;
}

export function localName(n: { localName?: string | null; nodeName: string }): string {
  return n.localName ?? n.nodeName.replace(/^.*:/, '');
}

/** All <w:p> elements in document order (includes table cells & text boxes). */
export function allParagraphs(dom: XmlDocument): XmlElement[] {
  const out: XmlElement[] = [];
  const list = dom.getElementsByTagNameNS(W_NS, 'p');
  for (let i = 0; i < list.length; i++) {
    const el = list.item(i);
    if (el) out.push(el);
  }
  return out;
}

export function paraText(p: XmlElement): string {
  let s = '';
  const ts = p.getElementsByTagNameNS(W_NS, 't');
  for (let i = 0; i < ts.length; i++) s += ts.item(i)?.textContent ?? '';
  return s;
}

export function firstChildNS(el: XmlElement | null, name: string): XmlElement | null {
  if (!el) return null;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (isElement(n) && localName(n) === name && n.namespaceURI === W_NS) return n;
  }
  return null;
}

export function childrenNS(el: XmlElement | null, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (isElement(n) && localName(n) === name && n.namespaceURI === W_NS) out.push(n);
  }
  return out;
}

export function hasDescendantNS(el: XmlElement, name: string): boolean {
  return el.getElementsByTagNameNS(W_NS, name).length > 0;
}

export function serializeNode(n: XmlElement): string {
  return new XMLSerializer().serializeToString(n);
}
