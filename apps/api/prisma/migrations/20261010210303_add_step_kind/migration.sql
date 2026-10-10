-- CreateEnum
CREATE TYPE "StepKind" AS ENUM ('ACTION', 'PHOTOS', 'JUSTIFICATIFS', 'OBJETS', 'DECLARATION');

-- AlterTable
ALTER TABLE "Step" ADD COLUMN     "kind" "StepKind" NOT NULL DEFAULT 'ACTION';

-- Бэкфилл копий плана — осознанное исключение из «копия плана не
-- пересчитывается» (docs/research/data-model.md § 5): kind не дата и не статус,
-- а тождество шага, и без бэкфилла синистры, заведённые раньше, не получили бы
-- контейнеров. Позиции — seed CATNAT; свои шаги пользователя не трогаются.
UPDATE "Step"
   SET "kind" = CASE "order"
                  WHEN 1 THEN 'PHOTOS'
                  WHEN 5 THEN 'JUSTIFICATIFS'
                  WHEN 7 THEN 'DECLARATION'
                  WHEN 9 THEN 'OBJETS'
                END::"StepKind"
 WHERE "fromTemplate" AND "order" IN (1, 5, 7, 9);

-- AlterTable
ALTER TABLE "StepTemplate" ADD COLUMN     "kind" "StepKind" NOT NULL DEFAULT 'ACTION';

-- CreateIndex
CREATE INDEX "ArreteEntry_codeInsee_idx" ON "ArreteEntry"("codeInsee");
