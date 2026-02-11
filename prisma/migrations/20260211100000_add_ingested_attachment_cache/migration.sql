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

CREATE UNIQUE INDEX "IngestedAttachment_messageId_attachmentIndex_key" ON "IngestedAttachment"("messageId", "attachmentIndex");
CREATE INDEX "IngestedAttachment_guildId_channelId_createdAt_idx" ON "IngestedAttachment"("guildId", "channelId", "createdAt");
CREATE INDEX "IngestedAttachment_channelId_createdAt_idx" ON "IngestedAttachment"("channelId", "createdAt");
CREATE INDEX "IngestedAttachment_messageId_idx" ON "IngestedAttachment"("messageId");
