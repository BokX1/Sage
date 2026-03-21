/* eslint-disable no-console */

import dotenv from 'dotenv';

function parseFlags(argv: string[]): { json: boolean } {
  return {
    json: argv.includes('--json'),
  };
}

function seedAuditEnvDefaults(): void {
  dotenv.config({ quiet: true });

  const defaults = {
    LANGSMITH_TRACING: 'false',
    SAGE_TRACE_DB_ENABLED: 'true',
    AI_PROVIDER_BASE_URL: 'https://example.invalid/v1',
    AI_PROVIDER_MAIN_AGENT_MODEL: 'audit-main',
    AI_PROVIDER_PROFILE_AGENT_MODEL: 'audit-profile',
    AI_PROVIDER_SUMMARY_AGENT_MODEL: 'audit-summary',
    IMAGE_PROVIDER_BASE_URL: 'https://example.invalid/image',
    IMAGE_PROVIDER_MODEL: 'audit-image',
    SERVER_PROVIDER_PROFILE_URL: 'https://example.invalid/profile',
    SERVER_PROVIDER_AUTHORIZE_URL: 'https://example.invalid/authorize',
    SERVER_PROVIDER_DASHBOARD_URL: 'https://example.invalid/dashboard',
  } as const;

  for (const [key, value] of Object.entries(defaults)) {
    if (!process.env[key]?.trim()) {
      process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  seedAuditEnvDefaults();

  const [{ ToolRegistry }, { registerDefaultAgenticTools }, { auditToolRegistry }] = await Promise.all([
    import('../features/agent-runtime/toolRegistry'),
    import('../features/agent-runtime/defaultTools'),
    import('../features/agent-runtime/toolAudit'),
  ]);
  const registry = new ToolRegistry();
  await registerDefaultAgenticTools(registry);
  const report = auditToolRegistry(registry);

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Sage Tool Audit');
    console.log('');
    console.log(`Tools: ${report.summary.toolCount}`);
    console.log(`Output schema coverage: ${report.summary.outputSchemaCoverage.declared}/${report.summary.toolCount}`);
    console.log(`Findings: ${report.summary.failCount} fail, ${report.summary.warnCount} warn`);
    for (const finding of report.findings) {
      console.log(`- [${finding.severity.toUpperCase()}] ${finding.toolName} ${finding.code} - ${finding.message}`);
    }
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
