-- AlterTable
ALTER TABLE "cash_flow_entries" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "cash_flow_entries_companyId_idx" ON "cash_flow_entries"("companyId");

-- CreateIndex
CREATE INDEX "cash_flow_entries_companyId_year_month_idx" ON "cash_flow_entries"("companyId", "year", "month");

-- AddForeignKey
ALTER TABLE "cash_flow_entries" ADD CONSTRAINT "cash_flow_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
