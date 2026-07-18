import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../prisma/migrations/20260718143000_evidence_core_rls_guards/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const executableMigration = migration.replace(/--.*$/gm, '');
const roleProvisioning = readFileSync(
  new URL('../../../scripts/sql/create-app-role.sql', import.meta.url),
  'utf8',
);

describe('evidence-core RLS migration contract', () => {
  it('is atomic and fails closed on catalog drift', () => {
    const statements = executableMigration.trim();
    expect(statements).toMatch(/^BEGIN;/);
    expect(statements).toMatch(/COMMIT;$/);
    expect(executableMigration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(migration).toContain('unexpected policy on %');
  });

  it.each(['audit_events', 'period_snapshots'])(
    'splits %s into SELECT and INSERT without a custom GUC',
    (table) => {
      const tablePolicies =
        executableMigration
          .match(/CREATE POLICY[\s\S]*?;/g)
          ?.filter((statement) => statement.includes(`ON public.${table}`)) ?? [];
      expect(tablePolicies).toHaveLength(2);
      const sql = tablePolicies.join('\n');
      expect(sql).toContain('FOR SELECT');
      expect(sql).toContain('FOR INSERT');
      expect(sql).not.toContain('app.bypass_rls');
      expect(sql).not.toMatch(/FOR (?:ALL|UPDATE|DELETE)/);
    },
  );

  it('keeps app evidence append-only at the grant layer', () => {
    for (const table of ['audit_events', 'period_snapshots']) {
      expect(roleProvisioning).toMatch(
        new RegExp(
          `REVOKE UPDATE, DELETE ON TABLE public\\.${table} FROM budgetpro_app`,
        ),
      );
    }
  });

  it('makes snapshots update-immutable without replacing audit notifications', () => {
    expect(executableMigration).toContain(
      'CREATE TRIGGER period_snapshots_immutable_trg',
    );
    expect(executableMigration).toContain(
      'period_snapshots are immutable; create a new sign-off row',
    );
    expect(migration).toContain(
      "to_regprocedure('public.reject_period_snapshot_update()')",
    );
    expect(executableMigration).not.toMatch(
      /DROP TRIGGER[\s\S]*?audit_events_notify_trg/,
    );
    expect(migration).toContain("tgname = 'audit_events_notify_trg'");
  });

  it('does not mix Trade ledger or mutable AI accounting into this slice', () => {
    expect(executableMigration).not.toContain('trade_spend_ledger');
    expect(executableMigration).not.toContain('ai_token_usage');
  });
});
