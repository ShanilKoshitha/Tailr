import type { Job, Stage } from '../../types';

/** Per-stage totals + conversion % between adjacent stages (PRD §9.1 metrics-lite). */
export default function MetricsStrip({
  stages,
  byStage,
}: {
  stages: Stage[];
  byStage: Map<string, Job[]>;
}) {
  const counts = stages.map((s) => (byStage.get(s.id) ?? []).length);
  return (
    <div className="flex items-center gap-5 border-b border-slate-200 bg-white/60 px-5 py-1.5 text-xs text-slate-500">
      {stages.map((s, i) => {
        const conv = i > 0 && counts[i - 1] > 0 ? Math.round((counts[i] / counts[i - 1]) * 100) : null;
        return (
          <span key={s.id} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color ?? '#94a3b8' }} />
            {s.name} <b className="text-slate-700">{counts[i]}</b>
            {conv !== null && <span className="text-slate-400">({conv}%)</span>}
          </span>
        );
      })}
    </div>
  );
}
