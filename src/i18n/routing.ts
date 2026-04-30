export const locales = ["en", "ru", "az"] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = "en"

/**
 * Cookie name for the user's selected locale. `NEXT_LOCALE` is the
 * canonical next-intl convention (matches the framework default; see
 * `node_modules/next-intl/dist/esm/development/routing/config.js`
 * `name: 'NEXT_LOCALE'`).
 *
 * Wire chain (sub-32 fix anchor):
 *   1. `LanguageSwitcher.tsx` writes `NEXT_LOCALE` cookie + reloads
 *   2. `proxy.ts` reads `NEXT_LOCALE` cookie + injects `x-locale` on
 *      REQUEST headers via `NextResponse.next({ request: {...} })`
 *   3. `i18n/request.ts` reads `x-locale` via `headers()` from
 *      `next/headers` (request scope) and resolves the right messages
 *      bundle
 *
 * Any change here MUST update both proxy + LanguageSwitcher in lockstep.
 */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE"
