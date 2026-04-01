import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import {
  defineToolSpecV2,
  ToolRegistry,
  type ToolExecutionContext,
} from '../../../../src/features/agent-runtime/toolRegistry';
import { ApprovalRequiredSignal } from '../../../../src/features/agent-runtime/toolControlSignals';
import {
  executeCodeMode,
  resumeApprovedCodeModeExecution,
} from '../../../../src/features/code-mode/executor';
import { getOrCreateCodeModeTaskWorkspace } from '../../../../src/features/code-mode/workspace';

function makeToolContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    traceId: 'trace-1',
    graphThreadId: 'thread-1',
    userId: 'user-1',
    channelId: 'channel-1',
    guildId: 'guild-1',
    currentTurn: {
      invokerUserId: 'user-1',
      invokerDisplayName: 'User One',
      messageId: 'message-1',
      guildId: 'guild-1',
      originChannelId: 'channel-1',
      responseChannelId: 'channel-1',
      invokedBy: 'mention',
      mentionedUserIds: [],
      isDirectReply: false,
      replyTargetMessageId: null,
      replyTargetAuthorId: null,
      botUserId: 'sage-bot',
    },
    activeToolNames: [],
    ...overrides,
  };
}

async function cleanupWorkspace(taskId = 'thread-1') {
  const workspace = await getOrCreateCodeModeTaskWorkspace(taskId);
  await fs.rm(workspace.rootDir, { recursive: true, force: true });
}

afterEach(async () => {
  await cleanupWorkspace();
});

