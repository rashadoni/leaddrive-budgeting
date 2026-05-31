-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "ApprovalRequestType" AS ENUM ('budget_line_create', 'budget_line_update', 'budget_line_delete', 'budget_actual_create', 'budget_actual_update', 'budget_actual_delete', 'period_unlock');

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT,
    "requestType" "ApprovalRequestType" NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "proposedChange" JSONB NOT NULL,
    "reason" TEXT,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'pending',
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_requests_organizationId_status_requestedAt_idx" ON "approval_requests"("organizationId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "approval_requests_planId_idx" ON "approval_requests"("planId");

-- CreateIndex
CREATE INDEX "approval_requests_requestedBy_idx" ON "approval_requests"("requestedBy");

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_planId_fkey" FOREIGN KEY ("planId") REFERENCES "budget_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
