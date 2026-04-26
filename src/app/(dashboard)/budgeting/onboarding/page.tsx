import { ImportWizard } from "@/features/onboarding/components/ImportWizard"

export const metadata = {
  title: "Onboarding — AI Data Mapper",
}

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
        <p className="text-sm text-muted-foreground">
          Upload a budget xlsx, let the AI Data Mapper propose how its columns
          map to the holding chart of accounts, review and apply.
        </p>
      </header>
      <ImportWizard />
    </div>
  )
}
