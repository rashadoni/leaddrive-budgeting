import { getTranslations } from "next-intl/server"
import { OnboardingWizardSwitcher } from "@/features/onboarding/components/OnboardingWizardSwitcher"

export async function generateMetadata() {
  const t = await getTranslations("onboarding")
  return { title: t("metaTitle") }
}

export default async function OnboardingPage() {
  const t = await getTranslations("onboarding")
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageSubtitle")}</p>
      </header>
      <OnboardingWizardSwitcher />
    </div>
  )
}
