import { getRequestConfig } from "next-intl/server"
import { headers } from "next/headers"
import { defaultLocale, locales, type Locale } from "./routing"

export default getRequestConfig(async () => {
  const headersList = await headers()
  const localeHeader = headersList.get("x-locale")
  const locale = (locales.includes(localeHeader as Locale) ? localeHeader : defaultLocale) as Locale

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    onError(error) {
      if (error.code === "MISSING_MESSAGE") return
      console.error(error)
    },
    getMessageFallback({ key, namespace }) {
      return namespace ? `${namespace}.${key}` : key
    },
  }
})
