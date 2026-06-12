import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from './api';
import type { AiStatus } from './types';
import { Toaster } from './components/ui';

const nav = [
  { to: '/', label: 'Board', icon: '▦' },
  { to: '/resumes', label: 'Resumes', icon: '📄' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export default function App() {
  const [ai, setAi] = useState<AiStatus | null>(null);
  useEffect(() => {
    api
      .get<AiStatus>('/api/ai/status')
      .then(setAi)
      .catch(() => {});
  }, []);

  const aiReady = ai?.installed && ai?.authenticated;

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="text-2xl">🧵</span>
          <span className="text-lg font-bold tracking-tight text-slate-800">Tailr</span>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                }`
              }
            >
              <span className="text-base">{n.icon}</span> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-5 pb-5">
          {ai && (
            <NavLink
              to="/settings"
              className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 hover:bg-slate-100"
            >
              <span className={`h-2 w-2 rounded-full ${aiReady ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {aiReady
                ? `AI ready · ${ai.model || 'default model'}`
                : ai.installed
                  ? 'AI: not signed in'
                  : 'AI: Codex not found'}
            </NavLink>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
