import { describe, expect, it } from 'vitest';

import { analyzeTestFileContent } from '../../../src/cli/test-audit-lib';

describe('test-audit-lib', () => {
  it('counts parameterized cases and scales assertion totals', () => {
    const source = `
      const scalarCases = [1, 2, 3] as const;

      it.each(scalarCases)('checks scalar %s', (value) => {
        expect(value).toBeGreaterThan(0);
      });

      test.each([{ count: 1 }, { count: 2 }])('checks object', ({ count }) => {
        expect(count).toBeGreaterThan(0);
      });
    `;

    const result = analyzeTestFileContent(source, 'tests/demo.test.ts', {
      requireStrongAssertions: true,
    });

    expect(result.scannedTestCases).toBe(5);
    expect(result.expectCallCount).toBe(5);
    expect(result.matcherAssertionCount).toBe(5);
    expect(result.weakMatcherCount).toBe(0);
    expect(result.strongMatcherCount).toBe(5);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('fails tests that only use weak matchers when strict mode is enabled', () => {
    const source = `
      it('weak test', () => {
        expect(true).toBe(true);
      });
    `;

    const result = analyzeTestFileContent(source, 'tests/weak.test.ts', {
      requireStrongAssertions: true,
    });

    expect(result.weakOnlyTestCount).toBe(1);
    expect(result.failures).toEqual([
      {
        file: 'tests/weak.test.ts',
        detail: 'test "weak test" uses only weak matchers',
      },
    ]);
  });

  it('downgrades weak-only tests to warnings when strict mode is disabled', () => {
    const source = `
      it('weak test', () => {
        expect(true).toBe(true);
      });
    `;

    const result = analyzeTestFileContent(source, 'tests/weak-warn.test.ts', {
      requireStrongAssertions: false,
    });

    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([
      {
        file: 'tests/weak-warn.test.ts',
        detail: 'test "weak test" uses only weak matchers',
      },
    ]);
  });

  it('allows mixed weak and strong assertions', () => {
    const source = `
      it('mixed assertions', () => {
        expect(true).toBe(true);
        expect({ ok: true }).toEqual({ ok: true });
      });
    `;

    const result = analyzeTestFileContent(source, 'tests/mixed.test.ts', {
      requireStrongAssertions: true,
    });

    expect(result.weakMatcherCount).toBe(1);
    expect(result.strongMatcherCount).toBe(1);
    expect(result.weakOnlyTestCount).toBe(0);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('warns when a test has no assertion matcher', () => {
    const source = `
      it('missing assertion', () => {
        const value = 42;
        void value;
      });
    `;

    const result = analyzeTestFileContent(source, 'tests/no-assertions.test.ts', {
      requireStrongAssertions: true,
    });

    expect(result.warnings).toEqual([
      {
        file: 'tests/no-assertions.test.ts',
        detail: 'test "missing assertion" has no assertion matcher',
      },
    ]);
  });

  it('flags focused/skipped aliases and comment markers as failures', () => {
    const todoMarker = ['TO', 'DO'].join('');
    const focusedAlias = ['f', 'it'].join('');
    const disabledAlias = ['x', 'it'].join('');
    const source = [
      `// ${todoMarker} tighten this test`,
      `${focusedAlias}('focused', () => {`,
      '  expect(1).toBe(1);',
      '});',
      '',
      `${disabledAlias}('disabled alias', () => {`,
      '  expect(2).toBe(2);',
      '});',
    ].join('\n');

    const result = analyzeTestFileContent(source, 'tests/patterns.test.ts', {
      requireStrongAssertions: true,
    });

    expect(result.failures).toHaveLength(3);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'tests/patterns.test.ts',
          detail: expect.stringContaining('focused alias (fit/fdescribe)'),
        }),
        expect.objectContaining({
          file: 'tests/patterns.test.ts',
          detail: expect.stringContaining('disabled alias (xit/xdescribe)'),
        }),
      ]),
    );
  });
});
