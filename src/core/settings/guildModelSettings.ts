import { prisma } from '../../db/client';

type PrismaGuildSettingClient = {
  findUnique: (args: { where: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
  upsert: (args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  deleteMany: (args: { where: Record<string, unknown> }) => Promise<{ count: number }>;
};

const MODEL_SETTING_KEY = 'llm_model';

function getGuildSettingClient(): PrismaGuildSettingClient {
  return (prisma as unknown as { guildSetting: PrismaGuildSettingClient }).guildSetting;
}

export async function getGuildModel(guildId: string): Promise<string | null> {
  const client = getGuildSettingClient();
  const row = await client.findUnique({
    where: {
      guildId_key: {
        guildId,
        key: MODEL_SETTING_KEY,
      },
    },
  });

  return row ? ((row.value as string) || null) : null;
}

export async function setGuildModel(guildId: string, modelId: string): Promise<void> {
  const client = getGuildSettingClient();
  await client.upsert({
    where: {
      guildId_key: {
        guildId,
        key: MODEL_SETTING_KEY,
      },
    },
    create: {
      guildId,
      key: MODEL_SETTING_KEY,
      value: modelId.trim().toLowerCase(),
    },
    update: {
      value: modelId.trim().toLowerCase(),
    },
  });
}

export async function clearGuildModel(guildId: string): Promise<void> {
  const client = getGuildSettingClient();
  await client.deleteMany({
    where: {
      guildId,
      key: MODEL_SETTING_KEY,
    },
  });
}
