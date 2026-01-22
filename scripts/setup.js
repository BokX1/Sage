const fs = require('fs');
const path = require('path');
const readline = require('readline');

const REQUIRED_KEYS = ['DISCORD_TOKEN', 'DISCORD_APP_ID', 'DATABASE_URL'];
const OPTIONAL_KEYS = ['POLLINATIONS_API_KEY'];

const repoRoot = process.cwd();
const envPath = path.join(repoRoot, '.env');
const envExamplePath = path.join(repoRoot, '.env.example');
const dockerComposePath = path.join(repoRoot, 'docker-compose.yml');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (question) =>
  new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });

const askYesNo = async (question, defaultNo = true) => {
  const suffix = defaultNo ? ' (y/N): ' : ' (Y/n): ';
  const answer = (await ask(question + suffix)).toLowerCase();
  if (!answer) {
    return !defaultNo;
  }
  return ['y', 'yes'].includes(answer);
};

const stripQuotes = (value) => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

const parseEnv = (content) => {
  const values = new Map();
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

const parseEnvExampleLines = (content) => {
  return content.split(/\r?\n/);
};

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

const formatValue = (value) => {
  if (value === '') {
    return '';
  }
  if (/[\s#'"]/.test(value)) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
};

const buildEnvOutput = (exampleLines, values, extraEntries) => {
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

const promptRequired = async (label) => {
  while (true) {
    const value = await ask(`${label}: `);
    if (value) {
      return value;
    }
    console.log('Value required.');
  }
};

const promptOptional = async (label) => {
  const value = await ask(`${label} (optional, press Enter to skip): `);
  return value;
};

const promptDatabaseUrl = async () => {
  const defaults = getDockerComposeDefaults();
  const fallbackUrl = 'postgres://postgres:postgres@localhost:5432/sage?schema=public';
  const dockerUrl = defaults
    ? `postgresql://${defaults.user}:${defaults.password}@localhost:${defaults.port}/${defaults.db}?schema=public`
    : fallbackUrl;
  console.log('Choose DATABASE_URL setup:');
  console.log('1) Paste DATABASE_URL');
  console.log(`2) Use local Docker default (${dockerUrl})`);

  while (true) {
    const choice = await ask('Select option (1/2): ');
    if (choice === '1') {
      return await promptRequired('DATABASE_URL');
    }
    if (choice === '2') {
      return dockerUrl;
    }
    console.log('Please enter 1 or 2.');
  }
};

const main = async () => {
  const envExists = fs.existsSync(envPath);
  const existingEnv = envExists ? parseEnv(fs.readFileSync(envPath, 'utf8')) : new Map();
  const exampleLines = fs.existsSync(envExamplePath)
    ? parseEnvExampleLines(fs.readFileSync(envExamplePath, 'utf8'))
    : [];

  const values = new Map(existingEnv);

  for (const key of REQUIRED_KEYS) {
    const existingValue = values.get(key);
    if (existingValue) {
      const overwrite = await askYesNo(`${key} already set. Overwrite?`);
      if (!overwrite) {
        continue;
      }
    }
    if (key === 'DATABASE_URL') {
      const dbUrl = await promptDatabaseUrl();
      values.set(key, dbUrl);
    } else {
      const label = key === 'DISCORD_TOKEN' ? 'DISCORD_TOKEN' : key;
      const value = await promptRequired(label);
      values.set(key, value);
    }
  }

  for (const key of OPTIONAL_KEYS) {
    const existingValue = values.get(key);
    if (existingValue) {
      const overwrite = await askYesNo(`${key} already set. Overwrite?`);
      if (!overwrite) {
        continue;
      }
    }
    if (key === 'POLLINATIONS_API_KEY') {
      console.log('Get one at pollinations.ai to enable higher limits/premium models.');
    }
    const value = await promptOptional(key);
    if (value) {
      values.set(key, value);
    }
  }

  const extraEntries = [];
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

  fs.writeFileSync(envPath, output + '\n', 'utf8');

  console.log(envExists ? '.env updated.' : '.env created.');
  console.log('Next steps:');
  console.log('- npm install');
  console.log('- npm run db:migrate');
  console.log('- npm run dev (or npm run build && npm start)');
};

main()
  .catch((error) => {
    console.error('Setup failed.');
    console.error(error?.message ?? error);
    process.exit(1);
  })
  .finally(() => {
    rl.close();
  });
