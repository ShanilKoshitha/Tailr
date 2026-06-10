import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, onEvent, ssePost } from '../api';
import type { BboxMap, MatchReport, StudioState, Suggestion, VerdictItem } from '../types';
import { Button, Chip, Modal, ScoreRing, Spinner, TextArea, WordDiff, scoreColor, toast, EmptyState } from '../components/ui';
import { JdAccordion } from '../components/JobDrawer';
import PdfPreview, { type OverlayState } from '../components/PdfPreview';

type RightTab = 'Suggestions' | 'Score' | 'Keywords';

const STAGE_LABELS: Record<string, string> = {
  analyzing_jd: 'Analyzing job description…',
  scoring: 'Scoring resume…',
  relevance: 'Rating bullet relevance…',
  relevance_failed: 'Relevance pass failed — continuing',
  drafting: 'Drafting suggestions…',
};

export default function StudioView() {
  const { tailoredId } = useParams<{ tailoredId: string }>();
  const [state, setState] = useState<StudioState | null>(null);
  const [bbox, setBbox] = useState<BboxMap | null>(null);
  const [tab, setTab] = useState<RightTab>('Suggestions');
  const [refreshKey, setRefreshKey] = useState(0);
  const [tailoring, setTailoring] = useState(false);
  const [stageMsg, setStageMsg] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const [lastAccepted, setLastAccepted] = useState<string | null>(null);
  const [scoring, setScoring] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  const load = useCallback(async () => {
    if (!tailoredId) return;
    const s = await api.get<StudioState>(`/api/tailored/${tailoredId}`);
    setState(s);
    api.get<{ bbox: BboxMap | null }>(`/api/tailored/${tailoredId}/bbox`).then((r) => setBbox(r.bbox)).catch(() => {});
  }, [tailoredId]);

  useEffect(() => { load().catch((e) => toast(e.message, 'error')); }, [load]);
  useEffect(() => onEvent('preview.updated', (d) => {
    if (d.tailoredId === tailoredId) {
      setRefreshKey((k) => k + 1);
      api.get<{ bbox: BboxMap | null }>(`/api/tailored/${tailoredId}/bbox`).then((r) => setBbox(r.bbox)).catch(() => {});
    }
  }), [tailoredId]);

  const suggestions = state?.suggestions ?? [];
  const report = state?.report ?? null;

  const overlay: OverlayState = useMemo(() => ({
    pending: new Set(suggestions.filter((s) => s.op !== 'delete_paragraph').map((s) => s.paraId)),
    deletions: new Set(suggestions.filter((s) => s.op === 'delete_paragraph').map((s) => s.paraId)),
    hovered,
    accepted: lastAccepted,
  }), [suggestions, hovered, lastAccepted]);

  async function runAiTailor() {
    if (!tailoredId) return;
    setTailoring(true);
    setStageMsg('Starting…');
    await ssePost(`/api/tailored/${tailoredId}/ai-tailor`, {
      onStage: (d) => setStageMsg(STAGE_LABELS[d.stage] ?? d.stage),
      onDone: () => {
        setTailoring(false);
        setTab('Suggestions');
        toast('Suggestions ready', 'success');
        load();
      },
      onError: (msg) => {
        setTailoring(false);
        toast(msg, 'error');
        load();
      },
    });
  }

  async function rescore() {
    setScoring(true);
    try {
      await api.post(`/api/tailored/${tailoredId}/score`);
      await load();
    } catch (e) { toast((e as Error).message, 'error'); }
    setScoring(false);
  }

  async function act(s: Suggestion, action: 'accept' | 'reject', editedText?: string) {
    try {
      await api.post(`/api/tailored/${tailoredId}/edits`, { action, suggestionId: s.id, editedText });
      if (action === 'accept') {
        setLastAccepted(s.paraId);
        setTimeout(() => setLastAccepted(null), 1400);
      }
      await load();
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function undo() {
    try {
      await api.post(`/api/tailored/${tailoredId}/edits`, { action: 'undo' });
      await load();
      toast('Undone');
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function regenerate(s: Suggestion) {
    try {
      await api.post(`/api/tailored/${tailoredId}/regenerate/${s.id}`);
      await load();
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function fixItem(itemId: string) {
    try {
      toast('Drafting a fix…');
      await api.post(`/api/tailored/${tailoredId}/fix-item`, { itemId });
      setTab('Suggestions');
      await load();
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  function exportFile(format: 'pdf' | 'docx') {
    setExportOpen(false);
    fetch(`/api/tailored/${tailoredId}/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format }),
    }).then(async (res) => {
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? 'Export failed'); }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') ?? '';
      const name = cd.match(/filename="(.+?)"/)?.[1] ?? `resume.${format}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`Exported ${name}`, 'success');
      load();
    }).catch((e) => toast(e.message, 'error'));
  }

  function scrollToCard(paraId: string) {
    const s = suggestions.find((x) => x.paraId === paraId);
    if (!s) return;
    setTab('Suggestions');
    setTimeout(() => cardRefs.current.get(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }

  if (!state) {
    return <div className="flex h-screen items-center justify-center bg-slate-100"><Spinner className="h-7 w-7 text-brand-500" /></div>;
  }

  const score = report?.total ?? state.scoreAfter ?? null;

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <Link to="/" className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">◀ Board</Link>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-slate-800">{state.job.company || 'Company'} — {state.job.title || 'Role'}</div>
          <div className="text-xs text-slate-400">{state.resume.name} · {state.edits.length} edit{state.edits.length === 1 ? '' : 's'} applied</div>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          {score !== null && (
            <div className="flex items-center gap-1.5">
              <ScoreRing score={score} size={38} stroke={4} />
              {report && <span className="text-xs font-semibold" style={{ color: scoreColor(score) }}>{report.band}</span>}
              {state.scoreBefore !== null && state.scoreBefore !== score && (
                <span className="text-xs text-slate-400">{state.scoreBefore} → <b style={{ color: scoreColor(score) }}>{score}</b></span>
              )}
            </div>
          )}
          <Button variant="ghost" onClick={undo} disabled={state.edits.length === 0} title="Undo last accepted edit">↩ Undo</Button>
          <Button variant="ghost" onClick={rescore} disabled={scoring}>{scoring ? <Spinner /> : report ? '↻ Re-score' : 'Score'}</Button>
          <Button onClick={runAiTailor} disabled={tailoring}>{tailoring ? <><Spinner /> Tailoring…</> : '✦ AI Tailor'}</Button>
          <div className="relative">
            <Button variant="ghost" onClick={() => setExportOpen((v) => !v)}>Export ▾</Button>
            {exportOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                <button className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50" onClick={() => exportFile('pdf')}>PDF (via LibreOffice)</button>
                <button className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50" onClick={() => exportFile('docx')}>DOCX</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* LEFT — job panel */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Job description</div>
          <div className="min-h-0 flex-1 overflow-y-auto thin-scroll px-4 py-3">
            {state.job.jd_analysis && (
              <div className="mb-3">
                <JdAccordion
                  analysis={state.job.jd_analysis}
                  verdictOf={(id) => report?.verdicts.items.find((i) => i.itemId === id)?.verdict}
                />
              </div>
            )}
            <HighlightedJd text={state.job.jd_text} keywords={state.job.jd_analysis?.keywords.map((k) => k.text) ?? []} />
          </div>
        </aside>

        {/* CENTER — resume preview */}
        <section className="min-w-0 flex-1">
          <PdfPreview
            url={`/api/tailored/${state.id}/preview.pdf`}
            bbox={bbox}
            overlay={overlay}
            refreshKey={refreshKey}
            onParaClick={scrollToCard}
            onParaHover={setHovered}
          />
        </section>

        {/* RIGHT — tabs */}
        <aside className="flex w-[380px] shrink-0 flex-col border-l border-slate-200 bg-white">
          <div className="flex border-b border-slate-100">
            {(['Suggestions', 'Score', 'Keywords'] as RightTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 px-2 py-2.5 text-sm font-medium ${tab === t ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {t}
                {t === 'Suggestions' && suggestions.length > 0 && <span className="ml-1 rounded-full bg-brand-100 px-1.5 text-xs text-brand-700">{suggestions.length}</span>}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto thin-scroll">
            {tab === 'Suggestions' && (
              <SuggestionsTab
                state={state}
                suggestions={suggestions}
                onAct={act}
                onRegenerate={regenerate}
                onHover={setHovered}
                cardRefs={cardRefs.current}
                runAiTailor={runAiTailor}
                tailoring={tailoring}
              />
            )}
            {tab === 'Score' && <ScoreTab report={report} onFix={fixItem} onRescore={rescore} scoring={scoring} />}
            {tab === 'Keywords' && <KeywordsTab report={report} onFix={fixItem} />}
          </div>
        </aside>
      </div>

      {/* AI Tailor progress modal */}
      <Modal open={tailoring} onClose={() => {}} title="AI Tailor">
        <div className="flex items-center gap-3 py-2">
          <Spinner className="h-5 w-5 text-brand-500" />
          <div>
            <div className="text-sm font-medium text-slate-700">{stageMsg}</div>
            <div className="text-xs text-slate-400">Analyzing JD → Scoring resume → Drafting suggestions</div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function HighlightedJd({ text, keywords }: { text: string; keywords: string[] }) {
  const html = useMemo(() => {
    if (!text) return null;
    if (!keywords.length) return [<span key="t">{text}</span>];
    const escaped = keywords.filter((k) => k.length > 1).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const rx = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
    const parts: React.ReactNode[] = [];
    let last = 0, m: RegExpExecArray | null, key = 0;
    while ((m = rx.exec(text))) {
      if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
      parts.push(<mark key={key++} className="rounded bg-brand-100 px-0.5 text-brand-800">{m[0]}</mark>);
      last = m.index + m[0].length;
    }
    parts.push(<span key={key++}>{text.slice(last)}</span>);
    return parts;
  }, [text, keywords]);
  if (!text) return <p className="text-sm text-slate-400">No JD text. Add it from the job card.</p>;
  return <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">{html}</p>;
}

const OP_LABEL: Record<Suggestion['op'], { label: string; tone: 'brand' | 'green' | 'red' | 'violet' }> = {
  replace_text: { label: 'Rewrite', tone: 'brand' },
  insert_paragraph_after: { label: 'Add bullet', tone: 'green' },
  delete_paragraph: { label: 'Remove', tone: 'red' },
  replace_skills_line: { label: 'Skills', tone: 'violet' },
};

function SuggestionsTab({ state, suggestions, onAct, onRegenerate, onHover, cardRefs, runAiTailor, tailoring }: {
  state: StudioState;
  suggestions: Suggestion[];
  onAct: (s: Suggestion, a: 'accept' | 'reject', editedText?: string) => Promise<void>;
  onRegenerate: (s: Suggestion) => Promise<void>;
  onHover: (id: string | null) => void;
  cardRefs: Map<string, HTMLDivElement>;
  runAiTailor: () => void;
  tailoring: boolean;
}) {
  const entryName = (entryId?: string | null) => {
    const e = state.model.entries.find((x) => x.entryId === entryId);
    return e ? `${e.company ? e.company + ' — ' : ''}${e.title}` : null;
  };

  // group order: summary/skills (non-entry) → per entry → deletions last (PRD §8.3)
  const deletions = suggestions.filter((s) => s.op === 'delete_paragraph');
  const others = suggestions.filter((s) => s.op !== 'delete_paragraph');

  if (state.suggestions === null) {
    return (
      <EmptyState icon="✂️" title="Ready to tailor">
        Run <b>AI Tailor</b> to get suggestion cards: bullet rewrites, additions, skills and summary edits — each one yours to accept or reject.
        <div className="mt-3"><Button onClick={runAiTailor} disabled={tailoring}>✦ Run AI Tailor</Button></div>
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
          <button className="rounded-lg bg-slate-100 px-2 py-1 font-medium hover:bg-slate-200" onClick={async () => { for (const s of others) await onAct(s, 'accept'); }}>
            Accept all rewrites
          </button>
          {deletions.length > 0 && (
            <button className="rounded-lg bg-slate-100 px-2 py-1 font-medium hover:bg-slate-200" onClick={async () => { for (const s of deletions) await onAct(s, 'accept'); }}>
              Accept all deletions
            </button>
          )}
        </div>
      </div>
      {others.map((s) => (
        <SuggestionCard key={s.id} s={s} entryName={entryName(s.entryId)} onAct={onAct} onRegenerate={onRegenerate} onHover={onHover} cardRefs={cardRefs} />
      ))}
      {deletions.length > 0 && (
        <>
          <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Trim for relevance</div>
          {deletions.map((s) => (
            <SuggestionCard key={s.id} s={s} entryName={entryName(s.entryId)} onAct={onAct} onRegenerate={onRegenerate} onHover={onHover} cardRefs={cardRefs} />
          ))}
        </>
      )}
    </div>
  );
}

function SuggestionCard({ s, entryName, onAct, onRegenerate, onHover, cardRefs }: {
  s: Suggestion; entryName: string | null;
  onAct: (s: Suggestion, a: 'accept' | 'reject', editedText?: string) => Promise<void>;
  onRegenerate: (s: Suggestion) => Promise<void>;
  onHover: (id: string | null) => void;
  cardRefs: Map<string, HTMLDivElement>;
}) {
  const [busy, setBusy] = useState<'accept' | 'reject' | 'regen' | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.newText);
  const op = OP_LABEL[s.op];

  async function run(action: 'accept' | 'reject', text?: string) {
    setBusy(action);
    await onAct(s, action, text);
    setBusy(null);
  }

  return (
    <div
      ref={(el) => { if (el) cardRefs.set(s.id, el); }}
      className="pop-in rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
      onMouseEnter={() => onHover(s.paraId)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="flex items-center gap-2">
        <Chip tone={op.tone}>✦ {op.label}</Chip>
        {entryName && <span className="truncate text-xs text-slate-400">{entryName}</span>}
      </div>

      {s.assumptionFlag && (
        <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          ⚠ <b>Verify this is true.</b> This statement asserts something not in your resume. Replace any <code>[X]</code> with real numbers — or reject it.
        </div>
      )}

      <div className="mt-2">
        {editing ? (
          <div>
            <TextArea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <Button variant="ghost" onClick={() => { setEditing(false); setDraft(s.newText); }}>Cancel</Button>
              <Button onClick={() => run('accept', draft)}>Apply my text</Button>
            </div>
          </div>
        ) : s.op === 'delete_paragraph' ? (
          <p className="text-sm leading-relaxed text-rose-500 line-through decoration-rose-300">{s.oldText}</p>
        ) : s.op === 'insert_paragraph_after' ? (
          <p className="rounded-lg bg-emerald-50 p-2 text-sm leading-relaxed text-emerald-800">＋ {s.newText}</p>
        ) : (
          <WordDiff oldText={s.oldText ?? ''} newText={s.newText} />
        )}
      </div>

      {s.rationale && !editing && <p className="mt-1.5 text-xs italic text-slate-400">{s.rationale}</p>}

      <div className="mt-2 flex items-center gap-1.5">
        {(s.itemsCovered ?? []).map((id) => <Chip key={id} tone="slate" title={`covers JD item ${id}`}>{id}</Chip>)}
        <div className="ml-auto flex gap-1">
          <IconBtn title="Accept" onClick={() => run('accept')} disabled={!!busy} className="text-emerald-600 hover:bg-emerald-50">
            {busy === 'accept' ? <Spinner className="h-3.5 w-3.5" /> : '✓'}
          </IconBtn>
          <IconBtn title="Reject" onClick={() => run('reject')} disabled={!!busy} className="text-rose-500 hover:bg-rose-50">
            {busy === 'reject' ? <Spinner className="h-3.5 w-3.5" /> : '✗'}
          </IconBtn>
          {s.op !== 'delete_paragraph' && (
            <>
              <IconBtn title="Regenerate" onClick={async () => { setBusy('regen'); await onRegenerate(s); setBusy(null); }} disabled={!!busy} className="text-slate-500 hover:bg-slate-100">
                {busy === 'regen' ? <Spinner className="h-3.5 w-3.5" /> : '↻'}
              </IconBtn>
              <IconBtn title="Edit before accepting" onClick={() => setEditing(true)} disabled={!!busy} className="text-slate-500 hover:bg-slate-100">✎</IconBtn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold transition-colors disabled:opacity-40 ${className}`}>
      {children}
    </button>
  );
}

function ScoreTab({ report, onFix, onRescore, scoring }: { report: MatchReport | null; onFix: (itemId: string) => void; onRescore: () => void; scoring: boolean }) {
  if (!report) {
    return (
      <EmptyState icon="📊" title="No score yet">
        <Button onClick={onRescore} disabled={scoring}>{scoring ? <Spinner /> : 'Score this resume'}</Button>
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
  const groups: Array<{ name: string; verdict: VerdictItem['verdict']; tone: string }> = [
    { name: 'Missing', verdict: 'missing', tone: 'text-rose-600' },
    { name: 'Partially covered', verdict: 'partial', tone: 'text-amber-600' },
    { name: 'Covered', verdict: 'covered', tone: 'text-emerald-600' },
  ];
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-col items-center">
        <ScoreRing score={report.total} size={110} stroke={10} />
        <div className="mt-1 text-sm font-bold" style={{ color: scoreColor(report.total) }}>{report.band}</div>
      </div>
      <div className="space-y-2">
        {comps.map(({ name, c }) => (
          <div key={name}>
            <div className="flex justify-between text-xs text-slate-500">
              <span>{name}</span>
              <span>{(c.score * c.weight).toFixed(1)} / {c.weight}</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full transition-all" style={{ width: `${c.score * 100}%`, background: scoreColor(c.score * 100) }} />
            </div>
          </div>
        ))}
      </div>
      {groups.map((g) => {
        const items = report.verdicts.items.filter((i) => i.verdict === g.verdict);
        if (!items.length) return null;
        return <VerdictGroup key={g.name} name={g.name} tone={g.tone} items={items} itemText={itemText} onFix={onFix} defaultOpen={g.verdict !== 'covered'} />;
      })}
    </div>
  );
}

function VerdictGroup({ name, tone, items, itemText, onFix, defaultOpen }: {
  name: string; tone: string; items: VerdictItem[]; itemText: (id: string) => string; onFix: (id: string) => void; defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200">
      <button className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold" onClick={() => setOpen((v) => !v)}>
        <span className={tone}>{name} <span className="font-normal text-slate-400">{items.length}</span></span>
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="space-y-2 px-3 pb-3">
          {items.map((i) => (
            <li key={i.itemId} className="text-sm">
              <div className="text-slate-700">{itemText(i.itemId)}</div>
              {i.explanation && <div className="mt-0.5 text-xs text-slate-400">{i.explanation}</div>}
              {i.verdict !== 'covered' && (
                <button className="mt-1 text-xs font-semibold text-brand-600 hover:underline" onClick={() => onFix(i.itemId)}>✦ Fix with AI</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KeywordsTab({ report, onFix }: { report: MatchReport | null; onFix: (itemId: string) => void }) {
  if (!report) return <EmptyState icon="🏷" title="No keyword data yet">Run a score first (Score tab).</EmptyState>;
  const verdictOf = (id: string) => report.verdicts.items.find((i) => i.itemId === id)?.verdict ?? 'missing';
  const missing = report.jd.keywords.filter((k) => verdictOf(k.id) === 'missing');
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-1.5">
        {report.jd.keywords.map((k) => {
          const v = verdictOf(k.id);
          return (
            <Chip
              key={k.id}
              tone={v === 'covered' ? 'green' : v === 'partial' ? 'amber' : 'red'}
              title={v === 'missing' ? 'Click to fix with AI' : `${k.text}: ${v}`}
              onClick={v === 'missing' ? () => onFix(k.id) : undefined}
            >
              {k.text}
            </Chip>
          );
        })}
      </div>
      <div className="text-xs text-slate-400">
        <span className="mr-3"><span className="text-emerald-600">●</span> present</span>
        <span className="mr-3"><span className="text-amber-500">●</span> partial / semantic</span>
        <span><span className="text-rose-500">●</span> missing — click to fix</span>
      </div>
      {missing.length > 0 && (
        <Button variant="ghost" onClick={() => { navigator.clipboard.writeText(missing.map((k) => k.text).join(', ')); toast('Missing keywords copied', 'success'); }}>
          ⧉ Copy missing keywords
        </Button>
      )}
    </div>
  );
}
