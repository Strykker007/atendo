-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "quotedFromStatus" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quotedPreview" TEXT;

