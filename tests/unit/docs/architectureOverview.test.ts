import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listRuntimeSurfaceToolNames } from '../../../src/features/agent-runtime/runtimeSurface';

async function loadOverviewToolTableNames(): Promise<string[]> {
  const overviewPath = path.resolve(
    __dirname,
    '../../../docs/architecture/OVERVIEW.md',
  );
  const markdown = await readFile(overviewPath, 'utf8');
  return Array.from(
    markdown.matchAll(/^\| `([^`]+)` \|/gm),
    (match) => match[1],
  );
}

describe('architecture overview tool inventory', () => {
  it('reflects the registered top-level runtime tool inventory in its tool tables', async () => {
    const overviewToolNames = await loadOverviewToolTableNames();
    const runtimeToolNames = listRuntimeSurfaceToolNames().sort((a, b) => a.localeCompare(b));

    expect(overviewToolNames.sort((a, b) => a.localeCompare(b))).toEqual(runtimeToolNames);
  });
});
