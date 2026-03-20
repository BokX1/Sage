/* eslint-disable no-console */

import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

let depsLoaded = false;
let registerDefaultAgenticTools: typeof import('../features/agent-runtime/defaultTools').registerDefaultAgenticTools;
let buildAgentGraphConfig: typeof import('../features/agent-runtime/langgraph/config').buildAgentGraphConfig;
let runSeededAgentGraphTurn: typeof import('../features/agent-runtime/langgraph/runtime').runSeededAgentGraphTurn;
let continueAgentGraphTurn: typeof import('../features/agent-runtime/langgraph/runtime').continueAgentGraphTurn;
let __getAgentGraphStateForTests: typeof import('../features/agent-runtime/langgraph/runtime').__getAgentGraphStateForTests;
let shutdownAgentGraphRuntime: typeof import('../features/agent-runtime/langgraph/runtime').shutdownAgentGraphRuntime;
let prisma: typeof import('../platform/db/prisma-client').prisma;

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

async function loadDeps(): Promise<void> {
  if (depsLoaded) {
    return;
  }

  seedSmokeEnvDefaults();
  ({ registerDefaultAgenticTools } = await import('../features/agent-runtime/defaultTools'));
  ({ buildAgentGraphConfig } = await import('../features/agent-runtime/langgraph/config'));
  ({
    runSeededAgentGraphTurn,
    continueAgentGraphTurn,
    __getAgentGraphStateForTests,
    shutdownAgentGraphRuntime,
  } = await import('../features/agent-runtime/langgraph/runtime'));
  ({ prisma } = await import('../platform/db/prisma-client'));
  depsLoaded = true;
}

function buildSmokeTurn(params: {
  messageId: string;
  invokedBy: 'mention' | 'reply' | 'component';
  replyTargetMessageId: string | null;
}): Record<string, unknown> {
  return {
    invokerUserId: 'interrupt-smoke-user',
    invokerDisplayName: 'Interrupt Smoke User',
    messageId: params.messageId,
    guildId: 'interrupt-smoke-guild',
    channelId: 'interrupt-smoke-channel',
    invokedBy: params.invokedBy,
    mentionedUserIds: [],
    isDirectReply: params.replyTargetMessageId !== null,
    replyTargetMessageId: params.replyTargetMessageId,
    replyTargetAuthorId: params.replyTargetMessageId ? 'sage-bot' : null,
    botUserId: 'sage-bot',
  };
}

