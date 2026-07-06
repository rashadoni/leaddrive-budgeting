-- CreateEnum
CREATE TYPE "TradeAccrualMethod" AS ENUM ('on_invoice', 'retro_formula', 'payment_actual', 'free_goods', 'posm_merchandising', 'manual');

-- CreateEnum
CREATE TYPE "TradeImportKind" AS ENUM ('master_outlets', 'master_skus', 'master_reps', 'sales_invoice', 'spend_actual', 'campaign_master', 'allocation');

-- CreateEnum
CREATE TYPE "TradeImportStatus" AS ENUM ('preview', 'applied', 'superseded', 'failed', 'discarded');

-- CreateTable
CREATE TABLE "trade_regions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "trade_regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_channels" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "trade_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_sales_reps" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionId" TEXT,
    "channelId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "trade_sales_reps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_outlets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "chainCode" TEXT,
    "regionId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "salesRepId" TEXT,
    "counterpartyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "trade_outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_skus" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalCode" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "packageSize" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'ədəd',
    "productLineId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "trade_skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_spend_types" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "accrualMethod" "TradeAccrualMethod" NOT NULL,
    "formula" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_spend_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_import_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "TradeImportKind" NOT NULL,
    "sourceSystem" TEXT NOT NULL DEFAULT 'file',
    "sourceFile" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "sourceDate" TIMESTAMP(3),
    "status" "TradeImportStatus" NOT NULL DEFAULT 'preview',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "totals" JSONB NOT NULL DEFAULT '{}',
    "validation" JSONB NOT NULL DEFAULT '{}',
    "supersedesBatchId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "trade_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trade_regions_organizationId_deletedAt_idx" ON "trade_regions"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "trade_regions_organizationId_code_key" ON "trade_regions"("organizationId", "code");

-- CreateIndex
CREATE INDEX "trade_channels_organizationId_deletedAt_idx" ON "trade_channels"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "trade_channels_organizationId_code_key" ON "trade_channels"("organizationId", "code");

-- CreateIndex
CREATE INDEX "trade_sales_reps_organizationId_deletedAt_idx" ON "trade_sales_reps"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "trade_sales_reps_organizationId_externalCode_key" ON "trade_sales_reps"("organizationId", "externalCode");

-- CreateIndex
CREATE INDEX "trade_outlets_organizationId_regionId_channelId_salesRepId_idx" ON "trade_outlets"("organizationId", "regionId", "channelId", "salesRepId");

-- CreateIndex
CREATE INDEX "trade_outlets_organizationId_deletedAt_idx" ON "trade_outlets"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "trade_outlets_organizationId_externalCode_key" ON "trade_outlets"("organizationId", "externalCode");

-- CreateIndex
CREATE INDEX "trade_skus_organizationId_brand_category_idx" ON "trade_skus"("organizationId", "brand", "category");

-- CreateIndex
CREATE INDEX "trade_skus_productLineId_idx" ON "trade_skus"("productLineId");

-- CreateIndex
CREATE INDEX "trade_skus_organizationId_deletedAt_idx" ON "trade_skus"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "trade_skus_organizationId_externalCode_key" ON "trade_skus"("organizationId", "externalCode");

-- CreateIndex
CREATE INDEX "trade_spend_types_organizationId_isActive_idx" ON "trade_spend_types"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "trade_spend_types_organizationId_key_key" ON "trade_spend_types"("organizationId", "key");

-- CreateIndex
CREATE INDEX "trade_import_batches_organizationId_kind_sourceDate_isActiv_idx" ON "trade_import_batches"("organizationId", "kind", "sourceDate", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "trade_import_batches_organizationId_kind_sourceSystem_fileH_key" ON "trade_import_batches"("organizationId", "kind", "sourceSystem", "fileHash");

-- AddForeignKey
ALTER TABLE "trade_sales_reps" ADD CONSTRAINT "trade_sales_reps_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "trade_regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_sales_reps" ADD CONSTRAINT "trade_sales_reps_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "trade_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_outlets" ADD CONSTRAINT "trade_outlets_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "trade_regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_outlets" ADD CONSTRAINT "trade_outlets_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "trade_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_outlets" ADD CONSTRAINT "trade_outlets_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "trade_sales_reps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_skus" ADD CONSTRAINT "trade_skus_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES "product_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
