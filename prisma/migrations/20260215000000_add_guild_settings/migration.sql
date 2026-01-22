-- CreateTable
CREATE TABLE "GuildSetting" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuildSetting_guildId_key_key" ON "GuildSetting"("guildId", "key");

-- CreateIndex
CREATE INDEX "GuildSetting_guildId_updatedAt_idx" ON "GuildSetting"("guildId", "updatedAt");
