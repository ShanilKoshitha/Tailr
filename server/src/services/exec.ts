/**
 * Cross-platform CLI spawning. On Windows, npm-installed CLIs (codex) are
 * .cmd shims that Node refuses to spawn without a shell (EINVAL since the
 * CVE-2024-27980 hardening). We therefore run through cmd.exe there — which
 * is only safe because NOTHING user-controlled goes on the command line:
 * prompts travel over stdin, and the remaining args (paths, model names)
 * are quoted defensively.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

const isWin = process.platform === 'win32';

/** Quote a single argument for cmd.exe. */
function winQuote(s: string): string {
  if (!/[\s"^&|<>()%!]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function spawnCli(cmd: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
  if (isWin) {
    const line = [cmd, ...args].map(winQuote).join(' ');
    return spawn(line, { ...opts, shell: true });
  }
  return spawn(cmd, args, opts);
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/** Promise wrapper over spawnCli; rejects on non-zero exit or spawn error. */
export function execCli(
  cmd: string,
  args: string[],
  opts: { timeout?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawnCli(cmd, args, { env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = opts.timeout
      ? setTimeout(() => {
          proc.kill('SIGKILL');
          reject(new Error(`${cmd} timed out after ${opts.timeout}ms`));
        }, opts.timeout)
      : null;
    proc.stdout?.on('data', (d) => (stdout += d));
    proc.stderr?.on('data', (d) => (stderr += d));
    proc.on('error', (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    proc.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 800)}`));
    });
  });
}
