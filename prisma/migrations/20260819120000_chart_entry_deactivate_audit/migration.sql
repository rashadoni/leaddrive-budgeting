-- 2026-08-19 — audit trail for retiring dead chart / product entries.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that
-- writes the new value, which is why this lives in its own migration
-- ahead of any code path that emits it.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'chart_entry_deactivate';
