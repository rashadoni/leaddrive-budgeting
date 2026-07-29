-- Phase 11.13 (2026-07-29) — persisted proof that an import run was clean.
--
-- Phase 11.2 made the post-write reconciliation real: every batch re-reads the
-- rows it just wrote, inside the same transaction, and the verdict now governs
-- whether the group commits. But that verdict lived only in the HTTP response.
-- A month later, "prove the July import was clean" could only be answered by
-- re-running the import — which no longer reproduces the same state.
--
-- Rows are written INSIDE the group transaction, so a report exists if and
-- only if the rows it describes were committed. Append-only by convention.

CREATE TABLE "import_batch_reports" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "runId"            TEXT NOT NULL,
  "fileType"         TEXT NOT NULL,
  "filenames"        TEXT[],
  "year"             INTEGER NOT NULL,
  "verdict"          TEXT NOT NULL,
  "evidence"         TEXT NOT NULL,
  "sheetsVerified"   INTEGER NOT NULL DEFAULT 0,
  "sheetsUnverified" INTEGER NOT NULL DEFAULT 0,
  "rowsInserted"     INTEGER NOT NULL DEFAULT 0,
  "committed"        BOOLEAN NOT NULL DEFAULT false,
  "report"           JSONB NOT NULL,
  "actorUserId"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "import_batch_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "import_batch_reports_organizationId_year_idx"
  ON "import_batch_reports" ("organizationId", "year");

CREATE INDEX "import_batch_reports_organizationId_runId_idx"
  ON "import_batch_reports" ("organizationId", "runId");

ALTER TABLE "import_batch_reports"
  ADD CONSTRAINT "import_batch_reports_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
