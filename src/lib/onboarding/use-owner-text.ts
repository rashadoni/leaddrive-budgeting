import { useTranslations } from "next-intl";

/**
 * Localize the data-owner role / scope strings produced by
 * `indicator-owner-map.ts`.
 *
 * The owner map is a pure data module shared by server + client, so it can't
 * call `useTranslations` — it emits an English string plus a stable i18n key.
 * This hook resolves the key against `adminIndicatorBacklog.ownerRole.*` /
 * `.ownerScope.*` and falls back to the English string when there is no key
 * (an organization that configured its own `Organization.settings.dataOwners`
 * writes free text, which must render exactly as typed).
 */
export function useOwnerText(): {
  role: (o: { role: string; roleKey?: string }) => string;
  scope: (o: { scope?: string; scopeKey?: string }) => string | undefined;
} {
  const t = useTranslations("adminIndicatorBacklog");
  return {
    role: (o) => {
      const key = `ownerRole.${o.roleKey}`;
      return o.roleKey && t.has(key as never) ? t(key as never) : o.role;
    },
    scope: (o) => {
      const key = `ownerScope.${o.scopeKey}`;
      return o.scopeKey && t.has(key as never) ? t(key as never) : o.scope;
    },
  };
}
