-- CreateEnum
CREATE TYPE "ArreteEntryOutcome" AS ENUM ('RECONNU', 'REFUSE');

-- CreateTable
CREATE TABLE "Arrete" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "nor" TEXT NOT NULL,
    "signedAt" DATE NOT NULL,
    "publishedAt" DATE NOT NULL,
    "jorfNumber" TEXT NOT NULL,
    "legifranceUrl" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL,
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "Arrete_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArreteEntry" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "arreteId" UUID NOT NULL,
    "codeInsee" TEXT,
    "communeLabelRaw" TEXT NOT NULL,
    "departementRaw" TEXT NOT NULL,
    "risque" TEXT NOT NULL,
    "eventStart" DATE NOT NULL,
    "eventEnd" DATE NOT NULL,
    "outcome" "ArreteEntryOutcome" NOT NULL,
    "motivation" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ArreteEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JorfDelta" (
    "fileName" TEXT NOT NULL,
    "processedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "JorfDelta_pkey" PRIMARY KEY ("fileName")
);

-- CreateIndex
CREATE UNIQUE INDEX "Arrete_nor_key" ON "Arrete"("nor");

-- AddForeignKey
ALTER TABLE "ArreteEntry" ADD CONSTRAINT "ArreteEntry_arreteId_fkey" FOREIGN KEY ("arreteId") REFERENCES "Arrete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArreteEntry" ADD CONSTRAINT "ArreteEntry_codeInsee_fkey" FOREIGN KEY ("codeInsee") REFERENCES "Commune"("codeInsee") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Партиальный unique индекс: Prisma такое не выражает (schema.prisma это
-- отмечает). Дубль строки одного арретé по (коммуна, риск, период события)
-- отклоняется только когда коммуна сопоставлена со справочником —
-- несопоставленные строки (codeInsee IS NULL) разбираются по алерту
-- вручную (фаза 2) и не должны блокировать друг друга.
CREATE UNIQUE INDEX "ArreteEntry_arreteId_codeInsee_risque_eventStart_eventEnd_key"
  ON "ArreteEntry" ("arreteId", "codeInsee", "risque", "eventStart", "eventEnd")
  WHERE "codeInsee" IS NOT NULL;
