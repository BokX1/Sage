/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline/promises';
import type { EnvSchema } from '../platform/config/envSchema';
import { envSchema, parseEnvSafe } from '../platform/config/envSchema';

type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

type CheckResult = {
  id: string;
  title: string;
  status: CheckStatus;
  message: string;
  details?: string[];
  durationMs: number;
};

type FixAction = {
  id: string;
  description: string;
  command: string;
};

type FixResult = {
  id: string;
  command: string;
  success: boolean;
  error?: string;
};

type CliFlags = {
  envFile: string;
  envExample: string;
  llmPing: boolean;
  json: boolean;
  verbose: boolean;
  failOnWarn: boolean;
  fix: boolean;
  yes: boolean;
  only: Set<string>;
  skip: Set<string>;
  help: boolean;
};

type DoctorContext = {
  repoRoot: string;
  flags: CliFlags;
  packageVersion: string;
  engines: {
    node?: string;
    npm?: string;
  };
  envPath: string;
  envExamplePath: string;
  envExists: boolean;
  envExampleExists: boolean;
  envValues: Record<string, string>;
  envExampleValues: Record<string, string>;
  parsedEnv: EnvSchema | null;
  schemaIssues: string[];
  dbConnected: boolean;
};

type CheckDefinition = {
  id: string;
  title: string;
  run: (ctx: DoctorContext) => Promise<Omit<CheckResult, 'id' | 'title' | 'durationMs'>>;
};

const CHECK_IDS = {
  envFiles: 'env.files',
  envTemplateSync: 'env.templateSync',
  envSchema: 'env.schema',
  runtimeNode: 'runtime.node',
  runtimeNpm: 'runtime.npm',
  depsPrismaClient: 'deps.prismaClient',
  dbConnect: 'db.connect',
  dbMigrations: 'db.migrations',
  servicesTika: 'services.tika',
  aiProviderConfig: 'ai_provider.config',
  aiProviderPing: 'ai_provider.ping',
} as const;

const CHECK_ORDER: readonly string[] = [
  CHECK_IDS.envFiles,
  CHECK_IDS.envTemplateSync,
  CHECK_IDS.envSchema,
  CHECK_IDS.runtimeNode,
  CHECK_IDS.runtimeNpm,
  CHECK_IDS.depsPrismaClient,
  CHECK_IDS.dbConnect,
  CHECK_IDS.dbMigrations,
  CHECK_IDS.servicesTika,
  CHECK_IDS.aiProviderConfig,
  CHECK_IDS.aiProviderPing,
] as const;

function printHelp() {
  console.log(`Sage Doctor

Usage:
  npm run doctor -- [options]

Options:
  --env-file <path>       Path to .env file (default: .env)
  --env-example <path>    Path to .env.example (default: .env.example)
  --llm-ping              Run live LLM ping check
  --json                  Output machine-readable JSON
  --verbose               Include verbose diagnostics
  --fail-on-warn          Exit with code 1 on warnings
  --fix                   Attempt safe remediation commands
  --yes                   Auto-confirm remediation commands
  --only <ids>            Comma-separated check IDs to run
  --skip <ids>            Comma-separated check IDs to skip
  -h, --help              Show this help

Check IDs:
  ${CHECK_ORDER.join(', ')}`);
}

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    envFile: '.env',
    envExample: '.env.example',
    llmPing: false,
    json: false,
    verbose: false,
    failOnWarn: false,
    fix: false,
    yes: false,
    only: new Set<string>(),
    skip: new Set<string>(),
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      flags.help = true;
      continue;
    }
    if (arg === '--llm-ping') {
      flags.llmPing = true;
      continue;
    }
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--verbose') {
      flags.verbose = true;
      continue;
    }
    if (arg === '--fail-on-warn') {
      flags.failOnWarn = true;
      continue;
    }
    if (arg === '--fix') {
      flags.fix = true;
      continue;
    }
    if (arg === '--yes') {
      flags.yes = true;
      continue;
    }
    if (arg === '--env-file') {
      const next = argv[i + 1];
      if (!next) throw new Error('--env-file requires a value.');
      flags.envFile = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--env-file=')) {
      flags.envFile = arg.slice('--env-file='.length);
      continue;
    }
    if (arg === '--env-example') {
      const next = argv[i + 1];
      if (!next) throw new Error('--env-example requires a value.');
      flags.envExample = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--env-example=')) {
      flags.envExample = arg.slice('--env-example='.length);
      continue;
    }
    if (arg === '--only') {
      const next = argv[i + 1];
      if (!next) throw new Error('--only requires a value.');
      parseCsvToSet(next, flags.only);
      i += 1;
      continue;
    }
    if (arg.startsWith('--only=')) {
      parseCsvToSet(arg.slice('--only='.length), flags.only);
      continue;
    }
    if (arg === '--skip') {
      const next = argv[i + 1];
      if (!next) throw new Error('--skip requires a value.');
      parseCsvToSet(next, flags.skip);
      i += 1;
      continue;
    }
    if (arg.startsWith('--skip=')) {
      parseCsvToSet(arg.slice('--skip='.length), flags.skip);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return flags;
}

