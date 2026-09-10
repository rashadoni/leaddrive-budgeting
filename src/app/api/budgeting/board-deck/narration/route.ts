import { NextRequest, NextResponse } from "next/server";
import { requireRole, isAuthError } from "@/lib/api-auth";
import {
  getAnthropicClientForOrg,
  hasAnthropicKeyForOrg,
} from "@/lib/ai/client";
import { prismaAdmin } from "@/lib/db/prisma-admin";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { getCompanyScope } from "@/lib/rbac/company-scope";
import {
  parsePeriod,
  PeriodParseError,
} from "@/lib/risk/periods";
import { buildBoardSnapshot } from "@/lib/board-deck/build-snapshot";
import { getOrCreateNarration } from "@/lib/board-deck/get-or-create-narration";
import {
  isNarrationLanguage,
  runNarration,
  type NarrationLanguage,
} from "@/lib/board-deck/narrate-snapshot";

export const runtime = "nodejs";
export const maxDuration = 90;

const RATE_LIMIT = {
  name: "board-deck-narration",
  max: 6,
  windowMs: 60_000,
};

interface RequestBody {
  userInitiated?: unknown;
  period?: unknown;
  language?: unknown;
  regenerate?: unknown;
}

/** Paid AI generation is POST-only and requires an explicit manager action. */
export async function POST(req: NextRequest) {
  const session = await requireRole(req, "manager");
  if (isAuthError(session)) return session;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Fail closed before key lookup, rate-limit consumption, tenant reads or
  // provider plumbing. Page loads, locale switches and exports never set it.
  if (body.userInitiated !== true) {
    return NextResponse.json(
      { error: "Explicit user action required to generate Board Deck AI narrative." },
      { status: 428 },
    );
  }

  if (typeof body.period !== "string") {
    return NextResponse.json({ error: "Period is required" }, { status: 400 });
  }
  try {
    parsePeriod(body.period);
  } catch (err) {
    if (err instanceof PeriodParseError) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }
    throw err;
  }
  if (typeof body.language !== "string" || !isNarrationLanguage(body.language)) {
    return NextResponse.json({ error: "Invalid language" }, { status: 400 });
  }
  if (body.regenerate !== undefined && typeof body.regenerate !== "boolean") {
    return NextResponse.json({ error: "Invalid regenerate flag" }, { status: 400 });
  }
  const rawPeriod = body.period;
  const language: NarrationLanguage = body.language;

  if (
    !(await hasAnthropicKeyForOrg(prismaAdmin, session.orgId))
  ) {
    return NextResponse.json(
      { error: "Board Deck AI narrative is unavailable: Anthropic key is not configured." },
      { status: 503 },
    );
  }

  const rateLimitError = enforceRateLimit(
    `${RATE_LIMIT.name}:${session.orgId}:${session.userId}:${getClientIp(req)}`,
    RATE_LIMIT,
  );
  if (rateLimitError) return rateLimitError;

  const scope = await getCompanyScope(
    session.orgId,
    session.userId,
    session.role,
  );
  const snapshot = await buildBoardSnapshot({
    orgId: session.orgId,
    period: rawPeriod,
    companyIds: scope.ids == null ? null : [...scope.ids],
  });
  if (!snapshot) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const client = await getAnthropicClientForOrg(prismaAdmin, session.orgId);
  const narration = await getOrCreateNarration(
    {
      organizationId: session.orgId,
      snapshot,
      language,
      audit: {
        route: "/api/budgeting/board-deck/narration",
        userAgent: req.headers.get("user-agent") ?? undefined,
        actorUserId: session.userId,
      },
    },
    {
      bypassCache: body.regenerate === true,
      runNarrationImpl: (input) => runNarration(input, { client }),
    },
  );
  if (!narration) {
    return NextResponse.json(
      { error: "AI narrative generation failed" },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { ok: true, period: rawPeriod, language },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
