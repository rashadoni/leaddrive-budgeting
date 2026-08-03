-- Persist deployment-wide source-registry metadata outside the container
-- filesystem. The HTTP route uses the BYPASSRLS admin client; regular request
-- roles receive no policy and therefore cannot access this global table.
CREATE TABLE "source_registry_entries" (
    "company_code" TEXT NOT NULL,
    "xlsx" TEXT NOT NULL,
    "sheet" TEXT,
    "period" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_registry_entries_pkey" PRIMARY KEY ("company_code")
);

ALTER TABLE "source_registry_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_registry_entries" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "source_registry_entries" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'budgetpro_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "source_registry_entries" TO budgetpro_admin;
  END IF;
END
$$;
