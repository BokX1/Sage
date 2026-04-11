import { beforeAll, describe, expect, it } from 'vitest';

import {
  listSmokeToolDocs,
  listTopLevelToolDocs,
} from '../../../../src/features/agent-runtime/toolDocs';
import { registerDefaultAgenticTools } from '../../../../src/features/agent-runtime/defaultTools';

beforeAll(async () => {
  await registerDefaultAgenticTools();
});

describe('tool smoke metadata', () => {
  it('tracks smokeable tools through the granular tool inventory', () => {
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

    expect(required).toEqual(expect.arrayContaining([
      'npm_info',
      'system_time',
      'system_tool_stats',
    ]));
    expect(optional).toEqual(expect.arrayContaining([
      'web_search',
    ]));
    expect(skipped).toEqual(expect.arrayContaining([
      'discord_spaces_create_role',
      'discord_context_get_channel_summary',
      'discord_spaces_list_threads',
      'image_generate',
      'web_read_page',
    ]));
  });

  it('provides sample args for every smokeable tool', () => {
    for (const doc of listSmokeToolDocs()) {
      expect(doc.smoke.args).toBeDefined();
      expect(typeof doc.smoke.args).toBe('object');
      expect(doc.smoke.args).not.toBeNull();
    }
  });
});
