import fs from 'node:fs';
import path from 'node:path';

type CanonicalStatus = 'completed' | 'in_progress' | 'pending' | 'unknown';

interface PhaseRow {
  phase: number;
  title: string;
  statusText: string;
  status: CanonicalStatus;
}

interface CheckContext {
  errors: string[];
  warnings: string[];
}

function readTextFileOrThrow(rootDir: string, relativePath: string): string {
  const filePath = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file missing: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function readTextFileIfExists(rootDir: string, relativePath: string): string | null {
  const filePath = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function resolveCanonicalRoadmap(rootDir: string, ctx: CheckContext): { markdown: string; relativePath: string } | null {
  const envPath = process.env.AGENTIC_CANONICAL_ROADMAP_PATH?.trim();
  const candidates = [
    envPath && envPath.length > 0 ? envPath : null,
    'docs/architecture/AGENTIC_ROADMAP_IMPLEMENTATION.md',
    'docs/architecture/AGENTIC_ROADMAP.md',
    'docs/roadmap/AGENTIC_ROADMAP_IMPLEMENTATION.md',
    'docs/roadmap/AGENTIC_ROADMAP.md',
  ].filter((value): value is string => typeof value === 'string');

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const markdown = readTextFileIfExists(rootDir, candidate);
    if (markdown !== null) {
      return { markdown, relativePath: candidate };
    }
  }

  ctx.warnings.push(
    `Canonical roadmap file not found (checked: ${Array.from(seen).join(', ')}). Phase progression checks were skipped.`,
  );
  return null;
}

function normalizeStatus(statusText: string): CanonicalStatus {
  const normalized = statusText.trim().toLowerCase();
  if (normalized.includes('in_progress')) return 'in_progress';
  if (normalized.includes('completed')) return 'completed';
  if (normalized.includes('pending')) return 'pending';
  return 'unknown';
}

function parsePhaseRows(markdown: string): PhaseRow[] {
  const rows: PhaseRow[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    if (!line.includes(' - ')) continue;
    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);
    if (cells.length < 3) continue;
    const phaseCell = cells[0] ?? '';
    const statusCell = cells[1] ?? '';
    const notesCell = cells[2] ?? '';
    if (!/^\d+\s+-\s+/.test(phaseCell)) continue;
    const phase = Number((phaseCell.match(/^(\d+)/) ?? [])[1]);
    if (!Number.isFinite(phase)) continue;
    const title = phaseCell.replace(/^\d+\s+-\s+/, '').trim();
    rows.push({
      phase,
      title,
      statusText: `${statusCell}${notesCell ? ` | ${notesCell}` : ''}`,
      status: normalizeStatus(statusCell),
    });
  }
  return rows.sort((a, b) => a.phase - b.phase);
}

function parseCanonicalNextPhase(markdown: string): number | null {
  const match = markdown.match(/Canonical next phase in sequence:\s*\*\*Phase\s+(\d+)\*\*/i);
  if (!match) return null;
  const phase = Number(match[1]);
  return Number.isFinite(phase) ? phase : null;
}

function expect(condition: boolean, message: string, ctx: CheckContext): void {
  if (!condition) ctx.errors.push(message);
}

function warn(condition: boolean, message: string, ctx: CheckContext): void {
  if (!condition) ctx.warnings.push(message);
}

function ensurePhaseProgression(rows: PhaseRow[], ctx: CheckContext): number | null {
  expect(rows.length > 0, 'No phase rows found in canonical roadmap table.', ctx);
  if (rows.length === 0) return null;

  const firstPhase = rows[0]?.phase ?? -1;
  expect(firstPhase === 0, `Canonical roadmap must start at phase 0 (found ${firstPhase}).`, ctx);

  for (let idx = 1; idx < rows.length; idx += 1) {
    const prev = rows[idx - 1];
    const current = rows[idx];
    expect(
      current.phase === prev.phase + 1,
      `Phase sequence has a gap between ${prev.phase} and ${current.phase}.`,
      ctx,
    );
  }

  for (const row of rows) {
    expect(row.status !== 'unknown', `Unknown status for phase ${row.phase}: "${row.statusText}"`, ctx);
  }

  const inProgressPhases = rows.filter((row) => row.status === 'in_progress').map((row) => row.phase);
  expect(
    inProgressPhases.length <= 1,
    `At most one phase can be in_progress (found ${inProgressPhases.join(', ')}).`,
    ctx,
  );

  const firstIncomplete = rows.find((row) => row.status !== 'completed');
  const expectedNextPhase = firstIncomplete ? firstIncomplete.phase : null;

  if (inProgressPhases.length === 1) {
    const active = inProgressPhases[0];
    for (const row of rows) {
      if (row.phase < active) {
        expect(row.status === 'completed', `Phase ${row.phase} must be completed before active phase ${active}.`, ctx);
      } else if (row.phase > active) {
        expect(row.status === 'pending', `Phase ${row.phase} must be pending after active phase ${active}.`, ctx);
      }
    }
  } else if (inProgressPhases.length === 0 && expectedNextPhase !== null) {
    for (const row of rows) {
      if (row.phase < expectedNextPhase) {
        expect(
          row.status === 'completed',
          `Phase ${row.phase} must be completed before first pending phase ${expectedNextPhase}.`,
          ctx,
        );
      } else {
        expect(
          row.status === 'pending',
          `Phase ${row.phase} must be pending at/after first pending phase ${expectedNextPhase}.`,
          ctx,
        );
      }
    }
  }

  return expectedNextPhase;
}

