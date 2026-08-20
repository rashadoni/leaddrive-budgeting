"use client"

import * as React from "react"
import { signOut } from "next-auth/react"
import { useTranslations } from "next-intl"
import { KeyRound, Loader2, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 64
const MAX_PASSWORD_BYTES = 72

type FormError =
  | "mismatch"
  | "invalidPassword"
  | "tooManyBytes"
  | "reuse"
  | "currentIncorrect"
  | "rateLimited"
  | "sessionInvalid"
  | "conflict"
  | "secureRequired"
  | "generic"

function formErrorForCode(code: unknown): FormError {
  switch (code) {
    case "INVALID_PASSWORD":
      return "invalidPassword"
    case "PASSWORD_TOO_MANY_BYTES":
      return "tooManyBytes"
    case "PASSWORD_REUSE":
      return "reuse"
    case "CURRENT_PASSWORD_INCORRECT":
      return "currentIncorrect"
    case "SESSION_INVALID":
      return "sessionInvalid"
    case "PASSWORD_CONFLICT":
      return "conflict"
    case "SECURE_TRANSPORT_REQUIRED":
      return "secureRequired"
    default:
      return "generic"
  }
}

export function PasswordChangeForm() {
  const t = useTranslations("accountSettings.password")
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [error, setError] = React.useState<FormError | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [secureTransport, setSecureTransport] = React.useState<boolean | null>(
    null,
  )

  React.useEffect(() => {
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(
      window.location.hostname,
    )
    setSecureTransport(window.location.protocol === "https:" || localHost)
  }, [])

  function clearSecrets() {
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!secureTransport) {
      setError("secureRequired")
      clearSecrets()
      return
    }
    if (newPassword !== confirmPassword) {
      setError("mismatch")
      clearSecrets()
      return
    }
    if (
      newPassword.length < MIN_PASSWORD_LENGTH ||
      newPassword.length > MAX_PASSWORD_LENGTH
    ) {
      setError("invalidPassword")
      clearSecrets()
      return
    }
    if (new TextEncoder().encode(newPassword).length > MAX_PASSWORD_BYTES) {
      setError("tooManyBytes")
      clearSecrets()
      return
    }
    if (currentPassword === newPassword) {
      setError("reuse")
      clearSecrets()
      return
    }

    setSaving(true)
    try {
      const response = await fetch("/api/account/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const body = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(
          response.status === 429
            ? "rateLimited"
            : formErrorForCode(body?.code),
        )
        clearSecrets()
        return
      }

      clearSecrets()
      // The password is already committed. Do not let a logout transport
      // failure fall into the mutation error path and falsely claim otherwise.
      void signOut({ callbackUrl: "/login?passwordChanged=1" }).finally(() => {
        window.location.assign("/login?passwordChanged=1")
      })
      return
    } catch {
      setError("generic")
      clearSecrets()
    } finally {
      setSaving(false)
    }
  }

  const disabled = saving || secureTransport !== true

  return (
    <Card data-testid="password-change-form" className="max-w-3xl">
      <CardHeader className="gap-1">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <CardTitle className="text-base">{t("title")}</CardTitle>
            <CardDescription className="mt-1 max-w-[70ch]">
              {t("description")}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {secureTransport === false && (
          <div
            className="mb-5 flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-foreground"
            role="alert"
          >
            <ShieldAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <p>{t("secureRequired")}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="max-w-xl space-y-5">
          <div className="space-y-2">
            <Label htmlFor="current-password">{t("current")}</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={disabled}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-password">{t("new")}</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                aria-describedby="password-policy"
                disabled={disabled}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t("confirm")}</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                disabled={disabled}
                required
              />
            </div>
          </div>

          <p id="password-policy" className="text-xs text-muted-foreground">
            {t("policy")}
          </p>

          {error && (
            <p className="text-sm text-destructive" role="alert" aria-live="polite">
              {t(`errors.${error}`)}
            </p>
          )}

          <Button type="submit" disabled={disabled} className="min-w-40">
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                {t("saving")}
              </>
            ) : (
              t("submit")
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
