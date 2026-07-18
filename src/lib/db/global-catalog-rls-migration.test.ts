import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../prisma/migrations/20260718133000_global_catalog_rls_guards/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const executableMigration = migration.replace(/--.*$/gm, '');
const roleProvisioning = readFileSync(
  new URL('../../../scripts/sql/create-app-role.sql', import.meta.url),
  'utf8',
);
const retiredGenerator = readFileSync(
  new URL('../../../scripts/sql/gen-rls-migrations.sh', import.meta.url),
  'utf8',
);
const withOrgScopeSource = readFileSync(
  new URL('./with-org-scope.ts', import.meta.url),
  'utf8',
);

describe('global catalog RLS migration contract', () => {
  it('is atomic and fails closed on lock/catalog drift', () => {
    const statements = executableMigration.trim();
    expect(statements).toMatch(/^BEGIN;/);
    expect(statements).toMatch(/COMMIT;$/);
    expect(executableMigration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(migration).toContain('unexpected indicator_definitions policy');
    expect(migration).toContain('unexpected industries policy');
  });

  it('removes the custom-GUC bypass only from newly created policies', () => {
    const createdPolicies =
      executableMigration.match(/CREATE POLICY[\s\S]*?;/g)?.join('\n') ?? '';
    expect(createdPolicies).not.toContain('app.bypass_rls');
    expect(migration).toMatch(
      /remaining 67 ordinary GUC-bypass policies are separate reviewed cohorts/i,
    );
    expect(withOrgScopeSource).not.toContain(
      'SET LOCAL "app.bypass_rls"',
    );
    expect(retiredGenerator).not.toContain('app.bypass_rls');
  });

  it('keeps global definitions readable but limits writes to tenant overrides', () => {
    expect(executableMigration).toMatch(
      /CREATE POLICY tenant_isolation ON public\.indicator_definitions[\s\S]*?FOR SELECT[\s\S]*?"organizationId" IS NULL/,
    );
    for (const command of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(executableMigration).toMatch(
        new RegExp(
          `CREATE POLICY tenant_${command.toLowerCase()} ON public\\.indicator_definitions[\\s\\S]*?FOR ${command}`,
        ),
      );
    }
    expect(executableMigration).not.toMatch(
      /FOR (?:INSERT|UPDATE|DELETE)[\s\S]*?"organizationId" IS NULL/,
    );
  });

  it('makes industries request-role read-only at policy and grant layers', () => {
    expect(executableMigration).toMatch(
      /CREATE POLICY tenant_isolation ON public\.industries\s+FOR SELECT\s+USING \(true\)/,
    );
    expect(executableMigration).not.toMatch(
      /CREATE POLICY tenant_(?:insert|update|delete) ON public\.industries/,
    );
    expect(roleProvisioning).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.industries FROM budgetpro_app/,
    );
  });
});
