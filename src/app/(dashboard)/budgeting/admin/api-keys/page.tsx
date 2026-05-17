/**
 * Phase 7.K Phase 5a — Admin API key management page.
 *
 * Server component (auth + initial data) + client component (input
 * + save flow). Each known external feed (EIA / USDA / Google Trends
 * proxy) gets its own row with: source name, "configured" badge,
 * redacted preview ("ABCD…WXYZ"), input field, "save" button. Clearing
 * a field and saving deletes the key.
 *
 * Admin-only. Routes through PATCH /api/admin/api-keys; that endpoint
 * audit-logs each change.
 */
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import {
  KNOWN_API_KEY_SOURCES,
  listApiKeys,
  redactApiKey,
} from "@/lib/intel/api-keys"
import { ApiKeysForm } from "./ApiKeysForm"

export const metadata = {
  title: "API keys · Admin · BudgetPro",
}

const SOURCE_DOCS: Record<
  string,
  { name: string; signupUrl: string; notes: string; sectors: string[] }
> = {
  eia: {
    name: "EIA Energy v2",
    signupUrl: "https://www.eia.gov/opendata/register.php",
    notes:
      "Free & instant. Drives BRENT / WTI / NATGAS feeds (logistics, industrial sectors).",
    sectors: ["logistics", "industrial", "construction"],
  },
  usda: {
    name: "USDA NASS Quick Stats",
    signupUrl: "https://quickstats.nass.usda.gov/api",
    notes:
      "Free; email-verified. Drives BROILER / EGG / CHICK-PLACEMENT feeds (poultry sector).",
    sectors: ["poultry"],
  },
  gtrends: {
    name: "Google Trends Proxy (SerpAPI / ScrapingDog)",
    signupUrl: "https://serpapi.com/users/sign_up",
    notes:
      "Paid (SerpAPI has free tier ~100 searches/mo). Drives AZ search-trend signals (retail / beverage demand).",
    sectors: ["retail", "beverage", "entertainment"],
  },
}

export default async function ApiKeysPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) {
    redirect("/budgeting")
  }
  const orgId = session?.user?.organizationId
  if (!orgId) {
    redirect("/budgeting")
  }

  const raw = await listApiKeys(prisma, orgId)
  const initial = KNOWN_API_KEY_SOURCES.map((src) => ({
    source: src,
    configured: !!raw[src],
    preview: redactApiKey(raw[src]),
    doc: SOURCE_DOCS[src],
  }))

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">External API keys</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Per-org keys for paid / registration-only data sources. Adapters
          without a key here will skip themselves gracefully — the Drift
          Dashboard will show <span className="font-mono">api_key_missing</span> on the
          affected cards. Keys are stored in <code className="font-mono">Organization.settings</code>;
          v1 is plain JSON (encrypted column coming in v1.1).
        </p>
      </header>

      <ApiKeysForm initial={initial} />

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-900/40">
        <h2 className="mb-2 font-medium">What happens when I clear a key?</h2>
        <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>The corresponding adapter starts returning <span className="font-mono">api_key_missing</span> on every scheduler run.</li>
          <li>No data is deleted — previously-ingested points stay in the database; they just age out / drift to STALE.</li>
          <li>Re-enter the key any time to resume ingestion.</li>
        </ul>
      </section>
    </div>
  )
}
