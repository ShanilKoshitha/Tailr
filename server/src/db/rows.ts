/**
 * Row shapes as stored in SQLite — the one place the database schema is
 * expressed in types. Queries cast to these at the call site (better-sqlite3
 * is untyped by design); JSON columns are strings here and parsed at the edge.
 */

export interface BoardRow {
  id: string;
  name: string;
  created_at: number;
}

export interface StageRow {
  id: string;
  board_id: string;
  name: string;
  position: number;
  color: string | null;
  is_terminal: number;
}

export interface JobRow {
  id: string;
  board_id: string;
  stage_id: string;
  position: number;
  title: string;
  company: string;
  location: string;
  url: string;
  salary: string;
  post_date: string;
  jd_text: string;
  /** JSON-serialized JdAnalysis, or null before analysis. */
  jd_analysis: string | null;
  color: string | null;
  is_archived: number;
  stage_entered_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ActivityRow {
  id: string;
  job_id: string;
  type: string;
  title: string;
  body: string;
  due_at: number | null;
  done: number;
  created_at: number;
}

export interface ContactRow {
  id: string;
  job_id: string;
  name: string;
  role: string;
  email: string;
  linkedin: string;
  notes: string;
}

export interface ResumeRow {
  id: string;
  name: string;
  file_path: string;
  model_json_path: string;
  is_base: number;
  page_count: number | null;
  created_at: number;
}

export interface TailoredRow {
  id: string;
  resume_id: string;
  job_id: string;
  file_path: string;
  edits_json_path: string;
  match_score_before: number | null;
  match_score_after: number | null;
  status: string;
  /** JSON-serialized Suggestion[], or null before the first AI Tailor run. */
  suggestions: string | null;
  /** JSON-serialized string[] of dismissed suggestion fingerprints. */
  dismissed: string;
  created_at: number;
  updated_at: number;
}

export interface MatchReportRow {
  id: string;
  tailored_id: string;
  /** JSON-serialized MatchReport. */
  report: string;
  created_at: number;
}
