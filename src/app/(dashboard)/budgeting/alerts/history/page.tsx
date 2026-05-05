import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { currentBakuYear, parsePeriod, PeriodParseError } from "@/lib/risk/periods";
import { AlertEventsFeed } from "@/features/risk/components/AlertEventsFeed";

export const metadata = {
  title: "Alert History",
};

/**
 * Phase 7.E C6 v3.3 (Turn V) — AlertEvent replay viewer.
 *
 * Server component scaffold around the client `AlertEventsFeed`. Reads
 * `?period=YYYY` from URL searchParams (default: current year). Period
 * is validated server-side before rendering — garbage input redirects
 * back to /budgeting (matches the matrix endpoint defense-in-depth
 * pattern at `/api/indicators/matrix/route.ts:64-72`).
 *
 * Auth: any org member (`requireAuth` semantics — alerts are not more
 * sensitive than what the live HeatMap UI already shows). The viewer-
 * tier gate matches the read API.
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

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <Link
            href="/budgeting/terminal"
            className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Terminal
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Alert History</h1>
        <p className="text-sm text-muted-foreground">
          Past alert events for period{" "}
          <span className="font-mono">{period}</span>. Persisted at the end
          of every recompute run; one row per evaluator-rule match.
        </p>
      </header>
      <AlertEventsFeed period={period} />
    </div>
  );
}
