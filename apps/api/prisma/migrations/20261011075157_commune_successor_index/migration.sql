CREATE INDEX "Commune_successorCodeInsee_idx"
  ON "Commune" ("successorCodeInsee")
  WHERE "successorCodeInsee" IS NOT NULL;
