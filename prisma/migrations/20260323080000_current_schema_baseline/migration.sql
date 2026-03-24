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
    "timezone" TEXT,
    "artifactVaultChannelId" TEXT,
    "modLogChannelId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "GuildChannelInvokePolicy" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'public_from_message',
    "autoArchiveDurationMinutes" INTEGER,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildChannelInvokePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostProviderAuth" (
    "provider" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT,
    "status" TEXT NOT NULL,
    "lastErrorText" TEXT,
    "refreshLeaseOwner" TEXT,
    "refreshLeaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostProviderAuth_pkey" PRIMARY KEY ("provider")
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
    "originChannelId" TEXT NOT NULL,
    "responseChannelId" TEXT NOT NULL,
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
    "activeUserInterruptJson" JSONB,
    "activeUserInterruptRevision" INTEGER NOT NULL DEFAULT 0,
    "activeUserInterruptConsumedRevision" INTEGER NOT NULL DEFAULT 0,
    "activeUserInterruptQueuedAt" TIMESTAMP(3),
    "activeUserInterruptConsumedAt" TIMESTAMP(3),
    "activeUserInterruptSupersededAt" TIMESTAMP(3),
    "activeUserInterruptSupersededRevision" INTEGER,
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
CREATE TABLE "DiscordArtifact" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "originChannelId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mediaKind" TEXT NOT NULL,
    "mimeType" TEXT,
    "descriptionText" TEXT,
    "latestRevisionNumber" INTEGER NOT NULL DEFAULT 0,
    "latestPublishedChannelId" TEXT,
    "latestPublishedMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordArtifactRevision" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceAttachmentId" TEXT,
    "sourceRevisionId" TEXT,
    "format" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "contentText" TEXT,
    "sizeBytes" INTEGER,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordArtifactRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordArtifactLink" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordArtifactLink_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "ModerationPolicy" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "descriptionText" TEXT,
    "family" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "ownership" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "externalRuleId" TEXT,
    "notifyChannelId" TEXT,
    "policySpecJson" JSONB NOT NULL,
    "compiledPolicyJson" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastConflictText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationCase" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "policyId" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lifecycleStatus" TEXT NOT NULL DEFAULT 'open',
    "action" TEXT NOT NULL,
    "targetUserId" TEXT,
    "sourceMessageId" TEXT,
    "channelId" TEXT,
    "reviewChannelId" TEXT,
    "createdByUserId" TEXT,
    "acknowledgedByUserId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "executedByUserId" TEXT,
    "resolutionReasonText" TEXT,
    "evidenceJson" JSONB,
    "metadataJson" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationCaseNote" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "noteText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationCaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledTask" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "cronExpr" TEXT,
    "runAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "skipUntil" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "payloadJson" JSONB NOT NULL,
    "provenanceJson" JSONB,
    "lastErrorText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledTaskRun" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorText" TEXT,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledTaskRun_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "GuildChannelInvokePolicy_guildId_channelId_key" ON "GuildChannelInvokePolicy"("guildId", "channelId");

-- CreateIndex
CREATE INDEX "GuildChannelInvokePolicy_guildId_updatedAt_idx" ON "GuildChannelInvokePolicy"("guildId", "updatedAt");

