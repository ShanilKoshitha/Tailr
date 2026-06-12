import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  closestCorners,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { api, onEvent } from '../api';
import type { Board, Job, Stage } from '../types';
import { Button, Input, Spinner, toast } from '../components/ui';
import JobDrawer from '../components/JobDrawer';
import JobCard from '../components/board/JobCard';
import Column from '../components/board/Column';
import AddJobModal from '../components/board/AddJobModal';
import MetricsStrip from '../components/board/MetricsStrip';

type JobFilter = 'all' | 'tailored' | 'overdue';

export default function BoardView() {
  const [board, setBoard] = useState<Board | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<JobFilter>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [drawerJobId, setDrawerJobId] = useState<string | null>(null);
  const [addToStage, setAddToStage] = useState<Stage | null>(null);

  const load = useCallback(async () => {
    const boards = await api.get<Board[]>('/api/boards');
    const b = boards[0];
    setBoard(b);
    setJobs(await api.get<Job[]>(`/api/jobs?boardId=${b.id}&archived=${showArchived ? 1 : 0}`));
  }, [showArchived]);

  useEffect(() => {
    load().catch((e) => toast(e.message, 'error'));
  }, [load]);
  useEffect(() => onEvent('job.updated', () => load().catch(() => {})), [load]);

  const filtered = useMemo(() => {
    let list = jobs;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (j) => j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q),
      );
    }
    if (filter === 'tailored') list = list.filter((j) => j.latest_tailored);
    if (filter === 'overdue') list = list.filter((j) => j.overdue_count > 0);
    return list;
  }, [jobs, search, filter]);

  const byStage = useMemo(() => {
    const m = new Map<string, Job[]>();
    for (const s of board?.stages ?? []) m.set(s.id, []);
    for (const j of filtered) m.get(j.stage_id)?.push(j);
    for (const list of m.values()) list.sort((a, b) => a.position - b.position);
    return m;
  }, [board, filtered]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragStart(e: DragStartEvent) {
    setActiveJob(jobs.find((j) => j.id === e.active.id) ?? null);
  }

  function targetOf(overId: string): { stageId: string; index: number } | null {
    if (!board) return null;
    if (board.stages.some((s) => s.id === overId)) {
      return { stageId: overId, index: (byStage.get(overId) ?? []).length };
    }
    const overJob = jobs.find((j) => j.id === overId);
    if (!overJob) return null;
    const list = byStage.get(overJob.stage_id) ?? [];
    return { stageId: overJob.stage_id, index: list.findIndex((j) => j.id === overId) };
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const target = targetOf(String(over.id));
    const job = jobs.find((j) => j.id === active.id);
    if (!target || !job || job.stage_id === target.stageId) return;
    // optimistic stage move while dragging across columns
    setJobs((js) =>
      js.map((j) => (j.id === job.id ? { ...j, stage_id: target.stageId, position: target.index } : j)),
    );
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveJob(null);
    const { active, over } = e;
    if (!over) return;
    const target = targetOf(String(over.id));
    if (!target) return;
    const job = jobs.find((j) => j.id === active.id);
    if (!job) return;
    // optimistic reorder
    setJobs((js) => {
      const list = js.filter((j) => j.id !== job.id);
      const updated = { ...job, stage_id: target.stageId, position: target.index };
      return [...list, updated];
    });
    try {
      await api.patch(`/api/jobs/${job.id}`, { stageId: target.stageId, position: target.index });
      const stage = board?.stages.find((s) => s.id === target.stageId);
      if (stage?.name === 'Applied' && job.stage_id !== target.stageId) {
        // auto-prompt: log application date (PRD §9.1)
        if (window.confirm('Log application date as today?')) {
          await api.post(`/api/jobs/${job.id}/activities`, {
            type: 'applied',
            title: 'Applied',
            done: true,
          });
        }
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      load().catch(() => {});
    }
  }

  if (!board) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-brand-500" />
      </div>
    );
  }

  const total = filtered.length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-base font-bold text-slate-800">{board.name}</h1>
        <span className="text-xs text-slate-400">
          {total} job{total === 1 ? '' : 's'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Input
            placeholder="Search title or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="!w-56"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as JobFilter)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600 focus:outline-none"
          >
            <option value="all">All jobs</option>
            <option value="tailored">Has tailored resume</option>
            <option value="overdue">Overdue tasks</option>
          </select>
          <Button variant="ghost" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide archived' : 'Archived'}
          </Button>
        </div>
      </header>

      <MetricsStrip stages={board.stages} byStage={byStage} />

      <div className="flex-1 overflow-x-auto overflow-y-hidden thin-scroll">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <div className="flex h-full min-w-max gap-4 p-5">
            {board.stages.map((stage, i) => (
              <Column
                key={stage.id}
                stage={stage}
                index={i}
                stageCount={board.stages.length}
                jobs={byStage.get(stage.id) ?? []}
                onAdd={() => setAddToStage(stage)}
                onOpen={(id) => setDrawerJobId(id)}
                onChanged={() => load().catch(() => {})}
              />
            ))}
            {board.stages.length < 10 && (
              <button
                onClick={async () => {
                  try {
                    await api.post(`/api/boards/${board.id}/stages`, { name: 'New stage' });
                    load().catch(() => {});
                  } catch (e) {
                    toast((e as Error).message, 'error');
                  }
                }}
                className="mt-0.5 h-10 w-44 shrink-0 rounded-xl border-2 border-dashed border-slate-300 text-sm text-slate-400 hover:border-brand-300 hover:text-brand-500"
              >
                ＋ Add column
              </button>
            )}
          </div>
          <DragOverlay>{activeJob ? <JobCard job={activeJob} dragging /> : null}</DragOverlay>
        </DndContext>
      </div>

      {addToStage && (
        <AddJobModal
          stage={addToStage}
          onClose={() => setAddToStage(null)}
          onCreated={() => {
            setAddToStage(null);
            load().catch(() => {});
          }}
        />
      )}
      {drawerJobId && (
        <JobDrawer
          jobId={drawerJobId}
          onClose={() => {
            setDrawerJobId(null);
            load().catch(() => {});
          }}
        />
      )}
    </div>
  );
}
