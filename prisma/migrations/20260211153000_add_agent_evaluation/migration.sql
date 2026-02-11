CREATE TABLE "AgentEvaluation" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "guildId" TEXT,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "routeKind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "rubricVersion" TEXT NOT NULL,
    "primaryJudgeModel" TEXT NOT NULL,
    "secondaryJudgeModel" TEXT NOT NULL,
    "adjudicatorJudgeModel" TEXT,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "verdict" TEXT NOT NULL,
    "disagreement" BOOLEAN NOT NULL,
    "arbitrationUsed" BOOLEAN NOT NULL,
    "judgeAgreement" BOOLEAN NOT NULL,
    "dimensionScoresJson" JSONB NOT NULL,
    "issuesJson" JSONB NOT NULL,
    "summaryText" TEXT,
    "judgeJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentEvaluation_traceId_createdAt_idx" ON "AgentEvaluation"("traceId", "createdAt");
CREATE INDEX "AgentEvaluation_guildId_createdAt_idx" ON "AgentEvaluation"("guildId", "createdAt");
CREATE INDEX "AgentEvaluation_channelId_createdAt_idx" ON "AgentEvaluation"("channelId", "createdAt");
CREATE INDEX "AgentEvaluation_routeKind_createdAt_idx" ON "AgentEvaluation"("routeKind", "createdAt");
CREATE INDEX "AgentEvaluation_rubricVersion_createdAt_idx" ON "AgentEvaluation"("rubricVersion", "createdAt");
