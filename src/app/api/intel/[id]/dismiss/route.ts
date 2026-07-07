/**
 * Phase 7.G Turn XLIV (Phase D.3) — dismiss an IntelItem (per-user).
 *
 * DELETE /api/intel/[id]/dismiss
 *
 * Appends `session.userId` to `IntelItem.dismissedBy[]`. Idempotent —
 * re-dismissing a row already dismissed by the same user is a no-op
 * (returns the unchanged DTO). The GET handler at `/api/intel`
 * filters out items whose `dismissedBy` includes the caller's id by
 * default, so a successful dismiss removes the item from the user's
 * feed but leaves it visible to other org-members.
 *
 * Auth: `requireAuth` — any authenticated org-member can dismiss
 * for themselves. Dismiss is a per-user preference, not a curatorial
 * action (which is what `POST /api/intel/[id]/pin` covers).
 *
 * Org-scoping: 404 on cross-tenant or missing — never leak existence.
 *
 * Race semantics: read → append-if-absent → set the deduped array.
 * Two concurrent dismisses from the same user converge on a single
 * userId in the array (set-write is last-writer-wins; both writers
 * compute the same target value). The window where one writer's
 * read happens BEFORE the other's write is rare for the
 * same-user case (UI debounces clicks). At Phase D.5 scale we move
 * to a join table per the schema comment at
 * `prisma/schema.prisma:1204-1211` — until then, this trade-off is
 * acceptable.
 *
 * Returns: 200 with the updated `IntelItemDTO`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withOrgScope } from "@/lib/db/with-org-scope";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { intelItemToDTO } from "@/lib/intel/types";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(request);
  if (isAuthError(session)) return session;
  const orgId = session.orgId;
  const userId = session.userId;
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

  // Stage 3 RLS — lookup + dedup-append update in one org-scoped tx. The
  // idempotent no-op path returns the unchanged row (no write).
  const result = await withOrgScope(orgId, async (tx) => {
    const existing = await tx.intelItem.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) return { item: null };
    // Idempotent: if already dismissed, return unchanged.
    if (existing.dismissedBy.includes(userId)) return { item: existing };
    // Set the deduped array. Prisma's `push` operator would also work
    // (atomic Postgres `array_append`) but doesn't dedup — re-dismiss
    // races could leave a duplicate. The set-deduped approach converges
    // to the same final array regardless of write order.
    const updated = await tx.intelItem.update({
      where: { id },
      data: { dismissedBy: { set: [...existing.dismissedBy, userId] } },
    });
    return { item: updated };
  });
  if (!result.item) {
    return NextResponse.json({ error: "Intel item not found" }, { status: 404 });
  }

  return NextResponse.json(
    { item: intelItemToDTO(result.item, userId) },
    { status: 200, headers: { "Cache-Control": "private, no-store" } },
  );
}
