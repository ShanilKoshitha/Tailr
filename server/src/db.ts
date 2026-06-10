import Database from 'better-sqlite3';
import { DB_PATH } from './paths.js';
import { newId, now } from './ids.js';

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id),
  name TEXT NOT NULL, position INTEGER NOT NULL,
  color TEXT, is_terminal INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id),
  stage_id TEXT NOT NULL REFERENCES stages(id),
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '',
  location TEXT DEFAULT '', url TEXT DEFAULT '', salary TEXT DEFAULT '',
  post_date TEXT DEFAULT '',
  jd_text TEXT DEFAULT '',
  jd_analysis TEXT,                 -- JSON, cached jd.analyze output
  color TEXT, is_archived INTEGER NOT NULL DEFAULT 0,
  stage_entered_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id),
  type TEXT NOT NULL,               -- applied|interview|follow_up|note|stage_change|export
  title TEXT NOT NULL, body TEXT DEFAULT '',
  due_at INTEGER, done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id),
  name TEXT NOT NULL, role TEXT DEFAULT '', email TEXT DEFAULT '',
  linkedin TEXT DEFAULT '', notes TEXT DEFAULT '');

CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  file_path TEXT NOT NULL, model_json_path TEXT NOT NULL,
  is_base INTEGER NOT NULL DEFAULT 1, page_count INTEGER,
  created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS tailored_resumes (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL REFERENCES resumes(id),
  job_id TEXT NOT NULL REFERENCES jobs(id),
  file_path TEXT NOT NULL, edits_json_path TEXT NOT NULL,
  match_score_before INTEGER, match_score_after INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | finalized
  suggestions TEXT,                       -- JSON: latest suggestion set
  dismissed TEXT NOT NULL DEFAULT '[]',   -- JSON: fingerprints of rejected suggestions
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS match_reports (
  id TEXT PRIMARY KEY,
  tailored_id TEXT NOT NULL REFERENCES tailored_resumes(id),
  report TEXT NOT NULL,             -- JSON
  created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

export const DEFAULT_STAGES = [
  { name: 'Wishlist', color: '#8b5cf6', is_terminal: 0 },
  { name: 'Applied', color: '#3b82f6', is_terminal: 0 },
  { name: 'Interview', color: '#f59e0b', is_terminal: 0 },
  { name: 'Offer', color: '#10b981', is_terminal: 0 },
  { name: 'Rejected', color: '#ef4444', is_terminal: 1 },
];

export function seedIfEmpty() {
  const board = db.prepare('SELECT id FROM boards LIMIT 1').get() as { id: string } | undefined;
  if (board) return;
  const boardId = newId('brd');
  db.prepare('INSERT INTO boards (id, name, created_at) VALUES (?, ?, ?)').run(boardId, 'Job Search 2026', now());
  const ins = db.prepare('INSERT INTO stages (id, board_id, name, position, color, is_terminal) VALUES (?, ?, ?, ?, ?, ?)');
  DEFAULT_STAGES.forEach((s, i) => ins.run(newId('stg'), boardId, s.name, i, s.color, s.is_terminal));
}

export function getSetting(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
