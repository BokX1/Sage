/* eslint-disable no-console */

import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { AIMessage } from '@langchain/core/messages';

type ApprovalReviewRequestRecord = import('../features/admin/approvalReviewRequestRepo').ApprovalReviewRequestRecord;

let depsLoaded = false;
let appConfig: typeof import('../platform/config/env').config;
let client: typeof import('../platform/discord/client').client;
let prisma: typeof import('../platform/db/prisma-client').prisma;
let discordRestRequestGuildScoped: typeof import('../platform/discord/discordRestPolicy').discordRestRequestGuildScoped;
let initializeRuntimeSurface: typeof import('../features/agent-runtime/runtimeSurface').initializeRuntimeSurface;
let buildAgentGraphConfig: typeof import('../features/agent-runtime/langgraph/config').buildAgentGraphConfig;
let runSeededAgentGraphTurn: typeof import('../features/agent-runtime/langgraph/runtime').runSeededAgentGraphTurn;
let resumeAgentGraphTurn: typeof import('../features/agent-runtime/langgraph/runtime').resumeAgentGraphTurn;
let shutdownAgentGraphRuntime: typeof import('../features/agent-runtime/langgraph/runtime').shutdownAgentGraphRuntime;
let getApprovalReviewRequestById: typeof import('../features/admin/approvalReviewRequestRepo').getApprovalReviewRequestById;
let markApprovalReviewRequestDecisionIfPending: typeof import('../features/admin/approvalReviewRequestRepo').markApprovalReviewRequestDecisionIfPending;

type SmokeTarget = {
  guildId: string;
  channelId: string;
  actorUserId: string;
  reviewerUserId: string;
};

