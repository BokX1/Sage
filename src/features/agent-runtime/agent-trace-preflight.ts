import { prisma } from '../../platform/db/prisma-client';

const AGENT_TRACE_SCHEMA_PROBE_SQL = `
  SELECT
    "id",
    "guildId",
    "channelId",
    "userId",
    "threadId",
    "parentTraceId",
    "graphStatus",
    "approvalRequestId",
    "interruptJson",
    "routeKind",
    "agentEventsJson",
    "qualityJson",
    "budgetJson",
    "toolJson",
    "tokenJson",
    "replyText",
    "createdAt"
  FROM "AgentTrace"
  LIMIT 1
`;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return String(error);
}

export async function assertAgentTraceSchemaReady(): Promise<void> {
  try {
    await prisma.$queryRawUnsafe(AGENT_TRACE_SCHEMA_PROBE_SQL);
  } catch (error) {
    throw new Error(
      `AgentTrace schema preflight failed. Run database migrations before startup. Cause: ${toErrorMessage(error)}`,
      { cause: error },
    );
  }
}
