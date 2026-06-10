import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { JobDetail, Resume, JdAnalysis } from '../types';
import { Button, Chip, Field, Input, Spinner, TextArea, toast } from './ui';

const TABS = ['Details', 'Resume', 'Activities', 'Contacts'] as const;

export default function JobDrawer({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Details');

  const load = useCallback(() => api.get<JobDetail>(`/api/jobs/${jobId}`).then(setJob).catch((e) => toast(e.message, 'error')), [jobId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-slate-900/30" />
      <div
        className="absolute right-0 top-0 flex h-full w-[480px] max-w-[95vw] flex-col bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!job ? (
          <div className="flex flex-1 items-center justify-center"><Spinner className="h-6 w-6 text-brand-500" /></div>
        ) : (
          <>
            <div className="border-b border-slate-100 px-5 pt-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">{job.title || 'Untitled role'}</h2>
                  <div className="text-sm text-slate-500">
                    {job.company}{job.location ? ` · ${job.location}` : ''}
                    {job.url && <> · <a href={job.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">posting ↗</a></>}
                  </div>
                </div>
                <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">✕</button>
              </div>
              <div className="mt-3 flex gap-1">
                {TABS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`rounded-t-lg px-3 py-2 text-sm font-medium ${tab === t ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {t}
                    {t === 'Activities' && job.activities.length > 0 && <span className="ml-1 text-xs text-slate-400">{job.activities.length}</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto thin-scroll px-5 py-4">
              {tab === 'Details' && <DetailsTab job={job} reload={load} />}
              {tab === 'Resume' && <ResumeTab job={job} />}
              {tab === 'Activities' && <ActivitiesTab job={job} reload={load} />}
              {tab === 'Contacts' && <ContactsTab job={job} reload={load} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DetailsTab({ job, reload }: { job: JobDetail; reload: () => void }) {
  const [form, setForm] = useState({ title: job.title, company: job.company, location: job.location, url: job.url, salary: job.salary, jdText: job.jd_text });
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/api/jobs/${job.id}`, form);
      toast('Saved', 'success');
      reload();
    } catch (e) { toast((e as Error).message, 'error'); }
    setSaving(false);
  }

  async function analyze() {
    setAnalyzing(true);
    try {
      await api.post(`/api/jobs/${job.id}/analyze`);
      toast('JD analyzed', 'success');
      reload();
    } catch (e) { toast((e as Error).message, 'error'); }
    setAnalyzing(false);
  }

  async function archive() {
    await api.patch(`/api/jobs/${job.id}`, { isArchived: job.is_archived ? 0 : 1 });
    reload();
  }
  async function remove() {
    if (!window.confirm('Delete this job and all its activities, contacts and tailored resumes?')) return;
    await api.del(`/api/jobs/${job.id}`);
    toast('Job deleted');
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title"><Input value={form.title} onChange={set('title')} /></Field>
        <Field label="Company"><Input value={form.company} onChange={set('company')} /></Field>
        <Field label="Location"><Input value={form.location} onChange={set('location')} /></Field>
        <Field label="Salary"><Input value={form.salary} onChange={set('salary')} placeholder="$140k–160k" /></Field>
      </div>
      <Field label="URL"><Input value={form.url} onChange={set('url')} /></Field>
      <Field label="Job description">
        <TextArea rows={8} value={form.jdText} onChange={set('jdText')} placeholder="Paste the JD…" />
      </Field>
      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving}>{saving ? <Spinner /> : 'Save'}</Button>
        <Button variant="ghost" onClick={analyze} disabled={analyzing || !form.jdText.trim()}>
          {analyzing ? <><Spinner /> Analyzing…</> : job.jd_analysis ? '↻ Re-analyze JD' : '✦ Analyze JD'}
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="subtle" onClick={archive}>{job.is_archived ? 'Unarchive' : 'Archive'}</Button>
          <Button variant="danger" onClick={remove}>Delete</Button>
        </div>
      </div>
      {job.jd_analysis && <JdAccordion analysis={job.jd_analysis} />}
    </div>
  );
}

export function JdAccordion({ analysis, verdictOf }: { analysis: JdAnalysis; verdictOf?: (id: string) => 'covered' | 'partial' | 'missing' | undefined }) {
  const groups = [
    { name: 'Qualifications', items: analysis.qualifications, meta: (i: any) => i.priority },
    { name: 'Responsibilities', items: analysis.responsibilities, meta: (i: any) => i.priority },
    { name: 'Keywords', items: analysis.keywords, meta: (i: any) => i.type },
  ];
  const [open, setOpen] = useState<string | null>('Qualifications');
  const dot = (v?: string) =>
    v === 'covered' ? 'bg-emerald-500' : v === 'partial' ? 'bg-amber-500' : v === 'missing' ? 'bg-rose-500' : 'bg-slate-300';
  return (
    <div className="rounded-xl border border-slate-200">
      <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Extracted · target: <span className="text-brand-600 normal-case">{analysis.titleEssence}</span>
      </div>
      {groups.map((g) => (
        <div key={g.name} className="border-b border-slate-100 last:border-0">
          <button className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => setOpen(open === g.name ? null : g.name)}>
            <span>{g.name} <span className="text-xs text-slate-400">{g.items.length}</span></span>
            <span className="text-slate-400">{open === g.name ? '▾' : '▸'}</span>
          </button>
          {open === g.name && (
            <ul className="space-y-1 px-3 pb-2">
              {g.items.map((i) => (
                <li key={i.id} className="flex items-start gap-2 text-sm text-slate-600">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot(verdictOf?.(i.id))}`} />
                  <span>{i.text} <span className="text-xs text-slate-400">({g.meta(i)})</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function ResumeTab({ job }: { job: JobDetail }) {
  const navigate = useNavigate();
  const [resumes, setResumes] = useState<Resume[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => { api.get<Resume[]>('/api/resumes').then(setResumes).catch(() => setResumes([])); }, []);

  async function createTailored(resumeId: string) {
    setCreating(true);
    try {
      const { id } = await api.post<{ id: string }>(`/api/jobs/${job.id}/tailored`, { resumeId });
      navigate(`/studio/${id}`);
    } catch (e) {
      toast((e as Error).message, 'error');
      setCreating(false);
    }
  }

  return (
    <div className="space-y-3">
      {job.tailored.length > 0 && (
        <div className="space-y-2">
          {job.tailored.map((t) => (
            <button key={t.id} onClick={() => navigate(`/studio/${t.id}`)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50/40">
              <span className="text-xl">📄</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-700">{t.resume_name}</span>
                <span className="text-xs text-slate-400">{new Date(t.created_at).toLocaleDateString()} · {t.status}</span>
              </span>
              {t.match_score_before != null && (
                <Chip tone={t.status === 'finalized' ? 'green' : 'brand'}>
                  {t.match_score_before}{t.match_score_after != null && t.match_score_after !== t.match_score_before ? ` → ${t.match_score_after}` : ''}
                </Chip>
              )}
            </button>
          ))}
        </div>
      )}

      {!picking ? (
        <Button onClick={() => setPicking(true)} className="w-full">✂️ Tailor resume for this job</Button>
      ) : resumes === null ? <Spinner /> : resumes.length === 0 ? (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          No base resume yet. <button className="font-semibold underline" onClick={() => navigate('/resumes')}>Upload your DOCX resume</button> first.
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Choose base resume</div>
          {resumes.map((r) => (
            <button key={r.id} disabled={creating} onClick={() => createTailored(r.id)} className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-brand-300 hover:bg-brand-50/40 disabled:opacity-50">
              📄 {r.name} {r.page_count && <span className="text-xs text-slate-400">· {r.page_count}p</span>}
              {creating && <Spinner className="ml-auto h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      )}
      {!job.jd_text?.trim() && (
        <p className="text-xs text-slate-400">Tip: paste the job description in Details first — tailoring needs it.</p>
      )}
    </div>
  );
}

const ACT_ICONS: Record<string, string> = { applied: '📨', interview: '🎙', follow_up: '🔔', note: '📝', stage_change: '↪', export: '📤' };

function ActivitiesTab({ job, reload }: { job: JobDetail; reload: () => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('note');
  const [due, setDue] = useState('');

  async function add() {
    if (!title.trim()) return;
    await api.post(`/api/jobs/${job.id}/activities`, { type, title, dueAt: due ? new Date(due).getTime() : null });
    setTitle(''); setDue('');
    reload();
  }
  async function toggle(id: string, done: boolean) {
    await api.patch(`/api/activities/${id}`, { done });
    reload();
  }
  async function remove(id: string) {
    await api.del(`/api/activities/${id}`);
    reload();
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
          <option value="note">Note</option>
          <option value="follow_up">Follow-up</option>
          <option value="interview">Interview</option>
          <option value="applied">Applied</option>
        </select>
        <Input placeholder="Add an activity…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="!w-36" />
        <Button onClick={add}>Add</Button>
      </div>
      <ul className="space-y-1.5">
        {job.activities.map((a) => {
          const overdue = a.due_at && !a.done && a.due_at < Date.now();
          return (
            <li key={a.id} className={`group flex items-start gap-2.5 rounded-lg border px-3 py-2 ${overdue ? 'border-rose-200 bg-rose-50/50' : 'border-slate-100'}`}>
              <span className="mt-0.5">{ACT_ICONS[a.type] ?? '•'}</span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${a.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{a.title}</div>
                <div className="text-xs text-slate-400">
                  {new Date(a.created_at).toLocaleDateString()}
                  {a.due_at && <span className={overdue ? 'ml-1 font-medium text-rose-500' : 'ml-1'}>· due {new Date(a.due_at).toLocaleDateString()}</span>}
                </div>
              </div>
              {a.type !== 'stage_change' && (
                <input type="checkbox" checked={!!a.done} onChange={(e) => toggle(a.id, e.target.checked)} className="mt-1 accent-brand-600" title="Done" />
              )}
              <button onClick={() => remove(a.id)} className="invisible text-slate-300 hover:text-rose-500 group-hover:visible">✕</button>
            </li>
          );
        })}
        {job.activities.length === 0 && <p className="py-4 text-center text-sm text-slate-400">No activity yet — moves between stages are logged automatically.</p>}
      </ul>
    </div>
  );
}

function ContactsTab({ job, reload }: { job: JobDetail; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', role: '', email: '', linkedin: '', notes: '' });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function add() {
    if (!form.name.trim()) return;
    await api.post(`/api/jobs/${job.id}/contacts`, form);
    setForm({ name: '', role: '', email: '', linkedin: '', notes: '' });
    setAdding(false);
    reload();
  }

  return (
    <div className="space-y-3">
      {job.contacts.map((c) => (
        <div key={c.id} className="group rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{c.name.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-700">{c.name}</div>
              <div className="text-xs text-slate-400">{c.role}</div>
            </div>
            <button onClick={async () => { await api.del(`/api/contacts/${c.id}`); reload(); }} className="invisible text-slate-300 hover:text-rose-500 group-hover:visible">✕</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
            {c.email && <a className="text-brand-600 hover:underline" href={`mailto:${c.email}`}>{c.email}</a>}
            {c.linkedin && <a className="text-brand-600 hover:underline" href={c.linkedin} target="_blank" rel="noreferrer">LinkedIn ↗</a>}
          </div>
          {c.notes && <p className="mt-1 text-xs text-slate-500">{c.notes}</p>}
        </div>
      ))}
      {!adding ? (
        <Button variant="ghost" onClick={() => setAdding(true)} className="w-full">＋ Add contact</Button>
      ) : (
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Input autoFocus placeholder="Name" value={form.name} onChange={set('name')} />
            <Input placeholder="Role (Recruiter…)" value={form.role} onChange={set('role')} />
            <Input placeholder="Email" value={form.email} onChange={set('email')} />
            <Input placeholder="LinkedIn URL" value={form.linkedin} onChange={set('linkedin')} />
          </div>
          <TextArea rows={2} placeholder="Notes" value={form.notes} onChange={set('notes')} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={add}>Add contact</Button>
          </div>
        </div>
      )}
    </div>
  );
}
