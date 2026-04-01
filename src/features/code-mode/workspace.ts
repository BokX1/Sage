import crypto from 'crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../../platform/logging/logger';
import type { ToolArtifact } from '../agent-runtime/toolRegistry';
import type {
  CodeModeEffectRecord,
  CodeModeExecutionSnapshot,
  SerializedToolArtifact,
} from './types';

const CODE_MODE_ROOT = path.resolve(process.cwd(), 'data', 'code-mode');

export interface CodeModeTaskWorkspace {
  taskId: string;
  rootDir: string;
  sandboxDir: string;
  internalDir: string;
  executionsDir: string;
}

function sanitizeTaskSegment(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return crypto.randomUUID();
  }
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || crypto.randomUUID();
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function getOrCreateCodeModeTaskWorkspace(taskId: string): Promise<CodeModeTaskWorkspace> {
  const normalizedTaskId = sanitizeTaskSegment(taskId);
  const rootDir = path.join(CODE_MODE_ROOT, 'tasks', normalizedTaskId);
  const sandboxDir = path.join(rootDir, 'sandbox');
  const internalDir = path.join(rootDir, '.internal');
  const executionsDir = path.join(internalDir, 'executions');

  await ensureDir(sandboxDir);
  await ensureDir(executionsDir);

  return {
    taskId: normalizedTaskId,
    rootDir,
    sandboxDir,
    internalDir,
    executionsDir,
  };
}

function executionSnapshotPath(workspace: CodeModeTaskWorkspace, executionId: string): string {
  return path.join(workspace.executionsDir, `${sanitizeTaskSegment(executionId)}.snapshot.json`);
}

function executionEffectsPath(workspace: CodeModeTaskWorkspace, executionId: string): string {
  return path.join(workspace.executionsDir, `${sanitizeTaskSegment(executionId)}.effects.json`);
}

export async function saveCodeModeExecutionSnapshot(
  workspace: CodeModeTaskWorkspace,
  snapshot: CodeModeExecutionSnapshot,
): Promise<void> {
  const payload = JSON.stringify(
    {
      ...snapshot,
      updatedAtIso: new Date().toISOString(),
    },
    null,
    2,
  );
  await fs.writeFile(executionSnapshotPath(workspace, snapshot.executionId), payload, 'utf8');
}

export async function loadCodeModeExecutionSnapshot(
  workspace: CodeModeTaskWorkspace,
  executionId: string,
): Promise<CodeModeExecutionSnapshot | null> {
  try {
    const raw = await fs.readFile(executionSnapshotPath(workspace, executionId), 'utf8');
    return JSON.parse(raw) as CodeModeExecutionSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logger.warn({ error, executionId }, 'Failed to read Code Mode execution snapshot');
    }
    return null;
  }
}

