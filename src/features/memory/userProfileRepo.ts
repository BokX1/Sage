import { prisma } from '../../platform/db/prisma-client';
import { decryptSecret } from '../../platform/security/secret-crypto';
import { normalizeUserProfileSummary } from './userProfileXml';

export interface UserProfileRecord {
  userId: string;
  summary: string;
  updatedAt: Date;
}

export async function getUserProfileRecord(userId: string): Promise<UserProfileRecord | null> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      userId: true,
      summary: true,
      updatedAt: true,
    },
  });
  if (!profile) return null;
  return {
    ...profile,
    summary: normalizeUserProfileSummary(profile.summary) ?? profile.summary,
  };
}

export async function getUserProfile(userId: string): Promise<string | null> {
  const profile = await getUserProfileRecord(userId);
  return profile?.summary || null;
}

export async function getUserApiKey(userId: string): Promise<string | undefined> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
  });
  return profile?.pollinationsApiKey ? decryptSecret(profile.pollinationsApiKey) : undefined;
}

export async function upsertUserProfile(userId: string, summary: string): Promise<void> {
  const normalizedSummary = normalizeUserProfileSummary(summary);
  if (!normalizedSummary) {
    throw new Error('User profile summary must contain exactly <preferences>, <active_focus>, and <background> sections.');
  }

  await prisma.userProfile.upsert({
    where: { userId },
    update: { summary: normalizedSummary },
    create: { userId, summary: normalizedSummary },
  });
}
