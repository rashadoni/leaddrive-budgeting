/**
 * Owner-approved aliases for free external-news lookup.
 *
 * These are deliberately separate from `settings.entityAliases`, which is an
 * import-routing dictionary. A short import alias such as `CPC` or `MALT`
 * is unsafe as a public-web query and must not become news evidence.
 */

export const PILOT_COMPANY_CODES = [
  "AZSEKER-AZSF",
  "AZSEKER-CPC",
  "AZSEKER-EDEN",
  "AZSEKER-MALT",
] as const;

const MAX_ALIASES_PER_COMPANY = 5;
const MIN_ALIAS_LENGTH = 6;
const FORBIDDEN_BARE_ALIASES = new Set(["CPC", "MALT"]);

export type ApprovedNewsAliases = Map<string, string[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeAlias(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Parse `Organization.settings.newsEntityAliases`.
 *
 * Only aliases supplied by the owner, assigned to an existing pilot code, and
 * sufficiently specific are eligible. Invalid aliases are ignored rather than
 * guessed; callers surface the resulting empty set as a fail-closed skip.
 */
export function readApprovedNewsAliases(
  settings: unknown,
  allowedCompanyCodes: ReadonlySet<string>,
): ApprovedNewsAliases {
  const out: ApprovedNewsAliases = new Map();
  if (!isRecord(settings) || !isRecord(settings.newsEntityAliases)) return out;

  for (const [companyCode, rawAliases] of Object.entries(settings.newsEntityAliases)) {
    if (!allowedCompanyCodes.has(companyCode) || !Array.isArray(rawAliases)) continue;

    const seen = new Set<string>();
    const aliases: string[] = [];
    for (const rawAlias of rawAliases) {
      if (typeof rawAlias !== "string") continue;
      const alias = normalizeAlias(rawAlias);
      const key = alias.toLocaleLowerCase();
      if (
        alias.length < MIN_ALIAS_LENGTH ||
        alias.length > 160 ||
        /[\u0000-\u001F\u007F]/.test(alias) ||
        FORBIDDEN_BARE_ALIASES.has(alias.toUpperCase()) ||
        alias.toUpperCase() === companyCode.toUpperCase() ||
        seen.has(key)
      ) {
        continue;
      }
      seen.add(key);
      aliases.push(alias);
      if (aliases.length === MAX_ALIASES_PER_COMPANY) break;
    }
    if (aliases.length > 0) out.set(companyCode, aliases);
  }

  return out;
}

/** Escape a phrase for GDELT's quoted query grammar. */
function quoteQueryPhrase(alias: string): string {
  return `"${alias.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Build one bounded exact-phrase query for a company. The aliases have already
 * passed the public-web safety gate above; URL encoding happens in gdelt.ts.
 */
export function buildCompanyNewsQuery(aliases: readonly string[]): string | null {
  if (aliases.length === 0) return null;
  const phrases = aliases.slice(0, MAX_ALIASES_PER_COMPANY).map(quoteQueryPhrase);
  return phrases.length === 1 ? phrases[0] : `(${phrases.join(" OR ")})`;
}
