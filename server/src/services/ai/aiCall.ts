/**
 * AiService — single entry point for all Codex CLI inference (PRD §4.3).
 * codex exec --json … ; robust JSON extraction; AJV validation; one auto-retry
 * with validator errors appended; queue of max 2 parallel processes; every
 * call logged to logs/ai/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';
import { AI_LOGS_DIR, AITMP_DIR } from '../../paths.js';
import { getSetting } from '../../db.js';
import { execCli, spawnCli } from '../exec.js';

const ajv = new Ajv({ allErrors: true, strict: false });

const MAX_PARALLEL = 2;
const CALL_TIMEOUT_MS = 180000;

let running = 0;
const waiters: Array<() => void> = [];

async function acquire() {
  if (running < MAX_PARALLEL) {
    running++;
    return;
  }
  await new Promise<void>((res) => waiters.push(res));
  running++;
}
function release() {
  running--;
  waiters.shift()?.();
}

export class AiError extends Error {
  constructor(
    message: string,
    public logFile?: string,
  ) {
    super(message);
  }
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
  const model = getSetting('ai_model', '');
  const reasoningEffort = getSetting('ai_reasoning', '');
  const usingApiKey = !!(getSetting('openai_api_key') || process.env.OPENAI_API_KEY);
  let version: string;
  try {
    const r = await execCli('codex', ['--version'], { timeout: 15000 });
    version = r.stdout.trim();
  } catch {
    return {
      installed: false,
      version: null,
      authenticated: false,
      model,
      reasoningEffort,
      usingApiKey,
    };
  }
  let authenticated = usingApiKey;
  if (!authenticated) {
    try {
      await execCli('codex', ['login', 'status'], { timeout: 15000 });
      authenticated = true;
    } catch {
      authenticated = false;
    }
  }
  return { installed: true, version, authenticated, model, reasoningEffort, usingApiKey };
}

/** Cheap auth probe for polling — one child process, no version check. */
export async function isAuthenticated(): Promise<boolean> {
  if (getSetting('openai_api_key') || process.env.OPENAI_API_KEY) return true;
  try {
    await execCli('codex', ['login', 'status'], { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

export interface LoginStart {
  authUrl: string | null;
  /** Diagnostic when no URL could be captured (exit code / output tail). */
  error?: string;
}

/** Pick the auth URL from codex output, preferring the real provider URL over
 *  the local callback server it also prints. Codex embeds URLs in prose, so
 *  trailing sentence punctuation must be stripped or the link 404s. */
function pickAuthUrl(output: string): string | null {
  const urls = (output.match(/https?:\/\/\S+/g) ?? []).map((u) => u.replace(/[.,;:)\]'"]+$/, ''));
  return urls.find((u) => !/localhost|127\.0\.0\.1/.test(u)) ?? urls[0] ?? null;
}

/** Spawn `codex login`, capture the auth URL. Process keeps running until auth completes. */
let loginProc: ReturnType<typeof spawnCli> | null = null;
export function startLogin(): Promise<LoginStart> {
  return new Promise((resolve) => {
    if (loginProc) {
      loginProc.kill();
      loginProc = null;
    }
    const proc = spawnCli('codex', ['login'], { stdio: ['ignore', 'pipe', 'pipe'] });
    loginProc = proc;
    let buf = '';
    let resolved = false;
    const finish = (result: LoginStart) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };
    const fail = (reason: string) =>
      finish({
        authUrl: null,
        error: `${reason}${buf.trim() ? ` — codex said: ${buf.trim().slice(-300)}` : ''}`,
      });
    const onData = (d: Buffer) => {
      buf += d.toString();
      const url = pickAuthUrl(buf);
      if (url) finish({ authUrl: url });
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', (e) => {
      loginProc = null;
      fail(`could not start codex (${e.message})`);
    });
    proc.on('exit', (code) => {
      loginProc = null;
      fail(`codex login exited (code ${code}) before printing an auth URL`);
    });
    setTimeout(() => {
      const url = pickAuthUrl(buf);
      if (url) finish({ authUrl: url });
      else fail('codex login produced no auth URL within 20s');
    }, 20000);
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
      if (typeof t === 'string' && t.trim()) {
        text = t;
        break;
      }
      // Some events ARE the payload (model emitted bare JSON as the whole line)
      if (ev && typeof ev === 'object' && !ev.type && !ev.msg && !ev.item) {
        return ev;
      }
    } catch {
      /* not a JSON line */
    }
  }
  // strip code fences, slice first { .. last }
  text = text.replace(/```(?:json)?/g, '');
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('No JSON object found in model output');
  return JSON.parse(text.slice(a, b + 1));
}

function runCodex(prompt: string): Promise<string> {
  // Empty model/effort settings = defer to the CLI's own defaults
  // (~/.codex/config.toml). Forcing a model name breaks across codex
  // releases — e.g. 0.139 rejects "gpt-5-codex" on ChatGPT-account auth.
  const model = getSetting('ai_model', '');
  const effort = getSetting('ai_reasoning', '');
  // Settings value wins; OPENAI_API_KEY env is the container-friendly fallback
  const apiKey = getSetting('openai_api_key') || process.env.OPENAI_API_KEY || '';
  // The prompt travels over STDIN (`codex exec -`), never on the command
  // line — required for the Windows shell path (see exec.ts) and immune to
  // ARG_MAX limits on long resumes/JDs.
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '-C',
    AITMP_DIR,
    ...(model ? ['-m', model] : []),
    ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
    '-',
  ];
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...(apiKey ? { OPENAI_API_KEY: apiKey } : {}) };
    const proc = spawnCli('codex', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`codex exec timed out after ${CALL_TIMEOUT_MS / 1000}s`));
    }, CALL_TIMEOUT_MS);
    proc.stdin!.on('error', () => {
      /* EPIPE if codex exits first — surfaced via exit code */
    });
    proc.stdin!.end(prompt, 'utf8');
    proc.stdout!.on('data', (d) => (out += d));
    proc.stderr!.on('data', (d) => (err += d));
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
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
        throw new AiError(
          `AI output failed schema validation twice: ${ajv.errorsText(validate.errors)}`,
          logFile,
        );
      }
    }
    log.parsed = parsed;
    return parsed as T;
  } catch (e) {
    log.error = (e as Error).message;
    throw e instanceof AiError ? e : new AiError((e as Error).message, logFile);
  } finally {
    release();
    try {
      fs.writeFileSync(logFile, JSON.stringify(log, null, 2));
    } catch {
      /* logging is best-effort */
    }
  }
}
