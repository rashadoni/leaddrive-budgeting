/**
 * Phase A step 2 — seed the AZMADE holding (first real client).
 *
 * Hierarchy discovered from the 5 xlsx files the user shared on 2026-04-24:
 *
 *   AZMADE Group MMC                          [Organization]
 *   ├── AAC                                   [sub-group, level=1]
 *   ├── ATL (Azertexnolayn)                   [sub-group, level=1]
 *   │   ├── MRKZ  — Mərkəz (central/admin)    [operational, level=2, industrial]
 *   │   ├── DBZ   — Polad Boru Zavodu         [operational, level=2, industrial]
 *   │   ├── PMZ   — Polietilen Məmulatlar     [operational, level=2, industrial]
 *   │   └── TAZ   — Texniki Avadanlıq         [operational, level=2, industrial]
 *   ├── SPARK                                 [sub-group, level=1]
 *   ├── ZTP                                   [sub-group, level=1]
 *   └── LLS                                   [sub-group, level=1]
 *
 * KNOWN GAP: AAC / SPARK / ZTP / LLS are sub-groups per user — they should
 * have their own operational children (level=2) too, but the internal
 * structure wasn't provided in this round. They land as level=1 only; the
 * HeatMap will show empty rows for them until the user specifies their
 * internal entities. A follow-up seed run with those entities wrapped into
 * the same upsert loop is a one-line addition once known.
 *
 * Idempotent. Re-running updates in place. Uses `slug = "azmade"` to find
 * or create the Organization — doesn't create users or auth artifacts.
 *
 * Run:
 *   npx tsx scripts/seed-azmade-holding.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ORG_SLUG = 'azmade';
const ORG_NAME = 'AZMADE Group MMC';

type CompanySeed = {
  code: string;
  name: string;
  nameAz?: string;
  nameEn?: string;
  industry?: string; // null for level=1 sub-groups
  level: 1 | 2;
  parentCode?: string;
  country: string;
  baseCurrencyCode: string;
  sortOrder: number;
  /** Phase 7.E — defaults to "operational"; set "admin" for HQ /
   *  cost-centre entities so they're exempt from operational-threshold
   *  scoring (no false-red on OpEx/COGS ratios). */
  role?: 'operational' | 'admin' | 'holding';
};

// Sub-groups (level=1) — siblings directly under the Organization.
//
// Turn 29 reframing: AAC is RESTORED as a sub-group at level=1 with a single
// AAC-MAIN level=2 child (symmetric with SPARK/ZTP/LLS structure — each is a
// level=1 wrapper with one or more level=2 operational entities). The Turn-14
// "single op-co directly under org" interpretation was reverted per user
// clarification "AAC тоже входит в этот список [sub-groups]". The xlsx data
// (S-1..S-6 sheets) confirms AAC has 6 PRODUCT lines (MHB / burnt lime /
// slaked lime / glue / U-block / waste lime), not company subsidiaries — so
// AAC-MAIN remains the single operational entity that owns the BudgetLines;
// the level=1 wrapper exists for visual consistency with the other holding
// sub-groups in the company tree + future expansion if AAC adds entities.
const SUB_GROUPS: CompanySeed[] = [
  {
    code: 'AAC',
    name: 'AAC',
    nameEn: 'AAC',
    level: 1,
    country: 'AZ',
    baseCurrencyCode: 'AZN',
    sortOrder: 10,
  },
  {
    code: 'ATL',
    name: 'Azertexnolayn',
    nameAz: 'Azertexnolayn MMC',
    nameEn: 'Azertexnolayn',
    level: 1,
    country: 'AZ',
    baseCurrencyCode: 'AZN',
    sortOrder: 20,
  },
  {
    code: 'SPARK',
    name: 'SPARK',
    nameEn: 'SPARK',
    level: 1,
    country: 'AZ',
    baseCurrencyCode: 'AZN',
    sortOrder: 30,
  },
  {
    code: 'ZTP',
    name: 'ZTP',
    nameEn: 'ZTP',
    level: 1,
    country: 'AZ',
    baseCurrencyCode: 'AZN',
    sortOrder: 40,
  },
  {
    code: 'LLS',
    name: 'LLS MMC',
    nameEn: 'LLS',
    level: 1,
    country: 'AZ',
    baseCurrencyCode: 'AZN',
    sortOrder: 50,
  },
];

