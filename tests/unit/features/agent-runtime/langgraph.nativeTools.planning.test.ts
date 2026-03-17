import { describe, expect, it } from 'vitest';
import { planReadOnlyToolExecution } from '../../../../src/features/agent-runtime/langgraph/nativeTools';

function makeDefinition(params: {
  readOnly: boolean;
  parallelSafe?: boolean;
}) {
  return {
    name: 'tool',
    description: 'test tool',
    inputSchema: { type: 'object', properties: {} },
    inputValidator: { safeParse: () => ({ success: true, data: {} }) },
    execute: async () => ({}),
    runtime: {
      class: params.readOnly ? 'query' : 'mutation',
      readOnly: params.readOnly,
      observationPolicy: 'default',
      access: 'public',
      capabilityTags: [],
    },
    metadata: {
      readOnly: params.readOnly,
      access: 'public',
    },
    annotations: {
      parallelSafe: params.parallelSafe,
    },
  };
}

describe('langgraph native tool planning', () => {
  it('separates parallel-safe reads from sequential reads', () => {
    const definitions = new Map([
      ['parallel_query', makeDefinition({ readOnly: true, parallelSafe: true })],
      ['serial_query', makeDefinition({ readOnly: true, parallelSafe: false })],
      ['write_tool', makeDefinition({ readOnly: false, parallelSafe: true })],
    ]);

    const plan = planReadOnlyToolExecution({
      definitions: definitions as never,
      calls: [
        { name: 'parallel_query', args: {} },
        { name: 'serial_query', args: {} },
        { name: 'write_tool', args: {} },
      ],
      context: {
        traceId: 'trace-1',
        userId: 'user-1',
        channelId: 'channel-1',
      },
    });

    expect(plan.parallelCalls.map((call) => call.name)).toEqual(['parallel_query']);
    expect(plan.sequentialCalls.map((call) => call.name)).toEqual(['serial_query', 'write_tool']);
  });
});
