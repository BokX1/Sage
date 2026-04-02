import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClient = vi.hoisted(() => ({
  login: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
}));

const mockInitializeRuntimeSurface = vi.hoisted(() => vi.fn());
const mockInitializeAgentGraphRuntime = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRegisterMessageCreateHandler = vi.hoisted(() => vi.fn());
const mockRegisterMessageUpdateHandler = vi.hoisted(() => vi.fn());
const mockRegisterInteractionCreateHandler = vi.hoisted(() => vi.fn());
const mockRegisterReadyHandler = vi.hoisted(() => vi.fn());
const mockRegisterGuildCreateHandler = vi.hoisted(() => vi.fn());
const mockRegisterGuildMemberAddHandler = vi.hoisted(() => vi.fn());
const mockRegisterGuildMemberUpdateHandler = vi.hoisted(() => vi.fn());
const mockRegisterAutoModerationRuleCreateHandler = vi.hoisted(() => vi.fn());
const mockRegisterAutoModerationRuleUpdateHandler = vi.hoisted(() => vi.fn());
const mockRegisterAutoModerationRuleDeleteHandler = vi.hoisted(() => vi.fn());
const mockRegisterAutoModerationActionExecutionHandler = vi.hoisted(() => vi.fn());
const mockInitChannelSummaryScheduler = vi.hoisted(() => vi.fn());
const mockStartCompactionScheduler = vi.hoisted(() => vi.fn());
const mockInitImageAttachmentRecallWorker = vi.hoisted(() => vi.fn());
const mockInitApprovalCardCleanupScheduler = vi.hoisted(() => vi.fn());
const mockInitAgentTaskRunWorker = vi.hoisted(() => vi.fn());
const mockInitScheduledTaskWorker = vi.hoisted(() => vi.fn());
const mockRegisterShutdownHooks = vi.hoisted(() => vi.fn());
const mockAssertAgentTraceSchemaReady = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetHostCodexAuthStatus = vi.hoisted(() => vi.fn().mockResolvedValue({
  configured: false,
  activeTextProvider: 'missing',
  fallbackTextProviderConfigured: false,
}));

vi.mock('@/platform/discord/client', () => ({
  client: mockClient,
}));

vi.mock('@/features/agent-runtime', () => ({
  initializeRuntimeSurface: mockInitializeRuntimeSurface,
}));

vi.mock('@/features/agent-runtime/langgraph/runtime', () => ({
  initializeAgentGraphRuntime: mockInitializeAgentGraphRuntime,
}));

vi.mock('@/features/agent-runtime/agent-trace-preflight', () => ({
  assertAgentTraceSchemaReady: mockAssertAgentTraceSchemaReady,
}));

vi.mock('@/app/discord/handlers/messageCreate', () => ({
  registerMessageCreateHandler: mockRegisterMessageCreateHandler,
}));

vi.mock('@/app/discord/handlers/messageUpdate', () => ({
  registerMessageUpdateHandler: mockRegisterMessageUpdateHandler,
}));

vi.mock('@/app/discord/handlers/interactionCreate', () => ({
  registerInteractionCreateHandler: mockRegisterInteractionCreateHandler,
}));

vi.mock('@/app/discord/handlers/ready', () => ({
  registerReadyHandler: mockRegisterReadyHandler,
}));

vi.mock('@/app/discord/handlers/guildCreate', () => ({
  registerGuildCreateHandler: mockRegisterGuildCreateHandler,
}));

vi.mock('@/app/discord/handlers/guildMemberAdd', () => ({
  registerGuildMemberAddHandler: mockRegisterGuildMemberAddHandler,
}));

vi.mock('@/app/discord/handlers/guildMemberUpdate', () => ({
  registerGuildMemberUpdateHandler: mockRegisterGuildMemberUpdateHandler,
}));

vi.mock('@/app/discord/handlers/autoModerationRuleCreate', () => ({
  registerAutoModerationRuleCreateHandler: mockRegisterAutoModerationRuleCreateHandler,
}));

vi.mock('@/app/discord/handlers/autoModerationRuleUpdate', () => ({
  registerAutoModerationRuleUpdateHandler: mockRegisterAutoModerationRuleUpdateHandler,
}));

vi.mock('@/app/discord/handlers/autoModerationRuleDelete', () => ({
  registerAutoModerationRuleDeleteHandler: mockRegisterAutoModerationRuleDeleteHandler,
}));

