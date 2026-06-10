import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { BboxMap } from '../types';
import { Spinner } from './ui';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface OverlayState {
  /** paraId → visual state drawn over the preview */
  pending?: Set<string>;    // amber underline: has a pending suggestion
  deletions?: Set<string>;  // red strikethrough overlay
  accepted?: string | null; // green flash on last accepted paraId
  hovered?: string | null;  // outline (card hover ↔ preview hover)
}

export default function PdfPreview({ url, bbox, overlay, onParaClick, onParaHover, refreshKey }: {
  url: string;
  bbox: BboxMap | null;
  overlay: OverlayState;
  onParaClick?: (paraId: string) => void;
  onParaHover?: (paraId: string | null) => void;
  refreshKey: number; // bump to force re-fetch after preview.updated
}) {
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    pdfjs.getDocument({ url: `${url}?v=${refreshKey}` }).promise
      .then((d) => { if (!cancelled) setDoc(d); })
      .catch((e) => {
        if (cancelled) return;
        const msg: string = e?.message ?? String(e);
        setError(/Missing PDF|404|UnexpectedResponse/i.test(msg) || e?.status === 404 ? 'no-preview' : msg);
      });
    return () => { cancelled = true; };
  }, [url, refreshKey]);

  if (error === 'no-preview') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">
        <div className="text-3xl">🖨️</div>
        <p className="font-medium">No PDF preview available</p>
        <p className="max-w-xs text-xs">Install LibreOffice (Settings → Document conversion) to see a pixel-accurate preview. Suggestions and DOCX export still work.</p>
      </div>
    );
  }
  if (error) return <div className="p-6 text-sm text-rose-600">Preview failed: {error}</div>;
  if (!doc) return <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6 text-brand-500" /></div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
        <button className="rounded px-2 py-0.5 hover:bg-slate-100" onClick={() => { setFitWidth(false); setZoom((z) => Math.max(0.5, z - 0.1)); }}>−</button>
        <span className="w-12 text-center">{fitWidth ? 'fit' : `${Math.round(zoom * 100)}%`}</span>
        <button className="rounded px-2 py-0.5 hover:bg-slate-100" onClick={() => { setFitWidth(false); setZoom((z) => Math.min(2, z + 0.1)); }}>＋</button>
        <button className={`rounded px-2 py-0.5 hover:bg-slate-100 ${fitWidth ? 'text-brand-600 font-medium' : ''}`} onClick={() => setFitWidth(true)}>fit width</button>
        <span className="ml-2 text-slate-300">·</span>
        <span>{doc.numPages} page{doc.numPages > 1 ? 's' : ''}</span>
      </div>
      <div ref={containerRef} className="flex-1 overflow-auto thin-scroll bg-slate-200/70 p-4">
        <div className="mx-auto flex w-fit flex-col gap-4">
          {Array.from({ length: doc.numPages }, (_, i) => (
            <Page
              key={i + 1}
              doc={doc}
              pageNum={i + 1}
              zoom={zoom}
              fitWidth={fitWidth}
              containerRef={containerRef}
              bbox={bbox}
              overlay={overlay}
              onParaClick={onParaClick}
              onParaHover={onParaHover}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Page({ doc, pageNum, zoom, fitWidth, containerRef, bbox, overlay, onParaClick, onParaHover }: {
  doc: pdfjs.PDFDocumentProxy; pageNum: number; zoom: number; fitWidth: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  bbox: BboxMap | null; overlay: OverlayState;
  onParaClick?: (paraId: string) => void; onParaHover?: (paraId: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number; scale: number } | null>(null);
  const renderTask = useRef<pdfjs.RenderTask | null>(null);

  const render = useCallback(async () => {
    const page = await doc.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    let scale = zoom;
    if (fitWidth && containerRef.current) {
      scale = (containerRef.current.clientWidth - 48) / base.width;
    }
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale });
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    setDims({ w: viewport.width, h: viewport.height, scale });
    const ctx = canvas.getContext('2d')!;
    renderTask.current?.cancel();
    const task = page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: scale * dpr }) } as any);
    renderTask.current = task;
    try { await task.promise; } catch { /* cancelled */ }
  }, [doc, pageNum, zoom, fitWidth, containerRef]);

  useEffect(() => { render(); }, [render]);
  useEffect(() => {
    const onResize = () => fitWidth && render();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitWidth, render]);

  const pageSize = bbox?.pageSizes.find((p) => p.page === pageNum);
  const boxes = (bbox?.boxes ?? []).filter((b) => b.page === pageNum);

  return (
    <div className="relative bg-white shadow-lg" style={dims ? { width: dims.w, height: dims.h } : undefined}>
      <canvas ref={canvasRef} />
      {dims && pageSize && boxes.map((b) => {
        const sx = dims.w / pageSize.width;
        const sy = dims.h / pageSize.height;
        const isPending = overlay.pending?.has(b.paraId);
        const isDeletion = overlay.deletions?.has(b.paraId);
        const isHovered = overlay.hovered === b.paraId;
        const isAccepted = overlay.accepted === b.paraId;
        return (
          <div
            key={b.paraId}
            className={`absolute cursor-pointer rounded-sm transition-colors ${isHovered ? 'bg-brand-400/15 ring-2 ring-brand-400' : 'hover:bg-brand-400/10'} ${isAccepted ? 'flash-green' : ''}`}
            style={{ left: b.x * sx - 2, top: b.y * sy - 1, width: b.w * sx + 4, height: b.h * sy + 2 }}
            onClick={() => onParaClick?.(b.paraId)}
            onMouseEnter={() => onParaHover?.(b.paraId)}
            onMouseLeave={() => onParaHover?.(null)}
          >
            {isPending && !isDeletion && <div className="absolute inset-x-0 bottom-0 h-0.5 rounded bg-amber-400" />}
            {isDeletion && <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-rose-500/70" />}
          </div>
        );
      })}
    </div>
  );
}
