// T8 (audit §1.8) — trade alert email digest.
//
// The inbox is passive; the point of "see it on day 15" is that the
// system chases the human. This helper emails all open UNACKNOWLEDGED
// trade alerts (critical + warn) to the org's admins/managers.
// Best-effort: failures are reported in the result, never thrown.

import type { PrismaClient } from "@prisma/client";
import { getEmailService } from "@/lib/email";

export interface DigestResult {
  alerts: number;
  recipients: number;
  sent: boolean;
  skippedReason?: "no_alerts" | "no_recipients" | "send_failed";
}

export async function sendTradeAlertDigest(
  prisma: PrismaClient,
  organizationId: string
): Promise<DigestResult> {
  const alerts = await prisma.alert.findMany({
    where: {
      organizationId,
      domain: "trade",
      resolvedAt: null,
      acknowledgedAt: null,
      severity: { in: ["critical", "warn"] },
    },
    orderBy: [{ severity: "asc" }, { triggeredAt: "desc" }],
    take: 20,
    select: { severity: true, title: true, message: true, triggeredAt: true },
  });
  if (alerts.length === 0) {
    return { alerts: 0, recipients: 0, sent: false, skippedReason: "no_alerts" };
  }

  const recipients = await prisma.user.findMany({
    where: { organizationId, role: { in: ["admin", "manager"] }, isActive: true },
    select: { email: true, name: true },
  });
  if (recipients.length === 0) {
    return { alerts: alerts.length, recipients: 0, sent: false, skippedReason: "no_recipients" };
  }

  const lines = alerts.map(
    (a) =>
      `[${a.severity.toUpperCase()}] ${a.title}\n${a.message}\n(${a.triggeredAt.toISOString().slice(0, 16).replace("T", " ")} UTC)`
  );
  const critical = alerts.filter((a) => a.severity === "critical").length;
  const subject = `Trade Tower: ${alerts.length} open alert(s)${critical > 0 ? ` — ${critical} critical` : ""}`;
  const body =
    `Open, unacknowledged trade alerts:\n\n${lines.join("\n\n")}\n\n` +
    `Open the Trade Tower to acknowledge or act: /budgeting/trade\n` +
    `Alerts auto-resolve when their condition clears.`;

  try {
    // Broadcast-to-pool → bcc (codebase convention: peers must not see
    // each other's addresses; see approval-notifications).
    await getEmailService().send({
      to: [],
      bcc: recipients.map((r) => ({ email: r.email, name: r.name ?? undefined })),
      subject,
      body,
      lang: "en",
      metadata: { kind: "trade_alert_digest", organizationId },
    });
    return { alerts: alerts.length, recipients: recipients.length, sent: true };
  } catch {
    return {
      alerts: alerts.length,
      recipients: recipients.length,
      sent: false,
      skippedReason: "send_failed",
    };
  }
}
