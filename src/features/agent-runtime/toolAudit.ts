import { ToolRegistry, globalToolRegistry } from './toolRegistry';

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
    | 'artifact_policy_mismatch';
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

export function auditToolRegistry(registry: Pick<ToolRegistry, 'listSpecs'> = globalToolRegistry): ToolAuditReport {
  const findings: ToolAuditFinding[] = [];
  const specs = registry.listSpecs();
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
          message: 'Tool descriptions should be specific enough to route reliably.',
        }),
      );
    }

    if (!spec.prompt?.summary?.trim()) {
      findings.push(
        makeFinding({
          severity: 'fail',
          toolName: spec.name,
          code: 'prompt_summary_missing',
          message: 'Tool is missing concise prompt routing guidance.',
        }),
      );
    }

    if (spec.runtime.class === 'query' && spec.runtime.readOnly !== true) {
      findings.push(
        makeFinding({
          severity: 'fail',
          toolName: spec.name,
          code: 'query_not_read_only',
          message: 'Query tools must be explicitly marked read-only.',
        }),
      );
    }

    if (spec.runtime.class === 'query' && spec.annotations?.readOnlyHint !== true) {
      findings.push(
        makeFinding({
          severity: 'warn',
          toolName: spec.name,
          code: 'read_hint_missing',
          message: 'Query tools should declare readOnlyHint for MCP-style annotations.',
        }),
      );
    }

    if (spec.annotations?.parallelSafe === true && spec.runtime.readOnly !== true) {
      findings.push(
        makeFinding({
          severity: 'fail',
          toolName: spec.name,
          code: 'parallel_safe_not_read_only',
          message: 'Only read-only tools may be marked parallelSafe.',
        }),
      );
    }

    if (spec.runtime.class === 'artifact' && spec.runtime.observationPolicy !== 'artifact-only') {
      findings.push(
        makeFinding({
          severity: 'fail',
          toolName: spec.name,
          code: 'artifact_policy_mismatch',
          message: 'Artifact tools must use artifact-only observation policy.',
        }),
      );
    }
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
