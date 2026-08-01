/**
 * Phase 7.M Step 4d (2026-05-18) — self-service archive API.
 *
 * POST /api/admin/data-archive
 *   body: {
 *     mode: "archive" | "restore",
 *     entityKind: "BudgetLine" | "BalanceSheetLine" | "CashFlowEntry"
 *               | "Counterparty",
 *     companyCode?: string,
 *     year?: number,
 *     period?: string,
 *     reason?: string,
 *     confirmCode: string,   // must equal companyCode (or "ALL" for org-wide)
 *     archivedAt?: string,   // RESTORE ONLY, required — ISO-8601, the exact
 *                            // `metadata.archivedAt` of the audit event being
 *                            // undone. Identifies ONE archive generation.
 *   }
 *
 * Behaviour
 * ─────────
 *  • Admin-role only (LLM-token-equivalent cost: re-recompute fires
 *    on archived periods).
 *  • Rate limited 5/min/org so a stuck UI loop can't blast 100 archives.
 *  • `confirmCode` must match the scope being archived — a strong
 *    visual safety net (the page asks the user to type the entity
 *    code before the Archive button enables). Mismatch = 400.
 *  • Returns `{ ok: true, rowsAffected, auditEventId }`.
 *  • All writes happen in `archiveRows()` which wraps the soft-delete
 *    UPDATE + audit-event INSERT in a single `prisma.$transaction`.
 *  • Never deletes physically. The cleanup job (separate cron, not in
 *    this route) purges soft-deleted rows past `SOFT_DELETE_TTL_MS` — 30
 *    days, in `src/lib/cleanup/soft-delete-cleanup.ts`. This comment used to
 *    say 90; that constant was deleted on 2026-07-31 for being three times
 *    the window the job actually enforces.
 *
 * Restore is per-OPERATION, not per-scope
 * ───────────────────────────────────────
 * `mode: "restore"` requires `archivedAt`. Restoring by scope alone brings
 * back every archived generation of that company-year at once — on production
 * that was up to three import generations, i.e. multiplied financial
 * statements. A restore with no key is refused (400); it is never widened.
 *
 * Why a single endpoint for archive + restore
 * ───────────────────────────────────────────
 * The scope payload is identical; only the verb differs. One route
 * with a `mode` discriminator keeps the surface small and lets a
 * future "undo last archive" feature share validation.
 */
// rls-scan-ignore: admin-only archive/restore/reset orchestrator (maxDuration
// 120). It fans out per-company through archiveRows / restoreRows /
// resetCompanyImportData / archiveOrgOrphanBudgetLines — each opening its OWN
// prisma.$transaction — plus runRecomputeForCompanies. Nested interactive
// transactions aren't allowed and the recompute can't live in one 5s tx, so a
// single withOrgScope is architecturally infeasible. Every query is
// orgId-scoped in code; it runs on the BYPASSRLS `prismaAdmin` client (passed
// into the helpers too).
import { NextRequest, NextResponse } from "next/server"
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { getLogger } from "@/lib/log"

// Phase 8 D4 final (2026-05-29) — structured logger.
const log = getLogger("api:admin:data-archive")
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import {
  archiveRows,
  MissingArchiveKeyError,
  restoreRows,
  resetCompanyImportData,
  resetOrgSalesForecast,
  archiveOrgOrphanBudgetLines,
  previewCompanyImportReset,
} from "@/lib/server/archive"
import { resolveResetCategories } from "@/lib/server/import-reset-categories"
import {
  expectedConfirmCode,
  parseCompanyCodes,
  parseDeleteSelection,
  selectedYears,
} from "@/lib/server/delete-request"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"
import { getActivePeriodLock, parseLockedPeriods } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"

const RATE_LIMIT = { name: "data-archive", max: 5, windowMs: 60_000 }