function parseCsvToSet(value: string, target: Set<string>) {
  for (const item of value.split(',')) {
    const normalized = item.trim();
    if (normalized) target.add(normalized);
  }
}

function parseDotenvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  return dotenv.parse(content);
}

function safeReadPackageMeta(repoRoot: string): { version: string; engines: { node?: string; npm?: string } } {
  try {
    const packageJsonPath = path.join(repoRoot, 'package.json');
    const raw = fs.readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string; engines?: { node?: string; npm?: string } };
    return {
      version: parsed.version ?? '0.0.0',
      engines: parsed.engines ?? {},
    };
  } catch {
    return { version: '0.0.0', engines: {} };
  }
}

function parseMinVersion(spec?: string): string | null {
  if (!spec) return null;
  const match = spec.match(/>=\s*([0-9]+(?:\.[0-9]+){0,2})/);
  return match ? normalizeSemver(match[1]) : null;
}

function normalizeSemver(value: string): string {
  const [major = '0', minor = '0', patch = '0'] = value.split('.');
  return `${Number.parseInt(major, 10) || 0}.${Number.parseInt(minor, 10) || 0}.${Number.parseInt(patch, 10) || 0}`;
}

function compareSemver(left: string, right: string): number {
  const [la, lb, lc] = normalizeSemver(left).split('.').map((n) => Number.parseInt(n, 10));
  const [ra, rb, rc] = normalizeSemver(right).split('.').map((n) => Number.parseInt(n, 10));
  if (la !== ra) return la > ra ? 1 : -1;
  if (lb !== rb) return lb > rb ? 1 : -1;
  if (lc !== rc) return lc > rc ? 1 : -1;
  return 0;
}

function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    if (parsed.username) parsed.username = '***';
    return parsed.toString();
  } catch {
    return '[invalid DATABASE_URL]';
  }
}

function normalizeAiProviderBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, '').replace(/\/chat\/completions$/, '');
}

function isLocalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

async function runCheck(definition: CheckDefinition, ctx: DoctorContext): Promise<CheckResult> {
  const startedAt = Date.now();
  const outcome = await definition.run(ctx);
  return {
    id: definition.id,
    title: definition.title,
    durationMs: Date.now() - startedAt,
    ...outcome,
  };
}

function filterChecks(checks: CheckDefinition[], flags: CliFlags): CheckDefinition[] {
  const knownCheckIds = new Set(checks.map((check) => check.id));

  for (const id of flags.only) {
    if (!knownCheckIds.has(id)) {
      throw new Error(`Unknown check ID in --only: ${id}`);
    }
  }
  for (const id of flags.skip) {
    if (!knownCheckIds.has(id)) {
      throw new Error(`Unknown check ID in --skip: ${id}`);
    }
  }

  return checks.filter((check) => {
    if (flags.only.size > 0 && !flags.only.has(check.id)) return false;
    if (flags.skip.has(check.id)) return false;
    return true;
  });
}