// Placeholder operational entities (level=2) for sub-groups that the user
// described as sub-groups but hasn't yet specified internal children for.
// Each sub-group gets one `-MAIN` entity so its budget file has an
// import target. Rename / split / restructure once real children are known.
//
// Turn 29: AAC follows the same pattern — single AAC-MAIN level=2 child
// of the AAC level=1 wrapper. xlsx S-1..S-6 are PRODUCT lines, not
// subsidiaries, so AAC-MAIN owns the imported BudgetLines.
const PLACEHOLDER_OPERATIONAL: CompanySeed[] = [
  {
    code: 'AAC-MAIN',
    name: 'AAC Main',
    nameEn: 'AAC Main',
    industry: 'industrial',
    level: 2,
    parentCode: 'AAC',
    country: 'AZ',
    baseCurrencyCode: 'AZN',
    sortOrder: 11,
  },
  {
    code: 'SPARK-MAIN',
    name: 'SPARK Main',
    nameEn: 'SPARK Main',
    industry: 'industrial',
    level: 2,
    parentCode: 'SPARK',
    country: 'AZ',
    baseCurrencyCode: 'AZN',
    sortOrder: 31,
  },
  {
    code: 'ZTP-MAIN',
    name: 'ZTP Main',
    nameEn: 'ZTP Main',
    industry: 'industrial',
    level: 2,
    parentCode: 'ZTP',
    country: 'AZ',
    baseCurrencyCode: 'AZN',
    sortOrder: 41,
  },
  {
    code: 'LLS-MAIN',
    name: 'LLS Main',
    nameEn: 'LLS Main',
    industry: 'services',
    level: 2,
    parentCode: 'LLS',
    country: 'AZ',
    baseCurrencyCode: 'AZN',
    sortOrder: 51,
  },
];

// Operational entities (level=2) under ATL — from 5-2 budget sheet in
// rev9-ATL.xlsx: `Mərkəz | Polad Boru Zavodu | Polietilen Məmulatlar |
// Texniki Avadanlıq`.
const ATL_OPERATIONAL: CompanySeed[] = [
  {
    code: 'ATL-MRKZ',
    name: 'ATL Mərkəz',
    nameAz: 'Mərkəz',
    nameEn: 'ATL Central',
    industry: 'industrial',
    level: 2,
    parentCode: 'ATL',
    country: 'AZ',
    baseCurrencyCode: 'AZN',
    sortOrder: 21,
    // Pure admin cost-centre — has OpEx but no real revenue. Scoring
    // it on operational thresholds would false-red the holding view
    // (OpEx ratio >> 100% by design). Phase 7.E `role='admin'` exempts
    // it from operational scoring; aggregated views still include it.
    role: 'admin',
  },
  {
    code: 'ATL-DBZ',
    name: 'Polad Boru Zavodu',
    nameAz: 'Polad Boru Zavodu',
    nameEn: 'Steel Pipe Factory',
    industry: 'industrial',
    level: 2,
    parentCode: 'ATL',
    country: 'AZ',
    baseCurrencyCode: 'AZN',
    sortOrder: 22,
  },
  {
    code: 'ATL-PMZ',
    name: 'Polietilen Məmulatları Zavodu',
    nameAz: 'Polietilen Məmulatları Zavodu',
    nameEn: 'Polyethylene Products Plant',
    industry: 'industrial',
    level: 2,
    parentCode: 'ATL',
    country: 'AZ',
    baseCurrencyCode: 'AZN',
    sortOrder: 23,
  },
  {
    code: 'ATL-TAZ',
    name: 'Texniki Avadanlıqlar Zavodu',
    nameAz: 'Texniki Avadanlıqlar Zavodu',
    nameEn: 'Technical Equipment Plant',
    industry: 'industrial',
    level: 2,
    parentCode: 'ATL',
    country: 'AZ',
    baseCurrencyCode: 'AZN',
    sortOrder: 24,
  },
];

async function findOrCreateOrg() {
  const existing = await prisma.organization.findUnique({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true, slug: true },
  });
  if (existing) {
    console.log(`Organization found: ${existing.name} (slug=${existing.slug}).`);
    return existing;
  }
  const created = await prisma.organization.create({
    // `settings` omitted — schema default `@default("{}")` covers it.
    data: {
      name: ORG_NAME,
      slug: ORG_SLUG,
    },
    select: { id: true, name: true, slug: true },
  });
  console.log(`Organization created: ${created.name} (slug=${created.slug}).`);
  return created;
}

async function upsertCompany(
  organizationId: string,
  seed: CompanySeed,
  parentLookup: Map<string, string>,
) {
  const parentCompanyId = seed.parentCode
    ? parentLookup.get(seed.parentCode) ?? null
    : null;
  if (seed.parentCode && !parentCompanyId) {
    throw new Error(
      `Parent "${seed.parentCode}" not resolved when upserting "${seed.code}". Check seed order.`,
    );
  }

  const existing = await prisma.company.findUnique({
    where: {
      organizationId_code: { organizationId, code: seed.code },
    },
    select: { id: true },
  });

  // Shared payload. `organizationId` is intentionally omitted from the update
  // branch because the row is already scoped by the unique (orgId, code) key —
  // setting it again is a no-op in the normal case and masks bugs if someone
  // passes a mismatched pair in the future.
  const shared = {
    parentCompanyId,
    code: seed.code,
    name: seed.name,
    nameAz: seed.nameAz ?? null,
    nameRu: null,
    nameEn: seed.nameEn ?? null,
    industry: seed.industry ?? null,
    level: seed.level,
    country: seed.country,
    baseCurrencyCode: seed.baseCurrencyCode,
    isActive: true,
    sortOrder: seed.sortOrder,
    // Phase 7.E — only spread `role` when explicitly set on the seed.
    // Omitting lets Prisma's schema default ("operational") fire on
    // create AND keeps existing rows untouched on update — no need to
    // re-assert the default value here (architect round-1 cleanup).
    ...(seed.role !== undefined ? { role: seed.role } : {}),
  };

  if (existing) {
    await prisma.company.update({ where: { id: existing.id }, data: shared });
    return { id: existing.id, action: 'updated' as const };
  }
  const created = await prisma.company.create({
    data: { ...shared, organizationId },
    select: { id: true },
  });
  return { id: created.id, action: 'created' as const };
}

