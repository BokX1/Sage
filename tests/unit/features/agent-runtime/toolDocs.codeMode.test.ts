import { describe, expect, it } from 'vitest';
import {
  buildWebsiteNativeTools,
  getPromptToolGuidance,
  getToolValidationHint,
  getTopLevelToolDoc,
  listTopLevelToolDocs,
} from '../../../../src/features/agent-runtime/toolDocs';
import { listRuntimeSurfaceToolNames } from '../../../../src/features/agent-runtime/runtimeSurface';

describe('Code Mode tool docs', () => {
  it('documents only the bridge-native runtime surface', () => {
    expect(listTopLevelToolDocs().map((doc) => doc.tool)).toEqual(['runtime_execute_code']);
    expect(listRuntimeSurfaceToolNames()).toEqual(['runtime_execute_code']);
  });

  it('teaches direct namespaces instead of legacy sage.* helpers', () => {
    const doc = getTopLevelToolDoc('runtime_execute_code');
    expect(doc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('only host execution surface'),
      ]),
    );
    expect(getPromptToolGuidance('runtime_execute_code')?.argumentNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('discord.messages.send'),
        expect.stringContaining('There is no sage.* root object'),
      ]),
    );
    expect(getToolValidationHint('runtime_execute_code')).toContain('history.recent');
  });

  it('keeps website metadata aligned to the single Code Mode row', () => {
    expect(buildWebsiteNativeTools()).toEqual([
      expect.objectContaining({
        name: 'runtime_execute_code',
      }),
    ]);
  });
});
