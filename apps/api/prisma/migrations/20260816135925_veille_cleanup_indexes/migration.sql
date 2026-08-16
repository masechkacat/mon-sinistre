-- CreateIndex
CREATE INDEX "VeilleFormEmail_sentAt_idx" ON "VeilleFormEmail"("sentAt");

-- Частичный индекс под ту же часовую чистку для Veille: Prisma его не
-- выражает, поэтому CREATE INDEX написан здесь (schema.prisma это отмечает).
-- Подтверждённые подписки не удаляются никогда и составляют почти всю таблицу —
-- в индекс они не попадают.
CREATE INDEX "Veille_confirmExpiresAt_unconfirmed_idx"
  ON "Veille" ("confirmExpiresAt")
  WHERE "confirmedAt" IS NULL;
