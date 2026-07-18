import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../prisma/migrations/20260718163000_ai_token_usage_guards/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const executableMigration = migration.replace(/--.*$/gm, '');
const roleProvisioning = readFileSync(
  new URL('../../../scripts/sql/create-app-role.sql', import.meta.url),
  'utf8',
);

describe('AI token usage RLS migration contract', () => {
  it('is atomic and fails closed on policy or counter drift', () => {
    const statements = executableMigration.trim();
    expect(statements).toMatch(/^BEGIN;/);
    expect(statements).toMatch(/COMMIT;$/);
    expect(executableMigration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(executableMigration).toContain("SET LOCAL statement_timeout = '30s'");
    expect(migration).toContain('unexpected policy');
    expect(migration).toContain('negative counters exist');
  });

  it('exposes exactly tenant SELECT without a custom-GUC bypass', () => {
    const policies =
      executableMigration
        .match(/CREATE POLICY[\s\S]*?;/g)
        ?.filter((statement) => statement.includes('ON public.ai_token_usage')) ?? [];
    expect(policies).toHaveLength(1);
    expect(policies[0]).toContain('FOR SELECT');
    expect(policies[0]).toContain('app.organization_id');
    expect(policies[0]).not.toContain('app.bypass_rls');
    expect(policies[0]).not.toMatch(/FOR (?:ALL|INSERT|UPDATE|DELETE)/);
  });

  it('adds a validated non-negative counter invariant', () => {
    expect(executableMigration).toContain(
      'CONSTRAINT ai_token_usage_nonnegative_counters_check',
    );
    expect(executableMigration).toContain('"tokensIn" >= 0');
    expect(executableMigration).toContain('"tokensOut" >= 0');
    expect(executableMigration).toContain('calls >= 0');
    expect(executableMigration).toContain('AND convalidated');
  });

  it('revokes all request-role DML while keeping native-admin correction semantics', () => {
    expect(roleProvisioning).toContain(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.ai_token_usage FROM budgetpro_app',
    );
    expect(executableMigration).not.toContain('CREATE TRIGGER');
    expect(executableMigration).not.toContain('BEFORE UPDATE');
  });

  it('does not mix other accounting or evidence tables into this slice', () => {
    expect(executableMigration).not.toContain('trade_spend_ledger');
    expect(executableMigration).not.toContain('audit_events');
    expect(executableMigration).not.toContain('period_snapshots');
  });
});
