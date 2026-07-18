import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../prisma/migrations/20260718170000_user_layout_preference_guards/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const executableMigration = migration.replace(/--.*$/gm, '');

describe('user layout preference RLS migration contract', () => {
  it('is atomic and fails closed on catalog or ownership drift', () => {
    const statements = executableMigration.trim();
    expect(statements).toMatch(/^BEGIN;/);
    expect(statements).toMatch(/COMMIT;$/);
    expect(executableMigration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(executableMigration).toContain("SET LOCAL statement_timeout = '30s'");
    expect(executableMigration).toContain(
      'LOCK TABLE public.users, public.user_layout_preferences',
    );
    expect(executableMigration).toContain('IN SHARE ROW EXCLUSIVE MODE');
    expect(migration).toContain('unexpected policy');
    expect(migration).toContain('cross-organization users exist');
  });

  it('keeps exact tenant CRUD without a custom-GUC bypass', () => {
    const policies =
      executableMigration
        .match(/CREATE POLICY[\s\S]*?;/g)
        ?.filter((statement) =>
          statement.includes('ON public.user_layout_preferences'),
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

  it('enforces same-organization user ownership with fixed-search-path functions', () => {
    expect(executableMigration).toContain(
      'CREATE FUNCTION public.guard_user_layout_preference_write()',
    );
    expect(executableMigration).toContain(
      'CREATE FUNCTION public.guard_user_layout_user_reassignment()',
    );
    expect(executableMigration.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(
      executableMigration.match(/SET search_path = pg_catalog, public/g),
    ).toHaveLength(2);
    expect(
      executableMigration.match(/pg_advisory_xact_lock\(hashtextextended/g),
    ).toHaveLength(2);
    expect(executableMigration).toContain(
      'layout user must belong to the same organization',
    );
    expect(executableMigration).toContain(
      'user with saved layouts cannot be moved across organizations',
    );
  });

  it('does not alter the unresolved users policy or authentication contract', () => {
    expect(executableMigration).not.toMatch(
      /(?:DROP|CREATE) POLICY[^;]*ON public\.users/,
    );
    expect(executableMigration).not.toContain('passwordHash');
    expect(executableMigration).not.toContain('email');
    expect(executableMigration).not.toContain('organizationSlug');
  });

  it('does not mix company or financial configuration into this slice', () => {
    expect(executableMigration).not.toContain('companies');
    expect(executableMigration).not.toContain('budget_departments');
    expect(executableMigration).not.toContain('chart_of_accounts');
    expect(executableMigration).not.toContain('currencies');
  });
});
