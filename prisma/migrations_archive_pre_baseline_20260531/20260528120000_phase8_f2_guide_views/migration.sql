-- Phase 8 F2 (2026-05-28) — first-party /guide telemetry.

CREATE TABLE "guide_views" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorUserId" TEXT,
    "lang" TEXT NOT NULL,
    "anchor" TEXT,
    "userAgent" TEXT,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "guide_views_organizationId_viewedAt_idx" ON "guide_views"("organizationId", "viewedAt");

CREATE INDEX "guide_views_lang_viewedAt_idx" ON "guide_views"("lang", "viewedAt");

ALTER TABLE "guide_views" ADD CONSTRAINT "guide_views_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
