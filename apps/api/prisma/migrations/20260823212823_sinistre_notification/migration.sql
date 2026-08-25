-- CreateEnum
CREATE TYPE "SinistreNotificationKind" AS ENUM ('PUBLICATION', 'RECTIFICATIF_RECONNU');

-- CreateTable
CREATE TABLE "SinistreNotification" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "sinistreId" UUID NOT NULL,
    "arreteId" UUID NOT NULL,
    "kind" "SinistreNotificationKind" NOT NULL,
    "sentAt" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SinistreNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SinistreNotification_sinistreId_arreteId_kind_key" ON "SinistreNotification"("sinistreId", "arreteId", "kind");

-- AddForeignKey
ALTER TABLE "SinistreNotification" ADD CONSTRAINT "SinistreNotification_sinistreId_fkey" FOREIGN KEY ("sinistreId") REFERENCES "Sinistre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SinistreNotification" ADD CONSTRAINT "SinistreNotification_arreteId_fkey" FOREIGN KEY ("arreteId") REFERENCES "Arrete"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