function renderStatus(status: CheckStatus): string {
  if (status === 'pass') return 'PASS';
  if (status === 'warn') return 'WARN';
  if (status === 'fail') return 'FAIL';
  return 'SKIP';
}

function summarize(results: CheckResult[]) {
  const summary = {
    pass: 0,
    warn: 0,
    fail: 0,
    skip: 0,
  };
  for (const result of results) {
    summary[result.status] += 1;
  }
  return summary;
}

async function confirmAction(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await rl.question(`${question} (y/N): `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function buildFixActions(ctx: DoctorContext, results: CheckResult[]): FixAction[] {
  const actions: FixAction[] = [];
  const statusById = new Map(results.map((result) => [result.id, result.status]));
  const env = ctx.parsedEnv;

  if (
    statusById.get(CHECK_IDS.dbConnect) === 'fail' &&
    env &&
    isLocalHttpUrl(env.DATABASE_URL.replace(/^postgres(ql)?:/, 'http:'))
  ) {
    actions.push({
      id: CHECK_IDS.dbConnect,
      description: 'Start local Postgres service via Docker compose',
      command: 'docker compose -f config/services/core/docker-compose.yml up -d db',
    });
  }

  if (
    (statusById.get(CHECK_IDS.servicesTika) === 'fail' ||
      statusById.get(CHECK_IDS.servicesTika) === 'warn') &&
    env &&
    isLocalHttpUrl(env.FILE_INGEST_TIKA_BASE_URL)
  ) {
    actions.push({
      id: CHECK_IDS.servicesTika,
      description: 'Start local Apache Tika service via Docker compose',
      command: 'docker compose -f config/services/core/docker-compose.yml up -d tika',
    });
  }

  if (statusById.get(CHECK_IDS.dbMigrations) === 'fail') {
    actions.push({
      id: CHECK_IDS.dbMigrations,
      description: 'Apply pending Prisma migrations',
      command: 'npm run db:migrate',
    });
  }

  return actions;
}

function printHumanReport(ctx: DoctorContext, results: CheckResult[], fixResults: FixResult[]) {
  console.log(`Sage v${ctx.packageVersion} - Doctor`);
  console.log('');
  for (const result of results) {
    console.log(`[${renderStatus(result.status)}] ${result.id} - ${result.message} (${result.durationMs}ms)`);
    if (result.details && result.details.length > 0) {
      for (const detail of result.details) {
        console.log(`  - ${detail}`);
      }
    }
  }
  const summary = summarize(results);
  console.log('');
  console.log(
    `Summary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail, ${summary.skip} skip`,
  );

  if (fixResults.length > 0) {
    console.log('');
    console.log('Fix attempts:');
    for (const fixResult of fixResults) {
      const status = fixResult.success ? 'PASS' : 'FAIL';
      console.log(`[${status}] ${fixResult.id}: ${fixResult.command}`);
      if (fixResult.error) {
        console.log(`  - ${fixResult.error}`);
      }
    }
  }
}

function printJsonReport(results: CheckResult[], fixResults: FixResult[]) {
  const summary = summarize(results);
  const payload = {
    ok: summary.fail === 0,
    summary,
    checks: results,
    fixes: fixResults,
    generatedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(payload, null, 2));
}

function collectTemplateKeys(values: Record<string, string>): Set<string> {
  return new Set(Object.keys(values));
}

function collectSchemaKeys(): Set<string> {
  const schemaOptions = envSchema.keyof().options as unknown as string[];
  return new Set(schemaOptions.map((item) => item.trim()).filter((item) => item.length > 0));
}

function getLlmPingEnabled(flags: CliFlags, envValues: Record<string, string>): boolean {
  if (flags.llmPing) return true;
  return envValues.LLM_DOCTOR_PING === '1';
}

function buildChecks(): CheckDefinition[] {
  return [
    {
      id: CHECK_IDS.envFiles,
      title: 'Environment files',
      run: async (ctx) => {
        const details: string[] = [];
        if (!ctx.envExampleExists) {
          return {
            status: 'fail',
            message: `${ctx.flags.envExample} is missing`,
            details: ['Restore .env.example before running doctor.'],
          };
        }
        details.push(`Found ${path.relative(ctx.repoRoot, ctx.envExamplePath)}`);
        if (!ctx.envExists) {
          return {
            status: 'fail',
            message: `${ctx.flags.envFile} is missing`,
            details: ['Run `npm run onboard` to generate a working .env file.'],
          };
        }
        details.push(`Found ${path.relative(ctx.repoRoot, ctx.envPath)}`);
        return {
          status: 'pass',
          message: 'Required env files are present',
          details,
        };
      },
    },
    {
      id: CHECK_IDS.envTemplateSync,
      title: 'Env template sync',
      run: async (ctx) => {
        if (!ctx.envExists || !ctx.envExampleExists) {
          return {
            status: 'skip',
            message: 'Skipped (env files missing)',
          };
        }

        const templateKeys = collectTemplateKeys(ctx.envExampleValues);
        const schemaKeys = collectSchemaKeys();
        const envKeys = Object.keys(ctx.envValues);

        const missingTemplateKeys = Array.from(templateKeys).filter((key) => !(key in ctx.envValues));
        const unknownKeys = envKeys.filter((key) => !templateKeys.has(key) && !schemaKeys.has(key));

        if (missingTemplateKeys.length === 0 && unknownKeys.length === 0) {
          return {
            status: 'pass',
            message: '.env is aligned with .env.example',
          };
        }

        const details: string[] = [];
        if (missingTemplateKeys.length > 0) {
          details.push(`Missing keys from template: ${missingTemplateKeys.join(', ')}`);
        }
        if (unknownKeys.length > 0) {
          details.push(`Unknown keys in .env: ${unknownKeys.join(', ')}`);
        }
        return {
          status: 'warn',
          message: 'Template drift detected',
          details,
        };
      },
    },
    {
      id: CHECK_IDS.envSchema,
      title: 'Env schema validation',
      run: async (ctx) => {
        if (!ctx.envExists) {
          return {
            status: 'fail',
            message: 'Cannot validate schema without .env',
            details: ['Run `npm run onboard` to create .env.'],
          };
        }
        if (ctx.schemaIssues.length > 0) {
          return {
            status: 'fail',
            message: 'Environment validation failed',
            details: ctx.schemaIssues,
          };
        }
        return {
          status: 'pass',
          message: 'Environment schema is valid',
        };
      },
    },
    {
      id: CHECK_IDS.runtimeNode,
      title: 'Node runtime',
      run: async (ctx) => {
        const current = normalizeSemver(process.version.replace(/^v/, ''));
        const required = parseMinVersion(ctx.engines.node);
        if (!required) {
          return {
            status: 'warn',
            message: `Node ${current} detected (no engines.node minimum found)`,
          };
        }
        const ok = compareSemver(current, required) >= 0;
        return {
          status: ok ? 'pass' : 'fail',
          message: ok
            ? `Node ${current} satisfies engines.node ${ctx.engines.node}`
            : `Node ${current} does not satisfy engines.node ${ctx.engines.node}`,
          details: ok ? undefined : [`Install Node ${required}+ and rerun doctor.`],
        };
      },
    },
    {
      id: CHECK_IDS.runtimeNpm,
      title: 'NPM runtime',
      run: async (ctx) => {
        let current: string;
        try {
          current = normalizeSemver(execSync('npm --version', { encoding: 'utf8' }).trim());
        } catch (error) {
          return {
            status: 'fail',
            message: 'Failed to read npm version',
            details: [String(error)],
          };
        }
        const required = parseMinVersion(ctx.engines.npm);
        if (!required) {
          return {
            status: 'warn',
            message: `npm ${current} detected (no engines.npm minimum found)`,
          };
        }
        const ok = compareSemver(current, required) >= 0;
        return {
          status: ok ? 'pass' : 'fail',
          message: ok
            ? `npm ${current} satisfies engines.npm ${ctx.engines.npm}`
            : `npm ${current} does not satisfy engines.npm ${ctx.engines.npm}`,
          details: ok ? undefined : [`Upgrade npm to ${required}+ and rerun doctor.`],
        };
      },
    },
    {
      id: CHECK_IDS.depsPrismaClient,
      title: 'Prisma client import',
      run: async () => {
        try {
          const probe = new PrismaClient();
          await probe.$disconnect();
          return {
            status: 'pass',
            message: 'Prisma client is loadable',
          };
        } catch (error) {
          return {
            status: 'fail',
            message: 'Prisma client failed to initialize',
            details: [String(error), 'Run `npm ci` and ensure `npm run postinstall` succeeds.'],
          };
        }
      },
    },
    {
      id: CHECK_IDS.dbConnect,
      title: 'Database connectivity',
      run: async (ctx) => {
        if (!ctx.parsedEnv) {
          return {
            status: 'skip',
            message: 'Skipped (environment schema failed)',
          };
        }
        const dbUrl = ctx.parsedEnv.DATABASE_URL;
        const prisma = new PrismaClient({
          datasources: {
            db: { url: dbUrl },
          },
        });
        try {
          await prisma.$queryRawUnsafe('SELECT 1');
          ctx.dbConnected = true;
          return {
            status: 'pass',
            message: `Connected to database ${redactDatabaseUrl(dbUrl)}`,
          };
        } catch (error) {
          return {
            status: 'fail',
            message: `Failed to connect to database ${redactDatabaseUrl(dbUrl)}`,
            details: [String(error), 'If local, run `docker compose -f config/services/core/docker-compose.yml up -d db`.'],
          };
        } finally {
          await prisma.$disconnect();
        }
      },
    },
    {
      id: CHECK_IDS.dbMigrations,
      title: 'Database migrations',
      run: async (ctx) => {
        if (!ctx.parsedEnv || !ctx.dbConnected) {
          return {
            status: 'skip',
            message: 'Skipped (database unavailable)',
          };
        }
        const prisma = new PrismaClient({
          datasources: {
            db: { url: ctx.parsedEnv.DATABASE_URL },
          },
        });

        try {
          type MigrationRow = {
            migration_name: string;
            finished_at: Date | null;
            rolled_back_at: Date | null;
          };
          const rows = await prisma.$queryRawUnsafe<MigrationRow[]>(
            'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name ASC',
          );
          const failedRows = rows.filter((row) => row.finished_at === null || row.rolled_back_at !== null);
          const applied = new Set(rows.map((row) => row.migration_name));
          const migrationsDir = path.join(ctx.repoRoot, 'prisma', 'migrations');
          const expected = fs.existsSync(migrationsDir)
            ? fs
                .readdirSync(migrationsDir, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort()
            : [];
          const pending = expected.filter((name) => !applied.has(name));

          if (failedRows.length > 0 || pending.length > 0) {
            const details: string[] = [];
            if (failedRows.length > 0) {
              details.push(
                `Failed migrations: ${failedRows.map((row) => row.migration_name).join(', ')}`,
              );
            }
            if (pending.length > 0) {
              details.push(`Pending migrations: ${pending.join(', ')}`);
            }
            details.push('Run `npm run db:migrate` to apply pending migrations.');
            return {
              status: 'fail',
              message: 'Migration state is not healthy',
              details,
            };
          }
          return {
            status: 'pass',
            message: 'All repository migrations are applied',
          };
        } catch (error) {
          return {
            status: 'fail',
            message: 'Unable to read migration metadata table',
            details: [String(error), 'Run `npm run db:migrate` and rerun doctor.'],
          };
        } finally {
          await prisma.$disconnect();
        }
      },
    },
    {
      id: CHECK_IDS.servicesTika,
      title: 'Tika service reachability',
      run: async (ctx) => {
        if (!ctx.parsedEnv) {
          return {
            status: 'skip',
            message: 'Skipped (environment schema failed)',
          };
        }
        const tikaUrl = ctx.parsedEnv.FILE_INGEST_TIKA_BASE_URL?.trim();
        if (!tikaUrl) {
          return {
            status: 'skip',
            message: 'Skipped (FILE_INGEST_TIKA_BASE_URL is empty)',
          };
        }
        try {
          const response = await fetch(tikaUrl, { signal: AbortSignal.timeout(5000) });
          if (!response.ok) {
            return {
              status: 'warn',
              message: `Tika endpoint returned HTTP ${response.status}`,
              details: [tikaUrl],
            };
          }
          return {
            status: 'pass',
            message: `Tika endpoint reachable (${tikaUrl})`,
          };
        } catch (error) {
          return {
            status: 'warn',
            message: `Tika endpoint not reachable (${tikaUrl})`,
            details: [String(error), 'Run `docker compose -f config/services/core/docker-compose.yml up -d tika`.'],
          };
        }
      },
    },
    {
      id: CHECK_IDS.aiProviderConfig,
      title: 'AI provider agent profile config',
      run: async (ctx) => {
        if (!ctx.parsedEnv) {
          return {
            status: 'skip',
            message: 'Skipped (environment schema failed)',
          };
        }

        if (!ctx.parsedEnv.AI_PROVIDER_MODEL_PROFILES_JSON) {
          return {
            status: 'pass',
            message: 'No explicit AI provider model profiles configured; Sage will use base runtime budgets',
          };
        }

        try {
          const profiles = JSON.parse(ctx.parsedEnv.AI_PROVIDER_MODEL_PROFILES_JSON) as Record<string, unknown>;
          const configuredModels = [
            ctx.parsedEnv.AI_PROVIDER_MAIN_AGENT_MODEL,
            ctx.parsedEnv.AI_PROVIDER_PROFILE_AGENT_MODEL,
            ctx.parsedEnv.AI_PROVIDER_SUMMARY_AGENT_MODEL,
          ];
          const missingProfiles = configuredModels.filter((modelId) => !(modelId in profiles));
          if (missingProfiles.length > 0) {
            return {
              status: 'pass',
              message: 'AI provider model profiles are partial; Sage will fall back to base runtime budgets for missing entries',
              details: missingProfiles.map((modelId) => `Using base budget defaults for: ${modelId}`),
            };
          }
          return {
            status: 'pass',
            message: 'Configured AI provider agent models all have explicit profile entries',
          };
        } catch (error) {
          return {
            status: 'fail',
            message: 'AI_PROVIDER_MODEL_PROFILES_JSON could not be parsed',
            details: [String(error)],
          };
        }
      },
    },
    {
      id: CHECK_IDS.aiProviderPing,
      title: 'Live AI provider ping',
      run: async (ctx) => {
        if (!getLlmPingEnabled(ctx.flags, ctx.envValues)) {
          return {
            status: 'skip',
            message: 'Skipped (enable with --llm-ping or LLM_DOCTOR_PING=1)',
          };
        }
        if (!ctx.parsedEnv) {
          return {
            status: 'skip',
            message: 'Skipped (environment schema failed)',
          };
        }
        const baseUrl = normalizeAiProviderBaseUrl(ctx.parsedEnv.AI_PROVIDER_BASE_URL);
        const endpoint = `${baseUrl}/chat/completions`;
        const headers: Record<string, string> = {
          'content-type': 'application/json',
        };
        if (ctx.parsedEnv.AI_PROVIDER_API_KEY) {
          headers.authorization = `Bearer ${ctx.parsedEnv.AI_PROVIDER_API_KEY}`;
        }
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            signal: AbortSignal.timeout(10000),
            body: JSON.stringify({
              model: ctx.parsedEnv.AI_PROVIDER_MAIN_AGENT_MODEL,
              messages: [{ role: 'user', content: 'Respond with exactly: OK' }],
              max_tokens: 8,
              temperature: 0,
            }),
          });
          if (!response.ok) {
            const bodySnippet = (await response.text()).slice(0, 200);
            return {
              status: 'fail',
              message: `AI provider ping failed (${response.status})`,
              details: [bodySnippet],
            };
          }
          const payload = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = payload.choices?.[0]?.message?.content?.trim() ?? '';
          return {
            status: 'pass',
            message: content ? `AI provider ping succeeded (${content})` : 'AI provider ping succeeded',
          };
        } catch (error) {
          return {
            status: 'fail',
            message: 'AI provider ping request failed',
            details: [String(error)],
          };
        }
      },
    },
  ];
}

