import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (server/src -> server -> root) */
export const ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = process.env.TAILR_DATA_DIR ?? ROOT;
export const DB_PATH = path.join(DATA_DIR, 'app.db');
export const STORAGE = path.join(DATA_DIR, 'storage');
export const RESUMES_DIR = path.join(STORAGE, 'resumes');
export const TAILORED_DIR = path.join(STORAGE, 'tailored');
export const AITMP_DIR = path.join(STORAGE, 'aitmp');
export const AI_LOGS_DIR = path.join(DATA_DIR, 'logs', 'ai');
export const RESTORE_DIR = path.join(DATA_DIR, 'restore-pending');
export const CLIENT_DIST = path.join(ROOT, 'client', 'dist');

export function ensureDirs() {
  for (const d of [STORAGE, RESUMES_DIR, TAILORED_DIR, AITMP_DIR, AI_LOGS_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
