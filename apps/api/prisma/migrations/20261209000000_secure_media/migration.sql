-- Foto protegida (docs/foto-protegida.md)
CREATE TABLE "secure_media" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "mediaKey" TEXT NOT NULL,
    "mediaMime" TEXT NOT NULL,
    "mediaName" TEXT,
    "caption" TEXT,
    "validHours" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "firstViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "secure_media_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "secure_media_hash_key" ON "secure_media"("hash");
CREATE INDEX "secure_media_conversationId_createdAt_idx" ON "secure_media"("conversationId", "createdAt");
ALTER TABLE "secure_media" ADD CONSTRAINT "secure_media_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "secure_media" ADD CONSTRAINT "secure_media_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
