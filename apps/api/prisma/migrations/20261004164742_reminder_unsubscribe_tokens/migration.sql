-- CreateTable
CREATE TABLE "ReminderUnsubscribeToken" (
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "ReminderUnsubscribeToken_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX "ReminderUnsubscribeToken_userId_idx" ON "ReminderUnsubscribeToken"("userId");

-- AddForeignKey
ALTER TABLE "ReminderUnsubscribeToken" ADD CONSTRAINT "ReminderUnsubscribeToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ссылка в последнем уже отправленном письме продолжает действовать.
INSERT INTO "ReminderUnsubscribeToken" ("tokenHash", "userId")
SELECT "reminderUnsubscribeTokenHash", "id" FROM "User"
WHERE "reminderUnsubscribeTokenHash" IS NOT NULL;

-- DropIndex
DROP INDEX "User_reminderUnsubscribeTokenHash_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "reminderUnsubscribeTokenHash";
