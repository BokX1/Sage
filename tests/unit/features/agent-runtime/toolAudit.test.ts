import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerDefaultAgenticTools } from '../../../../src/features/agent-runtime/defaultTools';
import { auditToolRegistry } from '../../../../src/features/agent-runtime/toolAudit';
import { defineToolSpecV2, ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';

describe('toolAudit', () => {
  it('passes blocking checks for the shipped default tool surface', () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const report = auditToolRegistry(registry);

    expect(report.ok).toBe(true);
    expect(report.summary.failCount).toBe(0);
  });

  it('flags missing summaries and query/read-only mismatches', () => {
    const registry = new ToolRegistry();
    registry.register(
      defineToolSpecV2({
        name: 'bad_query_tool',
        description: 'Too short',
        input: z.object({}),
        runtime: {
          class: 'query',
          readOnly: false,
        },
        execute: async () => ({ structuredContent: {} }),
      }),
    );

    const report = auditToolRegistry(registry);

    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'description_short',
        'prompt_summary_missing',
        'query_not_read_only',
        'read_hint_missing',
      ]),
    );
    expect(report.summary.outputSchemaCoverage.missing).toBe(1);
  });
});
