import { useMemo, type ReactNode } from 'react';

/** Raw JD text with the analyzed keywords highlighted inline. */
export default function HighlightedJd({ text, keywords }: { text: string; keywords: string[] }) {
  const parts = useMemo<ReactNode[] | null>(() => {
    if (!text) return null;
    if (!keywords.length) return [<span key="t">{text}</span>];
    const escaped = keywords
      .filter((k) => k.length > 1)
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const rx = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
    const out: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    while ((m = rx.exec(text))) {
      if (m.index > last) out.push(<span key={key++}>{text.slice(last, m.index)}</span>);
      out.push(
        <mark key={key++} className="rounded bg-brand-100 px-0.5 text-brand-800">
          {m[0]}
        </mark>,
      );
      last = m.index + m[0].length;
    }
    out.push(<span key={key}>{text.slice(last)}</span>);
    return out;
  }, [text, keywords]);

  if (!text) return <p className="text-sm text-slate-400">No JD text. Add it from the job card.</p>;
  return <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">{parts}</p>;
}
