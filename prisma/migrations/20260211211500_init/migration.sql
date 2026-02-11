-- CreateTable
CREATE TABLE "UserProfile" (
    "userId" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "pollinationsApiKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "GuildSettings" (
    "guildId" TEXT NOT NULL,
    "pollinationsApiKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "ChannelMessage" (
    "messageId" TEXT NOT NULL,
    "guildId" TEXT,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorDisplayName" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "replyToMessageId" TEXT,
    "mentionsUserIds" JSONB NOT NULL,
    "mentionsBot" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChannelMessage_pkey" PRIMARY KEY ("messageId")
);

-- CreateTable
CREATE TABLE "IngestedAttachment" (
    "id" TEXT NOT NULL,
    "guildId" TEXT,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "attachmentIndex" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "contentType" TEXT,
    "declaredSizeBytes" INTEGER,
    "readSizeBytes" INTEGER,
    "extractor" TEXT,
    "status" TEXT NOT NULL,
    "errorText" TEXT,
    "extractedText" TEXT,
    "extractedTextChars" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestedAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelSummary" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "summaryText" TEXT NOT NULL,
    "topicsJson" JSONB,
    "threadsJson" JSONB,
    "unresolvedJson" JSONB,
    "decisionsJson" JSONB,
    "actionItemsJson" JSONB,
    "sentiment" TEXT,
    "glossaryJson" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceSession" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipEdge" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userA" TEXT NOT NULL,
    "userB" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "featuresJson" JSONB NOT NULL,
    "manualOverride" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationshipEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAudit" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "paramsHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTrace" (
    "id" TEXT NOT NULL,
    "guildId" TEXT,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "routeKind" TEXT NOT NULL,
    "routerJson" JSONB NOT NULL,
    "expertsJson" JSONB NOT NULL,
    "agentGraphJson" JSONB,
    "agentEventsJson" JSONB,
    "qualityJson" JSONB,
    "budgetJson" JSONB,
    "toolJson" JSONB,
    "tokenJson" JSONB,
    "reasoningText" TEXT,
    "replyText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "AgenticCanaryState" (
    "id" TEXT NOT NULL,
    "outcomesJson" JSONB NOT NULL,
    "cooldownUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgenticCanaryState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelHealthState" (
    "modelId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "samples" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelHealthState_pkey" PRIMARY KEY ("modelId")
);

-- CreateIndex
CREATE INDEX "ChannelMessage_guildId_channelId_timestamp_idx" ON "ChannelMessage"("guildId", "channelId", "timestamp");

-- CreateIndex
CREATE INDEX "IngestedAttachment_guildId_channelId_createdAt_idx" ON "IngestedAttachment"("guildId", "channelId", "createdAt");

-- CreateIndex
CREATE INDEX "IngestedAttachment_channelId_createdAt_idx" ON "IngestedAttachment"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "IngestedAttachment_messageId_idx" ON "IngestedAttachment"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "IngestedAttachment_messageId_attachmentIndex_key" ON "IngestedAttachment"("messageId", "attachmentIndex");

-- CreateIndex
CREATE INDEX "ChannelSummary_guildId_channelId_updatedAt_idx" ON "ChannelSummary"("guildId", "channelId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelSummary_guildId_channelId_kind_key" ON "ChannelSummary"("guildId", "channelId", "kind");

-- CreateIndex
CREATE INDEX "VoiceSession_guildId_channelId_startedAt_idx" ON "VoiceSession"("guildId", "channelId", "startedAt");

-- CreateIndex
CREATE INDEX "VoiceSession_guildId_userId_startedAt_idx" ON "VoiceSession"("guildId", "userId", "startedAt");

-- CreateIndex
CREATE INDEX "VoiceSession_guildId_userId_endedAt_idx" ON "VoiceSession"("guildId", "userId", "endedAt");

-- CreateIndex
CREATE INDEX "RelationshipEdge_guildId_updatedAt_idx" ON "RelationshipEdge"("guildId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipEdge_guildId_userA_userB_key" ON "RelationshipEdge"("guildId", "userA", "userB");

-- CreateIndex
CREATE INDEX "AdminAudit_guildId_createdAt_idx" ON "AdminAudit"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentTrace_guildId_createdAt_idx" ON "AgentTrace"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentTrace_channelId_createdAt_idx" ON "AgentTrace"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentTrace_userId_createdAt_idx" ON "AgentTrace"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_traceId_createdAt_idx" ON "AgentRun"("traceId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_traceId_nodeId_idx" ON "AgentRun"("traceId", "nodeId");

-- CreateIndex
CREATE INDEX "AgentRun_agent_createdAt_idx" ON "AgentRun"("agent", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvaluation_traceId_createdAt_idx" ON "AgentEvaluation"("traceId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvaluation_guildId_createdAt_idx" ON "AgentEvaluation"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvaluation_channelId_createdAt_idx" ON "AgentEvaluation"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvaluation_routeKind_createdAt_idx" ON "AgentEvaluation"("routeKind", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvaluation_rubricVersion_createdAt_idx" ON "AgentEvaluation"("rubricVersion", "createdAt");

-- CreateIndex
CREATE INDEX "ModelHealthState_updatedAt_idx" ON "ModelHealthState"("updatedAt");

