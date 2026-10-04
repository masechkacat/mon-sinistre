-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('SCALE', 'OVERDUE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "reminderFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reminderUnsubscribeTokenHash" TEXT,
ADD COLUMN     "remindersDisabledAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "stepId" UUID NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "offsetDays" INTEGER,
    "plannedDate" DATE NOT NULL,
    "sentOn" DATE NOT NULL,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_reminderUnsubscribeTokenHash_key" ON "User"("reminderUnsubscribeTokenHash");

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Идемпотентность рассылки на уровне БД (data-model.md § 6): уникальности
-- условные по kind, Prisma частичные индексы не выражает. У SCALE ключ —
-- порог и дата шага: пересчёт plannedDate открывает новую серию напоминаний.
CREATE UNIQUE INDEX "ReminderLog_scale_key"
  ON "ReminderLog" ("stepId", "kind", "offsetDays", "plannedDate")
  WHERE "kind" = 'SCALE';

-- У OVERDUE ключ — день отправки: недельный интервал и предел числа писем
-- контролирует код, база запрещает лишь второе письмо в тот же день.
CREATE UNIQUE INDEX "ReminderLog_overdue_key"
  ON "ReminderLog" ("stepId", "sentOn")
  WHERE "kind" = 'OVERDUE';

-- Ежедневный отбор кандидатов на напоминание читает только шаги без
-- persistedStatus (отмеченные FAIT/NON_APPLICABLE поводом не бывают) —
-- data-model.md § 5 обещал этот индекс фазе напоминаний.
CREATE INDEX "Step_plannedDate_pending_idx"
  ON "Step" ("plannedDate")
  WHERE "persistedStatus" IS NULL;
