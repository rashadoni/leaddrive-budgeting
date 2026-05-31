-- Phase 7.E hardening (Turn 10): Company.role String → enum CompanyRole.
-- Hand-written (not `prisma migrate dev`) so existing data is preserved
-- via USING cast — Prisma's auto-diff would drop & recreate the column.
-- Pre-existing rows: 'operational' (default for all seeded), 'admin'
-- (ATL-MRKZ marked in Turn 9). All values map cleanly to enum members.

-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('operational', 'admin', 'holding');

-- AlterTable: cast existing String values into the new enum without data loss.
-- Drop default first (Postgres requires the column not have an incompatible
-- default during the type change), cast, then re-attach the default.
ALTER TABLE "companies" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "companies"
  ALTER COLUMN "role" TYPE "CompanyRole" USING "role"::"CompanyRole";
ALTER TABLE "companies" ALTER COLUMN "role" SET DEFAULT 'operational';
