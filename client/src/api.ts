/** Thin fetch wrapper + SSE bus for the Tailr API. */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      msg = j.message ?? j.error ?? msg;
    } catch {
      /* not json */
    }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => req<T>('GET', url),
  post: <T>(url: string, body?: unknown) => req<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => req<T>('PATCH', url, body),
  del: <T>(url: string) => req<T>('DELETE', url),
};

export async function uploadResume(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/resumes', { method: 'POST', body: fd });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(j.message ?? j.error ?? `${res.status}`, res.status);
  }
  return res.json();
}

/** Payloads broadcast on the global SSE bus, keyed by event name. */
export interface BusEvents {
  'preview.updated': { tailoredId?: string; resumeId?: string };
  'score.updated': { tailoredId: string; total: number };
  'job.updated': { jobId: string; deleted?: boolean };
  'ai.error': { jobId?: string; message: string };
}

type Listener = (data: never) => void;
const listeners = new Map<string, Set<Listener>>();
let es: EventSource | null = null;
const KNOWN_EVENTS: Array<keyof BusEvents> = [
  'preview.updated',
  'score.updated',
  'job.updated',
  'ai.error',
];

/** Subscribe to a server event (GET /api/events). Returns an unsubscribe fn. */
export function onEvent<E extends keyof BusEvents>(
  event: E,
  fn: (data: BusEvents[E]) => void,
): () => void {
  if (!es) {
    es = new EventSource('/api/events');
    for (const ev of KNOWN_EVENTS) {
      es.addEventListener(ev, (e) => {
        const data = JSON.parse((e as MessageEvent).data) as never;
        listeners.get(ev)?.forEach((l) => l(data));
      });
    }
  }
  (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(fn as Listener);
  return () => listeners.get(event)?.delete(fn as Listener);
}

export interface SsePostHandlers {
  onStage?: (d: { stage: string }) => void;
  onDone?: (d: { suggestions: unknown[] }) => void;
  onError?: (msg: string) => void;
}

/** POST that streams SSE progress (ai-tailor). */
export async function ssePost(url: string, handlers: SsePostHandlers) {
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok || !res.body) {
    handlers.onError?.(`Request failed (${res.status})`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const evMatch = chunk.match(/^event: (.+)$/m);
      const dataMatch = chunk.match(/^data: (.+)$/m);
      if (!evMatch || !dataMatch) continue;
      const data = JSON.parse(dataMatch[1]);
      if (evMatch[1] === 'stage') handlers.onStage?.(data);
      else if (evMatch[1] === 'done') handlers.onDone?.(data);
      else if (evMatch[1] === 'error') handlers.onError?.(data.message ?? 'AI call failed');
    }
  }
}
