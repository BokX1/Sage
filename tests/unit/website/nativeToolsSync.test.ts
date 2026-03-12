import { describe, expect, it } from 'vitest';

import { buildWebsiteNativeTools } from '../../../src/features/agent-runtime/toolDocs';

type NativeToolRow = {
  name: string;
  short: string;
  desc: string;
  cat: string;
  color: string;
};

async function loadWebsiteNativeTools(): Promise<{
  nativeTools: NativeToolRow[];
  nativeToolCount: number;
}> {
  const modulePath = '../../../website/src/lib/nativeTools.js';
  const mod = (await import(modulePath)) as {
    nativeTools?: unknown;
    nativeToolCount?: unknown;
  };
  return {
    nativeTools: Array.isArray(mod.nativeTools) ? (mod.nativeTools as NativeToolRow[]) : [],
    nativeToolCount: typeof mod.nativeToolCount === 'number' ? mod.nativeToolCount : 0,
  };
}

describe('website native tools list', () => {
  it('matches the generated runtime metadata rows exactly', async () => {
    const website = await loadWebsiteNativeTools();
    const generated = buildWebsiteNativeTools();

    expect(website.nativeTools).toEqual(generated);
    expect(website.nativeToolCount).toBe(generated.length);
  });
});
