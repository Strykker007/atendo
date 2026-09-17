-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'manager';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "internal" BOOLEAN NOT NULL DEFAULT false;

