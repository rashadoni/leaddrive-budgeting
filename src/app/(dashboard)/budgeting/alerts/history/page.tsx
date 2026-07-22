import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { currentBakuYear, parsePeriod, PeriodParseError } from "@/lib/risk/periods";
import { AlertEventsFeed } from "@/features/risk/components/AlertEventsFeed";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("alertHistory");
  return { title: t("metadataTitle") };
}

/**
 * Phase 7.E C6 v3.3 (Turn V) — latest AlertEvent snapshot viewer.
 *
 * Server component scaffold around the client `AlertEventsFeed`. Reads
 * `?period=YYYY`, `?period=YYYY-Qn`, or `?period=YYYY-MM` from URL searchParams
 * (default: current year). Period
 * is validated server-side before rendering — garbage input redirects
 * back to /budgeting (matches the matrix endpoint defense-in-depth
 * pattern at `/api/indicators/matrix/route.ts:64-72`).
 *
 * Auth: any org member at the page gate. The read API additionally reapplies
 * organization and subgroup company scope to the stored aggregate rows.
 */
export default async function AlertHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!session?.user || !orgId) {
    redirect("/budgeting");
  }

  const params = await searchParams;
  const rawPeriod = params.period ?? currentBakuYear();
  try {
    parsePeriod(rawPeriod);
  } catch (err) {
    if (err instanceof PeriodParseError) {
      redirect("/budgeting");
    }
    throw err;
  }
  const period = rawPeriod;
  const t = await getTranslations("alertHistory");

  return (
    <div
      className="mx-auto max-w-5xl space-y-6 px-4 py-6"
      data-testid="alerts-guide-root"
    >
      <header className="space-y-1" data-testid="alerts-guide-header">
        <div className="flex items-center gap-3">
          <Link
            href="/budgeting/terminal"
            className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            {t("backTerminal")}
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("description", { period })}
        </p>
      </header>
      <section
        className="rounded border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm"
        data-testid="alerts-guide-scope"
      >
        <h2 className="font-semibold">{t("scopeTitle")}</h2>
        <p className="mt-1 text-muted-foreground">{t("scopeBody")}</p>
      </section>
      <AlertEventsFeed period={period} />
    </div>
  );
}
