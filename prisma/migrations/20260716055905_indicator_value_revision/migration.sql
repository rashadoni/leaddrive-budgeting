-- AlterTable
ALTER TABLE "indicator_values" ADD COLUMN     "revisionId" TEXT;

-- CreateIndex
CREATE INDEX "indicator_values_revisionId_idx" ON "indicator_values"("revisionId");

-- AddForeignKey
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "data_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
