import { getTranslations } from "next-intl/server"
import { TradeMasterData } from "@/features/trade/components/TradeMasterData"
import { TradeCampaigns } from "@/features/trade/components/TradeCampaigns"
import { TradeAlertInbox } from "@/features/trade/components/TradeAlertInbox"
import { TradeBudget } from "@/features/trade/components/TradeBudget"
import { TradePacing } from "@/features/trade/components/TradePacing"
import { TradeSpend } from "@/features/trade/components/TradeSpend"

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
      <TradePacing />
      <TradeAlertInbox />
      <TradeSpend />
      <TradeBudget />
      <TradeCampaigns />
      <TradeMasterData />
    </div>
  )
}
