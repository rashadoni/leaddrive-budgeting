import { getTranslations } from "next-intl/server"
import { TradeMasterData } from "@/features/trade/components/TradeMasterData"
import { TradeCampaigns } from "@/features/trade/components/TradeCampaigns"

export async function generateMetadata() {
  const t = await getTranslations("trade")
  return { title: t("metaTitle") }
}

export default async function TradePage() {
  const t = await getTranslations("trade")
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageSubtitle")}</p>
      </header>
      <TradeCampaigns />
      <TradeMasterData />
    </div>
  )
}
