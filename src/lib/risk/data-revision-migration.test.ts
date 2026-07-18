import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../prisma/migrations/20260718070000_data_revision_scope_guards/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const executableMigration = migration.replace(/--.*$/gm, '');

const roleProvisioning = readFileSync(
  new URL('../../../scripts/sql/create-app-role.sql', import.meta.url),
  'utf8',
);

describe('DataRevision scope-guard migration contract', () => {
  it('removes the custom-GUC bypass from DataRevision policies', () => {
    expect(executableMigration).not.toContain('app.bypass_rls');
    expect(executableMigration).toContain('CREATE POLICY tenant_isolation');
    expect(executableMigration).toContain('CREATE POLICY tenant_insert');
    expect(executableMigration).toContain('CREATE POLICY tenant_update');
    expect(executableMigration).not.toMatch(/CREATE POLICY[\s\S]*?FOR DELETE/);
    expect(executableMigration).not.toMatch(/CREATE POLICY[\s\S]*?FOR ALL/);
  });

  it('keeps request-role revisions append-only at policy and grant layers', () => {
    expect(executableMigration).not.toMatch(/FOR DELETE/);
    expect(roleProvisioning).toMatch(
      /REVOKE DELETE ON TABLE public\.data_revisions FROM budgetpro_app/,
    );
  });

  it('fails closed on legacy, cross-org and self supersession links', () => {
    expect(migration).toContain(
      'data_revisions contains self or cross-organization supersession links',
    );
    expect(migration).toContain(
      'data_revisions supersedesId must reference the same organization',
    );
    expect(migration).toContain('data_revisions cannot supersede itself');
    expect(migration).toContain(
      'predecessor."organizationId" = NEW."organizationId"',
    );
  });
});
