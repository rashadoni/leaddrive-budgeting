/**
 * Phase 7.G Turn XXXIV — live trigger E2E for `import_staging_expired`
 * audit emission (closes CARRYOVER L426 row 13, ~96t developer-owned).
 *
 * Closure path documented in the row text: the audit-action enum value
 * `import_staging_expired` was previously only handler-mocked (Turn 21
 * unit tests in `staging/[id]/handler.test.ts:96` + `apply/handler.test.ts:98`).
 * The live HTTP-route emission was never end-to-end verified at runtime,
 * leaving the 5/5 enum coverage 1 short.
 *
 * What this spec proves:
 *   1. Real HTTP GET against the running dev server invokes the route's
 *      lazy-flip + audit-emit code path (NOT just the unit-tested
 *      handler in isolation).
 *   2. The audit_event row actually lands in Postgres after the GET
 *      returns 410 — proves the `logAuditEvent` Prisma write fires
 *      end-to-end through the route's `await import('@/lib/audit/log')`
 *      dynamic import.
 *
 * Self-fixturing design: the spec creates its own fresh expired
 * staging row each run (`expiresAt = new Date(0)` = 1970, guaranteed
 * past). This eliminates the silent-coverage-gap risk an earlier
 * skip-when-empty design carried (architect Turn-XXXIV Suggestion
 * applied inline). The spec now runs unconditionally on every CI
 * pass, and each run leaves exactly one audit_event row + one
 * expired ImportStaging row behind — both valid post-state, no
 * cleanup required.
 *
 * Pre-conditions (mirror existing specs in this dir):
 *   - Dev server on http://localhost:3000 (LaunchAgent / Docker)
 *   - Admin user seeded (`scripts/create-admin.ts`); loginAs() succeeds
 *   - At least one active company in admin's org (the staging row's FK
 *     target — `seed-demo-companies.ts` or AZMADE seed satisfies this)
 *   - Postgres reachable
 */

import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { prisma } from '@/lib/prisma';

test.describe('Phase 7.G Turn XXXIV — import_staging_expired live audit emission', () => {
  test('GET on expired-pending staging row emits audit_event with action=import_staging_expired', async ({
    page,
  }) => {
    // Resolve admin's org. User has compound unique (organizationId, email)
    // — multi-tenant schema means email alone is not unique. findFirst is
    // sufficient since the admin email is in fact distinct across orgs in
    // local dev.
    const adminUser = await prisma.user.findFirst({
      where: { email: 'admin@budgetpro.com' },
      select: { id: true, organizationId: true },
    });
    test.skip(
      !adminUser?.organizationId,
      'Admin user not seeded — run scripts/create-admin.ts first',
    );

    // Pick any operational company in admin's org as the staging-row owner.
    // The route handler doesn't care which company; it only checks
    // org-scope. Required for the FK constraint on import_staging.companyId.
    const company = await prisma.company.findFirst({
      where: { organizationId: adminUser!.organizationId!, isActive: true },
      select: { id: true },
    });
    test.skip(
      !company,
      'No active company in admin org — re-run seed scripts',
    );

    // Architect Turn-XXXIV Suggestion (applied inline): create a fresh
    // expired staging row instead of relying on naturally-expired ones in
    // the DB. The original skip-when-empty design risked a silent
    // long-term coverage gap once existing expired-pending rows are
    // consumed. Now the spec runs unconditionally and exercises the same
    // code path the route handler does.
    //
    // expiresAt set to 1970 (Unix epoch) so the lazy-flip fires on the
    // first GET — the route checks `expiresAt < new Date()` (route.ts:62)
    // which is satisfied for any historical date.
    const target = await prisma.importStaging.create({
      data: {
        organizationId: adminUser!.organizationId!,
        companyId: company!.id,
        sourceFile: 'turn-xxxiv-fixture.xlsx',
        sourceSheet: 'P&L',
        proposal: { columns: [], summary: 'Phase 7.G Turn XXXIV fixture' },
        createdBy: adminUser!.id,
        expiresAt: new Date(0), // 1970-01-01 — guaranteed past
        status: 'pending',
      },
      select: { id: true, organizationId: true, companyId: true },
    });

    // Snapshot pre-GET audit count for this entityId. The route emits
    // exactly one row per FIRST flip; if a prior run already triggered
    // the audit, the assertion below catches that we double-fired.
    const beforeCount = await prisma.auditEvent.count({
      where: {
        action: 'import_staging_expired',
        entityId: target!.id,
      },
    });

    // Authenticate as the seeded admin user.
    await loginAs(page);

    // Hit the staging GET — the route's lazy-flip path triggers iff
    // status='pending' AND expiresAt<now (matches our pre-condition).
    const cookies = await page.context().cookies();
    const cookieHeader = cookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    const res = await page.request.get(
      `/api/onboarding/import/staging/${target!.id}`,
      { headers: { cookie: cookieHeader } },
    );

    // Lock the response contract: 410 Gone, body shape from route.ts:94-101.
    expect(res.status()).toBe(410);
    const body = await res.json();
    expect(body.status).toBe('expired');
    expect(body.error).toMatch(/expired/i);

    // Verify the audit row landed. The route's `await logAuditEvent(...)`
    // is awaited inline before the response, so by the time the GET
    // resolves the row should be in Postgres. Small re-query without
    // sleep; the audit-log write is in the same DB transaction scope as
    // the staging UPDATE.
    const afterCount = await prisma.auditEvent.count({
      where: {
        action: 'import_staging_expired',
        entityId: target!.id,
      },
    });
    expect(afterCount).toBe(beforeCount + 1);

    // Verify the metadata shape — proves the discriminated union from
    // `log.ts:108` flows end-to-end (not stripped/coerced through HTTP).
    const auditRow = await prisma.auditEvent.findFirst({
      where: {
        action: 'import_staging_expired',
        entityId: target!.id,
      },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true, organizationId: true, entityType: true },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow!.organizationId).toBe(target!.organizationId);
    expect(auditRow!.entityType).toBe('ImportStaging');
    const metadata = auditRow!.metadata as {
      companyId?: string;
      triggeredBy?: string;
    };
    expect(metadata.companyId).toBe(target!.companyId);
    expect(metadata.triggeredBy).toBe('lazy_get');
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });
});
