/**
 * Phase 7.G Turn XLIV (Phase D.3) — pin / un-pin an IntelItem.
 *
 * POST /api/intel/[id]/pin
 *
 * Body: `{ pinned: boolean }` — explicit target state, NOT a toggle,
 * so concurrent clicks from two managers always converge on the body's
 * value rather than racing the read.
 *
 * Auth: `requireRole('manager')`. Pinning is curatorial (the pinned
 * row is visible to every org-member), so editor / viewer can dismiss
 * but not pin.
 *
 * Org-scoping: 404 on cross-tenant or missing — same response, never
 * leak existence (project convention from variance-explainer +
 * companies/[id]/route.ts).
 *
 * Returns: 200 with `IntelItemDTO` (caller's POV — `isDismissed`
 * computed against `session.userId`).
 */

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, isAuthError } from "@/lib/api-auth";
import { intelItemToDTO } from "@/lib/intel/types";

const bodySchema = z.object({
  pinned: z.boolean(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(request, "manager");
  if (isAuthError(session)) return session;
  const orgId = session.orgId;
  if (!orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    );
  }

  const { id } = await params;
  if (typeof id !== "string" || id.trim() === "") {
    return NextResponse.json({ error: "Invalid intel id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  let parsed: { pinned: boolean };
  try {
    parsed = bodySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: err.flatten().fieldErrors },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Ownership check FIRST — `updateMany` would let a cross-tenant id
  // succeed silently with `count: 0`. We want an explicit 404 on miss
  // (mirrors the variance-explainer pattern at
  // `src/app/api/indicators/values/[id]/explain/route.ts:106-138`).
  const existing = await prisma.intelItem.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Intel item not found" }, { status: 404 });
  }

  // Idempotent on no-op — Prisma still emits the UPDATE but the row is
  // unchanged. Acceptable; no-op pins are rare in practice.
  const updated = await prisma.intelItem.update({
    where: { id },
    data: { isPinned: parsed.pinned },
  });

  return NextResponse.json(
    { item: intelItemToDTO(updated, session.userId) },
    { status: 200, headers: { "Cache-Control": "private, no-store" } },
  );
}
