import type { MatchReport, Verdict } from '../../types';
import { Button, Chip, EmptyState, toast } from '../ui';

const CHIP_TONE: Record<Verdict, 'green' | 'amber' | 'red'> = {
  covered: 'green',
  partial: 'amber',
  missing: 'red',
};

/** Keyword chip cloud — green present, amber partial, red missing/clickable (PRD §8.3 Tab 3). */
export default function KeywordsTab({
  report,
  onFix,
}: {
  report: MatchReport | null;
  onFix: (itemId: string) => void;
}) {
  if (!report) {
    return (
      <EmptyState icon="🏷" title="No keyword data yet">
        Run a score first (Score tab).
      </EmptyState>
    );
  }
  const verdictOf = (id: string): Verdict =>
    report.verdicts.items.find((i) => i.itemId === id)?.verdict ?? 'missing';
  const missing = report.jd.keywords.filter((k) => verdictOf(k.id) === 'missing');

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-1.5">
        {report.jd.keywords.map((k) => {
          const v = verdictOf(k.id);
          return (
            <Chip
              key={k.id}
              tone={CHIP_TONE[v]}
              title={v === 'missing' ? 'Click to fix with AI' : `${k.text}: ${v}`}
              onClick={v === 'missing' ? () => onFix(k.id) : undefined}
            >
              {k.text}
            </Chip>
          );
        })}
      </div>
      <div className="text-xs text-slate-400">
        <span className="mr-3">
          <span className="text-emerald-600">●</span> present
        </span>
        <span className="mr-3">
          <span className="text-amber-500">●</span> partial / semantic
        </span>
        <span>
          <span className="text-rose-500">●</span> missing — click to fix
        </span>
      </div>
      {missing.length > 0 && (
        <Button
          variant="ghost"
          onClick={() => {
            navigator.clipboard.writeText(missing.map((k) => k.text).join(', '));
            toast('Missing keywords copied', 'success');
          }}
        >
          ⧉ Copy missing keywords
        </Button>
      )}
    </div>
  );
}
