import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragStartEvent, type DragOverEvent, type DragEndEvent, closestCorners,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { api, onEvent } from '../api';
import type { Board, Job, Stage } from '../types';
import { Button, Chip, Input, Modal, ScoreRing, Spinner, TextArea, Field, toast } from '../components/ui';
import JobDrawer from '../components/JobDrawer';

export default function BoardView() {
  const [board, setBoard] = useState<Board | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'tailored' | 'overdue'>('all');
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

  useEffect(() => { load().catch((e) => toast(e.message, 'error')); }, [load]);
  useEffect(() => onEvent('job.updated', () => load().catch(() => {})), [load]);

  const filtered = useMemo(() => {
    let list = jobs;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((j) => j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q));
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
    setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, stage_id: target.stageId, position: target.index } : j)));
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
          await api.post(`/api/jobs/${job.id}/activities`, { type: 'applied', title: 'Applied', done: true });
        }
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      load().catch(() => {});
    }
  }

  if (!board) {
    return <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6 text-brand-500" /></div>;
  }

  const total = filtered.length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-base font-bold text-slate-800">{board.name}</h1>
        <span className="text-xs text-slate-400">{total} job{total === 1 ? '' : 's'}</span>
        <div className="ml-auto flex items-center gap-2">
          <Input placeholder="Search title or company…" value={search} onChange={(e) => setSearch(e.target.value)} className="!w-56" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600 focus:outline-none"
          >
            <option value="all">All jobs</option>
            <option value="tailored">Has tailored resume</option>
            <option value="overdue">Overdue tasks</option>
          </select>
          <Button variant="ghost" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'Hide archived' : 'Archived'}</Button>
        </div>
      </header>

      <MetricsStrip stages={board.stages} byStage={byStage} />

      <div className="flex-1 overflow-x-auto overflow-y-hidden thin-scroll">
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
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
                  } catch (e) { toast((e as Error).message, 'error'); }
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
          onCreated={() => { setAddToStage(null); load().catch(() => {}); }}
        />
      )}
      {drawerJobId && (
        <JobDrawer jobId={drawerJobId} onClose={() => { setDrawerJobId(null); load().catch(() => {}); }} />
      )}
    </div>
  );
}

