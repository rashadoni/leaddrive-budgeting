/**
 * Phase 7.B v2 Day 5 — AI Mapper template library API.
 *
 * Exposes the `promoteCacheEntryToTemplate` / `listTemplates` library
 * functions over HTTP so the ImportWizard can:
 *   - List the org's saved templates ("Templates" panel)
 *   - Promote a fresh cache entry to a permanent template after the
 *     user signs off on the mapping
 *
 * Template = an `AIMapperProposalCache` row with `isTemplate=true`.
 * The cache key `(orgId, structureHash, promptVersion, modelName)`
 * matches workbooks with identical column-structure (same shape, any
 * values), so the next upload of an AZMADE-shaped P&L hits the template
 * cache and skips the LLM call entirely.
 *
 * Auth: `manager` role + org-scoped. Templates carry mapping intent
 * that affects how raw xlsx rows land in `BudgetLine` — viewer-tier
 * users shouldn't be able to create or revoke them.
 */

import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import {
  listTemplates,
  promoteCacheEntryToTemplate,
} from "@/lib/onboarding/ai-mapper/proposal-cache"
import type { MapperInput } from "@/lib/onboarding/ai-mapper/types"

// Promote is a single small DB write — generous limit; the surrounding
// /analyze endpoint (which produced the cache entry being promoted) is
// the actual rate-limited surface.
const PROMOTE_RATE_LIMIT = { name: "ai-mapper-template-promote", max: 30, windowMs: 60_000 }
const LIST_RATE_LIMIT = { name: "ai-mapper-template-list", max: 60, windowMs: 60_000 }

// MapperInput shape (mirrors `src/lib/onboarding/ai-mapper/types.ts`).
// Validated here so a malformed promote request can't poison the
// structureHash computation downstream.
const sourceColumnSchema = z.object({
  index: z.number().int().min(0),
  headerText: z.string().max(255),
  samples: z.array(z.union([z.string(), z.number(), z.null()])).max(10),
})

const mapperInputSchema = z.object({
  sourceFile: z.string().min(1).max(255),
  sourceSheet: z.string().min(1).max(255),
  columns: z.array(sourceColumnSchema).min(1).max(200),
  sampleRows: z
    .array(z.array(z.union([z.string(), z.number(), z.null()])).max(200))
    .max(30),
  companyContext: z
    .object({
      name: z.string().max(255).optional(),
      industry: z.string().max(64).optional(),
    })
    .optional(),
})

const promoteRequestSchema = z.object({
  input: mapperInputSchema,
  templateName: z.string().trim().min(1).max(120),
  language: z.string().min(2).max(8).default("en"),
})

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const rateLimitError = enforceRateLimit(
    `${session.orgId}:${getClientIp(request)}`,
    LIST_RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  const templates = await listTemplates(session.orgId)
  return NextResponse.json({ templates })
}

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const rateLimitError = enforceRateLimit(
    `${session.orgId}:${getClientIp(request)}`,
    PROMOTE_RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let parsed
  try {
    parsed = promoteRequestSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const ok = await promoteCacheEntryToTemplate(
    session.orgId,
    parsed.input as MapperInput,
    parsed.templateName,
    parsed.language,
  )

  if (!ok) {
    // No cache entry exists for the given structure — the caller must
    // run /analyze first to populate the cache, THEN promote. 404 makes
    // this distinguishable from 500 (server error) at the client.
    return NextResponse.json(
      {
        error:
          "No cache entry exists for this MapperInput structure. Run /api/onboarding/import/analyze first to populate the cache, then promote.",
      },
      { status: 404 },
    )
  }

  return NextResponse.json({ promoted: true, templateName: parsed.templateName })
}
