-- CreateTable
CREATE TABLE "import_staging" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceFile" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "proposal" JSONB NOT NULL,
    "userOverrides" JSONB,
    "xlsxTempPath" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "import_staging_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_staging_organizationId_status_idx" ON "import_staging"("organizationId", "status");

-- CreateIndex
CREATE INDEX "import_staging_companyId_idx" ON "import_staging"("companyId");

-- CreateIndex
CREATE INDEX "import_staging_expiresAt_idx" ON "import_staging"("expiresAt");

-- AddForeignKey
ALTER TABLE "import_staging" ADD CONSTRAINT "import_staging_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_staging" ADD CONSTRAINT "import_staging_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_staging" ADD CONSTRAINT "import_staging_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
