import { describe, expect, it } from 'vitest';

import {
  buildRoutedToolHelp,
  getPromptToolGuidance,
  getTopLevelToolDoc,
} from '../../../../src/features/agent-runtime/toolDocs';

describe('tool guidance mental model', () => {
  it('teaches top-level search and research arbitration clearly', () => {
    const webGuidance = getPromptToolGuidance('web');
    const wikipediaGuidance = getPromptToolGuidance('wikipedia_search');
    const stackOverflowGuidance = getPromptToolGuidance('stack_overflow_search');

    expect(webGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Fresh external facts or open web research -> web.',
        'Canonical topic grounding with no freshness requirement -> wikipedia_search instead.',
        'Coding Q&A or accepted-answer hunting -> stack_overflow_search instead.',
      ]),
    );
    expect(webGuidance?.antiPatterns).toEqual(
      expect.arrayContaining([
        'Avoid sequential page-by-page read loops; batch reads or use research.',
      ]),
    );

    expect(wikipediaGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Broad canonical topic grounding -> wikipedia_search.',
        'Fresh, time-sensitive, or multi-source facts -> web instead.',
      ]),
    );
    expect(stackOverflowGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Coding Q&A or accepted-answer solution hunting -> stack_overflow_search.',
        'Fresh docs, product facts, or open-web research -> web instead.',
      ]),
    );
  });

  it('teaches developer-tool arbitration clearly', () => {
    const githubGuidance = getPromptToolGuidance('github');
    const npmGuidance = getPromptToolGuidance('npm_info');
    const workflowGuidance = getPromptToolGuidance('workflow');

    expect(githubGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'Unknown file path -> `code.search` first.',
        'npm registry metadata only -> npm_info instead.',
        'npm package to GitHub code search in one hop -> workflow instead.',
      ]),
    );
    expect(githubGuidance?.antiPatterns).toBeUndefined();

    expect(npmGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'npm package metadata, maintainers, or repo hint -> npm_info.',
        'Need GitHub repo or code lookup after you know the repo -> github instead.',
      ]),
    );

    expect(workflowGuidance?.decisionEdges).toEqual(
      expect.arrayContaining([
        'One call can replace a routine multi-hop chain -> workflow.',
        'Known GitHub repo and direct GitHub data -> github instead.',
      ]),
    );
  });

  it('keeps routed help self-sufficient for likely first actions and wrong turns', () => {
    const webHelp = buildRoutedToolHelp('web') as {
      action_contracts: Array<Record<string, unknown>>;
    };
    const githubHelp = buildRoutedToolHelp('github') as {
      action_contracts: Array<Record<string, unknown>>;
    };
    const workflowHelp = buildRoutedToolHelp('workflow') as {
      action_contracts: Array<Record<string, unknown>>;
    };

    const webSearch = webHelp.action_contracts.find((contract) => contract.action === 'search');
    const webResearch = webHelp.action_contracts.find((contract) => contract.action === 'research');
    const githubRepoGet = githubHelp.action_contracts.find((contract) => contract.action === 'repo.get');
    const githubFileGet = githubHelp.action_contracts.find((contract) => contract.action === 'file.get');
    const workflowSearch = workflowHelp.action_contracts.find(
      (contract) => contract.action === 'npm.github_code_search',
    );

    expect(webSearch?.avoid_when).toEqual(
      expect.arrayContaining([
        'You already know the exact page you want to read; use read or read.page.',
        'You want one-shot search plus grounded reads; use research.',
      ]),
    );
    expect(webResearch?.avoid_when).toEqual(
      expect.arrayContaining([
        'You already know the exact page you want to read; use read or read.page.',
      ]),
    );
    expect(githubRepoGet?.avoid_when).toEqual(
      expect.arrayContaining([
        'You need to locate code and do not know the path yet; use code.search first.',
      ]),
    );
    expect(githubFileGet?.common_mistakes).toEqual(
      expect.arrayContaining([
        'Do not call file.get before code.search when the path is still unknown.',
      ]),
    );
    expect(workflowSearch?.avoid_when).toEqual(
      expect.arrayContaining([
        'You already know the GitHub repo and can call github directly.',
        'You only need npm registry metadata and not GitHub code search.',
      ]),
    );
  });

  it('keeps direct tools schema-first rather than help-first', () => {
    const npmDoc = getTopLevelToolDoc('npm_info');
    const wikipediaDoc = getTopLevelToolDoc('wikipedia_search');
    const stackOverflowDoc = getTopLevelToolDoc('stack_overflow_search');

    expect(npmDoc?.validationHint).toContain('packageName');
    expect(npmDoc?.promptGuidance?.helpHint).toBeUndefined();
    expect(npmDoc?.promptGuidance?.antiPatterns).toBeUndefined();

    expect(wikipediaDoc?.promptGuidance?.helpHint).toBeUndefined();
    expect(stackOverflowDoc?.promptGuidance?.helpHint).toBeUndefined();
  });

  it('keeps github-vs-npm routing in decision edges instead of anti-pattern duplication', () => {
    const githubGuidance = getPromptToolGuidance('github');
    const npmGuidance = getPromptToolGuidance('npm_info');

    expect(githubGuidance?.decisionEdges).toEqual(
      expect.arrayContaining(['npm registry metadata only -> npm_info instead.']),
    );
    expect(npmGuidance?.decisionEdges).toEqual(
      expect.arrayContaining(['Need GitHub repo or code lookup after you know the repo -> github instead.']),
    );
    expect(githubGuidance?.antiPatterns).toBeUndefined();
    expect(npmGuidance?.antiPatterns).toBeUndefined();
  });
});
