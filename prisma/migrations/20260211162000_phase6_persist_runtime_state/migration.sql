CREATE TABLE "AgenticCanaryState" (
    "id" TEXT NOT NULL,
    "outcomesJson" JSONB NOT NULL,
    "cooldownUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgenticCanaryState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelHealthState" (
    "modelId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "samples" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelHealthState_pkey" PRIMARY KEY ("modelId")
);

CREATE INDEX "ModelHealthState_updatedAt_idx" ON "ModelHealthState"("updatedAt");
