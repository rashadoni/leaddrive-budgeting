import { createHash } from "node:crypto"

/**
 * Private metadata key persisted alongside an ImportStaging proposal.
 *
 * The structure hash protects column-index mappings, but deliberately ignores
 * cell values. This byte-exact digest binds apply to the workbook that was
 * actually reviewed during analyze.
 */
export const WORKBOOK_CONTENT_HASH_KEY = "__workbookContentSha256" as const

const SHA256_HEX = /^[0-9a-f]{64}$/

export function computeWorkbookContentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/**
 * Read a server-written workbook digest from the staged proposal.
 * Missing or malformed metadata is intentionally treated as unverifiable.
 */
export function getStagedWorkbookContentHash(proposal: unknown): string | null {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) return null
  const value = (proposal as Record<string, unknown>)[WORKBOOK_CONTENT_HASH_KEY]
  return typeof value === "string" && SHA256_HEX.test(value) ? value : null
}

export type WorkbookContentVerification = "match" | "missing" | "mismatch"

export function verifyStagedWorkbookContent(
  proposal: unknown,
  bytes: Uint8Array,
): WorkbookContentVerification {
  const stagedHash = getStagedWorkbookContentHash(proposal)
  if (!stagedHash) return "missing"
  return computeWorkbookContentHash(bytes) === stagedHash ? "match" : "mismatch"
}
