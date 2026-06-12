import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../../api';
import type { Job, Stage } from '../../types';
import { toast } from '../ui';
import JobCard from './JobCard';

const STAGE_COLORS = [
  '#8b5cf6',
  '#3b82f6',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#64748b',
];

export interface ColumnProps {
  stage: Stage;
  index: number;
  stageCount: number;
  jobs: Job[];
  onAdd: () => void;
  onOpen: (jobId: string) => void;
  /** Called after any stage mutation (rename/recolor/move/delete). */
  onChanged: () => void;
}

/** One kanban column: droppable job list + stage management menu. */
export default function Column({
  stage,
  index,
  stageCount,
  jobs,
  onAdd,
  onOpen,
  onChanged,
}: ColumnProps) {
  const { setNodeRef } = useDroppable({ id: stage.id });
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(stage.name);

  async function patch(body: Record<string, unknown>) {
    try {
      await api.patch(`/api/stages/${stage.id}`, body);
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  async function remove() {
    try {
      await api.del(`/api/stages/${stage.id}`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
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
            onBlur={() => {
              setRenaming(false);
              if (name.trim() && name !== stage.name) patch({ name: name.trim() });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setName(stage.name);
                setRenaming(false);
              }
            }}
            className="w-32 rounded border border-brand-300 bg-white px-1.5 py-0.5 text-sm font-semibold text-slate-700 focus:outline-none"
          />
        ) : (
          <span
            className="cursor-text text-sm font-semibold text-slate-700"
            onDoubleClick={() => setRenaming(true)}
            title="Double-click to rename"
          >
            {stage.name}
          </span>
        )}
        <span className="rounded-full bg-white px-1.5 text-xs font-medium text-slate-500">
          {jobs.length}
        </span>
        <div className="ml-auto flex items-center">
          <button
            onClick={onAdd}
            className="rounded-lg px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-white hover:text-brand-600"
            title={`Add job to ${stage.name}`}
          >
            ＋
          </button>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-lg px-1.5 py-0.5 text-slate-400 hover:bg-white hover:text-slate-600"
            title="Column options"
          >
            ⋯
          </button>
        </div>
        {menuOpen && (
          <StageMenu
            stage={stage}
            index={index}
            stageCount={stageCount}
            deletable={jobs.length === 0}
            onClose={() => setMenuOpen(false)}
            onRename={() => setRenaming(true)}
            onPatch={patch}
            onDelete={remove}
          />
        )}
      </div>
      <SortableContext items={jobs.map((j) => j.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex-1 space-y-2 overflow-y-auto thin-scroll px-2 pb-2">
          {jobs.map((j) => (
            <SortableJobCard key={j.id} job={j} onOpen={() => onOpen(j.id)} />
          ))}
          {jobs.length === 0 && (
            <button
              onClick={onAdd}
              className="flex w-full items-center justify-center rounded-lg border-2 border-dashed border-slate-300 py-6 text-xs text-slate-400 hover:border-brand-300 hover:text-brand-500"
            >
              ＋ Add job
            </button>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function StageMenu({
  stage,
  index,
  stageCount,
  deletable,
  onClose,
  onRename,
  onPatch,
  onDelete,
}: {
  stage: Stage;
  index: number;
  stageCount: number;
  deletable: boolean;
  onClose: () => void;
  onRename: () => void;
  onPatch: (body: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="pop-in absolute right-2 top-full z-30 w-48 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl">
        <button
          className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
          onClick={() => {
            onClose();
            onRename();
          }}
        >
          ✏️ Rename
        </button>
        <div className="flex flex-wrap gap-1.5 px-3 py-1.5">
          {STAGE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                onPatch({ color: c });
                onClose();
              }}
              className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${stage.color === c ? 'ring-2 ring-slate-400 ring-offset-1' : ''}`}
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
        <button
          disabled={index === 0}
          className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:text-slate-300"
          onClick={() => {
            onPatch({ position: index - 1 });
            onClose();
          }}
        >
          ← Move left
        </button>
        <button
          disabled={index >= stageCount - 1}
          className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:text-slate-300"
          onClick={() => {
            onPatch({ position: index + 1 });
            onClose();
          }}
        >
          → Move right
        </button>
        <button
          disabled={!deletable}
          title={!deletable ? 'Move jobs out first' : undefined}
          className="block w-full px-3 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:text-slate-300"
          onClick={() => {
            onClose();
            onDelete();
          }}
        >
          🗑 Delete column
        </button>
      </div>
    </>
  );
}

function SortableJobCard({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: job.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.defaultPrevented) onOpen();
      }}
      className="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-200"
    >
      <JobCard job={job} />
    </div>
  );
}
