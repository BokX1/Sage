import { describe, expect, it } from 'vitest';

import { buildStableMcpToolName, sanitizeMcpServerId } from '../../../../../src/features/agent-runtime/mcp/naming';

describe('mcp naming', () => {
  it('sanitizes server ids deterministically', () => {
    expect(sanitizeMcpServerId('GitHub Cloud')).toBe('github_cloud');
    expect(sanitizeMcpServerId('   ')).toBe('unknown');
  });

  it('builds stable namespaced tool names', () => {
    expect(
      buildStableMcpToolName({
        serverId: 'GitHub',
        rawToolName: 'Search Code',
      }),
    ).toBe('mcp__github__search_code');
  });

  it('adds a deterministic suffix when a sanitized name collides', () => {
    const existingNames = new Set(['mcp__github__search_code']);

    const left = buildStableMcpToolName({
      serverId: 'GitHub',
      rawToolName: 'Search Code',
      existingNames,
    });
    const right = buildStableMcpToolName({
      serverId: 'GitHub',
      rawToolName: 'Search Code',
      existingNames,
    });

    expect(left).toMatch(/^mcp__github__search_code__[a-f0-9]{8}$/);
    expect(right).toBe(left);
  });
});
