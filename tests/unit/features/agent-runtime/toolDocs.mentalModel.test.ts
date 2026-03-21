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
  it('teaches top-level search and research arbitration clearly', () => {
    const webSearchGuidance = getPromptToolGuidance('web_search');
    const webReadGuidance = getPromptToolGuidance('web_read');
    const webExtractGuidance = getPromptToolGuidance('web_extract');
    const webResearchGuidance = getPromptToolGuidance('web_research');
    const wikipediaDoc = getTopLevelToolDoc('wikipedia_search');
    const stackOverflowDoc = getTopLevelToolDoc('stack_overflow_search');

    expect(webSearchGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Fresh external facts -> web_search.',
        'Known exact page -> web_read or web_read_page instead.',
      ]),
    );
    expect(webResearchGuidance?.antiPatterns).toEqual(
      expect.arrayContaining([
        expect.stringContaining('unbounded crawl loops'),
      ]),
    );
    expect(webReadGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Known current docs page or exact URL -> web_read.',
        'Need discovery across unknown sources -> web_search first.',
      ]),
    );
    expect(webExtractGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Known page plus exact fields/behaviors -> web_extract.',
        'Known page but general reading -> web_read instead.',
      ]),
    );
    expect(wikipediaDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Wikipedia'),
      ]),
    );
    expect(stackOverflowDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Stack Overflow'),
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
    const wikipediaDoc = getTopLevelToolDoc('wikipedia_search');
    const stackOverflowDoc = getTopLevelToolDoc('stack_overflow_search');

    expect(npmDoc?.validationHint).toContain('packageName');
    expect(npmDoc?.promptGuidance?.antiPatterns).toEqual(
      expect.arrayContaining([
        expect.stringContaining('repository'),
      ]),
    );
    expect(wikipediaDoc?.purpose).toContain('Wikipedia');
    expect(stackOverflowDoc?.purpose).toContain('Stack Overflow');
  });

  it('does not advertise optional MCP-backed GitHub docs when the GitHub MCP preset is not enabled', () => {
    expect(getTopLevelToolDoc('mcp__github__search_code')).toBeNull();
    expect(getTopLevelToolDoc('mcp__github__get_file_contents')).toBeNull();
  });
});
