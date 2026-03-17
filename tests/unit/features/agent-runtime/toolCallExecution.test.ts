import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { executeToolWithTimeout } from '../../../../src/features/agent-runtime/toolCallExecution';
import { defineToolSpecV2, ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';

function makeToolContext() {
  return {
    traceId: 'trace-tool-call-execution',
    userId: 'user-1',
    channelId: 'channel-1',
  };
}

describe('toolCallExecution', () => {
  it('rejects tool outputs that do not match outputSchema', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineToolSpecV2({
        name: 'schema_checked_tool',
        description: 'Returns structured output that must match the declared schema.',
        input: z.object({}),
        outputSchema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
          },
          required: ['ok'],
          additionalProperties: false,
        },
        runtime: {
          class: 'query',
          readOnly: true,
        },
        execute: async () => ({
          structuredContent: { nope: true },
        }),
      }),
    );

    const result = await executeToolWithTimeout(
      registry,
      { name: 'schema_checked_tool', args: {} },
      makeToolContext(),
      1_000,
    );

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('execution');
    expect(result.error).toContain('did not match its output schema');
  });

  it('caps model observations according to observationPolicy instead of one global limit', async () => {
    const registry = new ToolRegistry();
    const largeText = 'alpha '.repeat(2_000);

    registry.register(
      defineToolSpecV2({
        name: 'tiny_observation_tool',
        description: 'Uses a tiny observation budget.',
        input: z.object({}),
        runtime: {
          class: 'query',
          readOnly: true,
          observationPolicy: 'tiny',
        },
        execute: async () => ({
          structuredContent: {
            detail: largeText,
          },
        }),
      }),
    );

    registry.register(
      defineToolSpecV2({
        name: 'large_observation_tool',
        description: 'Uses a large observation budget.',
        input: z.object({}),
        runtime: {
          class: 'query',
          readOnly: true,
          observationPolicy: 'large',
        },
        execute: async () => ({
          structuredContent: {
            detail: largeText,
          },
        }),
      }),
    );

    const tinyResult = await executeToolWithTimeout(
      registry,
      { name: 'tiny_observation_tool', args: {} },
      makeToolContext(),
      1_000,
    );
    const largeResult = await executeToolWithTimeout(
      registry,
      { name: 'large_observation_tool', args: {} },
      makeToolContext(),
      1_000,
    );

    expect(tinyResult.success).toBe(true);
    expect(largeResult.success).toBe(true);
    expect(tinyResult.modelSummary?.length ?? 0).toBeLessThanOrEqual(1_200);
    expect(largeResult.modelSummary?.length ?? 0).toBeGreaterThan(tinyResult.modelSummary?.length ?? 0);
    expect(tinyResult.telemetry.observationPolicy).toBe('tiny');
    expect(largeResult.telemetry.observationPolicy).toBe('large');
  });

  it('uses artifact summaries for artifact-only observation policies', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineToolSpecV2({
        name: 'artifact_only_tool',
        description: 'Produces an artifact-only observation.',
        input: z.object({}),
        runtime: {
          class: 'artifact',
          readOnly: false,
          observationPolicy: 'artifact-only',
        },
        execute: async () => ({
          structuredContent: {
            internal: 'details that should not become the observation body',
          },
          artifacts: [
            {
              kind: 'discord_artifact',
              visibleSummary: 'Sent the review card.',
            },
          ],
        }),
      }),
    );

    const result = await executeToolWithTimeout(
      registry,
      { name: 'artifact_only_tool', args: {} },
      makeToolContext(),
      1_000,
    );

    expect(result.success).toBe(true);
    expect(result.modelSummary).toBe('Sent the review card.');
    expect(result.telemetry.observationPolicy).toBe('artifact-only');
  });
});
