import { useState } from 'react';
import type { MatchReport, Verdict, VerdictItem } from '../../types';
import { Button, EmptyState, ScoreRing, Spinner, scoreColor } from '../ui';

/** Radial gauge + component bars + Missing/Partial/Covered breakdown (PRD §8.3 Tab 2). */
export default function ScoreTab({
  report,
  onFix,
  onRescore,
  scoring,
}: {
  report: MatchReport | null;
  onFix: (itemId: string) => void;
  onRescore: () => void;
  scoring: boolean;
}) {
  if (!report) {
    return (
      <EmptyState icon="📊" title="No score yet">
        <Button onClick={onRescore} disabled={scoring}>
          {scoring ? <Spinner /> : 'Score this resume'}
        </Button>
      </EmptyState>
    );
  }
  const comps = [
    { name: 'Qualifications', c: report.components.qualifications },
    { name: 'Responsibilities', c: report.components.responsibilities },
    { name: 'Keywords', c: report.components.keywords },
    { name: 'Title match', c: report.components.title },
  ];
  const itemText = (id: string) => {
    const all = [...report.jd.qualifications, ...report.jd.responsibilities, ...report.jd.keywords];
    return all.find((i) => i.id === id)?.text ?? id;
  };
  const groups: Array<{ name: string; verdict: Verdict; tone: string }> = [
    { name: 'Missing', verdict: 'missing', tone: 'text-rose-600' },
    { name: 'Partially covered', verdict: 'partial', tone: 'text-amber-600' },
    { name: 'Covered', verdict: 'covered', tone: 'text-emerald-600' },
  ];
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-col items-center">
        <ScoreRing score={report.total} size={110} stroke={10} />
        <div className="mt-1 text-sm font-bold" style={{ color: scoreColor(report.total) }}>
          {report.band}
        </div>
      </div>
      <div className="space-y-2">
        {comps.map(({ name, c }) => (
          <div key={name}>
            <div className="flex justify-between text-xs text-slate-500">
              <span>{name}</span>
              <span>
                {(c.score * c.weight).toFixed(1)} / {c.weight}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${c.score * 100}%`, background: scoreColor(c.score * 100) }}
              />
            </div>
          </div>
        ))}
      </div>
      {groups.map((g) => {
        const items = report.verdicts.items.filter((i) => i.verdict === g.verdict);
        if (!items.length) return null;
        return (
          <VerdictGroup
            key={g.name}
            name={g.name}
            tone={g.tone}
            items={items}
            itemText={itemText}
            onFix={onFix}
            defaultOpen={g.verdict !== 'covered'}
          />
        );
      })}
    </div>
  );
}

function VerdictGroup({
  name,
  tone,
  items,
  itemText,
  onFix,
  defaultOpen,
}: {
  name: string;
  tone: string;
  items: VerdictItem[];
  itemText: (id: string) => string;
  onFix: (id: string) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={tone}>
          {name} <span className="font-normal text-slate-400">{items.length}</span>
        </span>
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="space-y-2 px-3 pb-3">
          {items.map((i) => (
            <li key={i.itemId} className="text-sm">
              <div className="text-slate-700">{itemText(i.itemId)}</div>
              {i.explanation && <div className="mt-0.5 text-xs text-slate-400">{i.explanation}</div>}
              {i.verdict !== 'covered' && (
                <button
                  className="mt-1 text-xs font-semibold text-brand-600 hover:underline"
                  onClick={() => onFix(i.itemId)}
                >
                  ✦ Fix with AI
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
