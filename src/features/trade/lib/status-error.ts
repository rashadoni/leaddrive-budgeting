// R6 (deferred item) — map HTTP statuses to trade.errors.* i18n keys so
// the UI never shows a bare English server string as the primary text.
// The server detail stays appended in parentheses (validation messages
// are genuinely useful), just no longer alone.

export function statusErrorKey(status: number): "locked" | "forbidden" | "conflict" | "validation" | "generic" {
  if (status === 423) return "locked";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "validation";
  return "generic";
}

export function formatApiError(
  t: (key: string) => string,
  status: number,
  detail?: string | null
): string {
  const base = t(statusErrorKey(status));
  return detail ? `${base} (${detail})` : base;
}
