/**
 * Pixel-fidelity harness (PRD §6.5 AC1 / R5): a zero-edit round trip through
 * the DocxEngine must render ≥99.5% pixel-identical to the original at 144 DPI.
 *
 * Pipeline per file: docx → soffice pdf → pdftoppm -r 144 png → pixelmatch.
 * Requires LibreOffice + poppler. Run:
 *   npx tsx src/test/fidelity.test.ts [docx ...]   (default: ../shanil-hewage.docx)
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { parseDocx } from '../docx/parse.js';
import { applyEdits } from '../docx/edits.js';
import { findSoffice, findPdftotext } from '../services/convert.js';

const pExecFile = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

const inputs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [path.join(ROOT, 'shanil-hewage.docx')];
const THRESHOLD = 99.5;

const soffice = await findSoffice();
const havePoppler = await findPdftotext(); // pdftoppm ships with poppler too
if (!soffice || !havePoppler) {
  console.log('(skipped — needs LibreOffice + poppler installed)');
  process.exit(0);
}

async function toPdf(docx: string, outDir: string): Promise<string> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tailr-fid-lo-'));
  try {
    await pExecFile(
      soffice!,
      [
        '--headless',
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        docx,
      ],
      { timeout: 120000 },
    );
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
  return path.join(outDir, path.basename(docx).replace(/\.docx$/i, '.pdf'));
}

async function toPngs(pdf: string, prefix: string): Promise<string[]> {
  await pExecFile('pdftoppm', ['-r', '144', '-png', pdf, prefix], { timeout: 120000 });
  const dir = path.dirname(prefix);
  const base = path.basename(prefix);
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(base) && f.endsWith('.png'))
    .sort()
    .map((f) => path.join(dir, f));
}

let failed = false;
for (const input of inputs) {
  if (!fs.existsSync(input)) {
    console.log(`skip (missing): ${input}`);
    continue;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tailr-fidelity-'));
  try {
    const original = fs.readFileSync(input);
    const { model } = await parseDocx(original);
    const { buffer: roundTripped } = await applyEdits(original, model, []);

    const aDocx = path.join(tmp, 'a.docx');
    const bDocx = path.join(tmp, 'b.docx');
    fs.writeFileSync(aDocx, original);
    fs.writeFileSync(bDocx, roundTripped);
    const [aPdf, bPdf] = [await toPdf(aDocx, tmp), await toPdf(bDocx, tmp)];
    const [aPngs, bPngs] = [
      await toPngs(aPdf, path.join(tmp, 'pa')),
      await toPngs(bPdf, path.join(tmp, 'pb')),
    ];

    if (aPngs.length !== bPngs.length) {
      console.error(`✗ ${path.basename(input)}: page count changed ${aPngs.length} → ${bPngs.length}`);
      failed = true;
      continue;
    }

    let worst = 100;
    for (let i = 0; i < aPngs.length; i++) {
      const a = PNG.sync.read(fs.readFileSync(aPngs[i]));
      const b = PNG.sync.read(fs.readFileSync(bPngs[i]));
      if (a.width !== b.width || a.height !== b.height) {
        console.error(`✗ ${path.basename(input)} p${i + 1}: dimensions differ`);
        failed = true;
        continue;
      }
      const diff = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1 });
      const pct = 100 * (1 - diff / (a.width * a.height));
      worst = Math.min(worst, pct);
      console.log(
        `  ${path.basename(input)} page ${i + 1}/${aPngs.length}: ${pct.toFixed(3)}% match (${diff} px differ)`,
      );
    }
    const ok = worst >= THRESHOLD;
    console.log(
      `${ok ? '✓' : '✗'} ${path.basename(input)}: worst page ${worst.toFixed(3)}% (threshold ${THRESHOLD}%)`,
    );
    if (!ok) failed = true;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (failed) {
  console.error('\nFidelity harness FAILED');
  process.exit(1);
}
console.log('\nFidelity harness passed.');
