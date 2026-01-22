/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const REQUIRED_KEYS = ['DISCORD_TOKEN', 'DISCORD_APP_ID', 'DATABASE_URL'] as const;
const OPTIONAL_KEYS = ['POLLINATIONS_MODEL'] as const;

const repoRoot = process.cwd();
const envPath = path.join(repoRoot, '.env');
const envExamplePath = path.join(repoRoot, '.env.example');
const dockerComposePath = path.join(repoRoot, 'docker-compose.yml');

type CliArgs = {
  help?: boolean;
  yes?: boolean;
  nonInteractive?: boolean;
  discordToken?: string;
  discordAppId?: string;
  databaseUrl?: string;
  apiKey?: string;
  model?: string;
};

type PromptFns = {
  ask: (question: string) => Promise<string>;
  askYesNo: (question: string, defaultNo?: boolean) => Promise<boolean>;
  promptSecret: (question: string) => Promise<string>;
  close: () => void;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--yes' || arg === '-y') {
      args.yes = true;
    } else if (arg === '--non-interactive') {
      args.nonInteractive = true;
    } else if (arg.startsWith('--discord-token=')) {
      args.discordToken = arg.split('=')[1];
    } else if (arg === '--discord-token') {
      args.discordToken = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--discord-app-id=')) {
      args.discordAppId = arg.split('=')[1];
    } else if (arg === '--discord-app-id') {
      args.discordAppId = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--database-url=')) {
      args.databaseUrl = arg.split('=')[1];
    } else if (arg === '--database-url') {
      args.databaseUrl = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--api-key=')) {
      args.apiKey = arg.split('=')[1];
    } else if (arg === '--api-key') {
      args.apiKey = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--model=')) {
      args.model = arg.split('=')[1];
    } else if (arg === '--model') {
      args.model = argv[i + 1];
      i += 1;
    } else {
      console.warn(`Unknown option: ${arg}`);
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Sage Onboarding Wizard\n\nUsage:\n  npm run onboard -- [options]\n\nOptions:\n  --discord-token <token>   Discord bot token\n  --discord-app-id <id>     Discord application ID\n  --database-url <url>      PostgreSQL connection string\n  --api-key <key>           Pollinations API key (required)\n  --model <id>              Default Pollinations model ID\n  --yes                     Overwrite existing values without prompting\n  --non-interactive         Fail if required values are missing\n  -h, --help                Show this help\n`);
}

function createPrompts(enabled: boolean): PromptFns {
  if (!enabled) {
    const fail = async () => {
      throw new Error('Non-interactive mode requires all values to be provided via flags.');
    };
    return {
      ask: fail,
      askYesNo: fail,
      promptSecret: fail,
      close: () => undefined,
    };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string) =>
    new Promise<string>((resolve) => {
      rl.question(question, (answer) => resolve(answer.trim()));
    });

  const askYesNo = async (question: string, defaultNo = true) => {
    const suffix = defaultNo ? ' (y/N): ' : ' (Y/n): ';
    const answer = (await ask(question + suffix)).toLowerCase();
    if (!answer) {
      return !defaultNo;
    }
    return ['y', 'yes'].includes(answer);
  };

  const promptSecret = (question: string) =>
    new Promise<string>((resolve, reject) => {
      const stdin = process.stdin;
      const stdout = process.stdout;
      if (!stdin.isTTY) {
        reject(
          new Error('Cannot securely prompt for secrets without a TTY. Use --api-key instead.'),
        );
        return;
      }

      const onData = (data: Buffer) => {
        const char = data.toString('utf8');
        if (char === '\u0003') {
          stdout.write('\n');
          cleanup();
          reject(new Error('Cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          stdout.write('\n');
          cleanup();
          resolve(buffer.join(''));
          return;
        }
        if (char === '\u007f') {
          if (buffer.length > 0) {
            buffer.pop();
            stdout.write('\b \b');
          }
          return;
        }
        buffer.push(char);
        stdout.write('*');
      };

      const cleanup = () => {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
      };

      const buffer: string[] = [];
      stdout.write(question);
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on('data', onData);
    });

  return {
    ask,
    askYesNo,
    promptSecret,
    close: () => rl.close(),
  };
}

const stripQuotes = (value: string) => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

const parseEnv = (content: string) => {
  const values = new Map<string, string>();
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) {
      continue;
    }
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    const rawValue = match[2] ?? '';
    values.set(key, stripQuotes(rawValue.trim()));
  }
  return values;
};

const parseEnvExampleLines = (content: string) => content.split(/\r?\n/);

const getDockerComposeDefaults = () => {
  if (!fs.existsSync(dockerComposePath)) {
    return null;
  }
  const content = fs.readFileSync(dockerComposePath, 'utf8');
  const user = content.match(/POSTGRES_USER:\s*([^\s]+)/)?.[1] ?? 'postgres';
  const password = content.match(/POSTGRES_PASSWORD:\s*([^\s]+)/)?.[1] ?? 'postgres';
  const db = content.match(/POSTGRES_DB:\s*([^\s]+)/)?.[1] ?? 'sage';
  const port =
    content.match(/-\s*["']?(\d+):\d+["']?/)?.[1] ??
    content.match(/ports:\s*\n\s*-\s*["']?(\d+):\d+["']?/m)?.[1] ??
    '5432';

  return {
    user,
    password,
    db,
    port,
  };
};

const formatValue = (value: string) => {
  if (value === '') {
    return '';
  }
  if (/[\s#'"]/.test(value)) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
};

const buildEnvOutput = (
  exampleLines: string[],
  values: Map<string, string>,
  extraEntries: Array<[string, string]>,
) => {
  const output = exampleLines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) {
      return line;
    }
    const key = match[1];
    const value = values.get(key);
    if (value === undefined) {
      return line;
    }
    return `${key}=${formatValue(value)}`;
  });

  if (extraEntries.length > 0) {
    output.push('');
    output.push('# Additional keys from existing .env');
    for (const [key, value] of extraEntries) {
      output.push(`${key}=${formatValue(value)}`);
    }
  }

  return output.join('\n');
};

const promptRequired = async (label: string, prompts: PromptFns) => {
  while (true) {
    const value = await prompts.ask(`${label}: `);
    if (value) {
      return value;
    }
    console.log('Value required.');
  }
};

const promptDatabaseUrl = async (prompts: PromptFns) => {
  const defaults = getDockerComposeDefaults();
  const fallbackUrl = 'postgres://postgres:postgres@localhost:5432/sage?schema=public';
  const dockerUrl = defaults
    ? `postgresql://${defaults.user}:${defaults.password}@localhost:${defaults.port}/${defaults.db}?schema=public`
    : fallbackUrl;
  console.log('Choose DATABASE_URL setup:');
  console.log('1) Paste DATABASE_URL');
  console.log(`2) Use local Docker default (${dockerUrl})`);

  while (true) {
    const choice = await prompts.ask('Select option (1/2): ');
    if (choice === '1') {
      return await promptRequired('DATABASE_URL', prompts);
    }
    if (choice === '2') {
      return dockerUrl;
    }
    console.log('Please enter 1 or 2.');
  }
};

