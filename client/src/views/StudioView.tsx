import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, onEvent, ssePost } from '../api';
import type { BboxMap, StudioState, Suggestion } from '../types';
import { Button, Modal, ScoreRing, Spinner, scoreColor, toast } from '../components/ui';
import JdAccordion from '../components/JdAccordion';
import PdfPreview, { type OverlayState } from '../components/PdfPreview';
import HighlightedJd from '../components/studio/HighlightedJd';
import SuggestionsTab from '../components/studio/SuggestionsTab';
import ScoreTab from '../components/studio/ScoreTab';
import KeywordsTab from '../components/studio/KeywordsTab';

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
    api
      .get<{ bbox: BboxMap | null }>(`/api/tailored/${tailoredId}/bbox`)
      .then((r) => setBbox(r.bbox))
      .catch(() => {});
  }, [tailoredId]);

  useEffect(() => {
    load().catch((e) => toast(e.message, 'error'));
  }, [load]);
  useEffect(
    () =>
      onEvent('preview.updated', (d) => {
        if (d.tailoredId === tailoredId) {
          setRefreshKey((k) => k + 1);
          api
            .get<{ bbox: BboxMap | null }>(`/api/tailored/${tailoredId}/bbox`)
            .then((r) => setBbox(r.bbox))
            .catch(() => {});
        }
      }),
    [tailoredId],
  );

  const suggestions = useMemo(() => state?.suggestions ?? [], [state?.suggestions]);
  const report = state?.report ?? null;

  const overlay: OverlayState = useMemo(
    () => ({
      pending: new Set(suggestions.filter((s) => s.op !== 'delete_paragraph').map((s) => s.paraId)),
      deletions: new Set(suggestions.filter((s) => s.op === 'delete_paragraph').map((s) => s.paraId)),
      hovered,
      accepted: lastAccepted,
    }),
    [suggestions, hovered, lastAccepted],
  );

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
    } catch (e) {
      toast((e as Error).message, 'error');
    }
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
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function undo() {
    try {
      await api.post(`/api/tailored/${tailoredId}/edits`, { action: 'undo' });
      await load();
      toast('Undone');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function regenerate(s: Suggestion) {
    try {
      await api.post(`/api/tailored/${tailoredId}/regenerate/${s.id}`);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function fixItem(itemId: string) {
    try {
      toast('Drafting a fix…');
      await api.post(`/api/tailored/${tailoredId}/fix-item`, { itemId });
      setTab('Suggestions');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  function exportFile(format: 'pdf' | 'docx') {
    setExportOpen(false);
    fetch(`/api/tailored/${tailoredId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? 'Export failed');
        }
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
      })
      .catch((e) => toast(e.message, 'error'));
  }

  function scrollToCard(paraId: string) {
    const s = suggestions.find((x) => x.paraId === paraId);
    if (!s) return;
    setTab('Suggestions');
    setTimeout(
      () => cardRefs.current.get(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      50,
    );
  }

  if (!state) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100">
        <Spinner className="h-7 w-7 text-brand-500" />
      </div>
    );
  }

  const score = report?.total ?? state.scoreAfter ?? null;

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <Link to="/" className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">
          ◀ Board
        </Link>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-slate-800">
            {state.job.company || 'Company'} — {state.job.title || 'Role'}
          </div>
          <div className="text-xs text-slate-400">
            {state.resume.name} · {state.edits.length} edit{state.edits.length === 1 ? '' : 's'} applied
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          {score !== null && (
            <div className="flex items-center gap-1.5">
              <ScoreRing score={score} size={38} stroke={4} />
              {report && (
                <span className="text-xs font-semibold" style={{ color: scoreColor(score) }}>
                  {report.band}
                </span>
              )}
              {state.scoreBefore !== null && state.scoreBefore !== score && (
                <span className="text-xs text-slate-400">
                  {state.scoreBefore} → <b style={{ color: scoreColor(score) }}>{score}</b>
                </span>
              )}
            </div>
          )}
          <Button
            variant="ghost"
            onClick={undo}
            disabled={state.edits.length === 0}
            title="Undo last accepted edit"
          >
            ↩ Undo
          </Button>
          <Button variant="ghost" onClick={rescore} disabled={scoring}>
            {scoring ? <Spinner /> : report ? '↻ Re-score' : 'Score'}
          </Button>
          <Button onClick={runAiTailor} disabled={tailoring}>
            {tailoring ? (
              <>
                <Spinner /> Tailoring…
              </>
            ) : (
              '✦ AI Tailor'
            )}
          </Button>
          <div className="relative">
            <Button variant="ghost" onClick={() => setExportOpen((v) => !v)}>
              Export ▾
            </Button>
            {exportOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                <button
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => exportFile('pdf')}
                >
                  PDF (via LibreOffice)
                </button>
                <button
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => exportFile('docx')}
                >
                  DOCX
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* LEFT — job panel */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Job description
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto thin-scroll px-4 py-3">
            {state.job.jd_analysis && (
              <div className="mb-3">
                <JdAccordion
                  analysis={state.job.jd_analysis}
                  verdictOf={(id) => report?.verdicts.items.find((i) => i.itemId === id)?.verdict}
                />
              </div>
            )}
            <HighlightedJd
              text={state.job.jd_text}
              keywords={state.job.jd_analysis?.keywords.map((k) => k.text) ?? []}
            />
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
                {t === 'Suggestions' && suggestions.length > 0 && (
                  <span className="ml-1 rounded-full bg-brand-100 px-1.5 text-xs text-brand-700">
                    {suggestions.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto thin-scroll">
            {tab === 'Suggestions' && (
              <SuggestionsTab
                state={state}
                suggestions={suggestions}
                handlers={{
                  onAct: act,
                  onRegenerate: regenerate,
                  onHover: setHovered,
                  cardRefs: cardRefs.current,
                }}
                runAiTailor={runAiTailor}
                tailoring={tailoring}
              />
            )}
            {tab === 'Score' && (
              <ScoreTab report={report} onFix={fixItem} onRescore={rescore} scoring={scoring} />
            )}
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
            <div className="text-xs text-slate-400">
              Analyzing JD → Scoring resume → Drafting suggestions
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
