/* eslint-disable no-console */

import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { CurrentTurnContext } from '../features/agent-runtime/continuityContext';

let depsLoaded = false;
let registerDefaultAgenticTools: typeof import('../features/agent-runtime/defaultTools').registerDefaultAgenticTools;
let buildAgentGraphConfig: typeof import('../features/agent-runtime/langgraph/config').buildAgentGraphConfig;
let runSeededAgentGraphTurn: typeof import('../features/agent-runtime/langgraph/runtime').runSeededAgentGraphTurn;
let continueAgentGraphTurn: typeof import('../features/agent-runtime/langgraph/runtime').continueAgentGraphTurn;
let __runAgentGraphCommandForTests: typeof import('../features/agent-runtime/langgraph/runtime').__runAgentGraphCommandForTests;
let __getAgentGraphStateForTests: typeof import('../features/agent-runtime/langgraph/runtime').__getAgentGraphStateForTests;
let shutdownAgentGraphRuntime: typeof import('../features/agent-runtime/langgraph/runtime').shutdownAgentGraphRuntime;
let continueMatchedTaskRunWithInput: typeof import('../features/agent-runtime/agentRuntime').continueMatchedTaskRunWithInput;
let upsertAgentTaskRun: typeof import('../features/agent-runtime/agentTaskRunRepo').upsertAgentTaskRun;
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
    __runAgentGraphCommandForTests,
    __getAgentGraphStateForTests,
    shutdownAgentGraphRuntime,
  } = await import('../features/agent-runtime/langgraph/runtime'));
  ({ continueMatchedTaskRunWithInput } = await import('../features/agent-runtime/agentRuntime'));
  ({ upsertAgentTaskRun } = await import('../features/agent-runtime/agentTaskRunRepo'));
  ({ prisma } = await import('../platform/db/prisma-client'));
  depsLoaded = true;
}

function buildSmokeTurn(params: {
  messageId: string;
  invokedBy: 'mention' | 'reply' | 'component';
  replyTargetMessageId: string | null;
}): CurrentTurnContext {
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
  await registerDefaultAgenticTools();

  const graphConfig = buildAgentGraphConfig();
  const smokeId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const threadId = `interrupt-smoke-${smokeId}`;
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

  const staleThreadId = `interrupt-stale-smoke-${smokeId}`;
  const staleResponseMessageId = `${staleThreadId}-response`;
  const staleSourceMessageId = `${staleThreadId}-source`;
  const staleTraceId = randomUUID();
  const staleResumeTraceId = randomUUID();

  await __runAgentGraphCommandForTests({
    threadId: staleThreadId,
    goto: 'finalize_turn',
    context: {
      traceId: staleTraceId,
      originTraceId: staleTraceId,
      threadId: staleThreadId,
      userId: 'interrupt-smoke-user',
      channelId: 'interrupt-smoke-channel',
      guildId: 'interrupt-smoke-guild',
      invokedBy: 'component',
      invokerIsAdmin: true,
      invokerCanModerate: true,
      activeToolNames: [],
      routeKind: 'active_interrupt_race_resume',
      currentTurn: buildSmokeTurn({
        messageId: staleSourceMessageId,
        invokedBy: 'mention',
        replyTargetMessageId: null,
      }),
      replyTarget: null,
    },
    state: {
      graphStatus: 'completed',
      completionKind: 'final_answer',
      stopReason: 'assistant_turn_completed',
      replyText: 'Turn 5/5 complete. Loop complete.',
      responseSession: {
        responseSessionId: staleThreadId,
        status: 'final',
        latestText: 'Turn 5/5 complete. Loop complete.',
        draftRevision: 5,
        sourceMessageId: staleSourceMessageId,
        responseMessageId: staleResponseMessageId,
        surfaceAttached: true,
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
      messages: [
        new HumanMessage({
          content: 'Run the five-step chain and be ready to stop if I reply mid-flight.',
        }),
        new AIMessage({
          content: 'Turn 5/5 complete. Loop complete.',
        }),
      ],
    },
  });

  await upsertAgentTaskRun({
    threadId: staleThreadId,
    originTraceId: staleTraceId,
    latestTraceId: staleTraceId,
    guildId: 'interrupt-smoke-guild',
    channelId: 'interrupt-smoke-channel',
    requestedByUserId: 'interrupt-smoke-user',
    sourceMessageId: staleSourceMessageId,
    responseMessageId: staleResponseMessageId,
    status: 'completed',
    waitingKind: null,
    latestDraftText: 'Turn 5/5 complete. Loop complete.',
    draftRevision: 5,
    completionKind: 'final_answer',
    stopReason: 'assistant_turn_completed',
    nextRunnableAt: null,
    responseSessionJson: {
      responseSessionId: staleThreadId,
      status: 'final',
      latestText: 'Turn 5/5 complete. Loop complete.',
      draftRevision: 5,
      sourceMessageId: staleSourceMessageId,
      responseMessageId: staleResponseMessageId,
      surfaceAttached: true,
      overflowMessageIds: [],
      linkedArtifactMessageIds: [],
    },
    waitingStateJson: null,
    compactionStateJson: null,
    checkpointMetadataJson: null,
    maxTotalDurationMs: graphConfig.maxTotalDurationMs,
    maxIdleWaitMs: graphConfig.maxIdleWaitMs,
    taskWallClockMs: 0,
    resumeCount: 0,
    completedAt: new Date(),
    lastErrorText: null,
  });

  const staleResult = await continueMatchedTaskRunWithInput({
    traceId: staleResumeTraceId,
    threadId: staleThreadId,
    userId: 'interrupt-smoke-user',
    channelId: 'interrupt-smoke-channel',
    guildId: 'interrupt-smoke-guild',
    userText: 'stop',
    invokerAuthority: 'admin',
    userContent: 'stop',
    currentTurn: {
      ...buildSmokeTurn({
        messageId: `${staleThreadId}-stop`,
        invokedBy: 'reply',
        replyTargetMessageId: staleResponseMessageId,
      }),
      isDirectReply: true,
    },
    replyTarget: null,
    promptMode: 'reply_only',
    isAdmin: true,
    canModerate: true,
  });

  if (staleResult.status === 'failed') {
    throw new Error(`Expected stale-race continuation to recover cleanly, got failure: ${staleResult.replyText}`);
  }
  if (staleResult.responseSession?.responseMessageId !== staleResponseMessageId) {
    throw new Error(
      `Expected stale-race continuation to stay on the same response surface, got ${staleResult.responseSession?.responseMessageId ?? 'null'}.`,
    );
  }
  console.log(
    `[PASS] stale-finish reopen reused the same task thread surface (delivery=${staleResult.delivery}, status=${staleResult.status})`,
  );
  console.log(`[INFO] stale-race reply: ${staleResult.replyText}`);
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
