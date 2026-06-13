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
  const dirs = [STORAGE, RESUMES_DIR, TAILORED_DIR, AITMP_DIR, AI_LOGS_DIR];
  // codex errors out ("Error loading configuration") when CODEX_HOME points
  // at a missing directory — the Docker image stores it on the /data volume,
  // so create it at boot (also heals volumes created by older images)
  if (process.env.CODEX_HOME) dirs.push(process.env.CODEX_HOME);
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
  }
}
