\set ON_ERROR_STOP on

-- One-time repair for the 2026-07-16 Quick Preview incident.
--
-- The preview route called the persisted recompute adapter and replaced 120
-- existing IndicatorValue rows between 18:11:50.198 and 18:11:50.786 UTC.
-- The input file is an exact 120-row slice from the 15:44 UTC pre-deploy dump.
-- All 120 rows existed before the incident, so incident recovery restores all
-- 120 exactly. Cross-industry legacy-cache cleanup is intentionally separate:
-- deleting those rows here would be a broader product/data change, not a
-- rollback. Only fields that the recompute upsert updates are restored;
-- sparkline and reconciliation/audit fields are deliberately left untouched.
--
-- Expected container-local input:
--   /tmp/incident-preview-20260716-1544-indicator-values.tsv

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL TIME ZONE 'UTC';

CREATE TEMP TABLE incident_preview_restore
  (LIKE public.indicator_values INCLUDING ALL)
  ON COMMIT DROP;

\copy incident_preview_restore (id, "organizationId", "companyId", "indicatorId", period, value, status, sparkline, inputs, "computedAt", "valueSource", confidence, "lastReconciledAt", "reconciledBy", "sanityBand", "sourceDocument", "revisionId") FROM '/tmp/incident-preview-20260716-1544-indicator-values.tsv';

DO $repair_guard$
DECLARE
  payload_count integer;
  live_incident_count integer;
  identity_mismatch_count integer;
  reverse_identity_mismatch_count integer;
  cross_industry_count integer;
  non_preincident_backup_count integer;
BEGIN
  SELECT count(*) INTO payload_count
  FROM incident_preview_restore;

  IF payload_count <> 120 THEN
    RAISE EXCEPTION
      'repair aborted: expected 120 backup rows, got %', payload_count;
  END IF;

  SELECT count(*) INTO live_incident_count
  FROM public.indicator_values iv
  WHERE iv."organizationId" = 'cmqtxewbo0000qu2wjpj58fqr'
    AND iv.period = '2026'
    AND iv."computedAt" >= timestamp '2026-07-16 18:11:50'
    AND iv."computedAt" <  timestamp '2026-07-16 18:11:51';

  IF live_incident_count <> 120 THEN
    RAISE EXCEPTION
      'repair aborted: expected 120 live incident rows, got %',
      live_incident_count;
  END IF;

  SELECT count(*) INTO identity_mismatch_count
  FROM incident_preview_restore src
  LEFT JOIN public.indicator_values iv
    ON iv.id = src.id
   AND iv."organizationId" = src."organizationId"
   AND iv."companyId" = src."companyId"
   AND iv."indicatorId" = src."indicatorId"
   AND iv.period = src.period
  WHERE iv.id IS NULL
     OR src."organizationId" <> 'cmqtxewbo0000qu2wjpj58fqr'
     OR src.period <> '2026';

  IF identity_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'repair aborted: % backup rows do not match the live row identity',
      identity_mismatch_count;
  END IF;

  SELECT count(*) INTO reverse_identity_mismatch_count
  FROM public.indicator_values iv
  LEFT JOIN incident_preview_restore src
    ON src.id = iv.id
   AND src."organizationId" = iv."organizationId"
   AND src."companyId" = iv."companyId"
   AND src."indicatorId" = iv."indicatorId"
   AND src.period = iv.period
  WHERE iv."organizationId" = 'cmqtxewbo0000qu2wjpj58fqr'
    AND iv.period = '2026'
    AND iv."computedAt" >= timestamp '2026-07-16 18:11:50'
    AND iv."computedAt" <  timestamp '2026-07-16 18:11:51'
    AND src.id IS NULL;

  IF reverse_identity_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'repair aborted: % live incident rows are absent from the backup set',
      reverse_identity_mismatch_count;
  END IF;

  SELECT count(*) INTO non_preincident_backup_count
  FROM incident_preview_restore src
  WHERE src."computedAt" >= timestamp '2026-07-16 18:11:50';

  IF non_preincident_backup_count <> 0 THEN
    RAISE EXCEPTION
      'repair aborted: % backup rows are not older than the incident',
      non_preincident_backup_count;
  END IF;

  SELECT count(*) INTO cross_industry_count
  FROM public.indicator_values iv
  JOIN incident_preview_restore src ON src.id = iv.id
  JOIN public.companies c ON c.id = iv."companyId"
  JOIN public.indicator_definitions d ON d.id = iv."indicatorId"
  WHERE cardinality(d.industries) > 0
    AND NOT (c.industry = ANY(d.industries))
    AND NOT EXISTS (
      SELECT 1
      FROM public.company_indicators ci
      WHERE ci."companyId" = iv."companyId"
        AND ci."indicatorId" = iv."indicatorId"
        AND ci.enabled = true
    );

  IF cross_industry_count <> 93 THEN
    RAISE EXCEPTION
      'repair aborted: expected 93 cross-industry rows, got %',
      cross_industry_count;
  END IF;
