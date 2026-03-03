/* eslint-disable no-console */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

type AuditIssue = {
  file: string;
  detail: string;
};

type AuditReport = {
  generatedAt: string;
  scannedFiles: number;
  scannedTestCases: number;
  expectCallCount: number;
  failures: AuditIssue[];
  warnings: AuditIssue[];
};

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return fallback;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

async function collectTestFiles(rootDir: string): Promise<string[]> {
  const testsRoot = path.resolve(rootDir, 'tests');
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (fullPath.endsWith('.test.ts') || fullPath.endsWith('.spec.ts')) {
        files.push(fullPath);
      }
    }
  }

  await walk(testsRoot);
  return files.sort((a, b) => a.localeCompare(b));
}

function isIdentifierNamed(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

function isTestCaseCall(node: ts.CallExpression): boolean {
  return isIdentifierNamed(node.expression, 'it') || isIdentifierNamed(node.expression, 'test');
}

function hasExpectInNode(root: ts.Node): boolean {
  let found = false;
  function walk(node: ts.Node): void {
    if (found) return;
    if (ts.isCallExpression(node) && isIdentifierNamed(node.expression, 'expect')) {
      found = true;
      return;
    }
    ts.forEachChild(node, walk);
  }
  walk(root);
  return found;
}

function countExpectCalls(root: ts.Node): number {
  let count = 0;
  function walk(node: ts.Node): void {
    if (ts.isCallExpression(node) && isIdentifierNamed(node.expression, 'expect')) {
      count += 1;
    }
    ts.forEachChild(node, walk);
  }
  walk(root);
  return count;
}

async function writeReport(reportPath: string, report: AuditReport): Promise<void> {
  const resolved = path.resolve(reportPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, JSON.stringify(report, null, 2), 'utf8');
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const failOnWarnings = readBoolean('TEST_AUDIT_FAIL_ON_WARNINGS', true);
  const reportPath =
    process.env.TEST_AUDIT_REPORT_PATH?.trim() || '.agent/reports/test-audit-latest.json';

  const files = await collectTestFiles(rootDir);
  const failures: AuditIssue[] = [];
  const warnings: AuditIssue[] = [];
  let scannedTestCases = 0;
  let expectCallCount = 0;

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    const relative = toPosixPath(path.relative(rootDir, filePath));
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

    const failurePatterns: Array<{ name: string; regex: RegExp }> = [
      { name: '.only', regex: /\b(?:it|test|describe)\.only\s*\(/g },
      { name: '.skip', regex: /\b(?:it|test|describe)\.skip\s*\(/g },
      { name: '.todo', regex: /\b(?:it|test|describe)\.todo\s*\(/g },
      { name: 'TODO/FIXME/HACK/XXX marker', regex: /\b(?:TODO|FIXME|HACK|XXX)\b/g },
      { name: '@ts-ignore', regex: /@ts-ignore/g },
    ];

    for (const pattern of failurePatterns) {
      const matches = content.match(pattern.regex);
      if (!matches || matches.length === 0) continue;
      failures.push({
        file: relative,
        detail: `contains ${pattern.name} (${matches.length} occurrence${matches.length === 1 ? '' : 's'})`,
      });
    }

    expectCallCount += countExpectCalls(sourceFile);

    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && isTestCaseCall(node)) {
        scannedTestCases += 1;
        const callback = node.arguments[1];
        if (
          callback &&
          (ts.isFunctionExpression(callback) || ts.isArrowFunction(callback)) &&
          callback.body &&
          ts.isBlock(callback.body)
        ) {
          if (!hasExpectInNode(callback.body)) {
            warnings.push({
              file: relative,
              detail: `test "${node.arguments[0]?.getText(sourceFile) ?? '<unknown>'}" has no expect(...) assertion`,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    scannedFiles: files.length,
    scannedTestCases,
    expectCallCount,
    failures,
    warnings,
  };

  await writeReport(reportPath, report);

  console.log('[test:audit] summary', {
    scannedFiles: report.scannedFiles,
    scannedTestCases: report.scannedTestCases,
    expectCallCount: report.expectCallCount,
    failureCount: report.failures.length,
    warningCount: report.warnings.length,
    reportPath: toPosixPath(reportPath),
    failOnWarnings,
  });

  if (report.failures.length > 0) {
    for (const issue of report.failures.slice(0, 20)) {
      console.error('[test:audit] fail', issue);
    }
    throw new Error(`Test audit failed with ${report.failures.length} failure(s).`);
  }

  if (failOnWarnings && report.warnings.length > 0) {
    for (const issue of report.warnings.slice(0, 20)) {
      console.error('[test:audit] warning->fail', issue);
    }
    throw new Error(`Test audit failed due to ${report.warnings.length} warning(s).`);
  }

  if (report.warnings.length > 0) {
    for (const issue of report.warnings.slice(0, 20)) {
      console.warn('[test:audit] warning', issue);
    }
  }

  console.log('[test:audit] passed');
}

main().catch((error) => {
  console.error('[test:audit] failed', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
