-- CreateTable
CREATE TABLE "Commune" (
    "codeInsee" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departementCode" TEXT NOT NULL,
    "departementName" TEXT NOT NULL,
    "effectiveTo" DATE,
    "successorCodeInsee" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceVerifiedAt" DATE NOT NULL,

    CONSTRAINT "Commune_pkey" PRIMARY KEY ("codeInsee")
);

-- AddForeignKey
ALTER TABLE "Commune" ADD CONSTRAINT "Commune_successorCodeInsee_fkey" FOREIGN KEY ("successorCodeInsee") REFERENCES "Commune"("codeInsee") ON DELETE RESTRICT ON UPDATE CASCADE;
