import { prisma } from '../../core/db/prisma-client';
import { decryptSecret } from '../../shared/security/secret-crypto';

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
  return profile;
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
  await prisma.userProfile.upsert({
    where: { userId },
    update: { summary },
    create: { userId, summary },
  });
}
