import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadResume, onEvent } from '../api';
import type { Resume } from '../types';
import { Button, EmptyState, Modal, Spinner, toast } from '../components/ui';

export default function ResumesView() {
  const [resumes, setResumes] = useState<Resume[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pdfRejected, setPdfRejected] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      api
        .get<Resume[]>('/api/resumes')
        .then(setResumes)
        .catch((e) => toast(e.message, 'error')),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => onEvent('preview.updated', () => load()), [load]);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (/\.pdf$/i.test(file.name)) {
      setPdfRejected(true);
      return;
    }
    setUploading(true);
    try {
      await uploadResume(file);
      toast('Resume uploaded and parsed', 'success');
      load();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('formatting can be preserved')) setPdfRejected(true);
      else toast(msg, 'error');
    }
    setUploading(false);
  }

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto thin-scroll px-6 py-8">
      <h1 className="text-xl font-bold text-slate-800">Resumes</h1>
      <p className="mt-1 text-sm text-slate-500">
        Upload your own DOCX. Tailr never re-templates it — every AI edit only touches the text of
        targeted lines.
      </p>

      <div
        className={`mt-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 transition-colors ${
          dragOver ? 'border-brand-400 bg-brand-50' : 'border-slate-300 bg-white hover:border-brand-300'
        }`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        {uploading ? (
          <Spinner className="h-8 w-8 text-brand-500" />
        ) : (
          <>
            <div className="text-4xl">📄</div>
            <div className="mt-2 text-sm font-semibold text-slate-700">Drop your .docx resume here</div>
            <div className="text-xs text-slate-400">or click to browse · max 10 MB</div>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".docx"
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      <div className="mt-6 space-y-2">
        {resumes === null ? (
          <Spinner className="h-5 w-5 text-brand-500" />
        ) : resumes.length === 0 ? (
          <EmptyState icon="🪡" title="No resumes yet">
            Your uploaded resume becomes the base for every tailored version.
          </EmptyState>
        ) : (
          resumes.map((r) => <ResumeRow key={r.id} resume={r} onDeleted={load} />)
        )}
      </div>

      <Modal open={pdfRejected} onClose={() => setPdfRejected(false)} title="DOCX needed for tailoring">
        <p className="text-sm leading-relaxed text-slate-600">
          Tailoring requires the editable <b>.docx</b> so your formatting can be preserved exactly.
          PDF→DOCX conversion always degrades layout, which breaks Tailr's core promise.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Export your resume as <b>.docx</b> (Word: File → Save As · Google Docs: File → Download →
          Microsoft Word) and re-upload.
        </p>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setPdfRejected(false)}>Got it</Button>
        </div>
      </Modal>
    </div>
  );
}

function ResumeRow({ resume, onDeleted }: { resume: Resume; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  async function remove() {
    if (!window.confirm(`Delete "${resume.name}"?`)) return;
    try {
      await api.del(`/api/resumes/${resume.id}`);
      onDeleted();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-3 p-4">
        <span className="text-2xl">📄</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-800">{resume.name}</div>
          <div className="text-xs text-slate-400">
            Uploaded {new Date(resume.created_at).toLocaleDateString()}
            {resume.page_count ? ` · ${resume.page_count} page${resume.page_count > 1 ? 's' : ''}` : ''}
          </div>
        </div>
        <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide preview' : 'Preview'}
        </Button>
        <Button variant="subtle" onClick={remove}>
          Delete
        </Button>
      </div>
      {open && (
        <div className="border-t border-slate-100 p-3">
          <iframe
            title="preview"
            src={`/api/resumes/${resume.id}/preview.pdf`}
            className="h-[560px] w-full rounded-lg border border-slate-200"
          />
          <p className="mt-1 text-center text-xs text-slate-400">
            Preview requires LibreOffice — see Settings if blank.
          </p>
        </div>
      )}
    </div>
  );
}
