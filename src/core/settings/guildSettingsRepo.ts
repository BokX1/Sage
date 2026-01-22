import { prisma } from '../../db/client';

export async function getGuildApiKey(guildId: string): Promise<string | undefined> {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
  });
  return settings?.pollinationsApiKey ?? undefined;
}

export async function upsertGuildApiKey(guildId: string, apiKey: string | null): Promise<void> {
  if (apiKey === null) {
    // If setting to null, we can strictly update or delete. Upsert with null is valid if record exists.
    // Simpler: upsert with update/create logic.
    await prisma.guildSettings.upsert({
      where: { guildId },
      create: { guildId, pollinationsApiKey: null },
      update: { pollinationsApiKey: null },
    });
  } else {
    await prisma.guildSettings.upsert({
      where: { guildId },
      create: { guildId, pollinationsApiKey: apiKey },
      update: { pollinationsApiKey: apiKey },
    });
  }
}
