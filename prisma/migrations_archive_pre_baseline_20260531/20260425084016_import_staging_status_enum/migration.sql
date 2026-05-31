/*
  Warnings:

  - The `status` column on the `import_staging` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "ImportStagingStatus" AS ENUM ('pending', 'applied', 'discarded', 'expired');

-- AlterTable
ALTER TABLE "import_staging" DROP COLUMN "status",
ADD COLUMN     "status" "ImportStagingStatus" NOT NULL DEFAULT 'pending';

-- CreateIndex
CREATE INDEX "import_staging_organizationId_status_idx" ON "import_staging"("organizationId", "status");
