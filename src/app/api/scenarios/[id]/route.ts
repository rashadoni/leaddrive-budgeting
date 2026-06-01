import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
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

  const scenario = await prisma.scenario.findFirst({
    where: { id, organizationId: session.orgId },
  });

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

  // Tenant-scope lookup before update (prevents cross-tenant IDOR)
  const existing = await prisma.scenario.findFirst({
    where: { id, organizationId: session.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
  }

  const updated = await prisma.scenario.update({
    where: { id },
    data: parsed.data,
  });

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

  const existing = await prisma.scenario.findFirst({
    where: { id, organizationId: session.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
  }

  await prisma.scenario.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ deleted: true, id });
}
