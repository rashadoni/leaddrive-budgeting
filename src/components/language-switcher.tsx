"use client"

import { Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslations } from "next-intl"

const LANGUAGE_CODES = ["ru", "az", "en"] as const
const LANGUAGE_KEYS: Record<string, string> = {
  ru: "langRussian",
  az: "langAzerbaijani",
  en: "langEnglish",
}

function getLocaleFromCookie(): string {
  if (typeof document === "undefined") return "en"
  return (
    document.cookie
      .split("; ")
      .find((row) => row.startsWith("NEXT_LOCALE="))
      ?.split("=")[1] || "ru"
  )
}

export function LanguageSwitcher() {
  const tc = useTranslations("common")
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState("en")
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCurrent(getLocaleFromCookie())
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  function toggleOpen() {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      })
    }
    setOpen(!open)
  }

  function switchLocale(locale: string) {
    document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=${365 * 24 * 60 * 60}`
    window.location.reload()
  }

  const currentLabel = tc(LANGUAGE_KEYS[current] || "langRussian")

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleOpen}
        title={currentLabel}
      >
        <Globe className="h-4 w-4" />
      </Button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] min-w-[140px] rounded-md border bg-popover shadow-lg animate-in fade-in slide-in-from-top-1 duration-150"
          style={{ top: pos.top, right: pos.right }}
        >
          {LANGUAGE_CODES.map((code) => (
            <button
              key={code}
              onClick={() => switchLocale(code)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground first:rounded-t-md last:rounded-b-md ${
                code === current ? "font-semibold text-primary" : "text-foreground"
              }`}
            >
              {tc(LANGUAGE_KEYS[code])}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
