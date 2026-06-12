import { useState } from 'react';
import { api } from '../../api';
import type { Stage } from '../../types';
import { Button, Field, Input, Modal, Spinner, TextArea, toast } from '../ui';

/** Quick-create modal; a pasted JD kicks off background analysis (PRD §9.1). */
export default function AddJobModal({
  stage,
  onClose,
  onCreated,
}: {
  stage: Stage;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [url, setUrl] = useState('');
  const [jd, setJd] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim() && !company.trim()) {
      toast('Add at least a title or company', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/jobs', { stageId: stage.id, title, company, url, jdText: jd });
      if (jd.trim()) toast('Job added — analyzing JD in the background', 'success');
      onCreated();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <>
          Add job to <span className="text-brand-600">{stage.name}</span>
        </>
      }
      wide
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Job title">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Senior Backend Engineer"
          />
        </Field>
        <Field label="Company">
          <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Corp" />
        </Field>
        <div className="col-span-2">
          <Field label="Job posting URL">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Job description (paste — analyzed automatically)">
            <TextArea
              rows={8}
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder="Paste the full job description here…"
            />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? <Spinner /> : 'Add job'}
        </Button>
      </div>
    </Modal>
  );
}
