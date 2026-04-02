import { listMcpDiscoverySnapshots } from './mcp/manager';
import type { McpServerDiagnostic } from './mcp/types';
import { getRuntimeSurfaceTools } from './runtimeSurface';

export type ToolAuditSeverity = 'fail' | 'warn';

export interface ToolAuditFinding {
  severity: ToolAuditSeverity;
  toolName: string;
  code:
    | 'description_short'
    | 'prompt_summary_missing'
    | 'query_not_read_only'
    | 'read_hint_missing'
    | 'parallel_safe_not_read_only'
    | 'artifact_policy_mismatch'
    | 'mcp_tool_disabled'
    | 'mcp_server_unavailable'
    | 'mcp_preset_capability_partial'
    | 'mcp_preset_capability_unavailable';
  message: string;
}

export interface ToolAuditReport {
  ok: boolean;
  findings: ToolAuditFinding[];
  summary: {
    toolCount: number;
    failCount: number;
    warnCount: number;
    outputSchemaCoverage: {
      declared: number;
      missing: number;
    };
  };
}

function makeFinding(finding: ToolAuditFinding): ToolAuditFinding {
  return finding;
}

export function auditRuntimeSurface(options?: {
  mcpDiagnostics?: McpServerDiagnostic[];
}): ToolAuditReport {
  const findings: ToolAuditFinding[] = [];
  const specs = getRuntimeSurfaceTools();
  let outputSchemaDeclared = 0;

  for (const spec of specs) {
    if (spec.outputSchema) {
      outputSchemaDeclared += 1;
    }

    const description = spec.description.trim();
    if (description.length < 24) {
      findings.push(
        makeFinding({
          severity: 'fail',
          toolName: spec.name,
          code: 'description_short',
          message: 'Runtime capability descriptions should be specific enough to route reliably.',
        }),
      );
    }

    if (!spec.prompt?.summary?.trim()) {
      findings.push(
        makeFinding({
          severity: 'fail',
          toolName: spec.name,
          code: 'prompt_summary_missing',
          message: 'Runtime capability is missing concise prompt routing guidance.',
        }),
      );
    }

    if (spec.runtime.class === 'query' && spec.runtime.readOnly !== true) {
      findings.push(
        makeFinding({
          severity: 'fail',
          toolName: spec.name,
          code: 'query_not_read_only',
          message: 'Query capabilities must be explicitly marked read-only.',
        }),
      );
    }

    if (spec.runtime.class === 'query' && spec.annotations?.readOnlyHint !== true) {
      findings.push(
        makeFinding({
          severity: 'warn',
          toolName: spec.name,
          code: 'read_hint_missing',
          message: 'Query capabilities should declare readOnlyHint for MCP-style annotations.',
        }),
      );
    }

    if (spec.annotations?.parallelSafe === true && spec.runtime.readOnly !== true) {
      findings.push(
        makeFinding({
          severity: 'fail',
          toolName: spec.name,
          code: 'parallel_safe_not_read_only',
          message: 'Only read-only capabilities may be marked parallelSafe.',
        }),
      );
    }

    if (spec.runtime.class === 'artifact' && spec.runtime.observationPolicy !== 'artifact-only') {
      findings.push(
        makeFinding({
          severity: 'fail',
          toolName: spec.name,
          code: 'artifact_policy_mismatch',
          message: 'Artifact capabilities must use artifact-only observation policy.',
        }),
      );
    }
  }

  for (const snapshot of listMcpDiscoverySnapshots()) {
    if (!snapshot.connected) {
      findings.push(
        makeFinding({
          severity: 'warn',
          toolName: `mcp:${snapshot.server.id}`,
          code: 'mcp_server_unavailable',
          message: snapshot.errorText?.trim() || 'MCP server is configured but unavailable.',
        }),
      );
    }
    for (const exposure of snapshot.exposure) {
      if (exposure.exposed) continue;
      findings.push(
        makeFinding({
          severity: 'warn',
          toolName: `mcp:${snapshot.server.id}:${exposure.rawToolName}`,
          code: 'mcp_tool_disabled',
          message: exposure.disableReason?.trim() || 'MCP tool was disabled because its schema is not provider-safe.',
        }),
      );
    }
  }

  for (const diagnostic of options?.mcpDiagnostics ?? []) {
    if (diagnostic.kind !== 'preset_capability' || diagnostic.status === 'healthy') {
      continue;
    }
    findings.push(
      makeFinding({
        severity: 'warn',
        toolName: `mcp:${diagnostic.presetId}`,
        code:
          diagnostic.status === 'partial'
            ? 'mcp_preset_capability_partial'
            : 'mcp_preset_capability_unavailable',
        message: [diagnostic.summary, ...diagnostic.details].filter((value) => value.trim().length > 0).join(' '),
      }),
    );
  }

  const failCount = findings.filter((finding) => finding.severity === 'fail').length;
  const warnCount = findings.filter((finding) => finding.severity === 'warn').length;

  return {
    ok: failCount === 0,
    findings,
    summary: {
      toolCount: specs.length,
      failCount,
      warnCount,
      outputSchemaCoverage: {
        declared: outputSchemaDeclared,
        missing: specs.length - outputSchemaDeclared,
      },
    },
  };
}
