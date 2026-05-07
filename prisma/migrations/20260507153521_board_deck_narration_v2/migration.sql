-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ai_board_deck_narration_run';

-- CreateTable
CREATE TABLE "board_deck_narrations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "paragraphs" TEXT[],
    "modelName" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_deck_narrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_deck_narrations_organizationId_period_idx" ON "board_deck_narrations"("organizationId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "board_deck_narrations_organizationId_period_snapshotHash_la_key" ON "board_deck_narrations"("organizationId", "period", "snapshotHash", "language");

-- AddForeignKey
ALTER TABLE "board_deck_narrations" ADD CONSTRAINT "board_deck_narrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
