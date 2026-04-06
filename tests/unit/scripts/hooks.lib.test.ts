import { describe, expect, it } from 'vitest';

const hookLibPath = '../../../scripts/hooks/lib.cjs';

describe('hook command selection', () => {
  it('runs docs lint and docs links for staged markdown files only', async () => {
    const hookLib = await import(hookLibPath);
    const { selectSpecs } = hookLib.default ?? hookLib;

    expect(
      selectSpecs('pre-commit', ['README.md', 'src/index.ts', 'docs/reference/RELEASE.md']),
    ).toEqual([
      ['npm', 'run', 'docs:lint', '--', 'README.md', 'docs/reference/RELEASE.md'],
      ['npm', 'run', 'docs:links', '--', 'README.md', 'docs/reference/RELEASE.md'],
    ]);
  });

  it('runs the fast-core gate on every pre-push', async () => {
    const hookLib = await import(hookLibPath);
    const { selectSpecs } = hookLib.default ?? hookLib;

    expect(selectSpecs('pre-push')).toEqual([['npm', 'run', 'check']]);
  });
});
