/**
 * AiService — single entry point for all Codex CLI inference (PRD §4.3).
 * codex exec --json … ; robust JSON extraction; AJV validation; one auto-retry
 * with validator errors appended; queue of max 2 parallel processes; every
 * call logged to logs/ai/.
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';
import { AI_LOGS_DIR, AITMP_DIR } from '../../paths.js';
import { getSetting } from '../../db.js';

const pExecFile = promisify(execFile);
const ajv = new Ajv({ allErrors: true, strict: false });

const MAX_PARALLEL = 2;
const CALL_TIMEOUT_MS = 180000;

let running = 0;
const waiters: Array<() => void> = [];

async function acquire() {
  if (running < MAX_PARALLEL) { running++; return; }
  await new Promise<void>((res) => waiters.push(res));
  running++;
}
function release() {
  running--;
  waiters.shift()?.();
}

export class AiError extends Error {
  constructor(message: string, public logFile?: string) { super(message); }
}

export interface AiStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  model: string;
  reasoningEffort: string;
  usingApiKey: boolean;
}

export async function aiStatus(): Promise<AiStatus> {
  const model = getSetting('ai_model', 'gpt-5-codex');
  const reasoningEffort = getSetting('ai_reasoning', 'medium');
  const usingApiKey = !!getSetting('openai_api_key');
  let version: string | null = null;
  try {
    const r = await pExecFile('codex', ['--version'], { timeout: 15000 });
    version = r.stdout.trim();
  } catch {
    return { installed: false, version: null, authenticated: false, model, reasoningEffort, usingApiKey };
  }
  let authenticated = usingApiKey;
  if (!authenticated) {
    try {
      await pExecFile('codex', ['login', 'status'], { timeout: 15000 });
      authenticated = true;
    } catch {
      authenticated = false;
    }
  }
  return { installed: true, version, authenticated, model, reasoningEffort, usingApiKey };
}

/** Spawn `codex login`, capture the auth URL from stdout. Process keeps running until auth completes. */
let loginProc: ReturnType<typeof spawn> | null = null;
export function startLogin(): Promise<{ authUrl: string | null }> {
  return new Promise((resolve) => {
    if (loginProc) { loginProc.kill(); loginProc = null; }
    const proc = spawn('codex', ['login'], { stdio: ['ignore', 'pipe', 'pipe'] });
    loginProc = proc;
    let buf = '';
    let resolved = false;
    const onData = (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(/https?:\/\/\S+/);
      if (m && !resolved) { resolved = true; resolve({ authUrl: m[0] }); }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('exit', () => {
      loginProc = null;
      if (!resolved) { resolved = true; resolve({ authUrl: null }); }
    });
    setTimeout(() => { if (!resolved) { resolved = true; resolve({ authUrl: buf.match(/https?:\/\/\S+/)?.[0] ?? null }); } }, 20000);
  });
}

function extractJson(raw: string): unknown {
  // codex exec --json emits JSONL events; the last agent_message carries the text
  let text = raw;
  const lines = raw.split('\n').filter((l) => l.trim().startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const ev = JSON.parse(lines[i]);
      const t = ev?.msg?.message ?? ev?.item?.text ?? ev?.message ?? ev?.text ?? ev?.last_agent_message;
      if (typeof t === 'string' && t.trim()) { text = t; break; }
      // Some events ARE the payload (model emitted bare JSON as the whole line)
      if (ev && typeof ev === 'object' && !ev.type && !ev.msg && !ev.item) { return ev; }
    } catch { /* not a JSON line */ }
  }
  // strip code fences, slice first { .. last }
  text = text.replace(/```(?:json)?/g, '');
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('No JSON object found in model output');
  return JSON.parse(text.slice(a, b + 1));
}

function runCodex(prompt: string): Promise<string> {
  const model = getSetting('ai_model', 'gpt-5-codex');
  const effort = getSetting('ai_reasoning', 'medium');
  const apiKey = getSetting('openai_api_key');
  const args = [
    'exec', '--json', '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '-C', AITMP_DIR,
    '-m', model,
    '-c', `model_reasoning_effort="${effort}"`,
    prompt,
  ];
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...(apiKey ? { OPENAI_API_KEY: apiKey } : {}) };
    const proc = spawn('codex', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`codex exec timed out after ${CALL_TIMEOUT_MS / 1000}s`));
    }, CALL_TIMEOUT_MS);
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`codex exec exited ${code}: ${err.slice(0, 800)}`));
    });
  });
}

const validators = new Map<string, ValidateFunction>();
function getValidator(taskName: string, schema: object): ValidateFunction {
  const existing = validators.get(taskName);
  if (existing) return existing;
  const v = ajv.compile(schema);
  validators.set(taskName, v);
  return v;
}

export async function aiCall<T = unknown>(taskName: string, prompt: string, schema: object): Promise<T> {
  await acquire();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(AI_LOGS_DIR, `${stamp}-${taskName}.json`);
  const log: Record<string, unknown> = { taskName, startedAt: stamp, prompt };
  try {
    const validate = getValidator(taskName, schema);
    const fullPrompt =
      `${prompt}\n\n` +
      `OUTPUT FORMAT — CRITICAL: Respond with ONLY a single JSON object (no prose, no markdown fences) ` +
      `that validates against this JSON Schema:\n${JSON.stringify(schema)}`;

    let raw = await runCodex(fullPrompt);
    log.rawAttempt1 = raw.slice(0, 200000);
    let parsed: unknown;
    let errors: string | null = null;
    try {
      parsed = extractJson(raw);
      if (!validate(parsed)) errors = ajv.errorsText(validate.errors);
    } catch (e) {
      errors = (e as Error).message;
    }

    if (errors) {
      const retryPrompt = `${fullPrompt}\n\nYour previous output failed validation: ${errors}\nRe-emit valid JSON only.`;
      raw = await runCodex(retryPrompt);
      log.rawAttempt2 = raw.slice(0, 200000);
      parsed = extractJson(raw);
      if (!validate(parsed)) {
        throw new AiError(`AI output failed schema validation twice: ${ajv.errorsText(validate.errors)}`, logFile);
      }
    }
    log.parsed = parsed;
    return parsed as T;
  } catch (e) {
    log.error = (e as Error).message;
    throw e instanceof AiError ? e : new AiError((e as Error).message, logFile);
  } finally {
    release();
    try { fs.writeFileSync(logFile, JSON.stringify(log, null, 2)); } catch { /* logging is best-effort */ }
  }
}
