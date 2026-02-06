import { prisma } from '../../core/db/prisma-client';
import { decryptSecret, encryptSecret } from '../../shared/security/secret-crypto';

export async function getUserProfile(userId: string): Promise<string | null> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
  });
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
