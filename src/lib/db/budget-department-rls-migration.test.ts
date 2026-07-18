import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../prisma/migrations/20260718180000_budget_department_guards/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const executableMigration = migration.replace(/--.*$/gm, '');
const roleProvisioning = readFileSync(
  new URL('../../../scripts/sql/create-app-role.sql', import.meta.url),
  'utf8',
);

const consumers = [
  'budget_lines',
  'budget_actuals',
  'budget_forecast_entries',
  'budget_direction_templates',
  'sales_forecasts',
  'expense_forecasts',
  'budget_department_owners',
];

describe('budget department RLS migration contract', () => {
  it('is atomic and fails closed on policy, FK, or historical data drift', () => {
    const statements = executableMigration.trim();
    expect(statements).toMatch(/^BEGIN;/);
    expect(statements).toMatch(/COMMIT;$/);
    expect(executableMigration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(executableMigration).toContain("SET LOCAL statement_timeout = '30s'");
    expect(executableMigration).toContain('LOCK TABLE public.users');
    expect(executableMigration).toContain('IN SHARE ROW EXCLUSIVE MODE');
    expect(migration).toContain('unexpected policy');
    expect(migration).toContain('unexpected foreign keys');
    expect(migration).toContain('cross-organization references exist');
    expect(migration).toContain('cross-organization owners exist');
    for (const table of consumers) {
      expect(executableMigration).toContain(`public.${table}`);
    }
  });

  it('replaces FOR ALL with exact tenant SELECT, INSERT, and UPDATE policies', () => {
    const policies =
      executableMigration
        .match(/CREATE POLICY[\s\S]*?;/g)
        ?.filter((statement) =>
          statement.includes('ON public.budget_departments'),
        ) ?? [];
    expect(policies).toHaveLength(3);
    const sql = policies.join('\n');
    expect(sql).toContain('FOR SELECT');
    expect(sql).toContain('FOR INSERT');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).not.toContain('app.bypass_rls');
    expect(sql).not.toMatch(/FOR (?:ALL|DELETE)/);
  });

  it('guards every department consumer and both reassignment races', () => {
    expect(executableMigration).toContain(
      'CREATE FUNCTION public.guard_budget_department_reference_write()',
    );
    expect(executableMigration).toContain(
      'CREATE FUNCTION public.guard_budget_department_owner_write()',
    );
    expect(executableMigration).toContain(
      'CREATE FUNCTION public.guard_budget_department_reassignment()',
    );
    expect(executableMigration).toContain(
      'CREATE FUNCTION public.guard_budget_department_owner_user_reassignment()',
    );
    expect(executableMigration.match(/SECURITY DEFINER/g)).toHaveLength(4);
    expect(
      executableMigration.match(/SET search_path = pg_catalog, public/g),
    ).toHaveLength(4);
    expect(executableMigration).toContain(
      'budget department reference must belong to the same organization',
    );
    expect(executableMigration).toContain(
      'department owner user must belong to the same organization',
    );
    expect(executableMigration).toContain(
      'referenced budget department cannot move across organizations',
    );
    expect(executableMigration).toContain(
      'department owner user cannot move across organizations',
    );
    expect(executableMigration.match(/CREATE TRIGGER/g)).toHaveLength(9);
    expect(
      executableMigration.match(/pg_advisory_xact_lock\(hashtextextended/g),
    ).toHaveLength(5);
  });

  it('denies request-role physical deletion while preserving soft-delete UPDATE', () => {
    expect(roleProvisioning).toContain(
      'REVOKE DELETE ON TABLE public.budget_departments FROM budgetpro_app',
    );
    expect(executableMigration).toContain('FOR UPDATE');
    expect(executableMigration).not.toContain(
      'CREATE POLICY tenant_delete ON public.budget_departments',
    );
    expect(executableMigration).not.toMatch(
      /(?:DROP|ALTER) CONSTRAINT[^;]*departmentId_fkey/,
    );
  });

  it('does not modify login, passwords, user RLS, or financial rows', () => {
    expect(executableMigration).not.toMatch(
      /(?:DROP|CREATE) POLICY[^;]*ON public\.users/,
    );
    expect(executableMigration).not.toContain('passwordHash');
    expect(executableMigration).not.toContain('organizationSlug');
    expect(executableMigration).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:budget_lines|budget_actuals|sales_forecasts|expense_forecasts)/,
    );
  });
});
