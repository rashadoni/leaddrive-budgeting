/**
 * Phase 8 F2 (2026-05-28) — /guide page-view beacon.
 *
 * POST /api/telemetry/guide-view
 *
 * Body: { lang: "en"|"ru"|"az", anchor?: string }
 *
 * Records a single page-view row in `guide_views`. Unauthenticated
 * sessions still log (with `organizationId=null, actorUserId=null`)
 * so anonymous /guide traffic counts surface. Authenticated calls
 * stamp the org + user for per-user / per-org reads.
 *
 * **No external telemetry dep.** This is first-party — data stays
 * on the same Postgres the rest of the app uses. Reads happen via
 * direct Prisma queries from admin pages or ad-hoc SQL.
 *
 * **Rate-limit by IP** (10/min) so a chatty client can't flood the
 * table. Beacon failures are never reported back to the user (the
 * /guide page renders regardless of telemetry status).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { getLogger } from "@/lib/log"

const logger = getLogger("api:telemetry:guide-view")
const RATE_LIMIT = { name: "guide-view", max: 10, windowMs: 60_000 }
const VALID_LANGS = new Set(["en", "ru", "az"])
const MAX_ANCHOR_LEN = 80
const MAX_UA_LEN = 200

export async function POST(req: NextRequest) {
  // Rate-limit by IP; bypasses auth so anonymous users still get
  // their share. Returns 429 on exhaustion.
  const limitErr = enforceRateLimit(getClientIp(req), RATE_LIMIT)
  if (limitErr) return limitErr

  let body: { lang?: unknown; anchor?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 })
  }
  const lang = typeof body.lang === "string" ? body.lang : null
  if (!lang || !VALID_LANGS.has(lang)) {
    return NextResponse.json(
      { ok: false, error: "lang must be one of en/ru/az" },
      { status: 400 },
    )
  }
  const anchor =
    typeof body.anchor === "string" && body.anchor.length > 0
      ? body.anchor.slice(0, MAX_ANCHOR_LEN)
      : null

  const session = await getSession(req).catch(() => null)
  const userAgent = req.headers.get("user-agent")?.slice(0, MAX_UA_LEN) ?? null

  try {
    await prisma.guideView.create({
      data: {
        organizationId: session?.orgId ?? null,
        actorUserId: session?.userId ?? null,
        lang,
        anchor,
        userAgent,
      },
    })
  } catch (err) {
    // Beacon write failure is informational — never propagate to
    // the user. The /guide page rendered fine without this row.
    logger.warn("beacon write failed", {
      reason: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ ok: false, error: "write failed" }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
