-- Tags que conflitam entre si (docs/06-modelo-de-dados.md#tags). Uma linha por par, tagId < otherId.
CREATE TABLE "tag_conflicts" (
    "tagId" TEXT NOT NULL,
    "otherId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tag_conflicts_pkey" PRIMARY KEY ("tagId","otherId")
);
CREATE INDEX "tag_conflicts_otherId_idx" ON "tag_conflicts"("otherId");
ALTER TABLE "tag_conflicts" ADD CONSTRAINT "tag_conflicts_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tag_conflicts" ADD CONSTRAINT "tag_conflicts_otherId_fkey" FOREIGN KEY ("otherId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