async function createContext(flags: CliFlags): Promise<DoctorContext> {
  const repoRoot = process.cwd();
  const envPath = path.resolve(repoRoot, flags.envFile);
  const envExamplePath = path.resolve(repoRoot, flags.envExample);
  const envExists = fs.existsSync(envPath);
  const envExampleExists = fs.existsSync(envExamplePath);
  const envValues = parseDotenvFile(envPath);
  const envExampleValues = parseDotenvFile(envExamplePath);
  const meta = safeReadPackageMeta(repoRoot);
  const schemaResult = envExists ? parseEnvSafe(envValues as NodeJS.ProcessEnv) : null;
  const schemaIssues =
    schemaResult && !schemaResult.success
      ? schemaResult.error.issues.map((issue) => {
          const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
          return `${field}: ${issue.message}`;
        })
      : [];

  return {
    repoRoot,
    flags,
    packageVersion: meta.version,
    engines: meta.engines,
    envPath,
    envExamplePath,
    envExists,
    envExampleExists,
    envValues,
    envExampleValues,
    parsedEnv: schemaResult && schemaResult.success ? schemaResult.data : null,
    schemaIssues,
    dbConnected: false,
  };
}

async function runFixes(ctx: DoctorContext, results: CheckResult[]): Promise<FixResult[]> {
  if (!ctx.flags.fix) return [];
  if (ctx.flags.json && !ctx.flags.yes) {
    throw new Error('--json with --fix requires --yes (non-interactive mode).');
  }
  const actions = buildFixActions(ctx, results);
  const fixResults: FixResult[] = [];

  for (const action of actions) {
    let approved = ctx.flags.yes;
    if (!approved) {
      approved = await confirmAction(`${action.description}: ${action.command}`);
    }
    if (!approved) {
      fixResults.push({
        id: action.id,
        command: action.command,
        success: false,
        error: 'Skipped by user',
      });
      continue;
    }
    try {
      execSync(action.command, { cwd: ctx.repoRoot, stdio: 'inherit' });
      fixResults.push({
        id: action.id,
        command: action.command,
        success: true,
      });
    } catch (error) {
      fixResults.push({
        id: action.id,
        command: action.command,
        success: false,
        error: String(error),
      });
    }
  }

  return fixResults;
}

async function runDoctor(): Promise<number> {
  const flags = parseArgs(process.argv);
  if (flags.help) {
    printHelp();
    return 0;
  }

  let ctx = await createContext(flags);
  const checks = filterChecks(buildChecks(), flags);
  let results: CheckResult[] = [];

  for (const check of checks) {
    const result = await runCheck(check, ctx);
    results.push(result);
  }

  const fixResults = await runFixes(ctx, results);
  if (flags.fix && fixResults.some((item) => item.success)) {
    ctx = await createContext(flags);
    results = [];
    for (const check of checks) {
      const result = await runCheck(check, ctx);
      results.push(result);
    }
  }

  if (flags.json) {
    printJsonReport(results, fixResults);
  } else {
    printHumanReport(ctx, results, fixResults);
  }

  const summary = summarize(results);
  const failed = summary.fail > 0;
  const warned = summary.warn > 0;
  if (failed || (flags.failOnWarn && warned)) {
    return 1;
  }
  return 0;
}

void runDoctor()
  .then((exitCode) => {
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  })
  .catch((error) => {
    console.error('Doctor failed.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
