/* eslint-disable no-console */

import { spawn } from 'node:child_process';

interface CommandSpec {
  label: string;
  args: string[];
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function readSeedList(name: string, fallback: number[]): number[] {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.floor(value));
  return parsed.length > 0 ? parsed : fallback;
}

function runNpmCommand(args: string[], label: string): Promise<void> {
  const npmCliPath = process.env.npm_execpath;
  const npmCommand = npmCliPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const commandArgs = npmCliPath ? [npmCliPath, ...args] : args;

  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, commandArgs, {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      reject(new Error(`[test:trust] ${label} failed to start: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`[test:trust] ${label} failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

function buildCommands(baselineRuns: number, shuffleSeeds: number[]): CommandSpec[] {
  const baseline: CommandSpec[] = [];
  for (let index = 1; index <= baselineRuns; index += 1) {
    baseline.push({
      label: `baseline run ${index}/${baselineRuns}`,
      args: ['run', 'test'],
    });
  }

  const shuffled: CommandSpec[] = shuffleSeeds.map((seed, index) => ({
    label: `shuffle run ${index + 1}/${shuffleSeeds.length} (seed=${seed})`,
    args: [
      'run',
      'test',
      '--',
      '--sequence.shuffle',
      `--sequence.seed=${seed}`,
      '--no-file-parallelism',
      '--maxWorkers=1',
    ],
  }));

  return [...baseline, ...shuffled];
}

async function main(): Promise<void> {
  const baselineRuns = readPositiveInt('TEST_TRUST_BASELINE_RUNS', 2);
  const shuffleSeeds = readSeedList('TEST_TRUST_SHUFFLE_SEEDS', [41, 97]);
  const commands = buildCommands(baselineRuns, shuffleSeeds);

  console.log('[test:trust] config', {
    baselineRuns,
    shuffleSeeds,
    totalExecutions: commands.length,
  });

  for (const command of commands) {
    console.log(`[test:trust] running ${command.label}`);
    await runNpmCommand(command.args, command.label);
  }

  console.log('[test:trust] passed');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
