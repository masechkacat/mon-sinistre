-- AlterTable
-- Nullable on purpose: rows already imported have no search key yet. The
-- backfill is a rerun of the idempotent import (one normalisation rule, in
-- TypeScript — never repeated in SQL); NOT NULL follows in its own migration.
ALTER TABLE "Commune" ADD COLUMN     "nameNormalized" TEXT;

-- CreateIndex
-- A plain btree under a non-C collation does not serve LIKE 'prefix%', hence
-- the operator class — declared in schema.prisma too, so that a later
-- `migrate dev` does not read it as drift and drop it.
CREATE INDEX "Commune_nameNormalized_prefix_idx" ON "Commune" ("nameNormalized" text_pattern_ops);
