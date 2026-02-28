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
const mockRegisterShutdownHooks = vi.hoisted(() => vi.fn());
const mockAssertAgentTraceSchemaReady = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/bot/client', () => ({
  client: mockClient,
}));

vi.mock('@/core/agentRuntime', () => ({
  registerDefaultAgenticTools: mockRegisterDefaultAgenticTools,
}));

vi.mock('@/core/agentRuntime/agent-trace-preflight', () => ({
  assertAgentTraceSchemaReady: mockAssertAgentTraceSchemaReady,
}));

vi.mock('@/bot/handlers/messageCreate', () => ({
  registerMessageCreateHandler: mockRegisterMessageCreateHandler,
}));

vi.mock('@/bot/handlers/messageReactionAdd', () => ({
  registerMessageReactionAddHandler: mockRegisterMessageReactionAddHandler,
}));

vi.mock('@/bot/handlers/interactionCreate', () => ({
  registerInteractionCreateHandler: mockRegisterInteractionCreateHandler,
}));

vi.mock('@/bot/handlers/voiceStateUpdate', () => ({
  registerVoiceStateUpdateHandler: mockRegisterVoiceStateUpdateHandler,
}));

vi.mock('@/bot/handlers/ready', () => ({
  registerReadyHandler: mockRegisterReadyHandler,
}));

vi.mock('@/bot/handlers/guildCreate', () => ({
  registerGuildCreateHandler: mockRegisterGuildCreateHandler,
}));

vi.mock('@/core/summary/channelSummaryScheduler', () => ({
  initChannelSummaryScheduler: mockInitChannelSummaryScheduler,
}));

vi.mock('@/core/summary/ltmCompaction', () => ({
  startCompactionScheduler: mockStartCompactionScheduler,
}));

vi.mock('@/core/runtime/shutdown', () => ({
  registerShutdownHooks: mockRegisterShutdownHooks,
}));

vi.mock('@/config', () => ({
  config: {
    DISCORD_TOKEN: 'test-token',
    LLM_API_KEY: '',
    TRACE_ENABLED: true,
  },
}));

import { bootstrapApp } from '@/bootstrap';

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
    expect(mockRegisterShutdownHooks).toHaveBeenCalledWith({ client: mockClient });
    expect(mockClient.login).toHaveBeenCalledWith('test-token');
  });
});
