import { prisma } from '../../core/db/prisma-client';
import { logger } from '../utils/logger';

export interface ModelHealthStateRow {
  modelId: string;
  score: number;
  samples: number;
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

export async function listModelHealthStates(modelIds?: string[]): Promise<ModelHealthStateRow[]> {
  try {
    const ids =
      modelIds && modelIds.length > 0
        ? Array.from(
            new Set(
              modelIds
                .map((value) => value.trim().toLowerCase())
                .filter((value) => value.length > 0),
            ),
          )
        : undefined;
    const rows = await prisma.modelHealthState.findMany({
      where: ids ? { modelId: { in: ids } } : undefined,
      orderBy: { updatedAt: 'desc' },
    });
    return rows as ModelHealthStateRow[];
  } catch (error) {
    if (isSchemaMismatchError(error)) {
      return [];
    }
    throw error;
  }
}

export async function upsertModelHealthState(params: {
  modelId: string;
  score: number;
  samples: number;
}): Promise<void> {
  const modelId = params.modelId.trim().toLowerCase();
  if (!modelId) return;
  await prisma.modelHealthState.upsert({
    where: { modelId },
    create: {
      modelId,
      score: params.score,
      samples: params.samples,
    },
    update: {
      score: params.score,
      samples: params.samples,
    },
  });
}

export async function clearModelHealthStates(): Promise<void> {
  try {
    await prisma.modelHealthState.deleteMany({});
  } catch (error) {
    if (isSchemaMismatchError(error)) return;
    logger.warn({ error }, 'Failed to clear persisted model health state (non-fatal)');
  }
}
