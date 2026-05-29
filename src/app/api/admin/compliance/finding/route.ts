/**
 * 2026-05-27 Phase 8 E1 — Compliance Hub write-back endpoint.
 *
 * Per-audit-finding mutations: close / reopen / assign owner / add
 * comment. Mutates `Company.settings.auditFindings.items[findingIdx]`
 * in-place via prisma update and returns the updated finding.
 *
 *   PATCH /api/admin/compliance/finding
 *   body: {
 *     companyId: string,
 *     findingIdx: number,       // index into auditFindings.items[]
 *     action: "close" | "reopen" | "assign" | "comment",
 *     value?: string             // assignee (assign) | comment text (comment)
 *   }
 *
 * Auth: admin role. Write-backs persist to settings JSON; a re-import
 * via /api/admin/import-workbook OR /api/import/ai-auto-multi overwrites
 * the items[] array and **drops** these mutations. Documented limitation
 * — for v2, mutations should land in a separate `FindingMutation` table.
 *
 * Each mutation also appends an entry to the finding's embedded
 * `mutations: Array<{at, by, action, value}>` log so the change history
 * survives in the same JSON blob without a schema migration.
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireRole, isAuthError } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

const VALID_ACTIONS = new Set([
  "close",
  "reopen",
  "assign",
  "comment",
  "deadline",
] as const);
type FindingAction = "close" | "reopen" | "assign" | "comment" | "deadline";

/**
 * Per-finding mutation log entry stored inline alongside the original
 * imported finding. Append-only; readable as «change history» in the
 * UI's expanded row tooltip (v2 enhancement).
 */
interface FindingMutation {
  at: string;
  by: string;
  action: FindingAction;
  value?: string;
}

/**
 * AuditFinding shape *as it appears in the settings JSON*. The original
 * importer writes `severity / audit / status / grouping / findingStatusJan`;
 * write-backs add the optional fields below.
 */
interface AuditFinding {
  severity: string;
  audit: string;
  status: string;
  grouping: string;
  findingStatusJan: string;
  closed?: boolean;
  assignedTo?: string;
  /** ISO date (YYYY-MM-DD) target completion date set via the
   *  `deadline` action. Phase 8 E1 completion (2026-05-29). */
  deadline?: string;
  comments?: Array<{ at: string; author: string; text: string }>;
  mutations?: FindingMutation[];
  closedAt?: string;
  closedBy?: string;
}

interface AuditFindingsBlock {
  source?: string;
  importedAt?: string;
  summary?: Record<string, unknown>;
  items?: AuditFinding[];
}

export async function PATCH(req: NextRequest) {
  const session = await requireRole(req, "admin");
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json(
      { ok: false, error: "No organization in session" },
      { status: 400 },
    );
  }

  // Parse + validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be valid JSON" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Body must be an object" },
      { status: 400 },
    );
  }
  const b = body as Record<string, unknown>;
  const companyId = typeof b.companyId === "string" ? b.companyId : null;
  const findingIdx = typeof b.findingIdx === "number" ? b.findingIdx : null;
  const action = typeof b.action === "string" ? b.action : null;
  const value = typeof b.value === "string" ? b.value : undefined;
  if (!companyId) {
    return NextResponse.json(
      { ok: false, error: "Field 'companyId' (string) is required" },
      { status: 400 },
    );
  }
  if (findingIdx === null || !Number.isInteger(findingIdx) || findingIdx < 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Field 'findingIdx' (non-negative integer) is required",
      },
      { status: 400 },
    );
  }
  if (!action || !VALID_ACTIONS.has(action as FindingAction)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Field 'action' must be one of: ${[...VALID_ACTIONS].join(", ")}`,
      },
      { status: 400 },
    );
  }
  const typedAction = action as FindingAction;
  if (
    (typedAction === "assign" ||
      typedAction === "comment" ||
      typedAction === "deadline") &&
    !value
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `Field 'value' (string) is required for action='${typedAction}'`,
      },
      { status: 400 },
    );
  }
  // `deadline` value must be a parseable date (the UI sends an ISO
  // YYYY-MM-DD from a <input type="date">). Reject garbage so a bad
  // client can't poison the JSON with an unparseable string.
  if (typedAction === "deadline" && value && Number.isNaN(Date.parse(value))) {
    return NextResponse.json(
      { ok: false, error: "Field 'value' must be a valid date for action='deadline'" },
      { status: 400 },
    );
  }

  // Load company + verify org membership + settings shape
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: session.orgId },
    select: { id: true, code: true, settings: true },
  });
  if (!company) {
    return NextResponse.json(
      { ok: false, error: "Company not found in this organization" },
      { status: 404 },
    );
  }

  const settings = (company.settings ?? {}) as Record<string, unknown> & {
    auditFindings?: AuditFindingsBlock;
  };
  const auditBlock = settings.auditFindings;
  if (!auditBlock || !Array.isArray(auditBlock.items)) {
    return NextResponse.json(
      { ok: false, error: "Company has no auditFindings to mutate" },
      { status: 409 },
    );
  }
  if (findingIdx >= auditBlock.items.length) {
    return NextResponse.json(
      {
        ok: false,
        error: `findingIdx ${findingIdx} out of range (have ${auditBlock.items.length} findings)`,
      },
      { status: 400 },
    );
  }

  // Apply mutation in-place (clone to avoid mutating the read-only object)
  const items: AuditFinding[] = auditBlock.items.map((it) => ({ ...it }));
  const finding = items[findingIdx];
  const actor = session.userId ?? "system";
  const now = new Date().toISOString();
  const mutation: FindingMutation = { at: now, by: actor, action: typedAction };

  switch (typedAction) {
    case "close":
      finding.closed = true;
      finding.closedAt = now;
      finding.closedBy = actor;
      break;
    case "reopen":
      finding.closed = false;
      delete finding.closedAt;
      delete finding.closedBy;
      break;
    case "assign":
      finding.assignedTo = value!;
      mutation.value = value;
      break;
    case "comment": {
      const comments = Array.isArray(finding.comments) ? finding.comments : [];
      comments.push({ at: now, author: actor, text: value! });
      finding.comments = comments;
      mutation.value = value;
      break;
    }
    case "deadline":
      finding.deadline = value!;
      mutation.value = value;
      break;
  }
  finding.mutations = [
    ...(Array.isArray(finding.mutations) ? finding.mutations : []),
    mutation,
  ];
  items[findingIdx] = finding;

  // Recompute summary.completed using new closed override
  const completedCount = items.filter(
    (it) => it.closed === true || /yerinə yetirilib/i.test(it.status),
  ).length;
  const total = items.length;
  const summary: Record<string, unknown> = {
    ...(auditBlock.summary ?? {}),
    total,
    completed: completedCount,
    completedPct: total > 0 ? Math.round((completedCount / total) * 100) : 0,
  };

  // Persist
  await prisma.company.update({
    where: { id: companyId },
    data: {
      settings: {
        ...settings,
        auditFindings: {
          ...auditBlock,
          items,
          summary,
        },
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    ok: true,
    companyCode: company.code,
    findingIdx,
    finding,
    summary,
  });
}
