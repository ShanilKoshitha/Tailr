/**
 * Deterministic Job Match Score math (PRD §7.3). The LLM returns verdicts;
 * ALL arithmetic happens here so the score is reproducible.
 */
import type { JdAnalysis, MatchVerdicts } from './ai/tasks.js';

export interface ComponentScore { score: number; weight: number; covered: number; partial: number; missing: number; total: number }
export interface MatchReport {
  total: number;            // 0–100
  band: 'Great' | 'Good' | 'Fair' | 'Weak' | 'Poor';
  components: {
    qualifications: ComponentScore;
    responsibilities: ComponentScore;
    keywords: ComponentScore;
    title: ComponentScore;
  };
  verdicts: MatchVerdicts;
  jd: JdAnalysis;
}

const VERDICT_VALUE = { covered: 1.0, partial: 0.5, missing: 0 } as const;

export function band(total: number): MatchReport['band'] {
  if (total >= 85) return 'Great';
  if (total >= 70) return 'Good';
  if (total >= 50) return 'Fair';
  if (total >= 30) return 'Weak';
  return 'Poor';
}

export function computeScore(jd: JdAnalysis, verdicts: MatchVerdicts): MatchReport {
  const vmap = new Map(verdicts.items.map((i) => [i.itemId, i.verdict]));

  function component(items: Array<{ id: string }>, weightOf: (item: any) => number): ComponentScore {
    let num = 0, den = 0, covered = 0, partial = 0, missing = 0;
    for (const item of items) {
      const w = weightOf(item);
      const v = vmap.get(item.id) ?? 'missing';
      num += VERDICT_VALUE[v] * w;
      den += w;
      if (v === 'covered') covered++;
      else if (v === 'partial') partial++;
      else missing++;
    }
    return { score: den ? num / den : 1, weight: 0, covered, partial, missing, total: items.length };
  }

  // required quals & primary responsibilities weigh 2× their siblings
  const quals = component(jd.qualifications, (q) => (q.priority === 'required' ? 2 : 1));
  const resps = component(jd.responsibilities, (r) => (r.priority === 'primary' ? 2 : 1));
  const keys = component(jd.keywords, () => 1);
  const titleScore = verdicts.titleMatch === 'full' ? 1 : verdicts.titleMatch === 'adjacent' ? 0.5 : 0;
  const title: ComponentScore = { score: titleScore, weight: 10, covered: titleScore === 1 ? 1 : 0, partial: titleScore === 0.5 ? 1 : 0, missing: titleScore === 0 ? 1 : 0, total: 1 };

  quals.weight = 35; resps.weight = 30; keys.weight = 25;
  const total = Math.round(quals.score * 35 + resps.score * 30 + keys.score * 25 + titleScore * 10);

  return {
    total,
    band: band(total),
    components: { qualifications: quals, responsibilities: resps, keywords: keys, title },
    verdicts,
    jd,
  };
}

/**
 * Optimistic re-score: accepting a suggestion flips its itemsCovered verdicts
 * to covered (client mirrors this; server recomputes authoritative score).
 */
export function applyOptimisticCoverage(report: MatchReport, itemsCovered: string[]): MatchReport {
  const verdicts: MatchVerdicts = {
    titleMatch: report.verdicts.titleMatch,
    items: report.verdicts.items.map((i) =>
      itemsCovered.includes(i.itemId) ? { ...i, verdict: 'covered' as const } : i,
    ),
  };
  return computeScore(report.jd, verdicts);
}