-- CreateIndex
CREATE INDEX "HostProviderAuth_status_updatedAt_idx" ON "HostProviderAuth"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "HostProviderAuth_refreshLeaseExpiresAt_idx" ON "HostProviderAuth"("refreshLeaseExpiresAt");

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
CREATE INDEX "AgentTaskRun_originChannelId_requestedByUserId_status_updatedAt_idx" ON "AgentTaskRun"("originChannelId", "requestedByUserId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentTaskRun_responseChannelId_requestedByUserId_status_updatedAt_idx" ON "AgentTaskRun"("responseChannelId", "requestedByUserId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentTaskRun_status_nextRunnableAt_idx" ON "AgentTaskRun"("status", "nextRunnableAt");

-- CreateIndex
CREATE INDEX "AgentTaskRun_leaseExpiresAt_idx" ON "AgentTaskRun"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AgentTaskRun_sourceMessageId_status_updatedAt_idx" ON "AgentTaskRun"("sourceMessageId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentTaskRun_waitingKind_responseChannelId_requestedByUserId_update_idx" ON "AgentTaskRun"("waitingKind", "responseChannelId", "requestedByUserId", "updatedAt");

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
CREATE INDEX "DiscordArtifact_guildId_updatedAt_idx" ON "DiscordArtifact"("guildId", "updatedAt");

-- CreateIndex
CREATE INDEX "DiscordArtifact_guildId_createdByUserId_updatedAt_idx" ON "DiscordArtifact"("guildId", "createdByUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "DiscordArtifactRevision_artifactId_createdAt_idx" ON "DiscordArtifactRevision"("artifactId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscordArtifactRevision_sourceAttachmentId_idx" ON "DiscordArtifactRevision"("sourceAttachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordArtifactRevision_artifactId_revisionNumber_key" ON "DiscordArtifactRevision"("artifactId", "revisionNumber");

-- CreateIndex
CREATE INDEX "DiscordArtifactLink_artifactId_createdAt_idx" ON "DiscordArtifactLink"("artifactId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscordArtifactLink_guildId_channelId_createdAt_idx" ON "DiscordArtifactLink"("guildId", "channelId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscordArtifactLink_messageId_idx" ON "DiscordArtifactLink"("messageId");

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
CREATE INDEX "ModerationPolicy_guildId_updatedAt_idx" ON "ModerationPolicy"("guildId", "updatedAt");

-- CreateIndex
CREATE INDEX "ModerationPolicy_guildId_family_updatedAt_idx" ON "ModerationPolicy"("guildId", "family", "updatedAt");

-- CreateIndex
CREATE INDEX "ModerationPolicy_guildId_ownership_updatedAt_idx" ON "ModerationPolicy"("guildId", "ownership", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationPolicy_guildId_name_key" ON "ModerationPolicy"("guildId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationPolicy_guildId_externalRuleId_key" ON "ModerationPolicy"("guildId", "externalRuleId");

-- CreateIndex
CREATE INDEX "ModerationCase_guildId_createdAt_idx" ON "ModerationCase"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationCase_guildId_targetUserId_createdAt_idx" ON "ModerationCase"("guildId", "targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationCase_guildId_sourceMessageId_createdAt_idx" ON "ModerationCase"("guildId", "sourceMessageId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationCase_policyId_createdAt_idx" ON "ModerationCase"("policyId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationCase_status_createdAt_idx" ON "ModerationCase"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationCase_guildId_lifecycleStatus_createdAt_idx" ON "ModerationCase"("guildId", "lifecycleStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationCaseNote_caseId_createdAt_idx" ON "ModerationCaseNote"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationCaseNote_guildId_createdAt_idx" ON "ModerationCaseNote"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledTask_guildId_createdAt_idx" ON "ScheduledTask"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledTask_guildId_status_nextRunAt_idx" ON "ScheduledTask"("guildId", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduledTask_leaseExpiresAt_idx" ON "ScheduledTask"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ScheduledTaskRun_taskId_createdAt_idx" ON "ScheduledTaskRun"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledTaskRun_status_scheduledFor_idx" ON "ScheduledTaskRun"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledTaskRun_taskId_dedupeKey_key" ON "ScheduledTaskRun"("taskId", "dedupeKey");

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
ALTER TABLE "DiscordArtifactRevision" ADD CONSTRAINT "DiscordArtifactRevision_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "DiscordArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscordArtifactLink" ADD CONSTRAINT "DiscordArtifactLink_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "DiscordArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscordArtifactLink" ADD CONSTRAINT "DiscordArtifactLink_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "DiscordArtifactRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ModerationPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationCaseNote" ADD CONSTRAINT "ModerationCaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledTaskRun" ADD CONSTRAINT "ScheduledTaskRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ScheduledTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessageEmbedding" ADD CONSTRAINT "ChannelMessageEmbedding_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChannelMessage"("messageId") ON DELETE CASCADE ON UPDATE CASCADE;

