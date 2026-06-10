import React, { useEffect } from 'react';

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className={`pop-in max-h-[85vh] overflow-auto thin-scroll rounded-2xl bg-white shadow-2xl ${wide ? 'w-[720px]' : 'w-[460px]'} max-w-[94vw]`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-800">{title}</h2>
            <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">✕</button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Button({ children, variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'subtle' }) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm disabled:bg-brand-300',
    ghost: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:text-slate-300',
    subtle: 'bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:text-slate-300',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300',
  }[variant];
  return (
    <button {...props} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 ${props.className ?? ''}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 ${props.className ?? ''}`}
    />
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function Chip({ children, tone = 'slate', title, onClick }: {
  children: React.ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'brand' | 'violet'; title?: string; onClick?: () => void;
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-rose-100 text-rose-700',
    brand: 'bg-brand-100 text-brand-700',
    violet: 'bg-violet-100 text-violet-700',
  }[tone];
  return (
    <span
      title={title}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones} ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-current/20' : ''}`}
    >
      {children}
    </span>
  );
}

export function scoreColor(score: number): string {
  if (score >= 85) return '#10b981';
  if (score >= 70) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  if (score >= 30) return '#f97316';
  return '#ef4444';
}

export function ScoreRing({ score, size = 36, stroke = 4, showLabel = true }: { score: number; size?: number; stroke?: number; showLabel?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
        strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.6s ease' }}
      />
      {showLabel && (
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="rotate-90" style={{ transformOrigin: 'center' }} fontSize={size * 0.3} fontWeight={700} fill={color}>
          {score}
        </text>
      )}
    </svg>
  );
}

/** Simple word-level diff for suggestion cards (red strikethrough → green). */
export function WordDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const a = oldText.split(/\s+/).filter(Boolean);
  const b = newText.split(/\s+/).filter(Boolean);
  // LCS table (texts are short — bullets)
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const parts: Array<{ type: 'same' | 'del' | 'add'; words: string[] }> = [];
  const push = (type: 'same' | 'del' | 'add', w: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.words.push(w);
    else parts.push({ type, words: [w] });
  };
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i]); i++; }
    else { push('add', b[j]); j++; }
  }
  while (i < m) { push('del', a[i]); i++; }
  while (j < n) { push('add', b[j]); j++; }
  return (
    <p className="text-sm leading-relaxed">
      {parts.map((p, k) => {
        const text = p.words.join(' ') + ' ';
        if (p.type === 'same') return <span key={k} className="text-slate-600">{text}</span>;
        if (p.type === 'del') return <span key={k} className="bg-rose-50 text-rose-500 line-through decoration-rose-300">{text}</span>;
        return <span key={k} className="bg-emerald-50 font-medium text-emerald-700">{text}</span>;
      })}
    </p>
  );
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="text-4xl">{icon}</div>
      <div className="text-sm font-semibold text-slate-700">{title}</div>
      <div className="max-w-sm text-sm text-slate-500">{children}</div>
    </div>
  );
}

/** Tiny toast system */
let pushToast: ((msg: string, tone?: 'info' | 'error' | 'success') => void) | null = null;
export function toast(msg: string, tone: 'info' | 'error' | 'success' = 'info') {
  pushToast?.(msg, tone);
}
export function Toaster() {
  const [toasts, setToasts] = React.useState<Array<{ id: number; msg: string; tone: string }>>([]);
  useEffect(() => {
    pushToast = (msg, tone = 'info') => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, msg, tone }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    };
    return () => { pushToast = null; };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={`pop-in pointer-events-auto rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${
          t.tone === 'error' ? 'bg-rose-600 text-white' : t.tone === 'success' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white'
        }`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
