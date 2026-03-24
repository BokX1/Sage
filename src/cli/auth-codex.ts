/* eslint-disable no-console */
import http from 'http';
import { spawn } from 'child_process';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import {
  clearHostCodexAuthRecord,
  completeHostCodexAuthLogin,
  createHostCodexAuthLogin,
  extractAuthorizationCodeFromInput,
  getHostCodexAuthStatus,
} from '../features/auth/hostCodexAuthService';

type Command = 'login' | 'status' | 'clear';

interface ParsedFlags {
  noOpen: boolean;
  yes: boolean;
  input?: string;
  waitMs: number;
}

function parseCommand(argv: string[]): Command {
  const command = argv[2]?.trim();
  if (command === 'login' || command === 'status' || command === 'clear') {
    return command;
  }
  throw new Error('Usage: npm run auth:codex:<login|status|clear>');
}

function parseFlags(argv: string[]): ParsedFlags {
  const flags: ParsedFlags = { noOpen: false, yes: false, input: undefined, waitMs: 60_000 };

  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--no-open') {
      flags.noOpen = true;
      continue;
    }
    if (arg === '--yes') {
      flags.yes = true;
      continue;
    }
    if (arg === '--input') {
      flags.input = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--input=')) {
      flags.input = arg.slice('--input='.length);
      continue;
    }
    if (arg === '--wait-ms') {
      const value = Number(argv[index + 1]);
      index += 1;
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('`--wait-ms` must be a non-negative number.');
      }
      flags.waitMs = Math.floor(value);
      continue;
    }
    if (arg.startsWith('--wait-ms=')) {
      const value = Number(arg.slice('--wait-ms='.length));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('`--wait-ms` must be a non-negative number.');
      }
      flags.waitMs = Math.floor(value);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return flags;
}

function tryOpenUrl(url: string): void {
  const platform = process.platform;
  const command = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => {
    // ignore; we still print the URL below
  });
  child.unref();
}

async function promptForInput(message: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const result = await rl.question(message);
    return result.trim();
  } finally {
    rl.close();
  }
}

async function waitForLoopbackCallback(params: {
  redirectUri: string;
  expectedState: string;
  timeoutMs: number;
}): Promise<string | null> {
  if (params.timeoutMs <= 0) {
    return null;
  }

  const redirectUrl = new URL(params.redirectUri);
  const hostname = redirectUrl.hostname;
  const port = Number(redirectUrl.port || (redirectUrl.protocol === 'https:' ? '443' : '80'));
  const pathname = redirectUrl.pathname || '/';

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      server.close(() => resolve(value));
    };

    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Missing callback URL.');
        finish(null);
        return;
      }

      const requestUrl = new URL(req.url, params.redirectUri);
      if (requestUrl.pathname !== pathname) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found.');
        return;
      }

      const code = requestUrl.searchParams.get('code');
      const state = requestUrl.searchParams.get('state');
      if (!code) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<h1>Codex login failed</h1><p>Missing authorization code.</p>');
        finish(null);
        return;
      }
      if ((state ?? '').trim() !== params.expectedState) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<h1>Codex login failed</h1><p>The callback state did not match this login session.</p>');
        finish(null);
        return;
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h1>Codex login received</h1><p>You can close this window and return to Sage.</p>');
      finish(code.trim());
    });

    server.on('error', () => finish(null));
    server.listen(port, hostname, () => undefined);

    const timeoutId = setTimeout(() => finish(null), params.timeoutMs);
    timeoutId.unref?.();
  });
}

async function runLogin(flags: Pick<ParsedFlags, 'noOpen' | 'input' | 'waitMs'>): Promise<void> {
  const session = createHostCodexAuthLogin();
  console.log('Open this URL in a browser and complete the Codex login flow:\n');
  console.log(session.authorizeUrl);
  console.log('');

  if (!flags.noOpen) {
    tryOpenUrl(session.authorizeUrl);
  }

  const code = flags.input?.trim()
    ? extractAuthorizationCodeFromInput({
      input: flags.input,
      expectedState: session.state,
    })
    : await (async () => {
      console.log(
        `Waiting up to ${Math.ceil(flags.waitMs / 1000)}s for a browser callback on ${session.redirectUri}...`,
      );
      const loopbackCode = await waitForLoopbackCallback({
        redirectUri: session.redirectUri,
        expectedState: session.state,
        timeoutMs: flags.waitMs,
      });

      if (loopbackCode) {
        return loopbackCode;
      }

      console.log('');
      console.log('No loopback callback arrived. This is normal on remote/headless VMs.');
      console.log('Paste either the full redirect URL or just the code value from the browser now.');
      const rawInput = await promptForInput('Redirect URL or code: ');
      return extractAuthorizationCodeFromInput({
        input: rawInput,
        expectedState: session.state,
      });
    })();

  const result = await completeHostCodexAuthLogin({
    code,
    verifier: session.verifier,
  });

  console.log('');
  console.log('Host Codex auth saved.');
  console.log(`Account: ${result.accountId ?? 'unknown'}`);
  console.log(`Expires: ${result.expiresAt.toISOString()}`);
}

async function runStatus(): Promise<void> {
  const status = await getHostCodexAuthStatus();
  console.log(JSON.stringify(status, null, 2));
}

async function runClear(flags: Pick<ParsedFlags, 'yes'>): Promise<void> {
  if (!flags.yes) {
    const confirmation = await promptForInput('Clear the stored host Codex auth? Type "yes" to continue: ');
    if (confirmation.toLowerCase() !== 'yes') {
      console.log('Aborted.');
      return;
    }
  }

  await clearHostCodexAuthRecord();
  console.log('Host Codex auth cleared.');
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv);
  const flags = parseFlags(process.argv);

  switch (command) {
    case 'login':
      await runLogin(flags);
      return;
    case 'status':
      await runStatus();
      return;
    case 'clear':
      await runClear(flags);
      return;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
