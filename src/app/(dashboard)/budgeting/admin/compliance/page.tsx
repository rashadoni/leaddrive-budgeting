/**
 * 2026-05-27 — Compliance Hub.
 *
 * Single-screen admin page surfacing the 218 internal-audit findings
 * + 54 court cases imported from client xlsx (Follow up - For GTC.xlsx
 * + Açıq məhkəmə mübahisələri.xlsx). Both datasets are already in
 * Company.settings (auditFindings + courtDisputes JSON blobs from
 * Phase 7.N), so this page is pure UI — no new DB schema.
 *
 * Admin-only. Server component fetches `Company.settings` for all
 * operational entities; the client component renders 2 tabbed tables
 * with per-row drill-down, filters (severity / status), CSV export,
 * and summary cards.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  ComplianceHub,
  type EntityComplianceData,
} from "./ComplianceHub";

export const metadata = {
  title: "Compliance & Legal · Admin · BudgetPro",
};

interface AuditFinding {
  severity: string;
  audit: string;
  status: string;
  grouping: string;
  findingStatusJan: string;
}

interface CourtCase {
  date: string;
  court: string;
  claimant: string;
  defendant: string;
  disputeType: string;
  status: string;
  closed: boolean;
}

interface CompanySettings {
  auditFindings?: {
    source?: string;
    importedAt?: string;
    summary?: {
      total?: number;
      completed?: number;
      completedPct?: number;
      major_open?: number;
      minor_open?: number;
      observation_open?: number;
    };
    items?: AuditFinding[];
  };
  courtDisputes?: {
    source?: string;
    importedAt?: string;
    summary?: {
      total?: number;
      open?: number;
      as_defendant?: number;
      as_plaintiff?: number;
      money_claims?: number;
    };
    cases?: CourtCase[];
  };
}

export default async function CompliancePage() {
  const session = await auth();
  const role = session?.user?.role;
  if (!hasRole(role, "admin")) redirect("/budgeting");
  const orgId = session?.user?.organizationId;
  if (!orgId) redirect("/budgeting");

  const companies = await prisma.company.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      level: 2,
    },
    select: {
      id: true,
      code: true,
      name: true,
      industry: true,
      settings: true,
    },
    orderBy: { code: "asc" },
  });

  const entities: EntityComplianceData[] = companies.map((c: (typeof companies)[number]) => {
    const s = (c.settings ?? {}) as CompanySettings;
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      industry: c.industry ?? "—",
      auditFindings: s.auditFindings
        ? {
            summary: s.auditFindings.summary ?? {},
            items: s.auditFindings.items ?? [],
            source: s.auditFindings.source,
            importedAt: s.auditFindings.importedAt,
          }
        : null,
      courtDisputes: s.courtDisputes
        ? {
            summary: s.courtDisputes.summary ?? {},
            cases: s.courtDisputes.cases ?? [],
            source: s.courtDisputes.source,
            importedAt: s.courtDisputes.importedAt,
          }
        : null,
    };
  });

  const t = await getTranslations("adminCompliance");
  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
          {t("pageDescription")}
        </p>
      </div>

      <ComplianceHub entities={entities} />
    </div>
  );
}
