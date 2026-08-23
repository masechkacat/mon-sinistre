-- CreateEnum
CREATE TYPE "SinistreStatus" AS ENUM ('AVANT_ARRETE', 'ARRETE_PUBLIE', 'ARRETE_REFUSE', 'DECLARE', 'CLOS', 'SANS_SUITE');

-- CreateEnum
CREATE TYPE "StepPersistedStatus" AS ENUM ('FAIT', 'NON_APPLICABLE');

-- CreateEnum
CREATE TYPE "RisqueCatnat" AS ENUM ('INONDATION', 'SECHERESSE', 'MOUVEMENT_TERRAIN', 'SEISME', 'AVALANCHE', 'VENTS_CYCLONIQUES');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StepAnchor" ADD VALUE 'DATE_ETAT_ESTIMATIF';
ALTER TYPE "StepAnchor" ADD VALUE 'DATE_ETAT_ESTIMATIF_OU_EXPERTISE';
ALTER TYPE "StepAnchor" ADD VALUE 'DATE_ACCORD_INDEMNISATION';

-- CreateTable
CREATE TABLE "StepTemplate" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "planKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "anchor" "StepAnchor" NOT NULL,
    "offsetDays" INTEGER,
    "deadlineRuleCode" TEXT,
    "required" BOOLEAN NOT NULL,
    "order" INTEGER NOT NULL,
    "sourceUrl" TEXT,
    "sourceVerifiedAt" DATE,

    CONSTRAINT "StepTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sinistre" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "codeInsee" TEXT NOT NULL,
    "risque" "RisqueCatnat" NOT NULL,
    "eventDate" DATE NOT NULL,
    "arreteEntryId" UUID,
    "declarationDate" DATE,
    "status" "SinistreStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sinistre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Step" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "sinistreId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "anchor" "StepAnchor",
    "offsetDays" INTEGER,
    "plannedDate" DATE,
    "persistedStatus" "StepPersistedStatus",
    "completedAt" DATE,
    "fromTemplate" BOOLEAN NOT NULL,
    "deadlineRuleId" UUID,
    "order" INTEGER NOT NULL,
    "sourceUrl" TEXT,
    "sourceVerifiedAt" DATE,

    CONSTRAINT "Step_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StepTemplate_planKey_order_key" ON "StepTemplate"("planKey", "order");

-- CreateIndex
CREATE INDEX "Sinistre_userId_idx" ON "Sinistre"("userId");

-- AddForeignKey
ALTER TABLE "Sinistre" ADD CONSTRAINT "Sinistre_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sinistre" ADD CONSTRAINT "Sinistre_codeInsee_fkey" FOREIGN KEY ("codeInsee") REFERENCES "Commune"("codeInsee") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sinistre" ADD CONSTRAINT "Sinistre_arreteEntryId_fkey" FOREIGN KEY ("arreteEntryId") REFERENCES "ArreteEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Step" ADD CONSTRAINT "Step_sinistreId_fkey" FOREIGN KEY ("sinistreId") REFERENCES "Sinistre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Step" ADD CONSTRAINT "Step_deadlineRuleId_fkey" FOREIGN KEY ("deadlineRuleId") REFERENCES "DeadlineRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
