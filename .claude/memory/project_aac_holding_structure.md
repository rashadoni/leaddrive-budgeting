---
name: FO Holding — structural breakdown confirmed 2026-04-23
description: FO Holding = 7 sub-groups (Tabia, AFI, Azmade, PMD, Novex, Azersheker, Separated) + 59 operational entities across 15 sectors. AAC is operational under Azmade (NOT a sub-group). Implementation starts with Tabia per user preference.
type: project
originSessionId: dcc39641-a6b1-4e1b-a872-6b2b0df5b07e
---
BudgetPro's real deployment is **FO Holding** — a major diversified holding in Azerbaijan. Full structural breakdown confirmed by user 2026-04-23.

## Hierarchy (2 levels below holding)

```
FO (Organization)
  ├ Tabia (Level 1, TABİA MMC) → 17 operational [IMPLEMENTATION STARTS HERE]
  │   • 14 hotels (RAMADA, HILTON GARDEN AGHDAM, NOHURGÖL, YENİ ÇİNAR, YENİ NAFTALAN,
  │     YENİ GƏNCƏ, YENİ ŞAMAXI, YENİ QALAALTI, EXCELSIOR, CENTRAL POİNT,
  │     BAKU GARDEN, GÖYGÖL LAKE RESORT, LENKERAN HOTEL, TABİA MMC hospitality HQ)
  │   • 2 real_estate (BADAMDAR ESTATES, AGHDAM CİTY)
  │   • 1 services (AZBİZNESSERVİS)
  ├ AFI (Level 1, AFİ MMC) → 11 operational
  │   • 6 agro_crops (AGRARCO, GRAND-AGRO, GRANDAGRO İNVİTRO, GREEN PLANT, AZROSE, ZAFAR BAGLARI)
  │   • 2 food_processing (AZBADAM almonds, GALA OLIVES)
  │   • 1 beverage (LƏCHEQ farm + distillery)
  │   • 1 real_estate (SHAMKİR AP)
  │   • 1 services HQ (AFİ MMC)
  ├ Azmade (Level 1, AZMADE GROUP MMC) → 6 operational
  │   • 3 industrial (AZERTEXNOLAYN, SPARK construction materials, AAC MMC, AZMADE GROUP HQ)
  │   • 1 real_estate (ZTP — Zəyəm tech park)
  │   • 1 logistics (LLS)
  ├ PMD (Level 1, PMD Group MMC) → 6 operational
  │   • 2 real_estate (PMD PROJECTS, PMD Group HQ)
  │   • 2 services (FACILITY MGMT GROUP, DESIGN BUREAU)
  │   • 1 hospitality food_service (MER GROUP roadside)
  │   • 1 logistics (GRAND LOGISTICS CENTER)
  ├ Novex (Level 1, virtual label) → 6 operational
  │   • 5 food_processing (MARS OVERSEAS, ATS FOOD, QƏBƏLƏ/QUBA/LƏNKƏRAN KONSERV)
  │   • 1 beverage (BEER ART)
  ├ Azersheker (Level 1, virtual label) → 2 operational
  │   • 2 food_processing (EDEN AGRO corn→starch, AZƏRŞƏKƏR sugar)
  └ Separated (Level 1, virtual label — directly under FO) → 11 operational
      • 2 pharma (ZEYTUN PHARMACEUTICALS, SCANDENS PHARMACEUTICAL INDUSTRIES)
      • 1 aquaculture (AZERBAIJAN FISH FARM)
      • 1 poultry (AZERBAIJAN POULTRY COMPANY)
      • 1 industrial (FOTON)
      • 1 education (SYNERGIA ACADEMY)
      • 1 services (İDEAL BUSINESS KO.LLC / IBK)
      • 1 energy (AZERBAIJAN GREEN ENERGY COMPANY)
      • 1 real_estate (DOST AGROPARK)
      • REVERİ — removed from scope
      • AGF MMC — profile unknown, pending
```

## Key corrections from earlier drafts

- **AAC is NOT a sub-group** — it's an operational entity under **Azmade** sub-group
- **MER GROUP is NOT a sub-group** — it's operational under **PMD** (roadside food)
- **7 actual sub-groups:** Tabia, AFI, Azmade, PMD, Novex, Azersheker, Separated
- **NOHURGOL, SHAMAKHI, YENİ QALAALTI** are **hotels** (under Tabia), not agro
- **BADAMDAR** is **real_estate** (Estates), not a hotel
- **LƏCHEQ** is **beverage** (distillery), not pharma
- **MARS OVERSEAS** is **food_processing** under Novex, not industrial
- **PASHA TRAVEL** is NOT part of FO — earlier mention was mis-attributed
- **DASTAN AGRO** — not in structured list, probably obsolete/renamed

## Totals

- **59 operational entities** across 7 sub-groups
- **15 industry sectors** (added `beverage` for LƏCHEQ + BEER ART)
- **Removed from scope:** CPC, LUMUN, REVERY (REVERİ MMC)
- **Still unknown:** AGF MMC (1 entity, pending profile)

## Implementation sequencing

- **Tabia first** (user preference 2026-04-23) — largest sub-group, hospitality-heavy, richest indicator-pack basis
- Rolls out to other sub-groups after Tabia validates

## Key context

- User framed scope as "от валюты до войны" — FX, commodity, operational, geopolitical, macro, regulatory
- Only AAC MMC currently has data in BudgetPro; other 58 operational need onboarding
- CoA strategy: per-industry template with per-company override (15 templates)
- Full Phase 7 (Enterprise Holding Risk Terminal, ~5 months) is the active plan
- Plan file: `.claude/plans/dreamy-leaping-manatee.md`
- `CLAUDE.md` still says "AAC-specific prototype" — stale, flagged for user decision on update

## How to apply in future conversations

- Use "FO Holding" not "AAC" when referring to the client
- 7 sub-groups = fixed structure; any new company goes under one of them
- ~60 entities → dense UI, bulk import, command bar, heat maps — not single-entity dashboards
- 2-level hierarchy via `Company.parentCompanyId` self-ref
- Implementation order for indicator packs / onboarding: Tabia (hospitality) → AFI (agro) → others
