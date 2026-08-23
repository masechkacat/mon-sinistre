-- CreateTable
CREATE TABLE "AccountFormEmail" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "emailHash" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountFormEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "emailHash" TEXT NOT NULL,
    "attemptedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountFormEmail_emailHash_sentAt_idx" ON "AccountFormEmail"("emailHash", "sentAt");

-- CreateIndex
CREATE INDEX "AccountFormEmail_sentAt_idx" ON "AccountFormEmail"("sentAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_emailHash_attemptedAt_idx" ON "LoginAttempt"("emailHash", "attemptedAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_attemptedAt_idx" ON "LoginAttempt"("attemptedAt");

-- CreateIndex
CREATE INDEX "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- Частичный индекс под часовую чистку неподтверждённых User: Prisma его не
-- выражает, поэтому CREATE INDEX написан здесь (schema.prisma это отмечает).
-- Подтверждённые аккаунты не удаляются никогда и составляют почти всю
-- таблицу — в индекс они не попадают. Тот же приём, что у
-- Veille_confirmExpiresAt_unconfirmed_idx (migration veille_cleanup_indexes).
CREATE INDEX "User_confirmExpiresAt_unconfirmed_idx"
  ON "User" ("confirmExpiresAt")
  WHERE "confirmedAt" IS NULL;