vi.mock('@/app/discord/handlers/autoModerationActionExecution', () => ({
  registerAutoModerationActionExecutionHandler: mockRegisterAutoModerationActionExecutionHandler,
}));

vi.mock('@/features/summary/channelSummaryScheduler', () => ({
  initChannelSummaryScheduler: mockInitChannelSummaryScheduler,
}));

vi.mock('@/features/summary/ltmCompaction', () => ({
  startCompactionScheduler: mockStartCompactionScheduler,
}));

vi.mock('@/features/attachments/imageAttachmentRecallWorker', () => ({
  initImageAttachmentRecallWorker: mockInitImageAttachmentRecallWorker,
}));

vi.mock('@/features/admin/approvalCardCleanupScheduler', () => ({
  initApprovalCardCleanupScheduler: mockInitApprovalCardCleanupScheduler,
}));

vi.mock('@/features/agent-runtime/agentTaskRunWorker', () => ({
  initAgentTaskRunWorker: mockInitAgentTaskRunWorker,
}));

vi.mock('@/features/scheduler/worker', () => ({
  initScheduledTaskWorker: mockInitScheduledTaskWorker,
}));

vi.mock('@/app/runtime/shutdown', () => ({
  registerShutdownHooks: mockRegisterShutdownHooks,
}));

vi.mock('@/features/auth/hostCodexAuthService', () => ({
  getHostCodexAuthStatus: mockGetHostCodexAuthStatus,
}));

vi.mock('@/platform/config/env', () => ({
  config: {
    DISCORD_TOKEN: 'test-token',
    AI_PROVIDER_API_KEY: '',
    SAGE_TRACE_DB_ENABLED: true,
  },
}));

import { bootstrapApp } from '@/app/bootstrap';

describe('bootstrapApp', () => {
  beforeEach(() => {
    mockAssertAgentTraceSchemaReady.mockResolvedValue(undefined);
    mockClient.login.mockResolvedValue(undefined);
    mockGetHostCodexAuthStatus.mockResolvedValue({
      configured: false,
      activeTextProvider: 'missing',
      fallbackTextProviderConfigured: false,
    });
  });

  it('initializes runtime and starts both summary schedulers', async () => {
    await bootstrapApp();

    expect(mockInitializeRuntimeSurface).toHaveBeenCalledTimes(1);
    expect(mockInitializeAgentGraphRuntime).toHaveBeenCalledTimes(1);
    expect(mockAssertAgentTraceSchemaReady).toHaveBeenCalledTimes(1);
    expect(mockRegisterMessageCreateHandler).toHaveBeenCalledTimes(1);
    expect(mockRegisterMessageUpdateHandler).toHaveBeenCalledTimes(1);
    expect(mockRegisterGuildMemberAddHandler).toHaveBeenCalledTimes(1);
    expect(mockRegisterGuildMemberUpdateHandler).toHaveBeenCalledTimes(1);
    expect(mockRegisterAutoModerationRuleCreateHandler).toHaveBeenCalledTimes(1);
    expect(mockRegisterAutoModerationRuleUpdateHandler).toHaveBeenCalledTimes(1);
    expect(mockRegisterAutoModerationRuleDeleteHandler).toHaveBeenCalledTimes(1);
    expect(mockRegisterAutoModerationActionExecutionHandler).toHaveBeenCalledTimes(1);
    expect(mockRegisterInteractionCreateHandler).toHaveBeenCalledTimes(1);
    expect(mockRegisterReadyHandler).toHaveBeenCalledWith(mockClient);
    expect(mockRegisterGuildCreateHandler).toHaveBeenCalledWith(mockClient);
    expect(mockInitChannelSummaryScheduler).toHaveBeenCalledTimes(1);
    expect(mockStartCompactionScheduler).toHaveBeenCalledTimes(1);
    expect(mockInitImageAttachmentRecallWorker).toHaveBeenCalledTimes(1);
    expect(mockInitApprovalCardCleanupScheduler).toHaveBeenCalledTimes(1);
    expect(mockInitAgentTaskRunWorker).toHaveBeenCalledTimes(1);
    expect(mockInitScheduledTaskWorker).toHaveBeenCalledTimes(1);
    expect(mockRegisterShutdownHooks).toHaveBeenCalledWith({ client: mockClient });
    expect(mockClient.login).toHaveBeenCalledWith('test-token');
  });
});
