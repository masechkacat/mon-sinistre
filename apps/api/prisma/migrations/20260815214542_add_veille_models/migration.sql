-- CreateTable
CREATE TABLE "Veille" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "confirmedAt" TIMESTAMPTZ(6),
    "confirmTokenHash" TEXT NOT NULL,
    "unsubscribeTokenHash" TEXT NOT NULL,
    "confirmExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Veille_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VeilleCommune" (
    "veilleId" UUID NOT NULL,
    "codeInsee" TEXT NOT NULL,

    CONSTRAINT "VeilleCommune_pkey" PRIMARY KEY ("veilleId","codeInsee")
);

-- CreateTable
CREATE TABLE "VeilleFormEmail" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "emailHash" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VeilleFormEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Veille_email_key" ON "Veille"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Veille_confirmTokenHash_key" ON "Veille"("confirmTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Veille_unsubscribeTokenHash_key" ON "Veille"("unsubscribeTokenHash");

-- CreateIndex
CREATE INDEX "VeilleCommune_codeInsee_idx" ON "VeilleCommune"("codeInsee");

-- CreateIndex
CREATE INDEX "VeilleFormEmail_emailHash_sentAt_idx" ON "VeilleFormEmail"("emailHash", "sentAt");

-- AddForeignKey
ALTER TABLE "VeilleCommune" ADD CONSTRAINT "VeilleCommune_veilleId_fkey" FOREIGN KEY ("veilleId") REFERENCES "Veille"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VeilleCommune" ADD CONSTRAINT "VeilleCommune_codeInsee_fkey" FOREIGN KEY ("codeInsee") REFERENCES "Commune"("codeInsee") ON DELETE RESTRICT ON UPDATE CASCADE;
