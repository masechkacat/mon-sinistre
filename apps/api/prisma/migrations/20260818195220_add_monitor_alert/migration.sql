-- CreateEnum
CREATE TYPE "MonitorAlertKind" AS ENUM ('UNPARSEABLE_ANNEXE', 'UNMATCHED_COMMUNE', 'OUTCOME_CHANGED');

-- CreateTable
CREATE TABLE "MonitorAlert" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "kind" "MonitorAlertKind" NOT NULL,
    "detail" TEXT NOT NULL,
    "arreteId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorAlert_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MonitorAlert" ADD CONSTRAINT "MonitorAlert_arreteId_fkey" FOREIGN KEY ("arreteId") REFERENCES "Arrete"("id") ON DELETE SET NULL ON UPDATE CASCADE;
