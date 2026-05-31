-- AlterTable
ALTER TABLE "budget_plans" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" TEXT;
