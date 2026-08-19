-- CreateEnum
CREATE TYPE "DurationUnit" AS ENUM ('DAYS', 'MONTHS');

-- CreateEnum
CREATE TYPE "StepAnchor" AS ENUM ('DATE_SINISTRE', 'DATE_PUBLICATION_ARRETE', 'DATE_DECLARATION');

-- CreateTable
CREATE TABLE "VeilleNotification" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "veilleId" UUID NOT NULL,
    "arreteId" UUID NOT NULL,
    "sentAt" TIMESTAMPTZ(6),

    CONSTRAINT "VeilleNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadlineRule" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "unit" "DurationUnit" NOT NULL,
    "anchor" "StepAnchor" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "sourceUrl" TEXT NOT NULL,
    "sourceVerifiedAt" DATE NOT NULL,

    CONSTRAINT "DeadlineRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VeilleNotification_veilleId_arreteId_key" ON "VeilleNotification"("veilleId", "arreteId");

-- CreateIndex
CREATE UNIQUE INDEX "DeadlineRule_code_effectiveFrom_key" ON "DeadlineRule"("code", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "VeilleNotification" ADD CONSTRAINT "VeilleNotification_veilleId_fkey" FOREIGN KEY ("veilleId") REFERENCES "Veille"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VeilleNotification" ADD CONSTRAINT "VeilleNotification_arreteId_fkey" FOREIGN KEY ("arreteId") REFERENCES "Arrete"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- btree_gist: нужно для exclusion-ограничения ниже — оно смешивает равенство
-- на "code" (text) с пересечением daterange в одном GIST-индексе, а обычный
-- GIST не даёт оператор класса для равенства text.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Непересечение интервалов одного code — Prisma exclusion-ограничения не
-- выражает (data-model.md § 1, § 3). Границы включительны с обеих сторон:
-- закрытие предыдущей версии выставляет effectiveTo днём раньше effectiveFrom
-- новой, поэтому [эффективный_от, эффективный_до] соседних версий не
-- соприкасаются. effectiveTo NULL = не ограничен сверху.
ALTER TABLE "DeadlineRule" ADD CONSTRAINT "DeadlineRule_code_daterange_excl"
  EXCLUDE USING gist (
    "code" WITH =,
    daterange("effectiveFrom", "effectiveTo", '[]') WITH &&
  );
