import type { Job } from '../../types';
import { Chip, ScoreRing, Spinner } from '../ui';

const MS_PER_DAY = 86_400_000;
const STALE_DAYS = 14;

function daysIn(since: number | null): number {
  if (!since) return 0;
  return Math.floor((Date.now() - since) / MS_PER_DAY);
}

/** A kanban card: title/company, match-score ring, status chips. */
export default function JobCard({ job, dragging }: { job: Job; dragging?: boolean }) {
  const score = job.latest_tailored?.match_score_after ?? null;
  const days = daysIn(job.stage_entered_at);
  return (
    <div
      className={`cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md ${dragging ? 'rotate-2 shadow-xl' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-800">
            {job.title || 'Untitled role'}
          </div>
          <div className="truncate text-xs text-slate-500">{job.company || '—'}</div>
        </div>
        {score !== null ? (
          <ScoreRing score={score} size={34} stroke={3.5} />
        ) : job.jd_text && !job.jd_analysis ? (
          <span title="Analyzing JD…">
            <Spinner className="h-3.5 w-3.5 text-brand-400" />
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {job.location && <Chip>{job.location}</Chip>}
        {job.salary && <Chip tone="green">{job.salary}</Chip>}
        {days > 0 && <Chip tone={days > STALE_DAYS ? 'amber' : 'slate'}>{days}d</Chip>}
        {job.overdue_count > 0 && (
          <Chip tone="red" title={`${job.overdue_count} overdue task(s)`}>
            ● due
          </Chip>
        )}
        {job.jd_analysis && !job.latest_tailored && (
          <Chip tone="brand" title="JD analyzed — ready to tailor">
            ✦ analyzed
          </Chip>
        )}
      </div>
    </div>
  );
}