function seedSmokeEnvDefaults(): void {
  dotenv.config({ quiet: true });

  const defaults = {
    LANGSMITH_TRACING: 'false',
    SAGE_TRACE_DB_ENABLED: 'true',
    AI_PROVIDER_BASE_URL: 'https://example.invalid/v1',
    AI_PROVIDER_MAIN_AGENT_MODEL: 'smoke-main',
    AI_PROVIDER_PROFILE_AGENT_MODEL: 'smoke-profile',
    AI_PROVIDER_SUMMARY_AGENT_MODEL: 'smoke-summary',
    IMAGE_PROVIDER_BASE_URL: 'https://example.invalid/image',
    IMAGE_PROVIDER_MODEL: 'smoke-image',
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

async function loadSmokeRuntimeDeps(): Promise<void> {
  if (depsLoaded) {
    return;
  }

  seedSmokeEnvDefaults();

  ({ config: appConfig } = await import('../platform/config/env'));
  ({ client } = await import('../platform/discord/client'));
  ({ prisma } = await import('../platform/db/prisma-client'));
  ({ discordRestRequestGuildScoped } = await import('../platform/discord/discordRestPolicy'));
  ({ initializeRuntimeSurface } = await import('../features/agent-runtime/runtimeSurface'));
  ({ buildAgentGraphConfig } = await import('../features/agent-runtime/langgraph/config'));
  ({
    runSeededAgentGraphTurn,
    resumeAgentGraphTurn,
    shutdownAgentGraphRuntime,
  } = await import('../features/agent-runtime/langgraph/runtime'));
  ({
    getApprovalReviewRequestById,
    markApprovalReviewRequestDecisionIfPending,
  } = await import('../features/admin/approvalReviewRequestRepo'));

  depsLoaded = true;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required ${name}. Set SAGE_DISCORD_SMOKE_GUILD_ID and SAGE_DISCORD_SMOKE_CHANNEL_ID before running the live Discord smoke.`,
    );
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractRuntimeResultValue(toolResult: unknown): Record<string, unknown> | null {
  const root = asRecord(toolResult);
  const structuredContent = asRecord(root?.structuredContent);
  return asRecord(structuredContent?.result);
}

async function waitForDiscordReady(): Promise<void> {
  if (client.isReady()) {
    return;
  }
  await client.login(appConfig.DISCORD_TOKEN);
  if (!client.isReady()) {
    await once(client, 'clientReady');
  }
}

async function resolveSmokeTarget(): Promise<SmokeTarget> {
  const guildId = requiredEnv('SAGE_DISCORD_SMOKE_GUILD_ID');
  const channelId = requiredEnv('SAGE_DISCORD_SMOKE_CHANNEL_ID');
  await waitForDiscordReady();

  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.isDMBased() || !('guildId' in channel) || channel.guildId !== guildId) {
    throw new Error('SAGE_DISCORD_SMOKE_CHANNEL_ID must point at a guild channel inside SAGE_DISCORD_SMOKE_GUILD_ID.');
  }
  if (typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
    throw new Error('SAGE_DISCORD_SMOKE_CHANNEL_ID must be a text-capable guild channel.');
  }

  const actorUserId = process.env.SAGE_DISCORD_SMOKE_USER_ID?.trim() || client.user?.id?.trim();
  if (!actorUserId) {
    throw new Error('Unable to resolve a smoke actor user id. Set SAGE_DISCORD_SMOKE_USER_ID explicitly.');
  }
  const reviewerUserId = process.env.SAGE_DISCORD_SMOKE_REVIEWER_ID?.trim() || actorUserId;

  return {
    guildId,
    channelId,
    actorUserId,
    reviewerUserId,
  };
}

async function deleteDiscordMessageIfPresent(params: {
  guildId: string;
  channelId: string;
  messageId: string | null;
  reason: string;
}): Promise<void> {
  const messageId = params.messageId?.trim();
  if (!messageId) {
    return;
  }
  const result = await discordRestRequestGuildScoped({
    guildId: params.guildId,
    method: 'DELETE',
    path: `/channels/${params.channelId}/messages/${messageId}`,
    reason: params.reason,
    maxResponseChars: 500,
  });
  if (result.ok || result.status === 404) {
    return;
  }
  throw new Error(
    `Discord message cleanup failed (${String(result.status ?? 'unknown')} ${String(result.statusText ?? '').trim()})`,
  );
}

async function cleanupApprovalArtifacts(action: ApprovalReviewRequestRecord | null): Promise<void> {
  if (!action) {
    return;
  }

  await deleteDiscordMessageIfPresent({
    guildId: action.guildId,
    channelId: action.reviewChannelId,
    messageId: action.reviewerMessageId,
    reason: `[sage smoke:${action.id}] cleanup reviewer card`,
  }).catch((error) => {
    console.warn(`[WARN] failed to delete reviewer card: ${error instanceof Error ? error.message : String(error)}`);
  });

  await deleteDiscordMessageIfPresent({
    guildId: action.guildId,
    channelId: action.sourceChannelId,
    messageId: action.requesterStatusMessageId,
    reason: `[sage smoke:${action.id}] cleanup requester status`,
  }).catch((error) => {
    console.warn(`[WARN] failed to delete requester status: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function cleanupCreatedMessage(params: {
  guildId: string;
  channelId: string;
  messageId: string | null;
  actionId: string;
}): Promise<void> {
  await deleteDiscordMessageIfPresent({
    guildId: params.guildId,
    channelId: params.channelId,
    messageId: params.messageId,
    reason: `[sage smoke:${params.actionId}] cleanup created message`,
  });
}

async function runReadPathSmoke(target: SmokeTarget): Promise<void> {
  const graphConfig = buildAgentGraphConfig();
  const traceId = randomUUID();
  const callId = `discord-smoke-read-${Date.now()}-call`;
  const result = await runSeededAgentGraphTurn({
    threadId: traceId,
    goto: 'route_tool_phase',
    context: {
      traceId,
      originTraceId: traceId,
      userId: target.actorUserId,
      channelId: target.channelId,
      guildId: target.guildId,
      activeToolNames: ['runtime_execute_code'],
      routeKind: 'discord-smoke',
      currentTurn: null,
      replyTarget: null,
      invokedBy: 'component',
      invokerIsAdmin: true,
    },
    state: {
      messages: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: callId,
              name: 'runtime_execute_code',
              args: {
                language: 'javascript',
                code: `return await discord.channels.list({ guildId: ${JSON.stringify(target.guildId)} });`,
              },
              type: 'tool_call',
            },
          ],
        }),
      ],
      roundsCompleted: Math.max(0, graphConfig.sliceMaxSteps - 1),
      totalRoundsCompleted: Math.max(0, graphConfig.sliceMaxSteps - 1),
    },
  });

  const toolResult = result.toolResults.find((entry) => entry.name === 'runtime_execute_code');
  if (!toolResult?.success) {
    throw new Error(
      `Graph read-path smoke failed: ${toolResult?.error ?? 'runtime_execute_code did not produce a successful tool result.'}`,
    );
  }
  if (result.graphStatus !== 'completed' || result.pendingInterrupt) {
    throw new Error('Graph read-path smoke did not finish cleanly.');
  }

  console.log(
    `[PASS] graph read path routed runtime_execute_code through LangGraph and completed cleanly (stop=${result.stopReason})`,
  );
}

