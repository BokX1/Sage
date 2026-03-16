/* eslint-disable no-console */
import dotenv from 'dotenv';
import {
  probeAiProviderStrictStructuredOutputs,
  type AiProviderProbeResult,
} from '../platform/llm/ai-provider-probe';

type CliFlags = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  json: boolean;
  help: boolean;
};

function printHelp() {
  console.log(`AI Provider Strict Structured-Output Probe

Usage:
  npm run ai-provider:probe -- [options]

Options:
  --base-url <url>        AI provider base URL (defaults to AI_PROVIDER_BASE_URL)
  --model <id>            Model id to probe (defaults to AI_PROVIDER_MAIN_AGENT_MODEL)
  --api-key <key>         API key to use (defaults to AI_PROVIDER_API_KEY)
  --timeout-ms <ms>       Request timeout in milliseconds (default: 10000)
  --json                  Output machine-readable JSON
  -h, --help              Show this help
`);
}

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    json: false,
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
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--base-url') {
      flags.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      flags.baseUrl = arg.slice('--base-url='.length);
      continue;
    }
    if (arg === '--model') {
      flags.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--model=')) {
      flags.model = arg.slice('--model='.length);
      continue;
    }
    if (arg === '--api-key') {
      flags.apiKey = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--api-key=')) {
      flags.apiKey = arg.slice('--api-key='.length);
      continue;
    }
    if (arg === '--timeout-ms') {
      const value = argv[i + 1];
      flags.timeoutMs = value ? Number.parseInt(value, 10) : Number.NaN;
      i += 1;
      continue;
    }
    if (arg.startsWith('--timeout-ms=')) {
      flags.timeoutMs = Number.parseInt(arg.slice('--timeout-ms='.length), 10);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return flags;
}

function printHumanResult(result: AiProviderProbeResult) {
  const status = result.ok ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${result.message}`);
  for (const detail of result.details ?? []) {
    console.log(`- ${detail}`);
  }
}

async function runProbe(): Promise<number> {
  dotenv.config({ quiet: true });
  const flags = parseArgs(process.argv);
  if (flags.help) {
    printHelp();
    return 0;
  }

  const baseUrl = flags.baseUrl?.trim() || process.env.AI_PROVIDER_BASE_URL?.trim();
  const model = flags.model?.trim() || process.env.AI_PROVIDER_MAIN_AGENT_MODEL?.trim();
  const apiKey = flags.apiKey?.trim() || process.env.AI_PROVIDER_API_KEY?.trim();

  if (!baseUrl) {
    throw new Error('AI provider base URL is required. Pass --base-url or set AI_PROVIDER_BASE_URL.');
  }
  if (!model) {
    throw new Error('AI provider model is required. Pass --model or set AI_PROVIDER_MAIN_AGENT_MODEL.');
  }
  if (!apiKey) {
    throw new Error('AI provider API key is required. Pass --api-key or set AI_PROVIDER_API_KEY.');
  }

  const result = await probeAiProviderStrictStructuredOutputs({
    baseUrl,
    model,
    apiKey,
    timeoutMs: flags.timeoutMs,
  });

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHumanResult(result);
  }

  return result.ok ? 0 : 1;
}

if (require.main === module) {
  void runProbe()
    .then((exitCode) => {
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    })
    .catch((error) => {
      console.error('AI provider probe failed.');
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

export { runProbe };

