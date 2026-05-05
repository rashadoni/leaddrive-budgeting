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
 * Skip-when-empty design: the spec runs ONLY if there's an
 * expired-pending staging row in admin's org. In production the rows
 * appear naturally (users abandon wizards past the TTL window).
 * Pre-condition: at least one such row in the DB (`status='pending'`,
 * `expiresAt < now()`).
 *
 * Side effects: ONE staging row flips pending → expired (irreversible
 * by design — that's the whole point) AND ONE audit_event row lands.
 * Both are valid post-state; no cleanup required. Future runs of this
 * spec will skip cleanly because there will be no more pending-expired
 * rows to consume — that's the correct behavior.
 *
 * Pre-conditions (mirror existing specs in this dir):
 *   - Dev server on http://localhost:3000 (LaunchAgent / Docker)
 *   - Admin user seeded; loginAs() succeeds
 *   - Postgres reachable + at least one expired-pending staging row in
 *     admin's org (script test.skip-s otherwise — explicitly visible
 *     in test output, not silent)
 */

import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { prisma } from '@/lib/prisma';

test.describe('Phase 7.G Turn XXXIV — import_staging_expired live audit emission', () => {
  test('GET on expired-pending staging row emits audit_event with action=import_staging_expired', async ({
    page,
  }) => {
    // Discover a target row — admin's org, status=pending, expiresAt past.
    // We intentionally do NOT create one in the test; the goal is
    // verifying the live runtime path, not the seed/fixture path. If no
    // such row exists, skip with a visible reason.
    // User has compound unique (organizationId, email) — multi-tenant
    // schema means email alone is not unique. findFirst is sufficient
    // here since the admin email is in fact distinct across orgs in
    // local dev.
    const adminUser = await prisma.user.findFirst({
      where: { email: 'admin@budgetpro.com' },
      select: { organizationId: true },
    });
    test.skip(
      !adminUser?.organizationId,
      'Admin user not seeded — run scripts/create-admin.ts first',
    );

    const target = await prisma.importStaging.findFirst({
      where: {
        status: 'pending',
        expiresAt: { lt: new Date() },
        organizationId: adminUser!.organizationId!,
      },
      select: { id: true, organizationId: true, companyId: true },
    });
    test.skip(
      !target,
      'No expired-pending staging row in admin org — nothing to verify (test runs naturally when prod has abandoned wizards past TTL)',
    );

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