END
$repair_guard$;

DO $restore$
DECLARE
  restored_count integer;
  remaining_diff_count integer;
  remaining_payload_count integer;
BEGIN
  UPDATE public.indicator_values iv
  SET value = src.value,
      status = src.status,
      inputs = src.inputs,
      "computedAt" = src."computedAt",
      "valueSource" = src."valueSource",
      confidence = src.confidence,
      "revisionId" = src."revisionId"
  FROM incident_preview_restore src
  WHERE iv.id = src.id
    AND iv."organizationId" = 'cmqtxewbo0000qu2wjpj58fqr'
    AND iv.period = '2026'
    AND iv."computedAt" >= timestamp '2026-07-16 18:11:50'
    AND iv."computedAt" <  timestamp '2026-07-16 18:11:51';

  GET DIAGNOSTICS restored_count = ROW_COUNT;
  IF restored_count <> 120 THEN
    RAISE EXCEPTION
      'repair aborted: expected to restore 120 rows, restored %',
      restored_count;
  END IF;

  SELECT count(*) INTO remaining_diff_count
  FROM public.indicator_values iv
  JOIN incident_preview_restore src ON src.id = iv.id
  WHERE iv.value IS DISTINCT FROM src.value
     OR iv.status IS DISTINCT FROM src.status
     OR iv.inputs IS DISTINCT FROM src.inputs
     OR iv."computedAt" IS DISTINCT FROM src."computedAt"
     OR iv."valueSource" IS DISTINCT FROM src."valueSource"
     OR iv.confidence IS DISTINCT FROM src.confidence
     OR iv."revisionId" IS DISTINCT FROM src."revisionId";

  IF remaining_diff_count <> 0 THEN
    RAISE EXCEPTION
      'repair aborted: % restored rows still differ from backup',
      remaining_diff_count;
  END IF;

  SELECT count(*) INTO remaining_payload_count
  FROM public.indicator_values iv
  JOIN incident_preview_restore src ON src.id = iv.id;

  IF remaining_payload_count <> 120 THEN
    RAISE EXCEPTION
      'repair aborted: expected all 120 rows to remain, got %',
      remaining_payload_count;
  END IF;
END
$restore$;

SELECT
  count(*) AS restored_rows,
  count(*) FILTER (
    WHERE cardinality(d.industries) > 0
      AND NOT (c.industry = ANY(d.industries))
      AND NOT EXISTS (
        SELECT 1
        FROM public.company_indicators ci
        WHERE ci."companyId" = iv."companyId"
          AND ci."indicatorId" = iv."indicatorId"
          AND ci.enabled = true
      )
  ) AS retained_cross_industry_legacy_rows,
  min(iv."computedAt") AS oldest_restored_computation,
  max(iv."computedAt") AS newest_restored_computation
FROM public.indicator_values iv
JOIN incident_preview_restore src ON src.id = iv.id
JOIN public.companies c ON c.id = iv."companyId"
JOIN public.indicator_definitions d ON d.id = iv."indicatorId";

\if :APPLY_REPAIR
  COMMIT;
  \echo 'incident repair committed'
\else
  ROLLBACK;
  \echo 'incident repair dry-run rolled back'
\endif
