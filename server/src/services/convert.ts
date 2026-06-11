/**
 * ConvertService — LibreOffice headless DOCX→PDF + optional pdftotext bbox map
 * for preview hover overlays. Both degrade gracefully when missing (PRD §13).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getSetting } from '../db.js';
import type { ResumeModel } from '../docx/types.js';

const pExecFile = promisify(execFile);

const SOFFICE_CANDIDATES = [
  'soffice',
  '/opt/homebrew/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
];

let cachedSoffice: string | null | undefined;

export async function findSoffice(): Promise<string | null> {
  const override = getSetting('soffice_path');
  if (override) {
    if (await isExecutable(override)) return override;
  }
  if (cachedSoffice != null) return cachedSoffice;
  for (const c of SOFFICE_CANDIDATES) {
    if (await isExecutable(c)) { cachedSoffice = c; return c; }
  }
  // never cache a negative result — the user may install LibreOffice
  // while the server is running (then it should just start working)
  return null;
}

async function isExecutable(cmd: string): Promise<boolean> {
  try {
    await pExecFile(cmd, ['--version'], { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

export function resetSofficeCache() { cachedSoffice = undefined; }

/** Convert a .docx to .pdf next to it (or into outDir). Returns pdf path or null if no soffice. */
export async function convertToPdf(docxPath: string, outDir?: string): Promise<string | null> {
  const soffice = await findSoffice();
  if (!soffice) return null;
  const dir = outDir ?? path.dirname(docxPath);
  // unique profile dir avoids soffice lock contention on concurrent calls
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tailr-lo-'));
  try {
    await pExecFile(soffice, [
      '--headless', `-env:UserInstallation=file://${profile}`,
      '--convert-to', 'pdf', '--outdir', dir, docxPath,
    ], { timeout: 120000 });
    const pdf = path.join(dir, path.basename(docxPath).replace(/\.docx$/i, '.pdf'));
    return fs.existsSync(pdf) ? pdf : null;
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

export async function findPdftotext(): Promise<string | null> {
  for (const c of ['pdftotext', '/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext']) {
    try {
      await pExecFile(c, ['-v'], { timeout: 10000 });
      return c;
    } catch { /* try next */ }
  }
  return null;
}

export interface ParaBox { paraId: string; page: number; x: number; y: number; w: number; h: number }
export interface BboxMap { pageSizes: Array<{ page: number; width: number; height: number }>; boxes: ParaBox[] }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * pdftotext -bbox → fuzzy-match each model paragraph to word boxes.
 * Progressive enhancement: returns null when pdftotext is unavailable or the
 * match confidence is too low (PRD §8.2 fallback).
 */
export async function buildBboxMap(pdfPath: string, model: ResumeModel): Promise<BboxMap | null> {
  const bin = await findPdftotext();
  if (!bin) return null;
  let xml: string;
  try {
    const r = await pExecFile(bin, ['-bbox', pdfPath, '-'], { timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
    xml = r.stdout;
  } catch {
    return null;
  }

  interface Word { page: number; xMin: number; yMin: number; xMax: number; yMax: number; text: string }
  const words: Word[] = [];
  const pageSizes: BboxMap['pageSizes'] = [];
  let page = 0;
  for (const line of xml.split('\n')) {
    const pm = line.match(/<page width="([\d.]+)" height="([\d.]+)"/);
    if (pm) { page += 1; pageSizes.push({ page, width: +pm[1], height: +pm[2] }); continue; }
    const wm = line.match(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/);
    if (wm) {
      words.push({ page, xMin: +wm[1], yMin: +wm[2], xMax: +wm[3], yMax: +wm[4], text: decodeEntities(wm[5]) });
    }
  }
  if (!words.length) return null;

  const stream = words.map((w) => norm(w.text));
  const boxes: ParaBox[] = [];
  let cursor = 0;
  for (const p of model.paragraphs) {
    if (!p.text || p.text.length < 3) continue;
    const target = p.text.split(/\s+/).map(norm).filter(Boolean);
    if (!target.length) continue;
    const start = findSeq(stream, target, cursor);
    if (start < 0) continue;
    const seg = words.slice(start, start + target.length);
    const pg = seg[0].page;
    const onPage = seg.filter((w) => w.page === pg);
    const x = Math.min(...onPage.map((w) => w.xMin));
    const y = Math.min(...onPage.map((w) => w.yMin));
    boxes.push({
      paraId: p.paraId, page: pg, x, y,
      w: Math.max(...onPage.map((w) => w.xMax)) - x,
      h: Math.max(...onPage.map((w) => w.yMax)) - y,
    });
    cursor = start + target.length;
  }
  // <80% of long paragraphs matched → low confidence, no overlay
  const eligible = model.paragraphs.filter((p) => p.text.length >= 3).length;
  if (eligible && boxes.length / eligible < 0.5) return null;
  return { pageSizes, boxes };
}

function findSeq(stream: string[], target: string[], from: number): number {
  const need = Math.max(1, Math.ceil(target.length * 0.8)); // tolerate hyphenation drift
  outer: for (let i = from; i <= stream.length - need; i++) {
    if (stream[i] !== target[0]) continue;
    let hits = 0;
    for (let j = 0; j < target.length && i + j < stream.length; j++) {
      if (stream[i + j] === target[j] || stream[i + j].includes(target[j]) || target[j].includes(stream[i + j])) hits++;
      else if (hits < Math.ceil(j * 0.6)) continue outer;
    }
    if (hits >= need) return i;
  }
  return -1;
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** Page count via the converted PDF (cheap regex; good enough for budgets). */
export function pdfPageCount(pdfPath: string): number | null {
  try {
    const buf = fs.readFileSync(pdfPath);
    const m = buf.toString('latin1').match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/);
    if (m) return +m[1];
    const pages = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
    return pages ? pages.length : null;
  } catch {
    return null;
  }
}
