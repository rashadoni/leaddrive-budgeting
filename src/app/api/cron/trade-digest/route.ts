/**
 * Trade alert digest cron — `GET /api/cron/trade-digest` (T8, audit §1.8).
 *
 * Emails open unacknowledged trade alerts to every org's admins/managers.
 * Auth: `Authorization: Bearer $CRON_SECRET` (same contract as
 * /api/cron/refresh-feeds). Wire on the VM:
 *   0 6 * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost/api/cron/trade-digest
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendTradeAlertDigest } from "@/lib/trade/digest"

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured — refusing to run" },
      { status: 503 },
    )
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Only orgs that actually have open trade alerts.
  const orgs = await prisma.alert.findMany({
    where: { domain: "trade", resolvedAt: null, acknowledgedAt: null },
    select: { organizationId: true },
    distinct: ["organizationId"],
  })

  const results = []
  for (const { organizationId } of orgs) {
    results.push({ organizationId, ...(await sendTradeAlertDigest(prisma, organizationId)) })
  }
  return NextResponse.json({ ok: true, orgs: orgs.length, results })
}