const writeEnvFile = (output: string) => {
  const tempPath = `${envPath}.tmp`;
  fs.writeFileSync(tempPath, output + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, envPath);
  try {
      fs.chmodSync(envPath, 0o600);
    } catch {
      // Best-effort on platforms that support chmod.
    }
  };
  
  const shouldOverwriteValue = async (
    key: string,
    existingValue: string | undefined,
    prompts: PromptFns,
    yesFlag: boolean,
    nonInteractive: boolean,
  ): Promise<boolean> => {
    if (!existingValue) return true;
    if (yesFlag) return true;
    if (nonInteractive) return false;
    return prompts.askYesNo(`${key} already set. Overwrite?`);
  };
  
  async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
      printHelp();
      return;
    }
  
    const prompts = createPrompts(!args.nonInteractive);
  
    process.on('SIGINT', () => {
      console.log('\nSetup cancelled.');
      prompts.close();
      process.exit(1);
    });
  
    try {
      console.log('🌿 Sage Onboarding Wizard');
    console.log('This will configure your .env file and validate Pollinations access.');
  
    const envExists = fs.existsSync(envPath);
    const existingEnv = envExists ? parseEnv(fs.readFileSync(envPath, 'utf8')) : new Map();
    const exampleLines = fs.existsSync(envExamplePath)
      ? parseEnvExampleLines(fs.readFileSync(envExamplePath, 'utf8'))
      : [];
  
    const values = new Map(existingEnv);
    const forcedKeys = new Set<string>();
  
    if (args.discordToken) {
      values.set('DISCORD_TOKEN', args.discordToken);
      forcedKeys.add('DISCORD_TOKEN');
    }
    if (args.discordAppId) {
      values.set('DISCORD_APP_ID', args.discordAppId);
      forcedKeys.add('DISCORD_APP_ID');
    }
    if (args.databaseUrl) {
      values.set('DATABASE_URL', args.databaseUrl);
      forcedKeys.add('DATABASE_URL');
    }
    if (args.apiKey) {
      values.set('POLLINATIONS_API_KEY', args.apiKey);
      forcedKeys.add('POLLINATIONS_API_KEY');
    }
  
    for (const key of REQUIRED_KEYS) {
      const existingValue = values.get(key);
      const overwrite = forcedKeys.has(key)
        ? true
        : await shouldOverwriteValue(
            key,
            existingValue,
            prompts,
            !!args.yes,
            !!args.nonInteractive,
          );
      if (!overwrite) {
        if (!existingValue) {
          throw new Error(`${key} is required in non-interactive mode.`);
        }
        continue;
      }
  
      if (key === 'DATABASE_URL') {
        const dbUrl = args.databaseUrl ?? (await promptDatabaseUrl(prompts));
        values.set(key, dbUrl);
      } else if (key === 'DISCORD_TOKEN') {
        const token = args.discordToken ?? (await promptRequired('DISCORD_TOKEN', prompts));
        values.set(key, token);
      } else if (key === 'DISCORD_APP_ID') {
        const appId = args.discordAppId ?? (await promptRequired('DISCORD_APP_ID', prompts));
        values.set(key, appId);
      }
    }
  
    const existingApiKey = values.get('POLLINATIONS_API_KEY');
    const overwriteApiKey = forcedKeys.has('POLLINATIONS_API_KEY')
      ? true
      : await shouldOverwriteValue(
          'POLLINATIONS_API_KEY',
          existingApiKey,
          prompts,
          !!args.yes,
          !!args.nonInteractive,
        );
    if (overwriteApiKey) {
      const apiKey =
        args.apiKey ??
        (await prompts.promptSecret(
          'Pollinations API key (required, get one at https://pollinations.ai/): ',
        ));
      if (!apiKey) {
        throw new Error('POLLINATIONS_API_KEY is required.');
      }
      values.set('POLLINATIONS_API_KEY', apiKey);
    }
  
    if (!values.get('POLLINATIONS_API_KEY')) {
      throw new Error('POLLINATIONS_API_KEY is required.');
    }
  
    for (const key of OPTIONAL_KEYS) {
      if (key === 'POLLINATIONS_MODEL') {
        if (args.model) {
          values.set('POLLINATIONS_MODEL', args.model);
        }
      }
    }
  
    const requiredEnv = {
      DISCORD_TOKEN: values.get('DISCORD_TOKEN'),
      DISCORD_APP_ID: values.get('DISCORD_APP_ID'),
      DATABASE_URL: values.get('DATABASE_URL'),
      POLLINATIONS_API_KEY: values.get('POLLINATIONS_API_KEY'),
      POLLINATIONS_MODEL: values.get('POLLINATIONS_MODEL'),
    };
  
    for (const [key, value] of Object.entries(requiredEnv)) {
      if (value) process.env[key] = value;
    }
  
    const { loadModelCatalog, findModelInCatalog, suggestModelIds, getModelCatalogState } =
      await import('../core/llm/modelCatalog');
  
    const catalog = await loadModelCatalog();
    const sortedModels = Object.values(catalog).sort((a, b) => a.id.localeCompare(b.id));
  
    const existingModel = values.get('POLLINATIONS_MODEL') || 'gemini';
    let selectedModel = existingModel;
  
    if (!args.model) {
      if (!args.nonInteractive) {
      console.log('\nSelect a default Pollinations chat model.');
      console.log('Type "list" to view available models. Press Enter to keep current.');
      }
  
      while (true) {
        if (args.nonInteractive) {
          selectedModel = existingModel;
          break;
        }
  
      const input = await prompts.ask(`Default chat model [${existingModel}]: `);
        const choice = input.trim();
        if (!choice) {
          selectedModel = existingModel;
          break;
        }
        if (choice.toLowerCase() === 'list') {
          console.log(sortedModels.map((model) => `- ${model.id}`).join('\n'));
          continue;
        }
  
        const { model: foundModel, catalog: updatedCatalog } = await findModelInCatalog(choice, {
          refreshIfMissing: true,
        });
  
        if (foundModel) {
          selectedModel = foundModel.id;
          break;
        }
  
        const suggestions = suggestModelIds(choice, updatedCatalog);
        const suggestionText = suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : '';
        console.log(`Unknown model: ${choice}.${suggestionText}`);
      }
    } else {
      const { model: foundModel, catalog: updatedCatalog } = await findModelInCatalog(args.model, {
        refreshIfMissing: true,
      });
      if (!foundModel) {
        const suggestions = suggestModelIds(args.model, updatedCatalog);
        const suggestionText = suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : '';
        throw new Error(`Unknown model: ${args.model}.${suggestionText}`);
      }
      selectedModel = foundModel.id;
    }
  
    values.set('POLLINATIONS_MODEL', selectedModel);
  
    console.log('\n✅ Validating configuration...');
    const { model: finalModel } = await findModelInCatalog(selectedModel, {
      refreshIfMissing: true,
    });
    if (!finalModel) {
      throw new Error(`Selected model "${selectedModel}" is not available.`);
    }
  
    const catalogState = getModelCatalogState();
    console.log(`- Pollinations model: ${finalModel.id}`);
    console.log(`- Catalog source: ${catalogState.source}`);
    console.log('- Pollinations API key: [PRESENT]');
  
    const extraEntries: Array<[string, string]> = [];
    if (envExists) {
      const exampleKeys = new Set();
      for (const line of exampleLines) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (match) {
          exampleKeys.add(match[1]);
        }
      }
      for (const [key, value] of existingEnv.entries()) {
        if (!exampleKeys.has(key)) {
          extraEntries.push([key, value]);
        }
      }
    }
  
    const output =
      exampleLines.length > 0
        ? buildEnvOutput(exampleLines, values, extraEntries)
        : Array.from(values.entries())
            .map(([key, value]) => `${key}=${formatValue(value)}`)
            .join('\n');
  
    writeEnvFile(output);
  
    console.log(envExists ? '\n.env updated.' : '\n.env created.');
    console.log('Next steps:');
    console.log('- npm install');
    console.log('- docker compose up -d db');
    console.log('- npm run db:migrate');
    console.log('- npm run dev');
  } finally {
    prompts.close();
  }
}

main().catch((error) => {
  console.error('Onboarding failed.');
  console.error(error?.message ?? error);
  process.exit(1);
});
