-- Phase 11.8b (2026-07-29) — "one row per source CELL", enforced in the database.
--
-- What this is a backstop for
-- ───────────────────────────
-- The primary guard against a concurrent double-import is the advisory lock
-- (11.8, src/lib/onboarding/import-lock.ts). This index catches the case that
-- lock cannot: a write path added later that never takes it.
--
-- Why the predicate is a KEY-FORMAT test and not a date
-- ────────────────────────────────────────────────────
-- `sourceDocument` carries the adapter's `sourceCell`. It used to be
--
--     multi-import#<sheet>!<code>@<period>
--
-- i.e. keyed on the ACCOUNT CODE. A workbook listing the same code on several
-- rows — measured on production, PLF.07.02.04 appears up to 3× in the 2025 PLF
-- sheet — produced ONE key for genuinely different rows. Those 19 rows are not
-- duplicates: 0 of the 16 groups have identical amounts, so nothing is
-- double-counted and nothing should be deleted. They are real data under a key
-- that cannot identify them.
--
-- 11.8b fixed the format going forward — it now carries the row ordinal:
--
--     multi-import#<sheet>!<code>#<ordinal>@<period>
--
-- So the honest predicate is "enforce uniqueness on keys that actually identify
-- a cell". Two properties a `createdAt > '<date>'` cutoff would not have:
--
--   • no magic constant standing in for a real distinction;
--   • it SELF-HEALS. When those entities are re-imported the rows gain an
--     ordinal and come under the index automatically — no second migration and
--     no permanent exemption. A date cutoff would exempt them forever.
--
-- Measured on production immediately before this migration was written
-- (deploy/check-duplicate-rows.sh): 5104 live rows, ALL legacy-format, 0
-- ordinal-bearing, and 0 violations among ordinal-bearing keys. So the index is
-- creatable now and starts empty.
--
-- Partial on `deletedAt IS NULL` for the same reason as 11.4: soft-deleted rows
-- are historical and may legitimately repeat a key a live row now holds.
--
-- Plain CREATE INDEX, not CONCURRENTLY: `budget_lines` holds ~5k rows, so the
-- brief write lock is sub-second — and Prisma runs each migration inside a
-- transaction, where CONCURRENTLY is not permitted anyway.

DO $$
DECLARE
  dupe_count integer;
  dupe_detail text;
BEGIN
  SELECT count(*), coalesce(string_agg(detail, '; '), '')
    INTO dupe_count, dupe_detail
  FROM (
    -- Quoted camelCase is mandatory: Postgres folds unquoted identifiers to
    -- lower case, so "planId" would be looked up as planid and this would die
    -- on "column does not exist" instead of doing its job.
    SELECT format('plan=%s key=%s rows=%s',
                  "planId", "sourceDocument", count(*)) AS detail
    FROM budget_lines
    WHERE "deletedAt" IS NULL
      AND "sourceDocument" IS NOT NULL
      AND "sourceDocument" ~ '#[0-9]+@[0-9]{4}-[0-9]{2}$'
    GROUP BY "planId", "sourceDocument"
    HAVING count(*) > 1
  ) d;

  IF dupe_count > 0 THEN
    RAISE EXCEPTION
      'Phase 11.8b: % ordinal-keyed (planId, sourceDocument) group(s) already violate this index. Each is ONE workbook cell that produced more than one row — a genuine double-write, unlike the legacy code-keyed rows this predicate deliberately excludes. Investigate before forcing: %',
      dupe_count, dupe_detail;
  END IF;
END $$;

CREATE UNIQUE INDEX "budget_lines_plan_source_cell_key"
  ON "budget_lines" ("planId", "sourceDocument")
  WHERE "deletedAt" IS NULL
    AND "sourceDocument" IS NOT NULL
    AND "sourceDocument" ~ '#[0-9]+@[0-9]{4}-[0-9]{2}$';
