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
import { getTranslations } from "next-intl/server"
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
  // Phase 8 C4 (2026-05-28) — per-org Anthropic key. When set the
  // org's key is used for Variance Explainer / Forecast Explainer /
  // Board Deck narration / Morning Brief instead of the global env
  // ANTHROPIC_API_KEY. Spend lands on the org's Anthropic billing.
  anthropic: {
    name: "Anthropic (Claude API)",
    signupUrl: "https://console.anthropic.com/settings/keys",
    notes:
      "Paid (~$3 / 1M input tokens for Sonnet 4.5). Powers AI Variance Explainer, Forecast Explainer, Board Deck narration, Morning Brief, and impact-forecast scans. When set, your org's key replaces the global server key — spend hits your Anthropic billing.",
    sectors: ["all"],
  },
}

export default async function ApiKeysPage() {
  const t = await getTranslations("adminApiKeys")
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
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t.rich("subtitle", {
            code: (chunks) => <code className="font-mono">{chunks}</code>,
            mono: (chunks) => <span className="font-mono">{chunks}</span>,
          })}
        </p>
      </header>

      <ApiKeysForm initial={initial} />

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-900/40">
        <h2 className="mb-2 font-medium">{t("clearSection.title")}</h2>
        <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>
            {t.rich("clearSection.bullet1", {
              mono: (chunks) => <span className="font-mono">{chunks}</span>,
            })}
          </li>
          <li>{t("clearSection.bullet2")}</li>
          <li>{t("clearSection.bullet3")}</li>
        </ul>
      </section>
    </div>
  )
}
