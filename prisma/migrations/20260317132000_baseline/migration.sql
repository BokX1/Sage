-- Baseline rebuild for Sage's current schema.
-- This baseline is intended for fresh environments and deliberate hard resets.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- pgvector is required before creating vector-typed columns.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

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
CREATE TABLE "UserProfileArchive" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserProfileArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildSettings" (
    "guildId" TEXT NOT NULL,
    "pollinationsApiKey" TEXT,
    "approvalReviewChannelId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "ServerInstructions" (
    "guildId" TEXT NOT NULL,
    "instructionsText" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByAdminId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerInstructions_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "ServerInstructionsArchive" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "instructionsText" TEXT NOT NULL,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerInstructionsArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalReviewRequest" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "originTraceId" TEXT NOT NULL,
    "resumeTraceId" TEXT,
    "guildId" TEXT NOT NULL,
    "sourceChannelId" TEXT NOT NULL,
    "reviewChannelId" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "requesterStatusMessageId" TEXT,
    "reviewerMessageId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "executionPayloadJson" JSONB NOT NULL,
    "reviewSnapshotJson" JSONB NOT NULL,
    "interruptMetadataJson" JSONB,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "resultJson" JSONB,
    "decisionReasonText" TEXT,
    "errorText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordInteractionSession" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordInteractionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTaskRun" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "originTraceId" TEXT NOT NULL,
    "latestTraceId" TEXT NOT NULL,
    "guildId" TEXT,
    "channelId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "responseMessageId" TEXT,
    "status" TEXT NOT NULL,
    "waitingKind" TEXT,
    "latestDraftText" TEXT NOT NULL,
    "draftRevision" INTEGER NOT NULL DEFAULT 0,
    "completionKind" TEXT,
    "stopReason" TEXT,
    "nextRunnableAt" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "resumeCount" INTEGER NOT NULL DEFAULT 0,
    "taskWallClockMs" INTEGER NOT NULL DEFAULT 0,
    "maxTotalDurationMs" INTEGER NOT NULL,
    "maxIdleWaitMs" INTEGER NOT NULL,
    "lastErrorText" TEXT,
    "responseSessionJson" JSONB,
    "waitingStateJson" JSONB,
    "compactionStateJson" JSONB,
    "checkpointMetadataJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTaskRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMessage" (
    "messageId" TEXT NOT NULL,
    "guildId" TEXT,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorDisplayName" TEXT NOT NULL,
    "authorIsBot" BOOLEAN NOT NULL DEFAULT false,
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
CREATE TABLE "VoiceConversationSummary" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "voiceChannelId" TEXT NOT NULL,
    "voiceChannelName" TEXT,
    "initiatedByUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "speakerStatsJson" JSONB NOT NULL,
    "summaryText" TEXT NOT NULL,
    "topicsJson" JSONB,
    "threadsJson" JSONB,
    "decisionsJson" JSONB,
    "actionItemsJson" JSONB,
    "unresolvedJson" JSONB,
    "sentiment" TEXT,
    "glossaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceConversationSummary_pkey" PRIMARY KEY ("id")
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
    "threadId" TEXT,
    "parentTraceId" TEXT,
    "graphStatus" TEXT,
    "approvalRequestId" TEXT,
    "terminationReason" TEXT,
    "langSmithRunId" TEXT,
    "langSmithTraceId" TEXT,
    "budgetJson" JSONB,
    "toolJson" JSONB,
    "tokenJson" JSONB,
    "replyText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttachmentChunk" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "embedding" vector(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttachmentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMessageEmbedding" (
    "messageId" TEXT NOT NULL,
    "guildId" TEXT,
    "channelId" TEXT NOT NULL,
    "embedding" vector(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMessageEmbedding_pkey" PRIMARY KEY ("messageId")
);

-- CreateIndex
CREATE INDEX "UserProfileArchive_userId_createdAt_idx" ON "UserProfileArchive"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ServerInstructionsArchive_guildId_createdAt_idx" ON "ServerInstructionsArchive"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalReviewRequest_threadId_createdAt_idx" ON "ApprovalReviewRequest"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalReviewRequest_originTraceId_createdAt_idx" ON "ApprovalReviewRequest"("originTraceId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalReviewRequest_guildId_createdAt_idx" ON "ApprovalReviewRequest"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalReviewRequest_status_expiresAt_idx" ON "ApprovalReviewRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ApprovalReviewRequest_reviewChannelId_createdAt_idx" ON "ApprovalReviewRequest"("reviewChannelId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalReviewRequest_requestedBy_kind_dedupeKey_status_exp_idx" ON "ApprovalReviewRequest"("requestedBy", "kind", "dedupeKey", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "DiscordInteractionSession_guildId_createdAt_idx" ON "DiscordInteractionSession"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscordInteractionSession_expiresAt_idx" ON "DiscordInteractionSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTaskRun_threadId_key" ON "AgentTaskRun"("threadId");

-- CreateIndex
CREATE INDEX "AgentTaskRun_channelId_requestedByUserId_status_updatedAt_idx" ON "AgentTaskRun"("channelId", "requestedByUserId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentTaskRun_status_nextRunnableAt_idx" ON "AgentTaskRun"("status", "nextRunnableAt");

-- CreateIndex
CREATE INDEX "AgentTaskRun_leaseExpiresAt_idx" ON "AgentTaskRun"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AgentTaskRun_waitingKind_channelId_requestedByUserId_update_idx" ON "AgentTaskRun"("waitingKind", "channelId", "requestedByUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChannelMessage_guildId_channelId_timestamp_idx" ON "ChannelMessage"("guildId", "channelId", "timestamp");

-- CreateIndex
CREATE INDEX "ChannelMessage_guildId_channelId_authorIsBot_timestamp_idx" ON "ChannelMessage"("guildId", "channelId", "authorIsBot", "timestamp");

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
CREATE INDEX "VoiceConversationSummary_guildId_endedAt_idx" ON "VoiceConversationSummary"("guildId", "endedAt");

-- CreateIndex
CREATE INDEX "VoiceConversationSummary_guildId_voiceChannelId_endedAt_idx" ON "VoiceConversationSummary"("guildId", "voiceChannelId", "endedAt");

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
CREATE INDEX "AgentTrace_threadId_createdAt_idx" ON "AgentTrace"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentTrace_approvalRequestId_createdAt_idx" ON "AgentTrace"("approvalRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentTrace_langSmithTraceId_createdAt_idx" ON "AgentTrace"("langSmithTraceId", "createdAt");

-- CreateIndex
CREATE INDEX "AttachmentChunk_attachmentId_idx" ON "AttachmentChunk"("attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AttachmentChunk_attachmentId_chunkIndex_key" ON "AttachmentChunk"("attachmentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "ChannelMessageEmbedding_channelId_idx" ON "ChannelMessageEmbedding"("channelId");

-- CreateIndex
CREATE INDEX "ChannelMessageEmbedding_guildId_channelId_idx" ON "ChannelMessageEmbedding"("guildId", "channelId");

-- AddForeignKey
ALTER TABLE "UserProfileArchive" ADD CONSTRAINT "UserProfileArchive_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessageEmbedding" ADD CONSTRAINT "ChannelMessageEmbedding_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChannelMessage"("messageId") ON DELETE CASCADE ON UPDATE CASCADE;
