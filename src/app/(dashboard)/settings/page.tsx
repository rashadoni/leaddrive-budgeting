"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function SettingsPage() {
  return (
    <div className="space-y-6 animate-fade-in-up">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Settings will be available after initial setup.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
