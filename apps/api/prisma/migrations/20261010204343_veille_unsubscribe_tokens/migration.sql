-- CreateTable
CREATE TABLE "VeilleUnsubscribeToken" (
    "tokenHash" TEXT NOT NULL,
    "veilleId" UUID NOT NULL,

    CONSTRAINT "VeilleUnsubscribeToken_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX "VeilleUnsubscribeToken_veilleId_idx" ON "VeilleUnsubscribeToken"("veilleId");

-- AddForeignKey
ALTER TABLE "VeilleUnsubscribeToken" ADD CONSTRAINT "VeilleUnsubscribeToken_veilleId_fkey" FOREIGN KEY ("veilleId") REFERENCES "Veille"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ссылка в последнем уже отправленном письме продолжает действовать.
INSERT INTO "VeilleUnsubscribeToken" ("tokenHash", "veilleId")
SELECT "unsubscribeTokenHash", "id" FROM "Veille";

-- DropIndex
DROP INDEX "Veille_unsubscribeTokenHash_key";

-- AlterTable
ALTER TABLE "Veille" DROP COLUMN "unsubscribeTokenHash";
