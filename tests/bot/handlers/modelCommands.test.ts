import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('../../../src/core/llm/modelCatalog', () => ({
  findModelInCatalog: vi.fn(),
  suggestModelIds: vi.fn(),
}));

vi.mock('../../../src/core/settings/guildModelSettings', () => ({
  setGuildModel: vi.fn(),
}));

describe('model command handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.ADMIN_USER_IDS = 'admin-id';
  });

  it('sets the guild model when the model exists', async () => {
    const { handleSetModel } = await import('../../../src/bot/handlers/interactionHandlers');
    const { findModelInCatalog } = await import('../../../src/core/llm/modelCatalog');
    const { setGuildModel } = await import('../../../src/core/settings/guildModelSettings');

    (findModelInCatalog as ReturnType<typeof vi.fn>).mockResolvedValue({
      model: { id: 'gemini', caps: {} },
      catalog: { gemini: { id: 'gemini', caps: {} } },
      refreshed: false,
    });

    const interaction = {
      user: { id: 'admin-id' },
      guildId: 'guild-1',
      options: {
        getString: vi.fn().mockReturnValue('Gemini'),
      },
      reply: vi.fn(),
      deferReply: vi.fn(),
      editReply: vi.fn(),
    } as any;

    await handleSetModel(interaction);

    expect(setGuildModel).toHaveBeenCalledWith('guild-1', 'gemini');
    expect(interaction.editReply).toHaveBeenCalledWith('✅ Set guild model to **gemini**.');
  });

  it('suggests close matches when a model is unknown', async () => {
    const { handleSetModel } = await import('../../../src/bot/handlers/interactionHandlers');
    const { findModelInCatalog, suggestModelIds } = await import('../../../src/core/llm/modelCatalog');

    (findModelInCatalog as ReturnType<typeof vi.fn>).mockResolvedValue({
      model: null,
      catalog: { gemini: { id: 'gemini', caps: {} } },
      refreshed: true,
    });

    (suggestModelIds as ReturnType<typeof vi.fn>).mockReturnValue(['gemini']);

    const interaction = {
      user: { id: 'admin-id' },
      guildId: 'guild-1',
      options: {
        getString: vi.fn().mockReturnValue('gemni'),
      },
      reply: vi.fn(),
      deferReply: vi.fn(),
      editReply: vi.fn(),
    } as any;

    await handleSetModel(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      '❌ Unknown model: gemni. Did you mean: gemini? Use /model list to view available options.',
    );
  });
});
