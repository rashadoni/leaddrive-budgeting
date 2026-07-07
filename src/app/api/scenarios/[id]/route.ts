import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withOrgScope } from '@/lib/db/with-org-scope';
import { requireAuth, requireRole, isAuthError } from '@/lib/api-auth';
import { ScenarioOverridesSchema } from '@/lib/risk/scenario-overrides-schema';

// ─── Validation ───────────────────────────────────────────────────────────────

const ScenarioUpdateSchema = z.object({
  nameEn: z.string().min(1).max(256).optional(),
  nameRu: z.string().max(256).nullable().optional(),
  nameAz: z.string().max(256).nullable().optional(),
  description: z.string().max(2048).nullable().optional(),
  // Accepts legacy `adjustments[]` OR the Phase-2 `shock{}` form (crisis
  // scenarios) — kept in lockstep with the create route + the engine.
  overrides: ScenarioOverridesSchema.optional(),
  isActive: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

// ─── GET: fetch single scenario ───────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteContext) {
  const session = await requireAuth(request);
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  const { id } = await params;
  const orgId = session.orgId;

  const scenario = await withOrgScope(orgId, (tx) =>
    tx.scenario.findFirst({
      where: { id, organizationId: orgId },
    }),
  );

  if (!scenario) {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
  }

  return NextResponse.json(scenario);
}

// ─── PATCH: update a scenario (admin-only) ────────────────────────────────────

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await requireRole(request, 'admin');
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ScenarioUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const orgId = session.orgId;
  // Stage 3 RLS — tenant-scope lookup + update in one org-scoped tx.
  const updated = await withOrgScope(orgId, async (tx) => {
    const existing = await tx.scenario.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) return null;
    return tx.scenario.update({
      where: { id },
      data: parsed.data,
    });
  });
  if (!updated) {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
  }

  return NextResponse.json(updated);
}

// ─── DELETE: soft-delete a scenario (admin-only) ─────────────────────────────
//
// Sets isActive=false rather than destroying the row so that historical
// simulation results that reference this scenario's code remain traceable.

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await requireRole(request, 'admin');
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  const { id } = await params;
  const orgId = session.orgId;

  // Stage 3 RLS — lookup + soft-delete in one org-scoped tx.
  const ok = await withOrgScope(orgId, async (tx) => {
    const existing = await tx.scenario.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) return false;
    await tx.scenario.update({
      where: { id },
      data: { isActive: false },
    });
    return true;
  });
  if (!ok) {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, id });
}
