import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../prisma/migrations/20260718153000_trade_spend_ledger_guards/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const executableMigration = migration.replace(/--.*$/gm, '');
const roleProvisioning = readFileSync(
  new URL('../../../scripts/sql/create-app-role.sql', import.meta.url),
  'utf8',
);

describe('trade spend ledger RLS migration contract', () => {
  it('is atomic and fails closed on catalog or data drift', () => {
    const statements = executableMigration.trim();
    expect(statements).toMatch(/^BEGIN;/);
    expect(statements).toMatch(/COMMIT;$/);
    expect(executableMigration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(executableMigration).toContain("SET LOCAL statement_timeout = '30s'");
    expect(migration).toContain('unexpected policy');
    expect(migration).toContain('partial void rows exist');
    expect(migration).toContain('orphan organization rows exist');
    expect(migration).toContain('cross-organization spend types exist');
  });

  it('splits the broad policy into exact SELECT, INSERT, and UPDATE policies', () => {
    const policies =
      executableMigration
        .match(/CREATE POLICY[\s\S]*?;/g)
        ?.filter((statement) => statement.includes('ON public.trade_spend_ledger')) ?? [];
    expect(policies).toHaveLength(3);
    const sql = policies.join('\n');
    expect(sql).toContain('FOR SELECT');
    expect(sql).toContain('FOR INSERT');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).not.toContain('app.bypass_rls');
    expect(sql).not.toMatch(/FOR (?:ALL|DELETE)/);
    expect(sql).toContain('"voidedAt" IS NULL');
    expect(sql).toContain('"voidedBy" IS NOT NULL');
  });

  it('adds organization ownership and same-org spend-type enforcement', () => {
    expect(executableMigration).toContain(
      'CONSTRAINT "trade_spend_ledger_organizationId_fkey"',
    );
    expect(executableMigration).toContain('ON DELETE CASCADE');
    expect(executableMigration).toContain('ON UPDATE RESTRICT');
    expect(executableMigration).toContain('SECURITY DEFINER');
    expect(executableMigration).toContain('SET search_path = pg_catalog, public');
    expect(executableMigration).toContain(
      'trade spend type must belong to the same organization',
    );
  });

  it('allows only an exact one-way void transition', () => {
    expect(executableMigration).toContain(
      "(to_jsonb(NEW) - 'voidedAt' - 'voidedBy') IS DISTINCT FROM",
    );
    expect(executableMigration).toContain('OLD."voidedAt" IS NOT NULL');
    expect(executableMigration).toContain('NEW."voidedAt" IS NULL');
    expect(executableMigration).toContain(
      'trade spend ledger permits only a one-way void transition',
    );
    expect(executableMigration).toContain(
      'trade spend ledger entries must be created unvoided',
    );
  });

  it('denies app DELETE and grants UPDATE only on the void columns', () => {
    expect(roleProvisioning).toContain(
      'REVOKE UPDATE, DELETE ON TABLE public.trade_spend_ledger FROM budgetpro_app',
    );
    expect(roleProvisioning).toContain(
      'GRANT UPDATE ("voidedAt", "voidedBy") ON TABLE public.trade_spend_ledger TO budgetpro_app',
    );
  });

  it('does not mix mutable AI accounting or other Trade tables into this slice', () => {
    expect(executableMigration).not.toContain('ai_token_usage');
    expect(executableMigration).not.toContain('trade_campaigns');
    expect(executableMigration).not.toContain('trade_invoices');
  });
});
