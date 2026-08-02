#!/usr/bin/env node
/**
 * Phase 5.2 Stage 3 — RLS route-coverage scanner.
 *
 * Reports every route.ts under src/app/api that calls an org-scoped Prisma
 * delegate (model with an `organizationId` column ⇒ covered by a
 * tenant_isolation policy) WITHOUT wrapping in `withOrgScope` and without
 * an explicit admin-path opt-out.
 *
 * Modes:
 *   node scripts/rls-coverage-scan.mjs            # report-only (exit 0)
 *   node scripts/rls-coverage-scan.mjs --enforce  # exit 1 on violations
 *                                                 # (S5 gate: pre-commit/CI)
 *
 * Opt-out: a route that legitimately runs cross-org (cron loops, super-admin,
 * NextAuth) uses `prismaAdmin` and carries the marker comment
 * `// rls-scan-ignore: <reason>` near the top of the file. The scanner
 * lists opt-outs separately so they stay auditable.
 *
 * Also greps for the forbidden raw `SET "app.` outside with-org-scope.ts
 * (a non-LOCAL SET would leak org context across pooled connections).
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..")
const ENFORCE = process.argv.includes("--enforce")

// --- org-scoped delegates from the schema ---------------------------------
const schema = fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({
  name: m[1],
  body: m[2],
}))
const orgScoped = models
  .filter((m) => /^\s*organizationId\s+String/m.test(m.body))
  .map((m) => m.name[0].toLowerCase() + m.name.slice(1))
const delegateRe = new RegExp(`\\.(${orgScoped.join("|")})\\.`)

// --- walk routes -----------------------------------------------------------
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return walk(p)
    return e.name === "route.ts" ? [p] : []
  })
}
const routes = walk(path.join(ROOT, "src/app/api"))

const unwrapped = []
const optedOut = []
let wrapped = 0
let clean = 0
for (const r of routes) {
  const src = fs.readFileSync(r, "utf8")
  const rel = path.relative(ROOT, r)
  if (/rls-scan-ignore:/.test(src)) {
    optedOut.push(rel)
  } else if (src.includes("withOrgScope")) {
    wrapped += 1
  } else if (delegateRe.test(src)) {
    unwrapped.push(rel)
  } else {
    clean += 1
  }
}

// --- forbidden raw SET without LOCAL --------------------------------------
const rawSetHits = []
function walkTs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walkTs(p)
    return /\.(ts|tsx|mjs|cjs)$/.test(e.name) ? [p] : []
  })
}
for (const f of walkTs(path.join(ROOT, "src"))) {
  if (f.endsWith("with-org-scope.ts")) continue
  const src = fs.readFileSync(f, "utf8")
  // 2026-08-02 — `set_config` is the other way to write this, and the one
  // `with-org-scope.ts` now uses (a bound parameter instead of interpolating
  // the tenant id into SQL). Its third argument is `is_local`: passing
  // anything but `true` leaks the tenant across pooled connections exactly as
  // a non-LOCAL `SET` does, silently and cross-org. Catch both spellings.
  const rawSet =
    /SET\s+"app\.(organization_id|bypass_rls)"/.test(src) && !/SET\s+LOCAL/.test(src)
  const looseSetConfig =
    /set_config\(\s*['"`]app\.(organization_id|bypass_rls)/.test(src) &&
    !/set_config\([^)]*,\s*true\s*\)/.test(src)
  if (rawSet || looseSetConfig) {
    rawSetHits.push(path.relative(ROOT, f))
  }
}

// --- report ----------------------------------------------------------------
console.log(`RLS coverage scan — ${routes.length} routes, ${orgScoped.length} org-scoped delegates`)
console.log(`  wrapped (withOrgScope):        ${wrapped}`)
console.log(`  clean (no org delegate calls): ${clean}`)
console.log(`  opted out (rls-scan-ignore):   ${optedOut.length}`)
console.log(`  UNWRAPPED touching org data:   ${unwrapped.length}`)
if (optedOut.length) {
  console.log(`\nOpt-outs (audit these stay justified):`)
  for (const f of optedOut) console.log(`  ~ ${f}`)
}
if (unwrapped.length) {
  console.log(`\nUnwrapped routes:`)
  for (const f of unwrapped) console.log(`  ! ${f}`)
}
if (rawSetHits.length) {
  console.log(`\nFORBIDDEN raw SET "app.*" without LOCAL (pool-leak risk):`)
  for (const f of rawSetHits) console.log(`  !! ${f}`)
}

if (ENFORCE && (unwrapped.length > 0 || rawSetHits.length > 0)) {
  console.error(`\n✗ RLS coverage gate failed (${unwrapped.length} unwrapped, ${rawSetHits.length} raw SET).`)
  process.exit(1)
}
