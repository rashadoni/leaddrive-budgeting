"use client"

import { useTranslations } from "next-intl"
import { AlertRulesEditor } from "@/features/settings/components/AlertRulesEditor"
import { PasswordChangeForm } from "@/features/settings/components/PasswordChangeForm"

export default function SettingsPage() {
  const t = useTranslations("nav")
  return (
    <div className="space-y-6 animate-fade-in-up">
      <h1 className="text-2xl font-bold text-foreground">{t("settings")}</h1>
      <PasswordChangeForm />
      <AlertRulesEditor />
    </div>
  )
}
