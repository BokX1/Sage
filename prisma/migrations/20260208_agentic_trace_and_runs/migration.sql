-- Agentic trace schema upgrade
-- Adds dedicated agentic trace JSON fields and per-node execution table.

ALTER TABLE "AgentTrace"
  ADD COLUMN IF NOT EXISTS "agentGraphJson" JSONB,
  ADD COLUMN IF NOT EXISTS "agentEventsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "qualityJson" JSONB,
  ADD COLUMN IF NOT EXISTS "budgetJson" JSONB;

CREATE TABLE IF NOT EXISTS "AgentRun" (
  "id" TEXT NOT NULL,
  "traceId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "agent" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "latencyMs" INTEGER,
  "errorText" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgentRun_traceId_createdAt_idx"
  ON "AgentRun"("traceId", "createdAt");

CREATE INDEX IF NOT EXISTS "AgentRun_traceId_nodeId_idx"
  ON "AgentRun"("traceId", "nodeId");

CREATE INDEX IF NOT EXISTS "AgentRun_agent_createdAt_idx"
  ON "AgentRun"("agent", "createdAt");
