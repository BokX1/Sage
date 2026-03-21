import { describe, expect, it } from 'vitest';

import {
  getPromptToolGuidance,
  getTopLevelToolDoc,
} from '../../../../src/features/agent-runtime/toolDocs';

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

  it('teaches developer-tool arbitration clearly', () => {
    const githubSearchGuidance = getPromptToolGuidance('github_search_code');
    const githubFileGuidance = getPromptToolGuidance('github_get_file');
    const npmDoc = getTopLevelToolDoc('npm_info');
    const workflowGuidance = getPromptToolGuidance('workflow_npm_github_code_search');

    expect(githubSearchGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Unknown path inside a repo -> github_search_code.',
        'Known exact path -> github_get_file or github_get_file_snippet instead.',
      ]),
    );
    expect(githubFileGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Known exact path -> github_get_file.',
        'Unknown exact path -> github_search_code first.',
      ]),
    );
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
    expect(workflowGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Known repo already -> use direct GitHub tools instead.',
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

  it('keeps repo-path lookup and exact-file fetch as separate decisions', () => {
    const searchDoc = getTopLevelToolDoc('github_search_code');
    const fileDoc = getTopLevelToolDoc('github_get_file');

    expect(searchDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('path'),
      ]),
    );
    expect(fileDoc?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('path is still unknown'),
      ]),
    );
  });
});