function MetricsStrip({ stages, byStage }: { stages: Stage[]; byStage: Map<string, Job[]> }) {
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

const STAGE_COLORS = ['#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#64748b'];

function Column({ stage, index, stageCount, jobs, onAdd, onOpen, onChanged }: {
  stage: Stage; index: number; stageCount: number; jobs: Job[];
  onAdd: () => void; onOpen: (id: string) => void; onChanged: () => void;
}) {
  const { setNodeRef } = useDroppable({ id: stage.id });
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(stage.name);

  async function patch(body: Record<string, unknown>) {
    try {
      await api.patch(`/api/stages/${stage.id}`, body);
      onChanged();
    } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function remove() {
    try {
      await api.del(`/api/stages/${stage.id}`);
      onChanged();
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <div className="flex h-full w-72 shrink-0 flex-col rounded-xl bg-slate-200/50">
      <div className="relative flex items-center gap-2 px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color ?? '#94a3b8' }} />
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { setRenaming(false); if (name.trim() && name !== stage.name) patch({ name: name.trim() }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(stage.name); setRenaming(false); } }}
            className="w-32 rounded border border-brand-300 bg-white px-1.5 py-0.5 text-sm font-semibold text-slate-700 focus:outline-none"
          />
        ) : (
          <span className="cursor-text text-sm font-semibold text-slate-700" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">{stage.name}</span>
        )}
        <span className="rounded-full bg-white px-1.5 text-xs font-medium text-slate-500">{jobs.length}</span>
        <div className="ml-auto flex items-center">
          <button onClick={onAdd} className="rounded-lg px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-white hover:text-brand-600" title={`Add job to ${stage.name}`}>＋</button>
          <button onClick={() => setMenuOpen((v) => !v)} className="rounded-lg px-1.5 py-0.5 text-slate-400 hover:bg-white hover:text-slate-600" title="Column options">⋯</button>
        </div>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
            <div className="pop-in absolute right-2 top-full z-30 w-48 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl">
              <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => { setMenuOpen(false); setRenaming(true); }}>✏️ Rename</button>
              <div className="flex flex-wrap gap-1.5 px-3 py-1.5">
                {STAGE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => { patch({ color: c }); setMenuOpen(false); }}
                    className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${stage.color === c ? 'ring-2 ring-slate-400 ring-offset-1' : ''}`}
                    style={{ background: c }}
                    title={c}
                  />
                ))}
              </div>
              <button disabled={index === 0} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:text-slate-300" onClick={() => { patch({ position: index - 1 }); setMenuOpen(false); }}>← Move left</button>
              <button disabled={index >= stageCount - 1} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:text-slate-300" onClick={() => { patch({ position: index + 1 }); setMenuOpen(false); }}>→ Move right</button>
              <button
                disabled={jobs.length > 0}
                title={jobs.length > 0 ? 'Move jobs out first' : undefined}
                className="block w-full px-3 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:text-slate-300"
                onClick={() => { setMenuOpen(false); remove(); }}
              >
                🗑 Delete column
              </button>
            </div>
          </>
        )}
      </div>
      <SortableContext items={jobs.map((j) => j.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex-1 space-y-2 overflow-y-auto thin-scroll px-2 pb-2">
          {jobs.map((j) => <SortableJobCard key={j.id} job={j} onOpen={() => onOpen(j.id)} />)}
          {jobs.length === 0 && (
            <button onClick={onAdd} className="flex w-full items-center justify-center rounded-lg border-2 border-dashed border-slate-300 py-6 text-xs text-slate-400 hover:border-brand-300 hover:text-brand-500">
              ＋ Add job
            </button>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableJobCard({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: job.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.defaultPrevented) onOpen(); }}
      className="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-200"
    >
      <JobCard job={job} />
    </div>
  );
}

function daysIn(ms: number | null): number {
  if (!ms) return 0;
  return Math.floor((Date.now() - ms) / 86400000);
}

export function JobCard({ job, dragging }: { job: Job; dragging?: boolean }) {
  const score = job.latest_tailored?.match_score_after ?? null;
  const days = daysIn(job.stage_entered_at);
  return (
    <div className={`cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md ${dragging ? 'rotate-2 shadow-xl' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-800">{job.title || 'Untitled role'}</div>
          <div className="truncate text-xs text-slate-500">{job.company || '—'}</div>
        </div>
        {score !== null ? <ScoreRing score={score} size={34} stroke={3.5} /> :
          job.jd_text && !job.jd_analysis ? <span title="Analyzing JD…"><Spinner className="h-3.5 w-3.5 text-brand-400" /></span> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {job.location && <Chip>{job.location}</Chip>}
        {job.salary && <Chip tone="green">{job.salary}</Chip>}
        {days > 0 && <Chip tone={days > 14 ? 'amber' : 'slate'}>{days}d</Chip>}
        {job.overdue_count > 0 && <Chip tone="red" title={`${job.overdue_count} overdue task(s)`}>● due</Chip>}
        {job.jd_analysis && !job.latest_tailored && <Chip tone="brand" title="JD analyzed — ready to tailor">✦ analyzed</Chip>}
      </div>
    </div>
  );
}

function AddJobModal({ stage, onClose, onCreated }: { stage: Stage; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [url, setUrl] = useState('');
  const [jd, setJd] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim() && !company.trim()) { toast('Add at least a title or company', 'error'); return; }
    setBusy(true);
    try {
      await api.post('/api/jobs', { stageId: stage.id, title, company, url, jdText: jd });
      if (jd.trim()) toast('Job added — analyzing JD in the background', 'success');
      onCreated();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={<>Add job to <span className="text-brand-600">{stage.name}</span></>} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Job title"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Backend Engineer" /></Field>
        <Field label="Company"><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Corp" /></Field>
        <div className="col-span-2">
          <Field label="Job posting URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
        </div>
        <div className="col-span-2">
          <Field label="Job description (paste — analyzed automatically)">
            <TextArea rows={8} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job description here…" />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Add job'}</Button>
      </div>
    </Modal>
  );
}
