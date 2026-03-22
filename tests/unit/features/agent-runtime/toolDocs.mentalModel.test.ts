import { beforeAll, describe, expect, it } from 'vitest';

import {
  getPromptToolGuidance,
  getTopLevelToolDoc,
} from '../../../../src/features/agent-runtime/toolDocs';
import { registerDefaultAgenticTools } from '../../../../src/features/agent-runtime/defaultTools';

beforeAll(async () => {
  await registerDefaultAgenticTools();
});

describe('tool guidance mental model', () => {
  it('teaches the simplified web arbitration clearly', () => {
    const webSearchGuidance = getPromptToolGuidance('web_search');
    const webReadGuidance = getPromptToolGuidance('web_read');
    const webReadPageGuidance = getPromptToolGuidance('web_read_page');

    expect(webSearchGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Fresh external facts -> web_search.',
        'Known exact page -> web_read or web_read_page instead.',
      ]),
    );
    expect(webReadGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Known current docs page or exact URL -> web_read.',
        'Large exact page -> web_read_page.',
        'Need discovery across unknown sources -> web_search first.',
      ]),
    );
    expect(webReadPageGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Large exact page -> web_read_page.',
        'Single-page retrieval -> web_read instead.',
      ]),
    );
  });

  it('teaches developer-tool arbitration clearly for the shipped baseline tool surface', () => {
    const npmDoc = getTopLevelToolDoc('npm_info');

    expect(npmDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('current npm package metadata'),
      ]),
    );
    expect(npmDoc?.validationHint).toContain('packageName');
    expect(npmDoc?.promptGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Current package version or dist-tags -> npm_info.',
      ]),
    );
  });

  it('keeps direct tools schema-first rather than help-first', () => {
    const npmDoc = getTopLevelToolDoc('npm_info');

    expect(npmDoc?.validationHint).toContain('packageName');
    expect(npmDoc?.promptGuidance?.antiPatterns).toEqual(
      expect.arrayContaining([
        expect.stringContaining('repository'),
      ]),
    );
  });

  it('does not advertise optional repository or browser capability docs when the relevant presets are not enabled', () => {
    expect(getTopLevelToolDoc('web_extract')).toBeNull();
    expect(getTopLevelToolDoc('web_research')).toBeNull();
    expect(getTopLevelToolDoc('docs_lookup')).toBeNull();
    expect(getTopLevelToolDoc('repo_search_code')).toBeNull();
    expect(getTopLevelToolDoc('repo_read_file')).toBeNull();
    expect(getTopLevelToolDoc('browser_open_page')).toBeNull();
  });
});
