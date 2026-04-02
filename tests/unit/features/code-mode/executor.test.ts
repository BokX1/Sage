import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import type { ToolExecutionContext } from '../../../../src/features/agent-runtime/runtimeToolContract';
import { ApprovalRequiredSignal } from '../../../../src/features/agent-runtime/toolControlSignals';
import { executeCodeMode, resumeApprovedCodeModeExecution } from '../../../../src/features/code-mode/executor';
import { getOrCreateCodeModeTaskWorkspace } from '../../../../src/features/code-mode/workspace';
import { defineBridgeMethod } from '../../../../src/features/code-mode/bridge/common';
import type { FixedBridgeContract } from '../../../../src/features/code-mode/bridge/contract';

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
    activeToolNames: ['runtime_execute_code'],
    ...overrides,
  };
}

function makeBridgeContract(overrides: Partial<FixedBridgeContract> = {}): FixedBridgeContract {
  return {
    discord: {},
    history: {},
    context: {},
    artifacts: {},
    approvals: {},
    admin: {},
    moderation: {},
    schedule: {},
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
  it('executes JavaScript against direct bridge namespaces and workspace helpers', async () => {
    const bridgeContract = makeBridgeContract({
      history: {
        recent: defineBridgeMethod({
          namespace: 'history',
          method: 'recent',
          input: z.object({
            channelId: z.string(),
            limit: z.number().int().optional(),
          }),
          mutability: 'read',
          async execute(args) {
            return {
              items: [
                {
                  channelId: args.channelId,
                  content: 'hello',
                },
              ],
              limit: args.limit ?? 25,
            };
          },
        }),
      },
    });

    const result = await executeCodeMode({
      language: 'javascript',
      code: `
        const recent = await history.recent({ channelId: 'channel-1', limit: 2 });
        await workspace.write({ path: 'note.txt', content: 'remember me' });
        const reread = await workspace.read('note.txt');
        return { recent, reread };
      `,
      toolContext: makeToolContext(),
      bridgeContract,
    });

    expect(result.result).toEqual({
      recent: {
        items: [{ channelId: 'channel-1', content: 'hello' }],
        limit: 2,
      },
      reread: { path: 'note.txt', content: 'remember me' },
    });
    expect(result.bridgeCalls.map((entry) => entry.label)).toEqual([
      'history.recent',
      'workspace.write',
      'workspace.read',
    ]);
  });

  it('replays earlier effects and resumes the same execution after approval', async () => {
    let readExecutions = 0;
    let writeExecutions = 0;
    const bridgeContract = makeBridgeContract({
      history: {
        recent: defineBridgeMethod({
          namespace: 'history',
          method: 'recent',
          input: z.object({
            channelId: z.string(),
          }),
          mutability: 'read',
          async execute() {
            readExecutions += 1;
            return { readExecutions };
          },
        }),
      },
      discord: {
        'messages.send': defineBridgeMethod({
          namespace: 'discord',
          method: 'messages.send',
          input: z.object({
            channelId: z.string(),
            content: z.string(),
          }),
          mutability: 'write',
          approvalMode: 'required',
          async execute(args) {
            writeExecutions += 1;
            return {
              messageId: `sent-${writeExecutions}`,
              channelId: args.channelId,
              content: args.content,
            };
          },
        }),
      },
    });

    let signal: ApprovalRequiredSignal | null = null;
    try {
      await executeCodeMode({
        language: 'javascript',
        code: `
          const first = await history.recent({ channelId: 'channel-1' });
          const second = await discord.messages.send({ channelId: 'channel-1', content: 'Ship it' });
          return { first, second };
        `,
        toolContext: makeToolContext(),
        bridgeContract,
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
      bridgeContract,
    });

    expect(readExecutions).toBe(1);
    expect(writeExecutions).toBe(1);
    expect(resumed.result).toEqual({
      first: { readExecutions: 1 },
      second: {
        messageId: 'sent-1',
        channelId: 'channel-1',
        content: 'Ship it',
      },
    });
  }, 15_000);

  it('injects direct namespaces and removes the legacy sage root object', async () => {
    const result = await executeCodeMode({
      language: 'javascript',
      code: `
        return {
          hasSage: typeof sage,
          hasDiscord: typeof discord,
          hasHistory: typeof history,
          hasWorkspace: typeof workspace,
        };
      `,
      toolContext: makeToolContext(),
    });

    expect(result.result).toEqual({
      hasSage: 'undefined',
      hasDiscord: 'object',
      hasHistory: 'object',
      hasWorkspace: 'object',
    });
  });

  it('treats identical code reruns as fresh executions within the same task', async () => {
    let readExecutions = 0;
    const bridgeContract = makeBridgeContract({
      history: {
        recent: defineBridgeMethod({
          namespace: 'history',
          method: 'recent',
          input: z.object({
            channelId: z.string(),
          }),
          mutability: 'read',
          async execute() {
            readExecutions += 1;
            return { readExecutions };
          },
        }),
      },
    });

    const toolContext = makeToolContext();
    const code = `return await history.recent({ channelId: 'channel-1' });`;
    const first = await executeCodeMode({
      language: 'javascript',
      code,
      toolContext,
      bridgeContract,
    });
    const second = await executeCodeMode({
      language: 'javascript',
      code,
      toolContext,
      bridgeContract,
    });

    expect(first.result).toEqual({ readExecutions: 1 });
    expect(second.result).toEqual({ readExecutions: 2 });
    expect(first.executionId).not.toBe(second.executionId);
  });

  it('rejects tampered approval resumes whose request hash no longer matches the original effect', async () => {
    const bridgeContract = makeBridgeContract({
      discord: {
        'messages.send': defineBridgeMethod({
          namespace: 'discord',
          method: 'messages.send',
          input: z.object({
            channelId: z.string(),
            content: z.string(),
          }),
          mutability: 'write',
          approvalMode: 'required',
          async execute(args) {
            return {
              messageId: 'sent-1',
              channelId: args.channelId,
              content: args.content,
            };
          },
        }),
      },
    });

    let signal: ApprovalRequiredSignal | null = null;
    try {
      await executeCodeMode({
        language: 'javascript',
        code: `return await discord.messages.send({ channelId: 'channel-1', content: 'hello' });`,
        toolContext: makeToolContext(),
        bridgeContract,
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
        bridgeContract,
      }),
    ).rejects.toThrow('approval');
  }, 15_000);
});
