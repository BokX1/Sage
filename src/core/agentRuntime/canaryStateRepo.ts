import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma-client';
import { logger } from '../utils/logger';

const DEFAULT_CANARY_STATE_ID = 'global';

export interface PersistedCanaryStateRow {
  id: string;
  outcomesJson: unknown;
  cooldownUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function isSchemaMismatchError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof error === 'string'
      ? error.toLowerCase()
      : '';
  return (
    message.includes('p2021') ||
    message.includes('p2022') ||
    message.includes('does not exist') ||
    message.includes('unknown field')
  );
}

function toJson(value: unknown): Prisma.InputJsonValue {
  if (value === undefined || value === null) return [];
  return value as Prisma.InputJsonValue;
}

export async function readPersistedCanaryState(
  id = DEFAULT_CANARY_STATE_ID,
): Promise<PersistedCanaryStateRow | null> {
  try {
    const row = await prisma.agenticCanaryState.findUnique({ where: { id } });
    return (row as PersistedCanaryStateRow | null) ?? null;
  } catch (error) {
    if (isSchemaMismatchError(error)) {
      return null;
    }
    throw error;
  }
}

export async function writePersistedCanaryState(params: {
  outcomesJson: unknown;
  cooldownUntilMs: number;
  id?: string;
}): Promise<void> {
  const id = params.id ?? DEFAULT_CANARY_STATE_ID;
  const cooldownUntil = params.cooldownUntilMs > 0 ? new Date(params.cooldownUntilMs) : null;
  await prisma.agenticCanaryState.upsert({
    where: { id },
    create: {
      id,
      outcomesJson: toJson(params.outcomesJson),
      cooldownUntil,
    },
    update: {
      outcomesJson: toJson(params.outcomesJson),
      cooldownUntil,
    },
  });
}

export async function clearPersistedCanaryState(id = DEFAULT_CANARY_STATE_ID): Promise<void> {
  try {
    await prisma.agenticCanaryState.deleteMany({ where: { id } });
  } catch (error) {
    if (isSchemaMismatchError(error)) return;
    logger.warn({ error }, 'Failed to clear persisted canary state (non-fatal)');
  }
}
