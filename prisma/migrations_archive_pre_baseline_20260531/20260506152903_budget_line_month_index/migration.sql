-- AlterTable
ALTER TABLE "budget_lines" ADD COLUMN     "monthIndex" INTEGER;

-- CreateIndex
CREATE INDEX "budget_lines_planId_companyId_monthIndex_idx" ON "budget_lines"("planId", "companyId", "monthIndex");
