/** The deterministic Job Match Score report (computed server-side). */

import type { JdAnalysis, MatchVerdicts } from './ai.js';

export type ScoreBand = 'Great' | 'Good' | 'Fair' | 'Weak' | 'Poor';

export interface ComponentScore {
  /** 0–1 weighted mean of item verdicts within this component. */
  score: number;
  /** Contribution weight toward the 0–100 total (35/30/25/10). */
  weight: number;
  covered: number;
  partial: number;
  missing: number;
  total: number;
}

export interface MatchReport {
  total: number;
  band: ScoreBand;
  components: {
    qualifications: ComponentScore;
    responsibilities: ComponentScore;
    keywords: ComponentScore;
    title: ComponentScore;
  };
  verdicts: MatchVerdicts;
  jd: JdAnalysis;
}
