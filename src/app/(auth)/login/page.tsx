"use client"

import { useState, useEffect, useRef } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LanguageSwitcher } from "@/components/language-switcher"

export default function LoginPage() {
  const router = useRouter()
  const t = useTranslations("auth")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [passwordChanged, setPasswordChanged] = useState(false)
  const [loading, setLoading] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    setPasswordChanged(
      new URLSearchParams(window.location.search).get("passwordChanged") === "1",
    )
    const video = videoRef.current
    if (!video) return
    video.muted = true
    video.play().catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    })

    if (result?.error) {
      setError(t("invalidCredentials"))
      setLoading(false)
    } else {
      // 2026-07-31 (11.55) — land on the P&L, not the generic workspace.
      // Signing in and being shown a chooser is a wasted click: the profit &
      // loss statement is what everyone opens first, and on demo day it is
      // what the client wants to see the moment the session starts.
      router.push("/budgeting?tab=pnl-report")
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden">
      {/* Video background */}
      <div className="fixed inset-0 z-0">
        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          src="/wallpapers/login-bg.mp4"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-black/50" />
      </div>

      {/* Language switcher — anonymous users can pick EN/RU/AZ before login;
          the NEXT_LOCALE cookie persists into the app after sign-in. */}
      <div className="absolute right-4 top-4 z-20">
        <LanguageSwitcher buttonClassName="text-white/80 hover:text-white hover:bg-white/10" />
      </div>

      {/* Login form */}
      <div className="relative z-10 w-full max-w-sm space-y-6 rounded-2xl border border-white/10 bg-black/40 p-8 backdrop-blur-xl shadow-2xl">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-xl font-bold text-white">
            B
          </div>
          <h1 className="text-2xl font-bold text-white">BudgetPro</h1>
          <p className="mt-1 text-sm text-white/60">
            {t("signInToAccount")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {passwordChanged && (
            <div
              className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100"
              role="status"
            >
              {t("passwordChanged")}
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="login-email" className="text-sm font-medium text-white/80">{t("email")}</label>
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@company.com"
              required
              autoComplete="email"
              className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="login-password" className="text-sm font-medium text-white/80">{t("password")}</label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              required
              autoComplete="current-password"
              className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("signingIn") : t("signIn")}
          </Button>
        </form>
      </div>
    </div>
  )
}
