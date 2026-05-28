import { getRequestConfig } from "next-intl/server"
import { headers } from "next/headers"
import { defaultLocale, locales, type Locale } from "./routing"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("i18n:request")

export default getRequestConfig(async () => {
  const headersList = await headers()
  const localeHeader = headersList.get("x-locale")
  const locale = (locales.includes(localeHeader as Locale) ? localeHeader : defaultLocale) as Locale

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    onError(error) {
      if (error.code === "MISSING_MESSAGE") return
      log.error("intl error", {
        code: error.code,
        message: error.message,
      })
    },
    getMessageFallback({ key, namespace }) {
      return namespace ? `${namespace}.${key}` : key
    },
  }
})
