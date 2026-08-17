-- CreateTable
CREATE TABLE "VeilleChange" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "veilleId" UUID NOT NULL,
    "changeTokenHash" TEXT NOT NULL,
    "communeCodes" TEXT[],
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VeilleChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VeilleChange_veilleId_key" ON "VeilleChange"("veilleId");

-- CreateIndex
CREATE UNIQUE INDEX "VeilleChange_changeTokenHash_key" ON "VeilleChange"("changeTokenHash");

-- AddForeignKey
ALTER TABLE "VeilleChange" ADD CONSTRAINT "VeilleChange_veilleId_fkey" FOREIGN KEY ("veilleId") REFERENCES "Veille"("id") ON DELETE CASCADE ON UPDATE CASCADE;
