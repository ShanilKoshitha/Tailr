import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { newId, now } from '../ids.js';
import { RESUMES_DIR } from '../paths.js';
import { parseDocx } from '../docx/parse.js';
import { convertToPdf, pdfPageCount, buildBboxMap } from '../services/convert.js';
import { broadcast } from '../sse.js';

export default async function resumesRoutes(app: FastifyInstance) {
  app.get('/api/resumes', () =>
    db.prepare('SELECT id, name, is_base, page_count, created_at FROM resumes ORDER BY created_at DESC').all());

  app.post('/api/resumes', async (req, reply) => {
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: 'No file uploaded' });
    const filename: string = file.filename ?? 'resume.docx';
    if (!/\.docx$/i.test(filename)) {
      // PRD §6.2 PDF policy: explicit explainer for non-docx uploads
      return reply.code(400).send({
        error: 'pdf_rejected',
        message: 'Tailoring requires the editable DOCX so your formatting can be preserved. Export your resume as .docx and re-upload.',
      });
    }
    const buf: Buffer = await file.toBuffer();
    if (buf.length > 10 * 1024 * 1024) return reply.code(400).send({ error: 'Max file size is 10 MB' });

    const id = newId('res');
    const dir = path.join(RESUMES_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    const docxPath = path.join(dir, 'original.docx');
    fs.writeFileSync(docxPath, buf);

    let model;
    try {
      ({ model } = await parseDocx(buf));
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      return reply.code(400).send({ error: `Could not parse this DOCX: ${(e as Error).message}` });
    }
    const modelPath = path.join(dir, 'model.json');
    fs.writeFileSync(modelPath, JSON.stringify(model, null, 1));

    db.prepare('INSERT INTO resumes (id, name, file_path, model_json_path, is_base, page_count, created_at) VALUES (?, ?, ?, ?, 1, NULL, ?)')
      .run(id, filename.replace(/\.docx$/i, ''), docxPath, modelPath, now());

    // preview + page count in background; SSE notifies when ready
    void (async () => {
      const pdf = await convertToPdf(docxPath);
      if (pdf) {
        const pages = pdfPageCount(pdf);
        if (pages) db.prepare('UPDATE resumes SET page_count = ? WHERE id = ?').run(pages, id);
        const bbox = await buildBboxMap(pdf, model).catch(() => null);
        fs.writeFileSync(path.join(dir, 'bbox.json'), JSON.stringify(bbox));
        broadcast('preview.updated', { resumeId: id });
      }
    })();

    return {
      resume: { id, name: filename.replace(/\.docx$/i, ''), page_count: null },
      model: { paragraphs: model.paragraphs.length, entries: model.entries.length, sections: Object.keys(model.sections) },
    };
  });

  app.get<{ Params: { id: string } }>('/api/resumes/:id/model', (req, reply) => {
    const r = db.prepare('SELECT model_json_path FROM resumes WHERE id = ?').get(req.params.id) as any;
    if (!r) return reply.code(404).send({ error: 'not found' });
    reply.type('application/json');
    return fs.readFileSync(r.model_json_path, 'utf8');
  });

  app.get<{ Params: { id: string } }>('/api/resumes/:id/preview.pdf', (req, reply) => {
    const r = db.prepare('SELECT file_path FROM resumes WHERE id = ?').get(req.params.id) as any;
    if (!r) return reply.code(404).send({ error: 'not found' });
    const pdf = r.file_path.replace(/original\.docx$/, 'original.pdf');
    if (!fs.existsSync(pdf)) return reply.code(404).send({ error: 'preview not generated (is LibreOffice installed?)' });
    reply.type('application/pdf');
    return fs.createReadStream(pdf);
  });

  app.get<{ Params: { id: string } }>('/api/resumes/:id/bbox', (req, reply) => {
    const r = db.prepare('SELECT file_path FROM resumes WHERE id = ?').get(req.params.id) as any;
    if (!r) return reply.code(404).send({ error: 'not found' });
    const p = path.join(path.dirname(r.file_path), 'bbox.json');
    if (!fs.existsSync(p)) return { bbox: null };
    return { bbox: JSON.parse(fs.readFileSync(p, 'utf8')) };
  });

  app.delete<{ Params: { id: string } }>('/api/resumes/:id', (req, reply) => {
    const used = (db.prepare('SELECT COUNT(*) c FROM tailored_resumes WHERE resume_id = ?').get(req.params.id) as any).c;
    if (used > 0) return reply.code(400).send({ error: 'This resume has tailored versions; delete those jobs first.' });
    const r = db.prepare('SELECT file_path FROM resumes WHERE id = ?').get(req.params.id) as any;
    if (r) fs.rmSync(path.dirname(r.file_path), { recursive: true, force: true });
    db.prepare('DELETE FROM resumes WHERE id = ?').run(req.params.id);
    return { ok: true };
  });
}
