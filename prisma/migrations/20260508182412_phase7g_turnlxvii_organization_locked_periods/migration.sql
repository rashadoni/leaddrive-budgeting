-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "lockedPeriods" JSONB NOT NULL DEFAULT '[]';
