"use client"

import { AlertRulesEditor } from "@/features/settings/components/AlertRulesEditor"

export default function SettingsPage() {
  return (
    <div className="space-y-6 animate-fade-in-up">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>
      <AlertRulesEditor />
    </div>
  )
}
