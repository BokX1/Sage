import { prisma } from '../../platform/db/prisma-client';
import { decryptSecret, encryptSecret } from '../../platform/security/secret-crypto';

export async function getGuildApiKey(guildId: string): Promise<string | undefined> {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { pollinationsApiKey: true },
  });

  const raw = settings?.pollinationsApiKey;
  if (!raw) {
    return undefined;
  }

  return decryptSecret(raw);
}

export async function getGuildApprovalReviewChannelId(guildId: string): Promise<string | null> {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { approvalReviewChannelId: true },
  });

  const value = settings?.approvalReviewChannelId?.trim();
  return value ? value : null;
}

export async function getGuildTimezone(guildId: string): Promise<string | null> {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { timezone: true },
  });

  const value = settings?.timezone?.trim();
  return value ? value : null;
}

export async function setGuildTimezone(guildId: string, timezone: string | null): Promise<void> {
  const normalized = timezone?.trim() || null;
  await prisma.guildSettings.upsert({
    where: { guildId },
    create: {
      guildId,
      pollinationsApiKey: null,
      approvalReviewChannelId: null,
      timezone: normalized,
    },
    update: {
      timezone: normalized,
    },
  });
}

export async function setGuildApprovalReviewChannelId(
  guildId: string,
  approvalReviewChannelId: string | null,
): Promise<void> {
  const normalized = approvalReviewChannelId?.trim() || null;
  await prisma.guildSettings.upsert({
    where: { guildId },
    create: {
      guildId,
      pollinationsApiKey: null,
      approvalReviewChannelId: normalized,
    },
    update: {
      approvalReviewChannelId: normalized,
    },
  });
}

export async function upsertGuildApiKey(guildId: string, apiKey: string | null): Promise<void> {
  if (apiKey === null) {
    // If setting to null, we can strictly update or delete. Upsert with null is valid if record exists.
    // Simpler: upsert with update/create logic.
    await prisma.guildSettings.upsert({
      where: { guildId },
      create: { guildId, pollinationsApiKey: null, approvalReviewChannelId: null, timezone: null },
      update: { pollinationsApiKey: null },
    });
  } else {
    const encryptedApiKey = encryptSecret(apiKey);
    await prisma.guildSettings.upsert({
      where: { guildId },
      create: { guildId, pollinationsApiKey: encryptedApiKey, approvalReviewChannelId: null, timezone: null },
      update: { pollinationsApiKey: encryptedApiKey },
    });
  }
}
