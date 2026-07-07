-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "messageKey" TEXT,
ADD COLUMN     "messageParams" JSONB;

