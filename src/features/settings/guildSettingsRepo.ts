import { prisma } from '../../platform/db/prisma-client';
import { decryptSecret, encryptSecret } from '../../platform/security/secret-crypto';

function buildDefaultGuildSettingsCreate(guildId: string) {
  return {
    guildId,
    pollinationsApiKey: null,
    approvalReviewChannelId: null,
    timezone: null,
    artifactVaultChannelId: null,
    modLogChannelId: null,
  };
}

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

export async function getGuildArtifactVaultChannelId(guildId: string): Promise<string | null> {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { artifactVaultChannelId: true },
  });

  const value = settings?.artifactVaultChannelId?.trim();
  return value ? value : null;
}

export async function getGuildModLogChannelId(guildId: string): Promise<string | null> {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { modLogChannelId: true },
  });

  const value = settings?.modLogChannelId?.trim();
  return value ? value : null;
}

export async function setGuildTimezone(guildId: string, timezone: string | null): Promise<void> {
  const normalized = timezone?.trim() || null;
  await prisma.guildSettings.upsert({
    where: { guildId },
    create: {
      ...buildDefaultGuildSettingsCreate(guildId),
      timezone: normalized,
    },
    update: {
      timezone: normalized,
    },
  });
}

export async function setGuildArtifactVaultChannelId(guildId: string, artifactVaultChannelId: string | null): Promise<void> {
  const normalized = artifactVaultChannelId?.trim() || null;
  await prisma.guildSettings.upsert({
    where: { guildId },
    create: {
      ...buildDefaultGuildSettingsCreate(guildId),
      artifactVaultChannelId: normalized,
    },
    update: {
      artifactVaultChannelId: normalized,
    },
  });
}

export async function setGuildModLogChannelId(guildId: string, modLogChannelId: string | null): Promise<void> {
  const normalized = modLogChannelId?.trim() || null;
  await prisma.guildSettings.upsert({
    where: { guildId },
    create: {
      ...buildDefaultGuildSettingsCreate(guildId),
      modLogChannelId: normalized,
    },
    update: {
      modLogChannelId: normalized,
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
      ...buildDefaultGuildSettingsCreate(guildId),
      approvalReviewChannelId: normalized,
    },
    update: {
      approvalReviewChannelId: normalized,
    },
  });
}

export async function upsertGuildApiKey(guildId: string, apiKey: string | null): Promise<void> {
  if (apiKey === null) {
    await prisma.guildSettings.upsert({
      where: { guildId },
      create: buildDefaultGuildSettingsCreate(guildId),
      update: { pollinationsApiKey: null },
    });
    return;
  }

  const encryptedApiKey = encryptSecret(apiKey);
  await prisma.guildSettings.upsert({
    where: { guildId },
    create: {
      ...buildDefaultGuildSettingsCreate(guildId),
      pollinationsApiKey: encryptedApiKey,
    },
    update: { pollinationsApiKey: encryptedApiKey },
  });
}
