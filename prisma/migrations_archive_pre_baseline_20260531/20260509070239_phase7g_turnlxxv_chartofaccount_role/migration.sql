-- CreateEnum
CREATE TYPE "CoARole" AS ENUM ('revenue', 'cogs', 'opex', 'finance', 'tax_costs', 'non_operating', 'tax', 'unknown');

-- AlterTable
ALTER TABLE "chart_of_accounts" ADD COLUMN     "role" "CoARole";

-- Phase 7.G Turn LXXV (Phase 5.1) — backfill `role` for existing rows.
-- Mirrors `deriveRoleFromCode` in `src/lib/budgeting/coa-role.ts` (single
-- source of truth at the application layer; SQL backfill keeps DB and
-- code in lock-step at migration time). NULL leftovers are valid — they
-- mean "no canonical mapping" and consumers fall back to legacy `accountType`.
UPDATE "chart_of_accounts" SET "role" = CASE
  WHEN "code" LIKE '601%' OR "code" LIKE '611%' THEN 'revenue'::"CoARole"
  WHEN "code" LIKE '602%' OR "code" LIKE '603%' THEN 'revenue'::"CoARole"
  WHEN "code" LIKE '701%' THEN 'cogs'::"CoARole"
  WHEN "code" LIKE '711%' OR "code" LIKE '721%' THEN 'opex'::"CoARole"
  WHEN "code" LIKE '731%' THEN 'finance'::"CoARole"
  WHEN "code" LIKE '741%' THEN 'tax_costs'::"CoARole"
  WHEN "code" LIKE '751%' OR "code" LIKE '761%' OR "code" LIKE '771%' THEN 'non_operating'::"CoARole"
  WHEN "code" LIKE '801%' THEN 'tax'::"CoARole"
  ELSE 'unknown'::"CoARole"
END;
