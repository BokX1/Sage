CREATE EXTENSION IF NOT EXISTS vector;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

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
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "GuildMemory" (
    "guildId" TEXT NOT NULL,
    "memoryText" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByAdminId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildMemory_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "GuildMemoryArchive" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "memoryText" TEXT NOT NULL,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildMemoryArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingAdminAction" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "approvalMessageId" TEXT,
    "requestMessageId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "resultJson" JSONB,
    "errorText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingAdminAction_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "ModelHealthState" (
    "modelId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "samples" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelHealthState_pkey" PRIMARY KEY ("modelId")
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
CREATE INDEX "GuildMemoryArchive_guildId_createdAt_idx" ON "GuildMemoryArchive"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "PendingAdminAction_guildId_createdAt_idx" ON "PendingAdminAction"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "PendingAdminAction_status_expiresAt_idx" ON "PendingAdminAction"("status", "expiresAt");

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
CREATE INDEX "ModelHealthState_updatedAt_idx" ON "ModelHealthState"("updatedAt");

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
