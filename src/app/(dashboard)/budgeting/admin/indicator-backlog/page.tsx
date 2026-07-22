/**
 * 2026-05-27 — Indicator Backlog admin page.
 *
 * Per-entity action-oriented backlog of every indicator that is applicable
 * to the entity's industry but currently has no data. Each row answers:
 *   - WHAT is missing (indicator name + category + required input)
 *   - WHO owns it (resolved via owner map + Organization.settings.dataOwners)
 *   - HOW to fix it (deep-link to /admin/ai-import + mailto: to owner)
 *
 * Designed as a focused workflow surface — separate from the Risk Terminal
 * (которая показывает risk view, не data collection) and the Companies
 * Readiness page (которая показывает 7-area scoring, не per-indicator).
 *
 * Server component fetches the backlog snapshot via prisma; client
 * component handles filters, expand/collapse, email/CSV export.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { computeIndicatorBacklog } from "@/lib/risk/indicator-backlog";
import { currentBakuYear } from "@/lib/risk/periods";
import { IndicatorBacklogView } from "./IndicatorBacklogView";

export const metadata = {
  title: "Indicator Backlog · Admin · BudgetPro",
};

export default async function IndicatorBacklogPage({
  searchParams,
}: {
  // Next.js 16 — searchParams is a Promise on async pages
  searchParams: Promise<{ company?: string; period?: string }>;
}) {
  const session = await auth();
  const role = session?.user?.role;
  if (!hasRole(role, "admin")) redirect("/budgeting");
  const orgId = session?.user?.organizationId;
  if (!orgId) redirect("/budgeting");

  const params = await searchParams;
  const companyCode = params.company?.trim() || undefined;
  const period = /^\d{4}$/.test(params.period?.trim() ?? "")
    ? params.period!.trim()
    : currentBakuYear();

  const { companies, summary } = await computeIndicatorBacklog(
    prisma,
    orgId,
    { period, companyCode },
  );

  // When filtering to a single entity, show a "back to all" affordance so
  // the user can escape the deep-link without retyping the URL.
  const filteredEntity = companyCode ? companies[0] : null;
  const t = await getTranslations("adminIndicatorBacklog");

  return (
    <div
      className="container mx-auto py-8 px-4 max-w-7xl"
      data-testid="data-control-backlog"
    >
      <div className="mb-6">
        {filteredEntity ? (
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <a
              href="/budgeting/admin/indicator-backlog"
              className="hover:text-foreground transition-colors"
            >
              ← {t("allEntitiesLabel")}
            </a>
            <span>·</span>
            <span>
              {t.rich("filteredTo", {
                code: () => (
                  <span className="font-mono text-foreground">
                    {filteredEntity.companyCode}
                  </span>
                ),
              })}
            </span>
          </div>
        ) : null}
        <h1 className="text-2xl font-bold mb-1">
          {t("pageTitle")}
          {filteredEntity ? (
            <span className="text-muted-foreground font-normal">
              {" "}
              · {filteredEntity.companyName}
            </span>
          ) : null}
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
          {t.rich("pageDescription", {
            aiImport: () => (
              <a
                href="/budgeting/admin/ai-import"
                className="text-primary underline-offset-2 hover:underline"
              >
                {t("aiImportLink")}
              </a>
            ),
          })}
        </p>
      </div>

      <IndicatorBacklogView companies={companies} summary={summary} period={period} />
    </div>
  );
}
