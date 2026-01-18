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

-- CreateIndex
CREATE INDEX "ChannelMessage_guildId_channelId_timestamp_idx" ON "ChannelMessage"("guildId", "channelId", "timestamp");
