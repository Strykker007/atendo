-- CreateEnum
CREATE TYPE "SendDelayProfile" AS ENUM ('instant', 'fast', 'short', 'medium', 'long');

-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "sendDailyLimit" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "sendDelay" "SendDelayProfile" NOT NULL DEFAULT 'short',
ADD COLUMN     "warmupStartedAt" TIMESTAMP(3);

