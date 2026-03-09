/* eslint-disable no-console */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeTestFileContent, type AuditIssue } from './test-audit-lib';

type AuditReport = {
  generatedAt: string;
  scannedFiles: number;
  scannedTestCases: number;
  expectCallCount: number;
  matcherAssertionCount: number;
  weakMatcherCount: number;
  strongMatcherCount: number;
  weakOnlyTestCount: number;
  requireStrongAssertions: boolean;
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

async function writeReport(reportPath: string, report: AuditReport): Promise<void> {
  const resolved = path.resolve(reportPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, JSON.stringify(report, null, 2), 'utf8');
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const failOnWarnings = readBoolean('TEST_AUDIT_FAIL_ON_WARNINGS', true);
  const requireStrongAssertions = readBoolean('TEST_AUDIT_REQUIRE_STRONG_ASSERTIONS', true);
  const reportPath =
    process.env.TEST_AUDIT_REPORT_PATH?.trim() || '.agent/reports/test-audit-latest.json';

  const files = await collectTestFiles(rootDir);
  const failures: AuditIssue[] = [];
  const warnings: AuditIssue[] = [];
  let scannedTestCases = 0;
  let expectCallCount = 0;
  let matcherAssertionCount = 0;
  let weakMatcherCount = 0;
  let strongMatcherCount = 0;
  let weakOnlyTestCount = 0;

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    const relative = toPosixPath(path.relative(rootDir, filePath));
    const result = analyzeTestFileContent(content, relative, { requireStrongAssertions });

    scannedTestCases += result.scannedTestCases;
    expectCallCount += result.expectCallCount;
    matcherAssertionCount += result.matcherAssertionCount;
    weakMatcherCount += result.weakMatcherCount;
    strongMatcherCount += result.strongMatcherCount;
    weakOnlyTestCount += result.weakOnlyTestCount;
    failures.push(...result.failures);
    warnings.push(...result.warnings);
  }

  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    scannedFiles: files.length,
    scannedTestCases,
    expectCallCount,
    matcherAssertionCount,
    weakMatcherCount,
    strongMatcherCount,
    weakOnlyTestCount,
    requireStrongAssertions,
    failures,
    warnings,
  };

  await writeReport(reportPath, report);

  console.log('[test:audit] summary', {
    scannedFiles: report.scannedFiles,
    scannedTestCases: report.scannedTestCases,
    expectCallCount: report.expectCallCount,
    matcherAssertionCount: report.matcherAssertionCount,
    weakMatcherCount: report.weakMatcherCount,
    strongMatcherCount: report.strongMatcherCount,
    weakOnlyTestCount: report.weakOnlyTestCount,
    failureCount: report.failures.length,
    warningCount: report.warnings.length,
    reportPath: toPosixPath(reportPath),
    failOnWarnings,
    requireStrongAssertions,
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
