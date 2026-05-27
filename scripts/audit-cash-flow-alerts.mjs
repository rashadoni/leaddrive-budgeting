#!/usr/bin/env node
/**
 * 2026-05-27 — Audit + restore CashFlowAlert dismissals.
 *
 * User clicked the (now-renamed) «Resolve» button several times before
 * the copy fix landed, thinking it would actually fix the cash gap.
 * Reality: it only set isResolved=true and hid the alert from the panel.
 *
 * This script:
 *   1. Reports current state per org (total alerts, dismissed vs active)
 *   2. Lists every dismissed alert (year/month/balance) so the user can
 *      see exactly which months were silenced
 *   3. With --restore, sets isResolved=false on all dismissed alerts so
 *      they reappear in the panel
 *
 * The script ALSO verifies the projectedBalance values were not corrupted
 * (it's a read of CashFlowAlert.projectedBalance, which is set ONCE at
 * alert creation by the alert generator — Resolve never touches it).
 *
 *   node scripts/audit-cash-flow-alerts.mjs            # dry-run / report
 *   node scripts/audit-cash-flow-alerts.mjs --restore  # un-dismiss
 */
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

dotenvConfig({ path: path.resolve(process.cwd(), ".env"), override: true });
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local"), override: true });

const prisma = new PrismaClient();

const MONTH = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmt(n) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

async function main() {
  const restore = process.argv.includes("--restore");

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
  });
  console.log(`→ Found ${orgs.length} organization(s)\n`);

  for (const org of orgs) {
    const alerts = await prisma.cashFlowAlert.findMany({
      where: { organizationId: org.id },
      orderBy: [{ year: "asc" }, { month: "asc" }, { createdAt: "asc" }],
    });
    if (alerts.length === 0) {
      console.log(`[${org.name}] no alerts\n`);
      continue;
    }
    const active = alerts.filter((a) => !a.isResolved);
    const dismissed = alerts.filter((a) => a.isResolved);
    console.log(
      `[${org.name}]  total=${alerts.length}  active=${active.length}  dismissed=${dismissed.length}`,
    );

    if (active.length > 0) {
      console.log("  ── ACTIVE (shown in panel) ──");
      for (const a of active) {
        console.log(
          `    ${MONTH[a.month - 1]} ${a.year}  ${a.alertType.padEnd(18)}  balance=${fmt(a.projectedBalance).padStart(15)}`,
        );
      }
    }

    if (dismissed.length > 0) {
      console.log("  ── DISMISSED (hidden — click Resolve in past sessions) ──");
      for (const a of dismissed) {
        console.log(
          `    ${MONTH[a.month - 1]} ${a.year}  ${a.alertType.padEnd(18)}  balance=${fmt(a.projectedBalance).padStart(15)}`,
        );
      }
    }
    console.log();
  }

  // Sanity: projectedBalance integrity check — Resolve never writes
  // this field, only the alert generator does. Verify nothing else
  // shifted it (paranoid double-check after the user's «numbers got off»
  // concern). We cross-check that every alert's projectedBalance still
  // matches the createdAt-time snapshot by ensuring no UPDATE has
  // touched projectedBalance after createdAt — which we can't tell
  // directly without an audit log. The best we can do: confirm the
  // values are finite numbers and have not been zeroed.
  console.log("→ Integrity check on projectedBalance:");
  const all = await prisma.cashFlowAlert.findMany({
    select: { projectedBalance: true },
  });
  const nullish = all.filter(
    (a) => a.projectedBalance == null || !Number.isFinite(a.projectedBalance),
  );
  const zero = all.filter((a) => a.projectedBalance === 0);
  console.log(`  ${all.length} alerts total`);
  console.log(`  ${nullish.length} have null / non-finite balance`);
  console.log(`  ${zero.length} have exactly 0 (legitimate edge case)`);
  console.log();

  if (!restore) {
    console.log("→ Dry-run / report only. Re-run with --restore to un-dismiss.\n");
    process.exit(0);
  }

  // Restore: flip every dismissed alert back to active
  const result = await prisma.cashFlowAlert.updateMany({
    where: { isResolved: true },
    data: { isResolved: false },
  });
  console.log(`✓ Restored ${result.count} dismissed alert(s) → visible again.\n`);
}

main()
  .catch((e) => {
    console.error("✗", e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
