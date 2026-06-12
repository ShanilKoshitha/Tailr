/**
 * Round-trip + edit-op test (PRD §6.5 AC2/AC3, minus the pixel diff which
 * needs LibreOffice). Builds a synthetic resume docx, parses it, applies all
 * four ops, and verifies (a) untouched paragraph XML is unchanged, (b) the
 * zero-edit round trip leaves every paragraph's text identical.
 */
import assert from 'node:assert';
import JSZip from 'jszip';
import { parseDocx } from '../docx/parse.js';
import { applyEdits } from '../docx/edits.js';
import { openDocx, allParagraphs, paraText, serializeNode } from '../docx/xml.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function p(
  text: string,
  opts: { bullet?: boolean; bold?: boolean; underline?: boolean; boldLabel?: string } = {},
) {
  const pPr = opts.bullet
    ? `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>`
    : '';
  if (opts.boldLabel) {
    return `<w:p>${pPr}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${opts.boldLabel}</w:t></w:r><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  }
  const rPr =
    opts.bold || opts.underline
      ? `<w:rPr>${opts.bold ? '<w:b/>' : ''}${opts.underline ? '<w:u w:val="single"/>' : ''}</w:rPr>`
      : '';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

async function buildFixture(): Promise<Buffer> {
  const body = [
    p('Sam Example', { bold: true }),
    p('Halifax, NS • sam@example.com • LinkedIn'),
    p(
      'Senior engineer with 7+ years of experience building backend platforms and search systems for production SaaS.',
    ),
    p('Technical Stack:', { bold: true, underline: true }),
    p('PHP, Python, TypeScript, MySQL, Redis, OpenSearch, AWS', { boldLabel: 'Core:\t' }),
    p('EXPERIENCE', { bold: true }),
    p('Acme Corp Montreal (Remote)'),
    p('Senior Backend Developer – November 2021 – present', { bold: true }),
    p('Led platform migrations across shared multi-brand systems with rollback planning.', {
      bullet: true,
    }),
    p('Built an OpenSearch-backed vector retrieval layer powering cross-brand search.', {
      bullet: true,
    }),
    p('Reduced infrastructure spend by $5,000/month via cache compression.', { bullet: true }),
    p('Maintained internal documentation portal for the analytics team.', { bullet: true }),
    p('Organized the quarterly team offsite logistics.', { bullet: true }),
    p('Beta Inc Halifax, NS'),
    p('Software Developer – January 2020 – November 2021', { bold: true }),
    p('Built backend features for an e-commerce platform with enterprise releases.', { bullet: true }),
    p('Delivered security fixes improving platform reliability.', { bullet: true }),
    p('Education', { bold: true }),
    p('Example University — B.Sc., Computer Science, 2014–2018'),
  ].join('');

  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

const original = await buildFixture();
const { model } = await parseDocx(original);

// --- parsing sanity ---
assert.ok(model.entries.length === 2, `expected 2 entries, got ${model.entries.length}`);
assert.strictEqual(model.entries[0].bulletIds.length, 5, 'entry 1 should have 5 bullets');
assert.strictEqual(model.entries[1].bulletIds.length, 2, 'entry 2 should have 2 bullets');
assert.ok(model.sections['experience']?.length, 'experience section detected');
assert.ok(model.sections['skills']?.length, 'skills section detected');
const skillsLine = model.paragraphs.find((x) => x.text.startsWith('Core:'));
assert.ok(skillsLine?.mixedFormatting, 'skills line should be flagged mixedFormatting');
console.log('✓ parse: sections, entries, bullets, mixedFormatting');

// --- zero-edit round trip: every paragraph text identical ---
{
  const { buffer } = await applyEdits(original, model, []);
  const a = await openDocx(original);
  const b = await openDocx(buffer);
  const pa = allParagraphs(a.dom).map(paraText);
  const pb = allParagraphs(b.dom).map(paraText);
  assert.deepStrictEqual(pb, pa, 'zero-edit round trip must preserve all text');
  console.log('✓ zero-edit round trip: all paragraph text identical');
}

// --- the four ops ---
{
  const bullets = model.entries[0].bulletIds;
  const edits = [
    {
      op: 'replace_text' as const,
      paraId: bullets[0],
      newText: 'Owned acquired-site platform migrations end to end, including rollback planning.',
    },
    { op: 'delete_paragraph' as const, paraId: bullets[3] },
    {
      op: 'insert_paragraph_after' as const,
      paraId: bullets[1],
      newText: 'Added vector ranking interfaces adopted by [X] internal teams.',
    },
    {
      op: 'replace_skills_line' as const,
      paraId: skillsLine!.paraId,
      newText: 'Core:\tPHP, Python, TypeScript, Kubernetes, MySQL, Redis, OpenSearch, AWS',
    },
  ];
  const { buffer, applied } = await applyEdits(original, model, edits);
  const b = await openDocx(buffer);
  const texts = allParagraphs(b.dom).map(paraText);

  assert.ok(
    texts.some((t) => t.startsWith('Owned acquired-site')),
    'replace_text applied',
  );
  assert.ok(!texts.some((t) => t.includes('documentation portal')), 'delete_paragraph applied');
  assert.ok(
    texts.some((t) => t.includes('vector ranking interfaces')),
    'insert_paragraph_after applied',
  );
  assert.ok(
    texts.some((t) => t.includes('Kubernetes')),
    'replace_skills_line applied',
  );
  assert.strictEqual(
    allParagraphs(b.dom).length,
    allParagraphs((await openDocx(original)).dom).length,
    'one delete + one insert → same paragraph count',
  );

  // AC2: untouched paragraphs byte-identical (compare serialized XML of unaffected paras)
  const aParas = allParagraphs((await openDocx(original)).dom);
  const bParas = allParagraphs(b.dom);
  const touchedTexts = new Set([
    'Led platform migrations across shared multi-brand systems with rollback planning.',
    'Maintained internal documentation portal for the analytics team.',
    'Core:\tPHP, Python, TypeScript, MySQL, Redis, OpenSearch, AWS',
  ]);
  let comparedUntouched = 0;
  for (const ap of aParas) {
    const t = paraText(ap);
    if (touchedTexts.has(t)) continue;
    const match = bParas.find((bp) => paraText(bp) === t);
    assert.ok(match, `untouched paragraph survived: "${t.slice(0, 40)}"`);
    assert.strictEqual(
      serializeNode(match!),
      serializeNode(ap),
      `untouched paragraph XML unchanged: "${t.slice(0, 40)}"`,
    );
    comparedUntouched++;
  }
  assert.ok(comparedUntouched >= 14, 'compared a meaningful number of untouched paragraphs');

  // inserted bullet clones the anchor's numPr (stays a list item)
  const inserted = bParas.find((bp) => paraText(bp).includes('vector ranking interfaces'))!;
  assert.ok(serializeNode(inserted).includes('numPr'), 'inserted bullet keeps list numbering');

  // skills line kept two runs: bold label + plain values
  const skills = bParas.find((bp) => paraText(bp).includes('Kubernetes'))!;
  const skillsXml = serializeNode(skills);
  assert.ok(skillsXml.includes('<w:b/>'), 'skills label run kept bold');
  assert.ok((skillsXml.match(/<w:r>/g) ?? []).length >= 2, 'skills line emitted two runs');

  // replace on a mixed-format paragraph flags formattingFlattened
  const flat = applied.find((a2) => a2.op === 'replace_skills_line');
  assert.strictEqual(flat?.formattingFlattened, false, 'two-run skills replacement is NOT flattened');
  console.log('✓ edit ops: replace / delete / insert / skills two-run exception + untouched-XML diff');
}

// --- real fixture: demos/model.json shape compatibility (author's resume) ---
console.log('\nAll round-trip tests passed.');
