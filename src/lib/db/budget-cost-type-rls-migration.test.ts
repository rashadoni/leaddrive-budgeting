import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../prisma/migrations/20260718190000_budget_cost_type_guards/migration.sql',
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
  'expense_forecasts',
];

describe('budget cost type RLS migration contract', () => {
  it('is atomic and fails closed on policy, FK, or historical data drift', () => {
    const statements = executableMigration.trim();
    expect(statements).toMatch(/^BEGIN;/);
    expect(statements).toMatch(/COMMIT;$/);
    expect(executableMigration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(executableMigration).toContain("SET LOCAL statement_timeout = '30s'");
    expect(executableMigration).toContain(
      'LOCK TABLE public.budget_cost_types',
    );
    expect(executableMigration).toContain('IN SHARE ROW EXCLUSIVE MODE');
    expect(migration).toContain('unexpected policy');
    expect(migration).toContain('unexpected foreign keys');
    expect(migration).toContain('cross-organization references exist');
    for (const table of consumers) {
      expect(executableMigration).toContain(`public.${table}`);
    }
  });

  it('replaces FOR ALL with exact tenant SELECT, INSERT, and UPDATE policies', () => {
    const policies =
      executableMigration
        .match(/CREATE POLICY[\s\S]*?;/g)
        ?.filter((statement) =>
          statement.includes('ON public.budget_cost_types'),
        ) ?? [];
    expect(policies).toHaveLength(3);
    const sql = policies.join('\n');
    expect(sql).toContain('FOR SELECT');
    expect(sql).toContain('FOR INSERT');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).not.toContain('app.bypass_rls');
    expect(sql).not.toMatch(/FOR (?:ALL|DELETE)/);
  });

  it('guards all five consumers and the paired reassignment race', () => {
    expect(executableMigration).toContain(
      'CREATE FUNCTION public.guard_budget_cost_type_reference_write()',
    );
    expect(executableMigration).toContain(
      'CREATE FUNCTION public.guard_budget_cost_type_reassignment()',
    );
    expect(executableMigration.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(
      executableMigration.match(/SET search_path = pg_catalog, public/g),
    ).toHaveLength(2);
    expect(
      executableMigration.match(/pg_advisory_xact_lock\(hashtextextended/g),
    ).toHaveLength(2);
    expect(executableMigration).toContain(
      'budget cost type reference must belong to the same organization',
    );
    expect(executableMigration).toContain(
      'referenced budget cost type cannot move across organizations',
    );
    expect(executableMigration.match(/CREATE TRIGGER/g)).toHaveLength(6);
  });

  it('denies request-role physical deletion and preserves legacy FK actions', () => {
    expect(roleProvisioning).toContain(
      'REVOKE DELETE ON TABLE public.budget_cost_types FROM budgetpro_app',
    );
    expect(executableMigration).not.toContain(
      'CREATE POLICY tenant_delete ON public.budget_cost_types',
    );
    expect(executableMigration).toContain(
      "'budget_lines_costTypeId_fkey', 'public.budget_lines'::regclass, 'n'",
    );
    expect(executableMigration).toContain(
      "'expense_forecasts_costTypeId_fkey', 'public.expense_forecasts'::regclass, 'c'",
    );
    expect(executableMigration).not.toMatch(
      /(?:DROP|ALTER) CONSTRAINT[^;]*costTypeId_fkey/,
    );
  });

  it('does not modify auth, department policy, or financial rows', () => {
    expect(executableMigration).not.toMatch(
      /(?:DROP|CREATE) POLICY[^;]*ON public\.users/,
    );
    expect(executableMigration).not.toMatch(
      /(?:DROP|CREATE) POLICY[^;]*ON public\.budget_departments/,
    );
    expect(executableMigration).not.toContain('passwordHash');
    expect(executableMigration).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:budget_lines|budget_actuals|expense_forecasts)/,
    );
  });
});
