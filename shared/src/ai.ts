/** Outputs of the AI tasks (jd.analyze, match.score, tailor.suggest, …). */

import type { EditOp } from './docx.js';

export type ItemPriority = 'required' | 'preferred';
export type DutyPriority = 'primary' | 'secondary';
export type KeywordType = 'hard' | 'soft' | 'domain';
export type Verdict = 'covered' | 'partial' | 'missing';
export type TitleMatch = 'full' | 'adjacent' | 'distant';

export interface JdQualification {
  id: string;
  text: string;
  priority: ItemPriority;
}

export interface JdResponsibility {
  id: string;
  text: string;
  priority: DutyPriority;
}

export interface JdKeyword {
  id: string;
  text: string;
  type: KeywordType;
}

/** Output of jd.analyze, cached on the job row. */
export interface JdAnalysis {
  titleEssence: string;
  qualifications: JdQualification[];
  responsibilities: JdResponsibility[];
  keywords: JdKeyword[];
}

export interface VerdictItem {
  itemId: string;
  verdict: Verdict;
  evidenceParaIds?: string[];
  explanation?: string;
  suggestionHint?: string;
}

/** Output of match.score — verdicts only; all arithmetic is app code. */
export interface MatchVerdicts {
  titleMatch: TitleMatch;
  items: VerdictItem[];
}

/** One reviewable suggestion card produced by tailor.suggest. */
export interface Suggestion {
  id: string;
  op: EditOp;
  paraId: string;
  entryId?: string | null;
  newText: string;
  oldText?: string;
  /** JD item ids this edit satisfies; drives optimistic re-scoring. */
  itemsCovered?: string[];
  rationale?: string;
  /** True when the text asserts something not present in the resume. */
  assumptionFlag?: boolean;
  lineDelta?: number;
}

/** Output of resume.classify (AI fallback when heuristics fail). */
export interface ClassifiedPara {
  paraId: string;
  kind: string;
  section: string;
  entryId?: string | null;
}