async function main() {
  const org = await findOrCreateOrg();

  const parentLookup = new Map<string, string>();
  let createdCount = 0;
  let updatedCount = 0;

  // Pass 1: sub-groups (parent = null, no FK dependency).
  for (const sg of SUB_GROUPS) {
    const { id, action } = await upsertCompany(org.id, sg, parentLookup);
    parentLookup.set(sg.code, id);
    if (action === 'created') createdCount += 1;
    else updatedCount += 1;
    const marker = action === 'created' ? '+' : '~';
    console.log(`  ${marker} [L1] ${sg.code.padEnd(6)} ${sg.name}`);
  }

  // Pass 2a: placeholder operational children for sub-groups without their
  // real internal structure yet (one -MAIN per subgroup).
  for (const op of PLACEHOLDER_OPERATIONAL) {
    const { id, action } = await upsertCompany(org.id, op, parentLookup);
    parentLookup.set(op.code, id);
    if (action === 'created') createdCount += 1;
    else updatedCount += 1;
    const marker = action === 'created' ? '+' : '~';
    const industry = op.industry ?? '-';
    console.log(
      `  ${marker} [L2] ${op.code.padEnd(12)} ${op.name.padEnd(36)} (${industry}, placeholder)`,
    );
  }

  // Pass 2b: real ATL operational entities (parent must be resolved by now).
  for (const op of ATL_OPERATIONAL) {
    const { id, action } = await upsertCompany(org.id, op, parentLookup);
    parentLookup.set(op.code, id);
    if (action === 'created') createdCount += 1;
    else updatedCount += 1;
    const marker = action === 'created' ? '+' : '~';
    const industry = op.industry ?? '-';
    console.log(
      `  ${marker} [L2] ${op.code.padEnd(10)} ${op.name.padEnd(38)} (${industry})`,
    );
  }

  // Pass 3: Turn 14 — sweep obsolete rows from prior seed shapes. Idempotent:
  // matches only codes that pre-Turn-14 seed produced but the current seed
  // no longer references. The migration `20260425232642_phase7_aac_structural_reframe`
  // handles AAC specifically; this pass is a belt-and-suspenders for re-runs
  // on un-migrated DBs where the rename hasn't happened yet (`AAC-MAIN` is
  // orphaned after the seed updated `AAC` from level=1 to level=2 but the
  // old level=2 child wasn't deleted). Safe to re-run on already-clean DBs.
  const seededCodes = new Set([
    ...SUB_GROUPS.map((s) => s.code),
    ...PLACEHOLDER_OPERATIONAL.map((s) => s.code),
    ...ATL_OPERATIONAL.map((s) => s.code),
  ]);
  const OBSOLETE_CODES_PRE_TURN_14 = ['AAC-MAIN'];
  for (const code of OBSOLETE_CODES_PRE_TURN_14) {
    if (seededCodes.has(code)) continue; // safety: never delete a row the seed actively wants
    const stale = await prisma.company.findUnique({
      where: { organizationId_code: { organizationId: org.id, code } },
      select: { id: true },
    });
    if (!stale) continue;
    // Cascade-friendly delete: if the row has FK refs (BudgetLines etc.)
    // that means the migration didn't run or the rename was skipped — bail
    // loudly so the operator runs `prisma migrate deploy` first.
    const refs = await prisma.budgetLine.count({ where: { companyId: stale.id } });
    if (refs > 0) {
      throw new Error(
        `Refusing to delete obsolete row "${code}" — it has ${refs} BudgetLine refs. Run "npx prisma migrate deploy" first to apply phase7_aac_structural_reframe (renames AAC-MAIN→AAC). If you're seeing this on a fresh DB the migration should have already fired; check migrate status.`,
      );
    }
    await prisma.company.delete({ where: { id: stale.id } });
    console.log(`  - [SWEEP] removed obsolete row "${code}" (no FK refs)`);
  }

  console.log('');
  const totalSeeded =
    SUB_GROUPS.length + PLACEHOLDER_OPERATIONAL.length + ATL_OPERATIONAL.length;
  console.log(
    `Seeded ${totalSeeded} companies ` +
      `(${createdCount} created, ${updatedCount} updated) under org "${org.slug}".`,
  );
  console.log('');
  console.log('Open gaps:');
  console.log('  - SPARK / ZTP / LLS currently carry a single -MAIN placeholder');
  console.log('    operational child each. Rename / split when the user provides');
  console.log('    their real internal structure. AAC was reframed in Turn 14 to');
  console.log('    a single operational company directly under AZMADE (no wrapper).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
