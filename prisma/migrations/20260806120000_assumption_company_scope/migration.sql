-- Phase 7.Q (2026-08-06) — a budget driver can belong to one company.
--
-- `budget_assumptions` is keyed to a PLAN, and a plan is org-scoped: companies
-- enter the model one level down, at `budget_lines.companyId`. So today an
-- assumption row is holding-wide by construction. For "inflation 6%" that is
-- correct. For "imported-input share" — the driver the scenario engine most
-- needs — it is wrong, because that number is 0.7 for a company that buys raw
-- sugar abroad and near 0 for a domestic logistics arm.
--
-- The consequence is visible in the product today. `crisis-catalog.ts` hard-codes
-- `assumedImportShare: 0.3` for every FX scenario, and the simulate route says so
-- out loud in the board narrative: "Assumes 30% imported-input share (current
-- data has no tagged imported costs)." A devaluation therefore hits all ~60
-- companies with one coefficient, and the "worst-hit" ranking it produces is an
-- artifact of that constant rather than a finding.
--
-- Two tiers, not a company-mandatory column:
--   companyId IS NULL  — the plan-level DEFAULT, applies to every company
--   companyId = X      — X's OVERRIDE, wins over the default for the same key
--
-- The alternative (make companyId NOT NULL) was rejected on maintenance
-- grounds: it turns one "inflation 6%" row into ~60 identical rows that must be
-- edited ~60 times when the assumption changes, which is precisely the burden
-- that has kept this table empty since it was created.
--
-- Nullable, no default, no backfill. Every one of the existing rows is a
-- plan-level default and NULL already says that correctly.
ALTER TABLE "budget_assumptions" ADD COLUMN "companyId" TEXT;

-- ON DELETE SET NULL, not CASCADE: deleting a company must not silently delete
-- the holding's assumption history. The row degrades to a plan-level default,
-- which is visible and correctable, rather than vanishing. This matches
-- `balance_sheet_lines.companyId`, the other nullable company FK in the schema.
--
-- ON UPDATE NO ACTION mirrors that same FK; company ids are cuids and are never
-- rewritten.
ALTER TABLE "budget_assumptions"
  ADD CONSTRAINT "budget_assumptions_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- The resolver's only hot query is "every row in this plan for this key, both
-- tiers, most specific wins" — see `resolveAssumption`. Leading with planId+key
-- lets one index serve it, and the trailing companyId keeps the two candidate
-- rows (default + override) adjacent instead of costing a heap lookup each.
CREATE INDEX "budget_assumptions_planId_key_companyId_idx"
  ON "budget_assumptions" ("planId", "key", "companyId");

-- Separate index for the delete path: `ON DELETE SET NULL` makes Postgres scan
-- the referencing side on every company deletion, and an unindexed FK turns
-- that into a seq scan of the whole table.
CREATE INDEX "budget_assumptions_companyId_idx"
  ON "budget_assumptions" ("companyId");

-- No UNIQUE on (planId, key, companyId), deliberately. It is the constraint the
-- two-tier read WANTS, but this table has never had one, so live data may
-- already hold duplicate keys — and a unique index that fails to build takes the
-- whole migration down on the client's database rather than in review. The
-- resolver is written to be total in the presence of duplicates (lowest
-- sortOrder, then oldest, wins) and logs when it has to make that choice.
-- Promoting this to a real constraint is owed once a dedupe pass has run
-- against production.