async function main(): Promise<void> {
  await loadDeps();
  registerDefaultAgenticTools();

  const graphConfig = buildAgentGraphConfig();
  const threadId = `interrupt-smoke-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const seedTraceId = randomUUID();
  const resumeTraceId = randomUUID();
  const sourceMessageId = `${threadId}-source`;
  const responseMessageId = `${threadId}-response`;

  console.log('Sage LangGraph interrupt smoke starting...');
  console.log(`[INFO] thread=${threadId} sliceMaxSteps=${graphConfig.sliceMaxSteps}`);

  const initial = await runSeededAgentGraphTurn({
    threadId,
    runId: seedTraceId,
    runName: 'sage_agent_interrupt_smoke_seed',
    goto: 'yield_background',
    context: {
      traceId: seedTraceId,
      originTraceId: seedTraceId,
      threadId,
      userId: 'interrupt-smoke-user',
      channelId: 'interrupt-smoke-channel',
      guildId: 'interrupt-smoke-guild',
      invokedBy: 'component',
      invokerIsAdmin: true,
      invokerCanModerate: true,
      activeToolNames: [],
      routeKind: 'interrupt_smoke_seed',
      currentTurn: buildSmokeTurn({
        messageId: sourceMessageId,
        invokedBy: 'mention',
        replyTargetMessageId: null,
      }),
      replyTarget: null,
    },
    state: {
      messages: [
        new HumanMessage({
          content: 'Work through a long-running task in several steps and stay ready for a stop instruction.',
        }),
        new AIMessage({
          content: 'Turn 2/5 complete. Pausing here before the remaining steps.',
        }),
      ],
      replyText: 'Turn 2/5 complete. Pausing here before the remaining steps.',
      responseSession: {
        responseSessionId: threadId,
        status: 'draft',
        latestText: 'Turn 2/5 complete. Pausing here before the remaining steps.',
        draftRevision: 1,
        sourceMessageId,
        responseMessageId,
        surfaceAttached: true,
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
      roundsCompleted: Math.max(1, graphConfig.sliceMaxSteps),
      totalRoundsCompleted: Math.max(1, graphConfig.sliceMaxSteps),
      graphStatus: 'running',
      completionKind: 'final_answer',
      stopReason: 'background_yield',
      deliveryDisposition: 'response_session',
    },
  });

  if (initial.stopReason !== 'background_yield') {
    throw new Error(`Expected seeded run to background-yield, got ${initial.stopReason}.`);
  }

  console.log(`[PASS] seeded background-yield thread created (reply="${initial.replyText}")`);

  const resumed = await continueAgentGraphTurn({
    threadId,
    runId: resumeTraceId,
    runName: 'sage_agent_interrupt_smoke_resume',
    context: {
      traceId: resumeTraceId,
      originTraceId: seedTraceId,
      threadId,
      userId: 'interrupt-smoke-user',
      channelId: 'interrupt-smoke-channel',
      guildId: 'interrupt-smoke-guild',
      invokedBy: 'component',
      invokerIsAdmin: true,
      invokerCanModerate: true,
      activeToolNames: [],
      routeKind: 'background_resume',
      currentTurn: buildSmokeTurn({
        messageId: `${threadId}-steer`,
        invokedBy: 'reply',
        replyTargetMessageId: responseMessageId,
      }),
      replyTarget: null,
    },
    pendingUserInterrupt: {
      revision: 1,
      messageId: `${threadId}-steer`,
      userId: 'interrupt-smoke-user',
      channelId: 'interrupt-smoke-channel',
      guildId: 'interrupt-smoke-guild',
      userText: 'Stop now and keep the same task thread.',
      userContent: 'Stop now and keep the same task thread.',
      queuedAtIso: new Date().toISOString(),
      supersededRevision: null,
    },
  });

  if (resumed.graphStatus !== 'completed') {
    throw new Error(`Expected resumed graph to complete cleanly, got ${resumed.graphStatus}.`);
  }
  if (resumed.completionKind === 'runtime_failure' || resumed.stopReason === 'runtime_failure') {
    throw new Error(`Interrupt smoke resumed with runtime failure: ${resumed.replyText}`);
  }

  const checkpointState = await __getAgentGraphStateForTests(threadId);
  if (!checkpointState) {
    throw new Error('Expected persisted checkpoint state after interrupt smoke resume.');
  }
  const injectedMessages = checkpointState.messages.filter(
    (message) =>
      HumanMessage.isInstance(message) &&
      typeof message.content === 'string' &&
      message.content.includes('A new message arrived from the original requester while this task was still running.'),
  );

  if (injectedMessages.length !== 1) {
    throw new Error(`Expected exactly one injected steering message, found ${injectedMessages.length}.`);
  }

  console.log(
    `[PASS] resumed thread consumed the steering interrupt once (stop=${resumed.stopReason}, completion=${resumed.completionKind})`,
  );
  console.log(`[INFO] final reply: ${resumed.replyText}`);
  console.log('Sage LangGraph interrupt smoke completed successfully.');
}

main()
  .catch((error) => {
    const rendered =
      error instanceof Error
        ? error.stack || error.message || String(error)
        : typeof error === 'string'
          ? error
          : JSON.stringify(error, null, 2);
    console.error(`LangGraph interrupt smoke failed: ${rendered}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (depsLoaded) {
      await shutdownAgentGraphRuntime().catch(() => undefined);
      await prisma.$disconnect().catch(() => undefined);
    }
  });
