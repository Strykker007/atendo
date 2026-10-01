-- CreateTable
CREATE TABLE "user_numbers" (
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,

    CONSTRAINT "user_numbers_pkey" PRIMARY KEY ("userId","numberId")
);

-- CreateIndex
CREATE INDEX "user_numbers_numberId_idx" ON "user_numbers"("numberId");

-- AddForeignKey
ALTER TABLE "user_numbers" ADD CONSTRAINT "user_numbers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_numbers" ADD CONSTRAINT "user_numbers_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "whatsapp_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

