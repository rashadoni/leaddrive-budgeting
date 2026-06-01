import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole, isAuthError } from '@/lib/api-auth';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import { getLogger } from '@/lib/log';
import { ScenarioOverridesSchema } from '@/lib/risk/scenario-overrides-schema';

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger('api:scenarios');

// Phase 7.N — POST now creates a new scenario (admin-only).
// The old "apply/queue 202" path is replaced by GET /api/scenarios/[id]/simulate
// (Phase 7.N live What-if engine).
const CREATE_RATE_LIMIT = { name: 'scenarios-create', max: 10, windowMs: 60_000 };

// ─── Validation schema ────────────────────────────────────────────────────────

const ScenarioCreateSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Z0-9_]+$/, 'Code must be uppercase letters, digits, and underscores only'),
  nameEn: z.string().min(1).max(256),
  nameRu: z.string().max(256).optional(),
  nameAz: z.string().max(256).optional(),
  description: z.string().max(2048).optional(),
  // Accepts legacy `adjustments[]` OR the Phase-2 `shock{}` form — kept in
  // lockstep with the update route + the simulate engine.
  overrides: ScenarioOverridesSchema,
  isActive: z.boolean().default(true),
});

// ─── GET: list active scenarios for the caller's org ─────────────────────────

export async function GET(request: NextRequest) {
  const session = await requireAuth(request);
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 });
  }

  try {
    const scenarios = await prisma.scenario.findMany({
      where: {
        organizationId: session.orgId,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(scenarios);
  } catch (error: unknown) {
    log.error('Error fetching scenarios', {
      err: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to fetch scenarios' }, { status: 500 });
  }
}

// ─── POST: create a new scenario (admin-only) ────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await requireRole(request, 'admin');
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 });
  }

  const rateLimitError = enforceRateLimit(
    `${session.orgId}:${getClientIp(request)}`,
    CREATE_RATE_LIMIT,
  );
  if (rateLimitError) return rateLimitError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ScenarioCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { code, nameEn, nameRu, nameAz, description, overrides, isActive } = parsed.data;

  try {
    const scenario = await prisma.scenario.create({
      data: {
        organizationId: session.orgId,
        code,
        nameEn,
        nameRu: nameRu ?? null,
        nameAz: nameAz ?? null,
        description: description ?? null,
        overrides,
        isActive,
      },
    });
    return NextResponse.json(scenario, { status: 201 });
  } catch (e: unknown) {
    if (
      typeof e === 'object' && e !== null &&
      'code' in e && (e as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { error: `Scenario code "${code}" already exists in this organization` },
        { status: 409 },
      );
    }
    log.error('Error creating scenario', {
      code,
      err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Failed to create scenario' }, { status: 500 });
  }
}
