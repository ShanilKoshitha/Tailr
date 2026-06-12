import { useState } from 'react';
import type { StudioState, Suggestion } from '../../types';
import { Button, Chip, EmptyState, Spinner, TextArea, WordDiff } from '../ui';

export type SuggestionAction = 'accept' | 'reject';

export interface SuggestionHandlers {
  onAct: (s: Suggestion, action: SuggestionAction, editedText?: string) => Promise<void>;
  onRegenerate: (s: Suggestion) => Promise<void>;
  /** Mirrors card hover onto the preview overlay (and back). */
  onHover: (paraId: string | null) => void;
  /** Lets the preview scroll a clicked paragraph's card into view. */
  cardRefs: Map<string, HTMLDivElement>;
}

const OP_LABEL: Record<Suggestion['op'], { label: string; tone: 'brand' | 'green' | 'red' | 'violet' }> =
  {
    replace_text: { label: 'Rewrite', tone: 'brand' },
    insert_paragraph_after: { label: 'Add bullet', tone: 'green' },
    delete_paragraph: { label: 'Remove', tone: 'red' },
    replace_skills_line: { label: 'Skills', tone: 'violet' },
  };

/** Pending suggestion cards: rewrites/additions first, deletions grouped last (PRD §8.3). */
export default function SuggestionsTab({
  state,
  suggestions,
  handlers,
  runAiTailor,
  tailoring,
}: {
  state: StudioState;
  suggestions: Suggestion[];
  handlers: SuggestionHandlers;
  runAiTailor: () => void;
  tailoring: boolean;
}) {
  const entryName = (entryId?: string | null) => {
    const e = state.model.entries.find((x) => x.entryId === entryId);
    return e ? `${e.company ? `${e.company} — ` : ''}${e.title}` : null;
  };

  const deletions = suggestions.filter((s) => s.op === 'delete_paragraph');
  const others = suggestions.filter((s) => s.op !== 'delete_paragraph');

  if (state.suggestions === null) {
    return (
      <EmptyState icon="✂️" title="Ready to tailor">
        Run <b>AI Tailor</b> to get suggestion cards: bullet rewrites, additions, skills and summary
        edits — each one yours to accept or reject.
        <div className="mt-3">
          <Button onClick={runAiTailor} disabled={tailoring}>
            ✦ Run AI Tailor
          </Button>
        </div>
      </EmptyState>
    );
  }
  if (suggestions.length === 0) {
    return (
      <EmptyState icon="🎉" title="All suggestions handled">
        Accept more by re-running AI Tailor, or use <b>Fix with AI</b> on missing items in the Score tab.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-2.5 p-3">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{suggestions.length} pending</span>
        <div className="flex gap-1.5">
          <button
            className="rounded-lg bg-slate-100 px-2 py-1 font-medium hover:bg-slate-200"
            onClick={async () => {
              for (const s of others) await handlers.onAct(s, 'accept');
            }}
          >
            Accept all rewrites
          </button>
          {deletions.length > 0 && (
            <button
              className="rounded-lg bg-slate-100 px-2 py-1 font-medium hover:bg-slate-200"
              onClick={async () => {
                for (const s of deletions) await handlers.onAct(s, 'accept');
              }}
            >
              Accept all deletions
            </button>
          )}
        </div>
      </div>
      {others.map((s) => (
        <SuggestionCard key={s.id} s={s} entryName={entryName(s.entryId)} handlers={handlers} />
      ))}
      {deletions.length > 0 && (
        <>
          <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Trim for relevance
          </div>
          {deletions.map((s) => (
            <SuggestionCard key={s.id} s={s} entryName={entryName(s.entryId)} handlers={handlers} />
          ))}
        </>
      )}
    </div>
  );
}

function SuggestionCard({
  s,
  entryName,
  handlers,
}: {
  s: Suggestion;
  entryName: string | null;
  handlers: SuggestionHandlers;
}) {
  const [busy, setBusy] = useState<'accept' | 'reject' | 'regen' | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.newText);
  const op = OP_LABEL[s.op];

  async function run(action: SuggestionAction, text?: string) {
    setBusy(action);
    await handlers.onAct(s, action, text);
    setBusy(null);
  }

  return (
    <div
      ref={(el) => {
        if (el) handlers.cardRefs.set(s.id, el);
      }}
      className="pop-in rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
      onMouseEnter={() => handlers.onHover(s.paraId)}
      onMouseLeave={() => handlers.onHover(null)}
    >
      <div className="flex items-center gap-2">
        <Chip tone={op.tone}>✦ {op.label}</Chip>
        {entryName && <span className="truncate text-xs text-slate-400">{entryName}</span>}
      </div>

      {s.assumptionFlag && (
        <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          ⚠ <b>Verify this is true.</b> This statement asserts something not in your resume. Replace any{' '}
          <code>[X]</code> with real numbers — or reject it.
        </div>
      )}

      <div className="mt-2">
        {editing ? (
          <div>
            <TextArea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(s.newText);
                }}
              >
                Cancel
              </Button>
              <Button onClick={() => run('accept', draft)}>Apply my text</Button>
            </div>
          </div>
        ) : s.op === 'delete_paragraph' ? (
          <p className="text-sm leading-relaxed text-rose-500 line-through decoration-rose-300">
            {s.oldText}
          </p>
        ) : s.op === 'insert_paragraph_after' ? (
          <p className="rounded-lg bg-emerald-50 p-2 text-sm leading-relaxed text-emerald-800">
            ＋ {s.newText}
          </p>
        ) : (
          <WordDiff oldText={s.oldText ?? ''} newText={s.newText} />
        )}
      </div>

      {s.rationale && !editing && <p className="mt-1.5 text-xs italic text-slate-400">{s.rationale}</p>}

      <div className="mt-2 flex items-center gap-1.5">
        {(s.itemsCovered ?? []).map((id) => (
          <Chip key={id} tone="slate" title={`covers JD item ${id}`}>
            {id}
          </Chip>
        ))}
        <div className="ml-auto flex gap-1">
          <IconBtn
            title="Accept"
            onClick={() => run('accept')}
            disabled={!!busy}
            className="text-emerald-600 hover:bg-emerald-50"
          >
            {busy === 'accept' ? <Spinner className="h-3.5 w-3.5" /> : '✓'}
          </IconBtn>
          <IconBtn
            title="Reject"
            onClick={() => run('reject')}
            disabled={!!busy}
            className="text-rose-500 hover:bg-rose-50"
          >
            {busy === 'reject' ? <Spinner className="h-3.5 w-3.5" /> : '✗'}
          </IconBtn>
          {s.op !== 'delete_paragraph' && (
            <>
              <IconBtn
                title="Regenerate"
                onClick={async () => {
                  setBusy('regen');
                  await handlers.onRegenerate(s);
                  setBusy(null);
                }}
                disabled={!!busy}
                className="text-slate-500 hover:bg-slate-100"
              >
                {busy === 'regen' ? <Spinner className="h-3.5 w-3.5" /> : '↻'}
              </IconBtn>
              <IconBtn
                title="Edit before accepting"
                onClick={() => setEditing(true)}
                disabled={!!busy}
                className="text-slate-500 hover:bg-slate-100"
              >
                ✎
              </IconBtn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold transition-colors disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}
