import type { FastifyInstance } from 'fastify';
import { aiStatus, startLogin } from '../services/ai/aiCall.js';
import { findSoffice, findPdftotext, resetSofficeCache, convertToPdf } from '../services/convert.js';
import { db, getSetting, setSetting } from '../db.js';
import { AI_LOGS_DIR, STORAGE } from '../paths.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export default async function aiRoutes(app: FastifyInstance) {
  app.get('/api/ai/status', async () => {
    const [ai, soffice, pdftotext] = await Promise.all([aiStatus(), findSoffice(), findPdftotext()]);
    return { ...ai, soffice: !!soffice, sofficePath: soffice, pdftotext: !!pdftotext };
  });

  app.post('/api/ai/login', async () => startLogin());

  app.get('/api/ai/login/status', async () => {
    const s = await aiStatus();
    return { authenticated: s.authenticated };
  });

  app.get('/api/settings', () => ({
    ai_model: getSetting('ai_model', 'gpt-5-codex'),
    ai_reasoning: getSetting('ai_reasoning', 'medium'),
    openai_api_key: getSetting('openai_api_key') ? '••••' : '',
    soffice_path: getSetting('soffice_path'),
    export_pattern: getSetting('export_pattern', '{Name}_Resume_{Company}'),
    allow_new_bullets: getSetting('allow_new_bullets', '1'),
    max_new_bullets: getSetting('max_new_bullets', '2'),
    aggressive_trimming: getSetting('aggressive_trimming', '0'),
    ai_logs_dir: AI_LOGS_DIR,
    storage_dir: STORAGE,
  }));

  app.patch<{ Body: Record<string, string> }>('/api/settings', (req) => {
    const allowed = ['ai_model', 'ai_reasoning', 'openai_api_key', 'soffice_path', 'export_pattern',
      'allow_new_bullets', 'max_new_bullets', 'aggressive_trimming'];
    for (const [k, v] of Object.entries((req.body ?? {}) as any)) {
      if (allowed.includes(k) && typeof v === 'string') setSetting(k, v);
    }
    if ('soffice_path' in ((req.body ?? {}) as any)) resetSofficeCache();
    return { ok: true };
  });

  /** "Test conversion" button: round-trip a tiny doc through soffice. */
  app.post('/api/settings/test-conversion', async (_req, reply) => {
    const soffice = await findSoffice();
    if (!soffice) return reply.code(400).send({ ok: false, error: 'LibreOffice (soffice) not found' });
    // build a minimal docx in tmp and convert it
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Tailr conversion test</w:t></w:r></w:p></w:body></w:document>`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tailr-test-'));
    const docx = path.join(tmp, 'test.docx');
    fs.writeFileSync(docx, await zip.generateAsync({ type: 'nodebuffer' }));
    try {
      const pdf = await convertToPdf(docx, tmp);
      return { ok: !!pdf };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  /** Backup: zip storage + db (PRD §11). */
  app.post('/api/settings/backup', async (_req, reply) => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const addDir = (dir: string, prefix: string) => {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) addDir(p, `${prefix}${f.name}/`);
        else zip.file(`${prefix}${f.name}`, fs.readFileSync(p));
      }
    };
    addDir(STORAGE, 'storage/');
    const dbPath = path.join(path.dirname(STORAGE), 'app.db');
    if (fs.existsSync(dbPath)) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      zip.file('app.db', fs.readFileSync(dbPath));
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    reply.header('Content-Disposition', `attachment; filename="tailr-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
    reply.type('application/zip');
    return buf;
  });
}