function ensureFoundationPolicy(rows: PhaseRow[], ctx: CheckContext): void {
  const phase0 = rows.find((row) => row.phase === 0);
  expect(!!phase0, 'Phase 0 row is missing in canonical roadmap.', ctx);
  if (phase0) {
    expect(
      phase0.status === 'completed',
      `Phase 0 must be completed before any later phase work (found ${phase0.status}).`,
      ctx,
    );
  }
}

function ensurePackageScripts(rootDir: string, ctx: CheckContext): void {
  const packageJsonText = readTextFileOrThrow(rootDir, 'package.json');
  const pkg = JSON.parse(packageJsonText) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};

  const requiredScripts = [
    'check',
    'release:check',
    'release:agentic-check',
    'agentic:replay-gate',
    'eval:gate',
    'agentic:consistency-check',
  ];
  for (const scriptName of requiredScripts) {
    expect(
      typeof scripts[scriptName] === 'string' && scripts[scriptName].trim().length > 0,
      `Missing required npm script: "${scriptName}".`,
      ctx,
    );
  }

  warn(
    (scripts['release:agentic-check'] ?? '').includes('replay-gate') &&
      (scripts['release:agentic-check'] ?? '').includes('eval-gate'),
    'release:agentic-check should include both replay-gate and eval-gate.',
    ctx,
  );
}

function ensureDocWiring(rootDir: string, ctx: CheckContext): void {
  const runbook = readTextFileOrThrow(rootDir, 'docs/operations/RUNBOOK.md');
  const release = readTextFileOrThrow(rootDir, 'docs/reference/RELEASE.md');

  expect(
    runbook.includes('npm run agentic:consistency-check'),
    'RUNBOOK must reference npm run agentic:consistency-check.',
    ctx,
  );
  expect(
    release.includes('npm run agentic:consistency-check'),
    'RELEASE guide must reference npm run agentic:consistency-check.',
    ctx,
  );
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const ctx: CheckContext = { errors: [], warnings: [] };

  let rows: PhaseRow[] = [];
  const canonicalRoadmap = resolveCanonicalRoadmap(rootDir, ctx);
  if (canonicalRoadmap) {
    rows = parsePhaseRows(canonicalRoadmap.markdown);
    const expectedNextPhase = ensurePhaseProgression(rows, ctx);
    ensureFoundationPolicy(rows, ctx);

    const canonicalNextPhase = parseCanonicalNextPhase(canonicalRoadmap.markdown);
    if (expectedNextPhase !== null) {
      expect(
        canonicalNextPhase === expectedNextPhase,
        `Canonical next phase mismatch in ${canonicalRoadmap.relativePath}: expected ${expectedNextPhase}, found ${
          canonicalNextPhase ?? 'missing'
        }.`,
        ctx,
      );
    }
  }

  ensurePackageScripts(rootDir, ctx);
  ensureDocWiring(rootDir, ctx);

  if (rows.length > 0) {
    const phaseSummary = rows.map((row) => `${row.phase}:${row.status}`).join(', ');
    console.warn('[agentic-consistency-check] phase-statuses', phaseSummary);
  }

  if (ctx.warnings.length > 0) {
    for (const warning of ctx.warnings) {
      console.warn('[agentic-consistency-check] warning', warning);
    }
  }

  if (ctx.errors.length > 0) {
    for (const error of ctx.errors) {
      console.error('[agentic-consistency-check] error', error);
    }
    throw new Error(`Consistency check failed with ${ctx.errors.length} error(s).`);
  }

  console.warn('[agentic-consistency-check] passed');
}

main().catch((error) => {
  console.error(
    '[agentic-consistency-check] failed',
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