describe('Code Mode executor', () => {
  it('executes JavaScript against internal bridge tools and workspace helpers', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineToolSpecV2({
        name: 'test_echo',
        description: 'Echo a value for tests.',
        input: z.object({
          value: z.string(),
        }),
        runtime: {
          class: 'query',
          readOnly: true,
        },
        execute: async ({ value }) => ({
          structuredContent: { echoed: value },
          modelSummary: value,
        }),
      }),
    );

    const result = await executeCodeMode({
      language: 'javascript',
      code: `
        const value = await sage.tool('test_echo', { value: 'hello' });
        await sage.workspace.write('note.txt', 'remember me');
        const reread = await sage.workspace.read('note.txt');
        return { value, reread };
      `,
      toolContext: makeToolContext({ activeToolNames: ['test_echo'] }),
      registry,
    });

    expect(result.result).toEqual({
      value: { echoed: 'hello' },
      reread: { path: 'note.txt', content: 'remember me' },
    });
    expect(result.bridgeCalls.map((entry) => entry.label)).toEqual([
      'tool.test_echo',
      'workspace.write',
      'workspace.read',
    ]);
  });

  it('replays earlier effects and resumes the same execution after approval', async () => {
    const registry = new ToolRegistry();
    let readExecutions = 0;
    let writeExecutions = 0;

    registry.register(
      defineToolSpecV2({
        name: 'test_read_counter',
        description: 'Count read executions.',
        input: z.object({}),
        runtime: {
          class: 'query',
          readOnly: true,
        },
        execute: async () => {
          readExecutions += 1;
          return { structuredContent: { readExecutions } };
        },
      }),
    );

    registry.register(
      defineToolSpecV2({
        name: 'test_write_counter',
        description: 'Count write executions.',
        input: z.object({}),
        runtime: {
          class: 'mutation',
          readOnly: false,
          actionPolicy: async (_args, ctx) => ({
            mutability: 'write',
            approvalMode: 'required',
            prepareApproval: async () => ({
              kind: 'test_write_counter',
              guildId: ctx.guildId ?? 'guild-1',
              sourceChannelId: ctx.channelId,
              reviewChannelId: 'review-channel-1',
              sourceMessageId: ctx.currentTurn?.messageId ?? null,
              requestedBy: ctx.userId,
              dedupeKey: 'test-write-counter',
              executionPayloadJson: {},
              reviewSnapshotJson: { action: 'test_write_counter' },
            }),
          }),
        },
        execute: async () => {
          writeExecutions += 1;
          return { structuredContent: { writeExecutions } };
        },
      }),
    );

    let signal: ApprovalRequiredSignal | null = null;
    try {
      await executeCodeMode({
        language: 'javascript',
        code: `
          const first = await sage.tool('test_read_counter', {});
          const second = await sage.tool('test_write_counter', {});
          return { first, second };
        `,
        toolContext: makeToolContext({ activeToolNames: ['test_read_counter', 'test_write_counter'] }),
        registry,
      });
    } catch (error) {
      signal = error as ApprovalRequiredSignal;
    }

    expect(signal).toBeInstanceOf(ApprovalRequiredSignal);
    expect(readExecutions).toBe(1);
    expect(writeExecutions).toBe(0);

    const resumed = await resumeApprovedCodeModeExecution({
      payload: signal!.payload.executionPayloadJson as {
        executionId: string;
        taskId: string;
        effectIndex: number;
        effectLabel: string;
        requestHash: string;
      },
      approvedBy: 'reviewer-1',
      registry,
    });

    expect(readExecutions).toBe(1);
    expect(writeExecutions).toBe(1);
    expect(resumed.result).toEqual({
      first: { readExecutions: 1 },
      second: { writeExecutions: 1 },
    });
  });

  it('keeps Code Mode constrained to the runtime-filtered active tool list', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineToolSpecV2({
        name: 'public_echo',
        description: 'Public echo tool.',
        input: z.object({ value: z.string() }),
        runtime: { class: 'query', readOnly: true },
        execute: async ({ value }) => ({ structuredContent: { echoed: value } }),
      }),
    );
    registry.register(
      defineToolSpecV2({
        name: 'admin_secret',
        description: 'Sensitive admin-only tool.',
        input: z.object({}),
        runtime: { class: 'query', readOnly: true, access: 'admin' },
        execute: async () => ({ structuredContent: { secret: true } }),
      }),
    );

    const result = await executeCodeMode({
      language: 'javascript',
      code: `
        return {
          listed: (await sage.tools.list()).map((tool) => tool.name),
          publicEcho: await sage.tool('public_echo', { value: 'ok' }),
        };
      `,
      toolContext: makeToolContext({ activeToolNames: ['public_echo'] }),
      registry,
    });

    expect(result.result).toEqual({
      listed: ['public_echo'],
      publicEcho: { echoed: 'ok' },
    });

    await expect(
      executeCodeMode({
        language: 'javascript',
        code: `return await sage.tool('admin_secret', {});`,
        toolContext: makeToolContext({ activeToolNames: ['public_echo'] }),
        registry,
      }),
    ).rejects.toThrow('not available to this Code Mode turn');
  });

  it('treats identical code reruns as fresh executions within the same task', async () => {
    const registry = new ToolRegistry();
    let readExecutions = 0;
    registry.register(
      defineToolSpecV2({
        name: 'test_repeat_read',
        description: 'Count repeated read executions.',
        input: z.object({}),
        runtime: { class: 'query', readOnly: true },
        execute: async () => {
          readExecutions += 1;
          return { structuredContent: { readExecutions } };
        },
      }),
    );

    const toolContext = makeToolContext({ activeToolNames: ['test_repeat_read'] });
    const code = `return await sage.tool('test_repeat_read', {});`;
    const first = await executeCodeMode({
      language: 'javascript',
      code,
      toolContext,
      registry,
    });
    const second = await executeCodeMode({
      language: 'javascript',
      code,
      toolContext,
      registry,
    });

    expect(first.result).toEqual({ readExecutions: 1 });
    expect(second.result).toEqual({ readExecutions: 2 });
    expect(first.executionId).not.toBe(second.executionId);
  });

  it('rejects tampered approval resumes whose request hash no longer matches the original effect', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineToolSpecV2({
        name: 'approval_write',
        description: 'Approval-gated write.',
        input: z.object({}),
        runtime: {
          class: 'mutation',
          readOnly: false,
          actionPolicy: async (_args, ctx) => ({
            mutability: 'write',
            approvalMode: 'required',
            prepareApproval: async () => ({
              kind: 'approval_write',
              guildId: ctx.guildId ?? 'guild-1',
              sourceChannelId: ctx.channelId,
              reviewChannelId: 'review-channel-1',
              sourceMessageId: ctx.currentTurn?.messageId ?? null,
              requestedBy: ctx.userId,
              dedupeKey: 'approval-write',
              executionPayloadJson: {},
              reviewSnapshotJson: { action: 'approval_write' },
            }),
          }),
        },
        execute: async () => ({ structuredContent: { wrote: true } }),
      }),
    );

    let signal: ApprovalRequiredSignal | null = null;
    try {
      await executeCodeMode({
        language: 'javascript',
        code: `return await sage.tool('approval_write', {});`,
        toolContext: makeToolContext({ activeToolNames: ['approval_write'] }),
        registry,
      });
    } catch (error) {
      signal = error as ApprovalRequiredSignal;
    }

    expect(signal).toBeInstanceOf(ApprovalRequiredSignal);
    const payload = {
      ...(signal!.payload.executionPayloadJson as {
        executionId: string;
        taskId: string;
        effectIndex: number;
        effectLabel: string;
        requestHash: string;
      }),
      requestHash: 'tampered-request-hash',
    };

    await expect(
      resumeApprovedCodeModeExecution({
        payload,
        approvedBy: 'reviewer-1',
        registry,
      }),
    ).rejects.toThrow('approval');
  });
});
