/**
 * Generates synthetic "exotic" resume fixtures into server/test-fixtures/:
 *  - table-resume.docx: two-column table layout (sidebar + main), the classic
 *    template style that breaks naive parsers (PRD §6.3 "mandatory, not edge").
 *  - plain-resume.docx: no headings, no bold, no section keywords — designed
 *    to defeat the heuristics and exercise the resume.classify AI fallback.
 * Synthetic data only — safe to commit. Run: npx tsx src/test/gen-fixtures.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', '..', 'test-fixtures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function p(text: string, o: { bullet?: boolean; bold?: boolean; u?: boolean } = {}) {
  const pPr = o.bullet ? `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` : '';
  const rPr = o.bold || o.u ? `<w:rPr>${o.bold ? '<w:b/>' : ''}${o.u ? '<w:u w:val="single"/>' : ''}</w:rPr>` : '';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

async function writeDocx(name: string, body: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(path.join(OUT_DIR, name), buf);
  console.log(`wrote ${path.join('test-fixtures', name)} (${buf.length} bytes)`);
}

// ---------- fixture 1: two-column table resume ----------
const cell = (paras: string, width: number) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paras}</w:tc>`;

const sidebar =
  p('Jordan Rivera', { bold: true }) +
  p('Toronto, ON • jordan@example.com') +
  p('Skills', { bold: true, u: true }) +
  p('Go, Rust, Kafka, gRPC, Terraform') +
  p('Education', { bold: true, u: true }) +
  p('B.Eng. Software — UToronto, 2012–2016');

const main =
  p('Experience', { bold: true, u: true }) +
  p('Northwind Systems Toronto') +
  p('Staff Engineer – March 2020 – present', { bold: true }) +
  p('Designed event-streaming backbone processing 40k msgs/sec on Kafka.', { bullet: true }) +
  p('Cut infra spend 30% by consolidating services onto spot fleets.', { bullet: true }) +
  p('Led migration of 14 services from REST to gRPC with zero downtime.', { bullet: true }) +
  p('Initrode Inc Waterloo') +
  p('Senior Developer – June 2016 – March 2020', { bold: true }) +
  p('Built Terraform modules adopted by 9 product teams.', { bullet: true }) +
  p('Owned CI pipeline reducing build times from 40 to 9 minutes.', { bullet: true });

const tableBody =
  `<w:tbl><w:tblPr><w:tblW w:w="10800" w:type="dxa"/></w:tblPr>` +
  `<w:tr>${cell(sidebar, 3600)}${cell(main, 7200)}</w:tr></w:tbl>` +
  p(''); // trailing body paragraph required after a table

// ---------- fixture 2: heading-less plain resume (defeats heuristics) ----------
const plainBody =
  p('Avery Chen') +
  p('avery.chen@example.com | Vancouver, BC') +
  p('Backend developer who enjoys turning messy data pipelines into boring, reliable ones.') +
  p('Meridian Analytics, Vancouver — 2021 to now') +
  p('Rebuilt the nightly ETL so it finishes before breakfast instead of lunch.', { bullet: true }) +
  p('Introduced contract tests that caught 12 breaking schema changes pre-release.', { bullet: true }) +
  p('Harbour Labs, Victoria — 2018 to 2021') +
  p('Shipped a billing service handling 200k invoices a month.', { bullet: true }) +
  p('Mentored two co-op students who both returned full-time.', { bullet: true }) +
  p('Python, SQL, dbt, Airflow, AWS') +
  p('Diploma, Computer Systems — BCIT, 2016 to 2018');

await writeDocx('table-resume.docx', tableBody);
await writeDocx('plain-resume.docx', plainBody);
console.log('fixtures generated.');
