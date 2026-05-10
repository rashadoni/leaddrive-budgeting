/**
 * Phase 7.G Turn LXXXXVI (Phase 7.B v2 Day 3) — pure structure-hash function.
 *
 * Computes a deterministic sha256 over `MapperInput`'s STRUCTURAL shape
 * (column headers + sample TYPES, NOT values). Identical xlsx structure
 * (e.g. same template across 5 sub-entities) hits the same hash.
 *
 * Cache key for AI mapper proposal cache. Excludes:
 * - sourceFile / sourceSheet / companyName (per-instance — same template
 *   uploaded 5× would never hit cache otherwise)
 * - actual sample VALUES (only TYPES matter for column-mapping inference)
 * - sampleRows VALUES (same reasoning — TYPES only)
 *
 * Includes:
 * - column count + headerText + per-column sample TYPES
 * - sampleRows shape (rows × types per cell)
 * - companyContext.industry (LLM uses for category hints)
 * - language hint (output prose language affects prompt — though current
 *   mapper-system.ts is locale-agnostic; future EN/RU/AZ output bumps cache)
 */

import { createHash } from "node:crypto"
import type { MapperInput } from "./types"

type CellType = "number" | "string" | "null" | "boolean"

function typeOf(v: unknown): CellType {
  if (v === null || v === undefined) return "null"
  if (typeof v === "number") return "number"
  if (typeof v === "boolean") return "boolean"
  return "string"
}

export function computeStructureHash(input: MapperInput, language: string = "en"): string {
  const shape = {
    columns: input.columns.map((c) => ({
      headerText: c.headerText,
      sampleTypes: c.samples.map(typeOf),
    })),
    sampleRowsShape: input.sampleRows.map((row) =>
      row.map(typeOf),
    ),
    industry: input.companyContext?.industry ?? null,
    language,
  }
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex")
}
