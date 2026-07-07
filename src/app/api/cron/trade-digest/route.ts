/**
 * Trade alert digest cron — `GET /api/cron/trade-digest` (T8, audit §1.8).
 *
 * Emails open unacknowledged trade alerts to every org's admins/managers.
 * Auth: `Authorization: Bearer $CRON_SECRET` (same contract as
 * /api/cron/refresh-feeds). Wire on the VM:
 *   0 6 * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost/api/cron/trade-digest
 */
// rls-scan-ignore: CRON_SECRET-authed scheduled job that spans ALL orgs — it
// scans every org's open trade alerts (distinct organizationId) then emails
// each org's digest. A single withOrgScope pins ONE org, so a cross-org cron
// can't use it. Runs on the BYPASSRLS `prismaAdmin` client (passed into
// sendTradeAlertDigest too); org scoping is inherent per loop iteration.
import { NextRequest, NextResponse } from "next/server"
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
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
