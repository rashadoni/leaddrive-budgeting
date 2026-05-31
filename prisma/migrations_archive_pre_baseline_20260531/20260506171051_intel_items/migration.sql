-- CreateTable
CREATE TABLE "intel_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "relevanceScore" DOUBLE PRECISION NOT NULL,
    "industryTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companyTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "dismissedBy" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "intel_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intel_items_organizationId_fetchedAt_idx" ON "intel_items"("organizationId", "fetchedAt" DESC);

-- CreateIndex
CREATE INDEX "intel_items_organizationId_relevanceScore_idx" ON "intel_items"("organizationId", "relevanceScore" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "intel_items_organizationId_urlHash_key" ON "intel_items"("organizationId", "urlHash");

-- AddForeignKey
ALTER TABLE "intel_items" ADD CONSTRAINT "intel_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
