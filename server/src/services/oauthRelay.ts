/**
 * Codex OAuth callback relay (containers only).
 *
 * `codex login` binds its OAuth callback server to 127.0.0.1:1455, but Docker
 * delivers published ports to the container's eth0 address — so the browser
 * redirect from the host (localhost:1455/auth/callback) hits an address
 * nothing listens on and sign-in never completes. This relay listens on every
 * non-loopback interface on 1455 and pipes each connection to 127.0.0.1:1455.
 * It covers both Settings → Connect ChatGPT and `docker exec -it tailr codex
 * login`. When codex isn't mid-login, forwarded connections just get refused —
 * same as before, harmless.
 *
 * TAILR_OAUTH_RELAY=1/0 forces it on/off (default: on when a container
 * marker file exists).
 */
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';

const CODEX_OAUTH_PORT = 1455;

function shouldRelay(): boolean {
  if (process.env.TAILR_OAUTH_RELAY === '0') return false;
  if (process.env.TAILR_OAUTH_RELAY === '1') return true;
  return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
}

export function startCodexOauthRelay(): void {
  if (!shouldRelay()) return;
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && !i.internal && i.family === 'IPv4')
    .map((i) => i!.address);
  for (const address of addresses) {
    const server = net.createServer((client) => {
      const upstream = net.connect(CODEX_OAUTH_PORT, '127.0.0.1');
      client.pipe(upstream).pipe(client);
      const drop = () => {
        client.destroy();
        upstream.destroy();
      };
      upstream.on('error', drop);
      client.on('error', drop);
    });
    // EADDRINUSE = some codex version bound this interface itself; no relay needed
    server.on('error', () => {});
    server.listen(CODEX_OAUTH_PORT, address);
    server.unref();
  }
}
