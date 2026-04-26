-- CreateTable
CREATE TABLE "user_layout_preferences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sizes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_layout_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_layout_preferences_organizationId_userId_idx" ON "user_layout_preferences"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_layout_preferences_userId_name_key" ON "user_layout_preferences"("userId", "name");

-- AddForeignKey
ALTER TABLE "user_layout_preferences" ADD CONSTRAINT "user_layout_preferences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_layout_preferences" ADD CONSTRAINT "user_layout_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
