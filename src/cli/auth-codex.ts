/* eslint-disable no-console */
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

function parseCommand(argv: string[]): Command {
  const command = argv[2]?.trim();
  if (command === 'login' || command === 'status' || command === 'clear') {
    return command;
  }
  throw new Error('Usage: npm run auth:codex:<login|status|clear>');
}

function parseFlags(argv: string[]): { noOpen: boolean; yes: boolean; input?: string } {
  const flags = { noOpen: false, yes: false, input: undefined as string | undefined };

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

async function runLogin(flags: { noOpen: boolean; input?: string }): Promise<void> {
  const session = createHostCodexAuthLogin();
  console.log('Open this URL in a browser and complete the Codex login flow:\n');
  console.log(session.authorizeUrl);
  console.log('');
  console.log('When the browser redirects, paste either the full redirect URL or just the code value here.');

  if (!flags.noOpen) {
    tryOpenUrl(session.authorizeUrl);
  }

  const rawInput =
    flags.input ??
    (await promptForInput('Redirect URL or code: '));
  const code = extractAuthorizationCodeFromInput({
    input: rawInput,
    expectedState: session.state,
  });

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

async function runClear(flags: { yes: boolean }): Promise<void> {
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