export async function loadCodeModeEffectLog(
  workspace: CodeModeTaskWorkspace,
  executionId: string,
): Promise<CodeModeEffectRecord[]> {
  try {
    const raw = await fs.readFile(executionEffectsPath(workspace, executionId), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CodeModeEffectRecord[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logger.warn({ error, executionId }, 'Failed to read Code Mode effect log');
    }
    return [];
  }
}

export async function saveCodeModeEffectLog(
  workspace: CodeModeTaskWorkspace,
  executionId: string,
  entries: CodeModeEffectRecord[],
): Promise<void> {
  await fs.writeFile(
    executionEffectsPath(workspace, executionId),
    JSON.stringify(entries, null, 2),
    'utf8',
  );
}

function ensureSandboxPath(workspace: CodeModeTaskWorkspace, relativePath: string): string {
  const candidate = path.resolve(workspace.sandboxDir, relativePath || '.');
  const normalizedSandbox = `${path.resolve(workspace.sandboxDir)}${path.sep}`;
  const normalizedCandidate = path.resolve(candidate);
  if (normalizedCandidate !== path.resolve(workspace.sandboxDir) && !normalizedCandidate.startsWith(normalizedSandbox)) {
    throw new Error('Workspace path escapes the task sandbox.');
  }
  return normalizedCandidate;
}

export async function workspaceReadText(
  workspace: CodeModeTaskWorkspace,
  relativePath: string,
): Promise<string> {
  const target = ensureSandboxPath(workspace, relativePath);
  return fs.readFile(target, 'utf8');
}

export async function workspaceWriteText(
  workspace: CodeModeTaskWorkspace,
  relativePath: string,
  content: string,
): Promise<{ bytesWritten: number }> {
  const target = ensureSandboxPath(workspace, relativePath);
  await ensureDir(path.dirname(target));
  await fs.writeFile(target, content, 'utf8');
  return { bytesWritten: Buffer.byteLength(content, 'utf8') };
}

export async function workspaceAppendText(
  workspace: CodeModeTaskWorkspace,
  relativePath: string,
  content: string,
): Promise<{ bytesWritten: number }> {
  const target = ensureSandboxPath(workspace, relativePath);
  await ensureDir(path.dirname(target));
  await fs.appendFile(target, content, 'utf8');
  return { bytesWritten: Buffer.byteLength(content, 'utf8') };
}

export async function workspaceDeletePath(
  workspace: CodeModeTaskWorkspace,
  relativePath: string,
): Promise<{ deleted: boolean }> {
  const target = ensureSandboxPath(workspace, relativePath);
  await fs.rm(target, { recursive: true, force: true });
  return { deleted: true };
}

export async function workspaceList(
  workspace: CodeModeTaskWorkspace,
  relativePath = '.',
): Promise<Array<{ path: string; kind: 'file' | 'directory'; sizeBytes?: number }>> {
  const target = ensureSandboxPath(workspace, relativePath);
  const entries = await fs.readdir(target, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return [];
    }
    throw error;
  });

  const output: Array<{ path: string; kind: 'file' | 'directory'; sizeBytes?: number }> = [];
  for (const entry of entries) {
    const absolute = path.join(target, entry.name);
    const relative = path.relative(workspace.sandboxDir, absolute).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      output.push({ path: relative || '.', kind: 'directory' });
      continue;
    }
    const stat = await fs.stat(absolute).catch(() => null);
    output.push({ path: relative || entry.name, kind: 'file', sizeBytes: stat?.size });
  }
  return output;
}

export async function workspaceSearch(
  workspace: CodeModeTaskWorkspace,
  query: string,
  relativePath = '.',
): Promise<Array<{ path: string; matches: number }>> {
  const target = ensureSandboxPath(workspace, relativePath);
  const needle = query.trim();
  if (!needle) {
    return [];
  }

  const results: Array<{ path: string; matches: number }> = [];

  async function visit(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return [];
      }
      throw error;
    });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      const content = await fs.readFile(absolute, 'utf8').catch(() => null);
      if (typeof content !== 'string') continue;
      const matchCount = content.split(needle).length - 1;
      if (matchCount > 0) {
        results.push({
          path: path.relative(workspace.sandboxDir, absolute).replace(/\\/g, '/'),
          matches: matchCount,
        });
      }
    }
  }

  await visit(target);
  return results;
}

export async function cleanupCodeModeTaskWorkspace(taskId: string): Promise<void> {
  const workspace = await getOrCreateCodeModeTaskWorkspace(taskId);
  await fs.rm(workspace.rootDir, { recursive: true, force: true }).catch((error) => {
    logger.warn({ error, taskId }, 'Failed to clean Code Mode task workspace');
  });
}

export function serializeArtifacts(artifacts: ToolArtifact[]): SerializedToolArtifact[] {
  return artifacts.map((artifact) => ({
    kind: artifact.kind,
    name: artifact.name,
    filename: artifact.filename,
    mimetype: artifact.mimetype,
    visibleSummary: artifact.visibleSummary,
    payload: artifact.payload,
    dataBase64: artifact.data ? artifact.data.toString('base64') : undefined,
  }));
}

export function deserializeArtifacts(artifacts: SerializedToolArtifact[] | undefined): ToolArtifact[] {
  return (artifacts ?? []).map((artifact) => ({
    kind: artifact.kind,
    name: artifact.name,
    filename: artifact.filename,
    mimetype: artifact.mimetype,
    visibleSummary: artifact.visibleSummary,
    payload: artifact.payload,
    data: artifact.dataBase64 ? Buffer.from(artifact.dataBase64, 'base64') : undefined,
  }));
}
