import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClient = vi.hoisted(() => ({
  login: vi.fn().mockResolvedValue(undefined),
}));

const mockRegisterDefaultAgenticTools = vi.hoisted(() => vi.fn());
const mockRegisterMessageCreateHandler = vi.hoisted(() => vi.fn());
const mockRegisterMessageReactionAddHandler = vi.hoisted(() => vi.fn());
const mockRegisterInteractionCreateHandler = vi.hoisted(() => vi.fn());
const mockRegisterVoiceStateUpdateHandler = vi.hoisted(() => vi.fn());
const mockRegisterReadyHandler = vi.hoisted(() => vi.fn());
const mockRegisterGuildCreateHandler = vi.hoisted(() => vi.fn());
const mockInitChannelSummaryScheduler = vi.hoisted(() => vi.fn());
const mockStartCompactionScheduler = vi.hoisted(() => vi.fn());
const mockInitApprovalCardCleanupScheduler = vi.hoisted(() => vi.fn());
const mockRegisterShutdownHooks = vi.hoisted(() => vi.fn());
const mockAssertAgentTraceSchemaReady = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/platform/discord/client', () => ({
  client: mockClient,
}));

vi.mock('@/features/agent-runtime', () => ({
  registerDefaultAgenticTools: mockRegisterDefaultAgenticTools,
}));

vi.mock('@/features/agent-runtime/agent-trace-preflight', () => ({
  assertAgentTraceSchemaReady: mockAssertAgentTraceSchemaReady,
}));

vi.mock('@/app/discord/handlers/messageCreate', () => ({
  registerMessageCreateHandler: mockRegisterMessageCreateHandler,
}));

vi.mock('@/app/discord/handlers/messageReactionAdd', () => ({
  registerMessageReactionAddHandler: mockRegisterMessageReactionAddHandler,
}));

vi.mock('@/app/discord/handlers/interactionCreate', () => ({
  registerInteractionCreateHandler: mockRegisterInteractionCreateHandler,
}));

vi.mock('@/app/discord/handlers/voiceStateUpdate', () => ({
  registerVoiceStateUpdateHandler: mockRegisterVoiceStateUpdateHandler,
}));

vi.mock('@/app/discord/handlers/ready', () => ({
  registerReadyHandler: mockRegisterReadyHandler,
}));

vi.mock('@/app/discord/handlers/guildCreate', () => ({
  registerGuildCreateHandler: mockRegisterGuildCreateHandler,
}));

vi.mock('@/features/summary/channelSummaryScheduler', () => ({
  initChannelSummaryScheduler: mockInitChannelSummaryScheduler,
}));

vi.mock('@/features/summary/ltmCompaction', () => ({
  startCompactionScheduler: mockStartCompactionScheduler,
}));

vi.mock('@/features/admin/approvalCardCleanupScheduler', () => ({
  initApprovalCardCleanupScheduler: mockInitApprovalCardCleanupScheduler,
}));

vi.mock('@/app/runtime/shutdown', () => ({
  registerShutdownHooks: mockRegisterShutdownHooks,
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
  });

  it('initializes runtime and starts both summary schedulers', async () => {
    await bootstrapApp();

    expect(mockRegisterDefaultAgenticTools).toHaveBeenCalledTimes(1);
    expect(mockAssertAgentTraceSchemaReady).toHaveBeenCalledTimes(1);
    expect(mockRegisterMessageCreateHandler).toHaveBeenCalledTimes(1);
    expect(mockRegisterMessageReactionAddHandler).toHaveBeenCalledTimes(1);
    expect(mockRegisterInteractionCreateHandler).toHaveBeenCalledTimes(1);
    expect(mockRegisterVoiceStateUpdateHandler).toHaveBeenCalledTimes(1);
    expect(mockRegisterReadyHandler).toHaveBeenCalledWith(mockClient);
    expect(mockRegisterGuildCreateHandler).toHaveBeenCalledWith(mockClient);
    expect(mockInitChannelSummaryScheduler).toHaveBeenCalledTimes(1);
    expect(mockStartCompactionScheduler).toHaveBeenCalledTimes(1);
    expect(mockInitApprovalCardCleanupScheduler).toHaveBeenCalledTimes(1);
    expect(mockRegisterShutdownHooks).toHaveBeenCalledWith({ client: mockClient });
    expect(mockClient.login).toHaveBeenCalledWith('test-token');
  });
});
