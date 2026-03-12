import { describe, expect, it } from 'vitest';

import {
  listSmokeToolDocs,
  listTopLevelToolDocs,
} from '../../../../src/features/agent-runtime/toolDocs';

describe('tool smoke metadata', () => {
  it('matches the intended public non-Discord smoke inventory', () => {
    const allDocs = listTopLevelToolDocs();
    const required = allDocs
      .filter((doc) => doc.smoke.mode === 'required')
      .map((doc) => doc.tool)
      .sort((a, b) => a.localeCompare(b));
    const optional = allDocs
      .filter((doc) => doc.smoke.mode === 'optional')
      .map((doc) => doc.tool)
      .sort((a, b) => a.localeCompare(b));
    const skipped = allDocs
      .filter((doc) => doc.smoke.mode === 'skip')
      .map((doc) => doc.tool)
      .sort((a, b) => a.localeCompare(b));

    expect(required).toEqual([
      'github',
      'npm_info',
      'stack_overflow_search',
      'system_time',
      'system_tool_stats',
      'web',
      'wikipedia_search',
      'workflow',
    ]);
    expect(optional).toEqual(['image_generate']);
    expect(skipped).toEqual([
      'discord_admin',
      'discord_context',
      'discord_files',
      'discord_messages',
      'discord_server',
      'discord_voice',
    ]);
  });

  it('provides sample args for every smokeable tool', () => {
    for (const doc of listSmokeToolDocs()) {
      expect(doc.smoke.args).toBeDefined();
      expect(typeof doc.smoke.args).toBe('object');
      expect(doc.smoke.args).not.toBeNull();
    }
  });
});
