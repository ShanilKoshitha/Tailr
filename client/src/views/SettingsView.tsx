import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { AiStatus } from '../types';
import { Button, Chip, Field, Input, Spinner, toast } from '../components/ui';

interface Settings {
  ai_model: string; ai_reasoning: string; openai_api_key: string; soffice_path: string;
  export_pattern: string; allow_new_bullets: string; max_new_bullets: string; aggressive_trimming: string;
  ai_logs_dir: string; storage_dir: string;
}

export default function SettingsView() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    const [s, st] = await Promise.all([api.get<Settings>('/api/settings'), api.get<AiStatus>('/api/ai/status')]);
    setSettings(s); setStatus(st);
  }, []);
  useEffect(() => { load().catch((e) => toast(e.message, 'error')); }, [load]);
  useEffect(() => () => clearInterval(pollRef.current), []);

  async function saveField(key: string, value: string) {
    await api.patch('/api/settings', { [key]: value });
    toast('Saved', 'success');
    load();
  }

  async function connect() {
    setPolling(true);
    try {
      const r = await api.post<{ authUrl: string | null }>('/api/ai/login');
      setAuthUrl(r.authUrl);
      pollRef.current = setInterval(async () => {
        const s = await api.get<{ authenticated: boolean }>('/api/ai/login/status');
        if (s.authenticated) {
          clearInterval(pollRef.current);
          setPolling(false);
          setAuthUrl(null);
          toast('ChatGPT connected ✓', 'success');
          load();
        }
      }, 2000);
    } catch (e) {
      toast((e as Error).message, 'error');
      setPolling(false);
    }
  }

  async function testConversion() {
    try {
      const r = await api.post<{ ok: boolean }>('/api/settings/test-conversion');
      toast(r.ok ? 'Conversion works ✓' : 'Conversion failed', r.ok ? 'success' : 'error');
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  if (!settings || !status) {
    return <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6 text-brand-500" /></div>;
  }

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto thin-scroll px-6 py-8">
      <h1 className="text-xl font-bold text-slate-800">Settings</h1>

      <Section title="AI — Codex CLI" subtitle="Inference rides your ChatGPT subscription via the Codex CLI. No API billing.">
        <div className="flex items-center gap-2">
          <StatusDot ok={status.installed} />
          <span className="text-sm text-slate-700">
            {status.installed ? <>Codex CLI installed <span className="text-xs text-slate-400">({status.version})</span></> : 'Codex CLI not found'}
          </span>
          {!status.installed && (
            <code className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs">npm i -g @openai/codex</code>
          )}
          <Button variant="ghost" className="ml-auto" onClick={load}>Re-check</Button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <StatusDot ok={status.authenticated} />
          <span className="text-sm text-slate-700">{status.authenticated ? (status.usingApiKey ? 'Using API key' : 'ChatGPT account connected') : 'Not signed in'}</span>
          {status.installed && !status.authenticated && (
            <Button className="ml-auto" onClick={connect} disabled={polling}>{polling ? <><Spinner /> Waiting…</> : 'Connect ChatGPT'}</Button>
          )}
        </div>
        {authUrl && (
          <div className="mt-3 rounded-xl bg-brand-50 p-3 text-sm">
            Open this link to sign in: <a className="break-all font-medium text-brand-700 underline" href={authUrl} target="_blank" rel="noreferrer">{authUrl}</a>
            <div className="mt-1 text-xs text-slate-500">Tailr polls every 2s and updates automatically when you finish.</div>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Model (blank = Codex CLI default)">
            <Input defaultValue={settings.ai_model} placeholder="CLI default (~/.codex/config.toml)" onBlur={(e) => e.target.value !== settings.ai_model && saveField('ai_model', e.target.value)} />
          </Field>
          <Field label="Reasoning effort (blank = CLI default)">
            <select
              defaultValue={settings.ai_reasoning}
              onChange={(e) => saveField('ai_reasoning', e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
            >
              <option value="">CLI default</option>
              <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="API key fallback (only if you don't have a ChatGPT plan)">
              <Input type="password" placeholder={settings.openai_api_key ? 'saved ••••' : 'sk-…'} onBlur={(e) => e.target.value && saveField('openai_api_key', e.target.value)} />
            </Field>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">AI call logs: <code>{settings.ai_logs_dir}</code></p>
      </Section>

      <Section title="Document conversion — LibreOffice" subtitle="Used for pixel-accurate PDF previews and PDF export. DOCX export works without it.">
        <div className="flex items-center gap-2">
          <StatusDot ok={status.soffice} />
          <span className="text-sm text-slate-700">{status.soffice ? <>LibreOffice found <span className="text-xs text-slate-400">({status.sofficePath})</span></> : 'LibreOffice (soffice) not found'}</span>
          {!status.soffice && <code className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs">brew install --cask libreoffice</code>}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <StatusDot ok={status.pdftotext} warn />
          <span className="text-sm text-slate-700">{status.pdftotext ? 'poppler (pdftotext) found — preview hover highlights enabled' : 'poppler not found (optional — enables hover highlights)'}</span>
          {!status.pdftotext && <code className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs">brew install poppler</code>}
        </div>
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <Field label="soffice path override (optional)">
              <Input defaultValue={settings.soffice_path} placeholder="/Applications/LibreOffice.app/Contents/MacOS/soffice" onBlur={(e) => e.target.value !== settings.soffice_path && saveField('soffice_path', e.target.value)} />
            </Field>
          </div>
          <Button variant="ghost" onClick={testConversion}>Test conversion</Button>
        </div>
      </Section>

      <Section title="Tailoring guardrails">
        <Toggle label="Allow new bullets" checked={settings.allow_new_bullets === '1'} onChange={(v) => saveField('allow_new_bullets', v ? '1' : '0')} />
        <Toggle label="Aggressive trimming (suggest deletions even when under page budget)" checked={settings.aggressive_trimming === '1'} onChange={(v) => saveField('aggressive_trimming', v ? '1' : '0')} />
        <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
          <Chip tone="amber">always on</Chip> Truthfulness banner on AI assumptions — cannot be disabled.
        </div>
      </Section>

      <Section title="Export & data">
        <Field label="Export filename pattern">
          <Input defaultValue={settings.export_pattern} onBlur={(e) => e.target.value !== settings.export_pattern && saveField('export_pattern', e.target.value)} />
        </Field>
        <p className="mt-1 text-xs text-slate-400">Tokens: {'{Name} {Company} {Title}'}</p>
        <div className="mt-3 flex gap-2">
          <a href="/api/settings/backup" download>
            <Button variant="ghost" onClick={(e) => { e.preventDefault(); window.location.href = '/api/settings/backup'; }}>⬇ Backup (zip storage + db)</Button>
          </a>
          <span className="self-center text-xs text-slate-400">Data folder: <code>{settings.storage_dir}</code></span>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function StatusDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : warn ? 'bg-amber-400' : 'bg-rose-500'}`} />;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-1">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}