async function runApprovalPathSmoke(target: SmokeTarget): Promise<void> {
  const graphConfig = buildAgentGraphConfig();
  const traceId = randomUUID();
  const messageText = `sage smoke ${Date.now().toString(36)} approval validation`;
  let requestId: string | null = null;
  let action: ApprovalReviewRequestRecord | null = null;
  let createdMessageId: string | null = null;

  try {
    const queued = await runSeededAgentGraphTurn({
      threadId: traceId,
      goto: 'route_tool_phase',
      context: {
        traceId,
        originTraceId: traceId,
        userId: target.actorUserId,
        channelId: target.channelId,
        guildId: target.guildId,
        activeToolNames: ['runtime_execute_code'],
        routeKind: 'discord-smoke',
        currentTurn: null,
        replyTarget: null,
        invokedBy: 'component',
        invokerIsAdmin: true,
      },
      state: {
        messages: [
          new AIMessage({
            content: '',
            tool_calls: [
              {
                id: `${traceId}-call`,
                name: 'runtime_execute_code',
                args: {
                  language: 'javascript',
                  code: `return await discord.messages.send({ channelId: ${JSON.stringify(target.channelId)}, content: ${JSON.stringify(messageText)} });`,
                },
                type: 'tool_call',
              },
            ],
          }),
        ],
        roundsCompleted: graphConfig.sliceMaxSteps,
        totalRoundsCompleted: graphConfig.sliceMaxSteps,
      },
    });

    if (queued.pendingInterrupt?.kind !== 'approval_review') {
      throw new Error('Approval smoke did not pause with an approval interrupt.');
    }

    requestId = queued.pendingInterrupt.requestId;
    action = await getApprovalReviewRequestById(requestId);
    const decisionTraceId = randomUUID();
    const resumeTraceId = randomUUID();
    await markApprovalReviewRequestDecisionIfPending({
      id: requestId,
      decidedBy: target.reviewerUserId,
      status: 'approved',
      decisionReasonText: 'Sage live smoke approved automatically.',
      resumeTraceId: decisionTraceId,
    });

    const resumed = await resumeAgentGraphTurn({
      threadId: traceId,
      resume: {
        interruptKind: 'approval_review',
        decisions: [
          {
            requestId,
            status: 'approved',
            reviewerId: target.reviewerUserId,
            decisionReasonText: 'Sage live smoke approved automatically.',
          },
        ],
        resumeTraceId,
      },
      context: {
        traceId: resumeTraceId,
        originTraceId: traceId,
        userId: target.actorUserId,
        channelId: target.channelId,
        guildId: target.guildId,
        activeToolNames: ['runtime_execute_code'],
        routeKind: 'discord-smoke',
        currentTurn: null,
        replyTarget: null,
        invokedBy: 'component',
        invokerIsAdmin: true,
      },
    });

    const toolResult = resumed.toolResults.find((entry) => entry.name === 'runtime_execute_code');
    if (!toolResult?.success) {
      throw new Error(
        `Approval-resume smoke failed: ${toolResult?.error ?? 'runtime_execute_code did not execute successfully.'}`,
      );
    }
    const runtimeResult = extractRuntimeResultValue(toolResult);
    createdMessageId =
      typeof runtimeResult?.messageId === 'string' && runtimeResult.messageId.trim().length > 0
        ? runtimeResult.messageId.trim()
        : null;
    if (!createdMessageId) {
      throw new Error('Approval-resume smoke executed but did not expose the created message id for cleanup.');
    }
    if (resumed.graphStatus !== 'completed' || resumed.pendingInterrupt) {
      throw new Error('Approval-resume smoke did not finish cleanly.');
    }

    console.log(
      `[PASS] graph approval path created, approved, resumed, and executed runtime_execute_code cleanly (stop=${resumed.stopReason})`,
    );
  } finally {
    if (!action && requestId) {
      action = await getApprovalReviewRequestById(requestId).catch(() => null);
    }
    await cleanupCreatedMessage({
      guildId: target.guildId,
      channelId: target.channelId,
      messageId: createdMessageId,
      actionId: action?.id ?? traceId,
    }).catch((error) => {
      console.warn(`[WARN] failed to clean up smoke message: ${error instanceof Error ? error.message : String(error)}`);
    });
    await cleanupApprovalArtifacts(action).catch((error) => {
      console.warn(`[WARN] failed to clean up approval artifacts: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

async function main(): Promise<void> {
  await loadSmokeRuntimeDeps();
  await initializeRuntimeSurface();
  const target = await resolveSmokeTarget();

  console.log('Sage LangGraph Discord smoke starting...');
  console.log(`[INFO] guild=${target.guildId} channel=${target.channelId} actor=${target.actorUserId} reviewer=${target.reviewerUserId}`);

  await runReadPathSmoke(target);
  await runApprovalPathSmoke(target);

  console.log('Sage LangGraph Discord smoke completed successfully.');
}

main()
  .catch((error) => {
    console.error(`LangGraph Discord smoke failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (depsLoaded) {
      await shutdownAgentGraphRuntime().catch(() => undefined);
    }
    if (depsLoaded && client.isReady()) {
      client.destroy();
    }
    if (depsLoaded) {
      await prisma.$disconnect().catch(() => undefined);
    }
  });
