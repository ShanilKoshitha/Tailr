import { useState } from 'react';
import type { JdAnalysis, Verdict } from '../types';

interface JdGroup {
  name: string;
  items: Array<{ id: string; text: string }>;
  /** Group-specific badge text (priority for quals/resps, type for keywords). */
  meta: (id: string) => string;
}

const VERDICT_DOT: Record<Verdict, string> = {
  covered: 'bg-emerald-500',
  partial: 'bg-amber-500',
  missing: 'bg-rose-500',
};

/**
 * Collapsible Qualifications / Responsibilities / Keywords breakdown of an
 * analyzed JD. Shared by the job drawer and the Studio's left pane; when
 * `verdictOf` is provided, each item gets a coverage status dot.
 */
export default function JdAccordion({
  analysis,
  verdictOf,
}: {
  analysis: JdAnalysis;
  verdictOf?: (id: string) => Verdict | undefined;
}) {
  const groups: JdGroup[] = [
    {
      name: 'Qualifications',
      items: analysis.qualifications,
      meta: (id) => analysis.qualifications.find((q) => q.id === id)?.priority ?? '',
    },
    {
      name: 'Responsibilities',
      items: analysis.responsibilities,
      meta: (id) => analysis.responsibilities.find((r) => r.id === id)?.priority ?? '',
    },
    {
      name: 'Keywords',
      items: analysis.keywords,
      meta: (id) => analysis.keywords.find((k) => k.id === id)?.type ?? '',
    },
  ];
  const [open, setOpen] = useState<string | null>('Qualifications');
  const dot = (v?: Verdict) => (v ? VERDICT_DOT[v] : 'bg-slate-300');

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Extracted · target: <span className="text-brand-600 normal-case">{analysis.titleEssence}</span>
      </div>
      {groups.map((g) => (
        <div key={g.name} className="border-b border-slate-100 last:border-0">
          <button
            className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => setOpen(open === g.name ? null : g.name)}
          >
            <span>
              {g.name} <span className="text-xs text-slate-400">{g.items.length}</span>
            </span>
            <span className="text-slate-400">{open === g.name ? '▾' : '▸'}</span>
          </button>
          {open === g.name && (
            <ul className="space-y-1 px-3 pb-2">
              {g.items.map((i) => (
                <li key={i.id} className="flex items-start gap-2 text-sm text-slate-600">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot(verdictOf?.(i.id))}`}
                  />
                  <span>
                    {i.text} <span className="text-xs text-slate-400">({g.meta(i.id)})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
