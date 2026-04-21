-- AlterTable
ALTER TABLE "balance_sheet_lines" ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "budget_lines" ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "cash_flow_entries" ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "cogs_budget_lines" ADD COLUMN     "accountId" TEXT;

-- CreateIndex
CREATE INDEX "balance_sheet_lines_accountId_idx" ON "balance_sheet_lines"("accountId");

-- CreateIndex
CREATE INDEX "budget_lines_accountId_idx" ON "budget_lines"("accountId");

-- CreateIndex
CREATE INDEX "cash_flow_entries_accountId_idx" ON "cash_flow_entries"("accountId");

-- CreateIndex
CREATE INDEX "cogs_budget_lines_accountId_idx" ON "cogs_budget_lines"("accountId");

-- AddForeignKey
ALTER TABLE "cash_flow_entries" ADD CONSTRAINT "cash_flow_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cogs_budget_lines" ADD CONSTRAINT "cogs_budget_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_sheet_lines" ADD CONSTRAINT "balance_sheet_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
