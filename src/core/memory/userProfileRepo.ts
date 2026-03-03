/**
 * @module src/core/memory/userProfileRepo
 * @description Defines the user profile repo module.
 */
import { prisma } from '../../core/db/prisma-client';
import { decryptSecret } from '../../shared/security/secret-crypto';

/**
 * Represents the UserProfileRecord contract.
 */
export interface UserProfileRecord {
  userId: string;
  summary: string;
  updatedAt: Date;
}

/**
 * Runs getUserProfileRecord.
 *
 * @param userId - Describes the userId input.
 * @returns Returns the function result.
 */
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

/**
 * Runs getUserProfile.
 *
 * @param userId - Describes the userId input.
 * @returns Returns the function result.
 */
export async function getUserProfile(userId: string): Promise<string | null> {
  const profile = await getUserProfileRecord(userId);
  return profile?.summary || null;
}

/**
 * Runs getUserApiKey.
 *
 * @param userId - Describes the userId input.
 * @returns Returns the function result.
 */
export async function getUserApiKey(userId: string): Promise<string | undefined> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
  });
  return profile?.pollinationsApiKey ? decryptSecret(profile.pollinationsApiKey) : undefined;
}

/**
 * Runs upsertUserProfile.
 *
 * @param userId - Describes the userId input.
 * @param summary - Describes the summary input.
 * @returns Returns the function result.
 */
export async function upsertUserProfile(userId: string, summary: string): Promise<void> {
  await prisma.userProfile.upsert({
    where: { userId },
    update: { summary },
    create: { userId, summary },
  });
}
