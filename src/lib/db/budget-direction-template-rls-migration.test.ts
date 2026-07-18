import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../prisma/migrations/20260718200000_budget_direction_template_guards/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const executableMigration = migration.replace(/--.*$/gm, "");

describe("budget direction template RLS migration contract", () => {
  it("is atomic and fails closed on policy, FK, data, or guard drift", () => {
    const statements = executableMigration.trim();
    expect(statements).toMatch(/^BEGIN;/);
    expect(statements).toMatch(/COMMIT;$/);
    expect(executableMigration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(executableMigration).toContain(
      "SET LOCAL statement_timeout = '30s'",
    );
    expect(executableMigration).toContain('LOCK TABLE public."Organization"');
    expect(migration).toContain("unexpected policy");
    expect(migration).toContain("unexpected foreign keys");
    expect(migration).toContain(
      "orphan or cross-organization references exist",
    );
    expect(migration).toContain("predecessor guards missing");
  });

  it("keeps exact tenant CRUD without a custom-GUC bypass", () => {
    const policies =
      executableMigration
        .match(/CREATE POLICY[\s\S]*?;/g)
        ?.filter((statement) =>
          statement.includes("ON public.budget_direction_templates"),
        ) ?? [];
    expect(policies).toHaveLength(4);
    const sql = policies.join("\n");
    expect(sql).toContain("FOR SELECT");
    expect(sql).toContain("FOR INSERT");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("FOR DELETE");
    expect(sql).not.toContain("app.bypass_rls");
    expect(sql).not.toContain("FOR ALL");
  });

  it("adds only the missing cascading Organization FK", () => {
    const foreignKeys =
      executableMigration.match(
        /ADD CONSTRAINT[\s\S]*?FOREIGN KEY[\s\S]*?;/g,
      ) ?? [];
    expect(foreignKeys).toHaveLength(1);
    expect(foreignKeys[0]).toContain(
      '"budget_direction_templates_organizationId_fkey"',
    );
    expect(foreignKeys[0]).toContain('REFERENCES public."Organization"(id)');
    expect(foreignKeys[0]).toContain("ON UPDATE CASCADE ON DELETE CASCADE");
    expect(executableMigration).toContain(
      "'budget_direction_templates_departmentId_fkey'",
    );
    expect(executableMigration).toContain(
      "'budget_direction_templates_costTypeId_fkey'",
    );
  });

  it("requires both existing fixed-path reference guards", () => {
    expect(executableMigration).toContain(
      "budget_direction_template_department_guard_trg",
    );
    expect(executableMigration).toContain(
      "budget_direction_template_cost_type_guard_trg",
    );
    expect(executableMigration).toContain(
      "pg_proc.proconfig = ARRAY['search_path=pg_catalog, public']",
    );
    expect(executableMigration).not.toContain("CREATE FUNCTION");
    expect(executableMigration).not.toContain("CREATE TRIGGER");
  });

  it("does not change auth, users RLS, credentials, or financial rows", () => {
    expect(executableMigration).not.toMatch(
      /(?:DROP|CREATE) POLICY[^;]*ON public\.users/,
    );
    expect(executableMigration).not.toContain("passwordHash");
    expect(executableMigration).not.toContain("organizationSlug");
    expect(executableMigration).not.toMatch(
      /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.budget_direction_templates/,
    );
  });
});
