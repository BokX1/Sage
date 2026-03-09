import ts from 'typescript';

export type AuditIssue = {
  file: string;
  detail: string;
};

export type AnalyzeTestFileOptions = {
  requireStrongAssertions: boolean;
};

export type TestFileAuditSummary = {
  scannedTestCases: number;
  expectCallCount: number;
  matcherAssertionCount: number;
  weakMatcherCount: number;
  strongMatcherCount: number;
  weakOnlyTestCount: number;
  failures: AuditIssue[];
  warnings: AuditIssue[];
};

const FAILURE_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: '.only', regex: /\b(?:it|test|describe)\.only\s*\(/g },
  { name: '.skip', regex: /\b(?:it|test|describe)\.skip\s*\(/g },
  { name: '.todo', regex: /\b(?:it|test|describe)\.todo\s*\(/g },
  { name: 'focused alias (fit/fdescribe)', regex: /\b(?:fit|fdescribe)\s*\(/g },
  { name: 'disabled alias (xit/xdescribe)', regex: /\b(?:xit|xdescribe)\s*\(/g },
  { name: 'TODO/FIXME/HACK/XXX marker', regex: /\b(?:TODO|FIXME|HACK|XXX)\b/g },
  { name: '@ts-ignore', regex: /@ts-ignore/g },
];

function isIdentifierNamed(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

function isTestIdentifierExpression(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === 'it' || expression.text === 'test';
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return isTestIdentifierExpression(expression.expression);
  }

  return false;
}

function isEachBuilderCall(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  if (node.expression.name.text !== 'each') {
    return false;
  }
  return isTestIdentifierExpression(node.expression.expression);
}

function isTestCaseCall(node: ts.CallExpression): boolean {
  if (isIdentifierNamed(node.expression, 'it') || isIdentifierNamed(node.expression, 'test')) {
    return true;
  }

  if (ts.isCallExpression(node.expression) && isEachBuilderCall(node.expression)) {
    return true;
  }

  return false;
}

function unwrapArrayInitializer(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return unwrapArrayInitializer(expression.expression);
  }
  if (ts.isParenthesizedExpression(expression)) {
    return unwrapArrayInitializer(expression.expression);
  }
  return expression;
}

function collectArrayLengths(sourceFile: ts.SourceFile): Map<string, number> {
  const lengths = new Map<string, number>();

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializer = unwrapArrayInitializer(node.initializer);
      if (ts.isArrayLiteralExpression(initializer)) {
        lengths.set(node.name.text, initializer.elements.length);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return lengths;
}

function estimateParameterizedCaseCount(
  invocation: ts.CallExpression,
  arrayLengths: Map<string, number>,
): number {
  if (!ts.isCallExpression(invocation.expression) || !isEachBuilderCall(invocation.expression)) {
    return 1;
  }

  const args = invocation.expression.arguments;
  if (args.length === 0) {
    return 1;
  }

  const unwrapped = unwrapArrayInitializer(args[0]);
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return Math.max(1, unwrapped.elements.length);
  }

  if (ts.isIdentifier(unwrapped)) {
    return Math.max(1, arrayLengths.get(unwrapped.text) ?? 1);
  }

  return 1;
}

function getTestCallback(
  invocation: ts.CallExpression,
): ts.FunctionExpression | ts.ArrowFunction | null {
  const callback = invocation.arguments[1];
  if (!callback) return null;
  if (ts.isFunctionExpression(callback) || ts.isArrowFunction(callback)) {
    return callback;
  }
  return null;
}

function getTestLabel(invocation: ts.CallExpression, sourceFile: ts.SourceFile): string {
  const labelNode = invocation.arguments[0];
  if (!labelNode) return '<unknown>';
  if (ts.isStringLiteralLike(labelNode) || ts.isNoSubstitutionTemplateLiteral(labelNode)) {
    return labelNode.text;
  }
  return labelNode.getText(sourceFile);
}

function isExpectCall(node: ts.CallExpression): boolean {
  return isIdentifierNamed(node.expression, 'expect');
}

function getExpectMatcherName(node: ts.CallExpression): string | null {
  let current: ts.Expression = node.expression;
  let matcherName: string | null = null;

  while (ts.isPropertyAccessExpression(current)) {
    const candidate = current.name.text;
    if (
      matcherName === null &&
      candidate !== 'not' &&
      candidate !== 'resolves' &&
      candidate !== 'rejects'
    ) {
      matcherName = candidate;
    }
    current = current.expression;
  }

  if (ts.isCallExpression(current) && isExpectCall(current)) {
    return matcherName;
  }

  return null;
}

function isExpectAnythingCall(node: ts.Node | undefined): boolean {
  if (!node || !ts.isCallExpression(node)) return false;
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  if (node.expression.name.text !== 'anything') return false;
  return isIdentifierNamed(node.expression.expression, 'expect');
}

function isWeakMatcher(node: ts.CallExpression, matcherName: string): boolean {
  if (matcherName === 'toBeTruthy' || matcherName === 'toBeDefined') {
    return true;
  }

  if (matcherName === 'toBe') {
    const argument = node.arguments[0];
    return argument?.kind === ts.SyntaxKind.TrueKeyword || argument?.kind === ts.SyntaxKind.FalseKeyword;
  }

  if (matcherName === 'toEqual' || matcherName === 'toStrictEqual') {
    return isExpectAnythingCall(node.arguments[0]);
  }

  return false;
}

type TestAssertionStats = {
  expectCalls: number;
  matcherCalls: number;
  weakMatcherCalls: number;
};

function collectAssertionStats(node: ts.Node): TestAssertionStats {
  let expectCalls = 0;
  let matcherCalls = 0;
  let weakMatcherCalls = 0;

  function visit(current: ts.Node): void {
    if (ts.isCallExpression(current)) {
      if (isExpectCall(current)) {
        expectCalls += 1;
      }

      const matcherName = getExpectMatcherName(current);
      if (matcherName) {
        matcherCalls += 1;
        if (isWeakMatcher(current, matcherName)) {
          weakMatcherCalls += 1;
        }
      }
    }
    ts.forEachChild(current, visit);
  }

  visit(node);
  return { expectCalls, matcherCalls, weakMatcherCalls };
}

export function analyzeTestFileContent(
  content: string,
  relativeFilePath: string,
  options: AnalyzeTestFileOptions,
): TestFileAuditSummary {
  const sourceFile = ts.createSourceFile(relativeFilePath, content, ts.ScriptTarget.Latest, true);
  const arrayLengths = collectArrayLengths(sourceFile);
  const failures: AuditIssue[] = [];
  const warnings: AuditIssue[] = [];

  for (const pattern of FAILURE_PATTERNS) {
    const matches = content.match(pattern.regex);
    if (!matches || matches.length === 0) continue;
    failures.push({
      file: relativeFilePath,
      detail: `contains ${pattern.name} (${matches.length} occurrence${matches.length === 1 ? '' : 's'})`,
    });
  }

  let scannedTestCases = 0;
  let expectCallCount = 0;
  let matcherAssertionCount = 0;
  let weakMatcherCount = 0;
  let weakOnlyTestCount = 0;

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isTestCaseCall(node)) {
      const expandedCaseCount = estimateParameterizedCaseCount(node, arrayLengths);
      scannedTestCases += expandedCaseCount;

      const callback = getTestCallback(node);
      if (callback?.body) {
        const stats = collectAssertionStats(callback.body);
        expectCallCount += stats.expectCalls * expandedCaseCount;
        matcherAssertionCount += stats.matcherCalls * expandedCaseCount;
        weakMatcherCount += stats.weakMatcherCalls * expandedCaseCount;
        const strongMatcherCountInTest = stats.matcherCalls - stats.weakMatcherCalls;

        if (stats.expectCalls === 0 || stats.matcherCalls === 0) {
          warnings.push({
            file: relativeFilePath,
            detail: `test "${getTestLabel(node, sourceFile)}" has no assertion matcher`,
          });
        } else if (strongMatcherCountInTest === 0 && stats.weakMatcherCalls > 0) {
          weakOnlyTestCount += expandedCaseCount;
          const issue: AuditIssue = {
            file: relativeFilePath,
            detail: `test "${getTestLabel(node, sourceFile)}" uses only weak matchers`,
          };
          if (options.requireStrongAssertions) {
            failures.push(issue);
          } else {
            warnings.push(issue);
          }
        }
      } else {
        warnings.push({
          file: relativeFilePath,
          detail: `test "${getTestLabel(node, sourceFile)}" has no executable callback body`,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return {
    scannedTestCases,
    expectCallCount,
    matcherAssertionCount,
    weakMatcherCount,
    strongMatcherCount: matcherAssertionCount - weakMatcherCount,
    weakOnlyTestCount,
    failures,
    warnings,
  };
}
