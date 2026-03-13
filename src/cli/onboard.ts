/* eslint-disable no-console */
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const REQUIRED_KEYS = [
  'DISCORD_TOKEN',
  'DISCORD_APP_ID',
  'DATABASE_URL',
  'SECRET_ENCRYPTION_KEY',
  'AI_PROVIDER_BASE_URL',
  'AI_PROVIDER_API_KEY',
  'AI_PROVIDER_MAIN_AGENT_MODEL',
  'AI_PROVIDER_PROFILE_AGENT_MODEL',
  'AI_PROVIDER_SUMMARY_AGENT_MODEL',
] as const;

type CliArgs = {
  help?: boolean;
  yes?: boolean;
  nonInteractive?: boolean;
  dryRun?: boolean;
  startDocker?: boolean;
  migrate?: boolean;
  doctor?: boolean;
  envFile: string;
  envExample: string;
  discordToken?: string;
  discordAppId?: string;
  databaseUrl?: string;
  apiKey?: string;
  model?: string;
  secretEncryptionKey?: string;
};

type PromptTools = {
  intro: (message: string) => void;
  outro: (message: string) => void;
  note: (message: string, title?: string) => void;
  warn: (message: string) => void;
  askText: (message: string, defaultValue?: string, validate?: (value: string) => string | undefined) => Promise<string>;
  askSecret: (message: string, required?: boolean) => Promise<string>;
  askConfirm: (message: string, initialValue?: boolean) => Promise<boolean>;
  askSelect: (
    message: string,
    options: Array<{ value: string; label: string; hint?: string }>,
    initialValue?: string,
  ) => Promise<string>;
  spinner: () => {
    start: (message: string) => void;
    stop: (message?: string) => void;
  };
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    envFile: '.env',
    envExample: '.env.example',
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      args.yes = true;
      continue;
    }
    if (arg === '--non-interactive') {
      args.nonInteractive = true;
      continue;
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--start-docker') {
      args.startDocker = true;
      continue;
    }
    if (arg === '--migrate') {
      args.migrate = true;
      continue;
    }
    if (arg === '--doctor') {
      args.doctor = true;
      continue;
    }
    if (arg === '--env-file') {
      args.envFile = expectValue(argv, ++i, '--env-file');
      continue;
    }
    if (arg.startsWith('--env-file=')) {
      args.envFile = arg.slice('--env-file='.length);
      continue;
    }
    if (arg === '--env-example') {
      args.envExample = expectValue(argv, ++i, '--env-example');
      continue;
    }
    if (arg.startsWith('--env-example=')) {
      args.envExample = arg.slice('--env-example='.length);
      continue;
    }
    if (arg === '--discord-token') {
      args.discordToken = expectValue(argv, ++i, '--discord-token');
      continue;
    }
    if (arg.startsWith('--discord-token=')) {
      args.discordToken = arg.slice('--discord-token='.length);
      continue;
    }
    if (arg === '--discord-app-id') {
      args.discordAppId = expectValue(argv, ++i, '--discord-app-id');
      continue;
    }
    if (arg.startsWith('--discord-app-id=')) {
      args.discordAppId = arg.slice('--discord-app-id='.length);
      continue;
    }
    if (arg === '--database-url') {
      args.databaseUrl = expectValue(argv, ++i, '--database-url');
      continue;
    }
    if (arg.startsWith('--database-url=')) {
      args.databaseUrl = arg.slice('--database-url='.length);
      continue;
    }
    if (arg === '--api-key') {
      args.apiKey = expectValue(argv, ++i, '--api-key');
      continue;
    }
    if (arg.startsWith('--api-key=')) {
      args.apiKey = arg.slice('--api-key='.length);
      continue;
    }
    if (arg === '--model') {
      args.model = expectValue(argv, ++i, '--model');
      continue;
    }
    if (arg.startsWith('--model=')) {
      args.model = arg.slice('--model='.length);
      continue;
    }
    if (arg === '--secret-encryption-key') {
      args.secretEncryptionKey = expectValue(argv, ++i, '--secret-encryption-key');
      continue;
    }
    if (arg.startsWith('--secret-encryption-key=')) {
      args.secretEncryptionKey = arg.slice('--secret-encryption-key='.length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

function expectValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function printHelp() {
  console.log(`Sage Onboarding Wizard

Usage:
  npm run onboard -- [options]

Options:
  --discord-token <token>          Discord bot token
  --discord-app-id <id>            Discord application ID
  --database-url <url>             PostgreSQL connection string
  --api-key <key>                  AI provider API key
  --model <id>                     AI provider main agent model
  --secret-encryption-key <hex>    64-hex encryption key
  --env-file <path>                Target env file (default: .env)
  --env-example <path>             Env template file (default: .env.example)
  --dry-run                        Validate and preview without writing files
  --start-docker                   Run docker compose for db + tika after setup
  --migrate                        Run npm run db:migrate after setup
  --doctor                         Run npm run doctor after setup
  --yes                            Auto-confirm overwrite prompts
  --non-interactive                Fail on required missing values without prompts
  -h, --help                       Show this help`);
}

function parseEnvFile(filePath: string): Map<string, string> {
  if (!fs.existsSync(filePath)) return new Map<string, string>();
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = dotenv.parse(content);
  return new Map(Object.entries(parsed));
}

function parseEnvExampleLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function resolveComposeValue(value: string): string {
  const match = value.trim().match(/^\$\{([A-Z0-9_]+)(?::-([^}]*))?\}$/);
  if (!match) return value;
  const fallback = match[2] ?? '';
  return fallback;
}

function getDockerComposeDefaults(repoRoot: string) {
  const composePath = path.join(repoRoot, 'config', 'services', 'core', 'docker-compose.yml');
  if (!fs.existsSync(composePath)) return null;

  const content = fs.readFileSync(composePath, 'utf8');
  const user = content.match(/POSTGRES_USER:\s*([^\s]+)/)?.[1] ?? 'postgres';
  const passwordRaw = content.match(/POSTGRES_PASSWORD:\s*([^\s]+)/)?.[1] ?? 'password';
  const password = resolveComposeValue(passwordRaw.replace(/^['"]|['"]$/g, ''));
  const db = content.match(/POSTGRES_DB:\s*([^\s]+)/)?.[1] ?? 'sage';
  const port = content.match(/127\.0\.0\.1:(\d+):5432/)?.[1] ?? '5432';

  return {
    user,
    password,
    db,
    port,
  };
}

function formatValue(value: string): string {
  if (value.length === 0) return '';
  if (/[\s#'"]/.test(value)) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}

function buildEnvOutput(
  exampleLines: string[],
  values: Map<string, string>,
  extraEntries: Array<[string, string]>,
): string {
  const output = exampleLines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) return line;
    const key = match[1];
    const value = values.get(key);
    if (value === undefined) return line;
    return `${key}=${formatValue(value)}`;
  });

  if (extraEntries.length > 0) {
    output.push('');
    output.push('# Additional keys from existing env file');
    for (const [key, value] of extraEntries) {
      output.push(`${key}=${formatValue(value)}`);
    }
  }

  return output.join('\n');
}

function writeEnvFileAtomic(filePath: string, output: string) {
  const dir = path.dirname(filePath);
  const tempDir = fs.mkdtempSync(path.join(dir, '.env-write-'));
  const tempPath = path.join(tempDir, path.basename(filePath));
  const fd = fs.openSync(tempPath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${output}\n`, { encoding: 'utf8' });
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tempPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort only.
  }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best effort only.
  }
}

function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}

function isValidEncryptionKey(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

function maskValue(value: string | undefined): string {
  if (!value) return '[NOT SET]';
  return '[SET]';
}

function runCommand(command: string, cwd: string) {
  execSync(command, { cwd, stdio: 'inherit' });
}

function buildPromptFallback(): PromptTools {
  return {
    intro: (message: string) => console.log(message),
    outro: (message: string) => console.log(message),
    note: (message: string, title?: string) => {
      if (title) {
        console.log(`${title}:\n${message}`);
      } else {
        console.log(message);
      }
    },
    warn: (message: string) => console.warn(message),
    askText: async () => {
      throw new Error('Interactive prompt unavailable in non-interactive mode.');
    },
    askSecret: async () => {
      throw new Error('Interactive prompt unavailable in non-interactive mode.');
    },
    askConfirm: async (_message: string, initialValue = false) => initialValue,
    askSelect: async () => {
      throw new Error('Interactive prompt unavailable in non-interactive mode.');
    },
    spinner: () => ({
      start: (message: string) => console.log(message),
      stop: (message?: string) => {
        if (message) console.log(message);
      },
    }),
  };
}

async function buildPromptTools(interactive: boolean): Promise<PromptTools> {
  if (!interactive) return buildPromptFallback();

  const clack = await import('@clack/prompts');
  return {
    intro: (message: string) => clack.intro(message),
    outro: (message: string) => clack.outro(message),
    note: (message: string, title?: string) => clack.note(message, title),
    warn: (message: string) => clack.log.warn(message),
    askText: async (message: string, defaultValue?: string, validate?: (value: string) => string | undefined) => {
      const result = await clack.text({
        message,
        placeholder: defaultValue,
        defaultValue,
        validate: (value) => {
          const trimmed = (value ?? '').trim();
          if (!trimmed) return 'Value is required.';
          return validate?.(trimmed);
        },
      });
      if (clack.isCancel(result)) throw new Error('Setup cancelled.');
      return String(result).trim();
    },
    askSecret: async (message: string, required = false) => {
      const result = await clack.password({
        message,
        validate: (value) => {
          const trimmed = (value ?? '').trim();
          if (required && !trimmed) return 'Value is required.';
          return undefined;
        },
      });
      if (clack.isCancel(result)) throw new Error('Setup cancelled.');
      return String(result).trim();
    },
    askConfirm: async (message: string, initialValue = true) => {
      const result = await clack.confirm({
        message,
        initialValue,
      });
      if (clack.isCancel(result)) throw new Error('Setup cancelled.');
      return !!result;
    },
    askSelect: async (
      message: string,
      options: Array<{ value: string; label: string; hint?: string }>,
      initialValue?: string,
    ) => {
      const result = await clack.select({
        message,
        options,
        initialValue,
      });
      if (clack.isCancel(result)) throw new Error('Setup cancelled.');
      return String(result);
    },
    spinner: () => clack.spinner(),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const repoRoot = process.cwd();
  const envPath = path.resolve(repoRoot, args.envFile);
  const envExamplePath = path.resolve(repoRoot, args.envExample);
  const interactive = !args.nonInteractive && !!process.stdin.isTTY && !!process.stdout.isTTY;
  const prompts = await buildPromptTools(interactive);

  prompts.intro('Sage Onboarding Wizard');

  if (!fs.existsSync(envExamplePath)) {
    throw new Error(`${envExamplePath} not found. Restore .env.example before onboarding.`);
  }

  const envExists = fs.existsSync(envPath);
  const existingEnv = parseEnvFile(envPath);
  const exampleLines = parseEnvExampleLines(fs.readFileSync(envExamplePath, 'utf8'));
  const values = new Map(existingEnv);

  if (args.discordToken) values.set('DISCORD_TOKEN', args.discordToken);
  if (args.discordAppId) values.set('DISCORD_APP_ID', args.discordAppId);
  if (args.databaseUrl) values.set('DATABASE_URL', args.databaseUrl);
  if (args.apiKey !== undefined) values.set('AI_PROVIDER_API_KEY', args.apiKey);
  if (args.secretEncryptionKey) {
    if (!isValidEncryptionKey(args.secretEncryptionKey)) {
      throw new Error('SECRET_ENCRYPTION_KEY must be exactly 64 hex characters.');
    }
    values.set('SECRET_ENCRYPTION_KEY', args.secretEncryptionKey);
  }
  if (args.model) values.set('AI_PROVIDER_MAIN_AGENT_MODEL', args.model);

  const dockerDefaults = getDockerComposeDefaults(repoRoot);
  const dockerDatabaseUrl = dockerDefaults
    ? `postgresql://${dockerDefaults.user}:${dockerDefaults.password}@localhost:${dockerDefaults.port}/${dockerDefaults.db}?schema=public`
    : 'postgresql://postgres:password@localhost:5432/sage?schema=public';

  const shouldPrompt = (key: string) => interactive && !args.yes && values.has(key);

  if (!values.get('DISCORD_TOKEN') || (shouldPrompt('DISCORD_TOKEN') && (await prompts.askConfirm('DISCORD_TOKEN already exists. Overwrite?', false)))) {
    if (args.nonInteractive && !values.get('DISCORD_TOKEN')) {
      throw new Error('DISCORD_TOKEN is required in non-interactive mode.');
    }
    if (!args.nonInteractive && !args.discordToken) {
      const token = await prompts.askSecret('Discord Bot Token', true);
      values.set('DISCORD_TOKEN', token);
    }
  }

  if (
    !values.get('DISCORD_APP_ID') ||
    (shouldPrompt('DISCORD_APP_ID') && (await prompts.askConfirm('DISCORD_APP_ID already exists. Overwrite?', false)))
  ) {
    if (!args.nonInteractive && !args.discordAppId) {
      const appId = await prompts.askText('Discord Application ID', values.get('DISCORD_APP_ID'), (value) => {
        if (!/^\d+$/.test(value)) return 'Discord application ID should be numeric.';
        return undefined;
      });
      values.set('DISCORD_APP_ID', appId);
    }
  }

  if (
    !values.get('DATABASE_URL') ||
    (shouldPrompt('DATABASE_URL') && (await prompts.askConfirm('DATABASE_URL already exists. Overwrite?', false)))
  ) {
    if (args.nonInteractive || args.databaseUrl) {
      if (!values.get('DATABASE_URL')) values.set('DATABASE_URL', dockerDatabaseUrl);
    } else {
      const choice = await prompts.askSelect('Configure DATABASE_URL', [
        { value: 'docker', label: 'Use local Docker default', hint: dockerDatabaseUrl },
        { value: 'manual', label: 'Paste DATABASE_URL manually' },
      ]);
      if (choice === 'docker') {
        values.set('DATABASE_URL', dockerDatabaseUrl);
      } else {
        values.set(
          'DATABASE_URL',
          await prompts.askText('DATABASE_URL', values.get('DATABASE_URL')),
        );
      }
    }
  }

  const existingKey = values.get('SECRET_ENCRYPTION_KEY');
  if (existingKey && !isValidEncryptionKey(existingKey)) {
    prompts.warn('Existing SECRET_ENCRYPTION_KEY is invalid and will be replaced.');
    values.set('SECRET_ENCRYPTION_KEY', generateEncryptionKey());
  } else if (!existingKey) {
    values.set('SECRET_ENCRYPTION_KEY', generateEncryptionKey());
  }

  const ensureTextValue = async (
    key: string,
    promptMessage: string,
    providedValue?: string,
    validate?: (value: string) => string | undefined,
  ) => {
    if (
      values.get(key) &&
      (!interactive || args.yes || !(await prompts.askConfirm(`${key} already exists. Overwrite?`, false)))
    ) {
      return;
    }

    if (providedValue !== undefined) {
      values.set(key, providedValue.trim());
      return;
    }

    if (args.nonInteractive) {
      throw new Error(`${key} is required in non-interactive mode.`);
    }

    const nextValue = await prompts.askText(promptMessage, values.get(key), validate);
    values.set(key, nextValue.trim());
  };

  await ensureTextValue('AI_PROVIDER_BASE_URL', 'AI provider base URL (OpenAI-compatible)', undefined, (value) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'URL must use http:// or https://';
      }
      return undefined;
    } catch {
      return 'Enter a valid URL.';
    }
  });

  if (
    !values.get('AI_PROVIDER_API_KEY') ||
    (shouldPrompt('AI_PROVIDER_API_KEY') &&
      (await prompts.askConfirm('AI_PROVIDER_API_KEY already exists. Overwrite?', false)))
  ) {
    if (args.apiKey !== undefined) {
      values.set('AI_PROVIDER_API_KEY', args.apiKey.trim());
    } else if (args.nonInteractive) {
      throw new Error('AI_PROVIDER_API_KEY is required in non-interactive mode.');
    } else {
      values.set(
        'AI_PROVIDER_API_KEY',
        await prompts.askSecret('AI provider API key', true),
      );
    }
  }

  await ensureTextValue('AI_PROVIDER_MAIN_AGENT_MODEL', 'AI provider main agent model', args.model);
  await ensureTextValue(
    'AI_PROVIDER_PROFILE_AGENT_MODEL',
    'AI provider profile agent model',
  );
  await ensureTextValue(
    'AI_PROVIDER_SUMMARY_AGENT_MODEL',
    'AI provider summary agent model',
  );

  for (const key of REQUIRED_KEYS) {
    const value = values.get(key);
    if (!value) {
      throw new Error(`${key} is required but missing.`);
    }
    if (key === 'SECRET_ENCRYPTION_KEY' && !isValidEncryptionKey(value)) {
      throw new Error('SECRET_ENCRYPTION_KEY must be exactly 64 hex characters.');
    }
  }

  const exampleKeys = new Set<string>();
  for (const line of exampleLines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (match) exampleKeys.add(match[1]);
  }

  const extraEntries: Array<[string, string]> = [];
  if (envExists) {
    for (const [key, value] of existingEnv.entries()) {
      if (!exampleKeys.has(key)) {
        extraEntries.push([key, value]);
      }
    }
  }

  const output = buildEnvOutput(exampleLines, values, extraEntries);

  if (args.dryRun) {
    prompts.note(
      [
        `Dry-run mode: no files were written.`,
        `Target env file: ${envPath}`,
        `DISCORD_TOKEN: ${maskValue(values.get('DISCORD_TOKEN'))}`,
        `DISCORD_APP_ID: ${maskValue(values.get('DISCORD_APP_ID'))}`,
        `DATABASE_URL: ${values.get('DATABASE_URL') ? '[SET]' : '[NOT SET]'}`,
        `AI_PROVIDER_BASE_URL: ${values.get('AI_PROVIDER_BASE_URL') ? '[SET]' : '[NOT SET]'}`,
        `AI_PROVIDER_API_KEY: ${maskValue(values.get('AI_PROVIDER_API_KEY'))}`,
        `AI_PROVIDER_MAIN_AGENT_MODEL: ${values.get('AI_PROVIDER_MAIN_AGENT_MODEL') || '[NOT SET]'}`,
        `AI_PROVIDER_PROFILE_AGENT_MODEL: ${values.get('AI_PROVIDER_PROFILE_AGENT_MODEL') || '[NOT SET]'}`,
        `AI_PROVIDER_SUMMARY_AGENT_MODEL: ${values.get('AI_PROVIDER_SUMMARY_AGENT_MODEL') || '[NOT SET]'}`,
      ].join('\n'),
      'Preview',
    );
  } else {
    writeEnvFileAtomic(envPath, output);
    prompts.note(
      [
        `Updated ${envPath}`,
        `DISCORD_TOKEN: ${maskValue(values.get('DISCORD_TOKEN'))}`,
        `DISCORD_APP_ID: ${maskValue(values.get('DISCORD_APP_ID'))}`,
        `AI_PROVIDER_BASE_URL: ${values.get('AI_PROVIDER_BASE_URL') ? '[SET]' : '[NOT SET]'}`,
        `AI_PROVIDER_API_KEY: ${maskValue(values.get('AI_PROVIDER_API_KEY'))}`,
        `AI_PROVIDER_MAIN_AGENT_MODEL: ${values.get('AI_PROVIDER_MAIN_AGENT_MODEL') || '[NOT SET]'}`,
        `AI_PROVIDER_PROFILE_AGENT_MODEL: ${values.get('AI_PROVIDER_PROFILE_AGENT_MODEL') || '[NOT SET]'}`,
        `AI_PROVIDER_SUMMARY_AGENT_MODEL: ${values.get('AI_PROVIDER_SUMMARY_AGENT_MODEL') || '[NOT SET]'}`,
      ].join('\n'),
      'Configuration',
    );
  }

  const shouldStartDocker = args.startDocker ?? (!args.nonInteractive && !args.dryRun
    ? await prompts.askConfirm('Start Docker services (db + tika) now?', true)
    : false);
  const shouldMigrate = args.migrate ?? (!args.nonInteractive && !args.dryRun
    ? await prompts.askConfirm('Run database migrations now?', true)
    : false);
  const shouldDoctor = args.doctor ?? (!args.nonInteractive && !args.dryRun
    ? await prompts.askConfirm('Run doctor check now?', true)
    : false);

  if (!args.dryRun && shouldStartDocker) {
    const s = prompts.spinner();
    s.start('Starting Docker services...');
    runCommand('docker compose -f config/services/core/docker-compose.yml up -d db tika', repoRoot);
    s.stop('Docker services are running.');
  }

  if (!args.dryRun && shouldMigrate) {
    const s = prompts.spinner();
    s.start('Applying Prisma migrations...');
    runCommand('npm run db:migrate', repoRoot);
    s.stop('Prisma migrations applied.');
  }

  if (!args.dryRun && shouldDoctor) {
    const s = prompts.spinner();
    s.start('Running doctor checks...');
    runCommand('npm run doctor', repoRoot);
    s.stop('Doctor checks complete.');
  }

  const appId = values.get('DISCORD_APP_ID');
  const recommendedPerms = '1133568';
  const inviteUrl = appId
    ? `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=${recommendedPerms}`
    : '(missing DISCORD_APP_ID)';

  prompts.note(
    [
      `Invite URL: ${inviteUrl}`,
      `Next step: npm run dev`,
      `Need diagnostics: npm run doctor`,
    ].join('\n'),
    'Next steps',
  );

  prompts.outro(args.dryRun ? 'Onboarding dry-run completed.' : 'Onboarding completed.');
}

main().catch((error) => {
  console.error('Onboarding failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
