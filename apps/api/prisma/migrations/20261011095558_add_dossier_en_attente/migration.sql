-- CreateTable
CREATE TABLE "DossierEnAttente" (
    "userId" UUID NOT NULL,
    "codeInsee" TEXT NOT NULL,
    "risque" "RisqueCatnat" NOT NULL,
    "eventDate" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DossierEnAttente_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "DossierEnAttente" ADD CONSTRAINT "DossierEnAttente_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DossierEnAttente" ADD CONSTRAINT "DossierEnAttente_codeInsee_fkey" FOREIGN KEY ("codeInsee") REFERENCES "Commune"("codeInsee") ON DELETE RESTRICT ON UPDATE CASCADE;
