"use client"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Sun, Moon, LogOut } from "lucide-react"
import { signOut } from "next-auth/react"
import { LanguageSwitcher } from "@/components/language-switcher"
import { useTranslations } from "next-intl"

interface HeaderProps {
  orgName?: string
  userName?: string
  compact?: boolean
}

export function Header({ orgName = "BudgetPro", userName = "User", compact = false }: HeaderProps) {
  const t = useTranslations("auth")
  const tc = useTranslations("common")
  const { theme, setTheme } = useTheme()

  return (
    <header className={`flex ${compact ? "h-10 px-4" : "h-14 px-6"} items-center justify-between border-b border-border/40 bg-card backdrop-blur-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)]`}>
      <div className="flex items-center gap-4">
        <span className="text-sm font-semibold text-foreground">{orgName}</span>
      </div>

      <div className="flex items-center gap-2">
        <LanguageSwitcher />

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={tc("toggleTheme")}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        <div className="ml-2 flex items-center gap-2 border-l border-border/40 pl-4">
          <div className={`${compact ? "h-6 w-6" : "h-8 w-8"} rounded-full bg-primary flex items-center justify-center text-xs font-medium text-primary-foreground`}>
            {userName.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm font-medium hidden md:block">{userName}</span>
          <Button variant="ghost" size="icon" onClick={() => signOut({ callbackUrl: "/login" })} title={t("signOut")}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  )
}
