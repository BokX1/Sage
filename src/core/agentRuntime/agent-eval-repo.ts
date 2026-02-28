import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma-client';
import { logger } from '../utils/logger';
import { EvalDimensionScores } from './evalScorer';

export interface AgentEvaluationWriteData {
  traceId: string;
  guildId: string | null;
  channelId: string;
  userId: string;
  routeKind: string;
  model: string;
  rubricVersion: string;
  primaryJudgeModel: string;
  secondaryJudgeModel: string;
  adjudicatorJudgeModel?: string | null;
  overallScore: number;
  confidence: number;
  verdict: 'pass' | 'revise';
  disagreement: boolean;
  arbitrationUsed: boolean;
  judgeAgreement: boolean;
  dimensionScores: EvalDimensionScores;
  issues: string[];
  summary?: string;
  judgeJson?: unknown;
}

export interface AgentEvaluationRow {
  id: string;
  traceId: string;
  guildId: string | null;
  channelId: string;
  userId: string;
  routeKind: string;
  model: string;
  rubricVersion: string;
  primaryJudgeModel: string;
  secondaryJudgeModel: string;
  adjudicatorJudgeModel: string | null;
  overallScore: number;
  confidence: number;
  verdict: string;
  disagreement: boolean;
  arbitrationUsed: boolean;
  judgeAgreement: boolean;
  dimensionScoresJson: unknown;
  issuesJson: unknown;
  summaryText: string | null;
  judgeJson: unknown;
  createdAt: Date;
}

function requiredJson(value: unknown, fallback: Prisma.InputJsonValue): Prisma.InputJsonValue {
  if (value === undefined || value === null) return fallback;
  return value as Prisma.InputJsonValue;
}

function nullableJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export async function insertAgentEvaluation(data: AgentEvaluationWriteData): Promise<void> {
  await prisma.agentEvaluation.create({
    data: {
      traceId: data.traceId,
      guildId: data.guildId,
      channelId: data.channelId,
      userId: data.userId,
      routeKind: data.routeKind,
      model: data.model,
      rubricVersion: data.rubricVersion,
      primaryJudgeModel: data.primaryJudgeModel,
      secondaryJudgeModel: data.secondaryJudgeModel,
      adjudicatorJudgeModel: data.adjudicatorJudgeModel ?? null,
      overallScore: data.overallScore,
      confidence: data.confidence,
      verdict: data.verdict,
      disagreement: data.disagreement,
      arbitrationUsed: data.arbitrationUsed,
      judgeAgreement: data.judgeAgreement,
      dimensionScoresJson: requiredJson(data.dimensionScores, {}),
      issuesJson: requiredJson(data.issues, []),
      summaryText: data.summary ?? null,
      judgeJson: nullableJson(data.judgeJson),
    },
  });
}

export async function listRecentAgentEvaluations(params: {
  limit: number;
  guildId?: string;
  channelId?: string;
  routeKind?: string;
  rubricVersion?: string;
  latestPerTrace?: boolean;
}): Promise<AgentEvaluationRow[]> {
  const where: Prisma.AgentEvaluationWhereInput = {};
  if (params.guildId) where.guildId = params.guildId;
  if (params.channelId) where.channelId = params.channelId;
  if (params.routeKind) where.routeKind = params.routeKind;
  if (params.rubricVersion) where.rubricVersion = params.rubricVersion;

  const safeLimit = Math.max(1, Math.floor(params.limit));
  if (!params.latestPerTrace) {
    const rows = await prisma.agentEvaluation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });
    return rows as AgentEvaluationRow[];
  }

  const pageSize = Math.max(50, safeLimit);
  const maxScanRows = Math.max(safeLimit * 30, pageSize);
  let skip = 0;
  const byTrace = new Set<string>();
  const deduped: AgentEvaluationRow[] = [];
  while (deduped.length < safeLimit && skip < maxScanRows) {
    const rows = await prisma.agentEvaluation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (byTrace.has(row.traceId)) continue;
      byTrace.add(row.traceId);
      deduped.push(row as AgentEvaluationRow);
      if (deduped.length >= safeLimit) break;
    }
    skip += rows.length;
    if (rows.length < pageSize) break;
  }
  return deduped;
}

export async function cleanupAgentEvaluationsByTrace(params: {
  traceIds: string[];
  rubricVersion: string;
}): Promise<number> {
  const traceIds = Array.from(
    new Set(
      params.traceIds
        .map((traceId) => traceId.trim())
        .filter((traceId) => traceId.length > 0),
    ),
  );
  if (traceIds.length === 0) return 0;
  try {
    const result = await prisma.agentEvaluation.deleteMany({
      where: {
        traceId: { in: traceIds },
        rubricVersion: params.rubricVersion,
      },
    });
    return result.count;
  } catch (error) {
    logger.warn({ error }, 'Failed to cleanup prior agent evaluations (non-fatal)');
    return 0;
  }
}
