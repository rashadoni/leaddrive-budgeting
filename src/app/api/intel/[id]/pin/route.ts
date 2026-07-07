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
import { withOrgScope } from "@/lib/db/with-org-scope";
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

  // Stage 3 RLS — ownership check + update in one org-scoped tx. The
  // findFirst-then-update (not updateMany) still yields an explicit 404 on
  // a cross-tenant/missing id rather than a silent count:0.
  const updated = await withOrgScope(orgId, async (tx) => {
    const existing = await tx.intelItem.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) return null;
    // Idempotent on no-op — Prisma still emits the UPDATE but the row is
    // unchanged. Acceptable; no-op pins are rare in practice.
    return tx.intelItem.update({
      where: { id },
      data: { isPinned: parsed.pinned },
    });
  });
  if (!updated) {
    return NextResponse.json({ error: "Intel item not found" }, { status: 404 });
  }

  return NextResponse.json(
    { item: intelItemToDTO(updated, session.userId) },
    { status: 200, headers: { "Cache-Control": "private, no-store" } },
  );
}
