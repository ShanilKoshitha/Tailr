export interface Stage { id: string; board_id: string; name: string; position: number; color: string | null; is_terminal: number }
export interface Board { id: string; name: string; created_at: number; stages: Stage[] }

export interface JdItem { id: string; text: string; priority?: string; type?: string }
export interface JdAnalysis {
  titleEssence: string;
  qualifications: JdItem[];
  responsibilities: JdItem[];
  keywords: JdItem[];
}

export interface Job {
  id: string; board_id: string; stage_id: string; position: number;
  title: string; company: string; location: string; url: string; salary: string;
  post_date: string; jd_text: string; jd_analysis: JdAnalysis | null;
  color: string | null; is_archived: number; stage_entered_at: number | null;
  created_at: number; updated_at: number;
  latest_tailored: { id: string; match_score_before: number | null; match_score_after: number | null; status: string } | null;
  overdue_count: number;
}

export interface Activity { id: string; job_id: string; type: string; title: string; body: string; due_at: number | null; done: number; created_at: number }
export interface Contact { id: string; job_id: string; name: string; role: string; email: string; linkedin: string; notes: string }

export interface JobDetail extends Job {
  activities: Activity[];
  contacts: Contact[];
  tailored: Array<{ id: string; resume_name: string; match_score_before: number | null; match_score_after: number | null; status: string; created_at: number }>;
}

export interface Resume { id: string; name: string; is_base: number; page_count: number | null; created_at: number }

export interface ModelParagraph {
  paraId: string; idx: number; text: string; kind: string; section: string;
  entryId: string | null; isBullet: boolean; inTable: boolean; hasHyperlink: boolean; mixedFormatting: boolean;
}
export interface ResumeModel {
  paragraphs: ModelParagraph[];
  entries: Array<{ entryId: string; headerId: string; title: string; company: string; bulletIds: string[] }>;
  sections: Record<string, string[]>;
}

export interface Suggestion {
  id: string;
  op: 'replace_text' | 'insert_paragraph_after' | 'delete_paragraph' | 'replace_skills_line';
  paraId: string; entryId?: string | null;
  newText: string; oldText?: string;
  itemsCovered?: string[]; rationale?: string;
  assumptionFlag?: boolean; lineDelta?: number;
}

export interface VerdictItem {
  itemId: string; verdict: 'covered' | 'partial' | 'missing';
  evidenceParaIds?: string[]; explanation?: string; suggestionHint?: string;
}
export interface ComponentScore { score: number; weight: number; covered: number; partial: number; missing: number; total: number }
export interface MatchReport {
  total: number; band: string;
  components: { qualifications: ComponentScore; responsibilities: ComponentScore; keywords: ComponentScore; title: ComponentScore };
  verdicts: { titleMatch: string; items: VerdictItem[] };
  jd: JdAnalysis;
}

export interface EditLogEntry {
  suggestionId: string | null;
  edit: { op: Suggestion['op']; paraId: string; newText?: string };
  oldText?: string; acceptedAt: number; formattingFlattened?: boolean;
}

export interface StudioState {
  id: string; status: string;
  job: { id: string; title: string; company: string; jd_text: string; jd_analysis: JdAnalysis | null };
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

export interface AiStatus {
  installed: boolean; version: string | null; authenticated: boolean;
  model: string; reasoningEffort: string; usingApiKey: boolean;
  soffice: boolean; sofficePath: string | null; pdftotext: boolean;
}

export interface BboxMap {
  pageSizes: Array<{ page: number; width: number; height: number }>;
  boxes: Array<{ paraId: string; page: number; x: number; y: number; w: number; h: number }>;
}
