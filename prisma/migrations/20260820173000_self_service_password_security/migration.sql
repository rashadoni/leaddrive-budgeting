ALTER TABLE "users"
ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TYPE "AuditAction"
ADD VALUE IF NOT EXISTS 'user_password_change';
