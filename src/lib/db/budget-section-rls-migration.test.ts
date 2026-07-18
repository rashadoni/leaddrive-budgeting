import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../prisma/migrations/20260718210000_budget_section_guards/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const executableMigration = migration.replace(/--.*$/gm, '');

describe('budget section RLS migration contract', () => {
  it('is atomic and fails closed on policy, FK, data, or guard drift', () => {
    const statements = executableMigration.trim();
    expect(statements).toMatch(/^BEGIN;/);
    expect(statements).toMatch(/COMMIT;$/);
    expect(executableMigration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(executableMigration).toContain(
      "SET LOCAL statement_timeout = '30s'",
    );
    expect(executableMigration).toContain(
      'LOCK TABLE public."Organization", public.budget_plans, public.budget_sections',
    );
    expect(migration).toContain('unexpected policy');
    expect(migration).toContain('unexpected foreign keys');
    expect(migration).toContain(
      'orphan or cross-organization references exist',
    );
    expect(migration).toContain('guards already exist');
  });

  it('keeps exact tenant CRUD without a custom-GUC bypass', () => {
    const policies =
      executableMigration
        .match(/CREATE POLICY[\s\S]*?;/g)
        ?.filter((statement) =>
          statement.includes('ON public.budget_sections'),
        ) ?? [];
    expect(policies).toHaveLength(4);
    const sql = policies.join('\n');
    expect(sql).toContain('FOR SELECT');
    expect(sql).toContain('FOR INSERT');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('FOR DELETE');
    expect(sql).not.toContain('app.bypass_rls');
    expect(sql).not.toContain('FOR ALL');
  });

  it('adds only the missing cascading Organization FK', () => {
    const foreignKeys =
      executableMigration.match(
        /ADD CONSTRAINT[\s\S]*?FOREIGN KEY[\s\S]*?;/g,
      ) ?? [];
    expect(foreignKeys).toHaveLength(1);
    expect(foreignKeys[0]).toContain(
      '"budget_sections_organizationId_fkey"',
    );
    expect(foreignKeys[0]).toContain('REFERENCES public."Organization"(id)');
    expect(foreignKeys[0]).toContain('ON UPDATE CASCADE ON DELETE CASCADE');
    expect(executableMigration).toContain("'budget_sections_planId_fkey'");
    expect(executableMigration).toContain(
      "'budget_plans_organizationId_fkey'",
    );
  });

  it('enforces same-organization plans with paired fixed-path locks', () => {
    expect(executableMigration).toContain(
      'CREATE FUNCTION public.guard_budget_section_plan_write()',
    );
    expect(executableMigration).toContain(
      'CREATE FUNCTION public.guard_budget_section_plan_reassignment()',
    );
    expect(executableMigration.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(
      executableMigration.match(/SET search_path = pg_catalog, public/g),
    ).toHaveLength(2);
    expect(
      executableMigration.match(
        /pg_advisory_xact_lock\(hashtextextended\([\s\S]*?, 2\)\)/g,
      ),
    ).toHaveLength(2);
    expect(executableMigration).toContain(
      'budget section plan must belong to the same organization',
    );
    expect(executableMigration).toContain(
      'plan with budget sections cannot move across organizations',
    );
  });

  it('preserves plan and tenant cascade deletion', () => {
    expect(executableMigration).not.toMatch(/BEFORE DELETE/);
    expect(executableMigration).not.toMatch(/FOR DELETE[\s\S]*?WITH CHECK/);
    expect(executableMigration).not.toMatch(
      /ALTER TABLE[\s\S]*DROP CONSTRAINT "budget_sections_planId_fkey"/,
    );
    expect(executableMigration).toContain(
      "AND confdeltype = 'c'",
    );
  });

  it('does not change auth, users RLS, credentials, or existing data', () => {
    expect(executableMigration).not.toMatch(
      /(?:DROP|CREATE) POLICY[^;]*ON public\.users/,
    );
    expect(executableMigration).not.toContain('passwordHash');
    expect(executableMigration).not.toContain('organizationSlug');
    expect(executableMigration).not.toMatch(
      /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.(?:budget_sections|budget_plans)/,
    );
  });
});
