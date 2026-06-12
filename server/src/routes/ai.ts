import type { FastifyInstance } from 'fastify';
import { aiStatus, isAuthenticated, startLogin } from '../services/ai/aiCall.js';
import { findSoffice, findPdftotext, resetSofficeCache, convertToPdf } from '../services/convert.js';
import { db, getSetting, setSetting } from '../db.js';
import { AI_LOGS_DIR, STORAGE, RESTORE_DIR } from '../paths.js';
import { settingsBody, type SettingsBody } from './bodySchemas.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export default async function aiRoutes(app: FastifyInstance) {
  app.get('/api/ai/status', async () => {
    const [ai, soffice, pdftotext] = await Promise.all([aiStatus(), findSoffice(), findPdftotext()]);
    return { ...ai, soffice: !!soffice, sofficePath: soffice, pdftotext: !!pdftotext };
  });

  app.post('/api/ai/login', async () => startLogin());

  // polled every few seconds during sign-in — keep it to ONE child process
  app.get('/api/ai/login/status', async () => ({ authenticated: await isAuthenticated() }));

  app.get('/api/settings', () => ({
    ai_model: getSetting('ai_model', ''),
    ai_reasoning: getSetting('ai_reasoning', ''),
    openai_api_key: getSetting('openai_api_key') ? '••••' : '',
    soffice_path: getSetting('soffice_path'),
    export_pattern: getSetting('export_pattern', '{Name}_Resume_{Company}'),
    allow_new_bullets: getSetting('allow_new_bullets', '1'),
    max_new_bullets: getSetting('max_new_bullets', '2'),
    aggressive_trimming: getSetting('aggressive_trimming', '0'),
    ai_logs_dir: AI_LOGS_DIR,
    storage_dir: STORAGE,
  }));

  app.patch<{ Body: SettingsBody }>('/api/settings', { schema: { body: settingsBody } }, (req) => {
    // the body schema strips unknown keys (AJV removeAdditional), so every
    // entry here is a known setting
    for (const [key, value] of Object.entries(req.body ?? {})) {
      if (typeof value === 'string') setSetting(key, value);
    }
    if (req.body?.soffice_path !== undefined) resetSofficeCache();
    return { ok: true };
  });

  /** "Test conversion" button: round-trip a tiny doc through soffice. */
  app.post('/api/settings/test-conversion', async (_req, reply) => {
    const soffice = await findSoffice();
    if (!soffice) return reply.code(400).send({ ok: false, error: 'LibreOffice (soffice) not found' });
    // build a minimal docx in tmp and convert it
    const JSZip = (await import('jszip')).default;
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
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Tailr conversion test</w:t></w:r></w:p></w:body></w:document>`,
    );
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

  /**
   * Restore: stage an uploaded backup zip; it is applied at next boot
   * (db.ts swaps app.db + storage/ in before opening the database).
   */
  app.post('/api/settings/restore', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No backup zip uploaded' });
    const buf: Buffer = await file.toBuffer();
    const JSZip = (await import('jszip')).default;
    let zip;
    try {
      zip = await JSZip.loadAsync(buf);
    } catch {
      return reply.code(400).send({ error: 'Not a valid zip file' });
    }
    const names = Object.keys(zip.files);
    if (!names.includes('app.db') && !names.some((n) => n.startsWith('storage/'))) {
      return reply
        .code(400)
        .send({ error: 'Zip does not look like a Tailr backup (no app.db or storage/)' });
    }
    fs.rmSync(RESTORE_DIR, { recursive: true, force: true });
    fs.mkdirSync(RESTORE_DIR, { recursive: true });
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      // zip-slip guard: resolve inside RESTORE_DIR only
      const dest = path.join(RESTORE_DIR, name);
      if (!dest.startsWith(RESTORE_DIR + path.sep)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, await entry.async('nodebuffer'));
    }
    return { ok: true, requiresRestart: true };
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
    reply.header(
      'Content-Disposition',
      `attachment; filename="tailr-backup-${new Date().toISOString().slice(0, 10)}.zip"`,
    );
    reply.type('application/zip');
    return buf;
  });
}
