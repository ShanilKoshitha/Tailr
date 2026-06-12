/** REST API request/response shapes (what the client actually receives). */

import type { JdAnalysis, Suggestion } from './ai.js';
import type { Edit, ResumeModel } from './docx.js';
import type { MatchReport } from './scoring.js';

export interface Stage {
  id: string;
  board_id: string;
  name: string;
  position: number;
  color: string | null;
  is_terminal: number;
}

export interface Board {
  id: string;
  name: string;
  created_at: number;
  stages: Stage[];
}

export type ActivityType = 'applied' | 'interview' | 'follow_up' | 'note' | 'stage_change' | 'export';

export interface Activity {
  id: string;
  job_id: string;
  type: ActivityType;
  title: string;
  body: string;
  due_at: number | null;
  done: number;
  created_at: number;
}

export interface Contact {
  id: string;
  job_id: string;
  name: string;
  role: string;
  email: string;
  linkedin: string;
  notes: string;
}

export interface TailoredSummary {
  id: string;
  match_score_before: number | null;
  match_score_after: number | null;
  status: 'draft' | 'finalized';
}

/** A job card as returned by GET /api/jobs (hydrated with derived fields). */
export interface Job {
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
  jd_analysis: JdAnalysis | null;
  color: string | null;
  is_archived: number;
  stage_entered_at: number | null;
  created_at: number;
  updated_at: number;
  latest_tailored: TailoredSummary | null;
  overdue_count: number;
}

export interface JobDetail extends Job {
  activities: Activity[];
  contacts: Contact[];
  tailored: Array<
    TailoredSummary & {
      resume_name: string;
      created_at: number;
    }
  >;
}

export interface Resume {
  id: string;
  name: string;
  is_base: number;
  page_count: number | null;
  created_at: number;
}

/** One accepted edit in the tailored resume's append-only log. */
export interface EditLogEntry {
  /** Null for manual edits made outside a suggestion card. */
  suggestionId: string | null;
  edit: Edit;
  oldText?: string;
  acceptedAt: number;
  formattingFlattened?: boolean;
  /** Card snapshot so undo can restore it to the pending list. */
  suggestion?: Suggestion;
}

/** GET /api/tailored/:id — everything the Tailoring Studio needs. */
export interface StudioState {
  id: string;
  status: string;
  job: {
    id: string;
    title: string;
    company: string;
    jd_text: string;
    jd_analysis: JdAnalysis | null;
  };
  resume: { id: string; name: string; page_count: number | null };
  model: ResumeModel;
  effectiveModel: ResumeModel;
  suggestions: Suggestion[] | null;
  dismissed: string[];
  edits: EditLogEntry[];
  report: MatchReport | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
}

/** GET /api/ai/status — toolchain detection for the Settings page. */
export interface AiStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  model: string;
  reasoningEffort: string;
  usingApiKey: boolean;
  soffice: boolean;
  sofficePath: string | null;
  pdftotext: boolean;
}

export interface ParaBox {
  paraId: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Paragraph → PDF coordinates map for preview hover overlays. */
export interface BboxMap {
  pageSizes: Array<{ page: number; width: number; height: number }>;
  boxes: ParaBox[];
}

export interface SettingsDto {
  ai_model: string;
  ai_reasoning: string;
  openai_api_key: string;
  soffice_path: string;
  export_pattern: string;
  allow_new_bullets: string;
  max_new_bullets: string;
  aggressive_trimming: string;
  ai_logs_dir: string;
  storage_dir: string;
}