const VALID_KINDS = new Set([
  "BudgetLine",
  "BalanceSheetLine",
  "CashFlowEntry",
  "Counterparty",
  // Meta-kind: full "reset a company's imported data" (no-tails) — clears every
  // table + settings key an import writes, then recomputes. Archive-only.
  "AllImportData",
])

interface ArchiveBody {
  mode?: unknown
  entityKind?: unknown
  companyCode?: unknown
  /** AllImportData (reset) only — multiple companies / whole holding in one go. */
  companyCodes?: unknown
  year?: unknown
  /** AllImportData only — several calendar years in one action. */
  years?: unknown
  /** AllImportData only — which kinds of data to delete. */
  include?: unknown
  includeUnscoped?: unknown
  includeManualActuals?: unknown
  /**
   * The row count the operator read on screen. Re-counted server-side before
   * any write; a mismatch is a 409 and nothing is deleted.
   */
  expectRows?: unknown
  period?: unknown
  reason?: unknown
  confirmCode?: unknown
  /** restore only — ISO-8601 `metadata.archivedAt` of the event being undone. */
  archivedAt?: unknown
}

// A whole-holding reset loops per-company (delete + recompute) — give it room.
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(
    `${RATE_LIMIT.name}:${orgId}:${session.userId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  let body: ArchiveBody
  try {
    body = (await request.json()) as ArchiveBody
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    )
  }

  const mode = body.mode
  if (mode !== "archive" && mode !== "restore") {
    return NextResponse.json(
      { error: "mode must be 'archive' or 'restore'" },
      { status: 400 },
    )
  }

  const entityKind = body.entityKind
  if (typeof entityKind !== "string" || !VALID_KINDS.has(entityKind)) {
    return NextResponse.json(
      {
        error:
          "entityKind must be one of: BudgetLine, BalanceSheetLine, CashFlowEntry, Counterparty, AllImportData",
      },
      { status: 400 },
    )
  }

  const companyCode =
    typeof body.companyCode === "string" && body.companyCode.length > 0
      ? body.companyCode
      : undefined
  // Reset can target several companies (or the whole holding) at once. Dedup +
  // drop blanks; cap to a sane ceiling so a malformed payload can't fan out.
  const companyCodes = Array.isArray(body.companyCodes)
    ? parseCompanyCodes({ companyCodes: body.companyCodes })
    : undefined
  // Parsed by the SAME helper the preview endpoint uses, so the scope the
  // operator watched being counted is byte-for-byte the scope deleted here.
  const selection = parseDeleteSelection(body)
  const year = selection.year
  const period =
    typeof body.period === "string" && body.period.length > 0
      ? body.period
      : undefined
  const reason =
    typeof body.reason === "string" && body.reason.length > 0
      ? body.reason.slice(0, 500)
      : undefined
  const confirmCode =
    typeof body.confirmCode === "string" ? body.confirmCode : ""

  // Defensive: confirmCode acts as the "type the entity code to confirm"
  // safety pattern. The rule itself now lives in `expectedConfirmCode` and is
  // shared with the client's confirmation gate — see the note in
  // `delete-request.ts`. It used to be spelled out here AND guessed again in
  // `tier.ts`, and the two disagreed for every single-company scope.
  const expectedConfirm = expectedConfirmCode(body)
  if (confirmCode !== expectedConfirm) {
    return NextResponse.json(
      {
        error: `confirmCode must equal "${expectedConfirm}" — type the entity code to confirm`,
      },
      { status: 400 },
    )
  }

  const scope = {
    organizationId: orgId,
    entityKind: entityKind as
      | "BudgetLine"
      | "BalanceSheetLine"
      | "CashFlowEntry"
      | "Counterparty",
    companyCode,
    year,
    period,
  }

  // ── AllImportData — full reset (no-tails) + recompute, for one or many
  //    companies (or the whole holding) in a single action ─────────────────
  if (entityKind === "AllImportData") {
    if (mode !== "archive") {
      return NextResponse.json(
        { error: "AllImportData supports mode 'archive' only — a reset isn't restorable; re-import to restore" },
        { status: 400 },
      )
    }
    // Accept a single companyCode (back-compat) OR companyCodes[] (multi / whole
    // holding). The confirm gate already required the literal "ALL" whenever no
    // single companyCode was given, so a bulk wipe can't be fat-fingered.
    const codes =
      companyCodes && companyCodes.length > 0
        ? companyCodes
        : companyCode
          ? [companyCode]
          : []
    if (codes.length === 0) {
      return NextResponse.json(
        { error: "AllImportData requires at least one company (companyCode or companyCodes)" },
        { status: 400 },
      )
    }
    // Resolve + validate EVERY code belongs to this org BEFORE any delete — a
    // single unknown code aborts the whole batch (no partial wipe on a typo).
    const targets = await prisma.company.findMany({
      where: { organizationId: orgId, code: { in: codes } },
      select: { id: true, code: true },
    })
    const found = new Set(targets.map((c) => c.code))
    const missing = codes.filter((c) => !found.has(c))
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Unknown companies for this org: ${missing.join(", ")}` },
        { status: 400 },
      )
    }
    // Whole-holding reset? Only then do we sweep org-level ORPHAN lines
    // (companyId = NULL) — the un-attributed import residue a per-company WHERE
    // can't reach. A partial selection leaves them (we can't attribute an
    // un-owned line to a subset). "Whole holding" = every OPERATIONAL company
    // (level > 1) targeted — matching the picker the UI offers (page.tsx filters
    // `level: { gt: 1 }`, so a level-1 subgroup parent must NOT gate this off).
    const operationalCompanies = await prisma.company.findMany({
      where: { organizationId: orgId, isActive: true, level: { gt: 1 } },
      select: { code: true },
    })
    const isWholeHolding =
      operationalCompanies.length > 0 && operationalCompanies.every((c) => found.has(c.code))
    // Phase 11.13 (2026-07-29) — period-lock gate. A signed, closed period
    // must not be silently wiped. Every interactive mutation route already
    // gates on this; the reset — the single most destructive operation in the
    // product — did not, so a locked year could be erased while the audit
    // trail recorded only a routine `data_reset`. Checked BEFORE the loop so
    // a locked year deletes nothing at all rather than partially.
    const targetYears = selectedYears(selection)
    if (targetYears.length > 0) {
      // EVERY year in the list is tested — a two-year delete whose second
      // year is closed must be refused whole, not applied by half.
      for (const y of targetYears) {
        const lock = await getActivePeriodLock(prisma, orgId, String(y))
        if (lock) {
          return lockedResponse(lock, {
            prisma,
            orgId,
            userId: session.userId ?? null,
            route: "POST /api/admin/data-archive",
          })
        }
      }
    } else {
      // Phase 11.39 (2026-07-29) — the gate above only ran when a year was
      // GIVEN, and the UI's year field is optional with "blank = all years".
      // So the wider operation had the weaker check: an all-years reset
      // covers every period by definition — including every locked one — and
      // it sailed through while a single-year reset of the same data was
      // refused. One blank field turned the lock into decoration.
      //
      // An all-years reset is refused while ANY lock is active. Not narrowed
      // to "locks that match data being deleted": a lock is a statement that
      // a period is closed, and the operator wiping everything can either
      // name a year (and pass through the precise gate above) or release the
      // lock first — both leave an audit trail.
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { lockedPeriods: true },
      })
      const locks = parseLockedPeriods(org?.lockedPeriods)
      if (locks.length > 0) {
        return lockedResponse(locks[0], {
          prisma,
          orgId,
          userId: session.userId ?? null,
          route: "POST /api/admin/data-archive",
        })
      }
    }

    // ── Drift guard (2026-07-31) ───────────────────────────────────────
    // The operator confirmed one specific number. Re-count the SAME scope
    // before the first write; if the database moved on, delete nothing and
    // hand back the fresh count. This closes the read-then-write race that a
    // client-side "check again" button can only paper over.
    if (typeof body.expectRows === "number" && Number.isFinite(body.expectRows)) {
      const recount = await previewCompanyImportReset({
        prisma,
        organizationId: orgId,
        companyCodes: codes,
        ...selection,
      })
      if (recount.rowsAffected !== body.expectRows) {
        return NextResponse.json(
          {
            ok: false,
            error: "The data changed since it was checked — nothing was deleted",
            expectedRows: body.expectRows,
            actualRows: recount.rowsAffected,
            preview: recount,
          },
          { status: 409 },
        )
      }
    }

    // Per-company reset — each is its own transaction inside
    // resetCompanyImportData and writes its own `data_reset` audit event — then
    // recompute. Aggregate; on a per-company failure keep going and report it
    // rather than half-aborting (the ones that succeeded are already audited).
    let rowsAffected = 0
    let recomputed = 0
    const breakdown: Record<string, number> = {}
    const perCompany: Array<
      | { code: string; rowsAffected: number; recomputed: number }
      | { code: string; error: string }
    > = []
    for (const target of targets) {
      // 11.61 — read the years to recompute BEFORE the reset deletes them.
      //
      // The recompute below derives its year list from `IndicatorValue.period`
      // when no explicit `year` was given. That query used to run AFTER
      // `resetCompanyImportData`, which hard-deletes exactly those rows
      // (`archive.ts:815-831`) — so it came back empty, `affected` was empty,
      // and the post-reset recompute **never ran at all**. Not an edge case:
      // the UI's year field is optional and documents blank as "all years"
      // (`DataArchiveForm.tsx:51`), so the widest reset was the one that
      // silently skipped its own recompute.
      const yearsBeforeReset: number[] = targetYears.length > 0
        ? targetYears
        : Array.from(
            new Set(
              (
                await prisma.indicatorValue.findMany({
                  where: { companyId: target.id },
                  select: { period: true },
                  distinct: ["period"],
                })
              )
                // "2026" | "2026-Q2" | "2026-04" all start with the year.
                .map((r) => parseInt(r.period, 10))
                .filter((n) => Number.isFinite(n)),
            ),
          )
      let reset
      try {
        reset = await resetCompanyImportData({
          prisma,
          actorUserId: session.userId,
          reason,
          scope: { ...scope, ...selection, companyCode: target.code },
        })
      } catch (err) {
        // The reset itself failed → nothing was deleted for this company (it
        // runs in a single transaction). Record + move on.
        log.error("data-archive reset failed for company", {
          company: target.code,
          err: err instanceof Error ? err.message : String(err),
        })
        perCompany.push({ code: target.code, error: err instanceof Error ? err.message : String(err) })
        continue
      }
      // Reset SUCCEEDED — count it regardless of how recompute goes. The data is
      // already gone; a recompute hiccup must NOT mark the company as failed,
      // else companiesReset under-reports a real wipe. Codex 2026-06-21 MED.
      rowsAffected += reset.rowsAffected
      for (const [k, v] of Object.entries(reset.breakdown ?? {})) {
        breakdown[k] = (breakdown[k] ?? 0) + v
      }
      let rc = 0
      try {
        // 11.61 — captured before the reset; see the note above.
        const affected = yearsBeforeReset.map((y) => ({
          companyId: target.id,
          year: y,
        }))
        if (affected.length > 0) {
          // Phase 11.7 — the reset now deletes month/quarter IndicatorValue
          // rows (11.6), so the follow-up recompute must be able to rebuild
          // them; a year-only fan-out would leave those cells permanently
          // empty rather than recomputed.
          const r = await runRecomputeForCompanies(prisma, orgId, affected, {}, {
            granularity: "year+quarter+month",
          })
          rc = r.ok ?? 0
        }
      } catch (err) {
        // Non-fatal: the reset committed; stale IndicatorValues get cleaned by
        // the next recompute. Surface it, but don't fail the company.
        log.error("recompute after reset failed (non-fatal)", {
          company: target.code,
          err: err instanceof Error ? err.message : String(err),
        })
      }
      recomputed += rc
      perCompany.push({ code: target.code, rowsAffected: reset.rowsAffected, recomputed: rc })
    }
    const failures = perCompany.filter(
      (p): p is { code: string; error: string } => "error" in p,
    )
    // ONCE, after the per-company loop: if this was a whole-holding reset and
    // EVERY company succeeded, sweep org-level ORPHAN BudgetLines (companyId =
    // NULL un-attributed residue a per-company WHERE can't reach). Gated to
    // all-succeeded so we never leave a partial state where org rows are gone but
    // a company didn't reset (Codex 2026-06-22 MED Q3). Mixed-plans-only inside.
    let orphanRowsAffected = 0
    let orphanError: string | null = null
    let salesForecastError: string | null = null
    // Both org-level sweeps run under the SAME category gate the preview
    // counts them under — otherwise the preview promises a number the commit
    // quietly ignores, or vice versa.
    const categories = resolveResetCategories(selection.include)
    if (isWholeHolding && failures.length === 0) {
      // Phase 11.6b — SalesForecast is org-level (no company anywhere in the
      // department chain), so a per-company reset cannot reach it and a stale
      // forecast used to survive every reset AND every re-import: the import
      // only upserts departments present in the NEW file, so a dropped
      // department kept its old numbers forever. A whole-holding reset is the
      // one case where the scope is unambiguous.
      if (categories.has("salesBudgetLine")) {
        try {
          const fx = await resetOrgSalesForecast({
            prisma,
            actorUserId: session.userId,
            reason,
            organizationId: orgId,
            year: selection.year,
            years: selection.years,
          })
          if (fx.rowsAffected > 0) {
            rowsAffected += fx.rowsAffected
            breakdown.salesForecast =
              (breakdown.salesForecast ?? 0) + fx.rowsAffected
          }
        } catch (err) {
          // 2026-07-31 — this was swallowed and the response still said 200.
          // The per-company resets committed while the org-wide forecast the
          // preview counted was still sitting there: a "no tails" reset with
          // a tail, reported as success. Same treatment as the orphan sweep.
          salesForecastError = err instanceof Error ? err.message : String(err)
          log.error("org sales-forecast reset FAILED — the forecast tail remains", {
            err: salesForecastError,
          })
        }
      }
      if (categories.has("budgetLine")) {
        try {
          const orphan = await archiveOrgOrphanBudgetLines({
            prisma,
            actorUserId: session.userId,
            reason,
            organizationId: orgId,
            year: selection.year,
            years: selection.years,
          })
          orphanRowsAffected = orphan.rowsAffected
          rowsAffected += orphan.rowsAffected
          if (orphan.rowsAffected > 0) {
            breakdown.orphanBudgetLine = (breakdown.orphanBudgetLine ?? 0) + orphan.rowsAffected
          }
        } catch (err) {
        // The per-company resets COMMITTED, but the org-level orphan tail was NOT
        // removed — a "no-tails" reset that still left tails. Report non-success
        // so the operator knows to retry (Codex 2026-06-22 MED). Idempotent: a
        // re-run of the whole-holding reset re-sweeps (archived company lines no-op).
          orphanError = err instanceof Error ? err.message : String(err)
          log.error("org-orphan sweep after whole-holding reset FAILED — tails remain", {
            err: orphanError,
          })
        }
      }
    }
    const ok = failures.length === 0 && !orphanError && !salesForecastError
    return NextResponse.json(
      {
        ok,
        mode: "reset",
        rowsAffected,
        breakdown,
        orphanRowsAffected,
        recomputed,
        companiesReset: perCompany.length - failures.length,
        // Named, not counted: the 207 panel has to tell the operator WHICH
        // companies were left untouched, or "partly done" is unactionable.
        companiesFailed: failures.map((f) => f.code),
        companiesDeleted: perCompany
          .filter((p): p is { code: string; rowsAffected: number; recomputed: number } => !("error" in p))
          .map((p) => p.code),
        perCompany,
        ...(failures.length > 0
          ? { error: `${failures.length} of ${targets.length} companies failed: ${failures.map((f) => f.code).join(", ")}` }
          : orphanError
            ? { error: `org-level orphan sweep failed after a clean per-company reset (tails remain): ${orphanError}` }
            : salesForecastError
              ? { error: `org-level sales-forecast reset failed after a clean per-company reset (tails remain): ${salesForecastError}` }
              : {}),
      },
      // 207 Multi-Status on ANY failure (a failed company OR a failed orphan
      // sweep) so status-keyed clients/log parsers don't read an incomplete reset
      // as success (Codex 2026-06-21 / 2026-06-22). The form keys on body.ok.
      { status: ok ? 200 : 207 },
    )
  }

  // ── The restore key ────────────────────────────────────────────────────
  // A restore MUST name the archive operation it is undoing. Scope alone
  // ("this company, this year") is a bucket that holds every generation the
  // re-imports left behind, and un-archiving the bucket multiplies the
  // financial statements. Validated here, before any database work, and
  // enforced again inside `restoreRows` — see ARCHIVE_GENERATION_KEY in
  // `src/lib/server/archive.ts`.
  //
  // Fail CLOSED on legacy events: deletions recorded before `archivedAt` was
  // captured have no key and are refused, not restored by scope.
  let archivedAt: Date | undefined
  if (mode === "restore") {
    const raw = body.archivedAt
    const parsed = typeof raw === "string" ? new Date(raw) : new Date(NaN)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        {
          error:
            "restore requires archivedAt — the exact deletion timestamp recorded on the audit event (metadata.archivedAt). Deletions recorded before that field existed cannot be restored from here, because restoring them by scope would also un-archive every earlier version of the same year and multiply the figures. Re-import the source file instead.",
          code: "MISSING_ARCHIVE_KEY",
        },
        { status: 400 },
      )
    }
    archivedAt = parsed
  }

  try {
    const result =
      mode === "archive"
        ? await archiveRows({
            prisma,
            actorUserId: session.userId,
            reason,
            scope,
          })
        : await restoreRows({
            prisma,
            actorUserId: session.userId,
            reason,
            scope,
            // Non-null by the guard above; `restoreRows` throws
            // MissingArchiveKeyError if it ever isn't.
            archivedAt: archivedAt as Date,
          })
    // CF has no companyId column — a company-scoped CF archive matches only
    // rows whose sourceId follows the "<code>::" import convention. Manual
    // entries (null / non-conforming sourceId) cannot be attributed to a
    // company, so they are intentionally left untouched. Surface that count
    // so the operator knows the archive wasn't exhaustive (no silent gap).
    let unattributableCfRows: number | undefined
    if (mode === "archive" && entityKind === "CashFlowEntry" && companyCode && year) {
      unattributableCfRows = await prisma.cashFlowEntry.count({
        where: {
          organizationId: orgId,
          year,
          deletedAt: null,
          OR: [{ sourceId: null }, { NOT: { sourceId: { contains: "::" } } }],
        },
      })
    }
    return NextResponse.json({
      ok: true,
      mode,
      rowsAffected: result.rowsAffected,
      auditEventId: result.auditEventId,
      // The restore key for what was just archived. Handed back so a caller
      // that wants to undo its own archive does not have to re-read the trail.
      archivedAt: result.archivedAt,
      ...(unattributableCfRows !== undefined ? { unattributableCfRows } : {}),
    })
  } catch (err) {
    log.error("data-archive operation failed", {
      mode,
      err: err instanceof Error ? err.message : String(err),
    })
    // A missing restore key is a bad request, not a server fault — and the
    // message is the one the operator needs to read.
    if (err instanceof MissingArchiveKeyError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      )
    }
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
