/**
 * Validates the TS parser against the author's real resume (handoff item 4).
 * Reference behavior = demos/model.json, produced by the validated Python
 * prototype on this exact file. Run: npx tsx src/test/realresume.test.ts <path-to-docx>
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocx } from '../docx/parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const docxPath = process.argv[2] ?? path.join(ROOT, 'shanil-hewage.docx');
// demos/ holds personal data and is gitignored — present locally, absent on
// public clones. This test is a local-only regression check; skip without it.
const refPath = path.join(ROOT, 'demos', 'model.json');

if (!fs.existsSync(docxPath)) {
  console.log(`(skipped — no resume at ${docxPath})`);
  process.exit(0);
}
if (!fs.existsSync(refPath)) {
  console.log(`(skipped — no reference model at ${refPath})`);
  process.exit(0);
}

const { model } = await parseDocx(fs.readFileSync(docxPath));
const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));

// entries: same count, same bullet counts per entry
assert.strictEqual(
  model.entries.length,
  ref.entries.length,
  `entries: got ${model.entries.length}, reference ${ref.entries.length}`,
);
for (let i = 0; i < ref.entries.length; i++) {
  assert.strictEqual(
    model.entries[i].bulletIds.length,
    ref.entries[i].bulletIds.length,
    `entry ${i + 1} bullets: got ${model.entries[i].bulletIds.length}, ref ${ref.entries[i].bulletIds.length}`,
  );
}
console.log(`✓ ${model.entries.length} experience entries, bullet counts match reference`);

// paragraph kinds: compare against reference by idx for load-bearing kinds
interface RefParagraph {
  idx: number;
  text: string;
  kind: string;
}
const refById = new Map<number, RefParagraph>((ref.paragraphs as RefParagraph[]).map((p) => [p.idx, p]));
let kindMatches = 0,
  kindTotal = 0;
const IMPORTANT = new Set(['bullet', 'heading', 'entryHeader']);
for (const p of model.paragraphs) {
  const r = refById.get(p.idx);
  if (!r || !r.text) continue;
  if (IMPORTANT.has(r.kind) || IMPORTANT.has(p.kind)) {
    kindTotal++;
    if (p.kind === r.kind) kindMatches++;
    else console.log(`  kind drift @${p.idx}: ts=${p.kind} py=${r.kind} "${p.text.slice(0, 50)}"`);
  }
}
assert.strictEqual(
  kindMatches,
  kindTotal,
  'bullet/heading/entryHeader classification must match the prototype',
);
console.log(`✓ ${kindMatches}/${kindTotal} load-bearing paragraph kinds match the Python prototype`);

// sections present
const requiredSections = ['experience', 'skills', 'education'] as const;
for (const sec of requiredSections) {
  assert.ok(model.sections[sec]?.length, `section ${sec} detected`);
}
console.log(`✓ sections: ${Object.keys(model.sections).join(', ')}`);

// hyperlink header line must be flagged (it must never become an edit target)
const linkPara = model.paragraphs.find((p) => /LinkedIn/i.test(p.text) && p.idx <= 4);
assert.ok(linkPara?.hasHyperlink, 'contact line with LinkedIn/GitHub flagged hasHyperlink');
console.log('✓ contact hyperlink line flagged hasHyperlink (excluded from editing)');

// skills lines with bold labels flagged mixedFormatting → two-run replacement path
const skillsLines = model.paragraphs.filter((p) => p.section === 'skills' && p.kind === 'body');
assert.ok(skillsLines.length >= 4, `skills lines found (${skillsLines.length})`);
assert.ok(
  skillsLines.every((p) => p.mixedFormatting),
  'all skills label lines flagged mixedFormatting',
);
console.log(
  `✓ ${skillsLines.length} skills lines flagged mixedFormatting (two-run replacement applies)`,
);

console.log('\nReal-resume parse validation passed.');
