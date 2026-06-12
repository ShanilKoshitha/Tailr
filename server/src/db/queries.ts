/**
 * Typed query helpers for rows fetched in more than one place. One-off
 * queries stay at their call site (still cast to a row type from rows.ts).
 */
import { db } from '../db.js';
import type { ActivityRow, ContactRow, JobRow, ResumeRow, StageRow, TailoredRow } from './rows.js';

export function getJob(id: string): JobRow | undefined {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
}

export function getStage(id: string): StageRow | undefined {
  return db.prepare('SELECT * FROM stages WHERE id = ?').get(id) as StageRow | undefined;
}

export function listStages(boardId: string): StageRow[] {
  return db
    .prepare('SELECT * FROM stages WHERE board_id = ? ORDER BY position')
    .all(boardId) as StageRow[];
}

export function getResume(id: string): ResumeRow | undefined {
  return db.prepare('SELECT * FROM resumes WHERE id = ?').get(id) as ResumeRow | undefined;
}

export function getTailoredRow(id: string): TailoredRow | undefined {
  return db.prepare('SELECT * FROM tailored_resumes WHERE id = ?').get(id) as TailoredRow | undefined;
}

export function listActivities(jobId: string): ActivityRow[] {
  return db
    .prepare('SELECT * FROM activities WHERE job_id = ? ORDER BY created_at DESC')
    .all(jobId) as ActivityRow[];
}

export function listContacts(jobId: string): ContactRow[] {
  return db.prepare('SELECT * FROM contacts WHERE job_id = ?').all(jobId) as ContactRow[];
}

/** Persist updated suggestions JSON on a tailored resume. */
export function saveSuggestions(tailoredId: string, suggestions: unknown, updatedAt: number) {
  db.prepare('UPDATE tailored_resumes SET suggestions = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(suggestions),
    updatedAt,
    tailoredId,
  );
}
