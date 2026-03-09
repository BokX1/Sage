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

CREATE INDEX "DiscordInteractionSession_guildId_createdAt_idx" ON "DiscordInteractionSession"("guildId", "createdAt");
CREATE INDEX "DiscordInteractionSession_expiresAt_idx" ON "DiscordInteractionSession"("expiresAt");
